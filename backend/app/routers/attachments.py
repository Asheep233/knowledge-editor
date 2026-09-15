"""附件管理：按类型分类存储（决策点 5）。

    Attachments/
    ├── images/   (png/jpg/jpeg/gif/webp/svg/bmp/avif)
    ├── videos/   (mp4/webm/mov/m4v/avi/mkv)
    └── files/    (其他)

命名规则（S-3）：保留原始文件名——主名经 markdown_io.sanitize_filename 净化
（保留大小写/空格/CJK，仅处理文件系统非法字符），扩展名按白名单校验后原样拼回；
同名冲突（含大小写不敏感碰撞）追加 `-1`/`-2` 确定性后缀，绝不覆盖既有文件。
落盘前对最终路径做二次越界校验（净化层 + 路径层双保险，防 ../ 穿越）。

Phase 4.7：附件列表（类型/大小/所属文档）、孤儿附件检测。
v0.6.1 约束升级：仅手动删除、绝不自动——DELETE 端点只允许删除
孤儿附件（被引用附件返回 409），删除必须由用户显式发起。
v1.0.1：P1-10 路径白名单（仅 Attachments/ 下）、P1-15 非图片/视频
强制 Content-Disposition: attachment（SVG/HTML 不再内联，防同源 XSS/RCE）、
P2-5 上传配额、P2-20 上传后 mark_internal 抑制 watcher 事件。
S-3：保留原名后，非内联附件的 Content-Disposition 升级为 RFC 6266
（ASCII 回退 + `filename*=UTF-8''`），CJK 名不再触发 latin-1 头编码 500。
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import IO
from urllib.parse import quote, unquote

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from .. import config
from ..services import markdown_io
# 2026-09-15（回收站立项）：附件引用索引改为**委托共享服务**。
# 本文件原先自带一份 `_doc_refs_index` 实现，与 `services/references.py` 漂移
# （F7：后端曾有三份引用提取实现）。回收站要求「被回收站文档引用的附件不算孤儿」，
# 两份并存会让此处漏掉 `Trash/`，导致「清理孤儿」毁掉可恢复文档的引用链（契约 §6）。
# 共享服务 docstring 本就声明「避免两套实现漂移」，本次落实。
from ..services.references import _doc_refs_index

router = APIRouter(prefix="/api/attachments", tags=["attachments"])

# 上传配额：单文件上限（P2-5，与 zip 导入单文件上限一致）
MAX_UPLOAD_SIZE = 512 * 1024 * 1024

# 允许内联（浏览器直接渲染）的扩展名：仅位图与视频。
# SVG/HTML/任何文本类一律 attachment（P1-15：内联文本可同源执行脚本）。
_INLINE_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif",
    ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".pdf",
}.union({e for e in config.IMAGE_EXTS if e not in {".svg"}})


# 允许的扩展名白名单（未知类型一律进 files/）。
# .html/.htm 允许存储但永远以 attachment 提供（P1-15），绝不内联执行。
def _safe_suffixes() -> set:
    exts = {e.lower() for e in config.IMAGE_EXTS | config.VIDEO_EXTS}
    exts.update({".pdf", ".zip", ".txt", ".csv", ".xlsx", ".docx", ".pptx", ".epub", ".json",
                 ".html", ".htm"})
    return exts


_SAFE_SUFFIX = _safe_suffixes()


def _category(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in config.IMAGE_EXTS:
        return "images"
    if ext in config.VIDEO_EXTS:
        return "videos"
    return "files"


# S-3：同名去重后缀的最大尝试次数（防病态目录导致无界循环）
_DEDUP_MAX = 1000


def _split_stem_suffix(raw: str) -> tuple[str, str]:
    """按 Path.suffix 语义拆分原始文件名为 (主名前缀, 扩展名原文)。

    扩展名取最后一个点之后的部分；主名保留其余全部内容（含目录分隔符，
    交由 sanitize_filename 统一净化），不使用 Path.stem——后者会丢弃多级路径
    前缀，丢失可读性且让穿越输入更难被观测。
    """
    suffix = Path(raw).suffix
    stem = raw[: len(raw) - len(suffix)] if suffix else raw
    return stem, suffix


# HTML 表单规范（multipart/form-data 的 filename 编码算法）：只会把 `"` / CR / LF
# 转义为 %22 / %0D / %0A。做一次规范逆变换，还原用户真实文件名——否则浏览器上传
# `a"b.txt` 会被当成字面量 `a%22b.txt` 落盘（且含 %XX 的名字在 URL 往返上有歧义）。
_HTML_FILENAME_ESCAPE_RE = re.compile(r"%22|%0[dD]|%0[aA]")
_HTML_FILENAME_ESCAPES = {"%22": '"', "%0d": "\r", "%0a": "\n"}


def _decode_multipart_filename(name: str) -> str:
    return _HTML_FILENAME_ESCAPE_RE.sub(
        lambda m: _HTML_FILENAME_ESCAPES[m.group(0).lower()], name
    )


def _is_single_component(name: str) -> bool:
    """文件名必须是单个安全组件（净化后的兜底断言，不替代 sanitize_filename）。

    拒绝：空名、`.`/`..`、含路径分隔符、NUL/换行控制字符、以及百分号编码后
    仍出现分隔符或上级引用的变体（如 %2e%2e%2f / %2f）。
    """
    if not name or name in (".", ".."):
        return False
    if "/" in name or "\\" in name:
        return False
    if Path(name).name != name:
        return False
    if any(ch in name for ch in "\x00\r\n"):
        return False
    decoded = unquote(name)
    if decoded != name:
        # 百分号编码变体：解码后若出现分隔符/上级引用/控制字符则拒绝
        if "/" in decoded or "\\" in decoded or decoded in (".", ".."):
            return False
        if any(ord(ch) < 32 for ch in decoded):
            return False
    return True


def _attachment_target(root: Path, rel_dir: str, name: str) -> Path:
    """S-3 二次防线：最终落盘路径必须严格位于 root/{rel_dir}/ 内。

    不依赖单一净化层——即使净化逻辑被绕过或回归，resolve 后的父目录校验也会
    拦下越界写入（含符号链接/异常拼接）。
    """
    if not _is_single_component(name):
        raise HTTPException(status_code=400, detail="非法文件名")
    root_resolved = Path(root).resolve()
    base = (root_resolved / rel_dir).resolve()
    try:
        base.relative_to(root_resolved)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法附件目录")
    target = base / name
    if target.parent != base or base not in target.resolve().parents:
        raise HTTPException(status_code=400, detail="非法路径")
    return target


def _existing_name_keys(target_dir: Path) -> set[str]:
    """目录内既有文件名集合（NFC + casefold）：识别大小写不敏感碰撞。"""
    keys: set[str] = set()
    try:
        for entry in target_dir.iterdir():
            keys.add(unicodedata.normalize("NFC", entry.name).casefold())
    except OSError:
        pass
    return keys


def _create_unique(
    root: Path, rel_dir: str, stem: str, suffix: str
) -> tuple[Path, IO[bytes]]:
    """确定性地创建唯一目标文件，绝不覆盖既有文件。

    - 去重后缀：`name.ext` → `name-1.ext` → `name-2.ext` …（确定性、可预期）；
    - 大小写不敏感碰撞：与目录内既有名做 NFC+casefold 比对后再落盘；
    - 并发竞态：以 O_EXCL（`open("xb")`）创建，即使存在性扫描后发生竞态，
      也只是退到下一个后缀，不会截断/覆盖别人刚写入的文件。
    """
    target_dir = root / rel_dir
    taken = _existing_name_keys(target_dir)
    for i in range(_DEDUP_MAX):
        name = f"{stem}{suffix}" if i == 0 else f"{stem}-{i}{suffix}"
        # 先校验后落盘：确保打开的文件句柄指向的路径始终在目标目录内
        target = _attachment_target(root, rel_dir, name)
        key = unicodedata.normalize("NFC", name).casefold()
        if key in taken:
            continue
        try:
            return target, target.open("xb")
        except FileExistsError:
            # 竞态：名字在扫描后被占用 → 记录并尝试下一个后缀
            taken.add(key)
    raise HTTPException(status_code=409, detail="同名附件过多，请重命名后上传")


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _scan_attachments(root: Path) -> list[dict]:
    """扫描 Attachments/ 下的全部附件元信息（P1-17：跳过符号链接/Junction）。"""
    out = []
    base = root / config.DIR_ATTACHMENTS
    if not base.exists():
        return out
    for p in sorted(markdown_io.walk_files(base)):
        if p.name == ".gitkeep":
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


def _guard_attachment_rel(request: Request, rel_path: str) -> Path:
    """P1-10：白名单——仅允许 Attachments/ 下的附件；其余位置一律 4xx。"""
    root = request.app.state.workspace_root
    if not markdown_io.is_attachment_rel(rel_path):
        raise HTTPException(status_code=400, detail="非法路径")
    full = markdown_io.safe_rel_path(root, rel_path)
    if full is None:
        raise HTTPException(status_code=400, detail="非法路径")
    return full


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
    P1-10：仅允许 Attachments/ 下的附件（Articles/*.md 等不可经此端点删除）。
    """
    root = request.app.state.workspace_root
    full = _guard_attachment_rel(request, rel_path)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="附件不存在")
    refs = _doc_refs_index(root)
    if rel_path in refs:
        raise HTTPException(
            status_code=409,
            detail=f"附件被 {len(refs[rel_path])} 个文档引用，不可删除",
        )
    try:
        full.unlink()
    except OSError:
        # P4-4：不回显本地绝对路径（避免错误信息泄漏目录结构）
        raise HTTPException(status_code=500, detail="删除附件失败")
    request.app.state.indexer.update_file(rel_path)
    return {"deleted": rel_path}


