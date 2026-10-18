# -*- coding: utf-8 -*-
"""P3-T18 实机探针：Windows/WebView2 上恶意/故障 guest 只能走受控协议面。

流程：启动原型 app（S1_SCENARIO=broker, S1_OPEN_BROKER=1）→ Rust setup 打开 broker-render 窗口
加载 broker.js（真实 Broker+HostDispatcher，sandbox iframe 内恶意协议 guest）→ 依次尝试越权写入、
未声明命令、超限 payload、未知方法、直接调 Tauri 原生命令 → 验证拒绝码正确且 host 仍健康 → 落盘。
运行：python run_broker_probe.py
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
BASE = Path(r"C:\ke-tmp\uiws-t18-probe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:240], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    probe = BASE / "probe-broker"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({"S1_PROBE_DIR": str(probe), "S1_SCENARIO": "broker", "S1_OPEN_BROKER": "1"})
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
    g = r.get("guest") or {}
    print("broker results:", json.dumps(r, ensure_ascii=False)[:1100])
    print("events:", [ln for ln in events.splitlines() if "broker" in ln][:4], flush=True)
    check("W-T18-1 Rust setup 打开 broker-render 窗口", "broker-render opened by rust setup" in events, events.splitlines()[:3])
    check("W-T18-2 guest 探针完成", r.get("phase") == "broker-done" and g.get("phase") == "broker-guest-done",
          {"phase": r.get("phase"), "guest": g.get("phase"), "error": g.get("error")})
    check("W-T18-3 握手能力受限（只回传已授能力）", g.get("handshakeAccepted") == ["context.read", "print.request", "ui.shell"],
          g.get("handshakeAccepted"))
    check("W-T18-4 允许的 snapshot 成功", isinstance(g.get("snapshot"), dict) and g["snapshot"].get("ok") is True, g.get("snapshot"))
    check("W-T18-5 越权 context.write → E_CAPABILITY", g.get("writeError") == "E_CAPABILITY", g.get("writeError"))
    check("W-T18-6 已声明命令可执行", isinstance(g.get("declaredCommand"), dict) and g["declaredCommand"].get("ok") is True, g.get("declaredCommand"))
    check("W-T18-7 未声明命令 → E_FORBIDDEN", g.get("undeclaredCommandError") == "E_FORBIDDEN", g.get("undeclaredCommandError"))
    check("W-T18-8 超限 payload → E_BAD_PAYLOAD", g.get("oversizeError") == "E_BAD_PAYLOAD", g.get("oversizeError"))
    check("W-T18-9 未知方法 → E_UNKNOWN_METHOD", g.get("unknownMethodError") == "E_UNKNOWN_METHOD", g.get("unknownMethodError"))
    tauri = str(g.get("tauriDirectInvoke", ""))
    check("W-T18-10 opaque iframe 直接调 Tauri 原生命令被拒", tauri.startswith(("rejected:", "no-tauri-global")) and "UNEXPECTED_ALLOWED" not in tauri, tauri[:160])
    check("W-T18-11 攻击后 host 仍健康", g.get("hostHealthyAfterAttacks") is True, g.get("hostHealthyAfterAttacks"))
    check("W-T18-12 真实 WebView2（UA Edg）", "Edg/" in str(g.get("ua", "")), str(g.get("ua"))[:80])
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
    }
    out = EVID / "T18-broker-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
