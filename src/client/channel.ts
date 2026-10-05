import { listen } from "@vaakx-dev/vrui";
import {
  parse_server_message,
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
  phase: "streaming" | "waiting_complete";
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
    this.socket = socket ?? create_socket(key);
    listen(this.socket, "open", () => this.notify({ type: "connected" }));
    listen(this.socket, "close", () => {
      this.abort_transfer(new Error("SendIt disconnected."));
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
        relative_path: record.path,
        size: record.file.size,
        type: record.file.type || "application/octet-stream",
      })),
    });
  }

  private receive(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    const message = parse_server_message(event.data);
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
        void this.stream(message.transfer_id, message.item_id);
        return;
      case "chunk_ack":
        if (transfer?.id === message.transfer_id && transfer.acknowledgement) {
          const acknowledgement = transfer.acknowledgement;
          transfer.acknowledgement = null;
          acknowledgement.resolve();
        }
        return;
      case "transfer_cancel":
        if (transfer?.id === message.transfer_id) {
          this.abort_transfer(new Error(message.message || "Download cancelled."));
          this.notify({ type: "error", message: message.message || "Download cancelled." });
        }
        return;
      case "transfer_complete":
        if (transfer?.id === message.transfer_id) {
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

  private async stream(transfer_id: string, item_id: string): Promise<void> {
    const selected = this.selection.get(item_id);
    if (!selected || this.transfer) {
      this.send({ type: "transfer_error", transfer_id, message: "The selected file is unavailable." });
      return;
    }

    const reader = selected.file.stream().getReader();
    const transfer: Transfer = {
      id: transfer_id,
      selected,
      sent: 0,
      phase: "streaming",
      reader,
      acknowledgement: null,
    };
    this.transfer = transfer;

    try {
      this.send({ type: "transfer_begin", transfer_id, size: selected.file.size });
      while (this.transfer === transfer) {
        const result = await reader.read();
        if (result.done || this.transfer !== transfer) break;
        for (let offset = 0; offset < result.value.byteLength; offset += CHUNK_SIZE) {
          if (this.transfer !== transfer) return;
          const chunk = result.value.subarray(offset, offset + CHUNK_SIZE);
          await this.send_chunk(transfer, chunk);
          transfer.sent += chunk.byteLength;
          this.notify({ type: "progress", file: selected.file, sent: transfer.sent });
        }
      }
      if (this.transfer !== transfer) return;
      transfer.phase = "waiting_complete";
      transfer.reader = null;
      this.send({ type: "transfer_end", transfer_id });
    } catch (error) {
      if (this.transfer !== transfer) return;
      this.transfer = null;
      const message = error instanceof Error ? error.message : "Could not read the file.";
      this.send({ type: "transfer_error", transfer_id, message });
      this.notify({ type: "error", message });
    } finally {
      if (transfer.reader === reader) transfer.reader = null;
      reader.releaseLock();
    }
  }

  private send_chunk(transfer: Transfer, chunk: Uint8Array): Promise<void> {
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

  private abort_transfer(error: Error): void {
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
    this.socket.send(JSON.stringify(message));
  }
}

function create_socket(key: string): WebSocket {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${location.host}/ws/sender?key=${encodeURIComponent(key)}`);
}
