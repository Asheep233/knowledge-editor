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

    # 5) 推送状态：未推送（本地）或主理人授权后已推送且远端 == HEAD；不允许远端与本地不一致
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    head = git("rev-parse", "--short", "HEAD")
    full_head = git("rev-parse", "HEAD")
    remote_sha = git("ls-remote", "origin", f"refs/heads/{branch}").split()
    remote_sha = remote_sha[0] if remote_sha else ""
    if not remote_sha:
        check("DC-5 推送状态（本地未推送，允许）", True, {"branch": branch, "head": head, "upstream": upstream or None})
    else:
        check("DC-5 推送状态（已推送且远端 == HEAD）", remote_sha == full_head,
              {"branch": branch, "head": head, "remote": remote_sha[:12], "upstream": upstream or None})

    # 6) 工作树干净
    status_lines = [l for l in git("status", "--porcelain").splitlines() if "T26-delivery-consistency.json" not in l]
    check("DC-6 工作树干净（忽略本工具 `--write` 的自身证据文件）", not status_lines, status_lines[:5])

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

    # 9) 接口维护守卫（接口级交付 + 每次更新维护接口）
    import re as _re
    policy = DOCS / "WORKSHOP-INTERFACE-POLICY.md"
    changelog = DOCS / "WORKSHOP-INTERFACE-CHANGELOG.md"
    guide = DOCS / "WORKSHOP-INTEGRATION-GUIDE.md"
    types_ts = REPO / "frontend" / "src" / "core" / "protocol" / "types.ts"
    manifest_ts = REPO / "frontend" / "src" / "core" / "packs" / "manifest.ts"
    sdk_src = DOCS / "sdk" / "src" / "index.ts"
    sdk_pkg = DOCS / "sdk" / "package.json"
    app_tsx = REPO / "frontend" / "src" / "components" / "workshop" / "WorkshopEntry.tsx"
    app_shell = REPO / "frontend" / "src" / "App.tsx"
    try:
        proto = _re.search(r"PROTOCOL_VERSION\s*=\s*(\d+)", types_ts.read_text(encoding="utf-8")).group(1)
        api = _re.search(r"PACK_API_VERSION\s*=\s*(\d+)", manifest_ts.read_text(encoding="utf-8")).group(1)
        sdk_src_ver = _re.search(r"SDK_VERSION\s*=\s*'([^']+)'", sdk_src.read_text(encoding="utf-8")).group(1)
        sdk_pkg_ver = str(json.loads(sdk_pkg.read_text(encoding="utf-8")).get("version", ""))
        changelog_text = changelog.read_text(encoding="utf-8") if changelog.exists() else ""
        policy_text = policy.read_text(encoding="utf-8") if policy.exists() else ""
        guide_text = guide.read_text(encoding="utf-8") if guide.exists() else ""
        shell_text = app_shell.read_text(encoding="utf-8") if app_shell.exists() else ""
        detail = {
            "protocol": proto, "packApiVersion": api, "sdkSource": sdk_src_ver, "sdkPackage": sdk_pkg_ver,
            "policyExists": policy.exists(), "changelogExists": changelog.exists(),
            "sdkVersionConsistent": sdk_src_ver == sdk_pkg_ver,
            "changelogHasCurrentVersions": (f"protocol v{proto}" in changelog_text
                                            and f"sdk v{sdk_src_ver}" in changelog_text
                                            and f"pack apiVersion {api}" in changelog_text),
            "guideReferencesPolicyAndChangelog": ("WORKSHOP-INTERFACE-POLICY.md" in guide_text
                                                  and "WORKSHOP-INTERFACE-CHANGELOG.md" in guide_text),
            "policyHasMaintenanceChecklist": ("每次更新" in policy_text and "Definition of Done" in policy_text),
            # 接口级交付：工坊 UI 入口必须仍由 VITE 显式开关控制（默认不渲染）
            "uiEntryFlagGated": "VITE_KE_WORKSHOP" in shell_text and "WorkshopEntry" in shell_text,
        }
        ok = (detail["policyExists"] and detail["changelogExists"] and detail["sdkVersionConsistent"]
              and detail["changelogHasCurrentVersions"] and detail["guideReferencesPolicyAndChangelog"]
              and detail["policyHasMaintenanceChecklist"] and detail["uiEntryFlagGated"])
        check("DC-9 接口维护检查（接口级交付/版本一致/CHANGELOG/维护清单/UI 默认关闭）", ok, detail)
    except Exception as exc:  # 缺文件/解析失败 → 如实失败
        check("DC-9 接口维护检查（接口级交付/版本一致/CHANGELOG/维护清单/UI 默认关闭）", False, {"error": str(exc)})

    passed = sum(1 for c in checks if c["pass"])
    summary = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "head": head, "branch": branch,
               "checks": checks, "passCount": passed, "total": len(checks), "featureBaselineStats": stats}
    if "--write" in sys.argv:
        (EVID / "T26-delivery-consistency.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nSUMMARY {passed}/{len(checks)} PASS -> {EVID / 'T26-delivery-consistency.json'}（已写入 evidence）")
    else:
        print(f"\nSUMMARY {passed}/{len(checks)} PASS（只读模式；--write 可写入 evidence/T26-delivery-consistency.json）")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
