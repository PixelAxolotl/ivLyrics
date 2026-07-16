$ErrorActionPreference = "Stop"

function ConvertTo-IvLyricsNormalizedPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [string]$BasePath = ""
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "Cannot normalize an empty path."
    }

    $candidate = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    if ($candidate.StartsWith("\\?\UNC\", [StringComparison]::OrdinalIgnoreCase) -or
        $candidate.StartsWith("\??\UNC\", [StringComparison]::OrdinalIgnoreCase)) {
        $candidate = "\\" + $candidate.Substring(8)
    }
    elseif ($candidate.StartsWith("\\?\", [StringComparison]::OrdinalIgnoreCase) -or
        $candidate.StartsWith("\??\", [StringComparison]::OrdinalIgnoreCase)) {
        $candidate = $candidate.Substring(4)
    }

    if (-not [IO.Path]::IsPathRooted($candidate)) {
        if ([string]::IsNullOrWhiteSpace($BasePath)) {
            $BasePath = (Get-Location).Path
        }
        $candidate = Join-Path $BasePath $candidate
    }

    $fullPath = [IO.Path]::GetFullPath($candidate)
    $rootPath = [IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Length -gt $rootPath.Length) {
        $fullPath = $fullPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    }
    return $fullPath
}

function ConvertFrom-IvLyricsTerminalText {
    param($Value)

    $text = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        return ""
    }

    $escape = [regex]::Escape([string][char]27)
    $text = [regex]::Replace($text, "${escape}\[[0-?]*[ -/]*[@-~]", "")
    $text = [regex]::Replace($text, "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "")
    return $text.Trim()
}

function Resolve-IvLyricsSpicetifyConfigPath {
    param([object[]]$Output)

    $fallbackPath = $null
    foreach ($rawLine in @($Output)) {
        $plainText = ConvertFrom-IvLyricsTerminalText -Value $rawLine
        if ([string]::IsNullOrWhiteSpace($plainText)) {
            continue
        }
        $candidate = $plainText.Trim().Trim('"')

        try {
            $fullPath = ConvertTo-IvLyricsNormalizedPath -Path $candidate
            if ([IO.Path]::GetExtension($fullPath) -ine ".ini") {
                continue
            }
            if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
                return $fullPath
            }
            if ($null -eq $fallbackPath) {
                $fallbackPath = $fullPath
            }
        }
        catch {
            continue
        }
    }

    if ($null -ne $fallbackPath) {
        return $fallbackPath
    }
    throw "Spicetify returned no usable config file path."
}

function Get-SpicetifyAppDir {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 turns successful native stderr into NativeCommandError.
        # Spicetify may print this value on stderr, so rely on the native exit code instead.
        $ErrorActionPreference = "Continue"
        $configPathOutput = @(& spicetify -c 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "Could not resolve the Spicetify config file (exit $exitCode): $($configPathOutput -join [Environment]::NewLine)"
    }

    $normalizedConfigPath = Resolve-IvLyricsSpicetifyConfigPath -Output $configPathOutput
    $configDir = Split-Path -Parent $normalizedConfigPath
    if ([string]::IsNullOrWhiteSpace($configDir)) {
        throw "Could not determine the Spicetify config directory from: $normalizedConfigPath"
    }

    return Join-Path (Join-Path $configDir "CustomApps") "ivLyrics"
}

function Get-IvLyricsPathEntry {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = ConvertTo-IvLyricsNormalizedPath -Path $Path
    $parentPath = Split-Path -Parent $fullPath
    $leafName = Split-Path -Leaf $fullPath
    if ([string]::IsNullOrWhiteSpace($parentPath) -or
        -not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        return $null
    }

    return @(
        Get-ChildItem -LiteralPath $parentPath -Force -ErrorAction Stop |
            Where-Object { $_.Name -ieq $leafName }
    ) | Select-Object -First 1
}

function Test-IvLyricsAppDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Test-Path -LiteralPath (Join-Path $Path "index.js") -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Path "manifest.json") -PathType Leaf)
}

