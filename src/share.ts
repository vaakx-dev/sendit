import { randomBytes } from "node:crypto";
import type { ShareDetails, SharedItem } from "./shared/protocol.js";

export interface Share {
  readonly token: string;
  readonly label: string;
  readonly items: readonly SharedItem[];
  readonly createdAt: Date;
}

const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f<>:"/\\|?*]/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f]/g;

export function createShare(label: string, items: readonly SharedItem[]): Share {
  return {
    token: randomBytes(24).toString("base64url"),
    label: cleanName(label),
    items: items.map(({ id, relativePath, size }) => ({ id, relativePath: cleanPath(relativePath), size })),
    createdAt: new Date(),
  };
}

export function describeShare(share: Share, senderOnline: boolean): ShareDetails {
  return {
    label: share.label,
    createdAt: share.createdAt.toISOString(),
    senderOnline,
    totalSize: totalSize(share.items),
    items: [...share.items],
  };
}

export function totalSize(items: readonly SharedItem[]): number {
  return items.reduce((total, item) => total + item.size, 0);
}

export function fileName(item: SharedItem): string {
  return item.relativePath.slice(item.relativePath.lastIndexOf("/") + 1);
}

function cleanName(value: string): string {
  return value.replace(UNSAFE_NAME_CHARACTERS, "-").trim().slice(0, 200) || "Shared files";
}

function cleanPath(value: string): string {
  const segments = value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => segment.replace(CONTROL_CHARACTERS, ""));
  return segments.join("/") || "file";
}
