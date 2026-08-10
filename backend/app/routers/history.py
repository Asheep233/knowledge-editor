"""历史版本 API（Phase 6.3）：列表 / 只读预览 / 恢复。

复用保存链路：恢复 = 快照当前内容 -> atomic_write 写回 Markdown
（唯一事实源）-> 增量更新 SQLite 索引 -> 标记内部写入（抑制外部修改误报）。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..services import markdown_io

router = APIRouter(prefix="/api/history", tags=["history"])


class HistoryRestoreBody(BaseModel):
    doc_path: str = Field(..., min_length=1)
    version_id: str = Field(..., min_length=1)


def _hist(request: Request):
    hist = getattr(request.app.state, "history", None)
    if hist is None:
        raise HTTPException(status_code=409, detail="未打开工作区")
    return hist


@router.get("/list")
def list_history(
    request: Request,
    doc: str = Query(..., min_length=1),
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    versions = _hist(request).list_versions(doc)[:limit]
    return {"doc_path": doc, "versions": versions}


@router.get("/preview")
def preview_history(
    request: Request,
    doc: str = Query(..., min_length=1),
    version_id: str = Query(..., min_length=1),
) -> dict:
    content = _hist(request).read_version(doc, version_id)
    if content is None:
        raise HTTPException(status_code=404, detail="历史版本不存在")
    return {"doc_path": doc, "version_id": version_id, "content": content}


@router.post("/restore")
def restore_history(request: Request, body: HistoryRestoreBody) -> dict:
    hist = _hist(request)
    root = request.app.state.workspace_root
    doc_path = body.doc_path
    full = markdown_io.safe_rel_path(root, doc_path)
    if full is None:
        raise HTTPException(status_code=400, detail="非法路径")
    if not full.is_file():
        raise HTTPException(status_code=404, detail="文章不存在")
    content = hist.read_version(doc_path, body.version_id)
    if content is None:
        raise HTTPException(status_code=404, detail="历史版本不存在")
    # 1) 快照当前内容（恢复操作本身可逆）
    try:
        old = markdown_io.read_text(full)
    except OSError:
        old = ""
    if old != content:
        hist.snapshot(doc_path, old)
    # 2) 写回 Markdown（唯一事实源）
    markdown_io.atomic_write(full, content)
    # 3) 更新 SQLite 索引
    request.app.state.indexer.update_file(doc_path)
    # 4) 抑制外部修改误报
    watcher = getattr(request.app.state, "watcher", None)
    if watcher is not None:
        watcher.mark_internal(doc_path)
    meta, _ = markdown_io.parse_frontmatter(content)
    return {
        "id": doc_path,
        "path": doc_path,
        "title": meta.get("title") or full.stem,
        "content": content,
        "tags": markdown_io.parse_tags(meta),
        "meta": meta,
    }
