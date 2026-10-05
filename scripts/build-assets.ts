import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const CLIENT_DIRECTORY = new URL("../src/client/", import.meta.url);
const OUTPUT_DIRECTORY = new URL("../dist/web/", import.meta.url);

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await build({
  entryPoints: {
    sender: fileURLToPath(new URL("sender.ts", CLIENT_DIRECTORY)),
    receiver: fileURLToPath(new URL("receiver.ts", CLIENT_DIRECTORY)),
  },
  bundle: true,
  format: "iife",
  outdir: fileURLToPath(OUTPUT_DIRECTORY),
  platform: "browser",
  sourcemap: true,
  target: "es2022",
});

for (const file of ["sender.html", "receiver.html", "styles.css"]) {
  await cp(new URL(file, CLIENT_DIRECTORY), new URL(file, OUTPUT_DIRECTORY));
}
