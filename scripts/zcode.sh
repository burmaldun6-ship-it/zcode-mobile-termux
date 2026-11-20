#!/usr/bin/env bash
set -uo pipefail

DATA="${HOME}/.zcode-mobile"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
PORT="${ZCODE_PORT:-3030}"
CLAIM_PORT="${ZCODE_CLAIM_PORT:-45212}"

if [ -n "${ZCODE_PROJECT:-}" ]; then
  PROJECT="$ZCODE_PROJECT"
elif [ -f "$HOME/zcode-mobile-termux/scripts/termux-official.sh" ]; then
  PROJECT="$HOME/zcode-mobile-termux"
else
  PROJECT="/storage/emulated/0/ya_chmo/output/zcode-mobile"
fi

LAUNCHER="$PROJECT/scripts/termux-official.sh"
CLAIMER="$PROJECT/scripts/claim-mini-server.js"
ENTRY=""
for candidate in "$PROJECT/runtime-official/server/entry-http.js" "$PROJECT/dist/server/entry-http.js"; do
  if [ -f "$candidate" ]; then ENTRY="$candidate"; break; fi
done
RUNTIME_DIR=""
for candidate in "$PROJECT/runtime-official" "$PROJECT/dist"; do
  if [ -d "$candidate" ]; then RUNTIME_DIR="$candidate"; break; fi
done

mkdir -p "$DATA/logs" "$DATA/workspace"
TOKEN_FILE="$DATA/web-token"
if [ ! -s "$TOKEN_FILE" ]; then
  head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > "$TOKEN_FILE"
fi
TOKEN=$(cat "$TOKEN_FILE")
BASE_URL="http://127.0.0.1:${PORT}/?token=${TOKEN}&_=$(date +%s)"
if [ "${ZCODE_CLAIM_DEBUG:-0}" = 1 ]; then
  BASE_URL="${BASE_URL}&zcodeDebug=1"
fi
CLAIM_URL="http://127.0.0.1:${PORT}/claims"

http_code() {
  curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true
}

server_up() {
  case "$(http_code "http://127.0.0.1:${PORT}/api/server-info")" in
    200|401) return 0 ;;
    *) return 1 ;;
  esac
}

