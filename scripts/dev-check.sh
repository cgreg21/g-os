#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

missing=()
for tool in git node npm dbus-run-session gnome-shell gnome-extensions gdbus gsettings timeout inotifywait glib-compile-schemas; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        missing+=("$tool")
    fi
done

if (("${#missing[@]}" > 0)); then
    printf 'Missing development dependencies: %s\n' "${missing[*]}" >&2
    echo "Install them with scripts/install-dev-deps-fedora.sh or scripts/install-dev-deps-cachyos.sh." >&2
    exit 1
fi

if [[ ! -f "$ROOT/vendor/xdock/metadata.json" ]]; then
    git submodule update --init --recursive
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((NODE_MAJOR < 20)); then
    echo "Node.js 20 or newer is required; detected $(node --version)." >&2
    exit 1
fi

SHELL_VERSION="$(gnome-shell --version 2>/dev/null || true)"
if [[ ! "$SHELL_VERSION" =~ GNOME\ Shell\ 51([.]|$) ]]; then
    echo "The isolated G-Os development session targets GNOME Shell 51.x; detected: ${SHELL_VERSION:-unknown}." >&2
    exit 1
fi

if [[ -z "${WAYLAND_DISPLAY:-}" && -z "${DISPLAY:-}" ]]; then
    echo "No graphical display detected. Start this command from a GNOME desktop session." >&2
    exit 1
fi

if [[ ! -x /usr/libexec/mutter-devkit && ! -x /usr/lib/mutter-devkit ]]; then
    echo "Mutter Development Kit is required for GNOME Shell 51." >&2
    echo "Install mutter-devkit (Fedora/CachyOS) before starting the isolated session." >&2
    exit 1
fi

echo "Development environment checks passed."
echo "Node.js: $(node --version)"
echo "$SHELL_VERSION"
echo "Nested backend: Mutter Development Kit (--devkit)"
if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    echo "Display backend: Wayland"
else
    echo "Display backend: X11 (DevKit will use Wayland)"
fi
