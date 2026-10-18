#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
FRONTEND_DIR="docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/frontend"
TMP="$(mktemp -d)"
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/packs/probe/t19_guest.ts \
  --bundle --format=iife --platform=browser --target=es2020 --jsx=automatic --outfile="$TMP/t19-guest.js"
cp "$TMP/t19-guest.js" docs/ui-workshop/core/packs/probe/t19-guest-code.txt
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/packs/probe/t19_host.ts \
  --bundle --format=iife --platform=browser --target=es2020 --jsx=automatic \
  --loader:.txt=text --outfile="$FRONTEND_DIR/t19.js"
echo "built: $FRONTEND_DIR/t19.js"
