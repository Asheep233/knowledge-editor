#!/usr/bin/env bash
# 构建 P0-S4 harness（含 KaTeX CSS 内联为字符串）。
# 用法：bash docs/ui-workshop/prototypes/p0/s4_print/build_s4_harness.sh
set -eu
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
OUT="docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/frontend/s4.js"
NODE_PATH="$PWD/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/prototypes/p0/s4_print/harness.ts \
  --bundle --format=iife --platform=browser --target=es2020 \
  --loader:.css=text --outfile="$OUT"
echo "built: $OUT"
