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


def _doc_path_or_400(root, doc_path: str) -> Path:
    """P1-10：历史端点仅允许 Articles/Modules 下的 .md/.markdown。"""
    if not markdown_io.is_doc_rel(doc_path):
        raise HTTPException(status_code=400, detail="非法路径")
    full = markdown_io.safe_rel_path(root, doc_path)
    if full is None:
        raise HTTPException(status_code=400, detail="非法路径")
    return full


@router.get("/list")
def list_history(
    request: Request,
    doc: str = Query(..., min_length=1),
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    _doc_path_or_400(request.app.state.workspace_root, doc)
    versions = _hist(request).list_versions(doc)[:limit]
    return {"doc_path": doc, "versions": versions}


@router.get("/preview")
def preview_history(
    request: Request,
    doc: str = Query(..., min_length=1),
    version_id: str = Query(..., min_length=1),
) -> dict:
    _doc_path_or_400(request.app.state.workspace_root, doc)
    content = _hist(request).read_version(doc, version_id)
    if content is None:
        raise HTTPException(status_code=404, detail="历史版本不存在")
    return {"doc_path": doc, "version_id": version_id, "content": content}


@router.post("/restore")
def restore_history(request: Request, body: HistoryRestoreBody) -> dict:
    hist = _hist(request)
    root = request.app.state.workspace_root
    doc_path = body.doc_path
    full = _doc_path_or_400(root, doc_path)
    # P1-11：允许恢复已被删除的文档——快照是删除兜底，restore 应能重建文件
    # （atomic_write 会 mkdir 父目录）。当前文件存在时照常快照当前内容。
    content = hist.read_version(doc_path, body.version_id)
    if content is None:
        raise HTTPException(status_code=404, detail="历史版本不存在")
    # 1) 快照当前内容（恢复操作本身可逆）
    if full.is_file():
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
    # P3-11：恢复响应携带完整元信息（created/updated/size/word_count），
    # 否则前端属性面板恢复后显示「—」
    try:
        st = full.stat()
        created = getattr(st, "st_birthtime", None) or st.st_ctime
        from datetime import datetime, timezone

        def _iso(ts: float) -> str:
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")

        created_at, updated_at, size = _iso(created), _iso(st.st_mtime), st.st_size
    except OSError:
        created_at = updated_at = None
        size = None
    return {
        "id": doc_path,
        "path": doc_path,
        "title": meta.get("title") or full.stem,
        "content": content,
        "tags": markdown_io.parse_tags(meta),
        "meta": meta,
        "created_at": created_at,
        "updated_at": updated_at,
        "size": size,
        "word_count": markdown_io.word_count(content),
    }
