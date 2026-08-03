import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { start_sendit_server } from "./server.js";

interface JsonMessage {
  type: string;
  [key: string]: unknown;
}

class MessageQueue {
  private messages: JsonMessage[] = [];
  private waiters: Array<{ type: string; resolve: (message: JsonMessage) => void }> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data, is_binary) => {
      if (is_binary) return;
      const message = JSON.parse(data.toString()) as JsonMessage;
      const waiter_index = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (waiter_index >= 0) {
        const [waiter] = this.waiters.splice(waiter_index, 1);
        waiter?.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  next(type: string): Promise<JsonMessage> {
    const message_index = this.messages.findIndex((message) => message.type === type);
    if (message_index >= 0) {
      const [message] = this.messages.splice(message_index, 1);
      return Promise.resolve(message as JsonMessage);
    }
    return new Promise((resolve) => this.waiters.push({ type, resolve }));
  }
}

test("protects the control page and streams a selected file", async (context) => {
  const server = await start_sendit_server({ public_url: "https://sendit.example" });
  context.after(() => server.close());
  const local = `http://127.0.0.1:${server.port}`;

  assert.equal((await fetch(local)).status, 404);
  assert.equal((await fetch(server.admin_url)).status, 200);

  const { socket, queue } = await connect_sender(server.port, server.admin_key);
  context.after(() => socket.close());
  await queue.next("ready");

  const content = Buffer.from("hello from SendIt");
  socket.send(JSON.stringify({
    type: "publish",
    label: "Greeting",
    items: [{
      id: "greeting",
      name: "hello.txt",
      relative_path: "hello.txt",
      size: content.length,
      type: "text/plain",
    }],
  }));
  const published = await queue.next("published");
  const token = new URL(String(published.url)).pathname.split("/").at(-1);
  assert.ok(token);

  const metadata_response = await fetch(`${local}/api/shares/${token}`);
  assert.equal(metadata_response.status, 200);
  const metadata = await metadata_response.json() as { label: string; total_size: number };
  assert.deepEqual(metadata, { ...metadata, label: "Greeting", total_size: content.length });

  const response_promise = fetch(`${local}/s/${token}/files/greeting`);
  const request = await queue.next("transfer_request");
  const transfer_id = String(request.transfer_id);
  socket.send(JSON.stringify({ type: "transfer_begin", transfer_id, size: content.length }));
  socket.send(content);
  await queue.next("chunk_ack");
  socket.send(JSON.stringify({ type: "transfer_end", transfer_id }));

  const response = await response_promise;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition")?.includes("hello.txt"), true);
  assert.equal(await response.text(), content.toString());
  await queue.next("transfer_complete");
});

test("streams multiple selected files into a ZIP without staging", async (context) => {
  const server = await start_sendit_server({ public_url: "https://sendit.example" });
  context.after(() => server.close());
  const local = `http://127.0.0.1:${server.port}`;
  const { socket, queue } = await connect_sender(server.port, server.admin_key);
  context.after(() => socket.close());
  await queue.next("ready");

  const files = new Map([
    ["one", Buffer.from("first file")],
    ["two", Buffer.from("second file")],
  ]);
  socket.send(JSON.stringify({
    type: "publish",
    label: "Example folder",
    items: [
      { id: "one", name: "one.txt", relative_path: "Example/one.txt", size: files.get("one")?.length, type: "text/plain" },
      { id: "two", name: "two.txt", relative_path: "Example/two.txt", size: files.get("two")?.length, type: "text/plain" },
    ],
  }));
  const published = await queue.next("published");
  const token = new URL(String(published.url)).pathname.split("/").at(-1);

  const archive_promise = fetch(`${local}/s/${token}/archive`).then(async (response) => {
    assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  });

  for (let index = 0; index < files.size; index += 1) {
    const request = await queue.next("transfer_request");
    const transfer_id = String(request.transfer_id);
    const content = files.get(String(request.item_id));
    assert.ok(content);
    socket.send(JSON.stringify({ type: "transfer_begin", transfer_id, size: content.length }));
    socket.send(content);
    await queue.next("chunk_ack");
    socket.send(JSON.stringify({ type: "transfer_end", transfer_id }));
    await queue.next("transfer_complete");
  }

  const archive = await archive_promise;
  assert.equal(archive.subarray(0, 2).toString(), "PK");
  assert.equal(archive.includes(Buffer.from("Example/one.txt")), true);
  assert.equal(archive.includes(Buffer.from("Example/two.txt")), true);
  assert.equal(archive.includes(files.get("one") as Buffer), true);
  assert.equal(archive.includes(files.get("two") as Buffer), true);
});

async function connect_sender(port: number, key: string): Promise<{ socket: WebSocket; queue: MessageQueue }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/sender?key=${encodeURIComponent(key)}`);
  const queue = new MessageQueue(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, queue };
}
