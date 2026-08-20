import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { parseServerMessage, serializeSenderMessage, type ServerToSenderMessage } from "./protocol.js";
import { startSendItServer } from "./server.js";

class MessageQueue {
  private messages: ServerToSenderMessage[] = [];
  private waiters: Array<{ type: ServerToSenderMessage["type"]; resolve: (message: ServerToSenderMessage) => void }> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = parseServerMessage(data.toString());
      if (!message) return;
      const index = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (index < 0) this.messages.push(message);
      else this.waiters.splice(index, 1)[0]?.resolve(message);
    });
  }

  next<Type extends ServerToSenderMessage["type"]>(type: Type): Promise<Extract<ServerToSenderMessage, { type: Type }>> {
    const index = this.messages.findIndex((message) => message.type === type);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0] as Extract<ServerToSenderMessage, { type: Type }>);
    return new Promise((resolve) => this.waiters.push({ type, resolve: resolve as (message: ServerToSenderMessage) => void }));
  }
}

const GiB = 1024 * 1024 * 1024;
const LARGE_FILE_SIZE = 2 * GiB + 1024 * 1024;
const LARGE_TREE_FILE_COUNT = 100_000;
const LARGE_TREE_FOLDER_COUNT = 100_000;

test("streams a file larger than 2 GiB without buffering it", { timeout: 10 * 60_000 }, async (context) => {
  const server = await startSendItServer({ publicUrl: "https://sendit.example" });
  context.after(() => server.close());
  const { socket, queue } = await connect(server.port, server.adminKey);
  context.after(() => socket.close());
  await queue.next("ready");

  socket.send(serializeSenderMessage({
    type: "publish",
    label: "multi-gigabyte-file",
    items: [{
      id: "large",
      name: "large.bin",
      relativePath: "large.bin",
      size: LARGE_FILE_SIZE,
      type: "application/octet-stream",
    }],
  }));
  const published = await queue.next("published");
  const token = new URL(String(published.url)).pathname.split("/").at(-1);
  const responsePromise = fetch(`http://127.0.0.1:${server.port}/s/${token}/files/large`);
  const request = await queue.next("transfer_request");
  const transferId = String(request.transferId);
  socket.send(serializeSenderMessage({ type: "transfer_begin", transferId, size: LARGE_FILE_SIZE }));

  const sendPromise = (async () => {
    const chunk = Buffer.alloc(256 * 1024, 0x5a);
    for (let sent = 0; sent < LARGE_FILE_SIZE; sent += chunk.length) {
      const remaining = LARGE_FILE_SIZE - sent;
      socket.send(remaining < chunk.length ? chunk.subarray(0, remaining) : chunk);
      await queue.next("chunk_ack");
    }
    socket.send(serializeSenderMessage({ type: "transfer_end", transferId }));
    await queue.next("transfer_complete");
  })();

  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get("content-length")), LARGE_FILE_SIZE);
  const reader = response.body?.getReader();
  assert.ok(reader);
  let received = 0;
  let firstByte = -1;
  let lastByte = -1;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (firstByte < 0) firstByte = result.value[0] ?? -1;
    lastByte = result.value.at(-1) ?? -1;
    received += result.value.byteLength;
  }
  await sendPromise;
  assert.equal(received, LARGE_FILE_SIZE);
  assert.equal(firstByte, 0x5a);
  assert.equal(lastByte, 0x5a);
});

test("publishes and downloads a ZIP with 100,000 files across 100,000 folders", { timeout: 10 * 60_000 }, async (context) => {
  const server = await startSendItServer({ publicUrl: "https://sendit.example" });
  context.after(() => server.close());
  const { socket, queue } = await connect(server.port, server.adminKey);
  context.after(() => socket.close());
  await queue.next("ready");

  const items = Array.from({ length: LARGE_TREE_FILE_COUNT }, (_, index) => ({
    id: `item-${index}`,
    name: `file-${index}.txt`,
    relativePath: `project/folder-${index % LARGE_TREE_FOLDER_COUNT}/file-${index}.txt`,
    size: 0,
    type: "text/plain",
  }));
  socket.send(serializeSenderMessage({ type: "publish", label: "large-project", items }));
  const published = await queue.next("published");
  const token = new URL(String(published.url)).pathname.split("/").at(-1);

  const metadataResponse = await fetch(`http://127.0.0.1:${server.port}/api/shares/${token}`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json() as { items: Array<{ relativePath: string }> };
  assert.equal(metadata.items.length, LARGE_TREE_FILE_COUNT);
  assert.equal(metadata.items[0]?.relativePath, "project/folder-0/file-0.txt");
  assert.equal(
    metadata.items.at(-1)?.relativePath,
    `project/folder-${(LARGE_TREE_FILE_COUNT - 1) % LARGE_TREE_FOLDER_COUNT}/file-${LARGE_TREE_FILE_COUNT - 1}.txt`,
  );

  const archivePromise = fetch(`http://127.0.0.1:${server.port}/s/${token}/archive`).then(async (response) => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    const reader = response.body?.getReader();
    assert.ok(reader);
    let received = 0;
    const signature: number[] = [];
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      for (const byte of result.value.subarray(0, Math.max(0, 4 - signature.length))) signature.push(byte);
      received += result.value.byteLength;
    }
    return { received, signature: Buffer.from(signature).toString("hex") };
  });

  for (let index = 0; index < LARGE_TREE_FILE_COUNT; index += 1) {
    const request = await queue.next("transfer_request");
    assert.equal(request.itemId, `item-${index}`);
    const transferId = String(request.transferId);
    socket.send(serializeSenderMessage({ type: "transfer_begin", transferId, size: 0 }));
    socket.send(serializeSenderMessage({ type: "transfer_end", transferId }));
    await queue.next("transfer_complete");
  }

  const archive = await archivePromise;
  assert.equal(archive.signature, "504b0304");
  assert.ok(archive.received > LARGE_TREE_FILE_COUNT * 100, `ZIP was unexpectedly small: ${archive.received} bytes`);
});

async function connect(port: number, key: string): Promise<{ socket: WebSocket; queue: MessageQueue }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/sender?key=${encodeURIComponent(key)}`);
  const queue = new MessageQueue(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, queue };
}
