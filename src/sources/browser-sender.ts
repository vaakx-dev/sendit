import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Readable, type Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { SenderMessage, ServerMessage, SharedItem, TransferMessage } from "../shared/protocol.js";
import { unavailableReason, type FileSource, type SourceStatus } from "./file-source.js";

export type PublishHandler = (label: string, items: SharedItem[]) => string;

const IDLE_TIMEOUT_MS = 30_000;
const PING_INTERVAL_MS = 30_000;
const MAX_ITEMS = 250_000;

export class BrowserSender implements FileSource, Disposable {
  readonly key = randomBytes(24).toString("base64url");
  private readonly sockets = new WebSocketServer({ noServer: true });
  private socket: WebSocket | null = null;
  private transfer: Transfer | null = null;

  constructor(private readonly publish: PublishHandler) {}

  get status(): SourceStatus {
    if (this.socket?.readyState !== WebSocket.OPEN) return "offline";
    return this.transfer ? "busy" : "ready";
  }

  accept(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.sockets.handleUpgrade(request, socket, head, (websocket) => this.connect(websocket));
  }

  open(item: SharedItem, signal: AbortSignal): Readable {
    const reason = unavailableReason(this.status);
    if (reason) throw new Error(reason);

    const transfer = new Transfer(item, (message) => this.send(message));
    const release = () => {
      if (this.transfer === transfer) this.transfer = null;
    };
    this.transfer = transfer;
    transfer.once("end", release).once("close", release);
    signal.addEventListener("abort", () => transfer.destroy(signal.reason), { once: true });
    this.send({ type: "transferRequest", transferId: transfer.id, itemId: item.id });
    return transfer;
  }

  [Symbol.dispose](): void {
    this.disconnect(new Error("SendIt stopped."));
    this.sockets.close();
  }

  private connect(socket: WebSocket): void {
    this.disconnect(new Error("The sender was replaced by a new connection."));
    this.socket = socket;
    const keepAlive = setInterval(() => socket.ping(), PING_INTERVAL_MS);
    socket.on("message", (data, isBinary) => this.receive(data, isBinary));
    socket.on("error", () => socket.terminate());
    socket.once("close", () => {
      clearInterval(keepAlive);
      if (this.socket === socket) this.disconnect(new Error("The sender disconnected."));
    });
  }

  private disconnect(reason: Error): void {
    this.transfer?.destroy(reason);
    this.socket?.close(1000, "SendIt closed the connection");
    this.socket = null;
  }

  private receive(data: RawData, isBinary: boolean): void {
    if (isBinary) return this.transfer?.receive(toBuffer(data));

    const message = parseSenderMessage(data.toString());
    if (!message) return this.send({ type: "error", message: "Invalid sender message." });
    if (message.type === "publish") return this.send({ type: "published", url: this.publish(message.label, message.items) });
    if (message.transferId === this.transfer?.id) this.transfer.handle(message);
  }

  private send(message: ServerMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}

class Transfer extends Readable {
  readonly id = randomUUID();
  private received = 0;
  private started = false;
  private ackOnRead = false;
  private readonly idleTimer = setTimeout(() => this.destroy(new Error("The sender stopped responding.")), IDLE_TIMEOUT_MS);

  constructor(
    private readonly item: SharedItem,
    private readonly send: (message: ServerMessage) => void,
  ) {
    super();
  }

  handle(message: TransferMessage): void {
    switch (message.type) {
      case "transferBegin":
        if (this.started || message.size !== this.item.size) return this.fail("The selected file changed before the download started.");
        this.started = true;
        this.idleTimer.refresh();
        return;
      case "transferEnd":
        if (this.received !== this.item.size) return this.fail("The transfer ended before the complete file arrived.");
        clearTimeout(this.idleTimer);
        this.push(null);
        return this.send({ type: "transferComplete", transferId: this.id });
      case "transferError":
        return this.fail(message.message || "The sender could not read the file.");
    }
  }

  receive(chunk: Buffer): void {
    if (!this.started) return this.fail("The sender sent file data before starting the transfer.");
    if (this.received + chunk.length > this.item.size) return this.fail("The sender sent more data than expected.");
    this.received += chunk.length;
    if (this.push(chunk)) this.acknowledge();
    else this.ackOnRead = true;
  }

  override _read(): void {
    if (!this.ackOnRead) return;
    this.ackOnRead = false;
    this.acknowledge();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    clearTimeout(this.idleTimer);
    if (error) this.send({ type: "transferCancel", transferId: this.id, message: error.message });
    callback(error);
  }

  private acknowledge(): void {
    this.idleTimer.refresh();
    this.send({ type: "chunkAck", transferId: this.id });
  }

  private fail(message: string): void {
    this.destroy(new Error(message));
  }
}

function parseSenderMessage(data: string): SenderMessage | null {
  const message = parseJson(data);
  return isSenderMessage(message) ? message : null;
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function isSenderMessage(value: unknown): value is SenderMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "publish":
      return isText(value.label) && isItemList(value.items);
    case "transferBegin":
      return isText(value.transferId) && isSize(value.size);
    case "transferEnd":
      return isText(value.transferId);
    case "transferError":
      return isText(value.transferId) && typeof value.message === "string";
    default:
      return false;
  }
}

function isItemList(value: unknown): value is SharedItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_ITEMS &&
    value.every(isSharedItem) &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}

function isSharedItem(value: unknown): value is SharedItem {
  return isRecord(value) && isText(value.id) && isText(value.relativePath) && isSize(value.size);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}
