"""历史版本快照存储（Phase 6.3）。

轻量快照方案（用户已确认，不引入新存储系统）：
- 每次保存/恢复前，若磁盘旧内容与将写入内容不同，把旧内容快照到
  Drafts/backup/{doc_rel}/{YYYYMMDD-HHMMSS}.md（时间戳 = 快照文件名）；
- 每份文档保留最近 MAX_VERSIONS=30 份，写入后自动修剪；
- Markdown 仍是唯一事实源：快照目录不在索引扫描范围（仅 Articles /
  Modules / Attachments），不进 SQLite，不参与搜索。
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .. import config
from . import markdown_io

# 每份文档最多保留的历史版本数
MAX_VERSIONS = 30

# 快照文件名：YYYYMMDD-HHMMSS-mmm.md（本地时间 + 毫秒，避免同秒多次保存互相覆盖；
# 列表按名称排序即时间序）
_TS_RE = re.compile(r"^\d{8}-\d{6}-\d{3}$")

# 文档快照目录名后缀（目录名 = doc_rel，含扩展名）
_DOC_SUFFIXES = {".md", ".markdown"}


def _ts(prev_ts: str | None = None) -> str:
    """当前时间戳；与上一次同毫秒时单调递增 1ms（P2-3：防同毫秒覆盖）。"""
    now = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    if prev_ts is not None and now <= prev_ts:
        prev = datetime.strptime(prev_ts, "%Y%m%d-%H%M%S-%f")
        return (prev + timedelta(milliseconds=1)).strftime("%Y%m%d-%H%M%S-%f")[:-3]
    return now


class HistoryStore:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.backup_root = self.root / config.DIR_DRAFT_BACKUP

    def _snap_dir(self, doc_rel: str) -> Optional[Path]:
        """快照目录：Drafts/backup/{doc_rel}（doc_rel 含扩展名，作为目录名）。"""
        full = markdown_io.safe_rel_path(self.backup_root, doc_rel)
        return full if full is not None else None

    # ---------- 写入 ----------

    def snapshot(self, doc_rel: str, content: str) -> None:
        """写入一份新快照并修剪到 MAX_VERSIONS 份。空白内容不快照。

        P2-3：同毫秒连续快照时文件名单调递增，绝不互相覆盖。
        """
        if not content.strip():
            return
        d = self._snap_dir(doc_rel)
        if d is None:
            return
        d.mkdir(parents=True, exist_ok=True)
        prev: str | None = None
        for p in d.glob("*.md"):
            if _TS_RE.match(p.stem):
                prev = max(prev, p.stem) if prev else p.stem
        markdown_io.atomic_write(d / f"{_ts(prev)}.md", content)
        self._prune(d)

    def _prune(self, d: Path) -> None:
        """按文件名（时间戳）排序，删除最旧的超出部分。"""
        files = sorted(p for p in d.glob("*.md") if _TS_RE.match(p.stem))
        for p in files[:-MAX_VERSIONS]:
            try:
                p.unlink()
            except OSError:
                pass

    # ---------- 读取 ----------

    def list_versions(self, doc_rel: str) -> list[dict]:
        """按时间倒序返回 [{id, timestamp, size}]；id = 快照文件名 stem。"""
        d = self._snap_dir(doc_rel)
        if d is None or not d.is_dir():
            return []
        out = []
        for p in sorted(d.glob("*.md"), reverse=True):
            if not _TS_RE.match(p.stem):
                continue
            out.append(
                {
                    "id": p.stem,
                    "timestamp": self._to_iso(p.stem),
                    "size": p.stat().st_size,
                }
            )
        return out

    def version_path(self, doc_rel: str, version_id: str) -> Optional[Path]:
        """校验 version_id 合法性并返回快照文件路径；不存在返回 None。"""
        if not _TS_RE.match(version_id):
            return None
        d = self._snap_dir(doc_rel)
        if d is None:
            return None
        p = d / f"{version_id}.md"
        return p if p.is_file() else None

    def read_version(self, doc_rel: str, version_id: str) -> Optional[str]:
        p = self.version_path(doc_rel, version_id)
        if p is None:
            return None
        try:
            return markdown_io.read_text(p)
        except OSError:
            return None

    @staticmethod
    def _to_iso(stem: str) -> str:
        try:
            dt = datetime.strptime(stem, "%Y%m%d-%H%M%S-%f")
            return dt.isoformat(timespec="seconds")
        except ValueError:
            return stem

    # ---------- 迁移 ----------

    def move_path(self, old_rel: str, new_rel: str) -> None:
        """文档/目录重命名或移动后迁移其历史快照目录（F01）。

        快照目录布局：Drafts/backup/{doc_rel}/（doc_rel 为含扩展名的相对路径：
        目录名即文档路径，如 `Articles/Sub/note.md`）。因此：
        - 单文档操作：old_rel 本身即一个快照目录（后缀 .md）；
        - 目录级操作：old_rel 下每个 *.md 命名的子目录都是一个文档的快照目录。

        历史为辅助能力：迁移失败（OSError）一律静默，不阻断主操作。
        """
        old_root = markdown_io.safe_rel_path(self.backup_root, old_rel)
        if old_root is None or not old_root.is_dir():
            return
        try:
            if old_root.suffix.lower() in _DOC_SUFFIXES:
                leaves = [old_root]
            else:
                leaves = [
                    p
                    for p in old_root.rglob("*")
                    if p.is_dir() and p.suffix.lower() in _DOC_SUFFIXES
                ]
            for src in leaves:
                rel_src = src.relative_to(self.backup_root).as_posix()
                rel_dst = new_rel + rel_src[len(old_rel) :]
                dst = markdown_io.safe_rel_path(self.backup_root, rel_dst)
                if dst is None or dst == src:
                    continue
                if dst.exists():
                    self._merge_snaps(src, dst)
                else:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    src.rename(dst)
            # 目录级操作：清理迁移后遗留的空目录骨架（父容器/层级）
            if old_root.suffix.lower() not in _DOC_SUFFIXES:
                for d in sorted(old_root.rglob("*"), reverse=True):
                    try:
                        if d.is_dir():
                            d.rmdir()
                    except OSError:
                        pass
                try:
                    old_root.rmdir()
                except OSError:
                    pass
        except OSError:
            return

    def _merge_snaps(self, src: Path, dst: Path) -> None:
        """目标快照目录已存在时合并：源侧快照文件搬入（同名保留目标侧），
        随后按 MAX_VERSIONS 修剪并清理源目录。"""
        dst.mkdir(parents=True, exist_ok=True)
        for p in sorted(src.glob("*.md")):
            if not _TS_RE.match(p.stem):
                continue
            target = dst / p.name
            if not target.exists():
                try:
                    p.rename(target)
                except OSError:
                    pass
        self._prune(dst)
        for leftover in sorted(src.rglob("*"), reverse=True):
            try:
                if leftover.is_dir():
                    leftover.rmdir()
                else:
                    leftover.unlink()
            except OSError:
                pass
        try:
            src.rmdir()
        except OSError:
            pass
