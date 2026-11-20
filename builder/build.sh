#!/usr/bin/env bash
# build.sh - One-command root wrapper for the ZCode Mobile APK builder (aapt2).
# Usage:
#   bash build.sh                 # Build release APK (dist/zcode-mobile.apk)
#   bash build.sh --fast          # Same, but store assets uncompressed for fast iteration
#   bash build.sh --out PATH      # Write APK to a custom path
#   bash build.sh --dev           # Build the dev variant (dist/zcode-mobile-dev.apk)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/modules/builder/build_apk.sh" "$@"
