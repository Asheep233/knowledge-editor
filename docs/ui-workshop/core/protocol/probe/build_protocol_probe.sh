#!/usr/bin/env bash
# 构建 T11 Tauri/WebView2 传输探针：guest bundle → 作为文本内联 → host bundle → 原型前端目录
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
FRONTEND_DIR="docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/frontend"
TMP="$(mktemp -d)"
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/protocol/probe/guest_probe.ts \
  --bundle --format=iife --platform=browser --target=es2020 --jsx=automatic \
  --outfile="$TMP/guest-code.js"
cp "$TMP/guest-code.js" docs/ui-workshop/core/protocol/probe/guest-code.txt
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/protocol/probe/host_probe.ts \
  --bundle --format=iife --platform=browser --target=es2020 --jsx=automatic \
  --loader:.txt=text --outfile="$FRONTEND_DIR/protocol.js"
echo "built: $FRONTEND_DIR/protocol.js"
