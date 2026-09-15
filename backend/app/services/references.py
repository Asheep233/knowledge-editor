"""附件引用索引：扫描 Markdown 文档中的附件引用（P2-15 共享服务）。

从 attachments.py 的 _doc_refs_index 提取，供附件删除保护与 fs 的
移动/删除目录保护共同使用，避免两套实现漂移。
"""
from __future__ import annotations

from pathlib import Path

from .. import config
from . import markdown_io


def _doc_paths(root: Path) -> list[Path]:
    """Articles / Modules / **Trash** / **Drafts/recovery** 下的全部 Markdown 文件
    （跳过符号链接，P1-17）。

    这两个附加来源都是**数据安全**要求，各自解决一条「用户可操作触发的数据丢失路径」：

    - `Trash/`（2026-09-15 回收站立项，契约 §6）：文档进回收站后若从引用索引消失，
      其引用的附件会被判「孤儿」→ 前端提供删除按钮且 DELETE 只校验孤儿 →
      用户「清理孤儿」会毁掉**可恢复文档**的引用链。
    - `Drafts/recovery/`（2026-09-15，F4）：草稿持有**未保存内容**，其中引用的附件
      同样是「在用」的；不扫则「清理孤儿」会删掉恢复草稿后仍需的附件。

    **刻意不含 `Drafts/backup/`**：那是历史快照（每文档最多 `MAX_VERSIONS=30` 份），
    纳入会让几乎任何附件都被「历史引用」永久保护，**孤儿清理将彻底失去意义**。

    代价：`referenced_by` 可能包含 `Trash/...` / `Drafts/recovery/...` 路径（属预期）。
    """
    out: list[Path] = []
    tops = (
        config.DIR_ARTICLES,
        config.DIR_MODULES,
        config.DIR_TRASH,
        config.DIR_DRAFT_RECOVERY,
    )
    for top in tops:
        base = root / top
        if not base.exists():
            continue
        for p in markdown_io.walk_files(base):
            if p.suffix.lower() not in (".md", ".markdown"):
                continue
            out.append(p)
    return out


def _doc_refs_index(root: Path) -> dict[str, list[str]]:
    """扫描所有 Markdown 文档的附件引用 -> {附件rel: [文档rel,...]}。"""
    index: dict[str, list[str]] = {}
    for p in _doc_paths(root):
        try:
            content = markdown_io.read_text(p)
        except UnicodeDecodeError:
            continue
        doc_rel = p.relative_to(root).as_posix()
        for ref in markdown_io.attachment_refs_in(content):
            index.setdefault(ref, []).append(doc_rel)
    return index


def referencing_docs(
    root: Path, rel: str | None = None, prefix: str | None = None
) -> dict[str, list[str]]:
    """返回引用指定附件（rel）或目录下任一附件（prefix）的文档映射。

    返回 {附件rel: [文档rel, ...]}；无引用时为空 dict。
    """
    index = _doc_refs_index(root)
    if rel is not None:
        return {rel: index[rel]} if rel in index else {}
    assert prefix is not None
    return {r: v for r, v in index.items() if r.startswith(prefix + "/")}
