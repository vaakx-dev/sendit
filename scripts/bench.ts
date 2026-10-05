import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../src/server/server.js";
import { createShare } from "../src/share.js";
import { formatBytes } from "../src/shared/format.js";
import type { ServerMessage } from "../src/shared/protocol.js";
import { BrowserSender } from "../src/sources/browser-sender.js";
import { selectFiles } from "../src/sources/disk-files.js";

const MIB = 1024 * 1024;
const LARGE_FILE_BYTES = Number(process.argv[2] ?? 1024) * MIB;
const SMALL_FILE_COUNT = 10_000;
const SMALL_FILE_BYTES = 16 * 1024;
const BROWSER_CHUNK = Buffer.alloc(256 * 1024, 0x5a);

const workspace = mkdtempSync(join(tmpdir(), "sendit-bench-"));
process.on("exit", () => rmSync(workspace, { recursive: true, force: true }));
const largeFile = createLargeFile(join(workspace, "large.bin"));
const smallFolder = createSmallFiles(join(workspace, "small"));

console.log("Local throughput, without the tunnel:");
await measure("command line, one large file", () => downloadFromDisk([largeFile]));
await measure(`command line, ${SMALL_FILE_COUNT.toLocaleString("en-US")} files as ZIP`, () => downloadFromDisk([smallFolder]));
await measure("browser protocol, one large file", downloadFromSimulatedBrowser);

async function measure(label: string, run: () => Promise<number>): Promise<void> {
  const started = performance.now();
  const bytes = await run();
  const seconds = (performance.now() - started) / 1000;
  const speed = `${(bytes / MIB / seconds).toFixed(0)} MiB/s`;
  console.log(`  ${label.padEnd(36)} ${formatBytes(bytes).padStart(9)} in ${seconds.toFixed(1).padStart(5)}s  ${speed.padStart(10)}`);
}

async function downloadFromDisk(paths: string[]): Promise<number> {
  const selection = selectFiles(paths);
  const share = createShare(selection.label, selection.items);
  await using server = await startServer({ port: 0, source: selection.source, onDownload: () => {} });
  server.publish(share);
  return await countBytes(`${server.origin}/s/${share.token}/download`);
}

async function downloadFromSimulatedBrowser(): Promise<number> {
  let link = "";
  using sender = new BrowserSender((label, items) => {
    const share = createShare(label, items);
    server.publish(share);
    link = `${server.origin}/s/${share.token}/download`;
    return link;
  });
  await using server = await startServer({ port: 0, source: sender, control: sender, onDownload: () => {} });

  const socket = new WebSocket(`${server.origin.replace("http", "ws")}/ws/sender?key=${sender.key}`);
  await once(socket, "open");
  const published = simulateBrowser(socket);
  socket.send(JSON.stringify({ type: "publish", label: "bench", items: [{ id: "large", relativePath: "large.bin", size: LARGE_FILE_BYTES }] }));
  await published;
  const bytes = await countBytes(link);
  socket.close();
  return bytes;
}

function simulateBrowser(socket: WebSocket): Promise<void> {
  let acknowledge = () => {};
  const published = Promise.withResolvers<void>();
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    if (message.type === "published") published.resolve();
    if (message.type === "chunkAck") acknowledge();
    if (message.type === "transferRequest") void streamFile(message.transferId);
  });

  async function streamFile(transferId: string): Promise<void> {
    socket.send(JSON.stringify({ type: "transferBegin", transferId, size: LARGE_FILE_BYTES }));
    for (let sent = 0; sent < LARGE_FILE_BYTES; sent += BROWSER_CHUNK.length) {
      const acknowledged = new Promise<void>((resolve) => (acknowledge = resolve));
      socket.send(BROWSER_CHUNK.subarray(0, Math.min(BROWSER_CHUNK.length, LARGE_FILE_BYTES - sent)));
      await acknowledged;
    }
    socket.send(JSON.stringify({ type: "transferEnd", transferId }));
  }

  return published.promise;
}

async function countBytes(url: string): Promise<number> {
  const response = await fetch(url);
  let bytes = 0;
  for await (const chunk of response.body ?? []) bytes += chunk.byteLength;
  return bytes;
}

function createLargeFile(path: string): string {
  writeFileSync(path, "");
  truncateSync(path, LARGE_FILE_BYTES);
  return path;
}

function createSmallFiles(folder: string): string {
  const content = Buffer.alloc(SMALL_FILE_BYTES, 1);
  mkdirSync(folder);
  for (let index = 0; index < SMALL_FILE_COUNT; index += 1) writeFileSync(join(folder, `${index}.bin`), content);
  return folder;
}
