$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion.Major -ne 5) {
    throw "These regression tests must run with Windows PowerShell 5.1."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$pathUtilsScript = Join-Path $repoRoot "updater\windows\updater-path-utils.ps1"
. $pathUtilsScript

$script:assertionCount = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    $script:assertionCount++
    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    $script:assertionCount++
    if ($Expected -ne $Actual) {
        throw "Assertion failed: $Message`nExpected: $Expected`nActual:   $Actual"
    }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$MessageContains, [string]$Message)
    $script:assertionCount++
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notlike "*$MessageContains*") {
            throw "Assertion failed: $Message`nUnexpected error: $($_.Exception.Message)"
        }
        return
    }
    throw "Assertion failed: $Message`nExpected an exception containing: $MessageContains"
}

function New-TestApp {
    param([string]$Path, [string]$Marker)
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    Set-Content -LiteralPath (Join-Path $Path "index.js") -Value $Marker -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Path "manifest.json") -Value '{"name":"ivLyrics"}' -Encoding UTF8
}

function Set-TestConfig {
    param([string]$CaseRoot)
    $configDir = Join-Path $CaseRoot "configured path"
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    $configPath = Join-Path $configDir "config-xpui.ini"
    Set-Content -LiteralPath $configPath -Value "[Setting]" -Encoding UTF8
    $env:SPICETIFY_TEST_CONFIG = $configPath
    return $configPath
}

function Get-TestConfiguredAppPath {
    param([string]$ConfigPath)
    return Join-Path (Join-Path (Split-Path -Parent $ConfigPath) "CustomApps") "ivLyrics"
}

$tempRoot = Join-Path $env:TEMP ("ivLyrics-windows-updater-tests-" + [Guid]::NewGuid().ToString("N"))
$fakeBin = Join-Path $tempRoot "bin"
$originalPath = $env:PATH
$originalLocalAppData = $env:LOCALAPPDATA

