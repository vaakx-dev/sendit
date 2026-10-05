import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { fileName, totalSize } from "../share.js";
import type { SharedItem } from "../shared/protocol.js";
import { unavailableReason, type FileSource } from "../sources/file-source.js";
import { attachment, SECURITY_HEADERS, sendText } from "./http.js";

export type DownloadContent =
  | { readonly kind: "file"; readonly item: SharedItem }
  | { readonly kind: "archive"; readonly name: string; readonly items: readonly SharedItem[] };

export interface Download {
  readonly id: number;
  readonly name: string;
  readonly size: number;
  readonly finished: Promise<Error | null>;
}

export class Downloads {
  private count = 0;

  constructor(
    private readonly source: FileSource,
    private readonly onDownload: (download: Download) => void,
  ) {}

  serve(request: IncomingMessage, response: ServerResponse, content: DownloadContent): void {
    const reason = unavailableReason(this.source.status);
    if (reason) return sendText(response, 409, reason);

    response.writeHead(200, headersFor(content));
    if (request.method === "HEAD") return void response.end();

    const recipient = new AbortController();
    response.once("close", () => recipient.abort(new Error("The recipient cancelled the download.")));
    const body = content.kind === "file"
      ? this.source.open(content.item, recipient.signal)
      : zip(content.items, this.source, recipient.signal);

    this.onDownload({
      id: ++this.count,
      name: content.kind === "file" ? fileName(content.item) : content.name,
      size: content.kind === "file" ? content.item.size : totalSize(content.items),
      finished: pipeline(body, response).then(() => null, describeFailure),
    });
  }
}

function headersFor(content: DownloadContent): OutgoingHttpHeaders {
  if (content.kind === "archive") {
    return { ...SECURITY_HEADERS, "Content-Type": "application/zip", "Content-Disposition": attachment(content.name) };
  }
  return {
    ...SECURITY_HEADERS,
    "Content-Type": "application/octet-stream",
    "Content-Length": content.item.size,
    "Content-Disposition": attachment(fileName(content.item)),
  };
}

function zip(items: readonly SharedItem[], source: FileSource, signal: AbortSignal): Readable {
  const archive = new ZipArchive({ zlib: { level: 0 } });
  signal.addEventListener("abort", () => archive.abort(), { once: true });
  appendInOrder(archive, items, source, signal).catch((error: Error) => archive.destroy(error));
  return archive;
}

async function appendInOrder(archive: ZipArchive, items: readonly SharedItem[], source: FileSource, signal: AbortSignal): Promise<void> {
  for (const item of items) {
    const entry = source.open(item, signal);
    archive.append(entry, { name: item.relativePath });
    await finished(entry);
  }
  await archive.finalize();
}

function describeFailure(error: NodeJS.ErrnoException): Error {
  const recipientLeft = error.code === "ERR_STREAM_PREMATURE_CLOSE" || error.name === "AbortError";
  return recipientLeft ? new Error("The recipient cancelled the download.") : error;
}
