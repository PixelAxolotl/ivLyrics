# ivLyrics Installer for Windows
# Requires Windows PowerShell 5.1+ or PowerShell 7+

param(
    [switch]$Force,
    [switch]$Help,
    [Alias("v")]
    [switch]$Version
)

# --- Configuration ---
$REPO = "ivLis-Studio/ivLyrics"
$TARGET_DIR = "$env:LOCALAPPDATA\spicetify\CustomApps"
$FINAL_APP_NAME = "ivLyrics"
$PROXY_URL = "http://ivlis.kr/ivLyrics/proxy.php"
$MAX_RETRIES = 3
$SCRIPT_VERSION = "2.1.0"

# --- Colors ---
$script:Colors = @{
    Primary = "Cyan"
    Success = "Green"
    Warning = "Yellow"
    Error   = "Red"
    Muted   = "DarkGray"
    White   = "White"
    Magenta = "Magenta"
}

# --- State ---
$script:IsUpdate = $false
$script:CurrentVersion = $null

# --- Helper Functions ---
function Write-Colored {
    param([string]$Text, [string]$Color = "White", [switch]$NoNewLine)
    if ($NoNewLine) {
        Write-Host $Text -ForegroundColor $Color -NoNewline
    }
    else {
        Write-Host $Text -ForegroundColor $Color
    }
}

function Write-Logo {
    $logo = @"

    d8b          888                        d8b
    Y8P          888                        Y8P
                 888
    888 888  888 888      888  888 888d888 888  .d8888b .d8888b
    888 888  888 888      888  888 888P"   888 d88P"    88K
    888 Y88  88P 888      888  888 888     888 888      "Y8888b.
    888  Y8bd8P  888      Y88b 888 888     888 Y88b.         X88
    888   Y88P   88888888  "Y88888 888     888  "Y8888P  88888P'
                               888
                          Y8b d88P     for Spotify
                           "Y88P"

"@
    Write-Colored $logo $Colors.Primary
}

function Write-HelpMessage {
    Write-Host ""
    Write-Colored "ivLyrics Installer" $Colors.Primary
    Write-Host ""
    Write-Host "Usage: .\install.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Force      Force reinstall even if already up to date"
    Write-Host "  -Help       Show this help message"
    Write-Host "  -Version    Show installer version"
    Write-Host ""
    exit 0
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Colored "  >> $Title" $Colors.White
    Write-Colored "  $("-" * 50)" $Colors.Muted
}

function Write-Step {
    param(
        [int]$Current,
        [int]$Total,
        [string]$Message,
        [string]$Status = "running"
    )

    $icon = switch ($Status) {
        "running" { "[*]" }
        "success" { "[+]" }
        "warning" { "[!]" }
        "error" { "[x]" }
        default { "[ ]" }
    }

    $color = switch ($Status) {
        "running" { $Colors.Primary }
        "success" { $Colors.Success }
        "warning" { $Colors.Warning }
        "error" { $Colors.Error }
        default { $Colors.White }
    }

    $progress = "($Current/$Total)"
    Write-Colored "     $icon " $color -NoNewLine
    Write-Colored "$progress " $Colors.Muted -NoNewLine
    Write-Colored $Message $Colors.White
}

function Write-SubStep {
    param([string]$Message, [string]$Type = "info")

    $color = switch ($Type) {
        "success" { $Colors.Success }
        "warning" { $Colors.Warning }
        "error" { $Colors.Error }
        default { $Colors.Muted }
    }

    Write-Colored "             $Message" $color
}

function Write-ProgressBar {
    param([int]$Percent, [int]$Width = 30)

    $filled = [math]::Floor($Width * $Percent / 100)
    $empty = $Width - $filled

    $bar = "[" + ("=" * $filled) + ("." * $empty) + "]"

    Write-Host "`r             $bar $Percent%" -NoNewline
}

function Write-Success {
    param([string]$Version, [bool]$IsUpdate)

    $action = if ($IsUpdate) { "updated" } else { "installed" }

    $box = @"

    +--------------------------------------------------+
    |                                                  |
    |     ivLyrics has been $action successfully!     |
    |                                                  |
    |     Spotify will now open with ivLyrics.         |
    |                                                  |
    +--------------------------------------------------+

"@
    Write-Colored $box $Colors.Success
}

