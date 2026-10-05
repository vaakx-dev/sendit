import { a, derive, div, dynamic_child, h1, h2, icon, main, mount, p, resource, section, small, strong } from "@vaakx-dev/vrui";
import { Download, PackageOpen } from "lucide";
import { countOf, formatBytes } from "../shared/format.js";
import type { ShareDetails, SharedItem } from "../shared/protocol.js";
import { fileTypeIcon } from "./file-icons.js";
import { topbar } from "./topbar.js";

type View = { kind: "loading" } | { kind: "ready"; share: ShareDetails } | { kind: "unavailable" };

const VISIBLE_ITEM_LIMIT = 100;
const [, , token = ""] = location.pathname.split("/");
const sharePath = `/s/${token}`;

const details = resource(async (signal) => {
  const response = await fetch(`${sharePath}/details`, { signal: signal ?? null });
  if (!response.ok) throw new Error("This share is unavailable.");
  return (await response.json()) as ShareDetails;
});

const view = derive<View>(() => {
  if (details.loading.get()) return { kind: "loading" };
  const share = details.data.get();
  return share ? { kind: "ready", share } : { kind: "unavailable" };
});

const status = derive(() => {
  if (details.loading.get()) return "Checking";
  return details.data.get()?.senderOnline ? "Sender online" : "Sender offline";
});

const statusClass = derive(() => {
  if (details.loading.get()) return "pending";
  return details.data.get()?.senderOnline ? "" : "offline";
});

mount(
  "app",
  main(
    { class: "shell receiver-shell" },
    topbar(status, statusClass),
    section({ class: "hero" }, h1("SENDIT")),
    dynamic_child(view, page),
  ),
);

function page(value: View): HTMLElement {
  switch (value.kind) {
    case "loading":
      return p({ class: "hint" }, "Loading…");
    case "unavailable":
      return section({ class: "panel" }, h2("This link has ended."), p({ class: "hint" }, "Ask the sender for a new link."));
    case "ready":
      return sharePage(value.share);
  }
}

function sharePage(share: ShareDetails): HTMLElement {
  const isArchive = share.items.length > 1;
  return section(
    { class: "panel receiver-panel" },
    div(
      { class: "receiver-summary" },
      div(
        p({ class: "eyebrow" }, "Ready to download"),
        h2(share.label),
        p({ class: "meta" }, `${countOf(share.items.length, "file")} · ${formatBytes(share.totalSize)}`),
      ),
      a(
        { class: "button primary receiver-download", href: `${sharePath}/download` },
        icon(isArchive ? PackageOpen : Download, 18),
        isArchive ? "Download ZIP" : "Download file",
      ),
    ),
    div({ class: "file-list receiver-list" }, share.items.slice(0, VISIBLE_ITEM_LIMIT).map(fileRow)),
    share.items.length > VISIBLE_ITEM_LIMIT
      ? p({ class: "hint list-note" }, `Showing ${VISIBLE_ITEM_LIMIT} of ${share.items.length} files. The ZIP contains everything.`)
      : null,
    p({ class: "hint" }, "The sender must keep SendIt open until your download completes."),
  );
}

function fileRow(item: SharedItem): HTMLElement {
  return div(
    { class: "file-row" },
    div(
      { class: "file-details" },
      div({ class: "file-icon", "aria-hidden": "true" }, fileTypeIcon(item.relativePath, 18)),
      div(strong(item.relativePath), small(formatBytes(item.size))),
    ),
    a({ href: `${sharePath}/files/${encodeURIComponent(item.id)}` }, icon(Download, 16), "Download"),
  );
}
