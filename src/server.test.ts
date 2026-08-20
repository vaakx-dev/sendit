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
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        waiter?.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  next<Type extends ServerToSenderMessage["type"]>(type: Type): Promise<Extract<ServerToSenderMessage, { type: Type }>> {
    const messageIndex = this.messages.findIndex((message) => message.type === type);
    if (messageIndex >= 0) {
      const [message] = this.messages.splice(messageIndex, 1);
      return Promise.resolve(message as Extract<ServerToSenderMessage, { type: Type }>);
    }
    return new Promise((resolve) => this.waiters.push({ type, resolve: resolve as (message: ServerToSenderMessage) => void }));
  }
}

test("protects the control page and streams a selected file", async (context) => {
  const server = await startSendItServer({ publicUrl: "https://sendit.example" });
  context.after(() => server.close());
  const local = `http://127.0.0.1:${server.port}`;

  assert.equal((await fetch(local)).status, 404);
  assert.equal((await fetch(server.adminUrl)).status, 200);

  const { socket, queue } = await connectSender(server.port, server.adminKey);
  context.after(() => socket.close());
  await queue.next("ready");

  const content = Buffer.from("hello from SendIt");
  socket.send(serializeSenderMessage({
    type: "publish",
    label: "Greeting",
    items: [{
      id: "greeting",
      name: "hello.txt",
      relativePath: "hello.txt",
      size: content.length,
      type: "text/plain",
    }],
  }));
  const published = await queue.next("published");
  const token = new URL(String(published.url)).pathname.split("/").at(-1);
  assert.ok(token);

  const metadataResponse = await fetch(`${local}/api/shares/${token}`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json() as { label: string; totalSize: number };
  assert.deepEqual(metadata, { ...metadata, label: "Greeting", totalSize: content.length });

  const responsePromise = fetch(`${local}/s/${token}/files/greeting`);
  const request = await queue.next("transfer_request");
  const transferId = String(request.transferId);
  socket.send(serializeSenderMessage({ type: "transfer_begin", transferId, size: content.length }));
  socket.send(content);
  await queue.next("chunk_ack");
  socket.send(serializeSenderMessage({ type: "transfer_end", transferId }));

  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition")?.includes("hello.txt"), true);
  assert.equal(await response.text(), content.toString());
  await queue.next("transfer_complete");
});

test("streams multiple selected files into a ZIP without staging", async (context) => {
  const server = await startSendItServer({ publicUrl: "https://sendit.example" });
  context.after(() => server.close());
  const local = `http://127.0.0.1:${server.port}`;
  const { socket, queue } = await connectSender(server.port, server.adminKey);
  context.after(() => socket.close());
  await queue.next("ready");

  const files = new Map([
    ["one", Buffer.from("first file")],
    ["two", Buffer.from("second file")],
  ]);
  socket.send(serializeSenderMessage({
    type: "publish",
    label: "Example folder",
    items: [
      { id: "one", name: "one.txt", relativePath: "Example/one.txt", size: files.get("one")?.length, type: "text/plain" },
      { id: "two", name: "two.txt", relativePath: "Example/two.txt", size: files.get("two")?.length, type: "text/plain" },
    ],
  }));
  const published = await queue.next("published");
  const token = new URL(String(published.url)).pathname.split("/").at(-1);

  const archivePromise = fetch(`${local}/s/${token}/archive`).then(async (response) => {
    assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  });

  for (let index = 0; index < files.size; index += 1) {
    const request = await queue.next("transfer_request");
    const transferId = String(request.transferId);
    const content = files.get(String(request.itemId));
    assert.ok(content);
    socket.send(serializeSenderMessage({ type: "transfer_begin", transferId, size: content.length }));
    socket.send(content);
    await queue.next("chunk_ack");
    socket.send(serializeSenderMessage({ type: "transfer_end", transferId }));
    await queue.next("transfer_complete");
  }

  const archive = await archivePromise;
  assert.equal(archive.subarray(0, 2).toString(), "PK");
  assert.equal(archive.includes(Buffer.from("Example/one.txt")), true);
  assert.equal(archive.includes(Buffer.from("Example/two.txt")), true);
  assert.equal(archive.includes(files.get("one") as Buffer), true);
  assert.equal(archive.includes(files.get("two") as Buffer), true);
});

async function connectSender(port: number, key: string): Promise<{ socket: WebSocket; queue: MessageQueue }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/sender?key=${encodeURIComponent(key)}`);
  const queue = new MessageQueue(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, queue };
}
