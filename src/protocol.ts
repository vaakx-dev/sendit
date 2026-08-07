export interface SharedItem {
  id: string;
  name: string;
  relative_path: string;
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
  transfer_id: string;
  size: number;
}

export interface TransferEndMessage {
  type: "transfer_end";
  transfer_id: string;
}

export interface TransferErrorMessage {
  type: "transfer_error";
  transfer_id: string;
  message: string;
}

export type SenderMessage =
  | PublishMessage
  | TransferBeginMessage
  | TransferEndMessage
  | TransferErrorMessage;

export function is_shared_item(value: unknown): value is SharedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    typeof item.relative_path === "string" &&
    item.relative_path.length > 0 &&
    typeof item.size === "number" &&
    Number.isSafeInteger(item.size) &&
    item.size >= 0 &&
    typeof item.type === "string"
  );
}

export function parse_sender_message(data: string): SenderMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;

  switch (message.type) {
    case "publish": {
      if (
        typeof message.label !== "string" ||
        message.label.length === 0 ||
        message.label.length > 200 ||
        !Array.isArray(message.items) ||
        message.items.length === 0 ||
        message.items.length > 250_000 ||
        !message.items.every(is_shared_item)
      ) {
        return null;
      }
      return message as unknown as PublishMessage;
    }
    case "transfer_begin": {
      if (
        typeof message.transfer_id !== "string" ||
        typeof message.size !== "number" ||
        !Number.isSafeInteger(message.size) ||
        message.size < 0
      ) {
        return null;
      }
      return message as unknown as TransferBeginMessage;
    }
    case "transfer_end":
      return typeof message.transfer_id === "string"
        ? (message as unknown as TransferEndMessage)
        : null;
    case "transfer_error":
      return typeof message.transfer_id === "string" && typeof message.message === "string"
        ? (message as unknown as TransferErrorMessage)
        : null;
    default:
      return null;
  }
}
