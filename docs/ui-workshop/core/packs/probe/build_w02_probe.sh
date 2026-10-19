#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
OUT="$ROOT/docs/ui-workshop/core/packs/probe/w02-guest-code.txt"
"$ROOT/frontend/node_modules/.bin/esbuild" docs/ui-workshop/core/packs/probe/w02_guest.ts \
  --bundle --format=iife --platform=browser --target=chrome120 --outfile="$OUT" >/dev/null
echo "built: $OUT ($(wc -c < "$OUT") bytes)"
