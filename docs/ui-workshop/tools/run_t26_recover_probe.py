# -*- coding: utf-8 -*-
"""P5-T26 A3 真实产品 W 探针：启动 recover / safeMode（隔离 appdata + 预置损坏包）。

场景 A：active v2 损坏 + previous v1 可用 → 启动自动回退 v1，safeMode=false；
场景 B：仅 active v1 损坏、无 previous → corrupt-no-fallback，safeMode=true；
两场景均验证产品主窗口可启动、用户运行中 App 不受影响、测试进程与 sidecar 按 PID/路径白名单清理。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE = Path(r"C:\ke-tmp\uiws-t26-recover")
# 红线：产品 data_dir() = %APPDATA%\KnowledgeEditor（不随 identifier 变化）→ APPDATA 必须隔离
APPDATA = BASE / "appdata"
APP_DATA = APPDATA / "com.astranota.uiws.e2e"
PACK_ROOT = APP_DATA / "workshop-packs"
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26recover"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def make_pack(root: Path, version: str, content: str) -> None:
    vdir = root / PACK_ID / version
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "index.html").write_text(content, encoding="utf-8")
    manifest = {
        "id": PACK_ID, "name": "T26 Recover Pack", "version": version, "apiVersion": 1,
        "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
        "assets": [{"path": "index.html", "sha256": sha(content)}],
    }
    (vdir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def write_state(root: Path, active: str, previous: str | None) -> None:
    (root / PACK_ID).mkdir(parents=True, exist_ok=True)
    state = {"active": active, "previous": previous, "updatedAt": str(time.time())}
    (root / PACK_ID / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def corrupt(root: Path, version: str) -> None:
    (root / PACK_ID / version / "index.html").write_text("<html>corrupted</html>", encoding="utf-8")


def cleanup_sidecars() -> None:
    ps = (
        "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' } | "
        "Stop-Process -Force -ErrorAction SilentlyContinue"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)


def run_scenario(name: str, setup) -> dict:
    if APPDATA.exists() and APP_DATA.exists():
        shutil.rmtree(APP_DATA, ignore_errors=True)
    setup()
    proc = subprocess.Popen([str(EXE)], env={**os.environ, "APPDATA": str(APPDATA)})
    status = None
    try:
        status_file = PACK_ROOT / "workshop-recover-status.json"
        end = time.time() + 40
        while time.time() < end:
            if status_file.exists():
                try:
                    status = json.loads(status_file.read_text(encoding="utf-8"))
                    break
                except Exception:
                    status = None
            time.sleep(0.3)
        time.sleep(2.0)
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
            capture_output=True, text=True,
        )
        user_pid = ps.stdout.strip()
        alive = proc.poll() is None
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        cleanup_sidecars()
    state_path = PACK_ROOT / PACK_ID / "state.json"
    disk_state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else None
    return {"name": name, "status": status, "disk_state": disk_state, "alive": alive, "user_pid": user_pid}


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:320], flush=True)

    if not EXE.exists():
        print(f"缺少隔离测试构建: {EXE}")
        return 2

    def setup_a():
        make_pack(PACK_ROOT, "1.0.0", "<html>v1 ok</html>")
        make_pack(PACK_ROOT, "2.0.0", "<html>v2 ok</html>")
        write_state(PACK_ROOT, "2.0.0", "1.0.0")
        corrupt(PACK_ROOT, "2.0.0")

    def setup_b():
        make_pack(PACK_ROOT, "1.0.0", "<html>only v1</html>")
        write_state(PACK_ROOT, "1.0.0", None)
        corrupt(PACK_ROOT, "1.0.0")

    a = run_scenario("A rollback-corrupt-active", setup_a)
    print("A:", json.dumps({k: a[k] for k in ("status", "disk_state", "alive")}, ensure_ascii=False)[:700], flush=True)
    sa = a["status"] or {}
    ra = (sa.get("results") or [{}])[0]
    check("W-T26-A3-1 场景A：启动生成 recover 状态文件", isinstance(sa, dict) and sa.get("checked") == 1, sa)
    check("W-T26-A3-2 场景A：损坏 active 自动回退（action=rollback-corrupt-active）", ra.get("action") == "rollback-corrupt-active" and ra.get("recovered") is True, ra)
    check("W-T26-A3-3 场景A：磁盘 state.active 回退为 1.0.0", (a["disk_state"] or {}).get("active") == "1.0.0", a["disk_state"])
    check("W-T26-A3-4 场景A：safeMode=false（有可用回退）", sa.get("safeMode") is False, sa.get("safeMode"))
    check("W-T26-A3-5 场景A：产品主进程存活（启动未被恢复阻断）", a["alive"] is True, a["alive"])

    b = run_scenario("B corrupt-no-fallback/safeMode", setup_b)
    print("B:", json.dumps({k: b[k] for k in ("status", "alive")}, ensure_ascii=False)[:700], flush=True)
    sb = b["status"] or {}
    rb = (sb.get("results") or [{}])[0]
    check("W-T26-A3-6 场景B：无回退损坏包 → action=corrupt-no-fallback", rb.get("action") == "corrupt-no-fallback" and rb.get("recovered") is False, rb)
    check("W-T26-A3-7 场景B：启动进入 safeMode=true", sb.get("safeMode") is True, sb.get("safeMode"))
    check("W-T26-A3-8 场景B：safeMode 下产品主进程仍存活", b["alive"] is True, b["alive"])
    check("W-T26-A3-9 用户运行中的 AstraNota 未受影响（PID 存在）", str(b.get("user_pid") or "").isdigit(), {"user_pid": b.get("user_pid")})

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 A3 启动 recover / safeMode（真实产品壳隔离构建）",
        "exe": str(EXE), "app_data": str(APP_DATA),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
        "raw": {"a": a, "b": b},
    }
    out = EVID / "T26-A3-recover-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
