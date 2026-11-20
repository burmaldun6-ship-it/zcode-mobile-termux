#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_DIST="${1:?usage: assemble-release.sh <upstream-dist-dir> <out-dir>}"
OUT_DIR="${2:?usage: assemble-release.sh <upstream-dist-dir> <out-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${RELEASE_VERSION:-3.18.2-test}"

for p in web server agent node_modules; do
  [ -e "$UPSTREAM_DIST/$p" ] || { echo "[ERROR] missing upstream artifact: $UPSTREAM_DIST/$p" >&2; exit 1; }
done

NAME="zcode-mobile-termux-${VERSION}"
STAGE="${OUT_DIR}/${NAME}"
rm -rf "$STAGE"
mkdir -p "$STAGE" "$OUT_DIR"

tar -C "$ROOT" \
  --exclude=.git \
  --exclude=dist-release \
  --exclude=dist \
  --exclude=node_modules \
  -cf - . | tar -C "$STAGE" -xf -

mkdir -p "$STAGE/dist"
cp -a "$UPSTREAM_DIST/web" "$STAGE/dist/web"
cp -a "$UPSTREAM_DIST/server" "$STAGE/dist/server"
cp -a "$UPSTREAM_DIST/agent" "$STAGE/dist/agent"
cp -a "$UPSTREAM_DIST/node_modules" "$STAGE/dist/node_modules"
python3 "$STAGE/scripts/patch-runtime.py" "$STAGE/dist"
chmod +x "$STAGE"/scripts/*.sh "$STAGE/install.sh" 2>/dev/null || true

tar -czf "${OUT_DIR}/${NAME}.tar.gz" -C "$OUT_DIR" "$NAME"
echo "[OK] ${OUT_DIR}/${NAME}.tar.gz"
