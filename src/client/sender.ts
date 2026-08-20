import {
  button,
  details,
  div,
  dynamic_child as dynamicChild,
  h1,
  h2,
  icon,
  input,
  main,
  mount,
  on_timeout as onTimeout,
  p,
  prevent_then as preventThen,
  section,
  show,
  sig,
  span,
  strong,
  summary,
} from "@vaakx-dev/vrui";
import { Check, ChevronLeft, Copy, File, Folder, Link, Upload } from "lucide";
import { SenderChannel, type ChannelEvent } from "./channel.js";
import { formatBytes } from "./common.js";
import { fileTypeIcon } from "./file-icons.js";
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
const currentDirectory = sig("");
const connected = sig(false);
const dragging = sig(false);
const selecting = sig(false);
const shareUrl = sig("");
const copyText = sig("Copy");
const transfer = sig<TransferView | null>(null);
const error = sig("");
const WAITING_FOR_RECEIVER = "Waiting for the receiver";
const hasFiles = files.map((value) => value.length > 0);
const selectedFiles = files.map((value) => value.filter((record) => record.selected));
const browserEntries = files.map(() => selection.entries(currentDirectory.get()));
const canPublish = selectedFiles.map((value) => connected.get() && value.length > 0);
const key = new URLSearchParams(location.search).get("key") ?? "";
const channel = new SenderChannel(key, selection, handleChannelEvent);
let browserScroll = 0;

const fileInput = input({
  type: "file",
  multiple: true,
  hidden: true,
  on_change: () => void choose([...(fileInput.files ?? [])]),
});
const folderInput = input({
  type: "file",
  multiple: true,
  hidden: true,
  webkitdirectory: true,
  on_change: () => void choose([...(folderInput.files ?? [])]),
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
      on_drag_enter: preventThen(dragOver),
      on_drag_over: preventThen(dragOver),
      on_drag_leave: preventThen(dragEnd),
      on_drop: preventThen(drop),
    },
    div({ class: "drop-icon", "aria-hidden": "true" }, icon(Upload, 28)),
    h2(selecting.map((value) => value ? "Reading folder…" : "Drop files or a folder here")),
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
        strong(selectedFiles.map((value) => formatBytes(value.reduce((total, item) => total + item.file.size, 0)))),
      ),
      button(
        {
          class: "button primary wide publish-button",
          type: "button",
          disabled: canPublish.map((value) => !value),
          on_click: publish,
        },
        icon(Link, 17),
        shareUrl.map((value) => value ? "Update sharing link" : "Create sharing link"),
      ),
      show(shareUrl.map(Boolean), shareLink),
      show(transfer.map(Boolean), transferStatus),
    ),
    details(
      { class: "panel browser-panel file-picker" },
      summary(
        div(
          p({ class: "eyebrow" }, "Files to send"),
          strong(selectedFiles.map((value) => `${value.length} selected`)),
        ),
        span("Change"),
      ),
      div(
        { class: "browser-heading" },
        button({ class: "icon-button", type: "button", on_click: goUp, disabled: currentDirectory.map((value) => !parentDirectory(value)) }, icon(ChevronLeft, 18)),
        div(
          p({ class: "eyebrow" }, "Files to send"),
          strong(currentDirectory.map((value) => value || "Selected files")),
        ),
      ),
      dynamicChild(browserEntries, directoryList),
    ),
  );
}

function directoryList(records: SelectionEntry[]): HTMLElement {
  return div(
    {
      class: "file-browser",
      on_mount: (node) => { node.scrollTop = browserScroll; },
      on_scroll: (event) => {
        const node = event.currentTarget;
        if (node instanceof HTMLDivElement) browserScroll = node.scrollTop;
      },
    },
    records.map(entryRow),
    records.length === 0 ? p({ class: "hint" }, "This folder is empty.") : null,
  );
}

