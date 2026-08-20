export interface SharedItem {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  type: string;
}

export interface PublishMessage {
  type: "publish";
  label: string;
  items: SharedItem[];
}

export interface TransferBeginMessage {
  type: "transfer_begin";
  transferId: string;
  size: number;
}

export interface TransferEndMessage {
  type: "transfer_end";
  transferId: string;
}

export interface TransferErrorMessage {
  type: "transfer_error";
  transferId: string;
  message: string;
}

export type SenderTransferMessage =
  | TransferBeginMessage
  | TransferEndMessage
  | TransferErrorMessage;

export type SenderToServerMessage = PublishMessage | SenderTransferMessage;

export type ServerToSenderMessage =
  | { type: "ready" }
  | { type: "published"; url: string }
  | { type: "transfer_request"; transferId: string; itemId: string }
  | { type: "chunk_ack"; transferId: string }
  | { type: "transfer_cancel"; transferId: string; message: string }
  | { type: "transfer_complete"; transferId: string }
  | { type: "error"; message: string };

export type SharedItems = [SharedItem, ...SharedItem[]];

export interface ShareDetails {
  label: string;
  createdAt: string;
  senderOnline: boolean;
  totalSize: number;
  items: SharedItems;
}

export function isSharedItem(value: unknown): value is SharedItem {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.id) &&
    isNonemptyString(value.name) &&
    isNonemptyString(value.relativePath) &&
    isNonnegativeSafeInteger(value.size) &&
    typeof value.type === "string"
  );
}

export function parseSenderMessage(data: string): SenderToServerMessage | null {
  const message = parseJsonRecord(data);
  if (!message) return null;

  switch (message.type) {
    case "publish": {
      const items = parseWireSharedItems(message.items);
      if (
        typeof message.label !== "string" ||
        message.label.length === 0 ||
        message.label.length > 200 ||
        !items ||
        items.length === 0 ||
        items.length > 250_000
      ) {
        return null;
      }
      return { type: "publish", label: message.label, items };
    }
    case "transfer_begin":
      return isNonemptyString(message.transfer_id) && isNonnegativeSafeInteger(message.size)
        ? { type: "transfer_begin", transferId: message.transfer_id, size: message.size }
        : null;
    case "transfer_end":
      return isNonemptyString(message.transfer_id)
        ? { type: "transfer_end", transferId: message.transfer_id }
        : null;
    case "transfer_error":
      return isNonemptyString(message.transfer_id) && typeof message.message === "string"
        ? { type: "transfer_error", transferId: message.transfer_id, message: message.message }
        : null;
    default:
      return null;
  }
}

export function parseServerMessage(data: string): ServerToSenderMessage | null {
  const message = parseJsonRecord(data);
  if (!message) return null;

  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "published":
      return isNonemptyString(message.url) ? { type: "published", url: message.url } : null;
    case "transfer_request":
      return isNonemptyString(message.transfer_id) && isNonemptyString(message.item_id)
        ? { type: "transfer_request", transferId: message.transfer_id, itemId: message.item_id }
        : null;
    case "chunk_ack":
      return isNonemptyString(message.transfer_id)
        ? { type: "chunk_ack", transferId: message.transfer_id }
        : null;
    case "transfer_cancel":
      return isNonemptyString(message.transfer_id) && typeof message.message === "string"
        ? { type: "transfer_cancel", transferId: message.transfer_id, message: message.message }
        : null;
    case "transfer_complete":
      return isNonemptyString(message.transfer_id)
        ? { type: "transfer_complete", transferId: message.transfer_id }
        : null;
    case "error":
      return typeof message.message === "string" ? { type: "error", message: message.message } : null;
    default:
      return null;
  }
}

export function parseShareDetails(value: unknown): ShareDetails | null {
  if (!isRecord(value)) return null;
  const items = parseSharedItems(value.items);
  const [first, ...rest] = items ?? [];
  if (
    typeof value.label !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.senderOnline !== "boolean" ||
    !isNonnegativeSafeInteger(value.totalSize) ||
    !first
  ) {
    return null;
  }
  return {
    label: value.label,
    createdAt: value.createdAt,
    senderOnline: value.senderOnline,
    totalSize: value.totalSize,
    items: [first, ...rest],
  };
}

export function serializeSenderMessage(message: SenderToServerMessage): string {
  switch (message.type) {
    case "publish":
      return JSON.stringify({
        type: message.type,
        label: message.label,
        items: message.items.map(serializeSharedItem),
      });
    case "transfer_begin":
      return JSON.stringify({ type: message.type, transfer_id: message.transferId, size: message.size });
    case "transfer_end":
      return JSON.stringify({ type: message.type, transfer_id: message.transferId });
    case "transfer_error":
      return JSON.stringify({ type: message.type, transfer_id: message.transferId, message: message.message });
  }
}

export function serializeServerMessage(message: ServerToSenderMessage): string {
  switch (message.type) {
    case "ready":
    case "published":
    case "error":
      return JSON.stringify(message);
    case "transfer_request":
      return JSON.stringify({ type: message.type, transfer_id: message.transferId, item_id: message.itemId });
    case "chunk_ack":
      return JSON.stringify({ type: message.type, transfer_id: message.transferId });
    case "transfer_cancel":
      return JSON.stringify({ type: message.type, transfer_id: message.transferId, message: message.message });
    case "transfer_complete":
      return JSON.stringify({ type: message.type, transfer_id: message.transferId });
  }
}

function parseJsonRecord(data: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseSharedItems(value: unknown): SharedItem[] | null {
  if (!isUnknownArray(value)) return null;
  const items: SharedItem[] = [];
  for (const item of value) {
    if (!isSharedItem(item)) return null;
    items.push(item);
  }
  return items;
}

function parseWireSharedItems(value: unknown): SharedItem[] | null {
  if (!isUnknownArray(value)) return null;
  const items: SharedItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonemptyString(item.id) ||
      !isNonemptyString(item.name) ||
      !isNonemptyString(item.relative_path) ||
      !isNonnegativeSafeInteger(item.size) ||
      typeof item.type !== "string"
    ) {
      return null;
    }
    items.push({
      id: item.id,
      name: item.name,
      relativePath: item.relative_path,
      size: item.size,
      type: item.type,
    });
  }
  return items;
}

function serializeSharedItem(item: SharedItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    relative_path: item.relativePath,
    size: item.size,
    type: item.type,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
