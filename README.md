# SendIt

Temporary file sharing from a Windows PC. Files stream from the sender's browser while the recipient downloads. The link dies with the process.

The browser interface is built with [VRUI](https://github.com/vaakx-dev/vrui), another one of my projects.

![SendIt demo: select files, create a link, recipient downloads](demo.gif)

## Requirements

- Windows 10 or 11
- Node.js 22 or newer

The first public run downloads `cloudflared` 2026.8.2 into `%LOCALAPPDATA%\sendit\bin`. SendIt verifies the release SHA-256 hash and executable version before use.

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
sendit
```

Select files or a folder on the control page, create the link, and keep the window open until the download finishes. `Ctrl+C` stops sharing.

## Uninstall

```powershell
sendit --uninstall              # removes the cloudflared helper and SendIt data
npm uninstall --global sendit   # removes the sendit command
```

## Development

```powershell
npm run dev          # build and run locally, no public tunnel
npm test             # quick correctness checks
npm run test:stress  # 2+ GiB and 100,000-file checks
npm run test:speed   # local upload/download throughput
```

The speed test transfers 1 GiB by default without storing it. To choose another size:

```powershell
$env:SENDIT_SPEED_MIB=4096; npm run test:speed
```

## How it works

```text
sender browser -> local SendIt process -> Cloudflare Quick Tunnel -> recipient browser
```

Chunks stream one at a time with backpressure. Folder downloads are zipped as they stream, never staged on disk. SendIt cancels a transfer after 30 seconds without progress.

## Security

- The control page requires a random key and is served only on localhost.
- Share links carry a random 192-bit token and die with the process.
- Only explicitly selected files are served; there is no file-system browsing API.
- Traffic passes through Cloudflare. Add encryption before sharing sensitive files.
