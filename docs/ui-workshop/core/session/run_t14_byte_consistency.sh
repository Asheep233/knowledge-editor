#!/usr/bin/env bash
# P2-T14 字节一致性 e2e（旧链 HTTP vs Core 上下文写盘）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
BASE="$(mktemp -d /tmp/ke-t14b.XXXXXX)"
WS="$BASE/ws"; CFG="$BASE/cfg"
mkdir -p "$WS" "$CFG"
PORT=$((8600 + RANDOM % 300))
LOG="$BASE/uvicorn.log"
KE_WORKSPACE="$WS" KE_APP_CONFIG="$CFG/app.json" KE_APP_CONFIG_LEGACY="$CFG/app-legacy.json" \
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
BUNDLE="$BASE/t14b.mjs"
"$ROOT/frontend/node_modules/.bin/esbuild" docs/ui-workshop/core/session/t14_byte_consistency.ts \
  --bundle --format=esm --platform=node --target=node20 --outfile="$BUNDLE" >/dev/null
if ! T14B_BASE="http://127.0.0.1:$PORT" T14B_WORKSPACE="$WS" \
  T14B_OUT="$ROOT/docs/ui-workshop/evidence/T14-byte-consistency-results.json" \
  node "$BUNDLE" > "$BASE/out.json" 2> "$BASE/err.txt"; then
  echo "字节一致性 e2e 失败："; cat "$BASE/err.txt"; tail -30 "$BASE/out.json"; exit 1
fi
python3 - "$ROOT/docs/ui-workshop/evidence/T14-byte-consistency-results.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
for c in d['checks']:
    print(('PASS ' if c['pass'] else 'FAIL ') + c['name'] + ('' if c['pass'] else ' | ' + json.dumps(c.get('detail'), ensure_ascii=False)[:260]))
print(f"SUMMARY {d['passed']}/{d['total']} PASS")
sys.exit(0 if d['passed'] == d['total'] else 1)
PY
