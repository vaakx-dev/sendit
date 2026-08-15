import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type {
  SenderTransferMessage,
  ServerToSenderMessage,
  SharedItem,
} from "./protocol.js";

const OPEN = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export interface SenderSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SenderConnectionOptions {
  idle_timeout_ms?: number;
}

interface ActiveTransfer {
  id: string;
  item: SharedItem;
  sink: Writable;
  written: number;
  phase: "waiting_begin" | "receiving";
  write_pending: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  on_sink_error: ((error: Error) => void) | null;
  resolve: () => void;
  reject: (error: Error) => void;
  on_progress: (written: number, total: number) => void;
}

export class SenderConnection {
  private socket: SenderSocket | null = null;
  private active: ActiveTransfer | null = null;
  private readonly idle_timeout_ms: number;

  constructor(options: SenderConnectionOptions = {}) {
    this.idle_timeout_ms = options.idle_timeout_ms ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.idle_timeout_ms) || this.idle_timeout_ms <= 0) {
      throw new Error("Transfer idle timeout must be a positive integer.");
    }
  }

  connect(socket: SenderSocket): void {
    this.disconnect(new Error("Sender was replaced by a new connection."));
    this.socket = socket;
  }

  disconnect(error = new Error("Sender disconnected.")): void {
    const active = this.active;
    if (active) this.fail(active, error);
    const socket = this.socket;
    if (socket?.readyState === OPEN) socket.close(1000, "Connection replaced");
    this.socket = null;
  }

  disconnect_socket(socket: SenderSocket, error = new Error("Sender disconnected.")): void {
    if (this.socket !== socket) return;
    this.disconnect(error);
  }

  is_connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  is_busy(): boolean {
    return this.active !== null;
  }

  send(message: ServerToSenderMessage): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  request(
    item: SharedItem,
    sink: Writable,
    on_progress: (written: number, total: number) => void,
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== OPEN) {
      return Promise.reject(new Error("The sender is offline."));
    }
    if (this.active) {
      return Promise.reject(new Error("Another download is already running."));
    }

    const id = randomUUID();
    return new Promise<void>((resolve, reject) => {
      const active: ActiveTransfer = {
        id,
        item,
        sink,
        written: 0,
        phase: "waiting_begin",
        write_pending: false,
        timeout: null,
        on_sink_error: null,
        resolve,
        reject,
        on_progress,
      };
      const on_sink_error = (error: Error) => this.fail(active, error);
      active.on_sink_error = on_sink_error;
      sink.once("error", on_sink_error);
      this.active = active;
      this.refresh_timeout(active);
      this.send({ type: "transfer_request", transfer_id: id, item_id: item.id });
    });
  }

  handle_message(message: SenderTransferMessage): void {
    const active = this.active;
    if (!active || message.transfer_id !== active.id) return;

    switch (message.type) {
      case "transfer_begin":
        if (active.phase !== "waiting_begin" || message.size !== active.item.size) {
          this.fail(active, new Error("The selected file changed before the download started."));
          return;
        }
        active.phase = "receiving";
        this.refresh_timeout(active);
        return;
      case "transfer_end":
        if (active.phase !== "receiving" || active.written !== active.item.size) {
          this.fail(active, new Error("The transfer ended before the complete file arrived."));
          return;
        }
        this.complete(active);
        return;
      case "transfer_error":
        this.fail(active, new Error(message.message || "The sender could not read the file."));
        return;
    }
    const unhandled: never = message;
    return unhandled;
  }

  handle_chunk(chunk: Buffer): void {
    const active = this.active;
    if (!active) return;
    if (active.phase !== "receiving") {
      this.fail(active, new Error("The sender provided file data before starting the transfer."));
      return;
    }
    if (active.written + chunk.length > active.item.size) {
      this.fail(active, new Error("The sender provided more data than expected."));
      return;
    }

    this.refresh_timeout(active);
    active.write_pending = true;
    try {
      active.sink.write(chunk, (error) => {
        active.write_pending = false;
        if (error) return;
        if (this.active !== active) {
          if (active.on_sink_error) active.sink.off("error", active.on_sink_error);
          return;
        }
        active.written += chunk.length;
        active.on_progress(active.written, active.item.size);
        this.refresh_timeout(active);
        this.send({ type: "chunk_ack", transfer_id: active.id });
      });
    } catch (error) {
      active.write_pending = false;
      this.fail(active, error instanceof Error ? error : new Error("The recipient stream failed."));
    }
  }

  cancel(error: Error): void {
    const active = this.active;
    if (active) this.fail(active, error);
  }

  private complete(active: ActiveTransfer): void {
    if (!this.release(active)) return;
    active.resolve();
    this.send({ type: "transfer_complete", transfer_id: active.id });
  }

  private fail(active: ActiveTransfer, error: Error): void {
    if (!this.release(active)) return;
    active.reject(error);
    this.send({ type: "transfer_cancel", transfer_id: active.id, message: error.message });
  }

  private release(active: ActiveTransfer): boolean {
    if (this.active !== active) return false;
    this.active = null;
    if (active.timeout) clearTimeout(active.timeout);
    if (!active.write_pending && active.on_sink_error) active.sink.off("error", active.on_sink_error);
    return true;
  }

  private refresh_timeout(active: ActiveTransfer): void {
    if (this.active !== active) return;
    if (active.timeout) clearTimeout(active.timeout);
    active.timeout = setTimeout(() => {
      this.fail(active, new Error("The sender stopped responding."));
    }, this.idle_timeout_ms);
  }
}
