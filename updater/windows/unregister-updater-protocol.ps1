$ErrorActionPreference = "Stop"
$ProtocolRoot = "HKCU:\Software\Classes\ivlyrics-updater"
$UpdaterRoot = Join-Path $env:LOCALAPPDATA "ivLyrics\Updater"
$AppDirectoryStatePath = Join-Path $UpdaterRoot "app-directory-state.json"
$PathUtilsScript = Join-Path $PSScriptRoot "updater-path-utils.ps1"

if (Test-Path -LiteralPath $PathUtilsScript -PathType Leaf) {
    . $PathUtilsScript
    try {
        if (Remove-IvLyricsRecordedAppDirectory -StatePath $AppDirectoryStatePath -IncludeSynchronizedDirectory) {
            Write-Host "Removed the recorded Spicetify app directory connection."
        }
    }
    catch {
        Write-Warning "Could not remove the recorded app directory junction: $($_.Exception.Message)"
    }
}

if (Test-Path -LiteralPath $ProtocolRoot) {
    Remove-Item -LiteralPath $ProtocolRoot -Recurse -Force
}

Write-Host "Unregistered ivlyrics-updater:// protocol."
