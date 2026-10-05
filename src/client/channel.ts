import type { SenderMessage, ServerMessage } from "../shared/protocol.js";
import type { Selection } from "./selection.js";

export type ChannelEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "published"; url: string }
  | { type: "progress"; file: File; sent: number }
  | { type: "complete"; file: File }
  | { type: "error"; message: string };

const CHUNK_SIZE = 256 * 1024;

export class SenderChannel {
  private transfer: OutgoingTransfer | null = null;

  constructor(
    private readonly socket: WebSocket,
    private readonly selection: Selection,
    private readonly notify: (event: ChannelEvent) => void,
  ) {
    socket.addEventListener("open", () => notify({ type: "connected" }));
    socket.addEventListener("close", () => {
      this.cancel(new Error("SendIt disconnected."));
      notify({ type: "disconnected" });
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => this.receive(JSON.parse(event.data) as ServerMessage));
  }

  publish(): void {
    this.send({
      type: "publish",
      label: this.selection.label(),
      items: this.selection.included().map(({ id, path, file }) => ({ id, relativePath: path, size: file.size })),
    });
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case "published":
        return this.notify({ type: "published", url: message.url });
      case "transferRequest":
        return this.startTransfer(message.transferId, message.itemId);
      case "chunkAck":
        return this.current(message.transferId)?.acknowledge();
      case "transferCancel": {
        if (!this.current(message.transferId)) return;
        const reason = message.message || "Download cancelled.";
        this.cancel(new Error(reason));
        return this.notify({ type: "error", message: reason });
      }
      case "transferComplete": {
        const transfer = this.current(message.transferId);
        if (!transfer) return;
        this.transfer = null;
        return this.notify({ type: "complete", file: transfer.file });
      }
      case "error":
        return this.notify({ type: "error", message: message.message });
    }
  }

  private startTransfer(transferId: string, itemId: string): void {
    const selected = this.selection.get(itemId);
    if (!selected || this.transfer) {
      return this.send({ type: "transferError", transferId, message: "The selected file is unavailable." });
    }
    const transfer = new OutgoingTransfer(transferId, selected.file);
    this.transfer = transfer;
    this.stream(transfer).catch((error: Error) => this.fail(transfer, error));
  }

  private async stream(transfer: OutgoingTransfer): Promise<void> {
    const { id: transferId, file } = transfer;
    this.send({ type: "transferBegin", transferId, size: file.size });
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      const acknowledged = transfer.expectAck();
      this.socket.send(chunk);
      await acknowledged;
      this.notify({ type: "progress", file, sent: offset + chunk.byteLength });
    }
    this.send({ type: "transferEnd", transferId });
  }

  private fail(transfer: OutgoingTransfer, error: Error): void {
    if (this.transfer !== transfer) return;
    this.transfer = null;
    this.send({ type: "transferError", transferId: transfer.id, message: error.message });
    this.notify({ type: "error", message: error.message });
  }

  private cancel(reason: Error): void {
    this.transfer?.cancel(reason);
    this.transfer = null;
  }

  private current(transferId: string): OutgoingTransfer | null {
    return this.transfer?.id === transferId ? this.transfer : null;
  }

  private send(message: SenderMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.notify({ type: "error", message: "SendIt disconnected." });
  }
}

class OutgoingTransfer {
  private readonly cancellation = new AbortController();
  private pendingAck: PromiseWithResolvers<void> | null = null;

  constructor(
    readonly id: string,
    readonly file: File,
  ) {}

  expectAck(): Promise<void> {
    this.cancellation.signal.throwIfAborted();
    this.pendingAck = Promise.withResolvers<void>();
    return this.pendingAck.promise;
  }

  acknowledge(): void {
    this.pendingAck?.resolve();
  }

  cancel(reason: Error): void {
    this.cancellation.abort(reason);
    this.pendingAck?.reject(reason);
  }
}
