import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const CLOUDFLARED_VERSION = "2026.8.2";
export const CLOUDFLARED_SHA256 = "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5";
export const CLOUDFLARED_DOWNLOAD_URL =
  `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`;

export type TunnelClose =
  | { type: "stopped" }
  | { type: "failed"; error: Error };

export interface Tunnel {
  url: string;
  closed: Promise<TunnelClose>;
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
  return await monitor_tunnel_process(process);
}

export async function monitor_tunnel_process(
  process: ChildProcess,
  startup_timeout_ms = 30_000,
): Promise<Tunnel> {
  const stdout = process.stdout;
  const stderr = process.stderr;
  if (!stdout || !stderr) throw new Error("Cloudflare tunnel output is unavailable.");

  let output = "";
  let ready = false;
  let stopping = false;
  let close_reported = false;
  let report_close: (result: TunnelClose) => void = () => {};
  const closed = new Promise<TunnelClose>((resolve) => {
    report_close = resolve;
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      stopping = true;
      process.kill();
      const seconds = Math.ceil(startup_timeout_ms / 1000);
      reject(new Error(`Cloudflare did not create a tunnel within ${seconds} seconds.\n${output.slice(-2000)}`));
    }, startup_timeout_ms);

    const inspect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-8_000);
      if (ready) return;
      const tunnel_url = extract_tunnel_url(output);
      if (!tunnel_url) return;
      ready = true;
      clearTimeout(timeout);
      resolve(tunnel_url);
    };
    const report_process_close = (error: Error) => {
      clearTimeout(timeout);
      if (!ready) {
        reject(error);
        return;
      }
      if (close_reported) return;
      close_reported = true;
      report_close(stopping ? { type: "stopped" } : { type: "failed", error });
    };

    stdout.on("data", inspect);
    stderr.on("data", inspect);
    process.once("error", (error) => report_process_close(error));
    process.once("exit", (code, signal) => {
      const reason = code === null ? `signal ${signal ?? "unknown"}` : `exit ${code}`;
      report_process_close(new Error(`Cloudflare tunnel stopped with ${reason}.\n${output.slice(-2000)}`));
    });
  });

  return {
    url,
    closed,
    async stop() {
      stopping = true;
      await stop_process(process);
      if (!close_reported) {
        close_reported = true;
        report_close({ type: "stopped" });
      }
      await closed;
    },
  };
}

export async function file_matches_sha256(path: string, expected: string): Promise<boolean> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === expected.toLowerCase();
  } catch {
    return false;
  }
}

export function probe_executable_version(
  executable: string,
  expected_version: string,
  timeout_ms = 5_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(executable, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeout_ms);
    const inspect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-2_000);
    };
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout?.on("data", inspect);
    child.stderr?.on("data", inspect);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0 && output.includes(expected_version)));
  });
}

async function resolve_cloudflared(on_status?: (message: string) => void): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("SendIt currently supports Windows only.");
  }

  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const directory = join(base, "sendit", "bin");
  const executable = join(directory, `cloudflared-${CLOUDFLARED_VERSION}-windows-amd64.exe`);
  if (await verified_cloudflared(executable)) return executable;

  on_status?.(`Downloading verified cloudflared ${CLOUDFLARED_VERSION} for first use...`);
  await mkdir(directory, { recursive: true });
  await rm(executable, { force: true });
  const temporary = `${executable}.${process.pid}.download`;
  try {
    const response = await fetch(CLOUDFLARED_DOWNLOAD_URL, {
      headers: { "User-Agent": "sendit" },
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}.`);
    }
    await pipeline(Readable.from(response.body), createWriteStream(temporary));
    if (!await file_matches_sha256(temporary, CLOUDFLARED_SHA256)) {
      throw new Error("The downloaded cloudflared checksum did not match the pinned release.");
    }
    await chmod(temporary, 0o755);
    if (!await probe_executable_version(temporary, CLOUDFLARED_VERSION)) {
      throw new Error("The downloaded cloudflared executable did not report the pinned version.");
    }
    try {
      await rename(temporary, executable);
    } catch (error) {
      if (!await verified_cloudflared(executable)) throw error;
      await rm(temporary, { force: true });
    }
    return executable;
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`Could not install the Cloudflare tunnel helper: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verified_cloudflared(executable: string): Promise<boolean> {
  return await file_matches_sha256(executable, CLOUDFLARED_SHA256) &&
    await probe_executable_version(executable, CLOUDFLARED_VERSION);
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
