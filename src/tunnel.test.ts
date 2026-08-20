import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CLOUDFLARED_DOWNLOAD_URL,
  CLOUDFLARED_SHA256,
  CLOUDFLARED_VERSION,
  extractTunnelUrl,
  fileMatchesSha256,
  monitorTunnelProcess,
  probeExecutableVersion,
} from "./tunnel.js";

test("cloudflared release is pinned with a SHA-256 digest", () => {
  assert.equal(CLOUDFLARED_VERSION, "2026.8.2");
  assert.match(CLOUDFLARED_DOWNLOAD_URL, /releases\/download\/2026\.8\.2\/cloudflared-windows-amd64\.exe$/);
  assert.doesNotMatch(CLOUDFLARED_DOWNLOAD_URL, /latest/);
  assert.equal(CLOUDFLARED_SHA256, "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5");
});

test("checks cached file content against the pinned digest", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sendit-hash-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "cloudflared.exe");
  await writeFile(file, "hello");

  assert.equal(
    await fileMatchesSha256(file, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"),
    true,
  );
  assert.equal(await fileMatchesSha256(file, "0".repeat(64)), false);
  assert.equal(await fileMatchesSha256(join(directory, "missing.exe"), CLOUDFLARED_SHA256), false);
});

test("probes an executable version without starting a tunnel", async () => {
  assert.equal(await probeExecutableVersion(process.execPath, process.version), true);
  assert.equal(await probeExecutableVersion(process.execPath, "not-a-node-version"), false);
});

test("reports tunnel failure after readiness", async () => {
  const child = spawn(process.execPath, [
    "-e",
    "console.error('https://focused-test.trycloudflare.com'); setTimeout(() => process.exit(7), 20)",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const tunnel = await monitorTunnelProcess(child, 1_000);

  assert.equal(tunnel.url, "https://focused-test.trycloudflare.com");
  const closed = await tunnel.closed;
  assert.equal(closed.type, "failed");
  if (closed.type === "failed") assert.match(closed.error.message, /exit 7/);
});

test("reports intentional process completion without a failure", async () => {
  const child = spawn(process.execPath, [
    "-e",
    "console.error('https://focused-stop.trycloudflare.com'); setInterval(() => {}, 1000)",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const tunnel = await monitorTunnelProcess(child, 1_000);

  await tunnel.stop();
  assert.deepEqual(await tunnel.closed, { type: "stopped" });
});

test("rejects a tunnel process that exits before readiness", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(3)"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  await assert.rejects(monitorTunnelProcess(child, 1_000), /exit 3/);
});

test("extracts only Cloudflare quick tunnel URLs", () => {
  assert.equal(
    extractTunnelUrl("INF +https://quiet-field-123.trycloudflare.com ready"),
    "https://quiet-field-123.trycloudflare.com",
  );
  assert.equal(extractTunnelUrl("https://example.com"), null);
});