function Resolve-IvLyricsLinkTarget {
    param(
        [Parameter(Mandatory = $true)]$Item,
        [Parameter(Mandatory = $true)][string]$LinkPath
    )

    $target = @(
        @($Item.Target) |
            ForEach-Object { ([string]$_).Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    ) | Select-Object -First 1

    if ([string]::IsNullOrWhiteSpace($target)) {
        throw "Could not determine the target of directory link: $LinkPath"
    }

    return ConvertTo-IvLyricsNormalizedPath -Path $target -BasePath (Split-Path -Parent $LinkPath)
}

function Initialize-IvLyricsNativeMethods {
    if ($null -ne ("IvLyrics.UpdaterNativeMethods" -as [type])) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace IvLyrics {
    public static class UpdaterNativeMethods {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "RemoveDirectoryW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool RemoveDirectory(string path);
    }
}
"@
}

function Remove-IvLyricsDirectoryLink {
    param([Parameter(Mandatory = $true)][string]$Path)

    $normalizedPath = ConvertTo-IvLyricsNormalizedPath -Path $Path
    $entry = Get-IvLyricsPathEntry -Path $normalizedPath
    if ($null -eq $entry) {
        return $false
    }
    if (-not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing to remove a real directory as a link: $normalizedPath"
    }

    Initialize-IvLyricsNativeMethods
    if (-not [IvLyrics.UpdaterNativeMethods]::RemoveDirectory($normalizedPath)) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        $win32Error = New-Object ComponentModel.Win32Exception -ArgumentList $errorCode
        $message = $win32Error.Message
        throw "Could not remove directory link '$normalizedPath' (error $errorCode): $message"
    }
    if ($null -ne (Get-IvLyricsPathEntry -Path $normalizedPath)) {
        throw "Directory link still exists after removal: $normalizedPath"
    }
    return $true
}

function Copy-IvLyricsDirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    foreach ($sourceItem in @(Get-ChildItem -LiteralPath $SourcePath -Force -ErrorAction Stop)) {
        if ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to copy a reparse point from the ivLyrics package: $($sourceItem.FullName)"
        }

        $destinationItemPath = Join-Path $DestinationPath $sourceItem.Name
        $destinationItem = Get-IvLyricsPathEntry -Path $destinationItemPath
        if ($null -ne $destinationItem -and
            ($destinationItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to write through a reparse point in the existing app directory: $destinationItemPath"
        }

        if ($sourceItem.PSIsContainer) {
            if ($null -ne $destinationItem -and -not $destinationItem.PSIsContainer) {
                throw "Cannot replace a file with a directory while synchronizing: $destinationItemPath"
            }
            New-Item -ItemType Directory -Force -Path $destinationItemPath | Out-Null
            Copy-IvLyricsDirectoryContents -SourcePath $sourceItem.FullName -DestinationPath $destinationItemPath
        }
        else {
            if ($null -ne $destinationItem -and $destinationItem.PSIsContainer) {
                throw "Cannot replace a directory with a file while synchronizing: $destinationItemPath"
            }
            Copy-Item -LiteralPath $sourceItem.FullName -Destination $destinationItemPath -Force
        }
    }
}

function New-IvLyricsDirectoryConnection {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$ConfiguredPath
    )

    try {
        New-Item -ItemType Junction -Path $ConfiguredPath -Target $SourcePath -ErrorAction Stop | Out-Null
        Write-Host "Connected ivLyrics to Spicetify app directory: $ConfiguredPath"
        return "Junction"
    }
    catch {
        $junctionError = $_.Exception.Message
        $partialEntry = Get-IvLyricsPathEntry -Path $ConfiguredPath
        if ($null -ne $partialEntry -and
            ($partialEntry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-IvLyricsDirectoryLink -Path $ConfiguredPath | Out-Null
            $partialEntry = $null
        }
        if ($null -ne $partialEntry -and -not $partialEntry.PSIsContainer) {
            throw "Could not create the app directory junction and the destination is not a directory: $ConfiguredPath"
        }
        if ($null -ne $partialEntry) {
            $partialItems = @(Get-ChildItem -LiteralPath $ConfiguredPath -Force -ErrorAction Stop)
            if ($partialItems.Count -gt 0 -and -not (Test-IvLyricsAppDirectory -Path $ConfiguredPath)) {
                throw "Could not create the app directory junction and the fallback destination is unrecognized: $ConfiguredPath"
            }
        }

        Write-Warning "Could not create a directory junction ($junctionError). Synchronizing the configured app directory instead."
        New-Item -ItemType Directory -Force -Path $ConfiguredPath | Out-Null
        Copy-IvLyricsDirectoryContents -SourcePath $SourcePath -DestinationPath $ConfiguredPath
        return "DirectorySynced"
    }
}