try {
    New-Item -ItemType Directory -Force -Path $fakeBin | Out-Null
    @'
@echo off
if not "%~1"=="-c" exit /b 8
if "%SPICETIFY_TEST_CONFIG%"=="" exit /b 9
echo "%SPICETIFY_TEST_CONFIG%" 1>&2
exit /b %SPICETIFY_TEST_EXIT%
'@ | Set-Content -LiteralPath (Join-Path $fakeBin "spicetify.cmd") -Encoding ASCII
    $env:PATH = "$fakeBin;$originalPath"
    $env:SPICETIFY_TEST_EXIT = "0"

    $caseRoot = Join-Path $tempRoot "config path"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    Assert-Equal (Get-TestConfiguredAppPath -ConfigPath $configPath) (Get-SpicetifyAppDir) "-c should resolve the config file parent, including spaces"

    $env:SPICETIFY_TEST_EXIT = "7"
    Assert-Throws { Get-SpicetifyAppDir | Out-Null } "exit 7" "a failing spicetify command should be reported"
    $env:SPICETIFY_TEST_EXIT = "0"

    $caseRoot = Join-Path $tempRoot "existing-directory"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    $sourcePath = Join-Path $caseRoot "source"
    $configuredPath = Get-TestConfiguredAppPath -ConfigPath $configPath
    New-TestApp -Path $sourcePath -Marker "new release"
    New-Item -ItemType Directory -Force -Path (Join-Path $sourcePath "nested") | Out-Null
    Set-Content -LiteralPath (Join-Path $sourcePath "nested\new.txt") -Value "new" -Encoding UTF8
    New-TestApp -Path $configuredPath -Marker "old release"
    Set-Content -LiteralPath (Join-Path $configuredPath ".destination-only") -Value "keep" -Encoding UTF8
    $connection = Connect-SpicetifyAppDir -SourceAppDir $sourcePath
    Assert-Equal "DirectorySynced" $connection.Mode "an existing real app directory should be synchronized"
    Assert-True ((Get-Content -LiteralPath (Join-Path $configuredPath "index.js") -Raw) -like "*new release*") "release files should be updated"
    Assert-True (Test-Path -LiteralPath (Join-Path $configuredPath ".destination-only")) "destination-only files should be preserved"
    Assert-True (Test-Path -LiteralPath (Join-Path $configuredPath "nested\new.txt")) "nested release files should be copied"

    $statePath = Join-Path $caseRoot "state\app-directory-state.json"
    Save-IvLyricsAppDirectoryState -Connection $connection -StatePath $statePath
    Assert-True (Test-Path -LiteralPath $statePath) "synchronized directory state should be saved for uninstall"
    Assert-True (Remove-IvLyricsRecordedAppDirectory -StatePath $statePath -IncludeSynchronizedDirectory) "uninstall should remove a verified synchronized directory"
    Assert-True (-not (Test-Path -LiteralPath $configuredPath)) "the synchronized app directory should be removed"
    Assert-True (Test-Path -LiteralPath (Join-Path $sourcePath "index.js")) "synchronized directory cleanup should preserve the release source"

    $caseRoot = Join-Path $tempRoot "unrecognized-directory"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    $sourcePath = Join-Path $caseRoot "source"
    $configuredPath = Get-TestConfiguredAppPath -ConfigPath $configPath
    New-TestApp -Path $sourcePath -Marker "release"
    New-Item -ItemType Directory -Force -Path $configuredPath | Out-Null
    Set-Content -LiteralPath (Join-Path $configuredPath "personal.txt") -Value "do not touch" -Encoding UTF8
    Assert-Throws { Connect-SpicetifyAppDir -SourceAppDir $sourcePath | Out-Null } "unrecognized directory" "unknown directories should never be overwritten"
    Assert-True (Test-Path -LiteralPath (Join-Path $configuredPath "personal.txt")) "unknown directory contents should remain untouched"

    $caseRoot = Join-Path $tempRoot "new-and-same-junction"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    $sourcePath = Join-Path $caseRoot "source"
    $configuredPath = Get-TestConfiguredAppPath -ConfigPath $configPath
    New-TestApp -Path $sourcePath -Marker "release"
    $connection = Connect-SpicetifyAppDir -SourceAppDir $sourcePath
    Assert-Equal "Junction" $connection.Mode "a missing configured app path should become a junction"
    $junctionEntry = Get-IvLyricsPathEntry -Path $configuredPath
    Assert-True (($junctionEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) "the configured app entry should be a reparse point"
    Assert-Equal (ConvertTo-IvLyricsNormalizedPath -Path $sourcePath) (Resolve-IvLyricsLinkTarget -Item $junctionEntry -LinkPath $configuredPath) "the junction should target the installed release"
    $sameConnection = Connect-SpicetifyAppDir -SourceAppDir $sourcePath
    Assert-Equal "Junction" $sameConnection.Mode "an existing correct junction should be a no-op"
    $statePath = Join-Path $caseRoot "state\app-directory-state.json"
    Save-IvLyricsAppDirectoryState -Connection $sameConnection -StatePath $statePath
    Assert-True (Remove-IvLyricsRecordedJunction -StatePath $statePath) "recorded junction cleanup should remove the link"
    Assert-True ($null -eq (Get-IvLyricsPathEntry -Path $configuredPath)) "junction cleanup should remove only the link entry"
    Assert-True (Test-Path -LiteralPath (Join-Path $sourcePath "index.js")) "junction cleanup should preserve the target"

    $caseRoot = Join-Path $tempRoot "changed-junction"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    $oldSourcePath = Join-Path $caseRoot "old-source"
    $sourcePath = Join-Path $caseRoot "new-source"
    $configuredPath = Get-TestConfiguredAppPath -ConfigPath $configPath
    New-TestApp -Path $oldSourcePath -Marker "old"
    New-TestApp -Path $sourcePath -Marker "new"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $configuredPath) | Out-Null
    New-Item -ItemType Junction -Path $configuredPath -Target $oldSourcePath | Out-Null
    $connection = Connect-SpicetifyAppDir -SourceAppDir $sourcePath
    $junctionEntry = Get-IvLyricsPathEntry -Path $configuredPath
    Assert-Equal (ConvertTo-IvLyricsNormalizedPath -Path $sourcePath) (Resolve-IvLyricsLinkTarget -Item $junctionEntry -LinkPath $configuredPath) "a stale junction should be replaced"
    Assert-True (Test-Path -LiteralPath (Join-Path $oldSourcePath "index.js")) "replacing a junction should preserve its previous target"
    Remove-IvLyricsDirectoryLink -Path $configuredPath | Out-Null

    $caseRoot = Join-Path $tempRoot "state-preservation"
    $claimedSourcePath = Join-Path $caseRoot "claimed-source"
    $actualSourcePath = Join-Path $caseRoot "actual-source"
    $newSourcePath = Join-Path $caseRoot "new-source"
    $recordedPath = Join-Path $caseRoot "old-config\ivLyrics"
    New-TestApp -Path $claimedSourcePath -Marker "claimed"
    New-TestApp -Path $actualSourcePath -Marker "actual"
    New-TestApp -Path $newSourcePath -Marker "new"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $recordedPath) | Out-Null
    New-Item -ItemType Junction -Path $recordedPath -Target $actualSourcePath | Out-Null
    $statePath = Join-Path $caseRoot "state\app-directory-state.json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statePath) | Out-Null
    [PSCustomObject]@{
        Version = 1
        Mode = "Junction"
        ConfiguredPath = $recordedPath
        SourcePath = $claimedSourcePath
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $statePath -Encoding UTF8
    $newConnection = [PSCustomObject]@{
        Mode = "Junction"
        ConfiguredPath = (Join-Path $caseRoot "new-config\ivLyrics")
        SourcePath = $newSourcePath
    }
    Assert-Throws { Save-IvLyricsAppDirectoryState -Connection $newConnection -StatePath $statePath } "recovery state was preserved" "a refused cleanup must not overwrite the previous state"
    $preservedState = Get-IvLyricsAppDirectoryState -StatePath $statePath
    Assert-Equal (ConvertTo-IvLyricsNormalizedPath -Path $recordedPath) (ConvertTo-IvLyricsNormalizedPath -Path ([string]$preservedState.ConfiguredPath)) "refused cleanup should preserve the old configured path"
    Remove-IvLyricsDirectoryLink -Path $recordedPath | Out-Null

    $caseRoot = Join-Path $tempRoot "fallback-guard"
    $sourcePath = Join-Path $caseRoot "source"
    $configuredPath = Join-Path $caseRoot "configured\ivLyrics"
    New-TestApp -Path $sourcePath -Marker "release"
    New-Item -ItemType Directory -Force -Path $configuredPath | Out-Null
    Set-Content -LiteralPath (Join-Path $configuredPath "personal.txt") -Value "keep" -Encoding UTF8
    Assert-Throws { New-IvLyricsDirectoryConnection -SourcePath $sourcePath -ConfiguredPath $configuredPath | Out-Null } "fallback destination is unrecognized" "junction fallback must not overwrite an unknown directory"
    Assert-True (Test-Path -LiteralPath (Join-Path $configuredPath "personal.txt")) "fallback refusal should preserve unknown contents"

    $caseRoot = Join-Path $tempRoot "broken-junction"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    $oldSourcePath = Join-Path $caseRoot "old-source"
    $sourcePath = Join-Path $caseRoot "new-source"
    $configuredPath = Get-TestConfiguredAppPath -ConfigPath $configPath
    New-TestApp -Path $oldSourcePath -Marker "old"
    New-TestApp -Path $sourcePath -Marker "new"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $configuredPath) | Out-Null
    New-Item -ItemType Junction -Path $configuredPath -Target $oldSourcePath | Out-Null
    Remove-Item -LiteralPath $oldSourcePath -Recurse -Force
    Assert-True ($null -ne (Get-IvLyricsPathEntry -Path $configuredPath)) "parent enumeration should find a broken junction"
    Connect-SpicetifyAppDir -SourceAppDir $sourcePath | Out-Null
    $junctionEntry = Get-IvLyricsPathEntry -Path $configuredPath
    Assert-Equal (ConvertTo-IvLyricsNormalizedPath -Path $sourcePath) (Resolve-IvLyricsLinkTarget -Item $junctionEntry -LinkPath $configuredPath) "a broken junction should be replaced"
    Remove-IvLyricsDirectoryLink -Path $configuredPath | Out-Null

    $caseRoot = Join-Path $tempRoot "relative-target"
    $linkPath = Join-Path $caseRoot "links\ivLyrics"
    $expectedTarget = Join-Path $caseRoot "source"
    $fakeLink = [PSCustomObject]@{ Target = "..\source" }
    Assert-Equal (ConvertTo-IvLyricsNormalizedPath -Path $expectedTarget) (Resolve-IvLyricsLinkTarget -Item $fakeLink -LinkPath $linkPath) "relative targets should resolve from the link parent"

    $caseRoot = Join-Path $tempRoot "invalid-source"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    $sourcePath = Join-Path $caseRoot "source"
    $configuredPath = Get-TestConfiguredAppPath -ConfigPath $configPath
    New-Item -ItemType Directory -Force -Path $sourcePath | Out-Null
    Set-Content -LiteralPath (Join-Path $sourcePath "index.js") -Value "incomplete" -Encoding UTF8
    Assert-Throws { Connect-SpicetifyAppDir -SourceAppDir $sourcePath | Out-Null } "app files were not found" "an invalid source should fail before changing the configured path"
    Assert-True ($null -eq (Get-IvLyricsPathEntry -Path $configuredPath)) "an invalid source should not mutate the destination"

    $caseRoot = Join-Path $tempRoot "register-script"
    $configPath = Set-TestConfig -CaseRoot $caseRoot
    $sourcePath = Join-Path $caseRoot "source"
    New-TestApp -Path $sourcePath -Marker "release"
    New-Item -ItemType Directory -Force -Path (Join-Path $sourcePath "updater\windows") | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot "updater\windows\ivlyrics-updater.ps1") -Destination (Join-Path $sourcePath "updater\windows\ivlyrics-updater.ps1")
    Copy-Item -LiteralPath $pathUtilsScript -Destination (Join-Path $sourcePath "updater\windows\updater-path-utils.ps1")
    $env:LOCALAPPDATA = Join-Path $caseRoot "local-app-data"
    & (Join-Path $repoRoot "updater\windows\register-updater-protocol.ps1") -AppDir $sourcePath -SkipProtocolRegistration
    $updaterRoot = Join-Path $env:LOCALAPPDATA "ivLyrics\Updater"
    Assert-True (Test-Path -LiteralPath (Join-Path $updaterRoot "ivlyrics-updater.ps1")) "registration should stage the updater script"
    Assert-True (Test-Path -LiteralPath (Join-Path $updaterRoot "updater-path-utils.ps1")) "registration should stage cleanup utilities"
    $statePath = Join-Path $updaterRoot "app-directory-state.json"
    Assert-True (Test-Path -LiteralPath $statePath) "registration should record the configured app connection"
    Assert-True (Remove-IvLyricsRecordedAppDirectory -StatePath $statePath -IncludeSynchronizedDirectory) "the staged state should support uninstall cleanup"

    foreach ($relativePath in @(
        "install.ps1",
        "uninstall.ps1",
        "updater\windows\register-updater-protocol.ps1",
        "updater\windows\unregister-updater-protocol.ps1",
        "updater\windows\updater-path-utils.ps1"
    )) {
        $tokens = $null
        $parseErrors = $null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $repoRoot $relativePath), [ref]$tokens, [ref]$parseErrors) | Out-Null
        Assert-Equal 0 $parseErrors.Count "$relativePath should parse in Windows PowerShell 5.1"
    }

    Write-Host "Windows updater regression tests passed ($script:assertionCount assertions)."
}
finally {
    $env:PATH = $originalPath
    $env:LOCALAPPDATA = $originalLocalAppData
    Remove-Item Env:SPICETIFY_TEST_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:SPICETIFY_TEST_EXIT -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
