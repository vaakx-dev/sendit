import { randomBytes } from "node:crypto";
import type { PublishMessage, SharedItems, ShareDetails } from "./protocol.js";

export interface Share {
  token: string;
  label: string;
  items: SharedItems;
  createdAt: string;
}

export function createShare(message: PublishMessage): Share {
  const sanitized = message.items.map((item) => ({
    ...item,
    name: cleanName(item.name),
    relativePath: cleanPath(item.relativePath),
  }));
  const [first, ...rest] = sanitized;
  if (!first) throw new Error("Select at least one file.");
  const items: SharedItems = [first, ...rest];

  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("File identifiers must be unique.");
  }
  if (new Set(items.map((item) => item.relativePath)).size !== items.length) {
    throw new Error("File paths must be unique.");
  }

  return {
    token: randomBytes(24).toString("base64url"),
    label: cleanName(message.label),
    items,
    createdAt: new Date().toISOString(),
  };
}

export function shareDetails(share: Share, senderOnline: boolean): ShareDetails {
  return {
    label: share.label,
    createdAt: share.createdAt,
    senderOnline,
    totalSize: share.items.reduce((total, item) => total + item.size, 0),
    items: share.items,
  };
}

export function archiveName(share: Share): string {
  return `${cleanName(share.label) || "sendit-files"}.zip`;
}

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-").trim().slice(0, 200) || "Shared files";
}

function cleanPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[\u0000-\u001f]/g, ""))
    .join("/") || "file";
}
