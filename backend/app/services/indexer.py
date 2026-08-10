"""Workspace 扫描与索引重建（决策点 3：Markdown 唯一事实源，索引可重建）。

- rebuild(): 全量清空重建 files + files_fts
- update_file(): 单文件增量更新（保存/删除时调用）
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from .. import config
from ..store.db import IndexStore
from . import markdown_io

# 需要索引的顶层目录 -> kind 映射
_SCAN_DIRS = {
    config.DIR_ARTICLES: "document",
    config.DIR_MODULES: "module",
    config.DIR_ATTACHMENTS: "attachment",
}

# 索引范围：markdown 文档 + 附件二进制（正文置空，仅登记元信息）
_DOC_EXTS = {".md", ".markdown"}
_SKIP_NAMES = {".gitkeep"}


def _title_of(rel_path: str, meta: dict, content: str) -> str:
    title = (meta.get("title") or "").strip()
    if title:
        return title
    # 取第一个标题作为兜底
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return Path(rel_path).stem


def _scan(root: Path, rel: str, kind: str) -> list[dict]:
    """扫描单个顶层目录，返回待 upsert 的记录。"""
    base = root / rel
    if not base.exists():
        return []
    records = []
    for p in sorted(base.rglob("*")):
        if not p.is_file() or p.name in _SKIP_NAMES:
            continue
        rel_path = p.relative_to(root).as_posix()
        if kind == "attachment":
            records.append(
                {
                    "rel_path": rel_path,
                    "kind": "attachment",
                    "title": p.name,
                    "content": "",
                    "content_hash": "",
                    "size": p.stat().st_size,
                    "tags": [],
                    "meta": {},
                }
            )
            continue
        if p.suffix.lower() not in _DOC_EXTS:
            continue
        try:
            content = markdown_io.read_text(p)
        except UnicodeDecodeError:
            content = ""
        meta, _ = markdown_io.parse_frontmatter(content)
        records.append(
            {
                "rel_path": rel_path,
                "kind": kind,
                "title": _title_of(rel_path, meta, content),
                "content": content,
                "content_hash": markdown_io.content_hash(content),
                "size": p.stat().st_size,
                "tags": markdown_io.parse_tags(meta),
                "meta": meta,
            }
        )
    return records


class WorkspaceIndexer:
    def __init__(self, store: IndexStore, root: Path):
        self.store = store
        self.root = Path(root).resolve()

    def rebuild(self) -> dict:
        """全量重建索引。返回统计信息。"""
        self.store.clear_files()
        counts = {"document": 0, "module": 0, "attachment": 0}
        for rel, kind in _SCAN_DIRS.items():
            for rec in _scan(self.root, rel, kind):
                self.store.upsert_file(
                    rel_path=rec["rel_path"],
                    kind=rec["kind"],
                    title=rec["title"],
                    content=rec["content"],
                    content_hash=rec["content_hash"],
                    size=rec["size"],
                    tags=rec["tags"],
                    meta=rec["meta"],
                )
                counts[kind] += 1
        return counts

    def update_file(self, rel_path: str) -> None:
        """按 rel_path 更新单条索引（文件已存在则读盘 upsert，否则删除）。"""
        full = markdown_io.safe_rel_path(self.root, rel_path)
        if full is None or not full.is_file():
            self.store.delete_file(rel_path)
            return
        kind = "attachment" if rel_path.startswith(config.DIR_ATTACHMENTS + "/") else "document"
        if rel_path.startswith(config.DIR_MODULES + "/"):
            kind = "module"
        if kind == "attachment":
            self.store.upsert_file(
                rel_path=rel_path,
                kind=kind,
                title=full.name,
                content="",
                content_hash="",
                size=full.stat().st_size,
                tags=[],
                meta={},
            )
            return
        try:
            content = markdown_io.read_text(full)
        except UnicodeDecodeError:
            content = ""
        meta, _ = markdown_io.parse_frontmatter(content)
        self.store.upsert_file(
            rel_path=rel_path,
            kind=kind,
            title=_title_of(rel_path, meta, content),
            content=content,
            content_hash=markdown_io.content_hash(content),
            size=full.stat().st_size,
            tags=markdown_io.parse_tags(meta),
            meta=meta,
        )

    def update_move(self, old_rel: str, new_rel: str) -> None:
        """文件/文件夹移动或重命名后的索引同步。

        只处理文件系统位置变化（不触碰文档内容与附件引用）：
        旧路径在索引中的全部记录（含子树）逐条删除——注意旧文件已不在
        磁盘上，必须依据索引而非磁盘枚举；新路径下的文件逐条读盘 upsert。
        """
        old_recs = self.store.list_files(prefix=old_rel)
        for rec in old_recs:
            self.store.delete_file(rec["rel_path"])
        for rel in self._list_files_under(new_rel):
            self.update_file(rel)

    def _list_files_under(self, rel: str) -> list[str]:
        """列出 rel（文件或目录）下的全部文件相对路径（跳过 .gitkeep）。"""
        full = markdown_io.safe_rel_path(self.root, rel)
        if full is None or not full.exists():
            return []
        if full.is_file():
            return [full.relative_to(self.root).as_posix()]
        return [
            p.relative_to(self.root).as_posix()
            for p in sorted(full.rglob("*"))
            if p.is_file() and p.name not in _SKIP_NAMES
        ]
