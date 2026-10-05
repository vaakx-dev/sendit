import type { Download } from "./server/downloads.js";
import { formatBytes } from "./shared/format.js";

export function log(message = ""): void {
  console.error(message);
}

export async function reportDownload({ id, name, size, finished }: Download): Promise<boolean> {
  const started = performance.now();
  log(`Download ${id} started: ${name} (${formatBytes(size)})`);

  const error = await finished;
  if (error) log(`Download ${id} failed: ${error.message}`);
  else log(`Download ${id} finished in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return !error;
}
