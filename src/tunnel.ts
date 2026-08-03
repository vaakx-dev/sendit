import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DOWNLOAD_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

export interface Tunnel {
  url: string;
  stop(): Promise<void>;
}

export function extract_tunnel_url(output: string): string | null {
  return output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] ?? null;
}

export async function start_quick_tunnel(origin: string, on_status?: (message: string) => void): Promise<Tunnel> {
  const executable = await resolve_cloudflared(on_status);
  const process = spawn(executable, ["tunnel", "--no-autoupdate", "--url", origin], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error(`Cloudflare did not create a tunnel within 30 seconds.\n${output.slice(-2000)}`));
    }, 30_000);

    const inspect = (chunk: Buffer) => {
      output += chunk.toString();
      output = output.slice(-8_000);
      const tunnel_url = extract_tunnel_url(output);
      if (!tunnel_url) return;
      clearTimeout(timeout);
      resolve(tunnel_url);
    };
    process.stdout.on("data", inspect);
    process.stderr.on("data", inspect);
    process.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Cloudflare tunnel stopped before it was ready (exit ${code ?? "unknown"}).\n${output.slice(-2000)}`));
    });
  });

  return {
    url,
    async stop() {
      await stop_process(process);
    },
  };
}

async function resolve_cloudflared(on_status?: (message: string) => void): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("SendIt currently supports Windows only.");
  }
  if (await command_works("cloudflared")) return "cloudflared";

  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const directory = join(base, "sendit", "bin");
  const executable = join(directory, "cloudflared.exe");
  try {
    await access(executable);
    return executable;
  } catch {
    on_status?.("Downloading the official Cloudflare tunnel helper for first use...");
  }

  await mkdir(directory, { recursive: true });
  const temporary = `${executable}.${process.pid}.download`;
  try {
    const response = await fetch(DOWNLOAD_URL, {
      headers: { "User-Agent": "sendit-local" },
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}.`);
    }
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary));
    await chmod(temporary, 0o755);
    await rename(temporary, executable);
    return executable;
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`Could not install the Cloudflare tunnel helper: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function command_works(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(command, ["--version"], { stdio: "ignore", windowsHide: true });
    probe.once("error", () => resolve(false));
    probe.once("exit", (code) => resolve(code === 0));
  });
}

async function stop_process(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}
