#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_ID="g-os@greg.local"
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_ID"

cd "$ROOT_DIR"

echo "[build-deploy] Build de l’extension…"
if ! npm run build; then
  echo "[build-deploy] Échec du build." >&2
  exit 1
fi

echo "[build-deploy] Déploiement vers $TARGET_DIR"
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -a "$ROOT_DIR/dist/." "$TARGET_DIR/"

if command -v gnome-extensions >/dev/null 2>&1; then
  echo "[build-deploy] Recharge des extensions GNOME…"
  gnome-extensions disable "$EXTENSION_ID" >/dev/null 2>&1 || true
  gnome-extensions enable "$EXTENSION_ID" >/dev/null 2>&1 || true
fi

echo "[build-deploy] OK : extension déployée dans $TARGET_DIR"
