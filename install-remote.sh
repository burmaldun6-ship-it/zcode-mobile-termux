#!/usr/bin/env bash
set -euo pipefail

REPO="${ZCODE_REPO:-burmaldun6-ship-it/zcode-mobile-termux}"
DEST="${ZCODE_INSTALL_DIR:-$HOME/zcode-mobile-termux}"
API="https://api.github.com/repos/${REPO}/releases/latest"

for tool in curl node tar bash; do
  command -v "$tool" >/dev/null 2>&1 || { echo "[ERROR] missing: $tool" >&2; exit 1; }
done

META="$HOME/zcode-mobile-release.json"
TAR="$HOME/zcode-mobile-release.tar.gz"

echo "[*] fetching latest release from ${REPO}"
curl -fsSL -H 'Accept: application/vnd.github+json' "$API" -o "$META"

{ read -r ASSET_URL; read -r TAG; } < <(node -e '
let s="";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  const j = JSON.parse(s);
  const a = (j.assets || []).find(x => x.name.endsWith(".tar.gz"));
  if (!a) process.exit(1);
  process.stdout.write(a.browser_download_url + "\n" + j.tag_name + "\n");
});
' < "$META")

echo "[*] release ${TAG}: ${ASSET_URL}"
curl -fsSL "$ASSET_URL" -o "$TAR"

if [ -d "$DEST" ]; then
  BACKUP="${DEST}.old.$(date +%s)"
  mv "$DEST" "$BACKUP"
  echo "[*] previous install moved to ${BACKUP}"
fi
mkdir -p "$DEST"
tar -xzf "$TAR" -C "$DEST" --strip-components=1
rm -f "$TAR" "$META"

echo "[*] installing"
bash "$DEST/install.sh"

echo
echo "[OK] installed to ${DEST}"
echo "Start: bash ${DEST}/scripts/termux-official.sh"
