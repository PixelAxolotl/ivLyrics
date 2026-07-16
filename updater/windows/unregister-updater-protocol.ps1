$ErrorActionPreference = "Stop"
$ProtocolRoot = "HKCU:\Software\Classes\ivlyrics-updater"
$UpdaterRoot = Join-Path $env:LOCALAPPDATA "ivLyrics\Updater"
$AppDirectoryStatePath = Join-Path $UpdaterRoot "app-directory-state.json"
$PathUtilsScript = Join-Path $PSScriptRoot "updater-path-utils.ps1"
$ConnectionCleanupFailed = $false

if (Test-Path -LiteralPath $PathUtilsScript -PathType Leaf) {
    . $PathUtilsScript
    $HadConnectionState = Test-Path -LiteralPath $AppDirectoryStatePath -PathType Leaf
    try {
        if (Remove-IvLyricsRecordedAppDirectory -StatePath $AppDirectoryStatePath -IncludeSynchronizedDirectory) {
            Write-Host "Removed the recorded Spicetify app directory connection."
        }
    }
    catch {
        Write-Warning "Could not remove the recorded app directory connection: $($_.Exception.Message)"
        $ConnectionCleanupFailed = $true
    }
    if ($HadConnectionState -and (Test-Path -LiteralPath $AppDirectoryStatePath -PathType Leaf)) {
        Write-Warning "The recorded app directory state was preserved because cleanup was not safe."
        $ConnectionCleanupFailed = $true
    }
}

if (Test-Path -LiteralPath $ProtocolRoot) {
    Remove-Item -LiteralPath $ProtocolRoot -Recurse -Force
}

Write-Host "Unregistered ivlyrics-updater:// protocol."
if ($ConnectionCleanupFailed) {
    exit 1
}
