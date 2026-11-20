#!/usr/bin/env bash
# Verify the copied Node runtime starts and report process.parentPort type.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$ROOT/assets/node/bin/node"

if [ ! -x "$NODE" ]; then
  echo "ERROR: $NODE missing or not executable (run scripts/setup-backend.sh)" >&2
  exit 1
fi

echo "node: $NODE"
echo "ldd-equivalent (RUNPATH/NEEDED):"
readelf -d "$NODE" 2>/dev/null | grep -iE 'NEEDED|RUNPATH' | head -20 || true
echo
echo "--version:"
"$NODE" --version
echo
echo "process.parentPort:"
"$NODE" -e 'console.log(typeof process.parentPort)'
echo
echo "node:sqlite:"
"$NODE" -e "require('node:sqlite'); console.log('ok')"
