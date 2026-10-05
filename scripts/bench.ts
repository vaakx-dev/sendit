import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format_bytes, format_seconds } from "../src/output.js";
import { collect } from "../src/share/collect.js";
import { serve } from "../src/share/server.js";

const MIB = 1024 * 1024;
const LARGE_FILE_MIB = Number(process.argv[2] ?? 1024);
const SMALL_FILE_COUNT = 10_000;
const SMALL_FILE_BYTES = 16 * 1024;

const workspace = mkdtempSync(join(tmpdir(), "sendit-bench-"));
process.on("exit", () => rmSync(workspace, { recursive: true, force: true }));

const large_folder = create_large_folder(join(workspace, "large"));
const small_folder = create_small_folder(join(workspace, "small"));

console.log("Local throughput, without the tunnel:");
await measure("single file", [join(large_folder, "large.bin")]);
await measure("zip of one large file", [large_folder]);
await measure(`zip of ${SMALL_FILE_COUNT.toLocaleString("en-US")} small files`, [small_folder]);

async function measure(label: string, paths: string[]): Promise<void> {
  await using server = await serve(collect(paths), () => {});
  const started = performance.now();
  const bytes = await download(server.origin + server.path);
  const elapsed = performance.now() - started;
  const speed = bytes / MIB / (elapsed / 1000);
  console.log(`  ${label.padEnd(28)} ${format_bytes(bytes).padStart(9)} in ${format_seconds(elapsed).padStart(6)}   ${speed.toFixed(0)} MiB/s`);
}

async function download(url: string): Promise<number> {
  const response = await fetch(url);
  let bytes = 0;
  for await (const chunk of response.body ?? []) bytes += chunk.byteLength;
  return bytes;
}

function create_large_folder(folder: string): string {
  const file = join(folder, "large.bin");
  mkdirSync(folder);
  writeFileSync(file, "");
  truncateSync(file, LARGE_FILE_MIB * MIB);
  return folder;
}

function create_small_folder(folder: string): string {
  const content = Buffer.alloc(SMALL_FILE_BYTES, 1);
  mkdirSync(folder);
  for (let index = 0; index < SMALL_FILE_COUNT; index += 1) writeFileSync(join(folder, `${index}.bin`), content);
  return folder;
}
