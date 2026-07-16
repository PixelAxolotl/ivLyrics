param(
    [string]$AppDir = ""
)

$ErrorActionPreference = "Stop"
$ProtocolName = "ivlyrics-updater"
$UpdaterRoot = Join-Path $env:LOCALAPPDATA "ivLyrics\Updater"
$AppName = "ivLyrics"

function Get-SpicetifyAppDir {
    $configDirOutput = & spicetify config-dir 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not resolve the Spicetify config directory: $configDirOutput"
    }

    $configDir = ($configDirOutput | Select-Object -Last 1).ToString().Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($configDir)) {
        throw "Spicetify returned an empty config directory."
    }

    return Join-Path (Join-Path $configDir "CustomApps") $AppName
}

function Connect-SpicetifyAppDir {
    param([string]$SourceAppDir)

    $sourcePath = [IO.Path]::GetFullPath($SourceAppDir).TrimEnd('\', '/')
    $configuredPath = [IO.Path]::GetFullPath((Get-SpicetifyAppDir)).TrimEnd('\', '/')

    if ($sourcePath.Equals($configuredPath, [StringComparison]::OrdinalIgnoreCase)) {
        return
    }

    if (-not (Test-Path -LiteralPath (Join-Path $sourcePath "index.js")) -or
        -not (Test-Path -LiteralPath (Join-Path $sourcePath "manifest.json"))) {
        throw "ivLyrics app files were not found in: $sourcePath"
    }

    $configuredParent = Split-Path -Parent $configuredPath
    New-Item -ItemType Directory -Force -Path $configuredParent | Out-Null

    if (Test-Path -LiteralPath $configuredPath) {
        $configuredItem = Get-Item -LiteralPath $configuredPath -Force
        if (-not ($configuredItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Write-Host "Using existing ivLyrics app directory: $configuredPath"
            return
        }

        $linkTarget = @($configuredItem.Target) | Select-Object -First 1
        if (-not [string]::IsNullOrWhiteSpace($linkTarget)) {
            $resolvedTarget = [IO.Path]::GetFullPath($linkTarget).TrimEnd('\', '/')
            if ($sourcePath.Equals($resolvedTarget, [StringComparison]::OrdinalIgnoreCase)) {
                return
            }
        }

        Remove-Item -LiteralPath $configuredPath -Force
    }

    New-Item -ItemType Junction -Path $configuredPath -Target $sourcePath | Out-Null
    Write-Host "Connected ivLyrics to Spicetify app directory: $configuredPath"
}

if ([string]::IsNullOrWhiteSpace($AppDir)) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

Connect-SpicetifyAppDir -SourceAppDir $AppDir

$SourceScript = Join-Path $PSScriptRoot "ivlyrics-updater.ps1"
if (-not (Test-Path -LiteralPath $SourceScript)) {
    throw "Updater script not found: $SourceScript"
}

New-Item -ItemType Directory -Force -Path $UpdaterRoot | Out-Null
$TargetScript = Join-Path $UpdaterRoot "ivlyrics-updater.ps1"
Copy-Item -LiteralPath $SourceScript -Destination $TargetScript -Force

$PowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Command = "`"$PowerShellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$TargetScript`" `"%1`""
$ProtocolRoot = "HKCU:\Software\Classes\$ProtocolName"

New-Item -Path $ProtocolRoot -Force | Out-Null
Set-Item -Path $ProtocolRoot -Value "URL:ivLyrics Updater Protocol"
Set-ItemProperty -Path $ProtocolRoot -Name "URL Protocol" -Value ""

New-Item -Path "$ProtocolRoot\DefaultIcon" -Force | Out-Null
Set-Item -Path "$ProtocolRoot\DefaultIcon" -Value "`"$PowerShellExe`",0"

New-Item -Path "$ProtocolRoot\shell\open\command" -Force | Out-Null
Set-Item -Path "$ProtocolRoot\shell\open\command" -Value $Command

Write-Host "Registered ${ProtocolName}:// protocol."
