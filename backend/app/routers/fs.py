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

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .. import config
from ..services import markdown_io
from ..services.references import referencing_docs
from .drafts import migrate_recovery

router = APIRouter(prefix="/api/fs", tags=["fs"])

logger = logging.getLogger(__name__)

# 顶层受保护目录（自身不可删/改名/移动；.knowledgeeditor / Drafts / Trash 内部也不可经 fs 操作）
# Trash（2026-09-15 立项）：此前它只是**偶然**不可达（_require_business_top 会顺带 400），
# 现显式声明为受保护根，避免后人误把回收站挪进业务目录造成全面泄漏（契约 C1）。
_FORBIDDEN_ROOT = {
    config.DIR_INTERNAL,
    config.DIR_DRAFTS,
    config.DIR_TRASH,
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
    F9c 收口：NUL 等无法编码进路径的字符会让 `Path.resolve()` 抛 ValueError
    （真实 uvicorn 下 500）——在解析前明确 400；其他解析异常同样兜底 400。
    """
    if "\x00" in rel:
        raise HTTPException(status_code=400, detail="非法路径：含 NUL 字符")
    try:
        full = markdown_io.safe_rel_path(root, rel)
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail=f"非法路径: {rel}")
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


def _existing_dir_detail(rel: str) -> str:
    """F9b：dst 是已存在文件夹时的可操作提示（区分于误导性的裸「目标已存在」）。"""
    return (
        f"目标是已存在的文件夹：{rel}，"
        "请在目标路径里带上文件名（例如：Articles/目标文件夹/文件名.md）"
    )


def _sanitize_move_target(rel: str, source_suffix: str, fallback_stem: str = "untitled") -> str:
    """F9c：净化移动目标路径的**最后一段**，并把扩展名收敛到源文件类型。

    - 目录段原样保留（目录名清洗不在本任务范围）；
    - 复用 `markdown_io.sanitize_filename` 只净化**主名**（保留大小写/空格/CJK，
      仅替换文件系统非法字符），扩展名净化后单独拼回（参考 S-3 附件命名）；
    - 目标末段先按 Windows 语义去掉首尾空白与尾部点（与 sanitize_filename 一致），
      再取「最后一个点之后仍有内容」的部分作为目标扩展名；`....md` / `.md` /
      `..md` / `.. .md` 一类纯点名不得落成隐藏文件或只剩 `md`；
    - 最终扩展名取**源文件扩展名**：文档恒以 .md/.markdown 结尾（否则会从
      文件树/索引消失），附件保持原类型；源本身无扩展名时不做后缀拼接。
    """
    head, _, last = rel.rpartition("/")
    trimmed = last.strip().rstrip(". ")
    dot = trimmed.rfind(".")
    # dot == 0（如 ".hidden"）交给 sanitize_filename 去首部点；无有效扩展名时整段作主名
    stem = trimmed[:dot] if 0 < dot < len(trimmed) - 1 else trimmed
    clean = markdown_io.sanitize_filename(stem, fallback=fallback_stem)
    suffix = source_suffix
    if len(suffix) <= 1 or not suffix.strip("."):
        suffix = ""  # 退化后缀（"" / "."，如源名为 "file."）不拼接
    if any(ch in suffix for ch in '\\/:*?"<>|') or any(ord(c) < 32 for c in suffix):
        suffix = ""  # 源扩展名本身含非法字符：宁可不拼，也不污染最终名
    return f"{head}/{clean}{suffix}" if head else f"{clean}{suffix}"


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
        logger.warning("历史快照迁移失败（不影响主操作）: %s -> %s", old_rel, new_rel)


def _moved_is_dir(request: Request, rel: str) -> bool:
    """移动后的相对路径是否落在目录上（用于区分「目录移动」与「文件移动」）。"""
    root = request.app.state.workspace_root
    full = markdown_io.safe_rel_path(root, rel) if root is not None else None
    return full is not None and full.is_dir()


def _sync_recent_documents(request: Request, old_rel: str, new_rel: str) -> None:
    """F11：移动/重命名后同步「最近更新」（app_config）。

    - 文件移动：old_rel → new_rel 精确替换（保留 title/顺序/去重/上限 20）；
    - 目录移动：最近更新里存的是文档路径，按前缀逐条平移；
    - 失败只记日志（`_sync_after_move` 契约：FS 已变更，同步失败不阻断 200）。
    """
    cfg = getattr(request.app.state, "app_config", None)
    if cfg is None:
        return
    try:
        renamed = cfg.rename_recent_document(old_rel, new_rel)
        if not renamed and _moved_is_dir(request, new_rel):
            for item in cfg.list_recent_documents():
                rel = item["rel_path"]
                if rel.startswith(f"{old_rel}/"):
                    cfg.rename_recent_document(rel, f"{new_rel}/{rel[len(old_rel) + 1:]}")
    except Exception:  # noqa: BLE001 辅助数据同步失败不影响已完成的 FS 变更
        logger.warning("最近更新同步失败（不影响主操作）: %s -> %s", old_rel, new_rel, exc_info=True)


def _migrate_recovery(request: Request, old_rel: str, new_rel: str) -> None:
    """F12：崩溃恢复草稿随移动/重命名迁移（文件改名 + DB 记录改指）。

    失败只记日志（同 `_sync_after_move` 契约），草稿内容不做任何改写。
    """
    try:
        migrate_recovery(request, old_rel, new_rel)
    except Exception:  # noqa: BLE001
        logger.warning("恢复草稿迁移失败（不影响主操作）: %s -> %s", old_rel, new_rel, exc_info=True)


def _sync_after_move(request: Request, old_rel: str, new_rel: str) -> None:
    """重命名/移动后的索引与附属数据同步（K3-I2 / F11 / F12）。

    文件系统变更（rename）已成功，此处同步任务失败**不阻断 200**：
    - 索引不一致：K3-I1 修复后扫描签名会保持过期状态，下次启动 reconcile 自愈（全量重建）；
    - 历史快照 / 最近更新 / 恢复草稿：辅助数据，失败仅记日志。
    """
    try:
        request.app.state.indexer.update_move(old_rel, new_rel)
    except Exception:  # noqa: BLE001 索引同步失败不 500（FS 已变更，下次 reconcile 自愈）
        logger.exception("索引 move 同步失败（下次 reconcile 自愈）: %s -> %s", old_rel, new_rel)
    _migrate_history(request, old_rel, new_rel)
    _sync_recent_documents(request, old_rel, new_rel)
    _migrate_recovery(request, old_rel, new_rel)


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
    # 同名目录显式报错（原来 exist_ok=True 静默成功→用户无感知）
    if full.exists():
        raise HTTPException(status_code=409, detail=f"文件夹已存在：{rel}")
    full.mkdir(parents=True, exist_ok=False)
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
    # K3-I2：索引/历史同步失败不阻断（签名过期由下次 reconcile 自愈）
    _sync_after_move(request, old_rel, new_rel)
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
        # K3-I1：经索引器删除以同步扫描签名（直接 store.delete_file 会让
        # 下次启动 reconcile 因签名不一致退化为全量重建）
        request.app.state.indexer.delete_file(rel_p)
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
    slug = markdown_io.sanitize_filename(body.title)
    rel = f"{top}/{sub}/{slug}.md" if sub else f"{top}/{slug}.md"
    full = root / rel
    if full.exists():
        raise HTTPException(status_code=409, detail=f"已存在同名文档: {slug}.md")
    # P3-12/dual-title 对齐：新建文档正文不生成 `# {title}`（标题由编辑器页眉承载、
    # 同步 frontmatter），与 /api/articles 创建路径保持一致
    content = f"---\ntitle: {markdown_io.yaml_scalar(body.title)}\n---\n\n"
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
    _sync_after_move(request, old_rel, new_rel)
    return {"from": old_rel, "to": new_rel}


# ---------- move ----------

@router.post("/move")
def move_path(request: Request, body: MoveBody) -> dict:
    root = _require_ws(request)
    src = _guard_rel(root, body.src.strip("/"))
    dst = _guard_rel(root, body.dst.strip("/"))
    # ★ F8 修复（2026-09-15，实测可复现的安全缺陷）：一律使用**归一化后**的相对路径
    # 做顶层判定与后续同步。原实现用请求体里的**原始字符串**做 `_top_of`，而
    # `_guard_rel` 内部已由 `safe_rel_path` 把 `..` 解析掉 —— **校验看 A、落盘看 B**：
    #   {"src":"Articles/a.md","dst":"Articles/../Modules/a.md"}
    #     → 原始顶层都是 Articles → 通过「同顶层」校验 → 文件真的落到 Modules/（**跨区绕过**）
    #   {"dst":"Articles/../a.md"} → 落到**工作区根**且从 /api/tree 消失（用户再也看不到）
    # 该路径经已上线的右键「移动到…」裸 prompt 即可触发（用户打一个 `Articles/..`）。
    src_rel = src.relative_to(root).as_posix()
    dst_rel = dst.relative_to(root).as_posix()

    if src.is_dir():
        # P0-3：目录形态同样禁止顶层目录或其路径归一化伪装
        _require_business_top(root, src)
        # P2-15：目录内附件被引用时不可移出（外部引用路径由身份相对性决定，
        # 移动目录会让全部引用失效——与删除保护一致，命中引用返回 409）
        if src_rel.startswith(config.DIR_ATTACHMENTS + "/"):
            refs = referencing_docs(root, prefix=src_rel)
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

    # ★ 目标同样必须落在业务目录内 —— 原实现只校验了 src，
    #   dst 可被 `..` 提到工作区根（文件从此不在任何树里）
    _require_business_top(root, dst)
    if _top_of(src_rel) != _top_of(dst_rel):
        raise HTTPException(status_code=400, detail="仅允许在同一顶层目录内移动")

    # ★ F9b（前置）：dst 归一化后**就是已存在目录**（含尾斜杠写法）→ 明确提示补文件名。
    #   必须先于 F9c 扩展名收口判断：否则 "Articles/子目录" 会被补成 "子目录.md"，
    #   悄悄成功落盘而绕过「目标是文件夹」的可操作提示（用户只是漏写文件名）。
    #   置于顶层/同区校验之后："Articles/." 这类路径仍按 F8 语义返回 400。
    if dst.is_dir():
        raise HTTPException(status_code=409, detail=_existing_dir_detail(dst_rel))

    # ★ F9c：目标**文件名**走 v1.1.8 统一命名净化（不是驳回）——与创建/改名路径
    #   策略一致；只净化最后一段，目录段不动。净化后重新 _guard_rel +
    #   _require_business_top / 同顶层校验，确保清洗不会把路径移出业务目录或跨区。
    #   目录移动不适用（目录名清洗不在本任务范围）。
    if src.is_file():
        cleaned = _sanitize_move_target(dst_rel, Path(src_rel).suffix)
        if cleaned != dst_rel:
            dst_rel = cleaned
            dst = _guard_rel(root, dst_rel)
            dst_rel = dst.relative_to(root).as_posix()
            _require_business_top(root, dst)
            if _top_of(src_rel) != _top_of(dst_rel):
                raise HTTPException(status_code=400, detail="仅允许在同一顶层目录内移动")

    # ★ F9b：净化/扩展名收口后若撞上已存在目录，同样给出明确文案；
    #   dst 是已存在文件时保持原 409（含路径）。
    if dst.is_dir():
        raise HTTPException(status_code=409, detail=_existing_dir_detail(dst_rel))
    if dst.exists():
        raise HTTPException(status_code=409, detail=f"目标已存在: {dst_rel}")
    # 目录不得移入自身子树（否则 rename 抛 OSError → 500，且会造成不可达路径）
    if src.is_dir() and (dst == src or src in dst.parents):
        raise HTTPException(status_code=400, detail="不能把文件夹移动到自身或其子目录内")
    # ★ F9：目标父目录不存在 / 名称含非法字符时，原实现让 OSError 冒泡成 500。
    #   这里给出明确 4xx（UI 的错误提示才有意义）。
    if not dst.parent.is_dir():
        raise HTTPException(
            status_code=400,
            detail=f"目标文件夹不存在: {dst.parent.relative_to(root).as_posix()}",
        )
    try:
        src.rename(dst)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"移动失败：{e.strerror or e}")
    _sync_after_move(request, src_rel, dst_rel)
    return {"from": src_rel, "to": dst_rel}


# ---------- fs events (Phase 4.3) ----------

@router.get("/events")
def fs_events(request: Request, since: int = Query(0, ge=0)) -> dict:
    watcher = request.app.state.watcher
    events = watcher.events_since(since) if watcher is not None else []
    return {"events": events, "last_seq": watcher.last_seq() if watcher else 0}
