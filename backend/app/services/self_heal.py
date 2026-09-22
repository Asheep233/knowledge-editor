"""K3-I2 方案 A：启动自愈（最小、非破坏性）。

背景：move/rename 走 `src.rename(dst)`（无 fsync、无回滚），极端崩溃（崩在
`rename` 与 `_sync_after_move` 之间）会留下两类残余：
1. **恢复草稿仍带旧路径 hash**（`{stem}-{hash8(旧路径)}.draft.md`）→
   `routers/drafts.py::_scan_drafts` 按 hash 反查不到现存文档，UI 里出现
   「找不到原文档」的记录（内容仍在磁盘）；
2. **历史快照目录孤儿**：`Drafts/backup/{旧路径}` 对应的文档已不存在。

触发时机：**工作区激活之后**（`install_workspace_hook` 包装
`routers/workspace.py::activate_workspace`）——启动（lifespan）与运行期
「打开/切换工作区」两条真实路径都覆盖；同一工作区重复激活是幂等的。
`workspace.py` 不在本任务写入边界内，故在 main 侧做显式包装。

遵守两条红线：

- **绝不猜**：草稿只有在其 stem **唯一匹配**某个现存文档 basename 时才重挂；
  0 个或多个候选一律不动（fail-safe）+ WARNING 计数；
- **绝不删**：历史快照孤儿只统计 + 记日志，不删除、不移动任何用户内容
  （处置方案需主理人批准后才能实施）。

幂等：第二次运行不产生任何变化（重挂后 hash 即命中，`move_recovery` 未命中
即 no-op）；任何异常只记日志，**绝不阻断启动/打开工作区**（与
`_sync_after_move` 同契约）。
"""
from __future__ import annotations

import logging
from pathlib import Path

from .. import config
from ..routers.drafts import _draft_name, _hash8
from ..store.db import IndexStore
from . import markdown_io

logger = logging.getLogger(__name__)

_DOC_EXTS = {".md", ".markdown"}
_DRAFT_SUFFIX = ".draft.md"
# 日志中最多列出的样本数（避免刷屏）
_LOG_SAMPLE = 10


def _new_stats() -> dict:
    return {
        "recovery_scanned": 0,
        "recovery_hit": 0,
        "recovery_healed": 0,
        "recovery_ambiguous": 0,
        "recovery_unmatched": 0,
        "recovery_conflict": 0,
        "orphan_records": 0,
        "records_migrated": 0,
        "backup_orphans": 0,
        "errors": 0,
    }


def _parse_draft_name(name: str) -> tuple[str, str] | None:
    """解析 `{stem}-{hash8}.draft.md` → (stem, hash8)；不合规范返回 None。

    口径与 `routers/drafts.py::_scan_drafts` 一致（hash8 = 完整相对路径的
    sha1 前 8 位小写十六进制）。
    """
    if not name.endswith(_DRAFT_SUFFIX):
        return None
    body = name[: -len(_DRAFT_SUFFIX)]
    h8 = body.rsplit("-", 1)[-1]
    if len(h8) != 8 or any(c not in "0123456789abcdef" for c in h8):
        return None
    stem = body[: -(len(h8) + 1)] if body.endswith("-" + h8) else body
    if not stem:
        return None
    return stem, h8


def _scan_documents(root: Path) -> tuple[dict[str, str], dict[str, list[str]]]:
    """现存文档（Articles/ + Modules/，复用 walk_files 口径）：

    -> ({hash8: rel}, {basename_stem: [rel, ...]})；同名 stem 的候选按路径排序，
    便于日志复现（歧义判定只看数量）。
    """
    by_hash: dict[str, str] = {}
    by_stem: dict[str, list[str]] = {}
    for top in (config.DIR_ARTICLES, config.DIR_MODULES):
        base = root / top
        if not base.exists():
            continue
        for p in markdown_io.walk_files(base):
            if p.suffix.lower() not in _DOC_EXTS:
                continue
            rel = p.relative_to(root).as_posix()
            by_hash[_hash8(rel)] = rel
            by_stem.setdefault(p.stem, []).append(rel)
    for rels in by_stem.values():
        rels.sort()
    return by_hash, by_stem


