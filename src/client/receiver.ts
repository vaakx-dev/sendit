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
import { Download, File, PackageOpen } from "lucide";
import { format_bytes } from "./common.js";
import { topbar } from "./ui.js";

interface ShareItem {
  id: string;
  relative_path: string;
  size: number;
}

interface Share {
  label: string;
  sender_online: boolean;
  total_size: number;
  items: ShareItem[];
}

type View =
  | { kind: "loading" }
  | { kind: "ready"; share: Share }
  | { kind: "unavailable" };

const token = decodeURIComponent(location.pathname.split("/")[2] ?? "");

const request = resource<Share>(async (signal) => {
  const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, { signal: signal ?? null });
  if (!response.ok) throw new Error("Share unavailable");
  return await response.json() as Share;
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

function share_page(share: Share): HTMLElement {
  return section(
    { class: "panel" },
    div(
      { class: "panel-heading" },
      h2(share.label),
      span(
        { class: "meta" },
        `${share.items.length} ${share.items.length === 1 ? "file" : "files"} · ${format_bytes(share.total_size)}`,
      ),
    ),
    div({ class: "file-list receiver-list" }, share.items.map(file_row)),
    share.items.length > 1
      ? a(
        { class: "button primary wide download-all", href: `/s/${encodeURIComponent(token)}/archive` },
        icon(PackageOpen, 18),
        "Download everything as ZIP",
      )
      : null,
    p({ class: "hint" }, "The sender must keep SendIt open until your download completes."),
  );
}

function file_row(item: ShareItem): HTMLElement {
  return div(
    { class: "file-row" },
    div(
      { class: "file-details" },
      span_icon(),
      div(strong(item.relative_path), small(format_bytes(item.size))),
    ),
    a(
      { href: `/s/${encodeURIComponent(token)}/files/${encodeURIComponent(item.id)}` },
      icon(Download, 16),
      "Download",
    ),
  );
}

function span_icon(): HTMLElement {
  return div({ class: "file-icon", "aria-hidden": "true" }, icon(File, 18));
}
