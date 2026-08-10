"""崩溃恢复草稿（Phase 6.2 增强）。

数据流（保持 Markdown 唯一事实源，草稿为辅助数据）：
- POST /recovery：登记恢复点。可选携带 content：后端将其写入
  Drafts/recovery/{doc 去掉扩展名}.draft.md 并登记（每文档仅一条最新记录）。
- GET  /recovery：列出未恢复的文档（启动检测入口）。
- DELETE /recovery/{doc_path}：用户选择「丢弃」：清记录 + 删草稿文件。
- POST /recovery/restore：用户选择「恢复」：草稿内容 -> 快照当前内容 ->
  写回 Markdown（唯一事实源）-> 更新 SQLite 索引 -> 清记录 + 删草稿。
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import config
from ..services import markdown_io

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


class RecoveryCreate(BaseModel):
    doc_path: str = Field(..., min_length=1)
    draft_path: str = ""
    session_id: str = ""
    content: Optional[str] = None


class RecoveryRestore(BaseModel):
    doc_path: str = Field(..., min_length=1)


def _draft_rel(doc_path: str) -> str:
    """草稿相对路径：Drafts/recovery/{doc 去掉扩展名}.draft.md。"""
    p = Path(doc_path)
    return (p.parent / f"{p.stem}.draft.md").as_posix()


def _draft_full(request: Request, doc_path: str) -> Path | None:
    root = request.app.state.workspace_root
    if root is None:
        return None
    return markdown_io.safe_rel_path(root / config.DIR_DRAFT_RECOVERY, _draft_rel(doc_path))


def _remove_draft(request: Request, draft_rel: str) -> None:
    root = request.app.state.workspace_root
    if root is None or not draft_rel:
        return
    full = markdown_io.safe_rel_path(root, draft_rel)
    if full is not None and full.is_file():
        try:
            full.unlink()
        except OSError:
            pass


@router.get("/recovery")
def list_recovery(request: Request) -> dict:
    items = request.app.state.store.list_recovery()
    return {"count": len(items), "items": items}


@router.post("/recovery", status_code=201)
def register_recovery(request: Request, body: RecoveryCreate) -> dict:
    store = request.app.state.store
    draft_path = body.draft_path
    if body.content is not None:
        full = _draft_full(request, body.doc_path)
        if full is None:
            raise HTTPException(status_code=400, detail="非法路径")
        markdown_io.atomic_write(full, body.content)
        root = request.app.state.workspace_root
        draft_path = full.relative_to(root).as_posix()
    store.add_recovery(body.doc_path, draft_path, body.session_id)
    return {"status": "ok", "doc_path": body.doc_path}


@router.delete("/recovery/{doc_path:path}", status_code=204)
def clear_recovery(request: Request, doc_path: str) -> None:
    """用户选择丢弃：清恢复记录并删除草稿文件。"""
    store = request.app.state.store
    rec = store.get_recovery(doc_path)
    store.clear_recovery(doc_path)
    if rec and rec.get("draft_path"):
        _remove_draft(request, rec["draft_path"])


@router.post("/recovery/restore")
def restore_recovery(request: Request, body: RecoveryRestore) -> dict:
    """用户选择恢复：草稿写回原 Markdown 路径，刷新索引，清记录。

    与原文档路径保持一致（不因工作区变化而改变路径）。
    """
    store = request.app.state.store
    root = request.app.state.workspace_root
    doc_path = body.doc_path
    rec = store.get_recovery(doc_path)
    if rec is None:
        raise HTTPException(status_code=404, detail="没有待恢复的内容")
    draft_rel = rec.get("draft_path") or _draft_rel(doc_path)
    draft_full = markdown_io.safe_rel_path(root, draft_rel)
    if draft_full is None or not draft_full.is_file():
        # 草稿文件丢失：恢复不可行，清掉悬空记录避免反复提示
        store.clear_recovery(doc_path)
        raise HTTPException(status_code=404, detail="恢复草稿不存在，已清除恢复记录")
    content = markdown_io.read_text(draft_full)
    full = markdown_io.safe_rel_path(root, doc_path)
    if full is None:
        raise HTTPException(status_code=400, detail="非法路径")
    # 1) 快照当前内容（若文件存在且内容不同，恢复操作可逆）
    hist = getattr(request.app.state, "history", None)
    if full.is_file():
        try:
            old = markdown_io.read_text(full)
        except OSError:
            old = ""
        if hist is not None and old != content:
            hist.snapshot(doc_path, old)
    # 2) 写回 Markdown（唯一事实源；允许重建被删除的文档）
    markdown_io.atomic_write(full, content)
    # 3) 更新 SQLite 索引
    request.app.state.indexer.update_file(doc_path)
    # 4) 抑制外部修改误报
    watcher = getattr(request.app.state, "watcher", None)
    if watcher is not None:
        watcher.mark_internal(doc_path)
    # 5) 清恢复记录 + 删草稿
    store.clear_recovery(doc_path)
    try:
        draft_full.unlink()
    except OSError:
        pass
    meta, _ = markdown_io.parse_frontmatter(content)
    return {
        "id": doc_path,
        "path": doc_path,
        "title": meta.get("title") or full.stem,
        "content": content,
        "tags": markdown_io.parse_tags(meta),
        "meta": meta,
    }
