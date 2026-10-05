import type { Share } from "./share/collect.js";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function log(message: string): void {
  console.error(message);
}

export function describe_share(share: Share): string {
  const size = share.files.reduce((total, file) => total + file.size, 0);
  return `${share.name} (${count(share.files.length, "file")}, ${format_bytes(size)})`;
}

export function format_bytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export function format_seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}
