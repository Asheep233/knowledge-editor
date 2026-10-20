# -*- coding: utf-8 -*-
"""T27/W08 I 门禁就绪检查（**只读 dry-run，绝不安装/绝不修改系统**）。

平台：**仅 Windows 侧可跑**（REPO/BUNDLE 为 Windows 绝对路径，且用 powershell 检查用户实例）；
WSL/Linux 上直接读 evidence/T27-gate-readiness.json，FileNotFoundError 不代表结论变化。

I 门禁 = 安装/覆盖升级/回滚/重启的 Windows 证据。执行必须满足：
  1) 主理人明确授权（本脚本只检查，不执行）；
  2) 专用隔离环境（VM/独立机器）或明确允许的实验机；
  3) 候选版本安装包 + 基线版本安装包均存在；
  4) 用户正在使用的 AstraNota 实例不得受影响（禁止在用户机器上直接执行）。
输出：evidence/T27-gate-readiness.json + 打印检查表。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
BUNDLE = Path(r"F:\Work\Dev\cargo-target\release\bundle\nsis")
TAURI_CONF = REPO / "desktop" / "src-tauri" / "tauri.conf.json"
PLAN = REPO / "docs" / "ui-workshop" / "reports" / "T27-installer-upgrade-plan.md"


def user_app_running() -> str:
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
        "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
        capture_output=True, text=True)
    return out.stdout.strip()


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300])

    conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    version = conf.get("version")
    targets = (conf.get("bundle") or {}).get("targets")
    check("T27-1 计划文档存在", PLAN.exists(), str(PLAN))
    check("T27-2 打包目标包含 nsis", targets == ["nsis"] or (isinstance(targets, list) and "nsis" in targets), targets)
    check("T27-3 版本号可识别", bool(version), version)
    installers = sorted(BUNDLE.glob("*.exe")) if BUNDLE.exists() else []
    versions = sorted({m.group(1) for p in installers if (m := re.search(r"_(\d+\.\d+\.\d+(?:-pre\.\d+)?)_", p.name))})
    check("T27-4 历史安装包可用（覆盖升级的旧版本）", len(installers) >= 1, {"count": len(installers), "versions": versions[-5:]})
    candidate = BUNDLE / f"AstraNota_{version}_x64-setup.exe" if version else None
    check("T27-5 候选版本安装包存在", bool(candidate and candidate.exists()), {"expected": str(candidate)})
    authorized = os.environ.get("KE_T27_AUTHORIZED") == "1"
    check("T27-6 主理人授权标志（KE_T27_AUTHORIZED=1）", authorized, {"env": "KE_T27_AUTHORIZED"})
    isolated = os.environ.get("KE_T27_ISOLATED_ENV", "")
    check("T27-7 专用隔离环境声明（KE_T27_ISOLATED_ENV）", bool(isolated), {"env": isolated or "(unset)"})
    upid = user_app_running()
    check("T27-8 用户实例未运行（I 门禁禁止在用户机器直接执行）", upid == "", {"user_pid": upid or "(not running)"})
    ready = all(c["ok"] for c in checks)
    print("\nREADINESS: " + ("READY（可申请授权后执行）" if ready else "NOT_READY（阻塞项见 FAIL）"))
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "mode": "dry-run（只读，不安装）",
        "candidate_version": version,
        "installers_available": [p.name for p in installers],
        "checks": checks,
        "ready": ready,
        "note": "I 门禁执行需主理人明确授权 + 专用隔离环境；本脚本绝不执行安装。",
    }
    out = EVID / "T27-gate-readiness.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("written:", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
