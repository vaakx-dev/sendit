import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { serializeServerMessage } from "./protocol.js";
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
  idleTimeoutMs?: number;
}

interface ActiveTransfer {
  id: string;
  item: SharedItem;
  sink: Writable;
  written: number;
  phase: "waitingBegin" | "receiving";
  writePending: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  onSinkError: ((error: Error) => void) | null;
  resolve: () => void;
  reject: (error: Error) => void;
  onProgress: (written: number, total: number) => void;
}

export class SenderConnection {
  private socket: SenderSocket | null = null;
  private active: ActiveTransfer | null = null;
  private readonly idleTimeoutMs: number;

  constructor(options: SenderConnectionOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.idleTimeoutMs) || this.idleTimeoutMs <= 0) {
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

  disconnectSocket(socket: SenderSocket, error = new Error("Sender disconnected.")): void {
    if (this.socket !== socket) return;
    this.disconnect(error);
  }

  isConnected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  isBusy(): boolean {
    return this.active !== null;
  }

  send(message: ServerToSenderMessage): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    this.socket.send(serializeServerMessage(message));
  }

  request(
    item: SharedItem,
    sink: Writable,
    onProgress: (written: number, total: number) => void,
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
        phase: "waitingBegin",
        writePending: false,
        timeout: null,
        onSinkError: null,
        resolve,
        reject,
        onProgress,
      };
      const onSinkError = (error: Error) => this.fail(active, error);
      active.onSinkError = onSinkError;
      sink.once("error", onSinkError);
      this.active = active;
      this.refreshTimeout(active);
      this.send({ type: "transfer_request", transferId: id, itemId: item.id });
    });
  }

  handleMessage(message: SenderTransferMessage): void {
    const active = this.active;
    if (!active || message.transferId !== active.id) return;

    switch (message.type) {
      case "transfer_begin":
        if (active.phase !== "waitingBegin" || message.size !== active.item.size) {
          this.fail(active, new Error("The selected file changed before the download started."));
          return;
        }
        active.phase = "receiving";
        this.refreshTimeout(active);
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

  handleChunk(chunk: Buffer): void {
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

    this.refreshTimeout(active);
    active.writePending = true;
    try {
      active.sink.write(chunk, (error) => {
        active.writePending = false;
        if (error) return;
        if (this.active !== active) {
          if (active.onSinkError) active.sink.off("error", active.onSinkError);
          return;
        }
        active.written += chunk.length;
        active.onProgress(active.written, active.item.size);
        this.refreshTimeout(active);
        this.send({ type: "chunk_ack", transferId: active.id });
      });
    } catch (error) {
      active.writePending = false;
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
    this.send({ type: "transfer_complete", transferId: active.id });
  }

  private fail(active: ActiveTransfer, error: Error): void {
    if (!this.release(active)) return;
    active.reject(error);
    this.send({ type: "transfer_cancel", transferId: active.id, message: error.message });
  }

  private release(active: ActiveTransfer): boolean {
    if (this.active !== active) return false;
    this.active = null;
    if (active.timeout) clearTimeout(active.timeout);
    if (!active.writePending && active.onSinkError) active.sink.off("error", active.onSinkError);
    return true;
  }

  private refreshTimeout(active: ActiveTransfer): void {
    if (this.active !== active) return;
    if (active.timeout) clearTimeout(active.timeout);
    active.timeout = setTimeout(() => {
      this.fail(active, new Error("The sender stopped responding."));
    }, this.idleTimeoutMs);
  }
}
