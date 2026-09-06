"""文件树管理（Phase 4.2）与文件监听事件读取（Phase 4.3）。

原则：
- 真实修改文件系统；SQLite 只是索引，绝不充当虚拟文件系统；
- 所有操作基于 workspace 相对路径，经 safe_rel_path 校验防目录穿越；
- 受保护目录（.knowledgeeditor / Drafts）与顶层目录（Articles / Modules /
  Attachments）本身不可删除、重命名、移动；
- 移动规则：只改文件系统位置，不修改 Markdown 内容、不重写附件引用路径；
  仅允许在同一顶层目录内移动（跨 Articles/Modules/Attachments 移动禁止，
  避免索引 kind 推断歧义）。
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .. import config
from ..services import markdown_io
from ..services.references import referencing_docs

router = APIRouter(prefix="/api/fs", tags=["fs"])

# 顶层受保护目录（自身不可删/改名/移动；.knowledgeeditor 与 Drafts 内部也不可经 fs 操作）
_FORBIDDEN_ROOT = {
    config.DIR_INTERNAL,
    config.DIR_DRAFTS,
}
_FORBIDDEN_ROOT_LOWER = {d.lower() for d in _FORBIDDEN_ROOT}

# 允许 fs 操作的业务目录（删除/移动/重命名仅限其内部；P0-3 父级断言）
_BUSINESS_TOP = {
    config.DIR_ARTICLES,
    config.DIR_MODULES,
    config.DIR_ATTACHMENTS,
}
_BUSINESS_TOP_LOWER = {d.lower() for d in _BUSINESS_TOP}

_DOC_EXTS = {".md", ".markdown"}


# ---------- models ----------

class DirCreate(BaseModel):
    path: str = Field(..., min_length=1, description="相对 workspace 的目录路径")


class RenameBody(BaseModel):
    path: str = Field(..., min_length=1)
    new_name: str = Field(..., min_length=1, max_length=200)


class MoveBody(BaseModel):
    src: str = Field(..., min_length=1)
    dst: str = Field(..., min_length=1)


class DocCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    dir: str = ""  # 可选：Articles 下的子目录（相对路径）


# ---------- guards ----------

def _guard_rel(root: Path, rel: str) -> Path:
    """解析相对路径并校验：必须位于 workspace 内且未被禁止。

    P0-3/P2-18：根路径等价输入（"." / "" / "/"）显式拒绝；
    受保护目录比较大小写不敏感（Windows 小写 drafts/ 同样拦截）。
    """
    full = markdown_io.safe_rel_path(root, rel)
    if full is None:
        raise HTTPException(status_code=400, detail=f"非法路径: {rel}")
    parts = full.relative_to(root).parts
    if not parts:
        raise HTTPException(status_code=400, detail=f"非法路径: {rel}")
    top = parts[0]
    if top.lower() in _FORBIDDEN_ROOT_LOWER:
        raise HTTPException(status_code=400, detail=f"受保护目录，禁止操作: {top}")
    return full


def _require_business_top(root: Path, full: Path) -> None:
    """P0-3 父级断言：目标必须位于 Articles/Modules/Attachments 之下
    （含被路径归一化绕过的情况，如 "Attachments/../Modules"）。"""
    parts = full.relative_to(root).parts
    if len(parts) < 2 or parts[0].lower() not in _BUSINESS_TOP_LOWER:
        raise HTTPException(status_code=400, detail="目标必须位于 Articles/Modules/Attachments 下")


def _top_of(rel: str) -> str:
    return rel.split("/", 1)[0]


def _require_ws(request: Request) -> Path:
    root = request.app.state.workspace_root
    if root is None:
        raise HTTPException(status_code=409, detail="未打开工作区")
    return root


def _finish(request: Request, rel: str) -> None:
    """索引同步 + 自身写入标记（本次操作不触发外部修改提示）。"""
    request.app.state.indexer.update_file(rel)
    w = request.app.state.watcher
    if w is not None:
        w.mark_internal(rel)


def _migrate_history(request: Request, old_rel: str, new_rel: str) -> None:
    """F01：重命名/移动后迁移历史快照目录（Drafts/backup/{doc_rel}）。

    历史为辅助能力：迁移失败只静默（记日志），绝不阻断主操作。
    """
    hist = getattr(request.app.state, "history", None)
    if hist is None:
        return
    try:
        hist.move_path(old_rel, new_rel)
    except OSError:
        import logging

        logging.getLogger(__name__).warning("历史快照迁移失败（不影响主操作）: %s -> %s", old_rel, new_rel)


# ---------- folder ----------

@router.post("/dir", status_code=201)
def create_dir(request: Request, body: DirCreate) -> dict:
    root = _require_ws(request)
    rel = body.path.strip("/")
    # F05：顶层目录约束必须在路径规范化后校验。原实现先于 _guard_rel 在原始
    # 字符串上 startswith（`Articles/../evil` 可通过），_guard_rel 只校验不越出
    # workspace 根——「必须位于三大顶层目录下」的约束实际可被绕过。
    full = _guard_rel(root, rel)
    _require_business_top(root, full)
    full.mkdir(parents=True, exist_ok=True)
    return {"path": rel, "created": True}


@router.put("/dir")
def rename_dir(request: Request, body: RenameBody) -> dict:
    root = _require_ws(request)
    rel = body.path.strip("/")
    full = _guard_rel(root, rel)
    if not full.is_dir():
        raise HTTPException(status_code=404, detail="目录不存在")
    _require_business_top(root, full)
    new_name = body.new_name.strip().strip("/")
    if not new_name or "/" in new_name:
        raise HTTPException(status_code=400, detail="新名称不能包含路径分隔符")
    target = full.parent / new_name
    if target.exists():
        raise HTTPException(status_code=409, detail=f"目标已存在: {new_name}")
    old_rel = full.relative_to(root).as_posix()
    full.rename(target)
    new_rel = target.relative_to(root).as_posix()
    request.app.state.indexer.update_move(old_rel, new_rel)
    # F01：历史快照目录随目录迁移，避免「历史快照→恢复」对改名后的目录立即为空
    _migrate_history(request, old_rel, new_rel)
    return {"from": old_rel, "to": new_rel}


@router.delete("/dir", status_code=204)
def delete_dir(request: Request, path: str = Query(...)) -> None:
    root = _require_ws(request)
    rel = path.strip("/")
    full = _guard_rel(root, rel)
    if not full.is_dir():
        raise HTTPException(status_code=404, detail="目录不存在")
    _require_business_top(root, full)
    # P2-15：目录内含被引用的附件时拒绝删除（与 DELETE /api/attachments 保护一致）
    dir_rel = full.relative_to(root).as_posix()
    if dir_rel.startswith(config.DIR_ATTACHMENTS + "/"):
        refs = referencing_docs(root, prefix=dir_rel)
        if refs:
            total = sum(len(v) for v in refs.values())
            raise HTTPException(
                status_code=409,
                detail=f"目录内 {len(refs)} 个附件被 {total} 个文档引用，不可删除",
            )
    # P1-17：walk_* 跳过符号链接/Junction，不越界删除外部真实文件；
    # 链接本体（unlink/rmdir 只移除链接，绝不触碰目标）单独移除以清空目录。
    for p in sorted(markdown_io.walk_files(full), reverse=True):
        rel_p = p.relative_to(root).as_posix()
        p.unlink()
        request.app.state.indexer.store.delete_file(rel_p)
    for link in sorted(markdown_io.walk_links(full), reverse=True):
        markdown_io.unlink_link(link)
    for d in sorted(markdown_io.walk_dirs(full), reverse=True):
        try:
            d.rmdir()
        except OSError:
            pass  # 非空（理论不可达：文件已全部删除）或已被删除
    try:
        full.rmdir()
    except OSError:
        # 目录内残留（如并发写入）：回滚语义——保持现状并上报
        raise HTTPException(status_code=409, detail="目录未完全清空，请重试")
    # 目录删除：不留自身索引记录（indexer.delete_file 已清理子文件）


# ---------- document ----------

@router.post("/doc", status_code=201)
def create_doc(request: Request, body: DocCreate) -> dict:
    """创建 Markdown 文档（Phase 5：支持 Articles 与 Modules 顶层目录）。"""
    root = _require_ws(request)
    sub = body.dir.strip("/") if body.dir else ""
    top = config.DIR_ARTICLES
    if sub:
        # 兼容三种写法：仅顶层（"Modules"）、相对子目录（"Math"）、完整路径（"Modules/Math"）
        if sub == config.DIR_ARTICLES:
            top = config.DIR_ARTICLES
            sub = ""
        elif sub == config.DIR_MODULES:
            top = config.DIR_MODULES
            sub = ""
        elif _top_of(sub) == config.DIR_ARTICLES:
            top = config.DIR_ARTICLES
            sub = sub[len(config.DIR_ARTICLES) + 1:]
        elif _top_of(sub) == config.DIR_MODULES:
            top = config.DIR_MODULES
            sub = sub[len(config.DIR_MODULES) + 1:]
        else:
            raise HTTPException(status_code=400, detail="文档只能创建在 Articles 或 Modules 下")
        if sub:
            _guard_rel(root, f"{top}/{sub}")
    slug = markdown_io.slugify(body.title)
    rel = f"{top}/{sub}/{slug}.md" if sub else f"{top}/{slug}.md"
    full = root / rel
    if full.exists():
        raise HTTPException(status_code=409, detail=f"已存在同名文档: {slug}.md")
    content = f"# {body.title}\n\n"
    markdown_io.atomic_write(full, content)
    _finish(request, rel)
    return {"id": rel, "path": rel, "title": body.title, "created": True}


@router.put("/doc")
def rename_doc(request: Request, body: RenameBody) -> dict:
    root = _require_ws(request)
    rel = body.path.strip("/")
    full = _guard_rel(root, rel)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="文档不存在")
    if _top_of(rel) not in (config.DIR_ARTICLES, config.DIR_MODULES):
        raise HTTPException(status_code=400, detail="仅支持重命名 Markdown 文档")
    new_name = body.new_name.strip()
    if not new_name or "/" in new_name:
        raise HTTPException(status_code=400, detail="新名称不能包含路径分隔符")
    if Path(new_name).suffix.lower() not in _DOC_EXTS:
        new_name = f"{new_name}{full.suffix}"
    target = full.parent / new_name
    if target.exists():
        raise HTTPException(status_code=409, detail=f"目标已存在: {new_name}")
    old_rel = full.relative_to(root).as_posix()
    full.rename(target)
    new_rel = target.relative_to(root).as_posix()
    request.app.state.indexer.update_move(old_rel, new_rel)
    # F01：历史快照目录随文档迁移
    _migrate_history(request, old_rel, new_rel)
    return {"from": old_rel, "to": new_rel}


# ---------- move ----------

@router.post("/move")
def move_path(request: Request, body: MoveBody) -> dict:
    root = _require_ws(request)
    src_rel, dst_rel = body.src.strip("/"), body.dst.strip("/")
    src = _guard_rel(root, src_rel)
    dst = _guard_rel(root, dst_rel)
    if src.is_dir():
        # P0-3：目录形态同样禁止顶层目录或其路径归一化伪装
        _require_business_top(root, src)
        # P2-15：目录内附件被引用时不可移出（外部引用路径由身份相对性决定，
        # 移动目录会让全部引用失效——与删除保护一致，命中引用返回 409）
        src_rel_c = src.relative_to(root).as_posix()
        if src_rel_c.startswith(config.DIR_ATTACHMENTS + "/"):
            refs = referencing_docs(root, prefix=src_rel_c)
            if refs:
                total = sum(len(v) for v in refs.values())
                raise HTTPException(
                    status_code=409,
                    detail=f"目录内 {len(refs)} 个附件被 {total} 个文档引用，不可移动",
                )
    elif src.is_file():
        if _top_of(src_rel) not in (config.DIR_ARTICLES, config.DIR_MODULES, config.DIR_ATTACHMENTS):
            raise HTTPException(status_code=400, detail="不支持移动该类型文件")
        # P2-15：被引用的附件文件不可移动/重命名（引用会失效）
        if src_rel.startswith(config.DIR_ATTACHMENTS + "/"):
            refs = referencing_docs(root, rel=src_rel)
            if refs:
                raise HTTPException(
                    status_code=409,
                    detail=f"附件被 {len(refs[src_rel])} 个文档引用，不可移动",
                )
    else:
        raise HTTPException(status_code=404, detail="源路径不存在")
    if _top_of(src_rel) != _top_of(dst_rel):
        raise HTTPException(status_code=400, detail="仅允许在同一顶层目录内移动")
    if dst.exists():
        raise HTTPException(status_code=409, detail=f"目标已存在: {dst_rel}")
    src.rename(dst)
    request.app.state.indexer.update_move(src_rel, dst_rel)
    # F01：历史快照目录随移动迁移
    _migrate_history(request, src_rel, dst_rel)
    return {"from": src_rel, "to": dst_rel}


# ---------- fs events (Phase 4.3) ----------

@router.get("/events")
def fs_events(request: Request, since: int = Query(0, ge=0)) -> dict:
    watcher = request.app.state.watcher
    events = watcher.events_since(since) if watcher is not None else []
    return {"events": events, "last_seq": watcher.last_seq() if watcher else 0}
