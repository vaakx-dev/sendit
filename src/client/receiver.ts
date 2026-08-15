import {
  a,
  derive,
  div,
  dynamic_child,
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
import { format_bytes } from "./common.js";
import { file_type_icon } from "./file_icons.js";
import { parse_share_details, type SharedItem, type ShareDetails } from "../protocol.js";
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
  const share = parse_share_details(value);
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
  return request.data.get()?.sender_online ? "Sender online" : "Sender offline";
});
const status_class = derive(() => {
  if (request.loading.get()) return "pending";
  return request.data.get()?.sender_online ? "" : "offline";
});

mount(
  "app",
  main(
    { class: "shell receiver-shell" },
    topbar(status, status_class),
    section({ class: "hero" }, h1("SENDIT")),
    dynamic_child(view, page),
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
      return share_page(value.share);
  }
}

function share_page(share: ShareDetails): HTMLElement {
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
          `${share.items.length} ${share.items.length === 1 ? "file" : "files"} · ${format_bytes(share.total_size)}`,
        ),
      ),
      multiple
        ? a(
          { class: "button primary receiver-download", href: `/s/${encodeURIComponent(token)}/archive` },
          icon(PackageOpen, 18),
          "Download ZIP",
        )
        : a(
          { class: "button primary receiver-download", href: file_url(share.items[0]) },
          icon(Download, 18),
          "Download file",
        ),
    ),
    div({ class: "file-list receiver-list" }, visible_items(share.items).map(file_row)),
    share.items.length > 100
      ? p({ class: "hint list-note" }, `Showing 100 of ${share.items.length} files. The ZIP contains everything.`)
      : null,
    p({ class: "hint" }, "The sender must keep SendIt open until your download completes."),
  );
}

function visible_items(items: SharedItem[]): SharedItem[] {
  return items.slice(0, 100);
}

function file_url(item: SharedItem): string {
  return `/s/${encodeURIComponent(token)}/files/${encodeURIComponent(item.id)}`;
}

function file_row(item: SharedItem): HTMLElement {
  return div(
    { class: "file-row" },
    div(
      { class: "file-details" },
      div({ class: "file-icon", "aria-hidden": "true" }, file_type_icon(item.relative_path, 18)),
      div(strong(item.relative_path), small(format_bytes(item.size))),
    ),
    a(
      { href: file_url(item) },
      icon(Download, 16),
      "Download",
    ),
  );
}
