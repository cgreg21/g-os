#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="g-os@greg.local"
DASH_TO_DOCK_UUID="dash-to-dock@micxgx.gmail.com"
cd "$ROOT"

: "${XDG_DATA_HOME:?XDG_DATA_HOME must point to the isolated G-Os profile}"
EXTENSIONS_DIR="$XDG_DATA_HOME/gnome-shell/extensions"
EXTENSION_DIR="$EXTENSIONS_DIR/$UUID"
STAGING_DIR="$EXTENSIONS_DIR/.$UUID.staging"
DASH_TO_DOCK_DIR="$EXTENSIONS_DIR/$DASH_TO_DOCK_UUID"
DASH_TO_DOCK_STAGING_DIR="$EXTENSIONS_DIR/.$DASH_TO_DOCK_UUID.staging"

install_extension() {
    echo
    echo "==> Building G-Os..."
    if ! npm run build; then
        echo "Build failed; the installed development extension was left unchanged." >&2
        return 1
    fi

    if [[ ! -f "$ROOT/dist/extension.js" ||
        ! -f "$ROOT/dist/metadata.json" ||
        ! -d "$ROOT/dist/schemas" ||
        ! -f "$ROOT/dist/$DASH_TO_DOCK_UUID/metadata.json" ||
        ! -f "$ROOT/dist/$DASH_TO_DOCK_UUID/schemas/gschemas.compiled" ]]; then
        echo "Build output is incomplete; refusing to replace the installed extensions." >&2
        return 1
    fi

    echo "==> Staging compiled files in $EXTENSION_DIR..."
    mkdir -p "$EXTENSIONS_DIR"
    rm -rf "${STAGING_DIR:?}" "${DASH_TO_DOCK_STAGING_DIR:?}"
    mkdir -p "$STAGING_DIR" "$DASH_TO_DOCK_STAGING_DIR"
    cp -a "$ROOT/dist/." "$STAGING_DIR/"
    rm -rf "${STAGING_DIR:?}/$DASH_TO_DOCK_UUID"
    cp -a "$ROOT/dist/$DASH_TO_DOCK_UUID/." "$DASH_TO_DOCK_STAGING_DIR/"

    echo "==> Activating G-Os in the isolated Shell..."
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    gnome-extensions disable "$DASH_TO_DOCK_UUID" >/dev/null 2>&1 || true
    rm -rf "${EXTENSION_DIR:?}" "${DASH_TO_DOCK_DIR:?}"
    mv "$STAGING_DIR" "$EXTENSION_DIR"
    mv "$DASH_TO_DOCK_STAGING_DIR" "$DASH_TO_DOCK_DIR"

    if ! gnome-extensions enable "$UUID"; then
        echo "Could not enable G-Os in the isolated GNOME Shell." >&2
        return 1
    fi

    echo "==> G-Os deployed to: $EXTENSION_DIR"
    echo "==> Dash to Dock deployed to: $DASH_TO_DOCK_DIR"
    echo "==> Development deployment successful."
}

if ! command -v inotifywait >/dev/null 2>&1; then
    echo "inotifywait is required (package: inotify-tools)." >&2
    exit 1
fi

install_extension || exit 1

echo
echo "Watching src/, schemas/*.gschema.xml, config.json, metadata.json,"
echo "stylesheet.css, icons/, widgets/ and src/dock/dashToDock/ for changes."
echo "Changes are debounced, rebuilt and deployed into the isolated profile."
echo "GNOME Shell restarts after a successful deployment to reload ES modules."
echo "Press Ctrl+C to stop."

WATCH_INCLUDE='(^|/)(src/.*|schemas/[^/]*\.gschema\.xml|config\.json|metadata\.json|stylesheet\.css|icons/.*|widgets/.*|src/dock/dashToDock/.*)$'

while true; do
    inotifywait -q -r \
        --include "$WATCH_INCLUDE" \
        -e close_write,create,delete,move \
        "$ROOT" >/dev/null

    sleep 0.5
    while inotifywait -q -t 0.2 -r \
        --include "$WATCH_INCLUDE" \
        -e close_write,create,delete,move \
        "$ROOT" >/dev/null 2>&1; do
        sleep 0.2
    done

    if install_extension; then
        # GJS caches imported ES modules for the Shell process lifetime.
        exit 75
    fi
done