function Connect-SpicetifyAppDir {
    param([Parameter(Mandatory = $true)][string]$SourceAppDir)

    $sourcePath = ConvertTo-IvLyricsNormalizedPath -Path $SourceAppDir
    if (-not (Test-IvLyricsAppDirectory -Path $sourcePath)) {
        throw "ivLyrics app files were not found in: $sourcePath"
    }

    $configuredPath = ConvertTo-IvLyricsNormalizedPath -Path (Get-SpicetifyAppDir)
    if ($sourcePath.Equals($configuredPath, [StringComparison]::OrdinalIgnoreCase)) {
        return [PSCustomObject]@{
            Mode = "Direct"
            ConfiguredPath = $configuredPath
            SourcePath = $sourcePath
        }
    }

    $configuredParent = Split-Path -Parent $configuredPath
    New-Item -ItemType Directory -Force -Path $configuredParent | Out-Null
    $configuredItem = Get-IvLyricsPathEntry -Path $configuredPath
    $mode = $null

    if ($null -eq $configuredItem) {
        $mode = New-IvLyricsDirectoryConnection -SourcePath $sourcePath -ConfiguredPath $configuredPath
    }
    elseif ($configuredItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $resolvedTarget = Resolve-IvLyricsLinkTarget -Item $configuredItem -LinkPath $configuredPath
        if ($sourcePath.Equals($resolvedTarget, [StringComparison]::OrdinalIgnoreCase)) {
            $mode = "Junction"
        }
        else {
            Remove-IvLyricsDirectoryLink -Path $configuredPath | Out-Null
            $mode = New-IvLyricsDirectoryConnection -SourcePath $sourcePath -ConfiguredPath $configuredPath
        }
    }
    else {
        if (-not $configuredItem.PSIsContainer) {
            throw "The configured ivLyrics path is not a directory: $configuredPath"
        }
        $existingItems = @(Get-ChildItem -LiteralPath $configuredPath -Force -ErrorAction Stop)
        if ($existingItems.Count -gt 0 -and -not (Test-IvLyricsAppDirectory -Path $configuredPath)) {
            throw "Refusing to overwrite an unrecognized directory: $configuredPath"
        }

        Copy-IvLyricsDirectoryContents -SourcePath $sourcePath -DestinationPath $configuredPath
        Write-Host "Synchronized ivLyrics with the existing Spicetify app directory: $configuredPath"
        $mode = "DirectorySynced"
    }

    return [PSCustomObject]@{
        Mode = $mode
        ConfiguredPath = $configuredPath
        SourcePath = $sourcePath
    }
}

function Get-IvLyricsAppDirectoryState {
    param([Parameter(Mandatory = $true)][string]$StatePath)

    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        return $null
    }
    return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
}

