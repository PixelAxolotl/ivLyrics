#!/bin/bash

# ivLyrics Installer for macOS/Linux
# Beautiful CLI Edition

# --- Configuration ---
REPO="ivLis-Studio/ivLyrics"
TARGET_DIR="$HOME/.config/spicetify/CustomApps"
FINAL_APP_NAME="ivLyrics"
PROXY_URL="http://ivlis.kr/ivLyrics/proxy.php"
MAX_RETRIES=3
SCRIPT_VERSION="2.0.0"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# --- State ---
IS_UPDATE=false
CURRENT_VERSION=""
FORCE_INSTALL=false

# --- Command Line Arguments ---
print_help() {
    echo ""
    echo -e "${CYAN}ivLyrics Installer${NC}"
    echo ""
    echo "Usage: ./install.sh [options]"
    echo ""
    echo "Options:"
    echo "  -f, --force     Force reinstall even if already up to date"
    echo "  -h, --help      Show this help message"
    echo "  -v, --version   Show installer version"
    echo ""
    exit 0
}

print_version() {
    echo "ivLyrics Installer v${SCRIPT_VERSION}"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--force)
            FORCE_INSTALL=true
            shift
            ;;
        -h|--help)
            print_help
            ;;
        -v|--version)
            print_version
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# --- Helper Functions ---
print_logo() {
    echo ""
    echo -e "${CYAN}"
    cat << "EOF"
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
EOF
    echo -e "${NC}"
}

print_section() {
    echo ""
    echo -e "  ${WHITE}>> $1${NC}"
    echo -e "  ${GRAY}--------------------------------------------------${NC}"
}

print_step() {
    local current=$1
    local total=$2
    local message=$3
    local status=$4

    local icon color
    case $status in
        running) icon="[*]"; color=$CYAN ;;
        success) icon="[+]"; color=$GREEN ;;
        warning) icon="[!]"; color=$YELLOW ;;
        error)   icon="[x]"; color=$RED ;;
        *)       icon="[ ]"; color=$WHITE ;;
    esac

    echo -e "     ${color}${icon}${NC} ${GRAY}($current/$total)${NC} ${WHITE}$message${NC}"
}

print_substep() {
    local message=$1
    local type=$2

    local color
    case $type in
        success) color=$GREEN ;;
        warning) color=$YELLOW ;;
        error)   color=$RED ;;
        *)       color=$GRAY ;;
    esac

    echo -e "             ${color}$message${NC}"
}

print_progress_bar() {
    local percent=$1
    local width=30
    local filled=$((width * percent / 100))
    local empty=$((width - filled))

    local bar="["
    for ((i=0; i<filled; i++)); do bar+="="; done
    for ((i=0; i<empty; i++)); do bar+="."; done
    bar+="]"

    printf "\r             %s %d%%" "$bar" "$percent"
}

print_success() {
    local version=$1
    local is_update=$2

    local action="installed"
    if [ "$is_update" = true ]; then
        action="updated"
    fi

    echo ""
    echo -e "${GREEN}"
    cat << EOF
    +--------------------------------------------------+
    |                                                  |
    |     ivLyrics has been $action successfully!     |
    |                                                  |
    |     Please restart Spotify to use ivLyrics.      |
    |                                                  |
    +--------------------------------------------------+
EOF
    echo -e "${NC}"
}

print_footer() {
    local version=$1
    echo ""
    echo -e "  ${GRAY}Version: $version${NC}"
    echo -e "  ${GRAY}GitHub:  github.com/ivLis-Studio/ivLyrics${NC}"
    echo ""
}

get_current_version() {
    local version_file="$TARGET_DIR/$FINAL_APP_NAME/version.txt"
    if [ -f "$version_file" ]; then
        cat "$version_file" | tr -d '\n\r'
    fi
}

