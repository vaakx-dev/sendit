#!/usr/bin/env node
import { parseArgs } from "node:util";
import { shareFromDisk } from "./modes/headless.js";
import { shareInteractively } from "./modes/interactive.js";
import { log } from "./output.js";
import { removeAppData } from "./tunnel/cloudflared.js";

const HELP = `Usage:
  sendit                       Pick files in the browser and share them
  sendit <file or folder>...   Share files straight from the command line

Options:
  --once        Exit after the first completed download (command line only)
  --no-open     Do not open the browser
  --local       Serve on 127.0.0.1 only, without a public tunnel
  --port <n>    Local port (default: random)
  --uninstall   Remove the cloudflared helper and SendIt data
  -h, --help    Show this help

Command-line sharing prints the download link to stdout once it works.
One file downloads as itself; anything else downloads as a ZIP. Folders skip
.git and anything matched by .gitignore. Everything else goes to stderr.`;

main(process.argv.slice(2)).catch((error: Error) => {
  log(`SendIt could not continue: ${error.message}`);
  process.exitCode = 1;
});

async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      once: { type: "boolean", default: false },
      "no-open": { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      port: { type: "string", default: "0" },
      uninstall: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) return console.log(HELP);
  if (values.uninstall) return log(`Removed ${removeAppData()}. To remove the command itself, run: npm uninstall --global sendit`);

  const port = parsePort(values.port);
  if (positionals.length > 0) return shareFromDisk({ paths: positionals, port, local: values.local, once: values.once });
  return shareInteractively({ port, local: values.local, openBrowser: !values["no-open"] });
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port must be a number from 0 to 65535, not ${value}.`);
  return port;
}