function Save-IvLyricsAppDirectoryState {
    param(
        [Parameter(Mandatory = $true)]$Connection,
        [Parameter(Mandatory = $true)][string]$StatePath
    )

    $previousState = $null
    try {
        $previousState = Get-IvLyricsAppDirectoryState -StatePath $StatePath
    }
    catch {
        Write-Warning "Ignoring invalid previous app directory state: $($_.Exception.Message)"
    }

    if ($null -ne $previousState) {
        $hasValidPreviousState = ($previousState.Mode -eq "Junction" -or $previousState.Mode -eq "DirectorySynced") -and
            -not [string]::IsNullOrWhiteSpace([string]$previousState.ConfiguredPath) -and
            -not [string]::IsNullOrWhiteSpace([string]$previousState.SourcePath)
        if (-not $hasValidPreviousState) {
            Write-Warning "Ignoring incomplete previous app directory state."
            Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
            $previousState = $null
        }
    }

    if ($null -ne $previousState -and
        -not ([string]$previousState.ConfiguredPath).Equals([string]$Connection.ConfiguredPath, [StringComparison]::OrdinalIgnoreCase)) {
        try {
            Remove-IvLyricsRecordedAppDirectory -StatePath $StatePath -IncludeSynchronizedDirectory | Out-Null
        }
        catch {
            throw "Could not clean the previous app directory connection: $($_.Exception.Message)"
        }
        if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
            throw "The previous app directory connection could not be cleaned safely. Its recovery state was preserved."
        }
    }

    if ($Connection.Mode -eq "Direct") {
        Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
        return
    }

    $stateParent = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Force -Path $stateParent | Out-Null
    [PSCustomObject]@{
        Version = 1
        Mode = [string]$Connection.Mode
        ConfiguredPath = [string]$Connection.ConfiguredPath
        SourcePath = [string]$Connection.SourcePath
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Remove-IvLyricsRecordedJunction {
    param([Parameter(Mandatory = $true)][string]$StatePath)

    return Remove-IvLyricsRecordedAppDirectory -StatePath $StatePath
}

function Remove-IvLyricsRecordedAppDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$StatePath,
        [switch]$IncludeSynchronizedDirectory
    )

    $state = Get-IvLyricsAppDirectoryState -StatePath $StatePath
    if ($null -eq $state) {
        return $false
    }
    if (($state.Mode -ne "Junction" -and $state.Mode -ne "DirectorySynced") -or
        [string]::IsNullOrWhiteSpace([string]$state.ConfiguredPath) -or
        [string]::IsNullOrWhiteSpace([string]$state.SourcePath)) {
        Write-Warning "The recorded app directory state is incomplete; leaving app paths untouched."
        return $false
    }

    $configuredPath = ConvertTo-IvLyricsNormalizedPath -Path ([string]$state.ConfiguredPath)
    $expectedTarget = ConvertTo-IvLyricsNormalizedPath -Path ([string]$state.SourcePath)
    $entry = Get-IvLyricsPathEntry -Path $configuredPath
    if ($null -eq $entry) {
        Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
        return $false
    }

    if ($state.Mode -eq "DirectorySynced") {
        if (-not $IncludeSynchronizedDirectory) {
            return $false
        }
        if ($configuredPath.Equals($expectedTarget, [StringComparison]::OrdinalIgnoreCase) -or
            ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            -not $entry.PSIsContainer -or
            -not (Test-IvLyricsAppDirectory -Path $configuredPath)) {
            Write-Warning "The recorded synchronized app directory no longer matches ivLyrics; leaving it untouched: $configuredPath"
            return $false
        }

        try {
            $manifest = Get-Content -LiteralPath (Join-Path $configuredPath "manifest.json") -Raw | ConvertFrom-Json
        }
        catch {
            Write-Warning "The recorded synchronized app manifest is invalid; leaving it untouched: $configuredPath"
            return $false
        }
        if (([string]$manifest.name) -ne "ivLyrics") {
            Write-Warning "The recorded synchronized app is not ivLyrics; leaving it untouched: $configuredPath"
            return $false
        }

        Remove-Item -LiteralPath $configuredPath -Recurse -Force -ErrorAction Stop
        Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
        return $true
    }

    if ($state.Mode -ne "Junction") {
        return $false
    }
    if (-not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Write-Warning "The recorded app path is no longer a directory link; leaving it untouched: $configuredPath"
        return $false
    }

    $actualTarget = Resolve-IvLyricsLinkTarget -Item $entry -LinkPath $configuredPath
    if (-not $actualTarget.Equals($expectedTarget, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Warning "The recorded app link target changed; leaving it untouched: $configuredPath"
        return $false
    }

    Remove-IvLyricsDirectoryLink -Path $configuredPath | Out-Null
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    return $true
}
