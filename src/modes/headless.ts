import { setTimeout as sleep } from "node:timers/promises";
import { log, reportDownload } from "../output.js";
import { startServer } from "../server/server.js";
import { createShare, totalSize } from "../share.js";
import { countOf, formatBytes } from "../shared/format.js";
import { selectFiles } from "../sources/disk-files.js";
import { startTunnel, waitUntilReachable } from "../tunnel/tunnel.js";
import { waitForShutdown } from "./shutdown.js";

export interface HeadlessOptions {
  readonly paths: string[];
  readonly port: number;
  readonly local: boolean;
  readonly once: boolean;
}

const TUNNEL_DRAIN_MS = 5_000;

export async function shareFromDisk({ paths, port, local, once }: HeadlessOptions): Promise<void> {
  const selection = selectFiles(paths);
  const share = createShare(selection.label, selection.items);
  log(`Sharing ${share.label} (${countOf(share.items.length, "file")}, ${formatBytes(totalSize(share.items))})`);

  const firstDownload = Promise.withResolvers<void>();
  await using server = await startServer({
    port,
    source: selection.source,
    onDownload: async (download) => {
      if (await reportDownload(download)) firstDownload.resolve();
    },
  });
  server.publish(share);

  if (!local) log("Starting the public tunnel...");
  await using tunnel = local ? null : await startTunnel(server.origin);
  const origin = tunnel?.url ?? server.origin;
  if (tunnel && !(await waitUntilReachable(`${origin}/health`))) log("The link is not reachable from here yet. It may need another minute.");

  console.log(`${origin}/s/${share.token}/download`);
  log(`Share page: ${origin}/s/${share.token}`);
  log(once ? "Waiting for the download. Press Ctrl+C to cancel." : "Sharing until you press Ctrl+C.");

  const done = once ? firstDownload.promise.then(() => sleep(local ? 0 : TUNNEL_DRAIN_MS)) : undefined;
  await waitForShutdown(tunnel, done);
}
