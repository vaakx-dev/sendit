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

export async function send_page(response: ServerResponse, name: "sender.html" | "receiver.html"): Promise<void> {
  await send_file(response, name, "text/html; charset=utf-8");
}

export async function send_asset(response: ServerResponse, name: string): Promise<boolean> {
  const content_type = ASSETS[name];
  if (!content_type) return false;
  await send_file(response, name, content_type);
  return true;
}

async function send_file(response: ServerResponse, name: string, content_type: string): Promise<void> {
  const path = `${WEB_DIRECTORY}/${name}`;
  if (!existsSync(path)) throw new Error(`Missing web asset: ${name}`);
  response.writeHead(200, { ...HEADERS, "Content-Type": content_type });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(response);
  });
}
