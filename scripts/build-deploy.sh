#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_ID="g-os@greg.local"
DASH_TO_DOCK_ID="dash-to-dock@micxgx.gmail.com"
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"
TARGET_DIR="$EXTENSIONS_DIR/$EXTENSION_ID"
DASH_TO_DOCK_TARGET_DIR="$EXTENSIONS_DIR/$DASH_TO_DOCK_ID"

cd "$ROOT_DIR"

if [[ ! -f "$ROOT_DIR/vendor/dash-to-dock/metadata.json" ]]; then
  echo "[build-deploy] Sources Dash to Dock absentes du dépôt." >&2
  exit 1
fi

echo "[build-deploy] Build de l’extension…"
if ! npm run build; then
  echo "[build-deploy] Échec du build." >&2
  exit 1
fi

echo "[build-deploy] Déploiement vers $TARGET_DIR"
mkdir -p "$EXTENSIONS_DIR"
if command -v gnome-extensions >/dev/null 2>&1; then
  echo "[build-deploy] Désactivation des extensions avant remplacement…"
  gnome-extensions disable "$EXTENSION_ID" >/dev/null 2>&1 || true
  gnome-extensions disable "$DASH_TO_DOCK_ID" >/dev/null 2>&1 || true
fi

rm -rf "${TARGET_DIR:?}"
mkdir -p "$TARGET_DIR"
cp -a "$ROOT_DIR/dist/." "$TARGET_DIR/"
rm -rf "${DASH_TO_DOCK_TARGET_DIR:?}"
mkdir -p "$DASH_TO_DOCK_TARGET_DIR"
cp -a "$ROOT_DIR/dist/$DASH_TO_DOCK_ID/." "$DASH_TO_DOCK_TARGET_DIR/"

if command -v gnome-extensions >/dev/null 2>&1; then
  if ! gnome-extensions enable "$EXTENSION_ID" >/dev/null 2>&1; then
    echo "[build-deploy] Extension copiée. Reconnecte-toi, puis active G-Os dans Extensions." >&2
  fi
fi

echo "[build-deploy] G-Os déployé dans $TARGET_DIR"
echo "[build-deploy] Dash to Dock déployé dans $DASH_TO_DOCK_TARGET_DIR"
