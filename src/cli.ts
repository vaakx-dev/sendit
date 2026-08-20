#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppEvent } from "./events.js";
import { startSendItServer } from "./server.js";
import { startQuickTunnel, type Tunnel } from "./tunnel.js";

interface CliOptions {
  local: boolean;
  open: boolean;
  uninstall: boolean;
  port?: number;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.uninstall) {
    await uninstall();
    return;
  }
  let lastProgress = 0;
  const server = await startSendItServer({
    ...(options.port === undefined ? {} : { port: options.port }),
    onEvent(event) {
      lastProgress = printEvent(event, lastProgress);
    },
  });
  let tunnel: Tunnel | null = null;

  try {
    if (options.local) {
      server.setPublicUrl(`http://127.0.0.1:${server.port}`);
      console.log("SendIt is running in local development mode.");
    } else {
      console.log("Starting the public tunnel...");
      tunnel = await startQuickTunnel(`http://127.0.0.1:${server.port}`, (message) => console.log(message));
      server.setPublicUrl(tunnel.url);
    }

    console.log("");
    console.log("SendIt is ready");
    console.log(`Control panel: ${server.adminUrl}`);
    if (tunnel) console.log(`Temporary tunnel: ${tunnel.url}`);
    console.log("");
    console.log("Keep this window open while the link is up.");
    console.log("Press Ctrl+C to stop sharing.");
    console.log("");

    if (options.open) openBrowser(server.adminUrl);
    await waitForShutdown(tunnel);
  } finally {
    console.log("\nStopping SendIt...");
    await tunnel?.stop();
    await server.close();
  }
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = { local: false, open: true, uninstall: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
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
        const value = Number(args[index + 1]);
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

function openBrowser(url: string): void {
  const child = spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function waitForShutdown(tunnel: Tunnel | null): Promise<void> {
  const signal = new Promise<null>((resolve) => {
    process.once("SIGINT", () => resolve(null));
    process.once("SIGTERM", () => resolve(null));
  });
  const closed = tunnel ? await Promise.race([signal, tunnel.closed]) : await signal;
  if (closed?.type === "failed") throw closed.error;
}

function printEvent(event: AppEvent, lastProgress: number): number {
  switch (event.type) {
    case "published":
      console.log(`Share ready: ${event.url}`);
      console.log(`Files selected: ${event.itemCount}`);
      return 0;
    case "downloadStarted":
      console.log(`Download started: ${event.name} (${formatBytes(event.size)})`);
      return 0;
    case "downloadProgress": {
      const percent = event.size === 0 ? 100 : Math.floor((event.written / event.size) * 100);
      if (percent >= lastProgress + 10 || percent === 100) {
        console.log(`Download progress: ${percent}%`);
        return percent;
      }
      return lastProgress;
    }
    case "downloadFinished":
      console.log(`Download finished: ${event.name}`);
      return 0;
    case "downloadFailed":
      console.log(`Download failed: ${event.message}`);
      return 0;
  }
}

function formatBytes(value: number): string {
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
