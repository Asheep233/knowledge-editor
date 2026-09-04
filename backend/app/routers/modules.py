"""模块系统：Modules/ 目录下的可复用 Markdown 模块。

v1 范围：模块的登记、列表与原始内容读取。
模块引用语法（ke-module-ref）与解析见 docs/markdown-extension-spec.md。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from .. import config
from ..services import markdown_io

router = APIRouter(prefix="/api/modules", tags=["modules"])


@router.get("")
def list_modules(request: Request) -> dict:
    root = request.app.state.workspace_root
    base = root / config.DIR_MODULES
    items = []
    if base.exists():
        # P4-9：枚举 *.md 与 *.markdown（P1-17：跳过符号链接）
        for p in sorted(markdown_io.walk_files(base)):
            if p.suffix.lower() not in (".md", ".markdown"):
                continue
            rel = p.relative_to(root).as_posix()
            try:
                content = markdown_io.read_text(p)
            except (OSError, UnicodeDecodeError):
                continue
            meta, _ = markdown_io.parse_frontmatter(content)
            items.append(
                {
                    "name": p.stem,
                    "path": rel,
                    "title": meta.get("title") or p.stem,
                    "tags": meta.get("tags", ""),
                    # 已批准的 API 变更：模块列表带版本号（frontmatter version /
                    # ke_version 兼容读取；均缺省时回退 1）
                    "version": meta.get("version") or meta.get("ke_version") or 1,
                }
            )
    return {"count": len(items), "modules": items}


@router.get("/{module_path:path}")
def get_module(request: Request, module_path: str) -> dict:
    """读取模块 Markdown 原文（Phase 5：支持子目录路径）。

    兼容三种写法：
    - "Math/Definition"（子目录 + 自动补 .md）
    - "Math/Definition.md"（完整相对路径）
    - "Modules/Math/Definition.md"（带顶层前缀，与 ke-module source 值一致）
    """
    root = request.app.state.workspace_root
    rel = module_path.strip("/")
    if not rel.lower().endswith((".md", ".markdown")):
        rel = f"{rel}.md"
    if not rel.startswith(f"{config.DIR_MODULES}/"):
        rel = f"{config.DIR_MODULES}/{rel}"
    full = markdown_io.safe_rel_path(root, rel)
    if full is None:
        raise HTTPException(status_code=404, detail="模块不存在")
    # 防 ../ 逃逸：解析后必须仍位于 Modules/ 目录内
    try:
        full.relative_to(root / config.DIR_MODULES)
    except ValueError:
        raise HTTPException(status_code=404, detail="模块不存在")
    if not full.is_file():
        raise HTTPException(status_code=404, detail="模块不存在")
    content = markdown_io.read_text(full)
    meta, body = markdown_io.parse_frontmatter(content)
    return {
        "name": full.stem,
        "path": full.relative_to(root).as_posix(),
        "meta": meta,
        "content": body or content,
    }
