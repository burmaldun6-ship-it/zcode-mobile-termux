#!/usr/bin/env bash
# Official ZCode web UI + agent on Termux, workspace-aware launcher.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$PROJECT/dist"
DATA="${HOME}/.zcode-mobile"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
PORT="${ZCODE_PORT:-3030}"
HOST="${ZCODE_HOST:-0.0.0.0}"

WORKSPACE="${ZCODE_WORKSPACE:-${1:-$PWD}}"
if [ ! -d "$WORKSPACE" ]; then
  echo "[ERROR] workspace is not a directory: $WORKSPACE" >&2
  exit 1
fi
WORKSPACE=$(cd "$WORKSPACE" && pwd -P)

mkdir -p "$DATA/logs"

SECRET_FILE="$DATA/credential.secret"
if [ ! -s "$SECRET_FILE" ]; then
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE"
fi
SECRET=$(cat "$SECRET_FILE")

TOKEN_FILE="$DATA/web-token"
if [ ! -s "$TOKEN_FILE" ]; then
  head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > "$TOKEN_FILE"
fi
TOKEN=$(cat "$TOKEN_FILE")

if [ ! -f "$ROOT/server/entry-http.js" ] || [ ! -f "$ROOT/agent/zcode.cjs" ] || [ ! -d "$ROOT/web" ]; then
  echo "[ERROR] runtime not assembled at $ROOT" >&2
  exit 1
fi

export HOME="$DATA"
export SHELL="$PREFIX/bin/bash"
export PATH="$PREFIX/bin:$PREFIX/bin/applets:$PATH"
export LD_LIBRARY_PATH="$PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export TMPDIR="${TMPDIR:-$DATA/logs}"
export ZCODE_DATA_BASE_DIR="$DATA/v2"
export ZCODE_APP_VERSION="3.18.2"
export ZCODE_HOME="$DATA"
export ZCODE_WORKSPACE="$WORKSPACE"
export ZCODE_CREDENTIAL_SECRET="$SECRET"
export ZCODE_BUILTIN_PROVIDER_CONFIG_FILE="$ROOT/agent/provider/zcode-builtin.json"
export ZCODE_AGENT_SERVER_COMMAND="$(command -v node)"
export ZCODE_AGENT_SERVER_ARGS_JSON="[\"$ROOT/agent/zcode.cjs\",\"app-server\",\"--stdio\"]"
export ZCODE_AGENT_CA_CERT="$PREFIX/etc/tls/cert.pem"
export NODE_EXTRA_CA_CERTS="$PREFIX/etc/tls/cert.pem"
export PORT="$PORT"
export ZCODE_SERVER_HOST="$HOST"
export ZCODE_SERVER_WORKSPACE="$WORKSPACE"
export ZCODE_WEB_STATIC_ROOT="$ROOT/web"
export ZCODE_SERVER_AUTH_TOKEN="$TOKEN"

echo "[*] ZCode Web UI: http://127.0.0.1:${PORT}/?token=${TOKEN}"
echo "[*] Workspace:    $WORKSPACE"
echo "[*] Agent shell:  $SHELL"

cd "$WORKSPACE" || exit 1
exec node "$ROOT/server/entry-http.js"
