import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import {
  parseServerMessage,
  type ServerToSenderMessage,
  type SharedItem,
} from "./protocol.js";
import { SenderConnection } from "./transfer.js";

class FakeSocket {
  readyState = 1;
  readonly messages: ServerToSenderMessage[] = [];

  send(data: string): void {
    const message = parseServerMessage(data);
    assert.ok(message);
    this.messages.push(message);
  }

  close(): void {
    this.readyState = 3;
  }
}

const item: SharedItem = {
  id: "file-1",
  name: "file.txt",
  relativePath: "file.txt",
  size: 1,
  type: "text/plain",
};

function transferRequest(socket: FakeSocket): Extract<ServerToSenderMessage, { type: "transfer_request" }> {
  const message = socket.messages.findLast((candidate) => candidate.type === "transfer_request");
  assert.ok(message && message.type === "transfer_request");
  return message;
}

function sink(write?: (callback: (error?: Error | null) => void) => void): Writable {
  return new Writable({
    write(chunk, encoding, callback) {
      if (write) write(callback);
      else callback();
    },
  });
}

test("clears transfer state after success", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink(), () => {});
  const request = transferRequest(socket);
  connection.handleMessage({ type: "transfer_begin", transferId: request.transferId, size: 1 });
  connection.handleChunk(Buffer.from("x"));
  await new Promise((resolve) => setImmediate(resolve));
  connection.handleMessage({ type: "transfer_end", transferId: request.transferId });

  await completed;
  assert.equal(connection.isBusy(), false);
  assert.equal(socket.messages.at(-1)?.type, "transfer_complete");
});

test("clears transfer state after recipient cancellation", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink(), () => {});
  connection.cancel(new Error("recipient left"));

  await assert.rejects(completed, /recipient left/);
  assert.equal(connection.isBusy(), false);
  assert.equal(socket.messages.at(-1)?.type, "transfer_cancel");
});

test("clears transfer state when the sender socket closes", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink(), () => {});
  connection.disconnectSocket(socket);

  await assert.rejects(completed, /disconnected/);
  assert.equal(connection.isBusy(), false);
});

test("clears transfer state after a sink failure", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink((callback) => callback(new Error("sink failed"))), () => {});
  const request = transferRequest(socket);
  connection.handleMessage({ type: "transfer_begin", transferId: request.transferId, size: 1 });
  connection.handleChunk(Buffer.from("x"));

  await assert.rejects(completed, /sink failed/);
  assert.equal(connection.isBusy(), false);
});

test("clears transfer state when a sink write throws", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);
  const brokenSink = sink();
  brokenSink.write = () => { throw new Error("sink threw"); };

  const completed = connection.request(item, brokenSink, () => {});
  const request = transferRequest(socket);
  connection.handleMessage({ type: "transfer_begin", transferId: request.transferId, size: 1 });
  connection.handleChunk(Buffer.from("x"));

  await assert.rejects(completed, /sink threw/);
  assert.equal(connection.isBusy(), false);
});

test("keeps a pending sink error handled after cancellation", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);
  let finishWrite: ((error?: Error | null) => void) | null = null;

  const completed = connection.request(item, sink((callback) => { finishWrite = callback; }), () => {});
  const request = transferRequest(socket);
  connection.handleMessage({ type: "transfer_begin", transferId: request.transferId, size: 1 });
  connection.handleChunk(Buffer.from("x"));
  connection.cancel(new Error("recipient left"));
  await assert.rejects(completed, /recipient left/);

  assert.ok(finishWrite);
  finishWrite(new Error("late sink failure"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connection.isBusy(), false);
});

test("times out a silent sender and frees the transfer slot", { timeout: 500 }, async () => {
  const connection = new SenderConnection({ idleTimeoutMs: 20 });
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink(), () => {});

  await assert.rejects(completed, /stopped responding/);
  assert.equal(connection.isBusy(), false);
  assert.equal(socket.messages.at(-1)?.type, "transfer_cancel");
});
