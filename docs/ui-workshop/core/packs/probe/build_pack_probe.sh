#!/usr/bin/env bash
# 构建 T21 原生包存储探针 bundle
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
OUT="docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/frontend/pack.js"
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/packs/probe/pack_probe.ts \
  --bundle --format=iife --platform=browser --target=es2020 --outfile="$OUT"
echo "built: $OUT"
