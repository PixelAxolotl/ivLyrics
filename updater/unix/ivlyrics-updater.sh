#!/usr/bin/env bash
set -euo pipefail

URI="${1:-ivlyrics-updater://update}"
INSTALLER_URL="https://ivlis.kr/ivLyrics/install.sh"

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
    local temp_root
    temp_root="$(mktemp -d "${TMPDIR:-/tmp}/ivlyrics-updater.XXXXXX")"
    local installer_path="${temp_root}/install.sh"

    log "Downloading official installer."
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$INSTALLER_URL" -o "$installer_path"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$installer_path" "$INSTALLER_URL"
    else
        log "curl or wget is required."
        return 1
    fi

    chmod +x "$installer_path"
    log "Running installer."
    bash "$installer_path"
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
