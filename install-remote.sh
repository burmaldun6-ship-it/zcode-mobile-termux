#!/usr/bin/env bash
set -euo pipefail

REPO="${ZCODE_REPO:-burmaldun6-ship-it/zcode-mobile-termux}"
DEST="${ZCODE_INSTALL_DIR:-$HOME/zcode-mobile-termux}"
API="https://api.github.com/repos/${REPO}/releases?per_page=20"

for tool in curl node tar bash; do
  command -v "$tool" >/dev/null 2>&1 || { echo "[ERROR] missing: $tool" >&2; exit 1; }
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "[ERROR] Node >= 24 required (found $(node -v)); run: pkg install nodejs" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zcode-install.XXXXXX")"
BACKUP=""
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

restore_backup() {
  if [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
    rm -rf "$DEST"
    mv "$BACKUP" "$DEST"
    echo "[*] restored previous install" >&2
  fi
}

fail() {
  echo "[ERROR] $*" >&2
  restore_backup
  exit 1
}

META="$TMP_DIR/releases.json"
TAR="$TMP_DIR/release.tar.gz"

echo "[*] fetching releases from ${REPO}"
curl -fsSL -H 'Accept: application/vnd.github+json' "$API" -o "$META" \
  || fail "could not query the GitHub releases API"

# /releases/latest ignores pre-releases, and this project publishes test builds as
# pre-releases, so it returns 404. Use the newest non-draft release from the list
# instead, preferring the first one that has a .tar.gz asset.
mapfile -t INFO < <(node -e '
const fs = require("fs");
const releases = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(releases)) throw new Error("unexpected GitHub API response");
const usable = releases.filter(r => !r.draft && (r.assets || []).some(a => a.name.endsWith(".tar.gz")));
if (!usable.length) throw new Error("no release with a .tar.gz asset found");
const release = usable[0];
const asset = release.assets.find(a => a.name.endsWith(".tar.gz"));
process.stdout.write(asset.browser_download_url + "\n" + release.tag_name + "\n");
' "$META") || fail "could not find a release tarball for ${REPO}"

[ "${#INFO[@]}" -eq 2 ] || fail "could not find a release tarball for ${REPO}"
ASSET_URL="${INFO[0]}"
TAG="${INFO[1]}"

echo "[*] release ${TAG}: ${ASSET_URL}"
curl -fL --retry 3 --progress-bar "$ASSET_URL" -o "$TAR" \
  || fail "download failed"

if command -v zcode >/dev/null 2>&1; then
  zcode stop >/dev/null 2>&1 || true
fi

if [ -d "$DEST" ]; then
  BACKUP="${DEST}.old.$(date +%s)"
  mv "$DEST" "$BACKUP"
  echo "[*] previous install moved to ${BACKUP}"
fi
mkdir -p "$DEST"
tar -xzf "$TAR" -C "$DEST" --strip-components=1 \
  || fail "could not extract the release tarball"
[ -f "$DEST/install.sh" ] || fail "release tarball does not contain install.sh"

echo "[*] installing"
bash "$DEST/install.sh" || fail "install.sh failed"

echo
echo "[OK] installed to ${DEST}"
if [ -n "$BACKUP" ]; then
  echo "[*] previous install kept at ${BACKUP} (remove it to free space)"
fi
echo "Start: zcode start   (from the folder the agent should work in)"
echo "Claim: zcode claim   -> http://127.0.0.1:3030/claims"