def heal_recovery_drafts(root: Path, store: IndexStore | None) -> dict:
    """① 恢复草稿重挂：hash 命中 → 不动；stem 唯一匹配 → 改名 + 迁移记录。

    改名只动文件名（内容逐字节不变）；规范草稿名已被占用时**绝不覆盖**
    （计 `recovery_conflict`，保持原样）。
    """
    stats = _new_stats()
    draft_dir = root / config.DIR_DRAFT_RECOVERY
    if not draft_dir.is_dir():
        return stats
    drafts: list[tuple[Path, str, str]] = []
    for p in markdown_io.walk_files(draft_dir):
        parsed = _parse_draft_name(p.name)
        if parsed is not None:
            drafts.append((p, parsed[0], parsed[1]))
    stats["recovery_scanned"] = len(drafts)
    if not drafts:
        return stats  # 常见路径（无草稿）：不扫文档，保持激活开销最小
    docs_by_hash, docs_by_stem = _scan_documents(root)
    for p, stem, h8 in drafts:
        if h8 in docs_by_hash:
            # 草稿已挂在现存文档上（正常状态 / 已自愈）→ 不动
            stats["recovery_hit"] += 1
            continue
        candidates = docs_by_stem.get(stem, [])
        if len(candidates) != 1:
            # fail-safe：0 个候选（文档确已不在）或多个候选（歧义）一律不动
            if candidates:
                stats["recovery_ambiguous"] += 1
                logger.warning(
                    "恢复草稿 stem 歧义（%d 个候选），保持原样: %s -> %s",
                    len(candidates), p.name, candidates[:_LOG_SAMPLE],
                )
            else:
                stats["recovery_unmatched"] += 1
                logger.warning(
                    "恢复草稿未匹配到现存文档，保持原样: %s",
                    p.relative_to(root).as_posix(),
                )
            continue
        new_doc = candidates[0]
        new_rel = f"{config.DIR_DRAFT_RECOVERY}/{_draft_name(new_doc)}"
        new_full = markdown_io.safe_rel_path(root, new_rel)
        if new_full is None:
            stats["errors"] += 1
            logger.warning("恢复草稿规范路径非法，保持原样: %s", new_rel)
            continue
        if new_full == p:
            continue
        if new_full.exists():
            stats["recovery_conflict"] += 1
            logger.warning("恢复草稿规范名已被占用，保持原样（不覆盖）: %s", new_rel)
            continue
        old_rel = p.relative_to(root).as_posix()
        try:
            new_full.parent.mkdir(parents=True, exist_ok=True)
            p.rename(new_full)  # 只改文件名：内容逐字节不变
        except OSError:
            stats["errors"] += 1
            logger.exception("恢复草稿改名失败（跳过，不阻断启动）: %s -> %s", old_rel, new_rel)
            continue
        stats["recovery_healed"] += 1
        # DB 记录：崩溃时仍指向旧 doc_path（其 hash8 与草稿旧名一致）→ 迁移到新路径
        if store is None:
            continue
        try:
            for rec in list(store.list_recovery()):
                old_doc = rec.get("doc_path") or ""
                if old_doc and old_doc != new_doc and _hash8(old_doc) == h8:
                    if store.move_recovery(old_doc, new_doc, new_rel):
                        stats["records_migrated"] += 1
        except Exception:  # noqa: BLE001 记录迁移失败不影响草稿文件已重挂的事实
            stats["errors"] += 1
            logger.exception("恢复记录迁移失败（草稿已重挂）: %s", new_rel)
    return stats


