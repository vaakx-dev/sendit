export interface SharedItem {
  id: string;
  relativePath: string;
  size: number;
}

export interface ShareDetails {
  label: string;
  createdAt: string;
  senderOnline: boolean;
  totalSize: number;
  items: SharedItem[];
}

export type TransferMessage =
  | { type: "transferBegin"; transferId: string; size: number }
  | { type: "transferEnd"; transferId: string }
  | { type: "transferError"; transferId: string; message: string };

export type SenderMessage = { type: "publish"; label: string; items: SharedItem[] } | TransferMessage;

export type ServerMessage =
  | { type: "published"; url: string }
  | { type: "transferRequest"; transferId: string; itemId: string }
  | { type: "chunkAck"; transferId: string }
  | { type: "transferCancel"; transferId: string; message: string }
  | { type: "transferComplete"; transferId: string }
  | { type: "error"; message: string };
