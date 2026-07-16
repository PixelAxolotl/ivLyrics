param(
    [string]$AppDir = "",
    [switch]$SkipProtocolRegistration
)

$ErrorActionPreference = "Stop"
$ProtocolName = "ivlyrics-updater"
$UpdaterRoot = Join-Path $env:LOCALAPPDATA "ivLyrics\Updater"
$AppDirectoryStatePath = Join-Path $UpdaterRoot "app-directory-state.json"
$PathUtilsScript = Join-Path $PSScriptRoot "updater-path-utils.ps1"
if (-not (Test-Path -LiteralPath $PathUtilsScript -PathType Leaf)) {
    throw "Updater path utilities were not found: $PathUtilsScript"
}
$SourceScript = Join-Path $PSScriptRoot "ivlyrics-updater.ps1"
if (-not (Test-Path -LiteralPath $SourceScript -PathType Leaf)) {
    throw "Updater script not found: $SourceScript"
}
. $PathUtilsScript

if ([string]::IsNullOrWhiteSpace($AppDir)) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$connection = Connect-SpicetifyAppDir -SourceAppDir $AppDir
Save-IvLyricsAppDirectoryState -Connection $connection -StatePath $AppDirectoryStatePath

New-Item -ItemType Directory -Force -Path $UpdaterRoot | Out-Null
$TargetScript = Join-Path $UpdaterRoot "ivlyrics-updater.ps1"
Copy-Item -LiteralPath $SourceScript -Destination $TargetScript -Force
$TargetPathUtils = Join-Path $UpdaterRoot "updater-path-utils.ps1"
Copy-Item -LiteralPath $PathUtilsScript -Destination $TargetPathUtils -Force

if ($SkipProtocolRegistration) {
    Write-Host "Skipped ${ProtocolName}:// protocol registration."
    return
}

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
