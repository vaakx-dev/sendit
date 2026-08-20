import {
  a,
  derive,
  div,
  dynamic_child as dynamicChild,
  h1,
  h2,
  icon,
  main,
  mount,
  p,
  resource,
  section,
  small,
  span,
  strong,
} from "@vaakx-dev/vrui";
import { Download, PackageOpen } from "lucide";
import { formatBytes } from "./common.js";
import { fileTypeIcon } from "./file-icons.js";
import { parseShareDetails, type SharedItem, type ShareDetails } from "../protocol.js";
import { topbar } from "./ui.js";

type View =
  | { kind: "loading" }
  | { kind: "ready"; share: ShareDetails }
  | { kind: "unavailable" };

const token = decodeURIComponent(location.pathname.split("/")[2] ?? "");

const request = resource<ShareDetails>(async (signal) => {
  const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, { signal: signal ?? null });
  if (!response.ok) throw new Error("Share unavailable");
  const value: unknown = await response.json();
  const share = parseShareDetails(value);
  if (!share) throw new Error("Invalid share details");
  return share;
});

const view = derive<View>(() => {
  if (request.loading.get()) return { kind: "loading" };
  const share = request.data.get();
  return share ? { kind: "ready", share } : { kind: "unavailable" };
});

const status = derive(() => {
  if (request.loading.get()) return "Checking";
  return request.data.get()?.senderOnline ? "Sender online" : "Sender offline";
});
const statusClass = derive(() => {
  if (request.loading.get()) return "pending";
  return request.data.get()?.senderOnline ? "" : "offline";
});

mount(
  "app",
  main(
    { class: "shell receiver-shell" },
    topbar(status, statusClass),
    section({ class: "hero" }, h1("SENDIT")),
    dynamicChild(view, page),
  ),
);

function page(value: View): HTMLElement {
  switch (value.kind) {
    case "loading":
      return p({ class: "hint" }, "Loading…");
    case "unavailable":
      return section(
        { class: "panel" },
        h2("This link has ended."),
        p({ class: "hint" }, "Ask the sender for a new link."),
      );
    case "ready":
      return sharePage(value.share);
  }
}

function sharePage(share: ShareDetails): HTMLElement {
  const multiple = share.items.length > 1;
  return section(
    { class: "panel receiver-panel" },
    div(
      { class: "receiver-summary" },
      div(
        p({ class: "eyebrow" }, "Ready to download"),
        h2(share.label),
        p(
          { class: "meta" },
          `${share.items.length} ${share.items.length === 1 ? "file" : "files"} · ${formatBytes(share.totalSize)}`,
        ),
      ),
      multiple
        ? a(
          { class: "button primary receiver-download", href: `/s/${encodeURIComponent(token)}/archive` },
          icon(PackageOpen, 18),
          "Download ZIP",
        )
        : a(
          { class: "button primary receiver-download", href: fileUrl(share.items[0]) },
          icon(Download, 18),
          "Download file",
        ),
    ),
    div({ class: "file-list receiver-list" }, visibleItems(share.items).map(fileRow)),
    share.items.length > 100
      ? p({ class: "hint list-note" }, `Showing 100 of ${share.items.length} files. The ZIP contains everything.`)
      : null,
    p({ class: "hint" }, "The sender must keep SendIt open until your download completes."),
  );
}

function visibleItems(items: SharedItem[]): SharedItem[] {
  return items.slice(0, 100);
}

function fileUrl(item: SharedItem): string {
  return `/s/${encodeURIComponent(token)}/files/${encodeURIComponent(item.id)}`;
}

function fileRow(item: SharedItem): HTMLElement {
  return div(
    { class: "file-row" },
    div(
      { class: "file-details" },
      div({ class: "file-icon", "aria-hidden": "true" }, fileTypeIcon(item.relativePath, 18)),
      div(strong(item.relativePath), small(formatBytes(item.size))),
    ),
    a(
      { href: fileUrl(item) },
      icon(Download, 16),
      "Download",
    ),
  );
}
