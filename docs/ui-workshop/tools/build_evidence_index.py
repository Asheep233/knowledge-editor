# -*- coding: utf-8 -*-
"""生成证据索引：docs/ui-workshop/EVIDENCE-INDEX.md（只读扫描 evidence/ 与 validation-matrix.csv）。

用途：交付时快速定位每个任务/场景的证据文件与原始结果计数；同时报告「results JSON 缺 md 说明」
与「md 未被任何文档引用」等可维护性信息（不改变任何验收结论）。
"""
from __future__ import annotations

import csv
import json
import re
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs" / "ui-workshop"
EVID = DOCS / "evidence"
OUT = DOCS / "EVIDENCE-INDEX.md"


def load_results() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for p in sorted(EVID.glob("*-results.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        checks = d.get("checks") if isinstance(d, dict) else None
        passed = d.get("pass_count", d.get("passed")) if isinstance(d, dict) else None
        total = d.get("total") if isinstance(d, dict) else None
        if passed is None and isinstance(checks, list):
            passed = sum(1 for c in checks if c.get("pass") or c.get("ok"))
            total = len(checks)
        out[p.name] = {"passed": passed, "total": total}
    return out


def main() -> int:
    rows = list(csv.DictReader((DOCS / "validation-matrix.csv").open(encoding="utf-8")))
    results = load_results()
    mds = sorted(p.name for p in EVID.glob("*.md"))
    # 文档引用扫描（用于发现未被引用的 md）
    doc_files = [DOCS / "HANDOVER-FINAL.md", DOCS / "reports" / "FINAL-DELIVERY-STATUS.md",
                 DOCS / "reports" / "milestone-assessment.md", DOCS / "reports" / "T26-acceptance-status.md",
                 DOCS / "progress.md"]
    referenced: set[str] = set()
    pattern = re.compile(r"([A-Za-z0-9_.-]+(?:-results)?\.(?:md|json))")
    for d in doc_files:
        if d.exists():
            text = d.read_text(encoding="utf-8")
            referenced.update(pattern.findall(text))
    lines = [
        "# UI 工坊证据索引（自动生成）",
        "",
        f"- 生成时间：{time.strftime('%Y-%m-%dT%H:%M:%S%z')}",
        f"- 证据目录：`docs/ui-workshop/evidence/`（{len(list(EVID.glob('*')))} 个文件；"
        f"{len(results)} 个 results JSON、{len(mds)} 个说明 md）",
        "- 由 `tools/build_evidence_index.py` 生成；验收结论以 `validation-matrix.csv` 与各证据文件为准。",
        "",
        "## 1. 验证矩阵行（按任务/场景）",
        "",
        "| 证据 | 任务 | 类型 | 结果 | passed/total | 复现命令 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        ev = r.get("evidence", "")
        res = results.get(ev)
        counts = f"{res['passed']}/{res['total']}" if res and res.get("total") else ""
        lines.append(f"| {ev} | {r.get('task','')} | {r.get('kind','')} | {r.get('result','')} | {counts} | `{r.get('reproduce','')}` |")
    lines += ["", "## 2. results JSON 对应说明文件（可维护性）", ""]
    for name in sorted(results):
        stem = name.replace("-results.json", "")
        candidates = [x for x in mds if x.startswith("P5-" + stem) or stem in x]
        lines.append(f"- `{name}` → {('`' + candidates[0] + '`') if candidates else '**缺少对应说明 md（仅原始 JSON）**'}")
    lines += ["", "## 3. 说明 md 未被主要交付文档引用（提示，不阻塞）", ""]
    unreferenced = [m for m in mds if m not in referenced]
    lines += [f"- `{m}`" for m in unreferenced] if unreferenced else ["（全部说明 md 均被交付文档引用）"]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"written: {OUT}（矩阵 {len(rows)} 行；results {len(results)}；未引用 md {len(unreferenced)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
