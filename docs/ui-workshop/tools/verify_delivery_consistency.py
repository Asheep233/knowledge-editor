# -*- coding: utf-8 -*-
"""交付一致性检查（只读）：矩阵门禁/证据引用/红线（私钥、分支未推送）/台账口径。

用法：python3 docs/ui-workshop/tools/verify_delivery_consistency.py
输出：evidence/T26-delivery-consistency.json + 控制台 PASS/FAIL 清单。
"""
from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs" / "ui-workshop"
EVID = DOCS / "evidence"
FRONTEND = REPO / "frontend"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300])

    # 1) 矩阵门禁
    r = subprocess.run([sys.executable, str(DOCS / "tools" / "build_validation_matrix.py"), "--check"],
                       cwd=REPO, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    check("DC-1 验证矩阵 --check PASS", r.returncode == 0 and any("PASS" in l for l in out), out[-1] if out else "")

    # 2) 所有 evidence results JSON 均被矩阵脚本收录（META/READINESS/PARTIAL/KNOWN）
    script = (DOCS / "tools" / "build_validation_matrix.py").read_text(encoding="utf-8")
    results = sorted(p.name for p in EVID.glob("*-results.json"))
    missing = [n for n in results if f'"{n}"' not in script]
    check("DC-2 所有 results JSON 已被矩阵脚本收录", not missing, {"count": len(results), "missing": missing})

    # 3) 交付文档引用的 evidence 文件都存在
    docs_to_scan = [DOCS / "reports" / "FINAL-DELIVERY-STATUS.md", DOCS / "HANDOVER-FINAL.md",
                    DOCS / "reports" / "milestone-assessment.md", DOCS / "reports" / "T26-acceptance-status.md"]
    refs: set[str] = set()
    pattern = re.compile(r"(P5-T26-[A-Za-z0-9_.-]+\.md|T26-[A-Za-z0-9_.-]+-results\.json|P5-T26-[A-Za-z0-9_.-]+\.json)")
    for p in docs_to_scan:
        if p.exists():
            refs.update(pattern.findall(p.read_text(encoding="utf-8")))
    missing_refs = sorted(x for x in refs if not (EVID / x).exists() and not (DOCS / "reports" / x).exists())
    check("DC-3 交付文档 evidence 引用文件存在", not missing_refs, {"refs": len(refs), "missing": missing_refs[:10]})

    # 4) 红线：无私钥入仓
    tracked = git("ls-files")
    key_files = [l for l in tracked.splitlines() if re.search(r"\.pem$|test-signing-key", l)]
    check("DC-4 仓库无测试私钥/PEM 入仓", not key_files, key_files[:5])

    # 5) 分支本地、未推送（无 upstream）
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    head = git("rev-parse", "--short", "HEAD")
    check("DC-5 分支本地未推送（无 upstream）", upstream == "", {"branch": branch, "head": head, "upstream": upstream or None})

    # 6) 工作树干净
    status = git("status", "--porcelain")
    check("DC-6 工作树干净", status == "", status.splitlines()[:5])

    # 7) feature-baseline.csv 结构/统计（如实口径输出，不做通过判定）
    rows = list(csv.DictReader((DOCS / "feature-baseline.csv").open(encoding="utf-8")))
    official = [(r.get("officialBaselineResult") or "") for r in rows]
    stats = {
        "rows": len(rows),
        "officialPass": sum(1 for x in official if x.startswith("PASS")),
        "officialFail": sum(1 for x in official if x.startswith("FAIL")),
        "officialNotRun": sum(1 for x in official if x == "NOT_RUN"),
        "packAPass": sum(1 for r in rows if (r.get("packAEntry") or "").startswith("PASS")),
        "packBPass": sum(1 for r in rows if (r.get("packBEntry") or "").startswith("PASS")),
    }
    check("DC-7 台账 CSV 可解析且含行", stats["rows"] > 0, stats)

    # 8) FINAL-DELIVERY-STATUS 里程碑口径
    final_txt = (DOCS / "reports" / "FINAL-DELIVERY-STATUS.md").read_text(encoding="utf-8")
    check("DC-8 最终状态声明 EXPERIMENTAL_TRUSTED_PACKS 且不声明更高",
          "EXPERIMENTAL_TRUSTED_PACKS" in final_txt and "不声明" in final_txt, None)

    passed = sum(1 for c in checks if c["pass"])
    summary = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "head": head, "branch": branch,
               "checks": checks, "passCount": passed, "total": len(checks), "featureBaselineStats": stats}
    (EVID / "T26-delivery-consistency.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {passed}/{len(checks)} PASS -> {EVID / 'T26-delivery-consistency.json'}")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
