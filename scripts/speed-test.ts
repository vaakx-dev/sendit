import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { WebSocket } from "ws";
import { serializeSenderMessage } from "../src/protocol.js";
import { startSendItServer } from "../src/server.js";

interface Message {
  type: string;
  [key: string]: unknown;
}

class Messages {
  private queued: Message[] = [];
  private waiting = new Map<string, Array<(message: Message) => void>>();

  constructor(socket: WebSocket) {
    socket.on("message", (data, binary) => {
      if (binary) return;
      const message = JSON.parse(data.toString()) as Message;
      const waiter = this.waiting.get(message.type)?.shift();
      if (waiter) waiter(message);
      else this.queued.push(message);
    });
  }

  next(type: string): Promise<Message> {
    const index = this.queued.findIndex((message) => message.type === type);
    if (index >= 0) return Promise.resolve(this.queued.splice(index, 1)[0] as Message);
    return new Promise((resolve) => {
      const waiters = this.waiting.get(type) ?? [];
      waiters.push(resolve);
      this.waiting.set(type, waiters);
    });
  }
}

const MiB = 1024 * 1024;
const requestedMib = Number(process.env.SENDIT_SPEED_MIB ?? 1024);
if (!Number.isSafeInteger(requestedMib) || requestedMib < 1) {
  throw new Error("SENDIT_SPEED_MIB must be a positive integer.");
}
const size = requestedMib * MiB;
const chunk = Buffer.alloc(256 * 1024, 0x5a);

const server = await startSendItServer({ publicUrl: "https://sendit.example" });
const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws/sender?key=${encodeURIComponent(server.adminKey)}`);
const messages = new Messages(socket);

try {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  await messages.next("ready");

  socket.send(serializeSenderMessage({
    type: "publish",
    label: "speed-test",
    items: [{ id: "speed", name: "speed.bin", relativePath: "speed.bin", size, type: "application/octet-stream" }],
  }));
  const published = await messages.next("published");
  const token = new URL(String(published.url)).pathname.split("/").at(-1);

  const downloadStarted = performance.now();
  const responsePromise = fetch(`http://127.0.0.1:${server.port}/s/${token}/files/speed`);
  const request = await messages.next("transfer_request");
  const transferId = String(request.transferId);
  socket.send(serializeSenderMessage({ type: "transfer_begin", transferId, size }));

  const uploadStarted = performance.now();
  const upload = (async () => {
    for (let sent = 0; sent < size; sent += chunk.length) {
      const remaining = size - sent;
      socket.send(remaining < chunk.length ? chunk.subarray(0, remaining) : chunk);
      await messages.next("chunk_ack");
    }
    socket.send(serializeSenderMessage({ type: "transfer_end", transferId }));
    await messages.next("transfer_complete");
    return performance.now() - uploadStarted;
  })();

  const response = await responsePromise;
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  let received = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    received += result.value.byteLength;
  }
  const downloadMs = performance.now() - downloadStarted;
  const uploadMs = await upload;
  assert.equal(received, size);

  console.log(`Local SendIt speed test (${requestedMib.toLocaleString()} MiB)`);
  console.log(`Upload   browser -> SendIt:    ${speed(size, uploadMs)} MiB/s`);
  console.log(`Download SendIt -> recipient:  ${speed(size, downloadMs)} MiB/s`);
  console.log("This measures the local streaming pipeline, not Cloudflare or internet speed.");
} finally {
  socket.close();
  await server.close();
}

function speed(bytes: number, milliseconds: number): string {
  return (bytes / MiB / (milliseconds / 1000)).toFixed(1);
}
