import type { Readable } from "node:stream";
import type { SharedItem } from "../shared/protocol.js";

export type SourceStatus = "ready" | "busy" | "offline";

export interface FileSource {
  readonly status: SourceStatus;
  open(item: SharedItem, signal: AbortSignal): Readable;
}

export function unavailableReason(status: SourceStatus): string | null {
  switch (status) {
    case "ready":
      return null;
    case "busy":
      return "Another download is already running.";
    case "offline":
      return "The sender is offline.";
  }
}
