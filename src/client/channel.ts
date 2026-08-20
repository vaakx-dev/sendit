import { listen } from "@vaakx-dev/vrui";
import {
  parseServerMessage,
  serializeSenderMessage,
  type SenderToServerMessage,
} from "../protocol.js";
import type { SelectedFile, Selection } from "./selection.js";

const OPEN = 1;
const CHUNK_SIZE = 256 * 1024;

export type ChannelEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "published"; url: string }
  | { type: "progress"; file: File; sent: number }
  | { type: "complete"; file: File }
  | { type: "error"; message: string };

export interface SenderChannelSocket extends EventTarget {
  readonly readyState: number;
  send(data: string | ArrayBuffer): void;
}

interface PendingAcknowledgement {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface Transfer {
  id: string;
  selected: SelectedFile;
  sent: number;
  phase: "streaming" | "waitingComplete";
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  acknowledgement: PendingAcknowledgement | null;
}

export class SenderChannel {
  private readonly socket: SenderChannelSocket;
  private transfer: Transfer | null = null;

  constructor(
    key: string,
    private readonly selection: Selection,
    private readonly notify: (event: ChannelEvent) => void,
    socket?: SenderChannelSocket,
  ) {
    this.socket = socket ?? createSocket(key);
    listen(this.socket, "open", () => this.notify({ type: "connected" }));
    listen(this.socket, "close", () => {
      this.abortTransfer(new Error("SendIt disconnected."));
      this.notify({ type: "disconnected" });
    });
    listen(this.socket, "message", (event) => {
      if (event instanceof MessageEvent) this.receive(event);
    });
  }

  publish(): void {
    const records = this.selection.included();
    this.send({
      type: "publish",
      label: this.selection.label(),
      items: records.map((record) => ({
        id: record.id,
        name: record.file.name,
        relativePath: record.path,
        size: record.file.size,
        type: record.file.type || "application/octet-stream",
      })),
    });
  }

  private receive(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    const message = parseServerMessage(event.data);
    if (!message) {
      this.notify({ type: "error", message: "SendIt received an invalid server message." });
      return;
    }
    const transfer = this.transfer;

    switch (message.type) {
      case "ready":
        return;
      case "published":
        this.notify({ type: "published", url: message.url });
        return;
      case "transfer_request":
        void this.stream(message.transferId, message.itemId);
        return;
      case "chunk_ack":
        if (transfer?.id === message.transferId && transfer.acknowledgement) {
          const acknowledgement = transfer.acknowledgement;
          transfer.acknowledgement = null;
          acknowledgement.resolve();
        }
        return;
      case "transfer_cancel":
        if (transfer?.id === message.transferId) {
          this.abortTransfer(new Error(message.message || "Download cancelled."));
          this.notify({ type: "error", message: message.message || "Download cancelled." });
        }
        return;
      case "transfer_complete":
        if (transfer?.id === message.transferId) {
          this.transfer = null;
          this.notify({ type: "complete", file: transfer.selected.file });
        }
        return;
      case "error":
        this.notify({ type: "error", message: message.message });
        return;
    }
    const unhandled: never = message;
    return unhandled;
  }

  private async stream(transferId: string, itemId: string): Promise<void> {
    const selected = this.selection.get(itemId);
    if (!selected || this.transfer) {
      this.send({ type: "transfer_error", transferId, message: "The selected file is unavailable." });
      return;
    }

    const reader = selected.file.stream().getReader();
    const transfer: Transfer = {
      id: transferId,
      selected,
      sent: 0,
      phase: "streaming",
      reader,
      acknowledgement: null,
    };
    this.transfer = transfer;

    try {
      this.send({ type: "transfer_begin", transferId, size: selected.file.size });
      while (this.transfer === transfer) {
        const result = await reader.read();
        if (result.done || this.transfer !== transfer) break;
        for (let offset = 0; offset < result.value.byteLength; offset += CHUNK_SIZE) {
          if (this.transfer !== transfer) return;
          const chunk = result.value.subarray(offset, offset + CHUNK_SIZE);
          await this.sendChunk(transfer, chunk);
          transfer.sent += chunk.byteLength;
          this.notify({ type: "progress", file: selected.file, sent: transfer.sent });
        }
      }
      if (this.transfer !== transfer) return;
      transfer.phase = "waitingComplete";
      transfer.reader = null;
      this.send({ type: "transfer_end", transferId });
    } catch (error) {
      if (this.transfer !== transfer) return;
      this.transfer = null;
      const message = error instanceof Error ? error.message : "Could not read the file.";
      this.send({ type: "transfer_error", transferId, message });
      this.notify({ type: "error", message });
    } finally {
      if (transfer.reader === reader) transfer.reader = null;
      reader.releaseLock();
    }
  }

  private sendChunk(transfer: Transfer, chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== OPEN || this.transfer !== transfer || transfer.phase !== "streaming") {
        reject(new Error("SendIt disconnected."));
        return;
      }
      transfer.acknowledgement = { resolve, reject };
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      this.socket.send(copy.buffer);
    });
  }

  private abortTransfer(error: Error): void {
    const transfer = this.transfer;
    if (!transfer) return;
    this.transfer = null;
    const acknowledgement = transfer.acknowledgement;
    transfer.acknowledgement = null;
    acknowledgement?.reject(error);
    const reader = transfer.reader;
    transfer.reader = null;
    if (reader) void reader.cancel().catch(() => {});
  }

  private send(message: SenderToServerMessage): void {
    if (this.socket.readyState !== OPEN) {
      this.notify({ type: "error", message: "SendIt disconnected." });
      return;
    }
    this.socket.send(serializeSenderMessage(message));
  }
}

function createSocket(key: string): WebSocket {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${location.host}/ws/sender?key=${encodeURIComponent(key)}`);
}
