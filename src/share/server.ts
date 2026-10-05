import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pipeline } from "node:stream/promises";
import type { Share } from "./collect.js";
import { content_headers, open_content } from "./content.js";

export interface Download {
  id: number;
  finished: Promise<Error | null>;
}

export interface ShareServer extends AsyncDisposable {
  origin: string;
  path: string;
}

const PRIVATE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function serve(share: Share, on_download: (download: Download) => void): Promise<ShareServer> {
  const path = `/${randomBytes(24).toString("base64url")}`;
  const headers = { ...PRIVATE_HEADERS, ...content_headers(share) };
  let downloads = 0;

  const server = createServer((request, response) => {
    if (request_path(request) !== path) return reply(response, 404, "Not found.");
    if (request.method === "HEAD") return response.writeHead(200, headers).end();
    if (request.method !== "GET") return reply(response, 405, "Method not allowed.");

    response.writeHead(200, headers);
    on_download({ id: ++downloads, finished: send(share, response) });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    path,
    async [Symbol.asyncDispose]() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

function send(share: Share, response: ServerResponse): Promise<Error | null> {
  return pipeline(open_content(share), response).then(
    () => null,
    (error: NodeJS.ErrnoException) =>
      error.code === "ERR_STREAM_PREMATURE_CLOSE" ? new Error("the recipient disconnected") : error,
  );
}

function request_path(request: IncomingMessage): string {
  return request.url?.split("?")[0] ?? "";
}

function reply(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end(`${message}\n`);
}
