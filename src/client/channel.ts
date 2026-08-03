import { listen } from "@vaakx-dev/vrui";
import type { SelectedFile, Selection } from "./selection.js";

export type ChannelEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "published"; url: string }
  | { type: "progress"; file: File; sent: number }
  | { type: "complete"; file: File }
  | { type: "error"; message: string };

interface Transfer {
  id: string;
  selected: SelectedFile;
  sent: number;
  cancelled: boolean;
}

export class SenderChannel {
  private socket: WebSocket;
  private transfer: Transfer | null = null;
  private acknowledge: (() => void) | null = null;

  constructor(
    key: string,
    private readonly selection: Selection,
    private readonly notify: (event: ChannelEvent) => void,
  ) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${location.host}/ws/sender?key=${encodeURIComponent(key)}`);
    listen(this.socket, "open", () => this.notify({ type: "connected" }));
    listen(this.socket, "close", () => this.notify({ type: "disconnected" }));
    listen(this.socket, "message", (event) => this.receive(event as MessageEvent));
  }

  publish(): void {
    const records = this.selection.all();
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
    const message = JSON.parse(event.data) as Record<string, unknown>;
    const transfer = this.transfer;

    switch (String(message.type)) {
      case "published":
        this.notify({ type: "published", url: String(message.url) });
        break;
      case "transfer_request":
        void this.stream(String(message.transfer_id), String(message.item_id));
        break;
      case "chunk_ack":
        if (transfer?.id === message.transfer_id) {
          this.acknowledge?.();
          this.acknowledge = null;
        }
        break;
      case "transfer_cancel":
        if (transfer && transfer.id === message.transfer_id) {
          transfer.cancelled = true;
          this.acknowledge?.();
          this.acknowledge = null;
          this.notify({ type: "error", message: String(message.message || "Download cancelled.") });
        }
        break;
      case "transfer_complete":
        if (transfer && transfer.id === message.transfer_id) {
          this.notify({ type: "complete", file: transfer.selected.file });
          this.transfer = null;
        }
        break;
      case "error":
        this.notify({ type: "error", message: String(message.message) });
        break;
    }
  }

  private async stream(transfer_id: string, item_id: string): Promise<void> {
    const selected = this.selection.get(item_id);
    if (!selected || this.transfer) {
      this.send({ type: "transfer_error", transfer_id, message: "The selected file is unavailable." });
      return;
    }

    const transfer: Transfer = { id: transfer_id, selected, sent: 0, cancelled: false };
    this.transfer = transfer;
    this.send({ type: "transfer_begin", transfer_id, size: selected.file.size });

    try {
      const reader = selected.file.stream().getReader();
      while (true) {
        const result = await reader.read();
        if (result.done || transfer.cancelled) break;
        await this.send_chunk(result.value);
        if (transfer.cancelled) break;
        transfer.sent += result.value.byteLength;
        this.notify({ type: "progress", file: selected.file, sent: transfer.sent });
      }
      if (!transfer.cancelled) this.send({ type: "transfer_end", transfer_id });
    } catch (error) {
      this.send({
        type: "transfer_error",
        transfer_id,
        message: error instanceof Error ? error.message : "Could not read the file.",
      });
      if (this.transfer === transfer) this.transfer = null;
    }
  }

  private send_chunk(chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error("SendIt disconnected."));
        return;
      }
      this.acknowledge = resolve;
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      this.socket.send(copy.buffer);
    });
  }

  private send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
}
