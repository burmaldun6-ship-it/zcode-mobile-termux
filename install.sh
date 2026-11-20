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

if command -v zcode >/dev/null 2>&1; then
  ZCODE_BIN="$(command -v zcode)"
else
  ZCODE_BIN="$PREFIX/bin/zcode"
fi
cp "$ROOT/scripts/zcode.sh" "$ZCODE_BIN" 2>/dev/null || cp "$ROOT/scripts/zcode.sh" "$HOME/.local/bin/zcode" 2>/dev/null || true
chmod +x "$ZCODE_BIN" "$HOME/.local/bin/zcode" 2>/dev/null || true

echo "[OK] ready"
echo "Run:  zcode start"
echo "Open: http://127.0.0.1:3030/?token=\$(cat $DATA/web-token)"
echo "Giveaways: http://127.0.0.1:3030/claims"
