#!/usr/bin/env bash
# T08 代码边界探针：headless（无 DOM）跑 @tiptap/markdown parse→serialize，记录哪些结构
# 当前可无 DOM 使用、哪些需要 window/product 扩展；结果写 docs/ui-workshop/evidence/T08-codec-probe.json
set -eu
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
BUNDLE="$(mktemp -d)/codec-probe.mjs"
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/codec/probe.ts --bundle --format=esm --platform=node --target=node20 \
  --outfile="$BUNDLE" >/dev/null
node "$BUNDLE" > docs/ui-workshop/evidence/T08-codec-probe.json
echo "written: docs/ui-workshop/evidence/T08-codec-probe.json"