function entryRow(entry: SelectionEntry): HTMLElement {
  const checked = entry.selectedCount === entry.fileCount;
  const checkbox = input({
    type: "checkbox",
    checked,
    "aria-label": `Include ${entry.name}`,
    on_mount: (node) => { node.indeterminate = entry.selectedCount > 0 && !checked; },
    on_change: () => toggleEntry(entry.path, checkbox.checked),
  });
  const name = entry.directory
    ? button({ class: "entry-name", type: "button", on_click: () => openDirectory(entry.path) }, icon(Folder, 17), strong(entry.name))
    : div({ class: "entry-name" }, fileTypeIcon(entry.name), strong(entry.name));
  return div(
    { class: ["browser-row", { excluded: entry.selectedCount === 0 }] },
    checkbox,
    name,
    span(entry.directory ? `${entry.selectedCount}/${entry.fileCount}` : formatBytes(entry.size)),
  );
}

function shareLink(): HTMLElement {
  return div(
    { class: "share-result" },
    p({ class: "eyebrow" }, "Link is live"),
    div(
      { class: "link-row" },
      input({ value: shareUrl, readOnly: true, "aria-label": "Sharing link", on_focus: (event) => (event.currentTarget as HTMLInputElement).select() }),
      button(
        { class: "button primary", type: "button", on_click: copyLink },
        dynamicChild(copyText, (value) => value === "Copied" ? icon(Check, 17) : icon(Copy, 17)),
        copyText,
      ),
    ),
    p({ class: "hint" }, "Keep this page and the SendIt command window open."),
  );
}

function transferStatus(): HTMLElement {
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
        : value.size ? `${formatBytes(value.sent)} of ${formatBytes(value.size)}` : WAITING_FOR_RECEIVER),
    ),
  );
}

async function choose(values: File[]): Promise<void> {
  if (values.length === 0) return;
  selecting.set(true);
  error.set("");
  try {
    await selection.setFiles(values);
    refreshFiles();
    browserScroll = 0;
    currentDirectory.set(selection.root());
    shareUrl.set("");
    transfer.set(null);
  } catch (cause) {
    error.set(cause instanceof Error ? cause.message : "Could not read the selected files.");
  } finally {
    selecting.set(false);
  }
}

function toggleEntry(path: string, selected: boolean): void {
  selection.select(path, selected);
  refreshFiles();
  shareUrl.set("");
  transfer.set(null);
}

function refreshFiles(): void {
  files.set(selection.all());
}

function publish(): void {
  error.set("");
  channel.publish();
}

function clear(): void {
  selection.clear();
  files.set([]);
  currentDirectory.set("");
  browserScroll = 0;
  fileInput.value = "";
  folderInput.value = "";
  shareUrl.set("");
  transfer.set(null);
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

function dragOver(): void {
  dragging.set(true);
}

function dragEnd(): void {
  dragging.set(false);
}

async function drop(event: DragEvent): Promise<void> {
  dragging.set(false);
  if (!event.dataTransfer) return;
  selecting.set(true);
  error.set("");
  try {
    await selection.setDrop(event.dataTransfer.items, event.dataTransfer.files);
    refreshFiles();
    browserScroll = 0;
    currentDirectory.set(selection.root());
    shareUrl.set("");
    transfer.set(null);
  } catch (cause) {
    error.set(cause instanceof Error ? cause.message : "Could not read the dropped folder.");
  } finally {
    selecting.set(false);
  }
}

function handleChannelEvent(event: ChannelEvent): void {
  switch (event.type) {
    case "connected":
      connected.set(true);
      break;
    case "disconnected":
      connected.set(false);
      error.set("The local SendIt connection closed. Restart the command to share again.");
      break;
    case "published":
      shareUrl.set(event.url);
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

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl.get());
    copyText.set("Copied");
    onTimeout(() => copyText.set("Copy"), 1400);
  } catch {
    error.set("Could not copy the link. Select and copy it manually.");
  }
}
