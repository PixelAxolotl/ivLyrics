param(
    [string]$Uri = "ivlyrics-updater://update"
)

$ErrorActionPreference = "Stop"
$InstallerUrl = "https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater/install.ps1"
$UpdaterRoot = Join-Path $env:LOCALAPPDATA "ivLyrics\Updater"
$LogPath = Join-Path $UpdaterRoot "updater.log"

function Write-UpdaterLog {
    param([string]$Message)
    New-Item -ItemType Directory -Force -Path $UpdaterRoot | Out-Null
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    Write-Host $Message
}

function Get-UpdaterAction {
    param([string]$RawUri)

    if ([string]::IsNullOrWhiteSpace($RawUri)) {
        return "update"
    }

    try {
        $parsed = [Uri]$RawUri
    }
    catch {
        throw "Invalid updater URI."
    }

    if ($parsed.Scheme -ne "ivlyrics-updater") {
        throw "Unsupported updater URI scheme."
    }

    $action = $parsed.Host
    if ([string]::IsNullOrWhiteSpace($action)) {
        $action = $parsed.AbsolutePath.Trim("/")
    }

    if ([string]::IsNullOrWhiteSpace($action)) {
        return "update"
    }

    $action = $action.ToLowerInvariant()
    switch ($action) {
        "update" { return "update" }
        "open-log" { return "open-log" }
        default { throw "Unsupported updater action: $action" }
    }
}

function Start-IvLyricsUpdate {
    Write-UpdaterLog "Starting ivLyrics update."

    $tempRoot = Join-Path $env:TEMP "ivLyrics-updater"
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    $installerPath = Join-Path $tempRoot "install.ps1"

    Write-UpdaterLog "Downloading official installer."
    Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -OutFile $installerPath

    Write-UpdaterLog "Running installer."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerPath
    if ($LASTEXITCODE -ne 0) {
        throw "Installer exited with code $LASTEXITCODE."
    }

    Write-UpdaterLog "ivLyrics update completed."
}

try {
    $action = Get-UpdaterAction -RawUri $Uri

    switch ($action) {
        "update" {
            Start-IvLyricsUpdate
            Start-Sleep -Seconds 2
        }
        "open-log" {
            New-Item -ItemType Directory -Force -Path $UpdaterRoot | Out-Null
            if (-not (Test-Path -LiteralPath $LogPath)) {
                New-Item -ItemType File -Force -Path $LogPath | Out-Null
            }
            Start-Process notepad.exe -ArgumentList "`"$LogPath`""
        }
    }
}
catch {
    Write-UpdaterLog ("Update failed: " + $_.Exception.Message)
    Write-Host ""
    Write-Host "ivLyrics update failed. You can run the manual command instead:"
    Write-Host "iwr -useb https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater/install.ps1 | iex"
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
