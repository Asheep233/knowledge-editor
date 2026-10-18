# -*- coding: utf-8 -*-
"""P3-T19 实机探针：包隔离宿主（真实 PackageHost+Broker+HostDispatcher+guest iframe）崩溃升级/safe mode。

运行：python run_t19_probe.py
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
BASE = Path(r"C:\ke-tmp\uiws-t19-probe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:260], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    probe = BASE / "probe-t19"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({"S1_PROBE_DIR": str(probe), "S1_SCENARIO": "t19", "S1_OPEN_T19": "1"})
    p = subprocess.Popen([str(EXE)], env=env)
    results = None
    end = time.time() + 120
    while time.time() < end:
        f = probe / "results.json"
        if f.exists():
            try:
                results = json.loads(f.read_text(encoding="utf-8"))
                break
            except Exception:
                pass
        if p.poll() is not None and not f.exists():
            break
        time.sleep(0.3)
    try:
        p.wait(timeout=20)
    except subprocess.TimeoutExpired:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)
    events = (probe / "events.log").read_text(encoding="utf-8") if (probe / "events.log").exists() else ""
    r = results or {}
    guest = r.get("guest") or {}
    conn = r.get("connection") or {}
    diag = r.get("diag") or {}
    print("t19 results:", json.dumps(r, ensure_ascii=False)[:1100])
    print("events:", [ln for ln in events.splitlines() if "t19" in ln][:4], flush=True)
    check("W-T19-1 Rust setup 打开 t19-render 窗口", "t19-render opened by rust setup" in events, events.splitlines()[:3])
    check("W-T19-2 探针完成（host+guest）", r.get("phase") == "t19-done" and guest.get("phase") == "t19-guest-done",
          {"host": r.get("phase"), "guest": guest.get("phase"), "error": guest.get("error")})
    check("W-T19-3 PackageHost 会话 active 且连接受限（guest/能力/epoch）",
          r.get("sessionStarted") is True and conn.get("role") == "guest"
          and conn.get("capabilities") == ["context.read"] and conn.get("epoch") == 1, conn)
    check("W-T19-4 guest 经 Broker 完成握手+只读 snapshot（能力放行）",
          guest.get("handshakeAccepted") == ["context.read"] and (guest.get("snapshot") or {}).get("revision") == 1,
          {"handshake": guest.get("handshakeAccepted"), "snapshot": guest.get("snapshot")})
    states = r.get("crashStates") or []
    check("W-T19-5 崩溃未超限 → suspended（可重启）", states == ["suspended", "suspended"], states)
    check("W-T19-6 崩溃超限 → failed", r.get("overLimitState") == "failed", r.get("overLimitState"))
    check("W-T19-7 超限触发停用+recover+safeMode",
          diag.get("deactivateCalls", 0) >= 1 and diag.get("recoverCalls", 0) >= 1 and r.get("safeMode") is True,
          {"deactivate": diag.get("deactivateCalls"), "recover": diag.get("recoverCalls"), "safeMode": r.get("safeMode")})
    check("W-T19-8 真实 WebView2（UA Edg）", "Edg/" in str(r.get("ua", "")), str(r.get("ua"))[:80])
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
    }
    out = EVID / "T19-package-host-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
