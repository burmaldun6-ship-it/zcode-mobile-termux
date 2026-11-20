#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA="${HOME}/.zcode-mobile"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"

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

chmod +x "$ROOT"/scripts/*.sh "$ROOT"/scripts/zcode "$ROOT"/claim/*.js 2>/dev/null || true
mkdir -p "$DATA/logs"

# remember the install root for the zcode wrapper
printf '%s\n' "$ROOT" > "$DATA/app-root"

# install the zcode CLI
if install -m 700 "$ROOT/scripts/zcode" "$PREFIX/bin/zcode" 2>/dev/null; then
  ZCODE_BIN="$PREFIX/bin/zcode"
else
  mkdir -p "$HOME/.local/bin"
  install -m 700 "$ROOT/scripts/zcode" "$HOME/.local/bin/zcode"
  ZCODE_BIN="$HOME/.local/bin/zcode"
fi

echo "[OK] ready"
echo "Start:   zcode start            (run from the folder the agent should work in)"
echo "Claim:   zcode claim            -> http://127.0.0.1:3030/claims"
echo "Status:  zcode status"
echo "UI:      http://127.0.0.1:3030/?token=\$(cat $DATA/web-token)   (after first start)"
