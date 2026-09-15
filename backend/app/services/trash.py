"""回收站服务（MVP：仅文档，2026-09-15 立项）。

落点：``<workspace>/Trash/<entry>/<原 rel 完整路径>``

- ``entry`` 名 = ``YYYYMMDD-HHMMSS-<4hex>``：**删除时间可从中解析**，无需额外元数据文件
- 清单**完全从目录结构派生**（不引入 DB 表 / sidecar）→ 不把 SQLite 当虚拟文件系统，
  符合「Markdown 单源」红线
- ``Trash`` 不在 ``indexer`` / ``fs_watch`` / ``references``(旧) / ``/api/documents/tree``
  的枚举范围内（那些模块只认 ``Articles`` / ``Modules`` / ``Attachments``）→
  回收站内容**天然不进索引 / 搜索 / 树 / watcher**，**零扫描器改动**
  （契约 C4；落点选错的代价见 ``docs/design-file-management-feasibility.md`` §2.1）

**本模块绝不修改 Markdown 内容**（契约 C2）：只做 ``os.replace`` / ``rmtree``。

安全：所有对外的 ``entry_id`` 入口都先过 ``_ENTRY_RE`` 严格校验；恢复目标经
``markdown_io.safe_rel_path`` 二次校验，绝不越出 workspace。
"""
from __future__ import annotations

import os
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path

from .. import config
from . import markdown_io

#: entry 名：YYYYMMDD-HHMMSS-<4~16位小写hex>。
#: 常规为 4 位随机 hex；**碰撞时自动扩展**（见 `move_to_trash` 的计数兜底），
#: 保证「同一秒 + 随机源被固定/耗尽」的极端情况下也绝不覆盖既有 entry。
_ENTRY_RE = re.compile(r"^(\d{8})-(\d{6})-([0-9a-f]{4,16})$")

#: 恢复冲突时的去重后缀上限（与附件去重约定一致）
_DEDUP_MAX = 1000

#: entry id 碰撞时的重试次数（独占创建，见 move_to_trash）
_ENTRY_RETRY = 16


def trash_root(root: Path) -> Path:
    return root / config.DIR_TRASH


def is_entry_id(entry_id: str) -> bool:
    """entry id 合法性（严格白名单 → 天然阻断 ``../`` / 绝对路径 / 空串等穿越输入）。"""
    return bool(_ENTRY_RE.match(entry_id or ""))


def _new_entry_id(now: datetime | None = None) -> str:
    ts = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    return f"{ts}-{secrets.token_hex(2)}"


def _entry_id_from_name(name: str) -> str | None:
    return name if _ENTRY_RE.match(name) else None


def deleted_at_from_entry(entry_id: str) -> str:
    """从 entry 名解析删除时间（ISO8601，本地时间）。"""
    m = _ENTRY_RE.match(entry_id)
    if not m:
        return ""
    try:
        return datetime.strptime(f"{m.group(1)}-{m.group(2)}", "%Y%m%d-%H%M%S").isoformat()
    except ValueError:
        return ""


def _entry_files(entry: Path) -> list[Path]:
    """entry 内的普通文件（跳过符号链接；P1-17 同款口径）。

    额外拒绝**经由符号链接越出 entry** 的路径：`rglob` 可能穿过链接目录，
    若不校验会把工作区外的文件当成条目内容（purge/restore 都可能被利用）。
    """
    if entry.is_symlink() or not entry.is_dir():
        return []
    out: list[Path] = []
    for p in entry.rglob("*"):
        if p.is_symlink() or not p.is_file():
            continue
        try:
            if entry not in p.resolve().parents:
                continue  # 解析后越出 entry（符号链接逃逸）
        except OSError:
            continue
        out.append(p)
    return sorted(out)


def _checked_entry(root: Path, entry_id: str) -> Path:
    """校验并返回 entry 路径。

    - `entry_id` 经严格白名单（天然阻断 `../` / 绝对路径 / 空串等）
    - **拒绝符号链接**：`Trash` 根或 entry 本身是符号链接时一律拒绝 ——
      `shutil.rmtree` 遇到符号链接会抛 OSError（→500），且 restore 可能被用来
      搬运工作区外的文件。
    """
    if not is_entry_id(entry_id):
        raise ValueError("非法条目 id")
    base = trash_root(root)
    if base.is_symlink():
        raise ValueError("回收站目录为符号链接")
    entry = base / entry_id
    if entry.is_symlink():
        raise ValueError("条目为符号链接")
    return entry


