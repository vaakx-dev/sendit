import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import {
  parse_server_message,
  type ServerToSenderMessage,
  type SharedItem,
} from "./protocol.js";
import { SenderConnection } from "./transfer.js";

class FakeSocket {
  readyState = 1;
  readonly messages: ServerToSenderMessage[] = [];

  send(data: string): void {
    const message = parse_server_message(data);
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
  relative_path: "file.txt",
  size: 1,
  type: "text/plain",
};

function transfer_request(socket: FakeSocket): Extract<ServerToSenderMessage, { type: "transfer_request" }> {
  const message = socket.messages.findLast((candidate) => candidate.type === "transfer_request");
  assert.ok(message && message.type === "transfer_request");
  return message;
}

function sink(write?: (callback: (error?: Error | null) => void) => void): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
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
  const request = transfer_request(socket);
  connection.handle_message({ type: "transfer_begin", transfer_id: request.transfer_id, size: 1 });
  connection.handle_chunk(Buffer.from("x"));
  await new Promise((resolve) => setImmediate(resolve));
  connection.handle_message({ type: "transfer_end", transfer_id: request.transfer_id });

  await completed;
  assert.equal(connection.is_busy(), false);
  assert.equal(socket.messages.at(-1)?.type, "transfer_complete");
});

test("clears transfer state after recipient cancellation", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink(), () => {});
  connection.cancel(new Error("recipient left"));

  await assert.rejects(completed, /recipient left/);
  assert.equal(connection.is_busy(), false);
  assert.equal(socket.messages.at(-1)?.type, "transfer_cancel");
});

test("clears transfer state when the sender socket closes", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink(), () => {});
  connection.disconnect_socket(socket);

  await assert.rejects(completed, /disconnected/);
  assert.equal(connection.is_busy(), false);
});

test("clears transfer state after a sink failure", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink((callback) => callback(new Error("sink failed"))), () => {});
  const request = transfer_request(socket);
  connection.handle_message({ type: "transfer_begin", transfer_id: request.transfer_id, size: 1 });
  connection.handle_chunk(Buffer.from("x"));

  await assert.rejects(completed, /sink failed/);
  assert.equal(connection.is_busy(), false);
});

test("clears transfer state when a sink write throws", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);
  const broken_sink = sink();
  broken_sink.write = () => { throw new Error("sink threw"); };

  const completed = connection.request(item, broken_sink, () => {});
  const request = transfer_request(socket);
  connection.handle_message({ type: "transfer_begin", transfer_id: request.transfer_id, size: 1 });
  connection.handle_chunk(Buffer.from("x"));

  await assert.rejects(completed, /sink threw/);
  assert.equal(connection.is_busy(), false);
});

test("keeps a pending sink error handled after cancellation", async () => {
  const connection = new SenderConnection();
  const socket = new FakeSocket();
  connection.connect(socket);
  let finish_write: ((error?: Error | null) => void) | null = null;

  const completed = connection.request(item, sink((callback) => { finish_write = callback; }), () => {});
  const request = transfer_request(socket);
  connection.handle_message({ type: "transfer_begin", transfer_id: request.transfer_id, size: 1 });
  connection.handle_chunk(Buffer.from("x"));
  connection.cancel(new Error("recipient left"));
  await assert.rejects(completed, /recipient left/);

  assert.ok(finish_write);
  finish_write(new Error("late sink failure"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connection.is_busy(), false);
});

test("times out a silent sender and frees the transfer slot", { timeout: 500 }, async () => {
  const connection = new SenderConnection({ idle_timeout_ms: 20 });
  const socket = new FakeSocket();
  connection.connect(socket);

  const completed = connection.request(item, sink(), () => {});

  await assert.rejects(completed, /stopped responding/);
  assert.equal(connection.is_busy(), false);
  assert.equal(socket.messages.at(-1)?.type, "transfer_cancel");
});
