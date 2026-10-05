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
import { formatBytes } from "../shared/format.js";
import { SenderChannel, type ChannelEvent } from "./channel.js";
import { fileTypeIcon } from "./file-icons.js";
import { Selection, type SelectedFile, type SelectionEntry } from "./selection.js";
import { topbar } from "./topbar.js";

interface TransferView {
  readonly name: string;
  readonly sent: number;
  readonly size: number;
  readonly complete: boolean;
}

const WAITING_FOR_RECEIVER = "Waiting for the receiver";
const WAITING_TRANSFER: TransferView = { name: WAITING_FOR_RECEIVER, sent: 0, size: 0, complete: false };

const selection = new Selection();
const files = sig<SelectedFile[]>([]);
const currentDirectory = sig("");
const connected = sig(false);
const dragging = sig(false);
const selecting = sig(false);
const shareUrl = sig("");
const copyLabel = sig("Copy");
const transfer = sig<TransferView | null>(null);
const error = sig("");
const hasFiles = files.map((value) => value.length > 0);
const selectedFiles = files.map((value) => value.filter((file) => file.selected));
const browserEntries = files.map(() => selection.entries(currentDirectory.get()));
const canPublish = selectedFiles.map((value) => connected.get() && value.length > 0);
const channel = new SenderChannel(openSocket(), selection, handleChannelEvent);
let browserScroll = 0;

const fileInput = input({
  type: "file",
  multiple: true,
  hidden: true,
  on_change: () => void loadSelection(() => selection.setFiles([...(fileInput.files ?? [])])),
});
const folderInput = input({
  type: "file",
  multiple: true,
  hidden: true,
  webkitdirectory: true,
  on_change: () => void loadSelection(() => selection.setFiles([...(folderInput.files ?? [])])),
});

mount(
  "app",
  main(
    { class: "shell sender-shell" },
    topbar(
      connected.map((value) => (value ? "Ready" : "Connecting")),
      connected.map((value) => (value ? "" : "pending")),
    ),
    section({ class: "hero" }, h1("SENDIT")),
    fileInput,
    folderInput,
    show(hasFiles.map((value) => !value), dropZone),
    show(hasFiles, selectionPanel),
    show(error.map(Boolean), () => p({ class: "error", role: "alert" }, error)),
  ),
);

function dropZone(): HTMLElement {
  return section(
    {
      class: ["drop-zone", { dragging }],
      "aria-label": "File selection",
      on_drag_enter: prevent_then(() => dragging.set(true)),
      on_drag_over: prevent_then(() => dragging.set(true)),
      on_drag_leave: prevent_then(() => dragging.set(false)),
      on_drop: prevent_then(drop),
    },
    div({ class: "drop-icon", "aria-hidden": "true" }, icon(Upload, 28)),
    h2(selecting.map((value) => (value ? "Reading folder…" : "Drop files or a folder here"))),
    p("Choose a project folder, then exclude anything you do not want to send."),
    div(
      { class: "actions" },
      button(
        { class: "button secondary", type: "button", disabled: selecting, on_click: () => fileInput.click() },
        icon(File, 17),
        "Choose files",
      ),
      button(
        { class: "button primary", type: "button", disabled: selecting, on_click: () => folderInput.click() },
        icon(Folder, 17),
        "Choose folder",
      ),
    ),
  );
}

function selectionPanel(): HTMLElement {
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
        span(selectedFiles.map((value) => `${value.length} of ${files.get().length} files selected`)),
        strong(selectedFiles.map((value) => formatBytes(value.reduce((total, file) => total + file.file.size, 0)))),
      ),
      button(
        {
          class: "button primary wide publish-button",
          type: "button",
          disabled: canPublish.map((value) => !value),
          on_click: publish,
        },
        icon(Link, 17),
        shareUrl.map((value) => (value ? "Update sharing link" : "Create sharing link")),
      ),
      show(shareUrl.map(Boolean), shareLink),
      show(transfer.map(Boolean), transferStatus),
    ),
    details(
      { class: "panel browser-panel file-picker" },
      summary(
        div(p({ class: "eyebrow" }, "Files to send"), strong(selectedFiles.map((value) => `${value.length} selected`))),
        span("Change"),
      ),
      div(
        { class: "browser-heading" },
        button(
          {
            class: "icon-button",
            type: "button",
            on_click: goUp,
            disabled: currentDirectory.map((value) => !parentDirectory(value)),
          },
          icon(ChevronLeft, 18),
        ),
        div(p({ class: "eyebrow" }, "Files to send"), strong(currentDirectory.map((value) => value || "Selected files"))),
      ),
      dynamic_child(browserEntries, directoryList),
    ),
  );
}

function directoryList(entries: SelectionEntry[]): HTMLElement {
  return div(
    {
      class: "file-browser",
      on_mount: (node) => {
        node.scrollTop = browserScroll;
      },
      on_scroll: (event) => {
        if (event.currentTarget instanceof HTMLDivElement) browserScroll = event.currentTarget.scrollTop;
      },
    },
    entries.map(entryRow),
    entries.length === 0 ? p({ class: "hint" }, "This folder is empty.") : null,
  );
}

