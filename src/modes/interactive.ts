import { spawn } from "node:child_process";
import { log, reportDownload } from "../output.js";
import { startServer } from "../server/server.js";
import { createShare } from "../share.js";
import { countOf } from "../shared/format.js";
import { BrowserSender } from "../sources/browser-sender.js";
import { startTunnel } from "../tunnel/tunnel.js";
import { waitForShutdown } from "./shutdown.js";

export interface InteractiveOptions {
  readonly port: number;
  readonly local: boolean;
  readonly openBrowser: boolean;
}

export async function shareInteractively({ port, local, openBrowser }: InteractiveOptions): Promise<void> {
  let publicUrl = "";
  using sender = new BrowserSender((label, items) => {
    const share = createShare(label, items);
    const link = `${publicUrl}/s/${share.token}`;
    server.publish(share);
    log(`Share ready: ${link} (${countOf(items.length, "file")})`);
    return link;
  });
  await using server = await startServer({ port, source: sender, control: sender, onDownload: reportDownload });

  if (!local) log("Starting the public tunnel...");
  await using tunnel = local ? null : await startTunnel(server.origin);
  publicUrl = tunnel?.url ?? server.origin;
  const controlUrl = `${server.origin}/?key=${sender.key}`;

  log();
  log("SendIt is ready");
  log(`Control panel: ${controlUrl}`);
  if (tunnel) log(`Temporary tunnel: ${tunnel.url}`);
  log();
  log("Keep this window open while the link is up.");
  log("Press Ctrl+C to stop sharing.");
  log();

  if (openBrowser) launchBrowser(controlUrl);
  await waitForShutdown(tunnel);
  log("Stopping SendIt...");
}

function launchBrowser(url: string): void {
  spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
