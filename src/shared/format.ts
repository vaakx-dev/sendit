const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${value} B`;
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${BYTE_UNITS[unit]}`;
}

export function countOf(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}
