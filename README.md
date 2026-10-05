# SendIt

Share files from a Windows PC through a temporary public link, straight from the command line. Files stream from disk while the recipient downloads. The link dies with the process.

## Requirements

- Windows 10 or 11
- Node.js 22 or newer

The first run downloads `cloudflared` 2026.8.2 into `%LOCALAPPDATA%\sendit\bin` and verifies its SHA-256 hash.

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

```powershell
sendit report.pdf           # share one file
sendit .\project            # share a folder as project.zip
sendit notes.md .\photos    # share several things as sendit.zip
sendit report.pdf --once    # stop after the first download
```

SendIt prints the link once it works. Keep the window open until the download finishes. `Ctrl+C` stops sharing.

One file is sent as itself. Folders and multiple files are zipped on the fly. `.git` folders and anything matched by a `.gitignore` are skipped.

| Option        | Effect                                           |
| ------------- | ------------------------------------------------ |
| `--once`      | Exit after the first completed download          |
| `--local`     | Serve on `127.0.0.1` only, without a tunnel      |
| `--uninstall` | Remove the downloaded `cloudflared` helper       |

## Scripts and agents

stdout gets exactly one line: the link, written once it is reachable. Progress goes to stderr. With `--once`, SendIt exits with code 0 after the first download. Errors exit with code 1.

```bash
sendit build.zip --once > link.txt &   # link.txt fills in when the link is live
```

## Uninstall

```powershell
sendit --uninstall              # removes the cloudflared helper
npm uninstall --global sendit   # removes the sendit command
```

## Development

```powershell
npm run build                      # compile to dist/
npm run bench                      # local throughput: 1 GiB file, ZIP, 10,000 small files
npm run bench -- 4096              # same, with a 4 GiB file
node dist/cli.js --local file.txt  # try it without a public tunnel
```

```text
src/
  cli.ts              options and the share lifecycle
  output.ts           logging and formatting
  share/
    collect.ts        paths -> files, honoring .gitignore
    content.ts        the file itself or a streamed ZIP
    server.ts         serves the share at a secret path
  tunnel/
    cloudflared.ts    pinned, checksum-verified cloudflared
    tunnel.ts         quick tunnel startup and reachability
```

## How it works

```text
files on disk -> local SendIt server -> Cloudflare Quick Tunnel -> recipient
```

Files are read only when someone downloads them. Folders are zipped as they stream, never staged on disk.

## Security

- Links carry a random 192-bit token and die with the process.
- Only the files chosen at startup are served. There is no browsing.
- Anyone with the link can download until SendIt exits. Use `--once` to stop after one download.
- Traffic passes through Cloudflare. Encrypt sensitive files before sharing.
