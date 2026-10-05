import { spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureCloudflared } from "./cloudflared.js";

export interface Tunnel extends AsyncDisposable {
  readonly url: string;
  readonly exited: Promise<Error>;
}

const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 30_000;
const REACHABLE_TIMEOUT_MS = 60_000;
const CLOUDFLARE_DNS = new Resolver({ timeout: 2_000, tries: 1 });
CLOUDFLARE_DNS.setServers(["1.1.1.1"]);

export async function startTunnel(origin: string): Promise<Tunnel> {
  const child = spawn(await ensureCloudflared(), ["tunnel", "--no-autoupdate", "--url", origin], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  let output = "";
  const failure = (message: string) => new Error(`${message}\n${output.slice(-2_000)}`);
  const url = new Promise<string>((resolve) => {
    child.stderr.on("data", (chunk: Buffer) => {
      output = `${output}${chunk}`.slice(-8_000);
      const match = output.match(QUICK_TUNNEL_URL);
      if (match) resolve(match[0]);
    });
  });
  const exited = once(child, "exit").then(([code]) => failure(`Cloudflare tunnel stopped (exit ${code}).`));
  const timedOut = sleep(START_TIMEOUT_MS, null, { ref: false })
    .then(() => failure(`Cloudflare did not create a tunnel within ${START_TIMEOUT_MS / 1000} seconds.`));

  const close = async () => {
    child.kill();
    await exited;
  };
  const started = await Promise.race([url, exited, timedOut]);
  if (started instanceof Error) {
    await close();
    throw started;
  }
  return { url: started, exited, [Symbol.asyncDispose]: close };
}

export async function waitUntilReachable(url: string): Promise<boolean> {
  const { hostname } = new URL(url);
  const deadline = Date.now() + REACHABLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await isUnpublished(hostname)) && (await responds(url))) return true;
    await sleep(1_000);
  }
  return false;
}

function isUnpublished(hostname: string): Promise<boolean> {
  return CLOUDFLARE_DNS.resolve4(hostname).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOTFOUND",
  );
}

function responds(url: string): Promise<boolean> {
  return fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) }).then(
    (response) => response.ok,
    () => false,
  );
}
