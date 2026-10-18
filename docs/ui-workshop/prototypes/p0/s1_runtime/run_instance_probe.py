# -*- coding: utf-8 -*-
"""P1-T13 剩余门禁项：单实例 + 退出协调（Windows 实机）。

流程：启动实例 1（S1_SCENARIO=instance）→ 双击/再启实例 2（相同 identifier/env）→ 断言实例 2 立即退出、
实例 1 收到 second-instance 事件并继续运行 → 向实例 1 发送 WM_CLOSE（taskkill 无 /F）→ 断言
ExitRequested/Exit 协调文件落盘、进程干净退出。
运行：python run_instance_probe.py
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
BASE = Path(r"C:\ke-tmp\uiws-t13-instance")
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
    probe = BASE / "probe-instance"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({"S1_PROBE_DIR": str(probe), "S1_SCENARIO": "instance"})
    events_file = probe / "events.log"

    def events() -> str:
        return events_file.read_text(encoding="utf-8", errors="replace") if events_file.exists() else ""

    p1 = subprocess.Popen([str(EXE)], env=env)
    ok_start = False
    end = time.time() + 40
    while time.time() < end:
        if "host-js: boot" in events():
            ok_start = True
            break
        if p1.poll() is not None:
            break
        time.sleep(0.25)
    check("W-T13I-1 实例 1 启动并完成 boot", ok_start, {"exit": p1.poll(), "events": events().splitlines()[:3]})

    p2 = subprocess.Popen([str(EXE)], env=env)
    second_exited = False
    end = time.time() + 20
    while time.time() < end:
        if p2.poll() is not None:
            second_exited = True
            break
        time.sleep(0.2)
    got_event = "second-instance-detected" in events()
    check("W-T13I-2 第二实例立即退出（单实例生效）", second_exited, {"exit": p2.poll()})
    check("W-T13I-3 实例 1 收到 second-instance 事件", got_event, [ln for ln in events().splitlines() if "second-instance" in ln])
    check("W-T13I-4 实例 1 仍在运行", p1.poll() is None, p1.poll())

    # WM_CLOSE（taskkill 不带 /F）→ ExitRequested/Exit
    subprocess.run(["taskkill", "/PID", str(p1.pid)], capture_output=True, text=True)
    exited = False
    end = time.time() + 20
    while time.time() < end:
        if p1.poll() is not None:
            exited = True
            break
        time.sleep(0.2)
    exit_req = (probe / "exit-requested.json").exists()
    exit_file = (probe / "exit.json").exists()
    check("W-T13I-5 WM_CLOSE 后进程退出", exited, {"exit": p1.poll()})
    check("W-T13I-6 退出协调标记落盘（ExitRequested/Exit）", exit_req or exit_file, {"exit_requested": exit_req, "exit": exit_file})

    # 清理：如仍存活则强杀
    for proc in (p1, p2):
        if proc.poll() is None:
            proc.kill()
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "events": [ln for ln in events().splitlines() if "instance" in ln or "exit" in ln],
    }
    out = EVID / "T13-instance-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