function Write-Footer {
    param([string]$Version)
    Write-Host ""
    Write-Colored "  Version: $Version" $Colors.Muted
    Write-Colored "  GitHub:  github.com/ivLis-Studio/ivLyrics" $Colors.Muted
    Write-Host ""
}

function Get-CurrentVersion {
    $versionFile = Join-Path $TARGET_DIR "$FINAL_APP_NAME\version.txt"
    if (Test-Path $versionFile) {
        return (Get-Content $versionFile -Raw).Trim()
    }
    return $null
}

function Test-SpicetifyInstalled {
    try {
        $null = Get-Command spicetify -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Test-NetworkConnection {
    try {
        $null = Invoke-WebRequest -Uri "https://api.github.com" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        return $true
    }
    catch {
        try {
            $null = Invoke-WebRequest -Uri $PROXY_URL -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            return $true
        }
        catch {
            return $false
        }
    }
}

function Test-Installation {
    $appDir = Join-Path $TARGET_DIR $FINAL_APP_NAME
    $requiredFiles = @("index.js", "manifest.json")

    foreach ($file in $requiredFiles) {
        $filePath = Join-Path $appDir $file
        if (-not (Test-Path $filePath)) {
            return $false
        }
    }
    return $true
}

function Get-SpicetifyInstallerAppDir {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $configOutput = @(& spicetify -c 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "Could not resolve the active Spicetify config file (exit $exitCode)."
    }

    $configPath = @(
        $configOutput |
            ForEach-Object { ([string]$_).Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    ) | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($configPath)) {
        throw "Spicetify returned an empty config file path."
    }
    $configPath = [IO.Path]::GetFullPath($configPath.Trim().Trim('"'))
    return Join-Path (Join-Path (Split-Path -Parent $configPath) "CustomApps") $FINAL_APP_NAME
}

function Get-IvLyricsInstallerPathEntry {
    param([string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $parentPath = Split-Path -Parent $fullPath
    $leafName = Split-Path -Leaf $fullPath
    if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        return $null
    }
    return @(
        Get-ChildItem -LiteralPath $parentPath -Force -ErrorAction Stop |
            Where-Object { $_.Name -ieq $leafName }
    ) | Select-Object -First 1
}

function Initialize-IvLyricsInstallerNativeMethods {
    if ($null -ne ("IvLyrics.InstallerNativeMethods" -as [type])) {
        return
    }
    Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;

namespace IvLyrics {
    public static class InstallerNativeMethods {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "RemoveDirectoryW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool RemoveDirectory(string path);
    }
}
"@
}

function Remove-IvLyricsInstallerPath {
    param([string]$Path)
    $entry = Get-IvLyricsInstallerPathEntry -Path $Path
    if ($null -eq $entry) {
        return
    }
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Initialize-IvLyricsInstallerNativeMethods
        if (-not [IvLyrics.InstallerNativeMethods]::RemoveDirectory([IO.Path]::GetFullPath($Path))) {
            $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw "Could not remove directory link '$Path' (error $errorCode)."
        }
        return
    }
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

function Register-IvLyricsUpdaterProtocol {
    $appDir = Join-Path $TARGET_DIR $FINAL_APP_NAME
    $registerScript = Join-Path $appDir "updater\windows\register-updater-protocol.ps1"

    if (-not (Test-Path -LiteralPath $registerScript)) {
        Write-SubStep "Updater protocol script not found, skipping" "warning"
        return $false
    }

    try {
        $registrationOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $registerScript -AppDir $appDir 2>&1)
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "Registration script exited with code ${exitCode}: $($registrationOutput -join [Environment]::NewLine)"
        }
        Write-SubStep "Updater protocol registered" "success"
        return $true
    }
    catch {
        Write-SubStep "Updater protocol registration failed: $($_.Exception.Message)" "error"
        return $false
    }
}

function Invoke-WithRetry {
    param(
        [ScriptBlock]$ScriptBlock,
        [int]$MaxRetries = 3,
        [int]$DelaySeconds = 2
    )

    $attempt = 0
    $lastError = $null

    while ($attempt -lt $MaxRetries) {
        $attempt++
        try {
            return & $ScriptBlock
        }
        catch {
            $lastError = $_
            if ($attempt -lt $MaxRetries) {
                Write-SubStep "Attempt $attempt failed. Retrying in ${DelaySeconds}s..." "warning"
                Start-Sleep -Seconds $DelaySeconds
            }
        }
    }

    throw $lastError
}

# --- Handle Command Line Arguments ---
if ($Help) {
    Write-HelpMessage
}

if ($Version) {
    Write-Host "ivLyrics Installer v$SCRIPT_VERSION"
    exit 0
}

# --- Main Script ---
Clear-Host
Write-Logo

# Check if this is an update
$script:CurrentVersion = Get-CurrentVersion
$script:IsUpdate = $null -ne $script:CurrentVersion

$modeText = if ($IsUpdate) { "UPDATING" } else { "INSTALLING" }
$modeColor = if ($IsUpdate) { $Colors.Warning } else { $Colors.Success }

Write-Colored "                    [ $modeText ]" $modeColor
if ($IsUpdate) {
    Write-Colored "              Current version: $CurrentVersion" $Colors.Muted
}
Write-Host ""

# Step 1: Check network connectivity
Write-Section "CHECKING REQUIREMENTS"
Write-Step 1 7 "Checking network connectivity..." "running"

if (-not (Test-NetworkConnection)) {
    Write-SubStep "No network connection!" "error"
    Write-Host ""
    Write-Colored "  Please check your internet connection and try again." $Colors.Error
    Write-Host ""
    exit 1
}
Write-SubStep "Network connected" "success"

# Step 2: Check Spicetify
Write-Step 2 7 "Checking Spicetify installation..." "running"

if (-not (Test-SpicetifyInstalled)) {
    Write-SubStep "Spicetify is not installed!" "warning"
    Write-Host ""
    Write-Colored "  Spicetify is required to use ivLyrics." $Colors.Warning
    Write-Host ""
    Write-Colored "  Would you like to install Spicetify now? (Y/n): " $Colors.Primary -NoNewLine
    $installChoice = Read-Host

    if ($installChoice -eq '' -or $installChoice -eq 'y' -or $installChoice -eq 'Y') {
        Write-Host ""
        Write-SubStep "Installing Spicetify..." "info"
        Write-SubStep "This may take a minute..." "info"
        Write-Host ""

        try {
            # Download and run Spicetify installer
            # Save to temp file and run separately to avoid pipeline parameter conflict
            $spicetifyInstallerPath = Join-Path $env:TEMP "spicetify_install.ps1"
            Invoke-WebRequest -Uri "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1" -UseBasicParsing -OutFile $spicetifyInstallerPath
            & $spicetifyInstallerPath
            Remove-Item $spicetifyInstallerPath -ErrorAction SilentlyContinue

            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

            # Check again
            Start-Sleep -Seconds 2
            if (Test-SpicetifyInstalled) {
                Write-Host ""
                Write-SubStep "Spicetify installed successfully!" "success"

                # Close Spotify if it was opened during Spicetify installation
                Start-Sleep -Seconds 2
                $spotifyAfterInstall = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
                if ($spotifyAfterInstall) {
                    Write-SubStep "Closing Spotify opened by Spicetify..." "info"
                    Stop-Process -Name "Spotify" -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                }
            }
            else {
                Write-Host ""
                Write-SubStep "Spicetify installation may require a terminal restart." "warning"
                Write-Colored "  Please restart PowerShell and run this script again." $Colors.Warning
                Write-Host ""
                exit 1
            }
        }
        catch {
            Write-Host ""
            Write-SubStep "Failed to install Spicetify automatically." "error"
            Write-Colored "  Please install manually:" $Colors.White
            Write-Colored "    iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex" $Colors.Primary
            Write-Host ""
            exit 1
        }
    }
    else {
        Write-Host ""
        Write-Colored "  Installation cancelled. Spicetify is required." $Colors.Muted
        Write-Host ""
        exit 1
    }
}
else {
    Write-SubStep "Spicetify found" "success"
}

# Step 3: Close Spotify
Write-Step 3 7 "Checking Spotify process..." "running"

$spotifyProcesses = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
if ($spotifyProcesses) {
    Write-SubStep "Spotify is running, closing..." "warning"
    Stop-Process -Name "Spotify" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-SubStep "Spotify closed" "success"
}
else {
    Write-SubStep "Spotify is not running" "success"
}

# Step 4: Check target directory
Write-Step 4 7 "Checking target directory..." "running"

if (-not (Test-Path $TARGET_DIR)) {
    Write-SubStep "Creating directory..." "info"
    New-Item -Path $TARGET_DIR -ItemType Directory -Force | Out-Null
}
Write-SubStep "Directory ready" "success"

# Step 5: Fetch version info
Write-Section "DOWNLOADING"
Write-Step 5 7 "Fetching latest version..." "running"

$DOWNLOAD_URL = $null
$VERSION_TAG = "unknown"

try {
    $versionResult = Invoke-WithRetry -MaxRetries $MAX_RETRIES -ScriptBlock {
        $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" -ErrorAction Stop
        return @{
            Url     = $response.zipball_url
            Version = $response.tag_name
            Source  = "github"
        }
    }

    $DOWNLOAD_URL = $versionResult.Url
    $VERSION_TAG = $versionResult.Version
    Write-SubStep "Found version: $VERSION_TAG (via GitHub)" "success"
}
catch {
    Write-SubStep "GitHub unavailable, trying proxy..." "warning"

    try {
        $versionResult = Invoke-WithRetry -MaxRetries $MAX_RETRIES -ScriptBlock {
            $response = Invoke-RestMethod -Uri "$PROXY_URL`?action=version" -TimeoutSec 10 -ErrorAction Stop

            if ($response.zip_available) {
                return @{
                    Url     = "$PROXY_URL`?action=download"
                    Version = $response.tag_name
                    Source  = "proxy"
                }
            }
            throw "Zip not available"
        }

        $DOWNLOAD_URL = $versionResult.Url
        $VERSION_TAG = $versionResult.Version
        Write-SubStep "Found version: $VERSION_TAG (via proxy)" "success"
    }
    catch {
        Write-Step 5 7 "Failed to fetch version info" "error"
        Write-SubStep "Could not connect after $MAX_RETRIES attempts" "error"
        exit 1
    }
}

# Check if already up to date
if ($IsUpdate -and $CurrentVersion -eq $VERSION_TAG -and -not $Force) {
    Write-Host ""
    Write-Colored "  Already up to date! (v$VERSION_TAG)" $Colors.Success
    Write-Colored "  Use -Force to reinstall anyway." $Colors.Muted
    Write-Host ""
    Write-SubStep "Checking updater protocol..." "info"
    if (-not (Register-IvLyricsUpdaterProtocol)) {
        Write-Colored "  The active Spicetify app directory could not be updated." $Colors.Error
        exit 1
    }
    Write-Host ""
    exit 0
}

# Step 6: Download and extract
Write-Step 6 7 "Downloading ivLyrics..." "running"

$TEMP_ZIP = Join-Path $env:TEMP "ivLyrics_latest.zip"
$TEMP_EXTRACT = Join-Path $env:TEMP "ivLyrics_extract"

try {
    # Download with retry
    Invoke-WithRetry -MaxRetries $MAX_RETRIES -ScriptBlock {
        # Progress simulation
        for ($i = 0; $i -le 80; $i += 20) {
            Write-ProgressBar $i
            Start-Sleep -Milliseconds 50
        }

        $progressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $TEMP_ZIP -UseBasicParsing -ErrorAction Stop

        if (-not (Test-Path $TEMP_ZIP) -or (Get-Item $TEMP_ZIP).Length -lt 1000) {
            throw "Download failed or file too small"
        }
    }

    Write-ProgressBar 100
    Write-Host ""
    Write-SubStep "Download complete" "success"

    # Extract
    Write-SubStep "Extracting files..." "info"

    if (Test-Path $TEMP_EXTRACT) {
        Remove-Item $TEMP_EXTRACT -Recurse -Force -ErrorAction SilentlyContinue
    }

    Expand-Archive -Path $TEMP_ZIP -DestinationPath $TEMP_EXTRACT -Force

    $EXTRACTED_DIR = Get-ChildItem -Path $TEMP_EXTRACT -Directory | Select-Object -First 1

    if (-not $EXTRACTED_DIR) {
        throw "Extraction failed"
    }

    # Remove old fixed-location installations without following directory links.
    $FINAL_APP_DIR = Join-Path $TARGET_DIR $FINAL_APP_NAME
    $OLD_PATH = "$env:APPDATA\spicetify\CustomApps\ivLyrics"
    $ACTIVE_APP_DIR = [IO.Path]::GetFullPath((Get-SpicetifyInstallerAppDir)).TrimEnd('\', '/')
    $NORMALIZED_FINAL_APP_DIR = [IO.Path]::GetFullPath($FINAL_APP_DIR).TrimEnd('\', '/')
    foreach ($installPath in @($FINAL_APP_DIR, $OLD_PATH)) {
        $normalizedInstallPath = [IO.Path]::GetFullPath($installPath).TrimEnd('\', '/')
        if ($normalizedInstallPath.Equals($ACTIVE_APP_DIR, [StringComparison]::OrdinalIgnoreCase) -and
            -not $normalizedInstallPath.Equals($NORMALIZED_FINAL_APP_DIR, [StringComparison]::OrdinalIgnoreCase)) {
            Write-SubStep "Preserving the active Spicetify app directory for safe synchronization" "info"
            continue
        }
        Remove-IvLyricsInstallerPath -Path $installPath
    }

    # Install new version
    New-Item -Path $FINAL_APP_DIR -ItemType Directory -Force | Out-Null
    Copy-Item "$($EXTRACTED_DIR.FullName)\*" $FINAL_APP_DIR -Recurse -Force

    Write-SubStep "Extraction complete" "success"

}
catch {
    Write-Step 6 7 "Download failed after $MAX_RETRIES attempts" "error"
    Write-SubStep $_.Exception.Message "error"
    Remove-Item $TEMP_ZIP -ErrorAction SilentlyContinue
    Remove-Item $TEMP_EXTRACT -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}
finally {
    Remove-Item $TEMP_ZIP -ErrorAction SilentlyContinue
    Remove-Item $TEMP_EXTRACT -Recurse -Force -ErrorAction SilentlyContinue
}

# Verify installation
Write-SubStep "Verifying installation..." "info"
if (Test-Installation) {
    Write-SubStep "Installation verified" "success"
}
else {
    Write-SubStep "Installation verification failed!" "error"
    Write-Colored "  Some required files are missing. Please try again." $Colors.Error
    exit 1
}

Write-Section "CONFIGURING"

# Register one-click updater protocol
Write-SubStep "Registering updater protocol..." "info"
if (-not (Register-IvLyricsUpdaterProtocol)) {
    Write-Colored "  Installation stopped because the active Spicetify app directory could not be updated." $Colors.Error
    exit 1
}

# Step 7: Apply Spicetify
Write-Step 7 7 "Applying Spicetify configuration..." "running"

try {
    $configOutput = @(spicetify config custom_apps ivLyrics 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "spicetify config failed: $($configOutput -join [Environment]::NewLine)"
    }
    Write-SubStep "Custom app registered" "success"

    $applyOutput = @(spicetify apply 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "spicetify apply failed: $($applyOutput -join [Environment]::NewLine)"
    }
    Write-SubStep "Spicetify applied" "success"
}
catch {
    Write-SubStep "Spicetify apply may require manual run" "warning"
}

# Done!
Write-Success -Version $VERSION_TAG -IsUpdate $IsUpdate
Write-Footer $VERSION_TAG

# Launch Spotify
Start-Process "spotify://ivLyrics/?alert=Update%20Completed"