claim_backend_up() {
  [ "$(http_code "http://127.0.0.1:${CLAIM_PORT}/claim/status")" = 200 ]
}

claim_up() {
  [ "$(http_code "$CLAIM_URL")" = 200 ]
}

pid_matches() {
  pid="$1"
  marker="$2"
  [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fq -- "$marker"
}

stop_process() {
  pidfile="$1"
  marker="$2"
  [ -f "$pidfile" ] || return 0
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    [ "$pid" = "$$" ] && continue
    [ "$pid" = "$PPID" ] && continue
    if pid_matches "$pid" "$marker"; then
      kill "$pid" 2>/dev/null || true
      printf '[OK] stopped pid %s\n' "$pid"
    fi
  done < "$pidfile"
  rm -f "$pidfile"
}

stop_all() {
  stop_process "$DATA/official.pid" "$ENTRY"
  stop_process "$DATA/claim.pid" "claim-mini-server.js"
  for marker in "$ENTRY" "claim-mini-server.js"; do
    [ -n "$marker" ] || continue
    for pid in $(pgrep -f -- "$marker" 2>/dev/null); do
      [ "$pid" = "$$" ] && continue
      [ "$pid" = "$PPID" ] && continue
      if pid_matches "$pid" "$marker"; then
        kill "$pid" 2>/dev/null || true
        printf '[OK] stopped pid %s\n' "$pid"
      fi
    done
  done
  sleep 1
  if server_up || claim_backend_up; then
    printf '[!] some processes still up; force killing\n'
    for marker in "$ENTRY" "claim-mini-server.js"; do
      for pid in $(pgrep -f -- "$marker" 2>/dev/null); do
        [ "$pid" = "$$" ] && continue
        [ "$pid" = "$PPID" ] && continue
        if pid_matches "$pid" "$marker"; then kill -9 "$pid" 2>/dev/null || true; fi
      done
    done
  fi
  rm -f "$DATA/official.pid" "$DATA/claim.pid"
}

start_claim() {
  claim_backend_up && return 0
  setsid nohup env HOME="$DATA" SHELL="$PREFIX/bin/bash" \
    PATH="$PREFIX/bin:$PREFIX/bin/applets:$PATH" \
    ZCODE_CLAIM_TRACE="${ZCODE_CLAIM_TRACE:-1}" \
    node "$CLAIMER" > "$DATA/logs/claim.log" 2>&1 &
  printf '%s\n' "$!" > "$DATA/claim.pid"
}

start_server() {
  if [ ! -f "$LAUNCHER" ]; then
    printf '[ERROR] launcher not found: %s\n' "$LAUNCHER" >&2
    return 1
  fi
  ZCODE_RUNTIME_DIR="${ZCODE_RUNTIME_DIR:-$RUNTIME_DIR}" \
    setsid nohup bash "$LAUNCHER" > "$DATA/logs/official-server.log" 2>&1 &
  printf '%s\n' "$!" > "$DATA/official.pid"
}

ensure_server() {
  if ! server_up; then
    start_server || return 1
    i=0
    while [ "$i" -lt 40 ]; do
      server_up && break
      sleep 0.5
      i=$((i + 1))
    done
    if ! server_up; then
      printf '[ERROR] server did not start; see %s\n' "$DATA/logs/official-server.log" >&2
      return 1
    fi
  fi
  start_claim
}

open_url() {
  if command -v am >/dev/null 2>&1 && am start -a android.intent.action.VIEW -d "$1" >/dev/null 2>&1; then
    return 0
  fi
  if command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$1" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

print_status() {
  if server_up; then printf '[OK] server up\n'; else printf '[DOWN] server\n'; fi
  if claim_backend_up; then printf '[OK] claim backend up\n'; else printf '[DOWN] claim backend\n'; fi
  if claim_up; then printf '[OK] claims page up\n'; else printf '[DOWN] claims page\n'; fi
}

info() {
  printf '[*] UI:        %s\n' "$BASE_URL"
  printf '[*] Giveaways: %s\n' "$CLAIM_URL"
  printf '[*] Workspace: %s\n' "$DATA/workspace"
  printf '[*] Project:   %s\n' "$PROJECT"
}

usage() {
  cat <<EOF
usage: zcode [command]
  start          start server and claim backend, open main page
  open           open main page with token
  claim          open giveaway page at /claims
  status         show server/claim status
  tokens         show claim history
  stop|kill      stop server and claim backend
  restart        stop, then start again
  logs           list log files
  log            tail main server log
  log-claim      tail claim backend log
  log-claims     tail claims.log
  log-browser    tail browser debug log
  log-trace      tail upstream request trace log
  log-all        tail all logs
  help           show this help
EOF
}

case "${1:-start}" in
  start|"")
    ensure_server || exit 1
    info
    if [ "${ZCODE_NO_OPEN:-0}" != 1 ]; then open_url "$BASE_URL" || printf '[!] Open this URL manually: %s\n' "$BASE_URL"; fi
    ;;
  open)
    ensure_server || exit 1
    open_url "$BASE_URL" || printf '[!] Open this URL manually: %s\n' "$BASE_URL"
    ;;
  claim)
    ensure_server || exit 1
    info
    open_url "$CLAIM_URL" || printf '[!] Open this URL manually: %s\n' "$CLAIM_URL"
    ;;
  status)
    print_status
    ;;
  tokens)
    if [ -f "$DATA/logs/claims.log" ]; then
      tail -n 20 "$DATA/logs/claims.log"
    else
      curl -sS --max-time 5 "http://127.0.0.1:${PORT}/claim/status" || true
      printf '\n'
    fi
    ;;
  stop|kill)
    stop_all
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  logs)
    ls -1 "$DATA/logs" 2>/dev/null || true
    ;;
  log)
    exec tail -f "$DATA/logs/official-server.log"
    ;;
  log-claim)
    exec tail -f "$DATA/logs/claim.log"
    ;;
  log-claims)
    exec tail -f "$DATA/logs/claims.log"
    ;;
  log-browser)
    exec tail -f "$DATA/logs/zcode-browser.log"
    ;;
  log-trace)
    exec tail -f "$DATA/logs/claim-trace.log"
    ;;
  log-all)
    exec tail -f "$DATA/logs/official-server.log" "$DATA/logs/claim.log" "$DATA/logs/zcode-browser.log" "$DATA/logs/claim-trace.log" "$DATA/logs/claims.log"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