def reconcile_recovery_records(root: Path, store: IndexStore | None) -> dict:
    """② 记录侧兜底（仅 DB，不碰磁盘文件）。

    覆盖「崩在草稿文件已改名、`move_recovery` 尚未执行」之间：记录仍指旧
    doc_path 且其 draft_path 已不存在。仅当**旧路径 stem 唯一匹配**现存文档、
    且该文档的**规范草稿文件确实存在**时才迁移记录；否则一律不动（fail-safe）。
    """
    stats = {"orphan_records": 0, "records_migrated": 0, "errors": 0}
    if store is None:
        return stats
    try:
        records = list(store.list_recovery())
    except Exception:  # noqa: BLE001
        stats["errors"] += 1
        logger.exception("读取恢复记录失败（跳过记录侧兜底）")
        return stats
    # 先筛出「文档已不存在」的记录，无孤儿时不做文档扫描（激活开销最小）
    orphan_records: list[dict] = []
    for rec in records:
        doc = rec.get("doc_path") or ""
        if not doc or Path(doc).suffix.lower() not in _DOC_EXTS:
            continue
        doc_full = markdown_io.safe_rel_path(root, doc)
        if doc_full is not None and doc_full.is_file():
            continue  # 文档仍在 → 记录正常
        orphan_records.append(rec)
    stats["orphan_records"] = len(orphan_records)
    if not orphan_records:
        return stats
    _docs_by_hash, docs_by_stem = _scan_documents(root)
    for rec in orphan_records:
        doc = rec.get("doc_path") or ""
        draft_rel = rec.get("draft_path") or ""
        draft_full = markdown_io.safe_rel_path(root, draft_rel) if draft_rel else None
        if draft_full is not None and draft_full.is_file():
            # 草稿文件仍在旧名下 → 交给草稿扫描路径判断（这里不越权猜测）
            continue
        candidates = docs_by_stem.get(Path(doc).stem, [])
        if len(candidates) != 1:
            logger.warning(
                "恢复记录孤儿且 stem 非唯一（%d 个候选），保持原样: %s",
                len(candidates), doc,
            )
            continue
        new_doc = candidates[0]
        canonical_rel = f"{config.DIR_DRAFT_RECOVERY}/{_draft_name(new_doc)}"
        canonical_full = markdown_io.safe_rel_path(root, canonical_rel)
        if canonical_full is None or not canonical_full.is_file():
            logger.warning("恢复记录孤儿：规范草稿不存在，保持原样: %s", doc)
            continue
        try:
            if store.move_recovery(doc, new_doc, canonical_rel):
                stats["records_migrated"] += 1
        except Exception:  # noqa: BLE001
            stats["errors"] += 1
            logger.exception("恢复记录迁移失败（记录侧兜底）: %s -> %s", doc, new_doc)
    return stats


def count_backup_orphans(root: Path) -> tuple[int, list[str]]:
    """③ 历史快照孤儿：`Drafts/backup/{doc_rel}` 对应文档已不存在。

    **只统计**，不删除、不移动任何用户内容（处置需主理人批准）。
    返回 (数量, 排序后的 doc_rel 样本)。
    """
    backup_root = root / config.DIR_DRAFT_BACKUP
    if not backup_root.is_dir():
        return 0, []
    orphans: list[str] = []
    for d in markdown_io.walk_dirs(backup_root):
        rel_doc = d.relative_to(backup_root).as_posix()
        if not rel_doc.lower().endswith((".md", ".markdown")):
            continue  # 只把「文档名目录」视作快照目录
        try:
            if not any(e.is_file() and e.suffix.lower() in _DOC_EXTS for e in d.iterdir()):
                continue
        except OSError:
            continue
        target = markdown_io.safe_rel_path(root, rel_doc)
        if target is not None and target.is_file():
            continue  # 文档仍在 → 快照目录不属于孤儿
        orphans.append(rel_doc)
    orphans.sort()
    return len(orphans), orphans


