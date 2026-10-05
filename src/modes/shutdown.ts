import type { Tunnel } from "../tunnel/tunnel.js";

const NEVER = new Promise<never>(() => {});

export async function waitForShutdown(tunnel: Tunnel | null, done: Promise<void> = NEVER): Promise<void> {
  const interrupted = new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  const outcome = await Promise.race([interrupted, done, tunnel?.exited ?? NEVER]);
  if (outcome instanceof Error) throw outcome;
}
