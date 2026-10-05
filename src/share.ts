import { randomBytes } from "node:crypto";
import type { PublishMessage, SharedItems, ShareDetails } from "./protocol.js";

export interface Share {
  token: string;
  label: string;
  items: SharedItems;
  created_at: string;
}

export function create_share(message: PublishMessage): Share {
  const sanitized = message.items.map((item) => ({
    ...item,
    name: clean_name(item.name),
    relative_path: clean_path(item.relative_path),
  }));
  const [first, ...rest] = sanitized;
  if (!first) throw new Error("Select at least one file.");
  const items: SharedItems = [first, ...rest];

  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("File identifiers must be unique.");
  }
  if (new Set(items.map((item) => item.relative_path)).size !== items.length) {
    throw new Error("File paths must be unique.");
  }

  return {
    token: randomBytes(24).toString("base64url"),
    label: clean_name(message.label),
    items,
    created_at: new Date().toISOString(),
  };
}

export function share_details(share: Share, sender_online: boolean): ShareDetails {
  return {
    label: share.label,
    created_at: share.created_at,
    sender_online,
    total_size: share.items.reduce((total, item) => total + item.size, 0),
    items: share.items,
  };
}

export function archive_name(share: Share): string {
  return `${clean_name(share.label) || "sendit-files"}.zip`;
}

function clean_name(value: string): string {
  return value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-").trim().slice(0, 200) || "Shared files";
}

function clean_path(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[\u0000-\u001f]/g, ""))
    .join("/") || "file";
}
