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

export type SenderTransferMessage =
  | TransferBeginMessage
  | TransferEndMessage
  | TransferErrorMessage;

export type SenderToServerMessage = PublishMessage | SenderTransferMessage;

export type ServerToSenderMessage =
  | { type: "ready" }
  | { type: "published"; url: string }
  | { type: "transfer_request"; transfer_id: string; item_id: string }
  | { type: "chunk_ack"; transfer_id: string }
  | { type: "transfer_cancel"; transfer_id: string; message: string }
  | { type: "transfer_complete"; transfer_id: string }
  | { type: "error"; message: string };

export type SharedItems = [SharedItem, ...SharedItem[]];

export interface ShareDetails {
  label: string;
  created_at: string;
  sender_online: boolean;
  total_size: number;
  items: SharedItems;
}

export function is_shared_item(value: unknown): value is SharedItem {
  if (!is_record(value)) return false;
  return (
    is_nonempty_string(value.id) &&
    is_nonempty_string(value.name) &&
    is_nonempty_string(value.relative_path) &&
    is_nonnegative_safe_integer(value.size) &&
    typeof value.type === "string"
  );
}

export function parse_sender_message(data: string): SenderToServerMessage | null {
  const message = parse_json_record(data);
  if (!message) return null;

  switch (message.type) {
    case "publish": {
      const items = parse_shared_items(message.items);
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
      return is_nonempty_string(message.transfer_id) && is_nonnegative_safe_integer(message.size)
        ? { type: "transfer_begin", transfer_id: message.transfer_id, size: message.size }
        : null;
    case "transfer_end":
      return is_nonempty_string(message.transfer_id)
        ? { type: "transfer_end", transfer_id: message.transfer_id }
        : null;
    case "transfer_error":
      return is_nonempty_string(message.transfer_id) && typeof message.message === "string"
        ? { type: "transfer_error", transfer_id: message.transfer_id, message: message.message }
        : null;
    default:
      return null;
  }
}

export function parse_server_message(data: string): ServerToSenderMessage | null {
  const message = parse_json_record(data);
  if (!message) return null;

  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "published":
      return is_nonempty_string(message.url) ? { type: "published", url: message.url } : null;
    case "transfer_request":
      return is_nonempty_string(message.transfer_id) && is_nonempty_string(message.item_id)
        ? { type: "transfer_request", transfer_id: message.transfer_id, item_id: message.item_id }
        : null;
    case "chunk_ack":
      return is_nonempty_string(message.transfer_id)
        ? { type: "chunk_ack", transfer_id: message.transfer_id }
        : null;
    case "transfer_cancel":
      return is_nonempty_string(message.transfer_id) && typeof message.message === "string"
        ? { type: "transfer_cancel", transfer_id: message.transfer_id, message: message.message }
        : null;
    case "transfer_complete":
      return is_nonempty_string(message.transfer_id)
        ? { type: "transfer_complete", transfer_id: message.transfer_id }
        : null;
    case "error":
      return typeof message.message === "string" ? { type: "error", message: message.message } : null;
    default:
      return null;
  }
}

export function parse_share_details(value: unknown): ShareDetails | null {
  if (!is_record(value)) return null;
  const items = parse_shared_items(value.items);
  const [first, ...rest] = items ?? [];
  if (
    typeof value.label !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.sender_online !== "boolean" ||
    !is_nonnegative_safe_integer(value.total_size) ||
    !first
  ) {
    return null;
  }
  return {
    label: value.label,
    created_at: value.created_at,
    sender_online: value.sender_online,
    total_size: value.total_size,
    items: [first, ...rest],
  };
}

function parse_json_record(data: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data);
    return is_record(value) ? value : null;
  } catch {
    return null;
  }
}

function parse_shared_items(value: unknown): SharedItem[] | null {
  if (!is_unknown_array(value)) return null;
  const items: SharedItem[] = [];
  for (const item of value) {
    if (!is_shared_item(item)) return null;
    items.push(item);
  }
  return items;
}

function is_record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function is_unknown_array(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function is_nonempty_string(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function is_nonnegative_safe_integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
