#!/usr/bin/env bash
# T08 第三阶段：product 保存管线 roundtrip 字节台账（纯 Node / headless）。
set -eu
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
OUT="$(mktemp -d)/probe3-build"; mkdir -p "$OUT"
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/codec/probe3.ts --bundle --format=esm --platform=node --target=node20 \
  --outdir="$OUT" --jsx=automatic \
  --loader:.css=empty --loader:.ttf=empty --loader:.woff=empty --loader:.woff2=empty >/dev/null
node "$OUT/probe3.js" > docs/ui-workshop/evidence/T08-roundtrip-ledger.json
echo "written: docs/ui-workshop/evidence/T08-roundtrip-ledger.json"
