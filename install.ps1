function Install-SendIt {
    $ErrorActionPreference = "Stop"
    $Repository = "https://github.com/vaakx-dev/sendit.git"
    $Directory = Join-Path $env:LOCALAPPDATA "sendit\repo"

    if (-not (Test-Node)) { Write-Failure "SendIt needs Node.js 22 or newer: https://nodejs.org/"; return }
    if (-not (Test-Command git)) { Write-Failure "SendIt needs Git: https://git-scm.com/download/win"; return }

    if (Test-Path $Directory) {
        Write-Step "Updating SendIt"
        Invoke-Native { git -C $Directory fetch --quiet origin main }
        Invoke-Native { git -C $Directory reset --quiet --hard origin/main }
    } else {
        Write-Step "Downloading SendIt"
        Invoke-Native { git clone --quiet $Repository $Directory }
    }

    Write-Step "Building SendIt"
    Invoke-Native { npm.cmd --prefix $Directory ci --silent }
    Invoke-Native { npm.cmd --prefix $Directory run build --silent }
    Invoke-Native { npm.cmd install --global --silent $Directory }

    Write-Host "SendIt is installed. Run 'sendit <file or folder>' to share." -ForegroundColor Green
}

function Test-Node {
    if (-not (Test-Command node)) { return $false }
    return [version](node --version).TrimStart("v") -ge [version]"22.0"
}

function Test-Command([string] $Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native([scriptblock] $Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Exit code ${LASTEXITCODE}: $Command" }
}

function Write-Step([string] $Message) {
    Write-Host "$Message..." -ForegroundColor Cyan
}

function Write-Failure([string] $Message) {
    Write-Host $Message -ForegroundColor Red
}

Install-SendIt
