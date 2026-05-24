#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS_NAME="$(uname -s)"

if [[ -z "$APP_DIR" ]]; then
    APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

SOURCE_UPDATER="${SCRIPT_DIR}/ivlyrics-updater.sh"
if [[ ! -f "$SOURCE_UPDATER" ]]; then
    echo "Updater script not found: $SOURCE_UPDATER" >&2
    exit 1
fi

register_macos() {
    local updater_script="${APP_DIR}/updater/unix/ivlyrics-updater.sh"
    local app_path="${APP_DIR}/updater/macos/ivLyrics Updater.app"
    local generated_applescript="${APP_DIR}/updater/macos/ivlyrics-updater.generated.applescript"
    local legacy_updater_root="${HOME}/Library/Application Support/ivLyrics/Updater"
    local legacy_app_path="${legacy_updater_root}/ivLyrics Updater.app"
    local escaped_updater_script

    if [[ ! -f "$updater_script" ]]; then
        echo "Updater script not found in app directory: $updater_script" >&2
        exit 1
    fi

    mkdir -p "$(dirname "$app_path")"
    chmod +x "$updater_script"

    if ! command -v osacompile >/dev/null 2>&1; then
        echo "osacompile is required to register ivlyrics-updater:// on macOS." >&2
        return 1
    fi

    if [[ -d "$legacy_app_path" && -x "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" ]]; then
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -u "$legacy_app_path" >/dev/null 2>&1 || true
    fi
    rm -rf "$legacy_updater_root"

    escaped_updater_script="$(printf '%s' "$updater_script" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    cat > "$generated_applescript" <<EOF
on runUpdater(theURL)
    set updaterScript to "$escaped_updater_script"
    try
        do shell script "/usr/bin/nohup /bin/bash " & quoted form of updaterScript & " " & quoted form of theURL & " >/dev/null 2>&1 &"
        display notification "Update started in the background." with title "ivLyrics Updater"
    on error errorMessage
        display dialog "ivLyrics Updater could not start:" & return & errorMessage buttons {"OK"} default button "OK" with icon caution
    end try
end runUpdater

on open location theURL
    runUpdater(theURL)
end open location

on run
    runUpdater("ivlyrics-updater://update")
end run
EOF

    rm -rf "$app_path"
    osacompile -o "$app_path" "$generated_applescript"
    rm -f "$generated_applescript"

    local plist="${app_path}/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string ivLyrics Updater" "$plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ivlyrics-updater" "$plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier kr.ivlis.ivlyrics.updater" "$plist" 2>/dev/null || \
        /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string kr.ivlis.ivlyrics.updater" "$plist" 2>/dev/null || true

    if [[ -x "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" ]]; then
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "$app_path" >/dev/null 2>&1 || true
    fi

    echo "Registered ivlyrics-updater:// protocol for macOS."
}

register_linux() {
    local data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
    local updater_script="${APP_DIR}/updater/unix/ivlyrics-updater.sh"
    local desktop_dir="${data_home}/applications"
    local desktop_file="${desktop_dir}/ivlyrics-updater.desktop"

    if [[ ! -f "$updater_script" ]]; then
        echo "Updater script not found in app directory: $updater_script" >&2
        exit 1
    fi

    mkdir -p "$desktop_dir"
    chmod +x "$updater_script"

    cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=ivLyrics Updater
Exec=/bin/bash "${updater_script}" %u
MimeType=x-scheme-handler/ivlyrics-updater;
Terminal=true
NoDisplay=true
EOF

    chmod +x "$desktop_file"

    if command -v xdg-mime >/dev/null 2>&1; then
        xdg-mime default ivlyrics-updater.desktop x-scheme-handler/ivlyrics-updater
    fi

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
    fi

    echo "Registered ivlyrics-updater:// protocol for Linux."
}

case "$OS_NAME" in
    Darwin) register_macos ;;
    Linux) register_linux ;;
    *) echo "Unsupported OS for updater protocol: $OS_NAME" >&2; exit 1 ;;
esac
