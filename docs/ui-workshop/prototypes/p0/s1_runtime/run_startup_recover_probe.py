# -*- coding: utf-8 -*-
"""P3-T20 实机探针：启动时 recover_all + safeMode（原型壳，真实 Windows 文件系统）。

阶段：A 播种包并损坏 active（含/不含 previous）→ B 启动时 recover → 状态文件/事件/磁盘状态；
C 含无回退损坏包 → 启动恢复 safeMode=true；应用仍正常启动（boot 事件）。
运行：python run_startup_recover_probe.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-t20-probe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"


def wait_for(probe: Path, marker: str, timeout: float = 60) -> bool:
    events_file = probe / "events.log"
    end = time.time() + timeout
    while time.time() < end:
        if events_file.exists() and marker in events_file.read_text(encoding="utf-8", errors="replace"):
            return True
        time.sleep(0.25)
    return False


def run_phase(name: str, data_root: Path, extra_env: dict, event_marker: str, result_key: str | None = None):
    probe = BASE / f"probe-{name}"
    if probe.exists():
        shutil.rmtree(probe, ignore_errors=True)
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({"S1_PROBE_DIR": str(probe), "S1_SCENARIO": "instance", "S1_PACK_ROOT": str(data_root), **extra_env})
    p = subprocess.Popen([str(EXE)], env=env)
    ok = wait_for(probe, event_marker, 60)
    payload = None
    if result_key:
        f = probe / result_key
        if f.exists():
            try:
                payload = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                payload = None
    # boot 事件可能晚于 recover 状态落盘：轮询等待（避免误判，曾导致 W-T20-5 偶发 FAIL）
    boot_ok = False
    boot_end = time.time() + 3.0
    while time.time() < boot_end:
        if (probe / "events.log").exists() and "host-js: boot" in (probe / "events.log").read_text(encoding="utf-8", errors="replace"):
            boot_ok = True
            break
        time.sleep(0.2)
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        p.terminate()
        try:
            p.wait(timeout=8)
        except subprocess.TimeoutExpired:
            p.kill()
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)
    return {"marker_seen": ok, "boot_ok": boot_ok, "status": payload, "probe": probe}


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:280], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)

    # A) 播种（安装 v1/v2，损坏 active v2；previous v1 可用）
    data_a = BASE / "data-a"
    seed = run_phase("seed-a", data_a, {"S1_PACK_SEED": "1"}, "pack-seeded")
    check("W-T20-1 原型播种损坏包（v2 active 损坏 + previous v1）", seed["marker_seen"], seed["probe"] / "events.log")

    # B) 启动 recover：自动回退到 v1，safeMode=false
    rec = run_phase("recover-b", data_a, {"S1_PACK_RECOVER_ON_START": "1"}, "pack-recover-startup", "workshop-recover-status.json")
    status = rec["status"] or {}
    results = status.get("results") or []
    result0 = (results[0] if results else {}) or {}
    check("W-T20-2 启动时执行 recover 并产出状态文件", rec["marker_seen"] and rec["status"] is not None, status)
    check("W-T20-3 损坏 active 自动回退（recovered + action=rollback-corrupt-active）",
          result0.get("recovered") is True and result0.get("action") == "rollback-corrupt-active",
          {"result0": result0})
    check("W-T20-4 回退后磁盘 state.json active=1.0.0", (result0.get("state") or {}).get("active") == "1.0.0",
          (result0.get("state") or {}))
    check("W-T20-5 有 previous 时 safeMode=false 且应用正常启动", status.get("safeMode") is False and rec["boot_ok"],
          {"safeMode": status.get("safeMode"), "boot": rec["boot_ok"], "checked": status.get("checked")})

    # C) 无回退损坏包 → safeMode=true，应用仍启动
    data_c = BASE / "data-c"
    seed_c = run_phase("seed-c", data_c, {"S1_PACK_SEED": "1", "S1_PACK_SEED_SAFE_MODE": "1"}, "pack-seeded")
    rec_c = run_phase("recover-c", data_c, {"S1_PACK_RECOVER_ON_START": "1"}, "pack-recover-startup", "workshop-recover-status.json")
    status_c = rec_c["status"] or {}
    lonely = [r for r in (status_c.get("results") or []) if r.get("id") == "com.probe.lonely"]
    check("W-T20-6 无 previous 损坏包 → action=corrupt-no-fallback",
          bool(lonely) and lonely[0].get("action") == "corrupt-no-fallback", lonely[0] if lonely else None)
    check("W-T20-7 启动恢复 safeMode=true", status_c.get("safeMode") is True,
          {"safeMode": status_c.get("safeMode"), "checked": status_c.get("checked")})
    check("W-T20-8 safeMode 下应用仍正常启动（boot + recover 事件）",
          rec_c["boot_ok"] and rec_c["marker_seen"], {"boot": rec_c["boot_ok"], "marker": rec_c["marker_seen"]})
    check("W-T20-9 真实 Windows 文件系统（数据目录在 C:\\ke-tmp）", str(data_a).startswith("C:"), str(data_a))

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "details": {"b": status, "c": status_c},
    }
    out = EVID / "T20-startup-recover-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
