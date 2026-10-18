# -*- coding: utf-8 -*-
"""T11 实机探针：Windows/WebView2 内 host↔guest 类型化协议（MessagePort 传输候选）。

流程：启动原型 app（S1_SCENARIO=protocol, S1_OPEN_PROTOCOL=1）→ Rust setup 打开 protocol-render 窗口
加载 protocol.js（真实 protocol 包：HostDispatcher + sandbox iframe 内 GuestClient）→ 完成
handshake/context.write/事件 → 经 report_results 落盘 → runner 断言。
运行：python run_protocol_probe.py
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
BASE = Path(r"C:\ke-tmp\uiws-t11-probe")
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
    probe = BASE / "probe-protocol"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({"S1_PROBE_DIR": str(probe), "S1_SCENARIO": "protocol", "S1_OPEN_PROTOCOL": "1"})
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
    print("protocol results:", json.dumps(r, ensure_ascii=False)[:900])
    print("events:", [ln for ln in events.splitlines() if "protocol" in ln][:4], flush=True)
    check("W-T11-1 Rust setup 打开 protocol-render 窗口", "protocol-render opened by rust setup" in events, events.splitlines()[:4])
    check("W-T11-2 guest 侧协议完成（非 timeout/error）", r.get("phase") == "protocol-done" and guest.get("phase") == "guest-done",
          {"phase": r.get("phase"), "guest": guest.get("phase"), "error": guest.get("error")})
    check("W-T11-3 握手成功 + 能力协商（write 被接受）", guest.get("handshakeOk") is True and "write" in (guest.get("acceptedFeatures") or []),
          {"ok": guest.get("handshakeOk"), "features": guest.get("acceptedFeatures")})
    check("W-T11-4 握手返回 context/epoch 绑定", guest.get("contextId") == "ctx-proto" and guest.get("epoch") == 1,
          {"ctx": guest.get("contextId"), "epoch": guest.get("epoch")})
    write = guest.get("write") or {}
    check("W-T11-5 类型化 request 往返（context.write completed/fileDurable）",
          write.get("status") == "completed" and write.get("fileDurable") is True and write.get("revision") == 1, write)
    ev_types = [e.get("type") for e in (guest.get("events") or [])]
    check("W-T11-6 host→guest 事件投递（theme-changed/context-changed）",
          "theme-changed" in ev_types and "context-changed" in ev_types, ev_types)
    check("W-T11-7 真实 WebView2 环境（UA Edg）", "Edg/" in str(r.get("ua", "")), str(r.get("ua"))[:80])
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
    }
    out = EVID / "T11-transport-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
