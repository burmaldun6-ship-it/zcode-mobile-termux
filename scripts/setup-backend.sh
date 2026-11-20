#!/usr/bin/env bash
# Populate assets/backend/ and assets/node/ from the extracted ZCode Desktop app.
# Usage: bash scripts/setup-backend.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ZCODE_APP_DIR:-$ROOT/extracted/app}"
RES="${ZCODE_RES_DIR:-$ROOT/extracted/appimage/resources}"
NODE_BIN="${ZCODE_NODE_BIN:-/data/data/com.termux/files/usr/bin/node}"
LIBDIR="${ZCODE_LIBDIR:-/data/data/com.termux/files/usr/lib}"

BACKEND="$ROOT/assets/backend"
NODEDIR="$ROOT/assets/node"

say() { printf '\n== %s ==\n' "$*"; }
need() { [ -e "$1" ] || { echo "ERROR: missing $1" >&2; exit 1; }; }

# Skip re-copying large trees that were already installed (makes re-runs fast
# and safe). Delete the destination to force a refresh.
copy_dir() {
  local src="$1" dst="$2"
  if [ -d "$dst" ] && [ -n "$(ls -A "$dst" 2>/dev/null)" ]; then
    printf '  skip (exists): %s\n' "$dst"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  cp -aL "$src" "$dst"
}

need "$APP/out/host/index.js"
need "$APP/node_modules"
need "$RES/glm/zcode.cjs"
need "$RES/config/provider/zcode-builtin.json"
need "$NODE_BIN"

mkdir -p "$BACKEND/out" "$NODEDIR/bin" "$NODEDIR/lib"

# --- JS bundles -------------------------------------------------------------
say 'Copying out/ bundles'
mkdir -p "$BACKEND/out"
for d in host scheduler extension-host preload; do
  need "$APP/out/$d"
  copy_dir "$APP/out/$d" "$BACKEND/out/$d"
  printf '  %-16s %s\n' "$d" "$(du -sh "$BACKEND/out/$d" | cut -f1)"
done

# --- node_modules (flat) ----------------------------------------------------
say 'Copying node_modules'
copy_dir "$APP/node_modules" "$BACKEND/node_modules"
printf '  node_modules    %s\n' "$(du -sh "$BACKEND/node_modules" | cut -f1)"

# Merge native arm64 addons from app.asar.unpacked so requires resolve.
if [ -d "$RES/app.asar.unpacked/node_modules" ]; then
  say 'Merging native addons from app.asar.unpacked'
  cp -aL "$RES/app.asar.unpacked/node_modules/." "$BACKEND/node_modules/"
fi

# The host's agent-command resolver searches upward from cwd for
# apps/zcode-cli/packages/cli/dist/zcode.cjs. Provide it so storage startup
# (supportsStorageStartup) works without forcing ZCODE_AGENT_SERVER_COMMAND.
AGENT_DIST="$BACKEND/apps/zcode-cli/packages/cli/dist"
mkdir -p "$AGENT_DIST"
if [ ! -f "$AGENT_DIST/zcode.cjs" ]; then
  cp -aL "$RES/glm/zcode.cjs" "$AGENT_DIST/zcode.cjs"
fi

# --- runtime assets ---------------------------------------------------------
for pair in "glm:$RES/glm" "config:$RES/config" "tools:$RES/tools"; do
  name="${pair%%:*}"
  src="${pair#*:}"
  say "Copying $name"
  need "$src"
  copy_dir "$src" "$BACKEND/$name"
  printf '  %-16s %s\n' "$name" "$(du -sh "$BACKEND/$name" | cut -f1)"
done

# Bundled tool binaries need the executable bit at runtime.
chmod 755 "$BACKEND/tools/ripgrep/rg" "$BACKEND/tools/bfs/bfs" "$BACKEND/tools/ugrep/ugrep" 2>/dev/null || true

# --- Node runtime + shared libraries ---------------------------------------
say 'Copying Node runtime and shared libraries'
if [ ! -f "$NODEDIR/bin/node" ]; then
  cp -aL "$NODE_BIN" "$NODEDIR/bin/node"
fi
chmod 755 "$NODEDIR/bin/node" 2>/dev/null || true

# Resolve the transitive NEEDED closure with readelf; skip Bionic system libs
# (libc/libm/libdl, provided by the Android userspace).
queue=("$NODE_BIN")
seen=()
while [ ${#queue[@]} -gt 0 ]; do
  f="${queue[0]}"
  queue=("${queue[@]:1}")
  skip=0
  for s in "${seen[@]}"; do [ "$s" = "$f" ] && skip=1 && break; done
  [ "$skip" -eq 1 ] && continue
  seen+=("$f")

  base="$(basename "$f")"
  if [ "$f" != "$NODE_BIN" ] && [ ! -f "$NODEDIR/lib/$base" ]; then
    cp -aL "$f" "$NODEDIR/lib/$base"
    chmod 644 "$NODEDIR/lib/$base" 2>/dev/null || true
  fi

  for dep in $(readelf -d "$f" 2>/dev/null | grep -oE 'Shared library: \[[^]]+\]' | sed 's/Shared library: \[//;s/\]//'); do
    case "$dep" in
      libc.so|libm.so|libdl.so|"") continue;;
    esac
    p="$LIBDIR/$dep"
    if [ -e "$p" ]; then
      queue+=("$p")
    else
      echo "  WARN: unresolved dependency $dep (needed by $base)" >&2
    fi
  done
done
printf '  node binary     %s\n' "$(du -sh "$NODEDIR/bin/node" | cut -f1)"
printf '  libs            %s (%s files)\n' "$(du -sh "$NODEDIR/lib" | cut -f1)" "$(ls -1 "$NODEDIR/lib" | wc -l)"

# --- report -----------------------------------------------------------------
say 'Backend size report'
du -sh "$BACKEND" "$NODEDIR"
printf '\n%s\n' 'Files:'
for f in bootstrap.js shim-parentport.js PROTOCOL.md README.md; do
  if [ -f "$BACKEND/$f" ]; then printf '  %-24s %s bytes\n' "$f" "$(stat -c%s "$BACKEND/$f")"; else printf '  %-24s MISSING\n' "$f"; fi
done
printf '\nManifest written to %s/setup-manifest.txt\n' "$BACKEND"
{
  echo "generated: $(date -u +%FT%TZ)"
  echo "app: $APP"
  echo "resources: $RES"
  echo "node: $NODE_BIN"
  du -sh "$BACKEND" "$NODEDIR" "$BACKEND/out"/* "$BACKEND/glm" "$BACKEND/config" "$BACKEND/tools" "$BACKEND/node_modules"
} > "$BACKEND/setup-manifest.txt"

say 'Done'