check_network() {
    if curl -s --connect-timeout 5 "https://api.github.com" > /dev/null 2>&1; then
        return 0
    elif curl -s --connect-timeout 5 "$PROXY_URL" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

close_spotify() {
    if pgrep -x "Spotify" > /dev/null 2>&1 || pgrep -x "spotify" > /dev/null 2>&1; then
        print_substep "Spotify is running, closing..." "warning"
        pkill -x "Spotify" 2>/dev/null || pkill -x "spotify" 2>/dev/null
        sleep 2
        print_substep "Spotify closed" "success"
        return 0
    fi
    print_substep "Spotify is not running" "success"
    return 1
}

verify_installation() {
    local app_dir="$TARGET_DIR/$FINAL_APP_NAME"
    local required_files=("index.js" "manifest.json")

    for file in "${required_files[@]}"; do
        if [ ! -f "$app_dir/$file" ]; then
            return 1
        fi
    done
    return 0
}

register_updater_protocol() {
    local app_dir="$TARGET_DIR/$FINAL_APP_NAME"
    local register_script="$app_dir/updater/unix/register-updater-protocol.sh"

    if [ ! -f "$register_script" ]; then
        print_substep "Updater protocol script not found, skipping" "warning"
        return 1
    fi

    if bash "$register_script" "$app_dir" >/dev/null 2>&1; then
        print_substep "Updater protocol registered" "success"
        return 0
    fi

    print_substep "Updater protocol registration failed" "warning"
    return 1
}

retry_command() {
    local max_attempts=$1
    local delay=$2
    shift 2
    local cmd="$@"

    local attempt=1
    while [ $attempt -le $max_attempts ]; do
        if eval "$cmd"; then
            return 0
        fi

        if [ $attempt -lt $max_attempts ]; then
            print_substep "Attempt $attempt failed. Retrying in ${delay}s..." "warning"
            sleep $delay
        fi
        attempt=$((attempt + 1))
    done

    return 1
}

# --- Main Script ---
clear
print_logo

# Check if this is an update
CURRENT_VERSION=$(get_current_version)
if [ -n "$CURRENT_VERSION" ]; then
    IS_UPDATE=true
fi

if [ "$IS_UPDATE" = true ]; then
    echo -e "                    ${YELLOW}[ UPDATING ]${NC}"
    echo -e "              ${GRAY}Current version: $CURRENT_VERSION${NC}"
else
    echo -e "                    ${GREEN}[ INSTALLING ]${NC}"
fi
echo ""

# Step 1: Check network connectivity
print_section "CHECKING REQUIREMENTS"
print_step 1 7 "Checking network connectivity..." "running"

if ! check_network; then
    print_substep "No network connection!" "error"
    echo ""
    echo -e "  ${RED}Please check your internet connection and try again.${NC}"
    echo ""
    exit 1
fi
print_substep "Network connected" "success"

# Step 2: Check Spicetify
print_step 2 7 "Checking Spicetify installation..." "running"

if ! command -v spicetify &> /dev/null; then
    print_substep "Spicetify is not installed!" "warning"
    echo ""
    echo -e "  ${YELLOW}Spicetify is required to use ivLyrics.${NC}"
    echo ""
    echo -ne "  ${CYAN}Would you like to install Spicetify now? (Y/n): ${NC}"
    read -r install_choice

    if [ "$install_choice" = "" ] || [ "$install_choice" = "y" ] || [ "$install_choice" = "Y" ]; then
        echo ""
        print_substep "Installing Spicetify..." "info"
        print_substep "This may take a minute..." "info"
        echo ""

        # Download and run Spicetify installer
        if curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | sh; then
            # Refresh PATH
            export PATH="$PATH:$HOME/.spicetify"

            # Check again
            sleep 2
            if command -v spicetify &> /dev/null; then
                echo ""
                print_substep "Spicetify installed successfully!" "success"

                # Close Spotify if it was opened during Spicetify installation
                sleep 2
                if pgrep -x "Spotify" > /dev/null 2>&1 || pgrep -x "spotify" > /dev/null 2>&1; then
                    print_substep "Closing Spotify opened by Spicetify..." "info"
                    pkill -x "Spotify" 2>/dev/null || pkill -x "spotify" 2>/dev/null
                    sleep 1
                fi
            else
                echo ""
                print_substep "Spicetify installation may require a terminal restart." "warning"
                echo -e "  ${YELLOW}Please restart your terminal and run this script again.${NC}"
                echo ""
                exit 1
            fi
        else
            echo ""
            print_substep "Failed to install Spicetify automatically." "error"
            echo -e "  ${WHITE}Please install manually:${NC}"
            echo -e "  ${CYAN}  curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | sh${NC}"
            echo ""
            exit 1
        fi
    else
        echo ""
        echo -e "  ${GRAY}Installation cancelled. Spicetify is required.${NC}"
        echo ""
        exit 1
    fi
else
    print_substep "Spicetify found" "success"
fi

# Step 3: Close Spotify
print_step 3 7 "Checking Spotify process..." "running"
close_spotify

# Step 4: Check target directory
print_step 4 7 "Checking target directory..." "running"

if [ ! -d "$TARGET_DIR" ]; then
    print_substep "Creating directory..." "info"
    mkdir -p "$TARGET_DIR"
    if [ $? -ne 0 ]; then
        print_substep "Failed to create directory" "error"
        exit 1
    fi
fi
print_substep "Directory ready" "success"

# Step 5: Fetch version info
print_section "DOWNLOADING"
print_step 5 7 "Fetching latest version..." "running"

DOWNLOAD_URL=""
VERSION_TAG="unknown"

# Try GitHub with retry
fetch_from_github() {
    GITHUB_RESPONSE=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null)
    DOWNLOAD_URL=$(echo "$GITHUB_RESPONSE" | grep "zipball_url" | head -n 1 | cut -d'"' -f4)
    VERSION_TAG=$(echo "$GITHUB_RESPONSE" | grep '"tag_name"' | head -n 1 | cut -d'"' -f4)

    if [ -n "$DOWNLOAD_URL" ]; then
        return 0
    fi
    return 1
}

