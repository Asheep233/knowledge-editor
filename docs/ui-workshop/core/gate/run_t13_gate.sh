#!/usr/bin/env bash
# P1-T13 Core 门槛：隔离 uvicorn + 纯 Node（无 UI）驱动 Core 会话层与真实后端。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
BASE="$(mktemp -d /tmp/ke-t13-gate.XXXXXX)"
WA="$BASE/ws-a"; WB="$BASE/ws-b"; CFG="$BASE/cfg"
mkdir -p "$WA" "$WB" "$CFG"
PORT=$((8500 + RANDOM % 300))
LOG="$BASE/uvicorn.log"
KE_WORKSPACE="$WA" KE_APP_CONFIG="$CFG/app.json" KE_APP_CONFIG_LEGACY="$CFG/app-legacy.json" \
  python3 -m uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port "$PORT" > "$LOG" 2>&1 &
UV_PID=$!
cleanup() { kill "$UV_PID" 2>/dev/null || true; wait "$UV_PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 160); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  if ! kill -0 "$UV_PID" 2>/dev/null; then echo "后端提前退出"; tail -40 "$LOG"; exit 1; fi
  sleep 0.25
done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "后端未启动"; tail -40 "$LOG"; exit 1; }
BUNDLE="$BASE/t13_gate.mjs"
NODE_PATH="$ROOT/frontend/node_modules" "$ROOT/frontend/node_modules/.bin/esbuild" \
  docs/ui-workshop/core/gate/t13_gate.ts --bundle --format=esm --platform=node --target=node20 \
  --outfile="$BUNDLE" >/dev/null
if ! T13_BASE="http://127.0.0.1:$PORT" T13_ROOT_A="$WA" T13_ROOT_B="$WB" \
  T13_OUT="$ROOT/docs/ui-workshop/evidence/T13-core-gate-results.json" \
  node "$BUNDLE" > "$BASE/out.json" 2> "$BASE/err.txt"; then
  echo "门禁脚本执行失败："; cat "$BASE/err.txt"; tail -20 "$BASE/out.json"; exit 1
fi
echo "结果: docs/ui-workshop/evidence/T13-core-gate-results.json"
python3 - "$ROOT/docs/ui-workshop/evidence/T13-core-gate-results.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
for c in d['checks']:
    print(('PASS ' if c['pass'] else 'FAIL ') + c['name'] + ('' if c['pass'] else ' | ' + json.dumps(c.get('detail'), ensure_ascii=False)[:200]))
print(f"SUMMARY {d['passed']}/{d['total']} PASS (uncovered: {len(d.get('uncovered', []))} items)")
sys.exit(0 if d['passed'] == d['total'] else 1)
PY
