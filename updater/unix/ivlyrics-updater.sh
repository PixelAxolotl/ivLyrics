#!/usr/bin/env bash
set -euo pipefail

URI="${1:-ivlyrics-updater://update}"
INSTALLER_URL="https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater/install.sh"
export PATH="${HOME}/.spicetify:${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ "$(uname -s)" == "Darwin" ]]; then
    LOG_ROOT="${HOME}/Library/Logs/ivLyrics"
else
    STATE_HOME="${XDG_STATE_HOME:-${HOME}/.local/state}"
    LOG_ROOT="${STATE_HOME}/ivLyrics"
fi

LOG_PATH="${LOG_ROOT}/updater.log"

notify_macos() {
    if [[ "$(uname -s)" != "Darwin" ]]; then
        return 0
    fi
    if ! command -v osascript >/dev/null 2>&1; then
        return 0
    fi

    local message="$1"
    /usr/bin/osascript -e "display notification \"${message}\" with title \"ivLyrics Updater\"" >/dev/null 2>&1 || true
}

notify_failure_on_exit() {
    local status=$?
    if [[ "$status" -ne 0 ]]; then
        notify_macos "Update failed. Check updater.log."
    fi
}

trap notify_failure_on_exit EXIT

log() {
    mkdir -p "$LOG_ROOT"
    local line
    line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    printf '%s\n' "$line" >> "$LOG_PATH"
    printf '%s\n' "$*"
}

log_stream() {
    while IFS= read -r line; do
        log "[installer] $line"
    done
}

get_action() {
    local raw="$1"
    local action=""

    case "$raw" in
        ivlyrics-updater://*)
            action="${raw#ivlyrics-updater://}"
            action="${action%%[/?#]*}"
            ;;
        update|open-log)
            action="$raw"
            ;;
        *)
            action=""
            ;;
    esac

    case "$action" in
        ""|update) printf 'update' ;;
        open-log) printf 'open-log' ;;
        *) return 1 ;;
    esac
}

open_log() {
    mkdir -p "$LOG_ROOT"
    touch "$LOG_PATH"

    if command -v open >/dev/null 2>&1; then
        open "$LOG_PATH"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$LOG_PATH" >/dev/null 2>&1 &
    else
        printf '%s\n' "$LOG_PATH"
    fi
}

run_update() {
    log "Starting ivLyrics update."
    if command -v spicetify >/dev/null 2>&1; then
        log "Using spicetify: $(command -v spicetify)"
    else
        log "spicetify was not found in PATH before running installer."
    fi

    local temp_root
    temp_root="$(mktemp -d "${TMPDIR:-/tmp}/ivlyrics-updater.XXXXXX")"
    local installer_path="${temp_root}/install.sh"

    log "Downloading official installer."
    local download_status=0
    if command -v curl >/dev/null 2>&1; then
        set +e
        curl -fsSLo "$installer_path" "$INSTALLER_URL" 2>&1 | log_stream
        download_status=${PIPESTATUS[0]}
        set -e
    elif command -v wget >/dev/null 2>&1; then
        set +e
        wget -O "$installer_path" "$INSTALLER_URL" 2>&1 | log_stream
        download_status=${PIPESTATUS[0]}
        set -e
    else
        log "curl or wget is required."
        return 1
    fi

    if [[ "$download_status" -ne 0 ]]; then
        log "Installer download failed with exit code ${download_status}."
        rm -rf "$temp_root"
        return "$download_status"
    fi

    chmod +x "$installer_path"
    log "Running installer."
    local installer_status=0
    set +e
    bash "$installer_path" </dev/null 2>&1 | log_stream
    installer_status=${PIPESTATUS[0]}
    set -e

    if [[ "$installer_status" -ne 0 ]]; then
        log "Installer failed with exit code ${installer_status}."
        rm -rf "$temp_root"
        return "$installer_status"
    fi

    rm -rf "$temp_root"
    log "ivLyrics update completed."
    notify_macos "Update completed."
}

main() {
    local action
    if ! action="$(get_action "$URI")"; then
        log "Unsupported updater action: $URI"
        exit 1
    fi

    case "$action" in
        update) run_update ;;
        open-log) open_log ;;
    esac
}

main "$@"
