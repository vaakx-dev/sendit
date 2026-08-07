import {
  button,
  details,
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
  summary,
} from "@vaakx-dev/vrui";
import { Check, ChevronLeft, Copy, File, Folder, Link, Upload } from "lucide";
import { SenderChannel, type ChannelEvent } from "./channel.js";
import { format_bytes } from "./common.js";
import { file_type_icon } from "./file_icons.js";
import { Selection, type SelectedFile, type SelectionEntry } from "./selection.js";
import { topbar } from "./ui.js";

interface TransferView {
  name: string;
  sent: number;
  size: number;
  complete: boolean;
}

const selection = new Selection();
const files = sig<SelectedFile[]>([]);
const current_directory = sig("");
const connected = sig(false);
const dragging = sig(false);
const selecting = sig(false);
const share_url = sig("");
const copy_text = sig("Copy");
const transfer = sig<TransferView | null>(null);
const error = sig("");
const WAITING_FOR_RECEIVER = "Waiting for the receiver";
const has_files = files.map((value) => value.length > 0);
const selected_files = files.map((value) => value.filter((record) => record.selected));
const browser_entries = files.map(() => selection.entries(current_directory.get()));
const can_publish = selected_files.map((value) => connected.get() && value.length > 0);
const key = new URLSearchParams(location.search).get("key") ?? "";
const channel = new SenderChannel(key, selection, handle_channel_event);
let browser_scroll = 0;

const file_input = input({
  type: "file",
  multiple: true,
  hidden: true,
  on_change: () => void choose([...(file_input.files ?? [])]),
});
const folder_input = input({
  type: "file",
  multiple: true,
  hidden: true,
  webkitdirectory: true,
  on_change: () => void choose([...(folder_input.files ?? [])]),
});

mount(
  "app",
  main(
    { class: "shell sender-shell" },
    topbar(
      connected.map((value) => value ? "Ready" : "Connecting"),
      connected.map((value) => value ? "" : "pending"),
    ),
    section({ class: "hero" }, h1("SENDIT")),
    file_input,
    folder_input,
    show(has_files.map((value) => !value), drop_zone),
    show(has_files, selection_panel),
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
    h2(selecting.map((value) => value ? "Reading folder…" : "Drop files or a folder here")),
    p("Choose a project folder, then exclude anything you do not want to send."),
    div(
      { class: "actions" },
      button(
        { class: "button secondary", type: "button", disabled: selecting, on_click: () => file_input.click() },
        icon(File, 17),
        "Choose files",
      ),
      button(
        { class: "button primary", type: "button", disabled: selecting, on_click: () => folder_input.click() },
        icon(Folder, 17),
        "Choose folder",
      ),
    ),
  );
}

function selection_panel(): HTMLElement {
  return div(
    { class: "sender-workspace" },
    section(
      { class: "panel share-controls", "aria-live": "polite" },
      div(
        { class: "panel-heading compact" },
        div(p({ class: "eyebrow" }, "Share selection"), h2(files.map(() => selection.label()))),
        button({ class: "text-button", type: "button", on_click: clear }, "Clear"),
      ),
      div(
        { class: "summary selection-summary" },
        span(selected_files.map((value) => `${value.length} of ${files.get().length} files selected`)),
        strong(selected_files.map((value) => format_bytes(value.reduce((total, item) => total + item.file.size, 0)))),
      ),
      button(
        {
          class: "button primary wide publish-button",
          type: "button",
          disabled: can_publish.map((value) => !value),
          on_click: publish,
        },
        icon(Link, 17),
        share_url.map((value) => value ? "Update sharing link" : "Create sharing link"),
      ),
      show(share_url.map(Boolean), share_link),
      show(transfer.map(Boolean), transfer_status),
    ),
    details(
      { class: "panel browser-panel file-picker" },
      summary(
        div(
          p({ class: "eyebrow" }, "Files to send"),
          strong(selected_files.map((value) => `${value.length} selected`)),
        ),
        span("Change"),
      ),
      div(
        { class: "browser-heading" },
        button({ class: "icon-button", type: "button", on_click: go_up, disabled: current_directory.map((value) => !parent_directory(value)) }, icon(ChevronLeft, 18)),
        div(
          p({ class: "eyebrow" }, "Files to send"),
          strong(current_directory.map((value) => value || "Selected files")),
        ),
      ),
      dynamic_child(browser_entries, directory_list),
    ),
  );
}

