import {
  button,
  div,
  dynamic_child,
  h1,
  h2,
  icon,
  input,
  main,
  mount,
  on_timeout,
  p,
  prevent_then,
  section,
  show,
  sig,
  span,
  strong,
} from "@vaakx-dev/vrui";
import { Check, Copy, File, Folder, Link, Upload } from "lucide";
import { SenderChannel, type ChannelEvent } from "./channel.js";
import { format_bytes } from "./common.js";
import { Selection, type SelectedFile } from "./selection.js";
import { topbar } from "./ui.js";

interface TransferView {
  name: string;
  sent: number;
  size: number;
  complete: boolean;
}

const selection = new Selection();
const files = sig<SelectedFile[]>([]);
const connected = sig(false);
const dragging = sig(false);
const share_url = sig("");
const copy_text = sig("Copy");
const transfer = sig<TransferView | null>(null);
const error = sig("");
const WAITING_FOR_RECEIVER = "Waiting for the receiver";
const has_files = files.map((value) => value.length > 0);
const can_publish = files.map((value) => connected.get() && value.length > 0);
const key = new URLSearchParams(location.search).get("key") ?? "";
const channel = new SenderChannel(key, selection, handle_channel_event);

const file_input = input({
  type: "file",
  multiple: true,
  hidden: true,
  on_change: () => choose([...(file_input.files ?? [])]),
});
const folder_input = input({
  type: "file",
  multiple: true,
  hidden: true,
  webkitdirectory: true,
  on_change: () => choose([...(folder_input.files ?? [])]),
});

mount(
  "app",
  main(
    { class: "shell" },
    topbar(
      connected.map((value) => value ? "Ready" : "Connecting"),
      connected.map((value) => value ? "" : "pending"),
    ),
    section(
      { class: "hero" },
      h1("SENDIT"),
    ),
    file_input,
    folder_input,
    show(has_files.map((value) => !value), drop_zone),
    show(has_files, selection_panel),
    show(share_url.map(Boolean), share_panel),
    show(transfer.map(Boolean), transfer_panel),
    show(error.map(Boolean), () => p({ class: "error", role: "alert" }, error)),
  ),
);

function drop_zone(): HTMLElement {
  return section(
    {
      class: ["drop-zone", { dragging }],
      "aria-label": "File selection",
      on_drag_enter: prevent_then(drag_over),
      on_drag_over: prevent_then(drag_over),
      on_drag_leave: prevent_then(drag_end),
      on_drop: prevent_then(drop),
    },
    div({ class: "drop-icon", "aria-hidden": "true" }, icon(Upload, 28)),
    h2("Drop files or a folder here"),
    p("or choose what you want to share"),
    div(
      { class: "actions" },
      button(
        { class: "button secondary", type: "button", on_click: () => file_input.click() },
        icon(File, 17),
        "Choose files",
      ),
      button(
        { class: "button secondary", type: "button", on_click: () => folder_input.click() },
        icon(Folder, 17),
        "Choose folder",
      ),
    ),
  );
}

function selection_panel(): HTMLElement {
  return section(
    { class: "panel", "aria-live": "polite" },
    div(
      { class: "panel-heading" },
      div(p({ class: "eyebrow" }, "Ready to share"), h2(files.map(() => selection.label()))),
      button({ class: "text-button", type: "button", on_click: clear }, "Clear"),
    ),
    dynamic_child(files, file_list),
    div(
      { class: "summary" },
      span(files.map((value) => `${value.length} ${value.length === 1 ? "file" : "files"}`)),
      strong(files.map((value) => format_bytes(value.reduce((total, item) => total + item.file.size, 0)))),
    ),
    button(
      {
        class: "button primary wide",
        type: "button",
        disabled: can_publish.map((value) => !value),
        on_click: () => channel.publish(),
      },
      icon(Link, 17),
      "Create sharing link",
    ),
  );
}

function file_list(records: SelectedFile[]): HTMLElement {
  const visible = records.slice(0, 6).map((record) => file_row(record));
  if (records.length > 6) {
    visible.push(div({ class: "file-row" }, strong(`${records.length - 6} more files`)));
  }
  return div({ class: "file-list" }, visible);
}

function file_row(record: SelectedFile): HTMLElement {
  return div(
    { class: "file-row" },
    strong(record.path),
    span(format_bytes(record.file.size)),
  );
}

function share_panel(): HTMLElement {
  return section(
    {
      class: "panel success",
      "aria-live": "polite",
      on_mount: (node) => node.scrollIntoView({ behavior: "smooth", block: "center" }),
    },
    p({ class: "eyebrow" }, "Link is live"),
    div(
      { class: "link-row" },
      input({ value: share_url, readOnly: true, "aria-label": "Sharing link" }),
      button(
        { class: "button primary", type: "button", on_click: copy_link },
        dynamic_child(copy_text, (value) => value === "Copied" ? icon(Check, 17) : icon(Copy, 17)),
        copy_text,
      ),
    ),
    p({ class: "hint" }, "Keep this page and the SendIt command window open."),
  );
}

function transfer_panel(): HTMLElement {
  const current = transfer.map((value) => value ?? { name: WAITING_FOR_RECEIVER, sent: 0, size: 0, complete: false });
  const percent = current.map((value) => value.size === 0 ? 0 : Math.round((value.sent / value.size) * 100));
  return section(
    { class: "panel", "aria-live": "polite" },
    div(
      { class: "panel-heading" },
      div(
        p({ class: "eyebrow" }, "Transfer"),
        h2(current.map((value) => value.complete ? "Transfer complete" : value.name)),
      ),
      strong(percent.map((value) => `${value}%`)),
    ),
    div({ class: "progress-track" }, div({ class: "progress-bar", style: { width: percent.map((value) => `${value}%`) } })),
    p(
      { class: "hint" },
      current.map((value) => value.complete
        ? `${value.name} was sent successfully.`
        : `${format_bytes(value.sent)} of ${format_bytes(value.size)}`),
    ),
  );
}

function choose(values: File[]): void {
  selection.set_files(values);
  files.set(selection.all());
  share_url.set("");
  transfer.set(null);
  error.set("");
}

function clear(): void {
  selection.clear();
  files.set([]);
  file_input.value = "";
  folder_input.value = "";
  share_url.set("");
  transfer.set(null);
}

function drag_over(): void {
  dragging.set(true);
}

function drag_end(): void {
  dragging.set(false);
}

async function drop(event: DragEvent): Promise<void> {
  dragging.set(false);
  if (!event.dataTransfer) return;
  await selection.set_drop(event.dataTransfer.items, event.dataTransfer.files);
  files.set(selection.all());
}

function handle_channel_event(event: ChannelEvent): void {
  switch (event.type) {
    case "connected":
      connected.set(true);
      break;
    case "disconnected":
      connected.set(false);
      error.set("The local SendIt connection closed. Restart the command to share again.");
      break;
    case "published":
      share_url.set(event.url);
      transfer.set({ name: WAITING_FOR_RECEIVER, sent: 0, size: 0, complete: false });
      break;
    case "progress":
      transfer.set({ name: event.file.name, sent: event.sent, size: event.file.size, complete: false });
      break;
    case "complete":
      transfer.set({ name: event.file.name, sent: event.file.size, size: event.file.size, complete: true });
      break;
    case "error":
      error.set(event.message);
      break;
  }
}

async function copy_link(): Promise<void> {
  try {
    await navigator.clipboard.writeText(share_url.get());
    copy_text.set("Copied");
    on_timeout(() => copy_text.set("Copy"), 1400);
  } catch {
    error.set("Could not copy the link. Select and copy it manually.");
  }
}
