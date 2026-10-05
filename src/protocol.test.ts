import assert from "node:assert/strict";
import test from "node:test";
import {
  parse_sender_message,
  parse_server_message,
  parse_share_details,
  type ServerToSenderMessage,
} from "./protocol.js";

const item = {
  id: "file-1",
  name: "notes.txt",
  relative_path: "project/notes.txt",
  size: 5,
  type: "text/plain",
};

test("parses sender messages into typed values", () => {
  assert.deepEqual(
    parse_sender_message(JSON.stringify({ type: "publish", label: "Project", items: [item] })),
    { type: "publish", label: "Project", items: [item] },
  );
  assert.deepEqual(
    parse_sender_message(JSON.stringify({ type: "transfer_begin", transfer_id: "transfer-1", size: 5 })),
    { type: "transfer_begin", transfer_id: "transfer-1", size: 5 },
  );
  assert.equal(parse_sender_message(JSON.stringify({ type: "transfer_end" })), null);
});

test("parses every server message variant", () => {
  const messages: ServerToSenderMessage[] = [
    { type: "ready" },
    { type: "published", url: "https://sendit.example/s/token" },
    { type: "transfer_request", transfer_id: "transfer-1", item_id: "file-1" },
    { type: "chunk_ack", transfer_id: "transfer-1" },
    { type: "transfer_cancel", transfer_id: "transfer-1", message: "cancelled" },
    { type: "transfer_complete", transfer_id: "transfer-1" },
    { type: "error", message: "failed" },
  ];

  for (const message of messages) {
    assert.deepEqual(parse_server_message(JSON.stringify(message)), message);
  }
  assert.equal(parse_server_message(JSON.stringify({ type: "published" })), null);
  assert.equal(parse_server_message("not json"), null);
});

test("parses receiver share metadata at the HTTP boundary", () => {
  const details = {
    label: "Project",
    created_at: "2026-08-16T00:00:00.000Z",
    sender_online: true,
    total_size: 5,
    items: [item],
  };

  assert.deepEqual(parse_share_details(details), details);
  assert.equal(parse_share_details({ ...details, sender_online: "yes" }), null);
  assert.equal(parse_share_details({ ...details, items: [{ ...item, size: -1 }] }), null);
});
