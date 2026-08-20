import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSenderMessage,
  parseServerMessage,
  parseShareDetails,
  serializeSenderMessage,
  serializeServerMessage,
  type ServerToSenderMessage,
} from "./protocol.js";

const item = {
  id: "file-1",
  name: "notes.txt",
  relativePath: "project/notes.txt",
  size: 5,
  type: "text/plain",
};

test("parses sender messages into typed values", () => {
  assert.deepEqual(
    parseSenderMessage(serializeSenderMessage({ type: "publish", label: "Project", items: [item] })),
    { type: "publish", label: "Project", items: [item] },
  );
  assert.deepEqual(
    parseSenderMessage(serializeSenderMessage({ type: "transfer_begin", transferId: "transfer-1", size: 5 })),
    { type: "transfer_begin", transferId: "transfer-1", size: 5 },
  );
  assert.equal(parseSenderMessage(JSON.stringify({ type: "transfer_end" })), null);
});

test("parses every server message variant", () => {
  const messages: ServerToSenderMessage[] = [
    { type: "ready" },
    { type: "published", url: "https://sendit.example/s/token" },
    { type: "transfer_request", transferId: "transfer-1", itemId: "file-1" },
    { type: "chunk_ack", transferId: "transfer-1" },
    { type: "transfer_cancel", transferId: "transfer-1", message: "cancelled" },
    { type: "transfer_complete", transferId: "transfer-1" },
    { type: "error", message: "failed" },
  ];

  for (const message of messages) {
    assert.deepEqual(parseServerMessage(serializeServerMessage(message)), message);
  }
  assert.equal(parseServerMessage(JSON.stringify({ type: "published" })), null);
  assert.equal(parseServerMessage("not json"), null);
});

test("parses receiver share metadata at the HTTP boundary", () => {
  const details = {
    label: "Project",
    createdAt: "2026-08-16T00:00:00.000Z",
    senderOnline: true,
    totalSize: 5,
    items: [item],
  };

  assert.deepEqual(parseShareDetails(details), details);
  assert.equal(parseShareDetails({ ...details, senderOnline: "yes" }), null);
  assert.equal(parseShareDetails({ ...details, items: [{ ...item, size: -1 }] }), null);
});
