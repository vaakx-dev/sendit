import { createReadStream } from "node:fs";
import type { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { SECURITY_HEADERS } from "./http.js";

const WEB_DIRECTORY = new URL("../web/", import.meta.url);

const CONTENT_TYPES = {
  "sender.html": "text/html; charset=utf-8",
  "receiver.html": "text/html; charset=utf-8",
  "sender.js": "text/javascript; charset=utf-8",
  "receiver.js": "text/javascript; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
};

export type WebFile = keyof typeof CONTENT_TYPES;

const PUBLIC_ASSETS = new Set<string>(["sender.js", "receiver.js", "styles.css"] satisfies WebFile[]);

export function isPublicAsset(name: string): name is WebFile {
  return PUBLIC_ASSETS.has(name);
}

export async function sendWebFile(response: ServerResponse, file: WebFile): Promise<void> {
  response.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": CONTENT_TYPES[file] });
  await pipeline(createReadStream(new URL(file, WEB_DIRECTORY)), response);
}
