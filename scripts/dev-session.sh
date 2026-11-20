#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DEV_HOME="${G_OS_DEV_HOME:-$HOME/.local/share/g-os-dev}"

bash "$ROOT/scripts/dev-check.sh"

mkdir -p "$DEV_HOME"/{config,data,cache,state}
export XDG_CONFIG_HOME="$DEV_HOME/config"
export XDG_DATA_HOME="$DEV_HOME/data"
export XDG_CACHE_HOME="$DEV_HOME/cache"
export XDG_STATE_HOME="$DEV_HOME/state"
export GSETTINGS_BACKEND=dconf

# Install both extension directories before Shell scans its extension paths.
# The XDock companion must be registered before G-Os requests its activation.
echo "Building and staging G-Os plus its XDock companion..."
npm run build
EXTENSIONS_DIR="$XDG_DATA_HOME/gnome-shell/extensions"
GOS_STAGE="$EXTENSIONS_DIR/.g-os@greg.local.staging"
XDOCK_STAGE="$EXTENSIONS_DIR/.xdock@github.com.staging"
mkdir -p "$EXTENSIONS_DIR"
rm -rf "$GOS_STAGE" "$XDOCK_STAGE"
mkdir -p "$GOS_STAGE" "$XDOCK_STAGE"
cp -a "$ROOT/dist/." "$GOS_STAGE/"
rm -rf "${GOS_STAGE:?}/xdock@github.com"
cp -a "$ROOT/dist/xdock@github.com/." "$XDOCK_STAGE/"
rm -rf "${EXTENSIONS_DIR:?}/g-os@greg.local" "${EXTENSIONS_DIR:?}/xdock@github.com"
mv "$GOS_STAGE" "$EXTENSIONS_DIR/g-os@greg.local"
mv "$XDOCK_STAGE" "$EXTENSIONS_DIR/xdock@github.com"

echo "Starting an isolated GNOME Shell 51 DevKit session."
echo "Private GNOME profile: $DEV_HOME"
echo "Your regular GNOME session and extension profile are not modified."
echo "Close the DevKit window or press Ctrl+C here to stop."

# shellcheck disable=SC2016 # The nested script must expand variables in its own shell.
dbus-run-session -- bash -Eeuo pipefail -c '
    ROOT="$1"
    shift
    SHELL_PID=""
    SHELL_LOG="$(mktemp)"

    cleanup() {
        if [[ -n "$SHELL_PID" ]]; then
            kill "$SHELL_PID" 2>/dev/null || true
            wait "$SHELL_PID" 2>/dev/null || true
        fi
        rm -f "$SHELL_LOG"
    }
    trap cleanup EXIT INT TERM

    cd "$ROOT"
    while true; do
        echo
        echo "Launching isolated GNOME Shell DevKit..."
        : > "$SHELL_LOG"
        gnome-shell --devkit --wayland > >(tee "$SHELL_LOG") 2>&1 &
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

        # The Shell D-Bus service is available before Main.layoutManager and
        # global.stage finish startup. Enabling extensions at that point makes
        # their St actors allocate while they are not yet attached to the stage.
        STARTUP_DEADLINE=$((SECONDS + 45))
        until grep -q "GNOME Shell started at" "$SHELL_LOG"; do
            if ! kill -0 "$SHELL_PID" 2>/dev/null; then
                wait "$SHELL_PID" || true
                echo "GNOME Shell exited before startup completed." >&2
                exit 1
            fi
            if ((SECONDS >= STARTUP_DEADLINE)); then
                echo "GNOME Shell did not complete startup within 45 seconds." >&2
                exit 1
            fi
            sleep 0.25
        done

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
