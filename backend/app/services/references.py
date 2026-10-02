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


def resolve_attachment_rel(root: Path, ref: str) -> str:
    """R03：把规范化引用映射到**磁盘上的真实相对路径**（平台文件身份/大小写）。

    - 能解析到现存文件 → 返回 resolve 后的实际路径（Windows 上即磁盘规范大小写，
      `attachments/images/Case.png` 与 `Attachments/images/case.png` 视为同一文件）；
    - 解析不到 → 尝试把首段换成规范 `Attachments`（POSIX 上大小写变体引用也
      保守保护）；
    - 都不行 → 原样返回规范化引用（**保守保护**：宁可多保护，绝不少保护而误删）。
    """
    candidates = [ref]
    head, sep, tail = ref.partition("/")
    if head != config.DIR_ATTACHMENTS and head.lower() == config.DIR_ATTACHMENTS.lower():
        candidates.append(f"{config.DIR_ATTACHMENTS}/{tail}" if sep else config.DIR_ATTACHMENTS)
    for cand in candidates:
        full = markdown_io.safe_rel_path(root, cand)
        if full is not None and full.is_file():
            return full.relative_to(root).as_posix()
    return ref


def _doc_refs_index(root: Path) -> dict[str, list[str]]:
    """扫描所有 Markdown 文档的附件引用 -> {附件rel: [文档rel,...]}（R03 规范化）。"""
    index: dict[str, list[str]] = {}
    for p in _doc_paths(root):
        try:
            content = markdown_io.read_text(p)
        except UnicodeDecodeError:
            continue
        doc_rel = p.relative_to(root).as_posix()
        for ref in markdown_io.attachment_refs_in(content):
            key = resolve_attachment_rel(root, ref)
            index.setdefault(key, []).append(doc_rel)
    return index


def doc_refs_index(root: Path) -> dict[str, list[str]]:
    """共享附件引用索引（R03）：attachments 路由与 fs 保护统一使用本函数。"""
    return _doc_refs_index(root)


def referencing_docs(
    root: Path, rel: str | None = None, prefix: str | None = None
) -> dict[str, list[str]]:
    """返回引用指定附件（rel）或目录下任一附件（prefix）的文档映射。

    返回 {附件rel: [文档rel, ...]}；无引用时为空 dict。
    R03：索引键已解析为磁盘真实路径；rel 若为大小写变体也可命中（见
    `resolve_attachment_rel`）。
    """
    index = _doc_refs_index(root)
    if rel is not None:
        if rel in index:
            return {rel: index[rel]}
        key = resolve_attachment_rel(root, rel)
        return {key: index[key]} if key in index else {}
    assert prefix is not None
    return {r: v for r, v in index.items() if r.startswith(prefix + "/")}
