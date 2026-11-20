#!/usr/bin/env bash
set -Eeuo pipefail

if ! command -v pacman >/dev/null 2>&1; then
    echo "This installer is intended for CachyOS (pacman-based systems)." >&2
    exit 1
fi

PACKAGES=(
    coreutils
    dbus
    glib2
    gnome-shell
    gnome-session
    mutter-devkit
    inotify-tools
    nodejs
    npm
    sassc
)

echo "Installing G-Os development dependencies for CachyOS..."
sudo pacman -S --needed "${PACKAGES[@]}"

echo
gnome-shell --version
echo
echo "The development session targets GNOME Shell 51.x."
echo "Next steps:"
echo "  npm ci"
echo "  npm run dev:check"
echo "  npm run dev"
