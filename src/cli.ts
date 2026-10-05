#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppEvent } from "./events.js";
import { start_sendit_server } from "./server.js";
import { start_quick_tunnel, type Tunnel } from "./tunnel.js";

interface CliOptions {
  local: boolean;
  open: boolean;
  uninstall: boolean;
  port?: number;
}

async function main(): Promise<void> {
  const options = parse_options(process.argv.slice(2));
  if (options.uninstall) {
    await uninstall();
    return;
  }
  let last_progress = 0;
  const server = await start_sendit_server({
    ...(options.port === undefined ? {} : { port: options.port }),
    on_event(event) {
      last_progress = print_event(event, last_progress);
    },
  });
  let tunnel: Tunnel | null = null;

  try {
    if (options.local) {
      server.set_public_url(`http://127.0.0.1:${server.port}`);
      console.log("SendIt is running in local development mode.");
    } else {
      console.log("Starting the public tunnel...");
      tunnel = await start_quick_tunnel(`http://127.0.0.1:${server.port}`, (message) => console.log(message));
      server.set_public_url(tunnel.url);
    }

    console.log("");
    console.log("SendIt is ready");
    console.log(`Control panel: ${server.admin_url}`);
    if (tunnel) console.log(`Temporary tunnel: ${tunnel.url}`);
    console.log("");
    console.log("Keep this window open while the link is up.");
    console.log("Press Ctrl+C to stop sharing.");
    console.log("");

    if (options.open) open_browser(server.admin_url);
    await wait_for_shutdown(tunnel);
  } finally {
    console.log("\nStopping SendIt...");
    await tunnel?.stop();
    await server.close();
  }
}

function parse_options(arguments_: string[]): CliOptions {
  const options: CliOptions = { local: false, open: true, uninstall: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--local":
        options.local = true;
        break;
      case "--no-open":
        options.open = false;
        break;
      case "--uninstall":
        options.uninstall = true;
        break;
      case "--port": {
        const value = Number(arguments_[index + 1]);
        if (!Number.isInteger(value) || value < 0 || value > 65_535) {
          throw new Error("--port must be followed by a valid port number.");
        }
        options.port = value;
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        console.log("Usage: sendit [--no-open] [--port NUMBER] [--local] [--uninstall]");
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function uninstall(): Promise<void> {
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const directory = join(base, "sendit");
  await rm(directory, { recursive: true, force: true });
  console.log(`Removed ${directory} (cloudflared helper and SendIt data).`);
  console.log("To remove the sendit command itself, run: npm uninstall --global sendit");
}

function open_browser(url: string): void {
  const child = spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function wait_for_shutdown(tunnel: Tunnel | null): Promise<void> {
  const signal = new Promise<null>((resolve) => {
    process.once("SIGINT", () => resolve(null));
    process.once("SIGTERM", () => resolve(null));
  });
  const closed = tunnel ? await Promise.race([signal, tunnel.closed]) : await signal;
  if (closed?.type === "failed") throw closed.error;
}

function print_event(event: AppEvent, last_progress: number): number {
  switch (event.type) {
    case "published":
      console.log(`Share ready: ${event.url}`);
      console.log(`Files selected: ${event.item_count}`);
      return 0;
    case "download_started":
      console.log(`Download started: ${event.name} (${format_bytes(event.size)})`);
      return 0;
    case "download_progress": {
      const percent = event.size === 0 ? 100 : Math.floor((event.written / event.size) * 100);
      if (percent >= last_progress + 10 || percent === 100) {
        console.log(`Download progress: ${percent}%`);
        return percent;
      }
      return last_progress;
    }
    case "download_finished":
      console.log(`Download finished: ${event.name}`);
      return 0;
    case "download_failed":
      console.log(`Download failed: ${event.message}`);
      return 0;
  }
}

function format_bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
}

main().catch((error) => {
  console.error(`SendIt could not continue: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
