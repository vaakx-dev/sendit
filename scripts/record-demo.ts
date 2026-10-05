import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = resolve(import.meta.dirname, "..");
const WORK = join(ROOT, "work", "demo");
const FRAMES = join(WORK, "frames");
const FILES = join(WORK, "files");
const DEBUG_PORT = 9333;

const DEMO_FILES: Record<string, string> = {
  "trip-itinerary.md": ["# Lisbon, 4 days", "", ...Array.from({ length: 60 }, (_, index) => `- Stop ${index + 1}: museum, miradouro, dinner.`)].join("\n"),
  "budget-2026.csv": ["category,monthly,yearly", ...Array.from({ length: 40 }, (_, index) => `line-${index + 1},${(index + 3) * 37},${(index + 3) * 444}`)].join("\n"),
};

interface DevToolsReply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

class DevTools {
  private nextId = 1;
  private readonly pending = new Map<number, PromiseWithResolvers<Record<string, unknown>>>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.receive(JSON.parse(data.toString()) as DevToolsReply));
  }

  static async connect(port: number): Promise<DevTools> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(
        (response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>,
        () => null,
      );
      if (version) {
        const socket = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
        await once(socket, "open");
        return new DevTools(socket);
      }
      await sleep(250);
    }
    throw new Error("Could not connect to Chrome DevTools.");
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    const reply = Promise.withResolvers<Record<string, unknown>>();
    this.pending.set(id, reply);
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return reply.promise as Promise<T>;
  }

  async openTab(url: string): Promise<Tab> {
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    await this.send("Page.navigate", { url }, sessionId);
    return new Tab(this, sessionId);
  }

  close(): void {
    this.socket.close();
  }

  private receive(reply: DevToolsReply): void {
    const pending = reply.id === undefined ? undefined : this.pending.get(reply.id);
    if (!pending || reply.id === undefined) return;
    this.pending.delete(reply.id);
    if (reply.error) pending.reject(new Error(reply.error.message));
    else pending.resolve(reply.result ?? {});
  }
}

class Tab {
  constructor(
    private readonly devTools: DevTools,
    private readonly sessionId: string,
  ) {}

  async evaluate(expression: string): Promise<unknown> {
    const { result } = await this.devTools.send<{ result: { value: unknown } }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    return result.value;
  }

  async waitFor(expression: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async setFiles(selector: string, files: string[]): Promise<void> {
    const { root } = await this.devTools.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 }, this.sessionId);
    const { nodeId } = await this.devTools.send<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector }, this.sessionId);
    await this.devTools.send("DOM.setFileInputFiles", { nodeId, files }, this.sessionId);
  }

  async capture(count = 1, gapMs = 650): Promise<void> {
    await this.devTools.send("Page.bringToFront", {}, this.sessionId);
    for (let index = 0; index < count; index += 1) {
      const { data } = await this.devTools.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 72 }, this.sessionId);
      writeFileSync(join(FRAMES, `frame-${String(++frameNumber).padStart(3, "0")}.jpg`), Buffer.from(data, "base64"));
      if (index < count - 1) await sleep(gapMs);
    }
  }
}

let frameNumber = 0;

if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
rmSync(WORK, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(FILES, { recursive: true });
for (const [name, content] of Object.entries(DEMO_FILES)) writeFileSync(join(FILES, name), content);

const sendit = spawn(process.execPath, [join(ROOT, "dist", "cli.js"), "--local", "--no-open"], { stdio: ["ignore", "ignore", "pipe"] });
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${join(WORK, "profile")}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--window-size=960,620",
], { stdio: "ignore" });
process.on("exit", () => {
  chrome.kill();
  sendit.kill();
});

const controlUrl = await readControlUrl();
const devTools = await DevTools.connect(DEBUG_PORT);
await devTools.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: join(WORK, "downloads") });

const sender = await devTools.openTab(controlUrl);
await sender.waitFor(`document.querySelector(".drop-zone") !== null && document.body.textContent.includes("Ready")`);
await sleep(600);
await sender.capture(3);

await sender.setFiles("input[type=file]", Object.keys(DEMO_FILES).map((name) => join(FILES, name)));
await sender.waitFor(`document.body.textContent.includes("Create sharing link")`);
await sleep(400);
await sender.capture(3);

await sender.evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Create sharing link"))?.click()`);
await sender.waitFor(`(document.querySelector("input[aria-label='Sharing link']")?.value ?? "").startsWith("http")`);
await sleep(700);
await sender.capture(3);
const shareUrl = String(await sender.evaluate(`document.querySelector("input[aria-label='Sharing link']").value`));

const receiver = await devTools.openTab(shareUrl);
await receiver.waitFor(`document.body.textContent.includes("Sender online") && document.body.textContent.includes("Download ZIP")`);
await sleep(500);
await receiver.capture(4);

await receiver.evaluate(`[...document.querySelectorAll("a")].find((link) => link.textContent.includes("Download ZIP"))?.click()`);
await sleep(900);
await receiver.capture(2);

await sender.waitFor(`document.body.textContent.includes("Transfer complete")`);
await sleep(400);
await sender.capture(4);

console.log(`Captured ${frameNumber} frames in ${FRAMES}`);
devTools.close();
process.exit(0);

async function readControlUrl(): Promise<string> {
  for await (const line of createInterface({ input: sendit.stderr })) {
    const url = /Control panel: (\S+)/.exec(line)?.[1];
    if (url) return url;
  }
  throw new Error("SendIt exited before printing the control panel URL.");
}
