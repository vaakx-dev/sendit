import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { describeShare, type Share } from "../share.js";
import type { FileSource } from "../sources/file-source.js";
import { isPublicAsset, sendWebFile } from "./assets.js";
import { Downloads, type Download, type DownloadContent } from "./downloads.js";
import { sendJson, sendText } from "./http.js";

export interface ControlChannel {
  readonly key: string;
  accept(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export interface ServerOptions {
  readonly port: number;
  readonly source: FileSource;
  readonly control?: ControlChannel;
  readonly onDownload: (download: Download) => void;
}

export interface SenditServer extends AsyncDisposable {
  readonly origin: string;
  publish(share: Share): void;
}

export async function startServer({ port, source, control, onDownload }: ServerOptions): Promise<SenditServer> {
  const downloads = new Downloads(source, onDownload);
  let share: Share | null = null;

  const server = createServer((request, response) => {
    route(request, response).catch((error: Error) => {
      if (response.headersSent) response.destroy(error);
      else sendText(response, 500, "Unexpected server error.");
    });
  });
  server.on("upgrade", (request, socket, head) => {
    const url = requestUrl(request);
    if (control && url.pathname === "/ws/sender" && hasControlKey(url)) control.accept(request, socket, head);
    else socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") return sendText(response, 405, "Method not allowed.");
    const url = requestUrl(request);
    const [scope = "", name = "", action = "", id = ""] = url.pathname.slice(1).split("/").map(decodeURIComponent);

    switch (scope) {
      case "":
        return hasControlKey(url) ? sendWebFile(response, "sender.html") : sendText(response, 404, "Not found.");
      case "assets":
        return isPublicAsset(name) ? sendWebFile(response, name) : sendText(response, 404, "Not found.");
      case "health":
        return sendJson(response, 200, { status: "ok" });
      case "s":
        return routeShare(request, response, name, action, id);
      default:
        return sendText(response, 404, "Not found.");
    }
  }

  async function routeShare(request: IncomingMessage, response: ServerResponse, token: string, action: string, id: string): Promise<void> {
    const current = share?.token === token ? share : null;
    if (!current) return sendText(response, 404, "This share is no longer available.");

    switch (action) {
      case "":
        return sendWebFile(response, "receiver.html");
      case "details":
        return sendJson(response, 200, describeShare(current, source.status !== "offline"));
      case "download":
        return downloads.serve(request, response, contentOf(current));
      case "files": {
        const item = current.items.find((candidate) => candidate.id === id);
        return item ? downloads.serve(request, response, { kind: "file", item }) : sendText(response, 404, "File not found.");
      }
      default:
        return sendText(response, 404, "Not found.");
    }
  }

  function hasControlKey(url: URL): boolean {
    return control !== undefined && url.searchParams.get("key") === control.key;
  }

  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    publish(next: Share) {
      share = next;
    },
    async [Symbol.asyncDispose]() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

function contentOf(share: Share): DownloadContent {
  const [only, ...others] = share.items;
  if (only && others.length === 0) return { kind: "file", item: only };
  return { kind: "archive", name: `${share.label}.zip`, items: share.items };
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://localhost");
}
