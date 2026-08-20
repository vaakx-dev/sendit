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

export function extractTunnelUrl(output: string): string | null {
  return output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] ?? null;
}

export async function startQuickTunnel(origin: string, onStatus?: (message: string) => void): Promise<Tunnel> {
  const executable = await resolveCloudflared(onStatus);
  const process = spawn(executable, ["tunnel", "--no-autoupdate", "--url", origin], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return await monitorTunnelProcess(process);
}

export async function monitorTunnelProcess(
  process: ChildProcess,
  startupTimeoutMs = 30_000,
): Promise<Tunnel> {
  const stdout = process.stdout;
  const stderr = process.stderr;
  if (!stdout || !stderr) throw new Error("Cloudflare tunnel output is unavailable.");

  let output = "";
  let ready = false;
  let stopping = false;
  let closeReported = false;
  let reportClose: (result: TunnelClose) => void = () => {};
  const closed = new Promise<TunnelClose>((resolve) => {
    reportClose = resolve;
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      stopping = true;
      process.kill();
      const seconds = Math.ceil(startupTimeoutMs / 1000);
      reject(new Error(`Cloudflare did not create a tunnel within ${seconds} seconds.\n${output.slice(-2000)}`));
    }, startupTimeoutMs);

    const inspect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-8_000);
      if (ready) return;
      const tunnelUrl = extractTunnelUrl(output);
      if (!tunnelUrl) return;
      ready = true;
      clearTimeout(timeout);
      resolve(tunnelUrl);
    };
    const reportProcessClose = (error: Error) => {
      clearTimeout(timeout);
      if (!ready) {
        reject(error);
        return;
      }
      if (closeReported) return;
      closeReported = true;
      reportClose(stopping ? { type: "stopped" } : { type: "failed", error });
    };

    stdout.on("data", inspect);
    stderr.on("data", inspect);
    process.once("error", (error) => reportProcessClose(error));
    process.once("exit", (code, signal) => {
      const reason = code === null ? `signal ${signal ?? "unknown"}` : `exit ${code}`;
      reportProcessClose(new Error(`Cloudflare tunnel stopped with ${reason}.\n${output.slice(-2000)}`));
    });
  });

  return {
    url,
    closed,
    async stop() {
      stopping = true;
      await stopProcess(process);
      if (!closeReported) {
        closeReported = true;
        reportClose({ type: "stopped" });
      }
      await closed;
    },
  };
}

export async function fileMatchesSha256(path: string, expected: string): Promise<boolean> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === expected.toLowerCase();
  } catch {
    return false;
  }
}

export function probeExecutableVersion(
  executable: string,
  expectedVersion: string,
  timeoutMs = 5_000,
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
    }, timeoutMs);
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
    child.once("exit", (code) => finish(code === 0 && output.includes(expectedVersion)));
  });
}

async function resolveCloudflared(onStatus?: (message: string) => void): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("SendIt currently supports Windows only.");
  }

  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const directory = join(base, "sendit", "bin");
  const executable = join(directory, `cloudflared-${CLOUDFLARED_VERSION}-windows-amd64.exe`);
  if (await verifiedCloudflared(executable)) return executable;

  onStatus?.(`Downloading verified cloudflared ${CLOUDFLARED_VERSION} for first use...`);
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
    if (!await fileMatchesSha256(temporary, CLOUDFLARED_SHA256)) {
      throw new Error("The downloaded cloudflared checksum did not match the pinned release.");
    }
    await chmod(temporary, 0o755);
    if (!await probeExecutableVersion(temporary, CLOUDFLARED_VERSION)) {
      throw new Error("The downloaded cloudflared executable did not report the pinned version.");
    }
    try {
      await rename(temporary, executable);
    } catch (error) {
      if (!await verifiedCloudflared(executable)) throw error;
      await rm(temporary, { force: true });
    }
    return executable;
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`Could not install the Cloudflare tunnel helper: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifiedCloudflared(executable: string): Promise<boolean> {
  return await fileMatchesSha256(executable, CLOUDFLARED_SHA256) &&
    await probeExecutableVersion(executable, CLOUDFLARED_VERSION);
}

async function stopProcess(child: ChildProcess): Promise<void> {
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
