#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_ID="g-os@greg.local"
XDOCK_ID="xdock@github.com"
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"
TARGET_DIR="$EXTENSIONS_DIR/$EXTENSION_ID"
XDOCK_TARGET_DIR="$EXTENSIONS_DIR/$XDOCK_ID"

cd "$ROOT_DIR"

if [[ ! -f "$ROOT_DIR/vendor/xdock/metadata.json" ]]; then
  git submodule update --init --recursive
fi

echo "[build-deploy] Build de l’extension…"
if ! npm run build; then
  echo "[build-deploy] Échec du build." >&2
  exit 1
fi

echo "[build-deploy] Déploiement vers $TARGET_DIR"
mkdir -p "$EXTENSIONS_DIR"
rm -rf "${TARGET_DIR:?}"
mkdir -p "$TARGET_DIR"
cp -a "$ROOT_DIR/dist/." "$TARGET_DIR/"
rm -rf "${TARGET_DIR:?}/$XDOCK_ID"
rm -rf "${XDOCK_TARGET_DIR:?}"
mkdir -p "$XDOCK_TARGET_DIR"
cp -a "$ROOT_DIR/dist/$XDOCK_ID/." "$XDOCK_TARGET_DIR/"

if command -v gnome-extensions >/dev/null 2>&1; then
  echo "[build-deploy] Recharge des extensions GNOME…"
  gnome-extensions disable "$EXTENSION_ID" >/dev/null 2>&1 || true
  gnome-extensions disable "$XDOCK_ID" >/dev/null 2>&1 || true
  gnome-extensions enable "$EXTENSION_ID" >/dev/null 2>&1 || true
fi

echo "[build-deploy] G-Os déployé dans $TARGET_DIR"
echo "[build-deploy] XDock compagnon déployé dans $XDOCK_TARGET_DIR"
