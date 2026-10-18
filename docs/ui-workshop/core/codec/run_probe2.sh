#!/usr/bin/env bash
# T08 第二阶段探针：product 扩展的 DOM 依赖分层（纯 Node，无 DOM）。
set -eu
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
OUTDIR="$(mktemp -d)/codec-probe2-build"
mkdir -p "$OUTDIR"
NODE_PATH="$ROOT/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/core/codec/probe2.ts --bundle --format=esm --platform=node --target=node20 \
  --splitting --jsx=automatic --outdir="$OUTDIR" \
  --loader:.css=empty --loader:.ttf=empty --loader:.woff=empty --loader:.woff2=empty >/dev/null
node "$OUTDIR/probe2.js" > docs/ui-workshop/evidence/T08-codec-probe2.json
echo "written: docs/ui-workshop/evidence/T08-codec-probe2.json"