function directory_list(records: SelectionEntry[]): HTMLElement {
  return div(
    {
      class: "file-browser",
      on_mount: (node) => {
        node.scrollTop = browser_scroll;
        node.addEventListener("scroll", () => { browser_scroll = node.scrollTop; }, { passive: true });
      },
    },
    records.map(entry_row),
    records.length === 0 ? p({ class: "hint" }, "This folder is empty.") : null,
  );
}

function entry_row(entry: SelectionEntry): HTMLElement {
  const checked = entry.selected_count === entry.file_count;
  const checkbox = input({
    type: "checkbox",
    checked,
    "aria-label": `Include ${entry.name}`,
    on_mount: (node) => { node.indeterminate = entry.selected_count > 0 && !checked; },
    on_change: () => toggle_entry(entry.path, checkbox.checked),
  });
  const name = entry.directory
    ? button({ class: "entry-name", type: "button", on_click: () => open_directory(entry.path) }, icon(Folder, 17), strong(entry.name))
    : div({ class: "entry-name" }, file_type_icon(entry.name), strong(entry.name));
  return div(
    { class: ["browser-row", { excluded: entry.selected_count === 0 }] },
    checkbox,
    name,
    span(entry.directory ? `${entry.selected_count}/${entry.file_count}` : format_bytes(entry.size)),
  );
}

function share_link(): HTMLElement {
  return div(
    { class: "share-result" },
    p({ class: "eyebrow" }, "Link is live"),
    div(
      { class: "link-row" },
      input({ value: share_url, readOnly: true, "aria-label": "Sharing link", on_focus: (event) => (event.currentTarget as HTMLInputElement).select() }),
      button(
        { class: "button primary", type: "button", on_click: copy_link },
        dynamic_child(copy_text, (value) => value === "Copied" ? icon(Check, 17) : icon(Copy, 17)),
        copy_text,
      ),
    ),
    p({ class: "hint" }, "Keep this page and the SendIt command window open."),
  );
}

function transfer_status(): HTMLElement {
  const current = transfer.map((value) => value ?? { name: WAITING_FOR_RECEIVER, sent: 0, size: 0, complete: false });
  const percent = current.map((value) => value.size === 0 ? 0 : Math.round((value.sent / value.size) * 100));
  return div(
    { class: "transfer-status", "aria-live": "polite" },
    div(
      { class: "transfer-line" },
      strong(current.map((value) => value.complete ? "Transfer complete" : value.name)),
      span(percent.map((value) => `${value}%`)),
    ),
    div({ class: "progress-track" }, div({ class: "progress-bar", style: { width: percent.map((value) => `${value}%`) } })),
    p(
      { class: "hint" },
      current.map((value) => value.complete
        ? `${value.name} was sent successfully.`
        : value.size ? `${format_bytes(value.sent)} of ${format_bytes(value.size)}` : WAITING_FOR_RECEIVER),
    ),
  );
}

async function choose(values: File[]): Promise<void> {
  if (values.length === 0) return;
  selecting.set(true);
  error.set("");
  try {
    await selection.set_files(values);
    refresh_files();
    browser_scroll = 0;
    current_directory.set(selection.root());
    share_url.set("");
    transfer.set(null);
  } catch (cause) {
    error.set(cause instanceof Error ? cause.message : "Could not read the selected files.");
  } finally {
    selecting.set(false);
  }
}

function toggle_entry(path: string, selected: boolean): void {
  selection.select(path, selected);
  refresh_files();
  share_url.set("");
  transfer.set(null);
}

function refresh_files(): void {
  files.set(selection.all());
}

function publish(): void {
  error.set("");
  channel.publish();
}

function clear(): void {
  selection.clear();
  files.set([]);
  current_directory.set("");
  browser_scroll = 0;
  file_input.value = "";
  folder_input.value = "";
  share_url.set("");
  transfer.set(null);
}

function parent_directory(path: string): string {
  const root = selection.root();
  if (!path || path === root) return "";
  const slash = path.lastIndexOf("/");
  const parent = slash < 0 ? "" : path.slice(0, slash);
  return parent.length < root.length ? root : parent;
}

function open_directory(path: string): void {
  browser_scroll = 0;
  current_directory.set(path);
}

function go_up(): void {
  const parent = parent_directory(current_directory.get());
  if (parent) open_directory(parent);
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
  selecting.set(true);
  error.set("");
  try {
    await selection.set_drop(event.dataTransfer.items, event.dataTransfer.files);
    refresh_files();
    browser_scroll = 0;
    current_directory.set(selection.root());
    share_url.set("");
    transfer.set(null);
  } catch (cause) {
    error.set(cause instanceof Error ? cause.message : "Could not read the dropped folder.");
  } finally {
    selecting.set(false);
  }
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
