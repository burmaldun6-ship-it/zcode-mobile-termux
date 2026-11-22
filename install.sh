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
  echo "[ERROR] dist/ is missing. Use a release tarball from GitHub Releases," >&2
  echo "        extract it, then run install.sh from the extracted folder." >&2
  exit 1
fi

chmod +x "$ROOT"/scripts/*.sh "$ROOT"/scripts/zcode "$ROOT"/claim/*.js 2>/dev/null || true
mkdir -p "$DATA/logs"

# remember the install root for the zcode wrapper
printf '%s\n' "$ROOT" > "$DATA/app-root"

# install the zcode CLI
ZCODE_BIN="$PREFIX/bin/zcode"
if ! install -m 700 "$ROOT/scripts/zcode" "$ZCODE_BIN" 2>/dev/null; then
  ZCODE_BIN="$HOME/.local/bin/zcode"
  mkdir -p "$HOME/.local/bin"
  install -m 700 "$ROOT/scripts/zcode" "$ZCODE_BIN" \
    || { echo "[ERROR] could not install the zcode command" >&2; exit 1; }
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "[!] $HOME/.local/bin is not in PATH; add it to use the zcode command" >&2 ;;
  esac
fi

echo "[OK] ready (command: ${ZCODE_BIN})"
echo "Start:   zcode start            (run from the folder the agent should work in)"
echo "Claim:   zcode claim            -> http://127.0.0.1:3030/claims"
echo "Status:  zcode status"
echo "UI:      http://127.0.0.1:3030/?token=\$(cat $DATA/web-token)   (after first start)"
