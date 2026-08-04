# SendIt one-liner installer
# Usage: irm https://raw.githubusercontent.com/vaakx-dev/sendit/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

function Test-NodeVersion {
    try {
        $node = & node --version 2>$null
        if ($node -match "v(\d+)") {
            return [int]$Matches[1]
        }
    } catch {
        return 0
    }
    return 0
}

function Test-Git {
    try {
        & git --version | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Install-SendIt {
    $repoUrl = "https://github.com/vaakx-dev/sendit.git"
    $installDir = Join-Path (Join-Path $env:LOCALAPPDATA "sendit") "repo"

    # Check Node.js
    $nodeMajor = Test-NodeVersion
    if ($nodeMajor -lt 22) {
        Write-Host "SendIt requires Node.js 22 or newer." -ForegroundColor Red
        Write-Host "Download it from: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }

    # Check Git
    if (-not (Test-Git)) {
        Write-Host "Git is required but not found." -ForegroundColor Red
        Write-Host "Download it from: https://git-scm.com/download/win" -ForegroundColor Yellow
        exit 1
    }

    Push-Location

    # Clone or update
    if (Test-Path $installDir) {
        Write-Host "Updating SendIt..." -ForegroundColor Cyan
        Set-Location $installDir
        & git fetch origin main --quiet
        & git reset --hard origin/main --quiet
    } else {
        Write-Host "Installing SendIt..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path (Split-Path $installDir) -Force | Out-Null
        & git clone $repoUrl $installDir --quiet
        Set-Location $installDir
    }

    # Build
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    & npm install --silent
    Write-Host "Building..." -ForegroundColor Cyan
    & npm run build --silent

    # Global install
    Write-Host "Installing sendit command..." -ForegroundColor Cyan
    & npm install --global . --silent

    Pop-Location

    Write-Host ""
    Write-Host "SendIt is installed. Run 'sendit' to start sharing." -ForegroundColor Green
}

Install-SendIt