fetch_from_proxy() {
    VERSION_RESPONSE=$(curl -s --connect-timeout 10 "${PROXY_URL}?action=version" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$VERSION_RESPONSE" ]; then
        local ZIP_AVAILABLE=$(echo "$VERSION_RESPONSE" | grep -o '"zip_available":\s*true' | head -n 1)

        if [ -n "$ZIP_AVAILABLE" ]; then
            VERSION_TAG=$(echo "$VERSION_RESPONSE" | grep -o '"tag_name":\s*"[^"]*"' | head -n 1 | cut -d'"' -f4)
            DOWNLOAD_URL="${PROXY_URL}?action=download"
            return 0
        fi
    fi
    return 1
}

# Try GitHub first with retries
if retry_command $MAX_RETRIES 2 "fetch_from_github"; then
    print_substep "Found version: $VERSION_TAG (via GitHub)" "success"
else
    print_substep "GitHub unavailable, trying proxy..." "warning"

    if retry_command $MAX_RETRIES 2 "fetch_from_proxy"; then
        print_substep "Found version: $VERSION_TAG (via proxy)" "success"
    else
        print_step 5 7 "Failed to fetch version info" "error"
        print_substep "Could not connect after $MAX_RETRIES attempts" "error"
        exit 1
    fi
fi

# Check if already up to date
if [ "$IS_UPDATE" = true ] && [ "$CURRENT_VERSION" = "$VERSION_TAG" ] && [ "$FORCE_INSTALL" = false ]; then
    echo ""
    echo -e "  ${GREEN}Already up to date! (v$VERSION_TAG)${NC}"
    echo -e "  ${GRAY}Use --force to reinstall anyway.${NC}"
    echo ""
    print_substep "Checking updater protocol..." "info"
    register_updater_protocol || true
    echo ""
    exit 0
fi

# Step 6: Download and extract
print_step 6 7 "Downloading ivLyrics..." "running"

TEMP_ZIP="/tmp/ivLyrics_latest.zip"
TEMP_EXTRACT="/tmp/ivLyrics_extract"

# Download with retry
download_file() {
    curl -sL "$DOWNLOAD_URL" -o "$TEMP_ZIP"
    if [ $? -eq 0 ] && [ -f "$TEMP_ZIP" ] && [ $(stat -f%z "$TEMP_ZIP" 2>/dev/null || stat -c%s "$TEMP_ZIP" 2>/dev/null) -gt 1000 ]; then
        return 0
    fi
    rm -f "$TEMP_ZIP"
    return 1
}

# Progress simulation + download
for i in 0 20 40 60; do
    print_progress_bar $i
    sleep 0.05
done

if ! retry_command $MAX_RETRIES 2 "download_file"; then
    echo ""
    print_step 6 7 "Download failed after $MAX_RETRIES attempts" "error"
    exit 1
fi

print_progress_bar 100
echo ""
print_substep "Download complete" "success"

# Extract
print_substep "Extracting files..." "info"

rm -rf "$TEMP_EXTRACT"
mkdir -p "$TEMP_EXTRACT"

unzip -q -o "$TEMP_ZIP" -d "$TEMP_EXTRACT"
if [ $? -ne 0 ]; then
    print_substep "Extraction failed" "error"
    rm -f "$TEMP_ZIP"
    rm -rf "$TEMP_EXTRACT"
    exit 1
fi

# Find extracted folder
EXTRACTED_DIR=$(find "$TEMP_EXTRACT" -maxdepth 1 -type d -name "ivLis-Studio-ivLyrics-*" -print -quit)
if [ -z "$EXTRACTED_DIR" ]; then
    EXTRACTED_DIR=$(find "$TEMP_EXTRACT" -maxdepth 1 -mindepth 1 -type d -print -quit)
fi

if [ -z "$EXTRACTED_DIR" ]; then
    print_substep "Could not find extracted folder" "error"
    rm -f "$TEMP_ZIP"
    rm -rf "$TEMP_EXTRACT"
    exit 1
fi

# Install
FINAL_APP_DIR="$TARGET_DIR/$FINAL_APP_NAME"
if [ -d "$FINAL_APP_DIR" ]; then
    rm -rf "$FINAL_APP_DIR"
fi

mv "$EXTRACTED_DIR" "$FINAL_APP_DIR"
print_substep "Extraction complete" "success"

# Cleanup
rm -f "$TEMP_ZIP"
rm -rf "$TEMP_EXTRACT"

# Verify installation
print_substep "Verifying installation..." "info"
if verify_installation; then
    print_substep "Installation verified" "success"
else
    print_substep "Installation verification failed!" "error"
    echo -e "  ${RED}Some required files are missing. Please try again.${NC}"
    exit 1
fi

print_section "CONFIGURING"

print_substep "Registering updater protocol..." "info"
register_updater_protocol || true

# Step 7: Apply Spicetify
print_step 7 7 "Applying Spicetify configuration..." "running"

spicetify config custom_apps ivLyrics 2>/dev/null
if [ $? -eq 0 ]; then
    print_substep "Custom app registered" "success"
else
    print_substep "Config warning (may be ok)" "warning"
fi

spicetify apply 2>/dev/null
if [ $? -eq 0 ]; then
    print_substep "Spicetify applied" "success"
else
    print_substep "Run 'spicetify apply' manually if needed" "warning"
fi

# Done!
print_success "$VERSION_TAG" "$IS_UPDATE"
print_footer "$VERSION_TAG"
