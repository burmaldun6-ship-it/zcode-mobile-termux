#!/usr/bin/env bash
# 06_package.sh - Inject classes.dex and staged assets into the aapt2 base.apk.
#
# aapt2 link already produced AndroidManifest.xml + resources.arsc in base.apk.
# This phase copies that base APK and appends the dex plus the assets/ tree.
set -euo pipefail

UNALIGNED_APK="${1:-${BUILD_DIR:-}/unaligned.apk}"
BASE_APK="${2:-${BUILD_DIR:-}/base.apk}"
STAGE_ASSETS="${3:-${BUILD_DIR:-}/staging/assets}"
DEX_FILE="${4:-${BUILD_DIR:-}/dex/classes.dex}"

[ -f "$BASE_APK" ] || { echo "[ERROR] [06] base.apk not found: $BASE_APK" >&2; exit 1; }
[ -f "$DEX_FILE" ] || { echo "[ERROR] [06] classes.dex not found: $DEX_FILE" >&2; exit 1; }
[ -d "$STAGE_ASSETS" ] || { echo "[ERROR] [06] staged assets not found: $STAGE_ASSETS" >&2; exit 1; }

mkdir -p "$(dirname "$UNALIGNED_APK")"
cp -f "$BASE_APK" "$UNALIGNED_APK"

echo "[*] [06] injecting classes.dex + assets into $(basename "$UNALIGNED_APK")..."
python3 - "$UNALIGNED_APK" "$DEX_FILE" "$STAGE_ASSETS" "${FAST_BUILD:-0}" <<'PY'
import os
import sys
import zipfile

apk_path, dex_path, assets_dir, fast = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
fast = fast == "1"

# Already-compressed / binary payloads are stored to avoid wasting CPU on data
# that cannot be compressed further. In --fast mode everything is stored.
STORE_EXT = (
    ".gz", ".tgz", ".zip", ".jar", ".apk", ".png", ".jpg", ".jpeg", ".gif",
    ".webp", ".bmp", ".ico", ".mp3", ".mp4", ".webm", ".ogg", ".wav",
    ".so", ".node", ".bin", ".o", ".a", ".woff", ".woff2", ".ttf", ".otf",
    ".pdf", ".sqlite", ".db", ".xz", ".zst", ".bz2", ".7z",
)

def compression_for(name):
    if fast:
        return zipfile.ZIP_STORED
    lower = name.lower()
    if lower.endswith(STORE_EXT):
        return zipfile.ZIP_STORED
    return zipfile.ZIP_DEFLATED

with zipfile.ZipFile(apk_path, "a", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as z:
    existing = set(z.namelist())
    if "classes.dex" not in existing:
        z.write(dex_path, "classes.dex", compress_type=zipfile.ZIP_DEFLATED)

    staging_parent = os.path.dirname(os.path.abspath(assets_dir))
    count = 0
    total = 0
    for root, dirs, files in os.walk(assets_dir):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, staging_parent).replace(os.sep, "/")
            if rel in existing:
                continue
            z.write(full, rel, compress_type=compression_for(rel))
            count += 1
            try:
                total += os.path.getsize(full)
            except OSError:
                pass

print(f"[06] added {count} asset files ({total / (1024*1024):.1f} MiB) "
      f"with {'stored' if fast else 'mixed'} compression")
PY

echo "[OK] [06] created $(stat -c%s "$UNALIGNED_APK") bytes unaligned.apk"
