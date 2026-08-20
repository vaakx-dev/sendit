import { createReadStream, existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { HEADERS } from "./http.js";

// Compiled layout: dist/src/view.js serves dist/src/web/.
// Source layout (tsx dev/test): src/view.ts serves src/client/.
const COMPILED_WEB = fileURLToPath(new URL("./web/", import.meta.url));
const SOURCE_WEB = fileURLToPath(new URL("./client/", import.meta.url));
const WEB_DIRECTORY = existsSync(COMPILED_WEB) ? COMPILED_WEB : SOURCE_WEB;
const ASSETS: Record<string, string> = {
  "sender.js": "text/javascript; charset=utf-8",
  "receiver.js": "text/javascript; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
};

export async function sendPage(response: ServerResponse, name: "sender.html" | "receiver.html"): Promise<void> {
  await sendFile(response, name, "text/html; charset=utf-8");
}

export async function sendAsset(response: ServerResponse, name: string): Promise<boolean> {
  const contentType = ASSETS[name];
  if (!contentType) return false;
  await sendFile(response, name, contentType);
  return true;
}

async function sendFile(response: ServerResponse, name: string, contentType: string): Promise<void> {
  const path = `${WEB_DIRECTORY}/${name}`;
  if (!existsSync(path)) throw new Error(`Missing web asset: ${name}`);
  response.writeHead(200, { ...HEADERS, "Content-Type": contentType });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(response);
  });
}
