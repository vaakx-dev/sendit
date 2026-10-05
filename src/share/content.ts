import { createReadStream } from "node:fs";
import type { OutgoingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import type { Share, SharedFile } from "./collect.js";

export function content_headers(share: Share): OutgoingHttpHeaders {
  return {
    "Content-Disposition": attachment(share.name),
    "Content-Type": share.single ? "application/octet-stream" : "application/zip",
    ...(share.single && { "Content-Length": share.single.size }),
  };
}

export function open_content(share: Share): Readable {
  return share.single ? createReadStream(share.single.path) : zip(share.files);
}

function zip(files: SharedFile[]): Readable {
  const archive = new ZipArchive({ store: true });
  for (const file of files) archive.file(file.path, { name: file.name });
  archive.once("close", () => archive.abort());
  archive.finalize().catch(() => {});
  return archive;
}

function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
