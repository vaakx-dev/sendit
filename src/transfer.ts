import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { WebSocket } from "ws";
import type { SharedItem, SenderMessage } from "./protocol.js";

interface ActiveTransfer {
  id: string;
  item: SharedItem;
  sink: Writable;
  written: number;
  began: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  on_progress: (written: number, total: number) => void;
}

export class SenderConnection {
  private socket: WebSocket | null = null;
  private active: ActiveTransfer | null = null;

  connect(socket: WebSocket): void {
    this.disconnect(new Error("Sender was replaced by a new connection."));
    this.socket = socket;
  }

  disconnect(error = new Error("Sender disconnected.")): void {
    if (this.active) {
      this.active.reject(error);
      this.active = null;
    }
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1000, "Connection replaced");
    }
    this.socket = null;
  }

  disconnect_socket(socket: WebSocket, error = new Error("Sender disconnected.")): void {
    if (this.socket !== socket) return;
    this.disconnect(error);
  }

  is_connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  is_busy(): boolean {
    return this.active !== null;
  }

  send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  request(
    item: SharedItem,
    sink: Writable,
    on_progress: (written: number, total: number) => void,
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The sender is offline."));
    }
    if (this.active) {
      return Promise.reject(new Error("Another download is already running."));
    }

    const id = randomUUID();
    return new Promise<void>((resolve, reject) => {
      this.active = {
        id,
        item,
        sink,
        written: 0,
        began: false,
        resolve,
        reject,
        on_progress,
      };
      this.send({ type: "transfer_request", transfer_id: id, item_id: item.id });
    });
  }

  handle_message(message: SenderMessage): void {
    const active = this.active;
    if (!active || !("transfer_id" in message) || message.transfer_id !== active.id) return;

    switch (message.type) {
      case "transfer_begin":
        if (message.size !== active.item.size) {
          this.fail(new Error("The selected file changed before the download started."));
          return;
        }
        active.began = true;
        return;
      case "transfer_end":
        if (!active.began || active.written !== active.item.size) {
          this.fail(new Error("The transfer ended before the complete file arrived."));
          return;
        }
        this.active = null;
        active.resolve();
        this.send({ type: "transfer_complete", transfer_id: active.id });
        return;
      case "transfer_error":
        this.fail(new Error(message.message || "The sender could not read the file."));
        return;
    }
  }

  handle_chunk(chunk: Buffer): void {
    const active = this.active;
    if (!active || !active.began) return;
    if (active.written + chunk.length > active.item.size) {
      this.fail(new Error("The sender provided more data than expected."));
      return;
    }

    active.sink.write(chunk, (error) => {
      if (this.active !== active) return;
      if (error) {
        this.fail(error);
        return;
      }
      active.written += chunk.length;
      active.on_progress(active.written, active.item.size);
      this.send({ type: "chunk_ack", transfer_id: active.id });
    });
  }

  cancel(error: Error): void {
    this.fail(error);
  }

  private fail(error: Error): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.reject(error);
    this.send({ type: "transfer_cancel", transfer_id: active.id, message: error.message });
  }
}