def cleanup_stale_tmp_files(workspace: Path) -> int:
    """清理 `atomic_write` 残留的 `.tmp-*.md`（写入中断产物）。

    只在**启动时**执行：此刻本进程尚无写入在飞，单实例保证没有别的实例在写，
    因此工作区里存在的 `.tmp-*` 必然是历史残留。返回清理数量。
    """
    from . import markdown_io  # 局部导入，避免循环依赖

    removed = 0
    try:
        for p in markdown_io.walk_entries(workspace):
            if not p.name.startswith(markdown_io.TMP_FILE_PREFIX):
                continue
            if not p.is_file():
                continue
            try:
                p.unlink()
                removed += 1
            except OSError:
                continue
    except Exception:
        return removed
    return removed


def run_startup_self_heal(root: Path | None, store: IndexStore | None) -> dict:
    """自愈入口：工作区激活后调用一次，任何情况下都不抛出。

    返回统计字典（供日志与测试断言）：
    recovery_scanned / recovery_hit / recovery_healed / recovery_ambiguous /
    recovery_unmatched / recovery_conflict / orphan_records / records_migrated /
    backup_orphans / errors。
    """
    stats = _new_stats()
    if root is None:
        return stats
    root = Path(root)
    try:
        first = heal_recovery_drafts(root, store)
        second = reconcile_recovery_records(root, store)
        backup_count, backup_sample = count_backup_orphans(root)
        stats["recovery_scanned"] = first["recovery_scanned"]
        stats["recovery_hit"] = first["recovery_hit"]
        stats["recovery_healed"] = first["recovery_healed"]
        stats["recovery_ambiguous"] = first["recovery_ambiguous"]
        stats["recovery_unmatched"] = first["recovery_unmatched"]
        stats["recovery_conflict"] = first["recovery_conflict"]
        stats["orphan_records"] = second["orphan_records"]
        stats["records_migrated"] = first["records_migrated"] + second["records_migrated"]
        stats["backup_orphans"] = backup_count
        stats["errors"] = first["errors"] + second["errors"]
        if backup_count:
            logger.warning(
                "历史快照孤儿目录 %d 个（只统计、不删除；样本: %s）",
                backup_count, backup_sample[:_LOG_SAMPLE],
            )
        if stats["recovery_healed"] or stats["records_migrated"]:
            logger.info("K3-I2 自愈：重挂恢复草稿 %d 个、迁移记录 %d 条", stats["recovery_healed"], stats["records_migrated"])
    except Exception:  # noqa: BLE001 自愈失败绝不阻断启动/打开
        stats["errors"] += 1
        logger.exception("自愈失败（不阻断启动/打开）")
    return stats


def install_workspace_hook(workspace_module):
    """包装 `routers/workspace.py::activate_workspace`：激活后跑一次自愈。

    为什么在 main 侧包装而不是直接改 workspace.py：该 router **不在本任务写入
    边界**内。包装保证**所有**工作区激活入口都覆盖——lifespan 启动、
    `POST /api/workspace/open|create`、以及测试直接调用；返回包装后的 callable
    供 main.py 启动路径直接使用。自愈内部与调用点**双重兜底**：任何异常只记
    日志，绝不阻断启动/打开。

    幂等性由 `run_startup_self_heal` 自身保证（已命中/无可修 → 无写盘）。
    """
    original = workspace_module.activate_workspace

    def activate_workspace_with_self_heal(app, root):
        state = original(app, root)
        try:
            run_startup_self_heal(
                getattr(app.state, "workspace_root", None),
                getattr(app.state, "store", None),
            )
        except Exception:  # noqa: BLE001 自愈绝不阻断工作区打开/启动
            logger.exception("工作区自愈失败（不阻断打开/启动）")
        return state

    activate_workspace_with_self_heal.__name__ = "activate_workspace"
    activate_workspace_with_self_heal.__doc__ = original.__doc__
    workspace_module.activate_workspace = activate_workspace_with_self_heal
    return activate_workspace_with_self_heal
