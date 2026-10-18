# -*- coding: utf-8 -*-
"""T00：生成 UI 工坊功能基线与测量用 fixtures（确定性、可复现）。

产物目录：docs/ui-workshop/fixtures/
  - basic.md：KE/Markdown 功能覆盖样本（frontmatter/标题/列表/任务/表格/公式/脚注/
    信息块/附件引用/未知 HTML/未知 ke-* 标记）
  - large-256kb.md / large-512kb.md：大文档测量样本（≥256/512 KiB，含公式与附件引用）
  - Attachments/...：小附件占位（PNG/PDF 最小字节），保证引用可解析
  - fixtures-manifest.json：文件名/字节/SHA-256
不含任何用户笔记内容。运行：python3 docs/ui-workshop/tools/make_fixtures.py
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "ui-workshop" / "fixtures"

# 1x1 透明 PNG
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
# 最小合法 PDF（单页空白）
PDF_MIN = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)


def basic_md() -> str:
    return """---
title: UI 工坊 fixtures 样本
tags:
  - fixture
  - ke
ke_version: 1
---
# 一级标题

普通段落，包含 **加粗**、*斜体*、`行内代码` 与 [链接](Attachments/files/sample.pdf)。

## 二级标题

- 无序项 A
- 无序项 B
  - 嵌套项

1. 有序项一
2. 有序项二

- [ ] 未完成任务
- [x] 已完成任务

> 引用段落。

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

行内公式：$E = mc^2$ 与根号 $\\sqrt{\\frac{a^2+b^2}{2}}$。

块级公式：

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3} \\tag{1.1}
$$

图片引用：![示例图](Attachments/images/sample.png)

<!-- ke-note: {"kind":"note","id":"n1","title":"信息块样本","tone":"blue"} -->
信息块内文本，可包含 $a+b$。
<!-- /ke-note -->

脚注引用[^1]。

[^1]: 脚注样本内容。

<!-- ke-unknown: {"a":1} -->
<div data-fixture="unknown-html">未知 HTML 原样保留样本</div>
"""


def large_md(target_bytes: int) -> str:
    head = """---
title: UI 工坊大文档测量样本
tags: [fixture, large]
ke_version: 1
---
"""
    chunks: list[str] = [head]
    size = len(head.encode("utf-8"))
    i = 0
    while size < target_bytes:
        i += 1
        if i % 25 == 0:
            block = (
                f"\n## 第 {i} 节\n\n公式：$\\sqrt{{x_{i}^2 + y_{i}^2}}$\n\n"
                f"$$\n\\sum_{{k=1}}^{{{i}}} k = \\frac{{{i}({i}+1)}}{{2}}\n$$\n\n"
            )
        elif i % 40 == 0:
            block = f"\n段落 {i}：附件 ![图](Attachments/images/sample.png) 与 [PDF](Attachments/files/sample.pdf)。\n"
        else:
            block = (
                f"\n段落 {i}：这是一段用于大文档测量与渲染稳定性的确定性文本。"
                "中文与 English mixed 内容，用于字号/换行/滚动/输入延迟测量。\n"
            )
        chunks.append(block)
        size += len(block.encode("utf-8"))
    return "".join(chunks)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    att = OUT / "Attachments"
    (att / "images").mkdir(parents=True, exist_ok=True)
    (att / "files").mkdir(parents=True, exist_ok=True)
    (att / "images" / "sample.png").write_bytes(PNG_1PX)
    (att / "files" / "sample.pdf").write_bytes(PDF_MIN)
    (OUT / "basic.md").write_text(basic_md(), encoding="utf-8")
    (OUT / "large-256kb.md").write_text(large_md(256 * 1024), encoding="utf-8")
    (OUT / "large-512kb.md").write_text(large_md(512 * 1024), encoding="utf-8")

    manifest = {"schemaVersion": 1, "files": []}
    for p in sorted(OUT.rglob("*")):
        if not p.is_file() or p.name == "fixtures-manifest.json":
            continue
        rel = p.relative_to(OUT).as_posix()
        data = p.read_bytes()
        manifest["files"].append(
            {"path": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        )
    (OUT / "fixtures-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"fixtures: {len(manifest['files'])} files -> {OUT}")
    for f in manifest["files"]:
        print(f"  {f['bytes']:>8}  {f['path']}")


if __name__ == "__main__":
    main()
