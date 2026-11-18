#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HOME="${G_OS_DEV_HOME:-$HOME/.local/share/g-os-dev}"

bash "$ROOT/scripts/dev-check.sh"

mkdir -p "$DEV_HOME"/{config,data,cache,state}
export XDG_CONFIG_HOME="$DEV_HOME/config"
export XDG_DATA_HOME="$DEV_HOME/data"
export XDG_CACHE_HOME="$DEV_HOME/cache"
export XDG_STATE_HOME="$DEV_HOME/state"
export GSETTINGS_BACKEND=dconf

echo "Starting an isolated GNOME Shell 51 DevKit session."
echo "Private GNOME profile: $DEV_HOME"
echo "Your regular GNOME session and extension profile are not modified."
echo "Close the DevKit window or press Ctrl+C here to stop."

dbus-run-session -- bash -Eeuo pipefail -c '
    ROOT="$1"
    shift
    SHELL_PID=""

    cleanup() {
        if [[ -n "$SHELL_PID" ]]; then
            kill "$SHELL_PID" 2>/dev/null || true
            wait "$SHELL_PID" 2>/dev/null || true
        fi
    }
    trap cleanup EXIT INT TERM

    cd "$ROOT"
    while true; do
        echo
        echo "Launching isolated GNOME Shell DevKit..."
        gnome-shell --devkit --wayland &
        SHELL_PID=$!

        timeout 45s gdbus wait --session org.gnome.Shell &
        WAIT_PID=$!
        while kill -0 "$WAIT_PID" 2>/dev/null; do
            if ! kill -0 "$SHELL_PID" 2>/dev/null; then
                wait "$SHELL_PID" || true
                wait "$WAIT_PID" 2>/dev/null || true
                echo "GNOME Shell exited before its D-Bus service became ready." >&2
                exit 1
            fi
            sleep 0.25
        done
        if ! wait "$WAIT_PID"; then
            echo "GNOME Shell did not expose org.gnome.Shell within 45 seconds." >&2
            exit 1
        fi

        WATCH_STATUS=0
        npm run dev:watch || WATCH_STATUS=$?

        kill "$SHELL_PID" 2>/dev/null || true
        wait "$SHELL_PID" 2>/dev/null || true
        SHELL_PID=""

        if ((WATCH_STATUS == 75)); then
            echo "G-Os was rebuilt; restarting the isolated GNOME Shell."
            continue
        fi
        exit "$WATCH_STATUS"
    done
' _ "$ROOT"
