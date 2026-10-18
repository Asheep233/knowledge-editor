#!/usr/bin/env bash
# 构建 T18 Broker 实机探针（guest bundle → 文本内联 → host bundle）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
FRONTEND_DIR="docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/frontend"
TMP="$(mktemp -d)"
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/broker/probe/guest_probe.ts \
  --bundle --format=iife --platform=browser --target=es2020 --jsx=automatic \
  --outfile="$TMP/guest-code.js"
cp "$TMP/guest-code.js" docs/ui-workshop/core/broker/probe/guest-code.txt
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/broker/probe/host_probe.ts \
  --bundle --format=iife --platform=browser --target=es2020 --jsx=automatic \
  --loader:.txt=text --outfile="$FRONTEND_DIR/broker.js"
echo "built: $FRONTEND_DIR/broker.js"
