#!/usr/bin/env bash
# build_apk.sh - Master orchestrator for the ZCode Mobile APK build (aapt2 flow).
#
# One command from the project root:  bash build.sh --fast
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export TOOLS_DIR="${TOOLS_DIR:-$PROJECT_ROOT/tools}"

# Project paths / host toolchain (aapt2, no x86 aapt).
set -a
# shellcheck disable=SC1091
source "$PROJECT_ROOT/config/paths.env"
set +a

export BUILD_DIR="$PROJECT_ROOT/build"
export DIST_DIR="$PROJECT_ROOT/dist"
export APP_DIR="$PROJECT_ROOT/app"
export LANG=C.UTF-8
export LC_ALL=C.UTF-8

# ---- Argument parsing (legacy flags kept for compatibility) ----------------
export FAST_BUILD=0
export DEV_MODE=0
export CUSTOM_PREFIX=""
export CUSTOM_OUT=""
BYPASS_REQUESTED=0

while [ $# -gt 0 ]; do
    case "$1" in
        --fast) export FAST_BUILD=1; shift ;;
        --dev|-d) export DEV_MODE=1; shift ;;
        --bypass|--region-bypass|--no-bypass|--nobypass|\
        --no-region-bypass|--skip-gates|--no-gates|--standard)
            BYPASS_REQUESTED=1; shift ;;
        --prefix) export CUSTOM_PREFIX="$2"; shift 2 ;;
        --out|-o) export CUSTOM_OUT="$2"; shift 2 ;;
        *) echo "[WARNING] Unknown argument: $1" >&2; shift ;;
    esac
done

# ---- App constants ----------------------------------------------------------
APP_ENV="$PROJECT_ROOT/config/app.env"
eval "$(python3 - "$APP_ENV" <<'PY'
import shlex, sys
values = {}
with open(sys.argv[1], encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
for key in ("PKG", "APP_NAME", "APP_VERSION_NAME", "APP_VERSION_CODE",
            "MIN_API", "TARGET_SDK", "PORT", "OAUTH_SCHEME"):
    if key in values:
        print(f"CFG_{key}={shlex.quote(values[key])}")
PY
)"

PKG="${CFG_PKG:-com.zcodemobile}"
APP_NAME="${CFG_APP_NAME:-ZCode Mobile}"
APP_VERSION_NAME="${CFG_APP_VERSION_NAME:-3.18.2}"
APP_VERSION_CODE="${CFG_APP_VERSION_CODE:-1}"
MIN_API="${CFG_MIN_API:-24}"
TARGET_SDK="${CFG_TARGET_SDK:-28}"

BASE_PREFIX="${CUSTOM_PREFIX:-zcode-mobile}"
if [ -n "$CUSTOM_OUT" ]; then
    OUT_APK="$CUSTOM_OUT"
elif [ "$DEV_MODE" = "1" ]; then
    OUT_APK="$DIST_DIR/${BASE_PREFIX}-dev.apk"
else
    OUT_APK="$DIST_DIR/${BASE_PREFIX}.apk"
fi

echo "============================================================"
echo "  ZCODE MOBILE APK BUILD (aapt2)"
echo "  package=$PKG  version=$APP_VERSION_NAME ($APP_VERSION_CODE)"
echo "  output=$OUT_APK"
[ "$FAST_BUILD" = "1" ] && echo "  [MODE: FAST (uncompressed assets)]"
[ "$BYPASS_REQUESTED" = "1" ] && echo "  [NOTE: bypass flags accepted; backend assets are pre-patched]"
echo "============================================================"

# ---- Host toolchain --------------------------------------------------------
for tool in python3 javac java aapt2 apksigner; do
    command -v "$tool" >/dev/null 2>&1 || { echo "[ERROR] Missing tool: $tool" >&2; exit 1; }
done

# ---- Clean -----------------------------------------------------------------
echo "[*] Cleaning previous build artifacts..."
rm -rf "$BUILD_DIR/gen" "$BUILD_DIR/res" "$BUILD_DIR/obj" "$BUILD_DIR/dex" \
       "$BUILD_DIR/staging" "$BUILD_DIR/env_dist" \
       "$BUILD_DIR/base.apk" "$BUILD_DIR/unaligned.apk" "$BUILD_DIR/aligned.apk"
mkdir -p "$BUILD_DIR/gen" "$BUILD_DIR/res" "$BUILD_DIR/obj" "$BUILD_DIR/dex" \
         "$BUILD_DIR/staging" "$DIST_DIR"

TARGET_MANIFEST="$BUILD_DIR/AndroidManifest.xml"

# ---- Phase 01: config generation ------------------------------------------
echo -e "\n>>> [1/8] Generating configs..."
python3 "$SCRIPT_DIR/01_gen_config.py" "$BUILD_DIR"

# ---- Phase 02: aapt2 compile + link (R.java + base.apk) --------------------
echo -e "\n>>> [2/8] Compiling/linking resources with aapt2..."
bash "$SCRIPT_DIR/02_r_java.sh" \
    "$BUILD_DIR/gen" "$TARGET_MANIFEST" "$RES_DIR" "$ANDROID_JAR" \
    "$BUILD_DIR/res" "$BUILD_DIR/base.apk" \
    "$MIN_API" "$TARGET_SDK" "$APP_VERSION_CODE" "$APP_VERSION_NAME"

# ---- Phase 03: javac -------------------------------------------------------
echo -e "\n>>> [3/8] Compiling Java sources..."
bash "$SCRIPT_DIR/03_compile_java.sh" \
    "$BUILD_DIR/obj" "$BUILD_DIR/gen" "$JAVA_DIR" "$ANDROID_JAR"

# ---- Phase 04: D8 ----------------------------------------------------------
echo -e "\n>>> [4/8] Converting bytecode to classes.dex (D8)..."
bash "$SCRIPT_DIR/04_dex.sh" \
    "$BUILD_DIR/dex" "$BUILD_DIR/obj" "$R8_JAR" "$ANDROID_JAR" "$MIN_API"

# ---- Phase 05: asset staging ----------------------------------------------
echo -e "\n>>> [5/8] Staging runtime, web and env assets..."
python3 "$SCRIPT_DIR/05_stage_assets.py" "$BUILD_DIR/staging"

# ---- Phase 06: package -----------------------------------------------------
echo -e "\n>>> [6/8] Packaging base.apk + dex + assets..."
bash "$SCRIPT_DIR/06_package.sh" \
    "$BUILD_DIR/unaligned.apk" "$BUILD_DIR/base.apk" \
    "$BUILD_DIR/staging/assets" "$BUILD_DIR/dex/classes.dex"

# ---- Phase 07: zipalign ----------------------------------------------------
echo -e "\n>>> [7/8] ZipAligning APK..."
python3 "$SCRIPT_DIR/align.py" "$BUILD_DIR/unaligned.apk" "$BUILD_DIR/aligned.apk" 4

# ---- Phase 08: sign + verify ----------------------------------------------
echo -e "\n>>> [8/8] Signing and verifying APK..."
bash "$SCRIPT_DIR/08_sign.sh" "$BUILD_DIR/aligned.apk" "$OUT_APK" "$DEBUG_KEYSTORE"
bash "$SCRIPT_DIR/09_verify.sh" "$OUT_APK"

echo "============================================================"
echo "  BUILD SUCCESSFUL: $OUT_APK"
echo "  SIZE: $(stat -c%s "$OUT_APK") bytes ($(du -h "$OUT_APK" | cut -f1))"
echo "============================================================"
