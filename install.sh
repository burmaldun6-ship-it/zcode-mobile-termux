#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA="${HOME}/.zcode-mobile"

for tool in node bash curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "[ERROR] missing: $tool" >&2; exit 1; }
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "[ERROR] Node >= 24 required (found $(node -v))" >&2
  exit 1
fi

if [ ! -f "$ROOT/dist/server/entry-http.js" ] || [ ! -f "$ROOT/dist/agent/zcode.cjs" ] || [ ! -d "$ROOT/dist/web" ]; then
  echo "[ERROR] dist/ is missing. Download the test tarball from GitHub Releases," >&2
  echo "        extract it, then run install.sh from the extracted folder." >&2
  exit 1
fi

chmod +x "$ROOT"/scripts/*.sh "$ROOT"/claim/*.js 2>/dev/null || true
mkdir -p "$DATA/workspace" "$DATA/logs"

# Install the zcode CLI (log/status/page helpers).
BIN_TARGET="${PREFIX:-}/bin/zcode"
if [ -z "${PREFIX:-}" ] || [ ! -w "${PREFIX:-}/bin" ]; then
  BIN_TARGET="$HOME/.local/bin/zcode"
  mkdir -p "$HOME/.local/bin"
fi
cp "$ROOT/scripts/zcode.sh" "$BIN_TARGET" && chmod +x "$BIN_TARGET" \
  && echo "[OK] zcode CLI installed: $BIN_TARGET" \
  || echo "[WARN] could not install zcode CLI to $BIN_TARGET"

echo "[OK] ready"
echo "Run:  bash $ROOT/scripts/termux-official.sh"
echo "Open: http://127.0.0.1:3030/?token=\$(cat $DATA/web-token)"
echo "Giveaways: http://127.0.0.1:45212/claim"
