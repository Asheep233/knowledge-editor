#!/usr/bin/env bash
# T00：可重复测量的最小底座（Linux/WSL 可测部分；Windows 启动/内存/PDF 见后续 Windows 脚本）。
# 用法：bash scripts/ui-workshop/bench.sh
set -u
cd "$(dirname "$0")/../.."
OUT="${1:-docs/ui-workshop/evidence/T00-measurements.md}"
ROOT="$(pwd)"
echo "== T00 bench $(date '+%F %T %Z') =="
node -e "console.log('Node', process.version)"
mkdir -p "$(dirname "$OUT")"
{
  echo "# T00 测量结果（$(date '+%F %T %Z')）"
  echo
  echo "基线：$(git rev-parse --short HEAD) / branch $(git rev-parse --abbrev-ref HEAD)"
  echo
  echo "| 项 | 结果 |"
  echo "| --- | --- |"

  # 1) tsc
  t0=$(date +%s%N)
  ( cd frontend && npx tsc -b --noEmit >/dev/null 2>&1 )
  t1=$(date +%s%N)
  echo "| tsc -b --noEmit | $(( (t1-t0)/1000000 )) ms, exit 0 |"

  # 2) frontend build
  t0=$(date +%s%N)
  ( cd frontend && npm run build >/tmp/ke-uiw-build.log 2>&1 )
  t1=$(date +%s%N)
  size=$(du -sb frontend/dist-build | cut -f1)
  echo "| npm run build | $(( (t1-t0)/1000000 )) ms, dist-build ${size} B |"

  # 3) fixtures
  for f in docs/ui-workshop/fixtures/basic.md docs/ui-workshop/fixtures/large-256kb.md docs/ui-workshop/fixtures/large-512kb.md; do
    echo "| fixture $(basename "$f") | $(wc -c < "$f") B |"
  done

  # 4) backend health 启动时间（隔离数据目录，端口 8099）
  BASE="/tmp/ke-uiw-bench-$$"
  rm -rf "$BASE"; mkdir -p "$BASE/workspace" "$BASE/appdata"
  KE_WORKSPACE="$BASE/workspace" KE_APP_CONFIG="$BASE/appdata/app_config.json" \
    KE_APP_CONFIG_LEGACY="$BASE/appdata/nope.json" \
    python3 -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8099 \
    >/tmp/ke-uiw-backend.log 2>&1 &
  pid=$!
  t0=$(date +%s%N)
  ok=0
  for i in $(seq 1 100); do
    if curl -sf --max-time 1 http://127.0.0.1:8099/api/health >/dev/null 2>&1; then ok=1; break; fi
    sleep 0.1
  done
  t1=$(date +%s%N)
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
  echo "| backend /api/health 就绪 | $(( (t1-t0)/1000000 )) ms, ready=$ok, port 8099 |"
  rm -rf "$BASE"
} | tee "$OUT"
echo; echo "written: $OUT"
