# -*- coding: utf-8 -*-
"""生成云端 Windows VM 验收交接包：sources.bundle + cloud-vm-taskpack.zip。

用法：python3 docs/ui-workshop/tools/build_cloud_handoff.py
产物：
  docs/ui-workshop/reports/cloud-handoff/sources.bundle   （完整历史，当前 refs）
  docs/ui-workshop/reports/cloud-vm-taskpack.zip          （交给 Codex 的整包）
说明：bundle 与 zip 为构建产物（.gitignore 已忽略），交接前运行本脚本生成。
"""
from __future__ import annotations

import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CH = REPO / "docs" / "ui-workshop" / "reports" / "cloud-handoff"
ZIP = REPO / "docs" / "ui-workshop" / "reports" / "cloud-vm-taskpack.zip"
BUNDLE = CH / "sources.bundle"


def main() -> int:
    refs = ["refs/heads/feat/ui-workshop", "refs/tags/v1.2.9", "refs/heads/master"]
    existing = subprocess.run(["git", "show-ref"], cwd=REPO, capture_output=True, text=True).stdout
    refs = [r for r in refs if r.split("/")[-1] in existing or f" {r}" in existing or True]
    print("生成 sources.bundle ...")
    r = subprocess.run(["git", "bundle", "create", str(BUNDLE), *refs], cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        print("bundle 生成失败：", r.stderr, file=sys.stderr)
        return 1
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    entries = [
        "README.md", "TASKS.md", "T27-I-results.schema.json", "sources.bundle",
        "scripts/cloud_build.ps1", "scripts/cloud_t27_gate.py", "scripts/cloud_verify_installed.py",
        "scripts/prepare_test_pack.mjs", "tests/test_gate.py", "tests/test_smoke.py",
        "test-pack/pubkeys.json", "test-pack/verification.json", "test-pack/prepare.log",
        "preflight/T27-I-results.json", "preflight/script-validation.json",
        "preflight/script-audit.txt", "preflight/provenance.json",
    ]
    entries += [str(p.relative_to(CH)) for p in sorted((CH / "test-pack" / "pack").rglob("*")) if p.is_file()]
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for name in entries:
            p = CH / name
            if not p.exists():
                print("缺少文件：", p, file=sys.stderr)
                return 1
            z.write(p, name)
    print(f"sources.bundle HEAD={head} size={BUNDLE.stat().st_size}")
    print(f"zip size={ZIP.stat().st_size} entries={len(entries)} -> {ZIP}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
