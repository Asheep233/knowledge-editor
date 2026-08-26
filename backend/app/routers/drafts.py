"""崩溃恢复草稿（Phase 6.2 增强）。

数据流（保持 Markdown 唯一事实源，草稿为辅助数据）：
- POST /recovery：登记恢复点。可选携带 content：后端将其写入
  Drafts/recovery/{stem}-{hash8}.draft.md 并登记（每文档仅一条最新记录）。
- GET  /recovery：列出未恢复的文档（启动检测入口；P1-14 起为
  「目录扫描优先、DB 兜底」——索引库损坏/被删后仍能发现草稿）。
- DELETE /recovery/{doc_path}：用户选择「丢弃」：清记录 + 删草稿文件。
- POST /recovery/restore：用户选择「恢复」：草稿内容 -> 快照当前内容 ->
  写回 Markdown（唯一事实源）-> 更新 SQLite 索引 -> 清记录 + 删草稿。

P2-14：草稿名含完整相对路径的 8 位哈希（{stem}-{h8}.draft.md），
a.md 与 a.markdown 不再互相覆盖；P1-14：由哈希可从目录扫描反查
doc_path（遍历现存文档计算哈希比对），索引丢失仍可恢复。
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
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


def _hash8(doc_path: str) -> str:
    return hashlib.sha1(doc_path.encode("utf-8")).hexdigest()[:8]


def _draft_name(doc_path: str) -> str:
    """P2-14：草稿名 = {stem}-{hash8}.draft.md（hash 取完整相对路径，防同名冲突）。"""
    p = Path(doc_path)
    stem = p.stem or "doc"
    return f"{stem}-{_hash8(doc_path)}.draft.md"


def _draft_rel(doc_path: str) -> str:
    """草稿相对路径：Drafts/recovery/{stem}-{hash8}.draft.md。"""
    return f"{config.DIR_DRAFT_RECOVERY}/{_draft_name(doc_path)}"


def _draft_full(request: Request, doc_path: str) -> Path | None:
    root = request.app.state.workspace_root
    if root is None:
        return None
    return markdown_io.safe_rel_path(root / config.DIR_DRAFT_RECOVERY, _draft_name(doc_path))


def _remove_draft(request: Request, draft_rel: str) -> None:
    root = request.app.state.workspace_root
    if root is None or not draft_rel:
        return
    if not markdown_io.is_recovery_draft_rel(draft_rel):
        return
    full = markdown_io.safe_rel_path(root, draft_rel)
    if full is not None and full.is_file():
        try:
            full.unlink()
        except OSError:
            pass


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _scan_drafts(request: Request) -> dict[str, dict]:
    """目录扫描（P1-14）：Drafts/recovery/*.draft.md -> {doc_path: record}。

    - 文件名 {stem}-{hash8}.draft.md → 哈希反查现存文档定位 doc_path；
    - 无哈希匹配的草稿文件：以文件自身为记录（doc_path 置为 'Articles/{stem}.md'
      占位，restore 会因找不到原文档而 400，绝不静默丢弃）。
    """
    root = request.app.state.workspace_root
    if root is None:
        return {}
    d = root / config.DIR_DRAFT_RECOVERY
    if not d.is_dir():
        return {}
    # 可反查集合：全部现存文档 rel -> hash8
    candidates: dict[str, str] = {}
    for top in (config.DIR_ARTICLES, config.DIR_MODULES):
        base = root / top
        if not base.exists():
            continue
        for p in markdown_io.walk_files(base):
            if p.suffix.lower() not in (".md", ".markdown"):
                continue
            rel = p.relative_to(root).as_posix()
            candidates[_hash8(rel)] = rel
    out: dict[str, dict] = {}
    for p in markdown_io.walk_files(d):
        name = p.name
        if not name.endswith(".draft.md"):
            continue
        body = name[: -len(".draft.md")]
        h8 = body.rsplit("-", 1)[-1]
        if not (len(h8) == 8 and all(c in "0123456789abcdef" for c in h8)):
            continue
        stem = body[: -(len(h8) + 1)] if body.endswith("-" + h8) else body
        doc_path = candidates.get(h8) or f"Articles/{stem}.md"
        rel_draft = p.relative_to(root).as_posix()
        st = p.stat()
        out[doc_path] = {
            "doc_path": doc_path,
            "draft_path": rel_draft,
            "saved_at": _iso(st.st_mtime),
            "session_id": "",
        }
    return out


def _find_draft_or_404(store, root: Path, doc_path: str) -> dict:
    """恢复/丢弃用记录查找：DB 优先，目录扫描兜底（P1-14）。"""
    rec = store.get_recovery(doc_path)
    if rec is not None:
        return dict(rec)
    # 目录扫描兜底：按哈希匹配草稿文件
    d = root / config.DIR_DRAFT_RECOVERY
    target = _draft_rel(doc_path)
    full = markdown_io.safe_rel_path(root, target)
    if full is not None and full.is_file():
        st = full.stat()
        return {
            "doc_path": doc_path,
            "draft_path": target,
            "saved_at": _iso(st.st_mtime),
            "session_id": "",
        }
    return {}


@router.get("/recovery")
def list_recovery(request: Request) -> dict:
    """列出未恢复内容：目录扫描优先 + DB 合并（P1-14，索引损坏仍可见）。"""
    store = request.app.state.store
    items: list[dict] = []
    seen_drafts: set[str] = set()
    for rec in store.list_recovery():
        items.append(dict(rec))
        if rec.get("draft_path"):
            seen_drafts.add(rec["draft_path"])
    for rec in _scan_drafts(request).values():
        if rec["draft_path"] in seen_drafts:
            continue
        items.append(rec)
    return {"count": len(items), "items": items}


@router.post("/recovery", status_code=201)
def register_recovery(request: Request, body: RecoveryCreate) -> dict:
    store = request.app.state.store
    # P1-10：仅允许业务文档路径；草稿文件只能写入 Drafts/recovery/
    if not markdown_io.is_doc_rel(body.doc_path):
        raise HTTPException(status_code=400, detail="非法路径")
    draft_path = body.draft_path
    if body.content is not None:
        full = _draft_full(request, body.doc_path)
        if full is None:
            raise HTTPException(status_code=400, detail="非法路径")
        markdown_io.atomic_write(full, body.content)
        root = request.app.state.workspace_root
        draft_path = full.relative_to(root).as_posix()
    if draft_path and not markdown_io.is_recovery_draft_rel(draft_path):
        raise HTTPException(status_code=400, detail="非法路径")
    store.add_recovery(body.doc_path, draft_path, body.session_id)
    return {"status": "ok", "doc_path": body.doc_path}


@router.delete("/recovery/{doc_path:path}", status_code=204)
def clear_recovery(request: Request, doc_path: str) -> None:
    """用户选择丢弃：清恢复记录并删除草稿文件（含索引丢失的目录扫描记录）。"""
    store = request.app.state.store
    rec = store.get_recovery(doc_path)
    store.clear_recovery(doc_path)
    if rec and rec.get("draft_path"):
        _remove_draft(request, rec["draft_path"])
    # P1-14：目录扫描兜底——即使 DB 无记录，也按哈希删除草稿文件
    root = request.app.state.workspace_root
    if root is not None and markdown_io.is_doc_rel(doc_path):
        target = _draft_rel(doc_path)
        full = markdown_io.safe_rel_path(root, target)
        if full is not None and full.is_file():
            _remove_draft(request, target)


@router.post("/recovery/restore")
def restore_recovery(request: Request, body: RecoveryRestore) -> dict:
    """用户选择恢复：草稿写回原 Markdown 路径，刷新索引，清记录。

    与原文档路径保持一致（不因工作区变化而改变路径）。
    P1-14：DB 记录丢失时目录扫描兜底仍可恢复。
    """
    store = request.app.state.store
    root = request.app.state.workspace_root
    doc_path = body.doc_path
    if not markdown_io.is_doc_rel(doc_path):
        raise HTTPException(status_code=400, detail="非法路径")
    rec = _find_draft_or_404(store, root, doc_path)
    if not rec:
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
        except (OSError, UnicodeDecodeError):
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
