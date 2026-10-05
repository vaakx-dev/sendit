#!/usr/bin/env node
import { parseArgs } from "node:util";
import { describe_share, format_seconds, log } from "./output.js";
import { collect } from "./share/collect.js";
import { serve, type Download } from "./share/server.js";
import { remove_cloudflared } from "./tunnel/cloudflared.js";
import { open_tunnel, wait_until_reachable } from "./tunnel/tunnel.js";

interface ShareOptions {
  once: boolean;
  local: boolean;
}

const HELP = `Usage: sendit <file or folder>... [options]

Share files through a temporary public link. One file is sent as itself;
folders and multiple files are sent as a ZIP. .git folders and files matched
by .gitignore are skipped. The link stops working when sendit exits.

Options:
  --once       Exit after the first completed download
  --local      Serve on 127.0.0.1 only, without a public tunnel
  --uninstall  Remove the downloaded cloudflared helper
  -h, --help   Show this help

The link is printed to stdout once it works. Everything else goes to stderr.`;

const TUNNEL_DRAIN_MS = 5_000;

main(process.argv.slice(2)).catch((error: Error) => {
  log(`sendit: ${error.message}`);
  process.exitCode = 1;
});

async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      once: { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      uninstall: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) return console.log(HELP);
  if (values.uninstall) return log(`Removed ${remove_cloudflared()}`);
  if (positionals.length === 0) throw new Error("Nothing to share. Run sendit --help for usage.");
  await share_files(positionals, values);
}

async function share_files(paths: string[], { once, local }: ShareOptions): Promise<void> {
  const share = collect(paths);
  log(`Sharing ${describe_share(share)}`);

  const { promise: stopped, resolve: stop } = Promise.withResolvers<Error | void>();

  await using server = await serve(share, async (download) => {
    const completed = await report(download);
    if (completed && once) setTimeout(() => stop(), local ? 0 : TUNNEL_DRAIN_MS);
  });

  if (!local) log("Starting Cloudflare tunnel...");
  await using tunnel = local ? null : await open_tunnel(server.origin);
  tunnel?.exited.then(stop);

  const link = (tunnel?.url ?? server.origin) + server.path;
  if (tunnel && !await wait_until_reachable(link)) log("The link is not reachable from here yet. It may need another minute.");
  console.log(link);
  log(once ? "Waiting for the download. Ctrl+C cancels." : "Sharing until you press Ctrl+C.");

  process.once("SIGINT", () => stop());
  process.once("SIGTERM", () => stop());
  const failure = await stopped;
  if (failure) throw failure;
}

async function report({ id, finished }: Download): Promise<boolean> {
  const started = performance.now();
  log(`Download ${id} started`);

  const error = await finished;
  if (error) log(`Download ${id} stopped: ${error.message}`);
  else log(`Download ${id} finished in ${format_seconds(performance.now() - started)}`);
  return !error;
}
