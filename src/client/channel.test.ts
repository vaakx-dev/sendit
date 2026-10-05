import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import {
  parse_sender_message,
  type SenderToServerMessage,
  type ServerToSenderMessage,
} from "../protocol.js";
import { SenderChannel, type ChannelEvent, type SenderChannelSocket } from "./channel.js";
import { Selection } from "./selection.js";

class FakeSocket extends EventTarget implements SenderChannelSocket {
  readyState = 1;
  readonly sent: Array<string | ArrayBuffer> = [];

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  receive(message: ServerToSenderMessage): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
}

function messages(socket: FakeSocket): SenderToServerMessage[] {
  const parsed: SenderToServerMessage[] = [];
  for (const data of socket.sent) {
    if (typeof data !== "string") continue;
    const message = parse_sender_message(data);
    assert.ok(message);
    parsed.push(message);
  }
  return parsed;
}

async function wait_for(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for sender channel state.");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("accepts another transfer after the recipient cancels", async () => {
  const selection = new Selection();
  await selection.set_files([new File(["hello"], "hello.txt", { type: "text/plain" })]);
  const selected = selection.included()[0];
  assert.ok(selected);

  const socket = new FakeSocket();
  const events: ChannelEvent[] = [];
  new SenderChannel("key", selection, (event) => events.push(event), socket);

  socket.receive({ type: "transfer_request", transfer_id: "first", item_id: selected.id });
  await wait_for(() => socket.sent.some((data) => data instanceof ArrayBuffer));
  socket.receive({ type: "transfer_cancel", transfer_id: "first", message: "recipient left" });
  socket.receive({ type: "transfer_request", transfer_id: "second", item_id: selected.id });

  await wait_for(() => messages(socket).some((message) =>
    message.type === "transfer_begin" && message.transfer_id === "second",
  ));
  assert.equal(
    messages(socket).some((message) => message.type === "transfer_error" && message.transfer_id === "second"),
    false,
  );
  assert.equal(events.some((event) => event.type === "error" && event.message === "recipient left"), true);
});

test("rejects malformed server messages at the browser boundary", async () => {
  const selection = new Selection();
  const socket = new FakeSocket();
  const events: ChannelEvent[] = [];
  new SenderChannel("key", selection, (event) => events.push(event), socket);

  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "published" }) }));

  assert.deepEqual(events, [{ type: "error", message: "SendIt received an invalid server message." }]);
});
