"""附件管理：按类型分类存储（决策点 5）。

    Attachments/
    ├── images/   (png/jpg/jpeg/gif/webp/svg/bmp/avif)
    ├── videos/   (mp4/webm/mov/m4v/avi/mkv)
    └── files/    (其他)

命名规则：{毫秒时间戳}-{6位随机}.{ext}，避免重名与路径冲突。

Phase 4.7：附件列表（类型/大小/所属文档）、孤儿附件检测。
v0.6.1 约束升级：仅手动删除、绝不自动——DELETE 端点只允许删除
孤儿附件（被引用附件返回 409），删除必须由用户显式发起。
"""
from __future__ import annotations

import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from .. import config
from ..services import markdown_io

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


def _safe_suffixes() -> set:
    """允许的扩展名白名单（未知类型一律进 files/）。"""
    exts = {e.lower() for e in config.IMAGE_EXTS | config.VIDEO_EXTS}
    exts.update({".pdf", ".zip", ".txt", ".csv", ".xlsx", ".docx", ".pptx", ".epub", ".json"})
    return exts


_SAFE_SUFFIX = _safe_suffixes()


def _category(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in config.IMAGE_EXTS:
        return "images"
    if ext in config.VIDEO_EXTS:
        return "videos"
    return "files"


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _scan_attachments(root: Path) -> list[dict]:
    """扫描 Attachments/ 下的全部附件元信息。"""
    out = []
    base = root / config.DIR_ATTACHMENTS
    if not base.exists():
        return out
    for p in sorted(base.rglob("*")):
        if not p.is_file() or p.name == ".gitkeep":
            continue
        rel = p.relative_to(root).as_posix()
        st = p.stat()
        out.append(
            {
                "rel_path": rel,
                "name": p.name,
                "category": _category(p.name),
                "size": st.st_size,
                "mtime": _iso(st.st_mtime),
            }
        )
    return out


def _doc_refs_index(root: Path) -> dict[str, list[str]]:
    """扫描所有 Markdown 文档的附件引用 -> {附件rel: [文档rel,...]}。"""
    index: dict[str, list[str]] = {}
    for top in (config.DIR_ARTICLES, config.DIR_MODULES):
        base = root / top
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in (".md", ".markdown"):
                continue
            try:
                content = markdown_io.read_text(p)
            except UnicodeDecodeError:
                continue
            doc_rel = p.relative_to(root).as_posix()
            for ref in markdown_io.attachment_refs_in(content):
                index.setdefault(ref, []).append(doc_rel)
    return index


@router.get("/list")
def list_attachments(request: Request) -> dict:
    """全部附件：类型/大小/修改时间/所属文档。"""
    root = request.app.state.workspace_root
    refs = _doc_refs_index(root)
    items = []
    for att in _scan_attachments(root):
        items.append(
            {
                **att,
                "referenced_by": refs.get(att["rel_path"], []),
            }
        )
    return {"count": len(items), "attachments": items}


@router.get("/orphans")
def orphan_attachments(request: Request) -> dict:
    """孤儿附件检测（v0.6.1 起：配合 DELETE 端点做手动清理）。

    定义：未被任何 Markdown 文档引用的附件。
    依据：扫描全部 Markdown 文档的附件引用集合，取补集。
    """
    root = request.app.state.workspace_root
    refs = _doc_refs_index(root)
    orphans = [a for a in _scan_attachments(root) if a["rel_path"] not in refs]
    return {
        "count": len(orphans),
        "orphans": [
            {"name": a["name"], "path": a["rel_path"], "size": a["size"], "mtime": a["mtime"]}
            for a in orphans
        ],
    }


@router.delete("/{rel_path:path}")
def delete_attachment(request: Request, rel_path: str) -> dict:
    """删除附件（v0.6.1 约束升级：仅手动删除、绝不自动）。

    仅允许删除孤儿附件：被任何 Markdown 文档引用的附件返回 409，
    防止误删；删除必须由用户显式发起（前端确认后调用）。
    """
    root = request.app.state.workspace_root
    full = markdown_io.safe_rel_path(root, rel_path)
    if full is None or not full.is_file():
        raise HTTPException(status_code=404, detail="附件不存在")
    refs = _doc_refs_index(root)
    if rel_path in refs:
        raise HTTPException(
            status_code=409,
            detail=f"附件被 {len(refs[rel_path])} 个文档引用，不可删除",
        )
    try:
        full.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"删除附件失败: {e}")
    request.app.state.indexer.update_file(rel_path)
    return {"deleted": rel_path}


@router.post("", status_code=201)
async def upload_attachment(
    request: Request, file: UploadFile = File(...)
) -> dict:
    raw = file.filename or "unnamed.bin"
    ext = Path(raw).suffix.lower()
    if ext and ext not in _SAFE_SUFFIX:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

    category = _category(raw)
    rel_dir = f"{config.DIR_ATTACHMENTS}/{category}"
    root = request.app.state.workspace_root
    target_dir = root / rel_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    name = f"{int(time.time() * 1000)}-{secrets.token_hex(3)}{ext or '.bin'}"
    target = target_dir / name

    # 流式落盘，避免大文件整载内存
    size = 0
    with target.open("wb") as out:
        while chunk := await file.read(1024 * 256):
            out.write(chunk)
            size += len(chunk)

    rel = f"{rel_dir}/{name}"
    request.app.state.indexer.update_file(rel)
    return {
        "path": rel,
        "url": f"/api/attachments/{rel}",
        "category": category,
        "size": size,
        "name": raw,
    }


@router.get("/{rel_path:path}")
def get_attachment(request: Request, rel_path: str) -> FileResponse:
    root = request.app.state.workspace_root
    full = markdown_io.safe_rel_path(root, rel_path)
    if full is None or not full.is_file():
        raise HTTPException(status_code=404, detail="附件不存在")
    return FileResponse(full)
