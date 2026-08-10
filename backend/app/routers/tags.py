"""标签系统（Phase 4.5）：标签列表聚合 + 按标签筛选。

标签的唯一事实源是 Markdown frontmatter（`tags:` 列表）。
本路由只读取 SQLite 索引做聚合/筛选；标签的增删改走
`PUT /api/articles/{id}/meta`（真实改写 frontmatter 后再索引）。
"""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("")
def list_tags(request: Request) -> dict:
    """全部标签：{name, count}，按使用次数降序。"""
    return {"tags": request.app.state.store.list_tags()}


@router.get("/{tag_name}")
def files_by_tag(request: Request, tag_name: str) -> dict:
    """按标签精确筛选文档/模块（结果含文件名、路径、标题、更新时间）。"""
    rows = request.app.state.store.list_by_tag(tag_name)
    return {"tag": tag_name, "count": len(rows), "files": rows}
