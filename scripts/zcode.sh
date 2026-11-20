#!/usr/bin/env bash
# zcode — CLI helper for the ZCode Termux web client.
# Installed by install.sh as $PREFIX/bin/zcode (Termux) or ~/.local/bin/zcode.
set -uo pipefail

DATA="${ZCODE_MOBILE_DATA:-$HOME/.zcode-mobile}"
LOGS="$DATA/logs"
PORT="${ZCODE_PORT:-3030}"
CLAIM_PORT="${ZCODE_CLAIM_PORT:-45212}"
TOKEN_FILE="$DATA/web-token"
LOG_LINES="${ZCODE_LOG_LINES:-40}"

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
ROOT="$(dirname "$(dirname "$SELF")")"

usage() {
  cat <<'EOF'
Usage: zcode <command>

Pages:
  open            print (and try to open) the web UI URL
  claim           open the standalone giveaway claim page
  status          claim server status (no JWT is returned)
  tokens          history of received promo tokens (claim/history)

Logs (in ~/.zcode-mobile/logs):
  log             official server + agent        (official-server.log)
  log-claim       claim mini server              (claim.log)
  log-claims      successful token claims        (claims.log)
  log-browser     widget browser events          (zcode-browser.log, debug mode)
  log-trace       upstream claim HTTP trace      (claim-trace.log)
  log-all         tail all of the above
  logs            list log files

  Add -f to any log command to follow (e.g. `zcode log-claims -f`).

Lifecycle:
  start           launch the web UI + agent + claim server
  help            this text
EOF
}

web_url() {
  local token=""
  [ -s "$TOKEN_FILE" ] && token="$(cat "$TOKEN_FILE")"
  echo "http://127.0.0.1:${PORT}/?token=${token}"
}

open_url() {
  local url="$1"
  echo "$url"
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url"
  fi
}

pretty_json() {
  node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  try { console.log(JSON.stringify(JSON.parse(s), null, 2)); }
  catch (e) { console.log(s); }
});'
}

view_log() {
  local follow=0 file="$1"
  shift
  if [ "${1:-}" = "-f" ]; then
    follow=1
  fi
  if [ ! -f "$file" ]; then
    echo "[zcode] no log yet: $file" >&2
    return 0
  fi
  if [ "$follow" = 1 ]; then
    tail -n 200 -f "$file"
  else
    tail -n "$LOG_LINES" "$file"
  fi
}

cmd="${1:-help}"
arg="${2:-}"

case "$cmd" in
  open)
    open_url "$(web_url)"
    ;;
  claim)
    open_url "http://127.0.0.1:${CLAIM_PORT}/claim"
    ;;
  status)
    curl -fsS "http://127.0.0.1:${CLAIM_PORT}/claim/status" | pretty_json
    ;;
  tokens|history)
    curl -fsS "http://127.0.0.1:${CLAIM_PORT}/claim/history" | pretty_json
    ;;
  log)
    view_log "$LOGS/official-server.log" "$arg"
    ;;
  log-claim)
    view_log "$LOGS/claim.log" "$arg"
    ;;
  log-claims)
    view_log "$LOGS/claims.log" "$arg"
    ;;
  log-browser)
    view_log "$LOGS/zcode-browser.log" "$arg"
    ;;
  log-trace)
    view_log "$LOGS/claim-trace.log" "$arg"
    ;;
  log-all)
    for f in official-server.log claim.log claims.log claim-trace.log zcode-browser.log; do
      if [ -f "$LOGS/$f" ]; then
        echo "==> $LOGS/$f"
        tail -n "$LOG_LINES" "$LOGS/$f"
        echo
      fi
    done
    ;;
  logs)
    ls -la "$LOGS" 2>/dev/null || echo "[zcode] no logs dir yet: $LOGS"
    ;;
  start)
    if [ -f "$ROOT/scripts/termux-official.sh" ]; then
      bash "$ROOT/scripts/termux-official.sh"
    else
      echo "[zcode] cannot find scripts/termux-official.sh next to $SELF" >&2
      echo "       start it from the install directory: bash scripts/termux-official.sh" >&2
      exit 1
    fi
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage
    echo
    echo "[zcode] unknown command: $cmd" >&2
    exit 1
    ;;
esac