def move_to_trash(root: Path, rel: str, *, src: Path | None = None) -> str:
    """把 ``root/rel`` 原子移入回收站，返回 entry id。

    只做 ``os.replace``（同盘原子）；**不读取也不改写文件内容**（C2）。

    entry 目录以 ``mkdir(exist_ok=False)`` **独占创建**，碰撞则换 id 重试 ——
    避免「同秒同随机后缀」时两次删除落进同一 entry 而互相覆盖（数据丢失）。
    若随机源被固定/耗尽导致重试全碰撞，则退到**计数扩展 id**（仍匹配白名单），
    保证这种情况下也只是换名字、绝不覆盖。
    """
    source = src if src is not None else root / rel
    base = trash_root(root)
    last = ""
    for _ in range(_ENTRY_RETRY):
        entry_id = _new_entry_id()
        last = entry_id
        if _claim_entry(base, entry_id) is None:
            continue
        dest = base / entry_id / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, dest)
        return entry_id
    # 兜底：随机源被固定 → 用确定性的计数扩展 id（4→16 位 hex 段内递增）
    for n in range(1, 0x1000000):
        entry_id = f"{last}{n:x}"
        if not _ENTRY_RE.match(entry_id):
            break
        if _claim_entry(base, entry_id) is None:
            continue
        dest = base / entry_id / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, dest)
        return entry_id
    raise RuntimeError("回收站条目创建失败（id 空间耗尽）")


def _claim_entry(base: Path, entry_id: str) -> Path | None:
    """独占创建 entry 目录；已被占用时返回 None（调用方换 id 重试）。"""
    entry = base / entry_id
    try:
        entry.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        return None
    return entry


def list_items(root: Path) -> list[dict]:
    """列出回收站条目（按删除时间倒序）。"""
    base = trash_root(root)
    if not base.is_dir():
        return []
    items: list[dict] = []
    for entry in base.iterdir():
        entry_id = _entry_id_from_name(entry.name)
        if entry_id is None or entry.is_symlink():
            continue
        files = _entry_files(entry)
        if not files:
            continue
        # MVP：一次删除 = 一个文档 = 一条 entry；异常多文件时取首个（契约 §3）
        f = files[0]
        try:
            size = f.stat().st_size
        except OSError:
            size = 0
        items.append(
            {
                "id": entry_id,
                "rel_path": f.relative_to(entry).as_posix(),
                "name": f.name,
                "deleted_at": deleted_at_from_entry(entry_id),
                "size": size,
            }
        )
    items.sort(key=lambda it: it["id"], reverse=True)
    return items


def _dedupe_target(target: Path) -> Path:
    """目标已存在时的确定性去重：``x.md`` → ``x-1.md`` → ``x-2.md`` …（不覆盖）。"""
    stem, suffix = target.stem, target.suffix
    for i in range(1, _DEDUP_MAX + 1):
        cand = target.with_name(f"{stem}-{i}{suffix}")
        if not cand.exists():
            return cand
    raise FileExistsError("同名文件过多，无法恢复")


def restore(root: Path, entry_id: str) -> tuple[str, bool]:
    """恢复条目到原路径，返回 ``(restored_rel, renamed)``。

    - 原路径被占用 → **自动改名**（``-1``/``-2``…），**绝不静默覆盖**（契约 C6）
    - 原路径的父目录由 ``mkdir(parents=True)`` 自动重建
    - 恢复目标必须通过**与删除端点同款的白名单** ``markdown_io.is_doc_rel``
      （`Articles/` 或 `Modules/` 下的 `.md`/`.markdown`）—— 防止手工构造的 entry
      把文件写进 `Attachments/`/`Drafts/`/`.knowledgeeditor`/工作区根
    """
    entry = _checked_entry(root, entry_id)
    if not entry.is_dir():
        raise FileNotFoundError("条目不存在")
    files = _entry_files(entry)
    if not files:
        raise FileNotFoundError("条目为空")
    src = files[0]
    rel = src.relative_to(entry).as_posix()
    if not markdown_io.is_doc_rel(rel):
        raise ValueError("条目内容不在文档白名单内")
    target = markdown_io.safe_rel_path(root, rel)
    if target is None:
        raise ValueError("条目内容越出工作区")
    renamed = False
    if target.exists():
        target = _dedupe_target(target)
        renamed = True
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, target)
    # 仅当 entry 已空时才清理，避免误删异常多文件条目的其余内容
    if not _entry_files(entry):
        shutil.rmtree(entry, ignore_errors=True)
    return target.relative_to(root).as_posix(), renamed


def purge(root: Path, entry_id: str) -> None:
    """彻底删除单个条目（不可恢复）。符号链接 entry 一律拒绝（见 `_checked_entry`）。"""
    entry = _checked_entry(root, entry_id)
    if not entry.exists():
        raise FileNotFoundError("条目不存在")
    shutil.rmtree(entry)


def clear(root: Path) -> None:
    """清空回收站（幂等）。"""
    base = trash_root(root)
    if base.is_dir():
        shutil.rmtree(base, ignore_errors=True)
