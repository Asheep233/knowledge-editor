"""Workspace 扫描与索引重建（决策点 3：Markdown 唯一事实源，索引可重建）。

- rebuild(): 全量清空重建 files + files_fts（P2-6：单事务原子提交）
- update_file(): 单文件增量更新（保存/删除时调用）
- reconcile(): 启动/切库增量校验（P3-3：磁盘扫描签名一致时跳过全量重建）
"""
from __future__ import annotations

import json
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

# 扫描签名存储键（P3-3：{rel: (size, mtime_ns)} 的哈希与统计）
_SIGNATURE_KEY = "index_scan_signature"


def _title_of(rel_path: str, meta: dict, content: str) -> str:
    # 防御：frontmatter title 可能为数字/非字符串（YAML 数字字面量），统一转字符串
    raw_title = meta.get("title")
    title = (str(raw_title) if raw_title is not None else "").strip()
    if title:
        return title
    # 取第一个标题作为兜底
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return Path(rel_path).stem


def _disk_scan_snapshot(root: Path) -> dict[str, tuple[int, int]]:
    """磁盘快照（stat 级，不读内容）：{rel: (size, mtime_ns)}。"""
    snap: dict[str, tuple[int, int]] = {}
    for rel, _kind in _SCAN_DIRS.items():
        base = root / rel
        if not base.exists():
            continue
        for p in markdown_io.walk_files(base):
            try:
                st = p.stat()
            except OSError:
                continue
            snap[p.relative_to(root).as_posix()] = (st.st_size, st.st_mtime_ns)
    return snap


def _signature(snap: dict[str, tuple[int, int]]) -> str:
    return json.dumps(snap, ensure_ascii=False, sort_keys=True)


def _scan(root: Path, rel: str, kind: str) -> list[dict]:
    """扫描单个顶层目录，返回待 upsert 的记录（P1-17：跳过符号链接/Junction）。"""
    base = root / rel
    if not base.exists():
        return []
    records = []
    for p in sorted(markdown_io.walk_files(base)):
        if p.name in _SKIP_NAMES:
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
        """全量重建索引，单事务原子提交（P2-6）；返回统计信息。

        重建完成后记录磁盘扫描签名（P3-3：下次启动可跳过全量重建）。
        """
        counts = {"document": 0, "module": 0, "attachment": 0}
        with self.store.batch():
            self.store.clear_files()
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
            self.store.set_setting(_SIGNATURE_KEY, _signature(_disk_scan_snapshot(self.root)))
        return counts

    def reconcile(self) -> dict:
        """启动/切库增量校验（P3-3）。

        磁盘扫描签名（size+mtime_ns 集合）与上次重建时一致 → 跳过全量
        重建仅返回现有统计；不一致 → 全量重建。签名校验只 stat 不读
        内容，代价远低于逐文件解析/upsert。
        """
        snap = _disk_scan_snapshot(self.root)
        sig = self.store.get_setting(_SIGNATURE_KEY)
        if sig == _signature(snap):
            return self._counts()
        return self.rebuild()

    def _counts(self) -> dict:
        """当前索引统计（与 rebuild 返回结构一致：document/module/attachment）。"""
        counts = {"document": 0, "module": 0, "attachment": 0}
        for kind in counts:
            n = self.store.count_files(kind)
            if n is not None:
                counts[kind] = n
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
        """列出 rel（文件或目录）下的全部文件相对路径（跳过 .gitkeep，P1-17）。"""
        full = markdown_io.safe_rel_path(self.root, rel)
        if full is None or not full.exists():
            return []
        if full.is_file():
            return [full.relative_to(self.root).as_posix()]
        return [
            p.relative_to(self.root).as_posix()
            for p in sorted(markdown_io.walk_files(full))
            if p.name not in _SKIP_NAMES
        ]