@router.post("", status_code=201)
async def upload_attachment(
    request: Request, file: UploadFile = File(...)
) -> dict:
    """上传附件（S-3：保留原始文件名 + 路径穿越防护）。

    文件名处理链：
    1. 逆变换 multipart 传输层转义（`%22`/`%0D`/`%0A` → `"`/CR/LF，HTML 表单规范）；
    2. 拆分「主名 + 扩展名」，扩展名走 _SAFE_SUFFIX 白名单（小写比对，非白名单 400）；
    3. 主名交给 markdown_io.sanitize_filename 统一净化（保留大小写/空格/CJK）；
    4. 扩展名单独拼回（保留原始大小写），避免截断破坏后缀、使白名单校验与落盘后缀一致；
    5. 空/退化主名回退 `unnamed`，无扩展名回退 `.bin`，绝不 500；
    6. 落盘前 _create_unique 做路径二次校验 + 确定性去重 + O_EXCL 创建。
    """
    raw = _decode_multipart_filename(file.filename or "")
    stem, suffix = _split_stem_suffix(raw)
    ext = suffix.lower()
    if ext and ext not in _SAFE_SUFFIX:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

    # S-3：仅净化主名（复用 v1.1.8 统一命名策略）；扩展名走白名单，不参与净化
    safe_stem = markdown_io.sanitize_filename(stem, fallback="unnamed")
    final_ext = suffix or ".bin"
    category = _category(f"{safe_stem}{final_ext}")
    rel_dir = f"{config.DIR_ATTACHMENTS}/{category}"
    root = request.app.state.workspace_root
    target_dir = root / rel_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    # 保留原始文件名（净化后）；同名冲突追加 -1/-2 后缀，绝不覆盖
    target, out = _create_unique(root, rel_dir, safe_stem, final_ext)
    name = target.name

    # 流式落盘，避免大文件整载内存；P2-5：超过配额中止并清理半成品
    size = 0
    try:
        with out:
            while chunk := await file.read(1024 * 256):
                size += len(chunk)
                if size > MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"附件超过大小上限（{MAX_UPLOAD_SIZE // (1024 * 1024)}MB）",
                    )
                out.write(chunk)
    except BaseException:
        try:
            target.unlink()
        except OSError:
            pass
        raise

    rel = f"{rel_dir}/{name}"
    request.app.state.indexer.update_file(rel)
    # P2-20：上传完成标记为内部写入，抑制 watcher 自身事件
    watcher = getattr(request.app.state, "watcher", None)
    if watcher is not None:
        watcher.mark_internal(rel)
    return {
        "path": rel,
        "url": f"/api/attachments/{rel}",
        "category": category,
        "size": size,
        "name": name,
    }


def _attachment_disposition(name: str) -> str:
    """RFC 6266/5987 的 Content-Disposition（S-3 起落盘名可含 CJK）。

    - ASCII 回退 `filename="..."`：非 ASCII/引号/反斜杠一律替换为 `_`，保证头
      可按 latin-1 编码（直接把 CJK 名写进 filename= 会 UnicodeEncodeError 500）；
    - `filename*=UTF-8''` 百分号编码承载真实原名，浏览器/客户端优先使用它。
    净化层已确保 name 不含 `"`/CR/LF，这里再编码一次作为纵深兜底（防头注入）。
    """
    ascii_name = "".join(
        ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "_" for ch in name
    )
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"


@router.get("/{rel_path:path}")
def get_attachment(request: Request, rel_path: str) -> FileResponse:
    root = request.app.state.workspace_root
    full = _guard_attachment_rel(request, rel_path)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="附件不存在")
    # P1-15：仅位图/视频内联；SVG/HTML 与其他文件强制 attachment
    #（Content-Disposition），避免脚本型内容同源执行。
    headers = None
    ext = full.suffix.lower()
    if ext not in _INLINE_EXTS:
        headers = {"Content-Disposition": _attachment_disposition(full.name)}
    return FileResponse(full, headers=headers)
