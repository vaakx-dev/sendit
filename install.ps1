# SendIt one-liner installer
# Usage: irm https://raw.githubusercontent.com/vaakx-dev/sendit/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string]$Command,

        [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$Command failed with exit code $exitCode."
    }
}

function Test-NodeVersion {
    try {
        $node = Invoke-NativeCommand node --version 2>$null
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
        Invoke-NativeCommand git --version | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Install-SendIt {
    $repoUrl = "https://github.com/vaakx-dev/sendit.git"
    $installDir = Join-Path (Join-Path $env:LOCALAPPDATA "sendit") "repo"

    $nodeMajor = Test-NodeVersion
    if ($nodeMajor -lt 22) {
        Write-Host "SendIt requires Node.js 22 or newer." -ForegroundColor Red
        Write-Host "Download it from: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }

    if (-not (Test-Git)) {
        Write-Host "Git is required but not found." -ForegroundColor Red
        Write-Host "Download it from: https://git-scm.com/download/win" -ForegroundColor Yellow
        exit 1
    }

    Push-Location
    try {
        if (Test-Path $installDir) {
            Write-Host "Updating SendIt..." -ForegroundColor Cyan
            Set-Location $installDir
            Invoke-NativeCommand git fetch origin main --quiet
            Invoke-NativeCommand git reset --hard origin/main --quiet
        } else {
            Write-Host "Installing SendIt..." -ForegroundColor Cyan
            New-Item -ItemType Directory -Path (Split-Path $installDir) -Force | Out-Null
            Invoke-NativeCommand git clone $repoUrl $installDir --quiet
            Set-Location $installDir
        }

        Write-Host "Installing dependencies..." -ForegroundColor Cyan
        Invoke-NativeCommand npm ci --silent
        Write-Host "Building..." -ForegroundColor Cyan
        Invoke-NativeCommand npm run build --silent

        Write-Host "Installing sendit command..." -ForegroundColor Cyan
        Invoke-NativeCommand npm install --global . --silent
    } finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "SendIt is installed. Run 'sendit' to start sharing." -ForegroundColor Green
}

if ($MyInvocation.InvocationName -ne ".") {
    Install-SendIt
}
