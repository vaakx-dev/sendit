import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const outputUrl = new URL("../dist/src/web/", import.meta.url);
await rm(outputUrl, { recursive: true, force: true });
await mkdir(outputUrl, { recursive: true });

await build({
  entryPoints: {
    sender: fileURLToPath(new URL("../src/client/sender.ts", import.meta.url)),
    receiver: fileURLToPath(new URL("../src/client/receiver.ts", import.meta.url)),
  },
  bundle: true,
  format: "iife",
  outdir: fileURLToPath(outputUrl),
  platform: "browser",
  sourcemap: true,
  target: "es2022",
});

for (const asset of ["styles.css", "sender.html", "receiver.html"]) {
  await cp(new URL(`../src/client/${asset}`, import.meta.url), new URL(asset, outputUrl));
}
