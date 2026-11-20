#!/usr/bin/env bash
# ZCode Mobile terminal client for Termux.
# Starts the Node backend from the project tree and serves the web UI at 127.0.0.1.
set -uo pipefail

PROJECT_DIR="${ZCODE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATA_DIR="${ZCODE_MOBILE_DATA:-$HOME/.zcode-mobile}"
LOG_DIR="$DATA_DIR/logs"
PID_FILE="$DATA_DIR/backend.pid"
LOG_FILE="$LOG_DIR/backend.log"
SECRET_FILE="$DATA_DIR/credential.secret"
PORT="${ZCODE_BRIDGE_PORT:-45210}"
HOST="${ZCODE_BRIDGE_HOST:-127.0.0.1}"
BASE_URL="http://$HOST:$PORT"
URL="$BASE_URL/"
BOOTSTRAP="$PROJECT_DIR/backend/bootstrap.js"

prepare() {
  mkdir -p "$DATA_DIR" "$LOG_DIR" "$HOME/.zcode-mobile/workspace"
  chmod 700 "$DATA_DIR" 2>/dev/null || true
  if [ ! -s "$SECRET_FILE" ]; then
    openssl rand -hex 32 > "$SECRET_FILE" 2>/dev/null ||
      head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE" 2>/dev/null || true
  fi
  export ZCODE_CREDENTIAL_SECRET="$(tr -d ' \r\n' < "$SECRET_FILE")"
  export HOME="${HOME:-/data/data/com.termux/files/home}"
  export ZCODE_DATA_BASE_DIR="$DATA_DIR/v2"
  export ZCODE_HOME="$DATA_DIR"
  export ZCODE_WORKSPACE="${ZCODE_WORKSPACE:-$HOME/.zcode-mobile/workspace}"
  export ZCODE_NODE_BIN="$(command -v node)"
  export ZCODE_LIB_DIR="${PREFIX:-/data/data/com.termux/files/usr}/lib"
  export ZCODE_CREDENTIAL_SECRET_FILE="$SECRET_FILE"
  export ZCODE_BRIDGE_PORT="$PORT"
  export ZCODE_BRIDGE_HOST="$HOST"
  export PATH="$PREFIX/bin:$PROJECT_DIR/dist/agent/tools/ripgrep:$PROJECT_DIR/dist/agent/tools/bfs:$PROJECT_DIR/dist/agent/tools/ugrep:$PATH"
  export SHELL="$PREFIX/bin/bash"
}

health() {
  curl -fsS --max-time 3 "$BASE_URL/health" 2>/dev/null
}

wait_health() {
  local i
  for i in $(seq 1 90); do
    if health | grep -q '"hostReady":true'; then
      return 0
    fi
    if ! kill -0 "$(cat "$PID_FILE" 2>/dev/null || echo 0)" 2>/dev/null; then
      echo "[!] backend exited; last log lines:" >&2
      tail -20 "$LOG_FILE" >&2 2>/dev/null || true
      return 1
    fi
    sleep 1
  done
  echo "[!] timed out waiting for $URL/health" >&2
  tail -20 "$LOG_FILE" >&2 2>/dev/null || true
  return 1
}

open_browser() {
  local target="${1:-$URL}"
  if command -v am >/dev/null 2>&1; then
    am start -a android.intent.action.VIEW -d "$target" >/dev/null 2>&1 && return 0
  fi
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$target" >/dev/null 2>&1 && return 0
  fi
  echo "[i] open manually: $target"
}

kill_backend() {
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    local children
    children="$(pgrep -P "$pid" 2>/dev/null || true)"
    [ -n "$children" ] && kill $children 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 $children "$pid" 2>/dev/null || true
  fi
  ps -eo pid=,args= 2>/dev/null | while read -r p args; do
    case "$args" in
      *"$PROJECT_DIR/assets/backend/"*) kill -9 "$p" 2>/dev/null || true ;;
    esac
  done
  rm -f "$PID_FILE"
}

case "${1:-start}" in
  prepare)
    prepare
    echo "data: $DATA_DIR"
    echo "secret: $SECRET_FILE"
    ;;
  start)
    prepare
    if health >/dev/null 2>&1; then
      echo "[i] backend already running: $URL"
    else
      echo "[*] starting backend: $URL"
      setsid nohup env HOME="$HOME" \
        ZCODE_DATA_BASE_DIR="$ZCODE_DATA_BASE_DIR" \
        ZCODE_HOME="$ZCODE_HOME" \
        ZCODE_WORKSPACE="$ZCODE_WORKSPACE" \
        ZCODE_NODE_BIN="$ZCODE_NODE_BIN" \
        ZCODE_LIB_DIR="$ZCODE_LIB_DIR" \
        ZCODE_CREDENTIAL_SECRET="$ZCODE_CREDENTIAL_SECRET" \
        ZCODE_CREDENTIAL_SECRET_FILE="$ZCODE_CREDENTIAL_SECRET_FILE" \
        ZCODE_BRIDGE_PORT="$PORT" ZCODE_BRIDGE_HOST="$HOST" \
        "$ZCODE_NODE_BIN" "$BOOTSTRAP" > "$LOG_FILE" 2>&1 &
      echo $! > "$PID_FILE"
      echo "[*] pid $(cat "$PID_FILE")"
      wait_health || exit 1
      echo "[OK] backend ready: $URL"
    fi
    [ "${2:-}" = "--no-browser" ] || open_browser
    ;;
  run)
    prepare
    echo "[*] running in foreground: $URL (Ctrl-C to stop)"
    exec "$ZCODE_NODE_BIN" "$BOOTSTRAP"
    ;;
  stop)
    kill_backend
    echo "[OK] stopped"
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    if health >/dev/null 2>&1; then
      echo "[OK] $URL"
      health
    else
      echo "[!] not running"
      exit 1
    fi
    ;;
  open)
    open_browser "${2:-$URL}"
    ;;
  claim)
    open_browser "${URL}claim"
    ;;
  log)
    tail -n "${2:-50}" "$LOG_FILE" 2>/dev/null || echo "no log"
    ;;
  *)
    echo "usage: $0 {start|run|stop|restart|status|open|claim|log|prepare}"
    exit 2
    ;;
esac