function entryRow(entry: SelectionEntry): HTMLElement {
  const checked = entry.selectedCount === entry.fileCount;
  const checkbox = input({
    type: "checkbox",
    checked,
    "aria-label": `Include ${entry.name}`,
    on_mount: (node) => {
      node.indeterminate = entry.selectedCount > 0 && !checked;
    },
    on_change: () => toggleEntry(entry.path, checkbox.checked),
  });
  const name = entry.isDirectory
    ? button({ class: "entry-name", type: "button", on_click: () => openDirectory(entry.path) }, icon(Folder, 17), strong(entry.name))
    : div({ class: "entry-name" }, fileTypeIcon(entry.name), strong(entry.name));
  return div(
    { class: ["browser-row", { excluded: entry.selectedCount === 0 }] },
    checkbox,
    name,
    span(entry.isDirectory ? `${entry.selectedCount}/${entry.fileCount}` : formatBytes(entry.size)),
  );
}

function shareLink(): HTMLElement {
  return div(
    { class: "share-result" },
    p({ class: "eyebrow" }, "Link is live"),
    div(
      { class: "link-row" },
      input({
        value: shareUrl,
        readOnly: true,
        "aria-label": "Sharing link",
        on_focus: (event) => {
          if (event.currentTarget instanceof HTMLInputElement) event.currentTarget.select();
        },
      }),
      button(
        { class: "button primary", type: "button", on_click: copyLink },
        dynamic_child(copyLabel, (value) => icon(value === "Copied" ? Check : Copy, 17)),
        copyLabel,
      ),
    ),
    p({ class: "hint" }, "Keep this page and the SendIt command window open."),
  );
}

function transferStatus(): HTMLElement {
  const current = transfer.map((value) => value ?? WAITING_TRANSFER);
  const percent = current.map((value) => (value.size === 0 ? 0 : Math.round((value.sent / value.size) * 100)));
  return div(
    { class: "transfer-status", "aria-live": "polite" },
    div(
      { class: "transfer-line" },
      strong(current.map((value) => (value.complete ? "Transfer complete" : value.name))),
      span(percent.map((value) => `${value}%`)),
    ),
    div({ class: "progress-track" }, div({ class: "progress-bar", style: { width: percent.map((value) => `${value}%`) } })),
    p({ class: "hint" }, current.map(describeTransfer)),
  );
}

function describeTransfer(view: TransferView): string {
  if (view.complete) return `${view.name} was sent successfully.`;
  if (view.size === 0) return WAITING_FOR_RECEIVER;
  return `${formatBytes(view.sent)} of ${formatBytes(view.size)}`;
}

async function loadSelection(load: () => Promise<void>): Promise<void> {
  selecting.set(true);
  error.set("");
  await load().then(showSelection, (cause: unknown) => {
    error.set(cause instanceof Error ? cause.message : "Could not read the selected files.");
  });
  selecting.set(false);
}

function showSelection(): void {
  refreshFiles();
  browserScroll = 0;
  currentDirectory.set(selection.root());
}

function drop(event: DragEvent): void {
  dragging.set(false);
  const { dataTransfer } = event;
  if (dataTransfer) void loadSelection(() => selection.setDrop(dataTransfer));
}

function toggleEntry(path: string, selected: boolean): void {
  selection.select(path, selected);
  refreshFiles();
}

function refreshFiles(): void {
  files.set(selection.all());
  shareUrl.set("");
  transfer.set(null);
}

function publish(): void {
  error.set("");
  channel.publish();
}

function clear(): void {
  selection.clear();
  fileInput.value = "";
  folderInput.value = "";
  refreshFiles();
  currentDirectory.set("");
  browserScroll = 0;
}

function parentDirectory(path: string): string {
  const root = selection.root();
  if (!path || path === root) return "";
  const slash = path.lastIndexOf("/");
  const parent = slash < 0 ? "" : path.slice(0, slash);
  return parent.length < root.length ? root : parent;
}

function openDirectory(path: string): void {
  browserScroll = 0;
  currentDirectory.set(path);
}

function goUp(): void {
  const parent = parentDirectory(currentDirectory.get());
  if (parent) openDirectory(parent);
}

function handleChannelEvent(event: ChannelEvent): void {
  switch (event.type) {
    case "connected":
      return connected.set(true);
    case "disconnected":
      connected.set(false);
      return error.set("The local SendIt connection closed. Restart the command to share again.");
    case "published":
      shareUrl.set(event.url);
      return transfer.set(WAITING_TRANSFER);
    case "progress":
      return transfer.set({ name: event.file.name, sent: event.sent, size: event.file.size, complete: false });
    case "complete":
      return transfer.set({ name: event.file.name, sent: event.file.size, size: event.file.size, complete: true });
    case "error":
      return error.set(event.message);
  }
}

async function copyLink(): Promise<void> {
  await navigator.clipboard.writeText(shareUrl.get()).then(
    () => {
      copyLabel.set("Copied");
      on_timeout(() => copyLabel.set("Copy"), 1400);
    },
    () => error.set("Could not copy the link. Select and copy it manually."),
  );
}

function openSocket(): WebSocket {
  const key = new URLSearchParams(location.search).get("key") ?? "";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${location.host}/ws/sender?key=${encodeURIComponent(key)}`);
}
