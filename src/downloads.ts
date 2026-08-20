import type { ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import type { AppEvent } from "./events.js";
import { contentDisposition, HEADERS, sendText } from "./http.js";
import type { SharedItem } from "./protocol.js";
import { archiveName, type Share } from "./share.js";
import { SenderConnection } from "./transfer.js";

export class Downloads {
  constructor(
    private readonly sender: SenderConnection,
    private readonly notify: (event: AppEvent) => void,
  ) {}

  async file(response: ServerResponse, item: SharedItem): Promise<void> {
    if (!this.available(response)) return;
    response.writeHead(200, {
      ...HEADERS,
      "Content-Type": item.type || "application/octet-stream",
      "Content-Length": item.size,
      "Content-Disposition": contentDisposition(item.name),
    });
    const cancel = () => this.sender.cancel(new Error("The recipient cancelled the download."));
    response.once("close", cancel);
    try {
      await this.stream(item, response);
      response.off("close", cancel);
      response.end();
    } catch (error) {
      response.off("close", cancel);
      this.fail(response, item.name, error);
    }
  }

  async archive(response: ServerResponse, share: Share): Promise<void> {
    if (!this.available(response)) return;
    const name = archiveName(share);
    response.writeHead(200, {
      ...HEADERS,
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(name),
    });

    const archive = new ZipArchive({ zlib: { level: 0 } });
    let finished = false;
    response.once("close", () => {
      if (finished) return;
      this.sender.cancel(new Error("The recipient cancelled the download."));
      archive.abort();
    });
    archive.on("error", (error: Error) => response.destroy(error));
    archive.pipe(response);

    try {
      for (const item of share.items) {
        const stream = new PassThrough();
        archive.append(stream, { name: item.relativePath });
        await this.stream(item, stream);
        stream.end();
      }
      await archive.finalize();
      finished = true;
    } catch (error) {
      archive.abort();
      this.fail(response, name, error);
    }
  }

  private available(response: ServerResponse): boolean {
    if (!this.sender.isConnected()) {
      sendText(response, 409, "The sender is offline.");
      return false;
    }
    if (this.sender.isBusy()) {
      sendText(response, 409, "Another download is already running.");
      return false;
    }
    return true;
  }

  private async stream(item: SharedItem, sink: PassThrough | ServerResponse): Promise<void> {
    this.notify({ type: "downloadStarted", name: item.relativePath, size: item.size });
    await this.sender.request(item, sink, (written, size) => {
      this.notify({ type: "downloadProgress", name: item.relativePath, written, size });
    });
    this.notify({ type: "downloadFinished", name: item.relativePath });
  }

  private fail(response: ServerResponse, name: string, error: unknown): void {
    const value = error instanceof Error ? error : new Error("Download failed.");
    this.notify({ type: "downloadFailed", name, message: value.message });
    response.destroy(value);
  }
}
