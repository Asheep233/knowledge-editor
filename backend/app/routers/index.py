"""索引管理（Phase 6.1：为用户提供重建索引入口）。

说明：索引系统本身沿用 Phase 3 的 SQLite FTS5 集中索引（Markdown 唯一
事实源，索引可重建）。本模块仅提供「重建索引」薄路由，供搜索区域按钮调用。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/index", tags=["index"])


@router.post("/rebuild")
def rebuild_index(request: Request) -> dict:
    """全量重建索引：清空 files/files_fts 后按磁盘扫描重灌。"""
    indexer = getattr(request.app.state, "indexer", None)
    if indexer is None:
        raise HTTPException(status_code=409, detail="未打开工作区")
    stats = indexer.rebuild()
    request.app.state.index_stats = stats
    return {"status": "ok", "stats": stats}
