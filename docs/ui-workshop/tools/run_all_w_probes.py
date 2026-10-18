#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T26 前置：顺序运行全部 Windows/WebView2 W 探针并聚合结果（Windows Python 执行）。

用法（Windows Python）：
    python docs/ui-workshop/tools/run_all_w_probes.py [--check]
产出：
    docs/ui-workshop/evidence/windows-witnesses-summary.json
--check：任一探针 FAIL 时退出码 1（供 T26 认证门禁/CI 使用）。
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
PROTO_DIR = REPO / "docs" / "ui-workshop" / "prototypes" / "p0" / "s1_runtime"
EVID = REPO / "docs" / "ui-workshop" / "evidence"
OUT = EVID / "windows-witnesses-summary.json"
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")

# (探针名, 脚本, 期望通过数, 超时秒)
# S1 原始 iframe 探针的 2 项失败是**已记录发现约束**（iframe 继承 Tauri globals / 同源可调用 cmd），
# 结论已进 ADR-001；在此单独标注为 PASS_WITH_FINDINGS，不计回归失败。
PROBES = [
    ("S1 iframe 运行域（含 2 项已知发现）", "run_s1_probe.py", 23, 180),
    ("S1b child WebviewWindow", "run_s1_windows_probe.py", 10, 180),
    ("S2 持续编辑面换壳", "run_s2_probe.py", 10, 180),
    ("S4 独立打印真实 PDF", "run_s4_probe.py", 6, 240),
    ("T11 协议传输", "run_protocol_probe.py", 7, 180),
    ("T13 单实例/退出协调", "run_instance_probe.py", 6, 180),
    ("T15 IME/焦点/缩放（CDP）", "run_t15_cdp_probe.py", 8, 180),
    ("T18 恶意/故障 guest Broker", "run_broker_probe.py", 12, 180),
    ("T19 包隔离宿主", "run_t19_probe.py", 8, 180),
    ("T19 包入口真实资源", "run_t19_entry_probe.py", 8, 240),
    ("T20 启动恢复/safeMode", "run_startup_recover_probe.py", 9, 240),
    ("T21 原生包存储", "run_pack_probe.py", 20, 240),
]

SUMMARY_RE = re.compile(r"SUMMARY\s+(\d+)/(\d+)\s+PASS")


def cleanup() -> None:
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)


def run_one(name: str, script: str, expected: int, timeout: int) -> dict:  # expected=通过数（S1 为 23/25）
    path = PROTO_DIR / script
    if not path.exists():
        return {"probe": name, "script": script, "status": "FAIL", "error": f"缺少脚本 {path}"}
    started = time.time()
    cleanup()
    try:
        proc = subprocess.run(
            [sys.executable, "-X", "utf8", str(path)],
            capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace",
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        match = None
        for m in SUMMARY_RE.finditer(out):
            match = m
        duration = round(time.time() - started, 1)
        if match:
            passed, total = int(match.group(1)), int(match.group(2))
            if passed == total == expected:
                status = "PASS"
            elif passed == expected and total == 25 and name.startswith("S1 "):
                status = "PASS_WITH_FINDINGS"
            else:
                status = "FAIL"
            return {
                "probe": name, "script": script, "status": status,
                "passed": passed, "total": total, "expected": expected,
                "duration_s": duration, "exit_code": proc.returncode,
                "tail": "\n".join(out.strip().splitlines()[-6:]),
            }
        return {
            "probe": name, "script": script, "status": "FAIL",
            "error": "未找到 SUMMARY 行", "exit_code": proc.returncode,
            "duration_s": duration, "tail": "\n".join(out.strip().splitlines()[-8:]),
        }
    except subprocess.TimeoutExpired as e:
        out = ((e.stdout or "") if isinstance(e.stdout, str) else "") + ((e.stderr or "") if isinstance(e.stderr, str) else "")
        return {
            "probe": name, "script": script, "status": "FAIL",
            "error": f"超时 {timeout}s", "tail": "\n".join(out.strip().splitlines()[-6:]),
        }
    finally:
        cleanup()


def main() -> int:
    check_only = "--check" in sys.argv
    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}（请先 cargo build --release 原型壳）")
        return 2
    results: list[dict] = []
    for name, script, expected, timeout in PROBES:
        print(f"→ {name} ({script}) ...", flush=True)
        result = run_one(name, script, expected, timeout)
        results.append(result)
        print(f"  {result['status']}  {result.get('passed', '-')}/{result.get('total', '-')}  {result.get('duration_s', '?')}s", flush=True)
    passed = sum(1 for r in results if r["status"] == "PASS")
    findings = sum(1 for r in results if r["status"] == "PASS_WITH_FINDINGS")
    passed = sum(1 for r in results if r["status"] in ("PASS", "PASS_WITH_FINDINGS"))
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "probe_count": len(results),
        "passed_count": passed,
        "pass_with_findings_count": findings,
        "failed_count": len(results) - passed,
        "all_pass": passed == len(results),
        "results": results,
    }
    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nW-WITNESSES: {passed}/{len(results)} probes PASS -> {OUT}")
    if check_only and not summary["all_pass"]:
        print("W-WITNESSES GATE: FAIL")
        return 1
    if check_only:
        print("W-WITNESSES GATE: PASS")
    return 0 if summary["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
