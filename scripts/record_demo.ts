import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";

// Use the compiled server: it serves the bundled web assets from dist/src/web/.
// (Run `npm run build` first if dist is stale.)
interface SenditServer {
  port: number;
  admin_key: string;
  admin_url: string;
  set_public_url(url: string): void;
  close(): Promise<void>;
}
const { start_sendit_server } = await import("../dist/src/server.js") as {
  start_sendit_server(options?: { port?: number; public_url?: string }): Promise<SenditServer>;
};

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = path.resolve(import.meta.dirname, "..");
const WORK = path.join(ROOT, "work", "demo");
const FRAMES = path.join(WORK, "frames");
const FILES_DIR = path.join(WORK, "files");
const DOWNLOADS = path.join(WORK, "downloads");
const DEBUG_PORT = 9333;

const DEMO_FILES: Record<string, string> = {
  "trip-itinerary.md": ["# Lisbon — 4 days", "", ...Array.from({ length: 60 }, (_, i) => `- Day plan item ${i + 1}: museum, miradouro, dinner spot.`).join("\n")].join("\n"),
  "budget-2026.csv": ["category,monthly,yearly", ...Array.from({ length: 40 }, (_, i) => `line-${i + 1},${(i + 3) * 37},${(i + 3) * 444}`).join("\n")].join("\n"),
};

interface CdpResponse { id: number; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string }

class Cdp {
  private socket!: WebSocket;
  private next_id = 1;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

  async connect(port: number): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        const info = await response.json() as { webSocketDebuggerUrl: string };
        this.socket = new WebSocket(info.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
        await new Promise<void>((resolve, reject) => { this.socket.once("open", resolve); this.socket.once("error", reject); });
        this.socket.on("message", (data) => {
          const message = JSON.parse(data.toString()) as CdpResponse;
          if (message.id === undefined) return;
          const entry = this.pending.get(message.id);
          if (!entry) return;
          this.pending.delete(message.id);
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result ?? {});
        });
        return;
      } catch {
        await sleep(250);
      }
    }
    throw new Error("Could not connect to Chrome DevTools.");
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.next_id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  async open_tab(url: string): Promise<string> {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    await this.send("Page.navigate", { url }, sessionId);
    return sessionId;
  }

  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    const { result } = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId) as { result: { value: unknown } };
    return result.value;
  }

  async wait_for(sessionId: string, expression: string, timeout_ms = 8000): Promise<unknown> {
    const deadline = Date.now() + timeout_ms;
    while (Date.now() < deadline) {
      const value = await this.evaluate(sessionId, expression);
      if (value) return value;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async capture(sessionId: string, file: string): Promise<void> {
    const { data } = await this.send("Page.captureScreenshot", { format: "jpeg", quality: 72 }, sessionId) as { data: string };
    await writeFile(file, Buffer.from(data, "base64"));
  }

  close(): void { this.socket?.close(); }
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

let frame_number = 0;
async function shot(cdp: Cdp, session: string, count = 1, gap_ms = 650): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    frame_number += 1;
    await cdp.capture(session, path.join(FRAMES, `frame-${String(frame_number).padStart(3, "0")}.jpg`));
    if (i < count - 1) await sleep(gap_ms);
  }
}

async function main(): Promise<void> {
  await rm(WORK, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });
  await mkdir(FILES_DIR, { recursive: true });
  await mkdir(DOWNLOADS, { recursive: true });
  for (const [name, content] of Object.entries(DEMO_FILES)) {
    await writeFile(path.join(FILES_DIR, name), content);
  }

  const server: SenditServer = await start_sendit_server({});
  server.set_public_url(`http://127.0.0.1:${server.port}`);
  console.log(`server on ${server.port}`);

  const chrome: ChildProcess = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${path.join(WORK, "profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--window-size=960,620",
  ], { stdio: "ignore" });

  const cdp = new Cdp();
  try {
    await cdp.connect(DEBUG_PORT);
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });

    // Scene 1 — sender drop zone
    const sender = await cdp.open_tab(server.admin_url);
    await cdp.wait_for(sender, `document.querySelector(".drop-zone") !== null`);
    await cdp.wait_for(sender, `[...document.querySelectorAll("header,nav,div")].some(n => n.textContent?.trim() === "Ready") || document.body.textContent.includes("Ready")`);
    await sleep(600);
    await shot(cdp, sender, 3);

    // Scene 2 — pick files
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 }, sender) as { root: { nodeId: number } };
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" }, sender) as { nodeId: number };
    await cdp.send("DOM.setFileInputFiles", {
      nodeId,
      files: Object.keys(DEMO_FILES).map((name) => path.join(FILES_DIR, name)),
    }, sender);
    await cdp.wait_for(sender, `document.body.textContent.includes("Ready to share")`);
    await sleep(400);
    await shot(cdp, sender, 3);

    // Scene 3 — create the link
    await cdp.evaluate(sender, `[...document.querySelectorAll("button")].find(b => b.textContent.includes("Create sharing link"))?.click()`);
    await cdp.wait_for(sender, `(document.querySelector("input[aria-label='Sharing link']")?.value ?? "").startsWith("http")`);
    await sleep(700);
    await shot(cdp, sender, 3);
    const share_url = String(await cdp.evaluate(sender, `document.querySelector("input[aria-label='Sharing link']")?.value`));
    console.log(`share url: ${share_url}`);

    // Scene 4 — receiver view
    const receiver = await cdp.open_tab(share_url);
    await cdp.wait_for(receiver, `document.body.textContent.includes("Sender online") && document.body.textContent.includes("Download everything as ZIP")`);
    await sleep(500);
    await shot(cdp, receiver, 4);

    // Scene 5 — receiver downloads the ZIP
    await cdp.evaluate(receiver, `[...document.querySelectorAll("a")].find(a => a.textContent.includes("Download everything as ZIP"))?.click()`);
    await sleep(900);
    await shot(cdp, receiver, 2);

    // Scene 6 — sender sees the completed transfer
    await cdp.wait_for(sender, `document.body.textContent.includes("Transfer complete")`);
    await sleep(400);
    await shot(cdp, sender, 3);
    frame_number += 1; // hold on the final frame a little longer (duplicated in GIF step)
    await cdp.capture(sender, path.join(FRAMES, `frame-${String(frame_number).padStart(3, "0")}.jpg`));

    console.log(`captured ${frame_number} frames`);
  } finally {
    cdp.close();
    chrome.kill();
    // Do not await server.close(): browser keep-alive sockets can block it.
    await Promise.race([server.close(), sleep(2000)]);
    process.exit(0);
  }
}

if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
await main();
