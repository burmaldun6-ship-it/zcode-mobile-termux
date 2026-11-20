#!/usr/bin/env bash
# 02_r_java.sh - Compile resources with aapt2 and link manifest + resources.
#
# aapt v1 cannot run on this arm64 host, so this phase uses aapt2 exclusively:
#   aapt2 compile --dir <res> -o <build>/res/compiled.flata
#   aapt2 link -o <base.apk> -I android.jar --manifest <manifest> \
#       -R <compiled.flata> --java <gen> ... --auto-add-overlay
# The linked base.apk carries AndroidManifest.xml + resources.arsc; R.java is
# generated for source compatibility (the app does not reference R.* itself).
set -euo pipefail

GEN_DIR="${1:-${BUILD_DIR:-}/gen}"
MANIFEST="${2:-${APP_DIR:-}/src/main/AndroidManifest.xml}"
RES_DIR="${3:-${APP_DIR:-}/src/main/res}"
ANDROID_JAR="${4:-${TOOLS_DIR:-}/android.jar}"
BUILD_RES_DIR="${5:-${BUILD_DIR:-}/res}"
OUT_APK="${6:-${BUILD_DIR:-}/base.apk}"
MIN_API="${7:-24}"
TARGET_SDK="${8:-28}"
VERSION_CODE="${9:-1}"
VERSION_NAME="${10:-3.18.2}"
AAPT2="${AAPT2:-aapt2}"

[ -f "$MANIFEST" ]      || { echo "[ERROR] [02] manifest not found: $MANIFEST" >&2; exit 1; }
[ -d "$RES_DIR" ]       || { echo "[ERROR] [02] res dir not found: $RES_DIR" >&2; exit 1; }
[ -f "$ANDROID_JAR" ]   || { echo "[ERROR] [02] android.jar not found: $ANDROID_JAR" >&2; exit 1; }
command -v "$AAPT2" >/dev/null 2>&1 || { echo "[ERROR] [02] $AAPT2 not found in PATH" >&2; exit 1; }

echo "[*] [02] aapt2: compiling resources from $RES_DIR"
mkdir -p "$GEN_DIR" "$BUILD_RES_DIR" "$(dirname "$OUT_APK")"
# aapt2 writes compiled.flata plus sibling '@<name>.flat' files; drop stale ones.
rm -f "$BUILD_RES_DIR"/compiled.flata "$BUILD_RES_DIR"/compiled.flata@*.flat
"$AAPT2" compile --dir "$RES_DIR" -o "$BUILD_RES_DIR/compiled.flata"

echo "[*] [02] aapt2: linking manifest + resources -> $OUT_APK"
rm -f "$OUT_APK"
"$AAPT2" link \
    -o "$OUT_APK" \
    -I "$ANDROID_JAR" \
    --manifest "$MANIFEST" \
    -R "$BUILD_RES_DIR/compiled.flata" \
    --java "$GEN_DIR" \
    --min-sdk-version "$MIN_API" \
    --target-sdk-version "$TARGET_SDK" \
    --version-code "$VERSION_CODE" \
    --version-name "$VERSION_NAME" \
    --auto-add-overlay

PKG=$(sed -n -E 's/.*package="([^"]+)".*/\1/p' "$MANIFEST" | head -n 1)
R_JAVA="$GEN_DIR/${PKG//.//}/R.java"
[ -f "$R_JAVA" ] || { echo "[ERROR] [02] aapt2 did not generate $R_JAVA" >&2; exit 1; }

echo "[OK] [02] base.apk ($(stat -c%s "$OUT_APK") bytes) and $R_JAVA generated via aapt2"
