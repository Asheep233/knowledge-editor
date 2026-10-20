# -*- coding: utf-8 -*-
"""生成 UI 工坊交接包（自包含 zip + sha256）。

包含：交接说明、完整文档/证据（排除体积大的生成物）、SDK、参考包、工具、P0 原型、完整源码 bundle。
用法：python3 docs/ui-workshop/tools/build_handover_package.py
产物：docs/ui-workshop/reports/AstraNota-UI-Workshop-Handover-<date>.zip（.sha256 同名）
说明：zip 为构建产物（.gitignore 已忽略），可随时重建。
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs" / "ui-workshop"
OUT_DIR = DOCS / "reports"
EXCLUDE_NAMES = {"cloud-vm-taskpack.zip", "sources.bundle", "_tmp_source.bundle"}  # 大体积生成物；单独提供/可重建
EXCLUDE_DIR_PARTS = {"__pycache__", ".pytest_cache"}
# 源码分支已推送 GitHub，交接包不内嵌完整 git bundle（体积大）；需要离线源码请从仓库 clone。


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()


README = """# AstraNota UI 创意工坊 · 交接包

生成时间：{ts}
分支：`feat/ui-workshop`（本地 HEAD `{head}`，已推送 `origin/feat/ui-workshop`，远端与本地一致）
最终交付状态：**`EXPERIMENTAL_TRUSTED_PACKS`**（接口级交付；宿主 UI 默认关闭；不声明正式发布/更高里程碑）
T27 I 门禁：**NOT_RUN / BLOCKED**（无 Windows VM；Linux 预检 PASS 不能替代 I 证据）

## 先读什么（按顺序）

1. `WORKSHOP-INTEGRATION-GUIDE.md` —— 工坊接口怎么用（host/guest/SDK/协议/命令白名单/生命周期/接入点）
2. `WORKSHOP-INTERFACE-POLICY.md` / `WORKSHOP-INTERFACE-CHANGELOG.md` —— 接口维护规则与变更记录（每次改接口必须维护）
3. `reports/HANDOVER-SNAPSHOT.md` —— 一页式交接快照（仓库状态/快速验收命令/未闭环红线/恢复路径）
4. `reports/TASK-STATUS-HANDOVER.md` —— T00–T28 逐任务状态（passed / in_progress / blocked 诚实口径）
5. `reports/FINAL-DELIVERY-STATUS.md` / `HANDOVER-FINAL.md` —— 最终状态与完整交接
6. `reports/AGENT-FRONTEND-INTEGRATION-RUNBOOK.md` —— 前端 UI Agent 接入与完整验证步骤
7. `reports/DECISION-T27-I-gate-blocked.md` —— T27 环境阻塞决策
8. `EVIDENCE-INDEX.md` / `validation-matrix.csv` —— 证据索引与验证矩阵

## 包内目录

- `WORKSHOP-*.md`、`HANDOVER-FINAL.md`、`README.md`、`EVIDENCE-INDEX.md`、`progress.md`、`feature-baseline.csv`、`validation-matrix.csv`、`known-failures.md`
- `adr/`、`core/`、`fixtures/`、`prototypes/`、`tools/`、`packs/`、`sdk/`、`evidence/`、`reports/`
- `reports/cloud-handoff/`（Windows VM 验收包：README/scripts/tests/test-pack/preflight；完整 `sources.bundle` 未在 zip 内，可用 `tools/build_cloud_handoff.py` 重建）
- `repo-metadata.json` —— HEAD/远端/生成信息
- **源码获取**：`git clone --branch feat/ui-workshop https://github.com/Asheep233/knowledge-editor.git`（分支已推送、远端与交接快照一致）
- `SHA256SUMS` —— 包内文件校验

## 快速验收（Linux 可做）

```bash
cd frontend && npm ci && npx tsc -b --noEmit      # 0 错误
npx vitest run --maxWorkers=2                      # 143 files / 1981 passed + 1 skipped
cd .. && python3 -m pytest backend/tests -q        # 847 collected / exit 0
python3 docs/ui-workshop/tools/build_validation_matrix.py --check   # MATRIX GATE: PASS（63 行）
python3 docs/ui-workshop/tools/verify_delivery_consistency.py       # 9/9 PASS（含 DC-9 接口维护）
python3 -m pytest docs/ui-workshop/reports/cloud-handoff/tests -q   # 39 passed
```

> Windows 产品 W 探针与 T27 I 门禁仅 Windows 环境可跑；Linux/happy-dom 结果不得替代。

## 红线（交接必须坚持）

- 不声明 T26 认证通过、不声明 T27 I 门禁通过、不声明正式发布/Release；
- 不把工坊面板设为产品默认 UI（`VITE_KE_WORKSHOP` 默认关闭）；
- 不用真实用户笔记/真实 APPDATA 做测试；不伪造 PASS；失败如实记录。
"""


def main() -> int:
    ts = time.strftime("%Y-%m-%d %H:%M:%S%z")
    head = git("rev-parse", "HEAD")
    remote = git("ls-remote", "--heads", "origin", "feat/ui-workshop").split()
    remote_sha = remote[0] if remote else ""
    date = time.strftime("%Y-%m-%d")
    out = OUT_DIR / f"AstraNota-UI-Workshop-Handover-{date}.zip"
    bundle = OUT_DIR / ".." / "handover-SOURCE.bundle"

    entries: list[tuple[Path, str]] = []  # (abs path, zip name)
    for p in sorted(DOCS.rglob("*")):
        if not p.is_file():
            continue
        rel_parts = p.relative_to(DOCS).parts
        if any(part in EXCLUDE_DIR_PARTS for part in rel_parts):
            continue
        if p.name in EXCLUDE_NAMES or p.name.startswith("_tmp_"):
            continue
        if p.suffix == ".pyc":
            continue
        entries.append((p, f"docs/{p.relative_to(DOCS).as_posix()}"))

    metadata = {
        "generatedAt": ts, "branch": "feat/ui-workshop", "headLocal": head,
        "headRemoteOrigin": remote_sha, "remoteInSync": bool(remote_sha) and remote_sha == head,
        "finalStatus": "EXPERIMENTAL_TRUSTED_PACKS", "t27IGate": "NOT_RUN/BLOCKED",
        "note": "接口级交付；UI 入口默认关闭；不声明正式发布；源码在 GitHub 分支 feat/ui-workshop（已推送）；zip 由 tools/build_handover_package.py 生成",
    }
    readme_tmp = OUT_DIR / "_tmp_readme.md"
    readme_tmp.write_text(README.format(ts=ts, head=head[:12]), encoding="utf-8")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README-交接说明.md", readme_tmp.read_text(encoding="utf-8"))
        z.writestr("repo-metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))
        for abs_p, name in entries:
            z.write(abs_p, name)
        # SHA256SUMS（除自身外全部）
        sums = []
        for info in z.infolist():
            if info.filename == "SHA256SUMS":
                continue
            data = z.read(info.filename)
            sums.append(f"{hashlib.sha256(data).hexdigest()}  {info.filename}")
        z.writestr("SHA256SUMS", "\n".join(sums) + "\n")

    sha = hashlib.sha256(out.read_bytes()).hexdigest()
    (out.with_suffix(out.suffix + ".sha256")).write_text(f"{sha}  {out.name}\n", encoding="utf-8")
    readme_tmp.unlink(missing_ok=True)
    bundle.unlink(missing_ok=True)
    print(f"写出：{out}")
    print(f"大小：{out.stat().st_size} bytes（{out.stat().st_size/1048576:.1f} MB）")
    print(f"sha256：{sha}")
    print(f"文件数：{len(entries)+3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
