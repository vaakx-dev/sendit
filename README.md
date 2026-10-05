# SendIt

Temporary file sharing from a Windows PC. Pick files in the browser, or share them straight from the command line. Files stream while the recipient downloads, and the link dies with the process.

The browser interface is built with [VRUI](https://github.com/vaakx-dev/vrui), another one of my projects.

![SendIt demo: select files, create a link, recipient downloads](demo.gif)

## Requirements

- Windows 10 or 11
- Node.js 22 or newer

The first public run downloads `cloudflared` 2026.8.2 into `%LOCALAPPDATA%\sendit\bin`. SendIt verifies its SHA-256 hash on every run.

## Install

Copy and paste this into PowerShell:

```powershell
irm https://raw.githubusercontent.com/vaakx-dev/sendit/main/install.ps1 | iex
```

Or install manually:

```powershell
git clone https://github.com/vaakx-dev/sendit.git
cd sendit
npm install
npm run build
npm install --global .
```

## Use

### In the browser

```powershell
sendit
```

Select files or a folder on the control page, create the link, and keep the window open until the download finishes. `Ctrl+C` stops sharing.

### From the command line

```powershell
sendit report.pdf           # share one file
sendit .\project            # share a folder as project.zip
sendit notes.md .\photos    # share several things as one ZIP
sendit report.pdf --once    # exit after the first download
```

SendIt prints the download link once it works. One file downloads as itself; anything else downloads as a ZIP. Folders skip `.git` and anything matched by a `.gitignore`. Recipients can also open the share page, which is printed alongside the link.

| Option        | Effect                                                 |
| ------------- | ------------------------------------------------------ |
| `--once`      | Exit after the first completed download                |
| `--no-open`   | Do not open the browser                                |
| `--local`     | Serve on `127.0.0.1` only, without a public tunnel     |
| `--port <n>`  | Use a fixed local port                                 |
| `--uninstall` | Remove the cloudflared helper and SendIt data          |

### From scripts and agents

Command-line sharing writes exactly one line to stdout: the download link, once it is reachable. Everything else goes to stderr. With `--once`, SendIt exits with code 0 after the first completed download. Errors exit with code 1.

```bash
sendit build.zip --once > link.txt &   # link.txt fills in when the link is live
```

## Uninstall

```powershell
sendit --uninstall              # removes the cloudflared helper and SendIt data
npm uninstall --global sendit   # removes the sendit command
```

## Development

```powershell
npm run dev             # build and open the browser mode locally, no public tunnel
npm run bench           # local throughput: disk, ZIP, and the browser protocol
npm run bench -- 4096   # same, with a 4 GiB file
npm run demo            # record the README GIF with headless Chrome
```

```text
src/
  cli.ts              options, then browser mode or command-line mode
  output.ts           terminal output
  share.ts            the share model
  modes/              interactive (browser) and headless (command line) flows
  server/             HTTP routes, downloads, static assets
  sources/            where file bytes come from: the browser or the disk
  tunnel/             cloudflared and the quick tunnel
  shared/             protocol types and formatting used by server and browser
  client/             the browser pages
```

## How it works

```text
sender browser or disk -> local SendIt process -> Cloudflare Quick Tunnel -> recipient
```

Browser uploads stream one chunk at a time with backpressure. ZIP downloads are built as they stream and never staged on disk. A browser transfer is cancelled after 30 seconds without progress.

## Security

- The control page requires a random key and is served only on localhost.
- Share links carry a random 192-bit token and die with the process.
- Only explicitly selected files are served; there is no file-system browsing API.
- Traffic passes through Cloudflare. Add encryption before sharing sensitive files.
