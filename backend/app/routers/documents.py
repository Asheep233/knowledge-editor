"""文章 CRUD 与文件树。

保存路径约定：Articles/{slug}.md，原子写入；保存后增量更新索引。
Phase 4：文档元信息（创建/修改时间、字数、标签）与 frontmatter 元信息编辑。
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .. import config
from ..services import markdown_io

router = APIRouter(prefix="/api", tags=["documents"])


# ---------- models ----------

class ArticleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = ""


class ArticleUpdate(BaseModel):
    content: str
    title: Optional[str] = None  # 重命名时使用（Phase 2 完整支持）


class ArticleMetaUpdate(BaseModel):
    title: Optional[str] = None
    tags: Optional[list[str]] = None


class ArticleOut(BaseModel):
    id: str  # rel_path
    path: str
    title: str
    content: str
    updated_at: Optional[str] = None
    created_at: Optional[str] = None
    size: Optional[int] = None
    word_count: Optional[int] = None
    tags: list[str] = []
    meta: dict = {}


# ---------- helpers ----------

def _articles_dir(request: Request) -> Path:
    root = request.app.state.workspace_root
    d = root / config.DIR_ARTICLES
    d.mkdir(parents=True, exist_ok=True)
    return d


def _article_path(request: Request, article_id: str) -> Path:
    root = request.app.state.workspace_root
    if root is None:
        raise HTTPException(status_code=409, detail="未打开工作区")
    full = markdown_io.safe_rel_path(root, article_id)
    if full is None:
        raise HTTPException(status_code=400, detail="非法路径")
    return full


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _file_stats(full: Path) -> tuple[Optional[str], Optional[str], int]:
    """(created_at, updated_at, size)：Windows 下 st_ctime 即创建时间。"""
    st = full.stat()
    created = getattr(st, "st_birthtime", None)
    if created is None:
        created = st.st_ctime
    return _iso(created), _iso(st.st_mtime), st.st_size


def _mark_internal(request: Request, rel: str) -> None:
    watcher = getattr(request.app.state, "watcher", None)
    if watcher is not None:
        watcher.mark_internal(rel)


def _maybe_snapshot(request: Request, rel: str, new_content: str) -> None:
    """写盘前快照旧内容（Phase 6.3：历史版本）。

    仅在磁盘旧内容存在且与新内容不同时快照，避免元信息版本噪音；
    快照目录不在索引扫描范围，不影响搜索。
    """
    hist = getattr(request.app.state, "history", None)
    if hist is None:
        return
    full = markdown_io.safe_rel_path(request.app.state.workspace_root, rel)
    if full is None or not full.is_file():
        return
    try:
        old = markdown_io.read_text(full)
    except OSError:
        return
    if old and old != new_content:
        hist.snapshot(rel, old)


# ---------- endpoints ----------

@router.get("/tree")
def file_tree(request: Request) -> dict:
    """返回 Articles / Modules / Attachments 的文件树（相对路径）。"""
    root = request.app.state.workspace_root

    def walk(rel: str, exts: Optional[set] = None, skip: set = frozenset({".gitkeep"})):
        base = root / rel
        out = []
        if base.exists():
            for p in sorted(base.rglob("*")):
                if not p.is_file() or p.name in skip:
                    continue
                if exts and p.suffix.lower() not in exts:
                    continue
                out.append(p.relative_to(root).as_posix())
        return out

    return {
        "root": str(root),
        "articles": walk(config.DIR_ARTICLES, exts={".md", ".markdown"}),
        "modules": walk(config.DIR_MODULES, exts={".md", ".markdown"}),
        "attachments": {
            "images": walk(config.DIR_ATTACH_IMAGES),
            "videos": walk(config.DIR_ATTACH_VIDEOS),
            "files": walk(config.DIR_ATTACH_FILES),
        },
    }


@router.get("/articles", response_model=list[ArticleOut])
def list_articles(request: Request, kind: str = Query("document")) -> list[ArticleOut]:
    files = request.app.state.store.list_files(kind="document")
    return [
        ArticleOut(
            id=f["rel_path"], path=f["rel_path"], title=f["title"],
            content="", updated_at=f["updated_at"],
        )
        for f in files
    ]


@router.get("/articles/{article_id:path}", response_model=ArticleOut)
def get_article(request: Request, article_id: str) -> ArticleOut:
    full = _article_path(request, article_id)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="文章不存在")
    content = markdown_io.read_text(full)
    meta, body = markdown_io.parse_frontmatter(content)
    rel = full.relative_to(request.app.state.workspace_root).as_posix()
    created_at, updated_at, size = _file_stats(full)
    return ArticleOut(
        id=rel, path=rel,
        title=meta.get("title") or full.stem,
        content=body or content,
        meta=meta,
        created_at=created_at,
        updated_at=updated_at,
        size=size,
        word_count=markdown_io.word_count(body or content),
        tags=markdown_io.parse_tags(meta),
    )


@router.post("/articles", response_model=ArticleOut, status_code=201)
def create_article(request: Request, body: ArticleCreate) -> ArticleOut:
    articles = _articles_dir(request)
    slug = markdown_io.slugify(body.title)
    rel = f"{config.DIR_ARTICLES}/{slug}.md"
    full = articles / f"{slug}.md"
    if full.exists():
        raise HTTPException(status_code=409, detail=f"已存在同名文章: {slug}.md")
    content = body.content or f"# {body.title}\n\n"
    markdown_io.atomic_write(full, content)
    request.app.state.indexer.update_file(rel)
    _mark_internal(request, rel)
    return ArticleOut(id=rel, path=rel, title=body.title, content=content)


@router.put("/articles/{article_id:path}/meta", response_model=ArticleOut)
def update_article_meta(request: Request, article_id: str, body: ArticleMetaUpdate) -> ArticleOut:
    """更新 frontmatter 元信息（标题/标签）：真实改写 Markdown 文件后重建索引。

    注意：必须声明在 `PUT /articles/{article_id:path}` 之前，
    path 转换器为贪婪匹配，否则 `/meta` 会被吞进 article_id。
    """
    full = _article_path(request, article_id)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="文章不存在")
    content = markdown_io.read_text(full)
    updates = {}
    if body.title is not None:
        updates["title"] = body.title.strip() or full.stem
    if body.tags is not None:
        updates["tags"] = [t.strip() for t in body.tags if t.strip()]
    new_content = markdown_io.set_meta(content, updates)
    if new_content != content:
        _maybe_snapshot(request, full.relative_to(request.app.state.workspace_root).as_posix(), new_content)
        markdown_io.atomic_write(full, new_content)
        _mark_internal(request, full.relative_to(request.app.state.workspace_root).as_posix())
    rel = full.relative_to(request.app.state.workspace_root).as_posix()
    request.app.state.indexer.update_file(rel)
    meta, md_body = markdown_io.parse_frontmatter(new_content)
    created_at, updated_at, size = _file_stats(full)
    return ArticleOut(
        id=rel, path=rel,
        title=meta.get("title") or full.stem,
        content=md_body or new_content,
        meta=meta,
        created_at=created_at,
        updated_at=updated_at,
        size=size,
        word_count=markdown_io.word_count(md_body or new_content),
        tags=markdown_io.parse_tags(meta),
    )


@router.put("/articles/{article_id:path}", response_model=ArticleOut)
def update_article(request: Request, article_id: str, body: ArticleUpdate) -> ArticleOut:
    full = _article_path(request, article_id)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="文章不存在")
    rel = full.relative_to(request.app.state.workspace_root).as_posix()
    _maybe_snapshot(request, rel, body.content)
    markdown_io.atomic_write(full, body.content)
    request.app.state.indexer.update_file(rel)
    _mark_internal(request, rel)
    meta, md_body = markdown_io.parse_frontmatter(body.content)
    # 保存后返回完整元信息（与 get / meta 接口一致），否则前端保存成功后
    # 右边栏「属性」的创建/修改时间等字段会被整体替换为空值显示为「—」（v0.7.2 修复）
    created_at, updated_at, size = _file_stats(full)
    return ArticleOut(
        id=rel, path=rel,
        title=meta.get("title") or body.title or full.stem,
        content=body.content,
        meta=meta,
        created_at=created_at,
        updated_at=updated_at,
        size=size,
        word_count=markdown_io.word_count(md_body or body.content),
        tags=markdown_io.parse_tags(meta),
    )


@router.delete("/articles/{article_id:path}", status_code=204)
def delete_article(request: Request, article_id: str) -> None:
    full = _article_path(request, article_id)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="文章不存在")
    full.unlink()
    rel = full.relative_to(request.app.state.workspace_root).as_posix()
    request.app.state.indexer.update_file(rel)
