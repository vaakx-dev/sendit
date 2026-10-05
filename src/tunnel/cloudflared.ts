import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { log } from "../output.js";

const VERSION = "2026.8.2";
const SHA256 = "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5";
const RELEASE_URL = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-windows-amd64.exe`;
const DATA_DIRECTORY = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "sendit");
const EXECUTABLE = join(DATA_DIRECTORY, "bin", `cloudflared-${VERSION}-windows-amd64.exe`);

export async function ensureCloudflared(): Promise<string> {
  if (process.platform !== "win32") throw new Error("SendIt currently supports Windows only.");
  if (!isVerified(EXECUTABLE)) await download();
  return EXECUTABLE;
}

export function removeAppData(): string {
  rmSync(DATA_DIRECTORY, { recursive: true, force: true });
  return DATA_DIRECTORY;
}

async function download(): Promise<void> {
  log(`Downloading verified cloudflared ${VERSION} for first use...`);
  const response = await fetch(RELEASE_URL);
  if (!response.ok) throw new Error(`Could not download cloudflared (HTTP ${response.status}).`);

  const binary = Buffer.from(await response.arrayBuffer());
  if (sha256(binary) !== SHA256) throw new Error("The downloaded cloudflared does not match its pinned checksum.");
  mkdirSync(dirname(EXECUTABLE), { recursive: true });
  writeFileSync(EXECUTABLE, binary);
}

function isVerified(path: string): boolean {
  return existsSync(path) && sha256(readFileSync(path)) === SHA256;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
