"""task-21 / K3-I2 方案 A：启动自愈回归。

覆盖：
- 崩溃窗口复现（文档已在新路径 + 草稿带旧 hash + DB 记录指向旧路径）→
  真实启动路径（lifespan）自愈，草稿改名到规范名、新路径可恢复、内容逐字节不变；
- 唯一 stem 匹配但 hash 不匹配 → 重挂；0 个 / 2 个候选 → 一律不动（fail-safe）+ WARNING；
- 幂等：已命中不动、连跑两次无多余写；
- 历史快照孤儿：只统计、**不删除任何用户内容**；
- 无草稿 / 空工作区 / 不存在的根 → no-op，不抛异常；
- 自愈失败不阻断启动（store 异常被吞掉并计数）。
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from pathlib import Path

import pytest

from app import config
from app.routers import drafts as drafts_router
from app.services import self_heal
from app.services.workspace import ensure_workspace_structure
from app.store.db import IndexStore


def _make_ws(tmp_path) -> Path:
    return ensure_workspace_structure(tmp_path / "ws")


def _write_doc(ws: Path, rel: str, content: str = "# 文档\n") -> Path:
    p = ws / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def _draft_rel_for(doc_rel: str) -> str:
    """按 drafts.py 的命名契约取草稿相对路径（旧路径 hash）。"""
    return f"{config.DIR_DRAFT_RECOVERY}/{drafts_router._draft_name(doc_rel)}"


def _write_draft(ws: Path, doc_rel: str, content: str = "# 草稿\n") -> Path:
    rel = _draft_rel_for(doc_rel)
    p = ws / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def _store(ws: Path) -> IndexStore:
    return IndexStore(ws / config.DIR_INTERNAL / "index.db").connect()


def _fs_snapshot(ws: Path) -> dict[str, tuple[int, int, str]]:
    """文件快照（mtime_ns, size, sha1 内容），排除索引库自身变动。"""
    import hashlib

    out: dict[str, tuple[int, int, str]] = {}
    for p in sorted(ws.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(ws).as_posix()
        if rel.startswith(config.DIR_INTERNAL + "/"):
            continue
        st = p.stat()
        out[rel] = (st.st_mtime_ns, st.st_size, hashlib.sha1(p.read_bytes()).hexdigest())
    return out


def _craft_crash_window(ws: Path, store: IndexStore, content: str = "# 未保存草稿\n\n逐字节不变\n"):
    """造「崩溃在 rename 与 _sync_after_move 之间」的磁盘状态。

    返回 (old_rel, new_rel, old_draft, new_draft)；此时：
    文档已在新路径、草稿仍带旧路径 hash、DB 记录指向旧路径。
    """
    old_rel = "Articles/崩溃文档.md"
    new_rel = "Articles/归档/崩溃文档.md"
    _write_doc(ws, old_rel, "# 已保存\n")
    old_draft = _write_draft(ws, old_rel, content)
    store.add_recovery(old_rel, _draft_rel_for(old_rel))
    # 文件系统已改名（含目录变化），辅助数据未同步
    (ws / "Articles/归档").mkdir(parents=True, exist_ok=True)
    os.rename(ws / old_rel, ws / new_rel)
    return old_rel, new_rel, old_draft, ws / _draft_rel_for(new_rel)


# ---------- ① 崩溃窗口：真实启动路径（lifespan） ----------


def test_startup_path_heals_crash_window(tmp_path, monkeypatch):
    """★ 核心：真实启动路径（lifespan → activate_workspace → 启动自愈）。"""
    from fastapi.testclient import TestClient

    from app.main import app

    ws = tmp_path / "ws"
    monkeypatch.setattr(config, "WORKSPACE_ROOT", ws)
    old_rel = "Articles/崩溃文档.md"
    new_rel = "Articles/归档/崩溃文档.md"
    content = "# 未保存草稿\n\n逐字节不变 <!-- ke-note: {\"kind\":\"note\"} -->\n"

    # 第一次启动：正常保存 + 登记恢复点
    with TestClient(app) as c:
        r = c.post("/api/articles", json={"title": "崩溃文档", "content": "# 已保存\n"})
        assert r.status_code == 201 and r.json()["path"] == old_rel, r.text
        assert c.post(
            "/api/drafts/recovery", json={"doc_path": old_rel, "content": content}
        ).status_code == 201
        before = c.get("/api/drafts/recovery").json()
        assert before["count"] == 1 and before["items"][0]["doc_path"] == old_rel
        old_draft = ws / _draft_rel_for(old_rel)
        assert old_draft.is_file() and old_draft.read_text(encoding="utf-8") == content
        # 模拟崩溃：FS 已改名，辅助数据未同步（重启前 UI 会看到旧路径记录）
        (ws / "Articles/归档").mkdir(parents=True, exist_ok=True)
        os.rename(ws / old_rel, ws / new_rel)

    # 第二次启动 = 真实启动路径：自愈应把草稿重挂到新路径
    with TestClient(app) as c:
        after = c.get("/api/drafts/recovery").json()
        assert after["count"] == 1, json.dumps(after, ensure_ascii=False)
        item = after["items"][0]
        assert item["doc_path"] == new_rel, json.dumps(item, ensure_ascii=False)
        assert item["id"] == before["items"][0]["id"]
        assert item["saved_at"] == before["items"][0]["saved_at"]
        new_draft = ws / item["draft_path"]
        assert new_draft.is_file()
        assert new_draft.read_text(encoding="utf-8") == content, "草稿内容被改写"
        assert not old_draft.exists(), "旧 hash 草稿残留"
        # 新路径可恢复，恢复内容逐字节一致
        rr = c.post("/api/drafts/recovery/restore", json={"doc_path": new_rel})
        assert rr.status_code == 200, rr.text
        assert rr.json()["content"] == content
        assert (ws / new_rel).read_text(encoding="utf-8") == content


def test_unique_stem_rehang_migrates_record_and_keeps_bytes(tmp_path):
    """服务级：唯一 stem 匹配 + hash 不匹配 → 重挂 + 迁移记录；字节不变。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    content = "# 崩溃草稿\n\nABC 123\n"
    old_rel, new_rel, old_draft, new_draft = _craft_crash_window(ws, store, content)
    old_bytes = old_draft.read_bytes()

    stats = self_heal.run_startup_self_heal(ws, store)

    assert stats["recovery_scanned"] == 1
    assert stats["recovery_healed"] == 1, stats
    assert stats["records_migrated"] == 1, stats
    assert not old_draft.exists()
    assert new_draft.is_file() and new_draft.read_bytes() == old_bytes, "草稿内容逐字节改变"
    assert store.get_recovery(old_rel) is None
    rec = store.get_recovery(new_rel)
    assert rec is not None and rec["draft_path"] == _draft_rel_for(new_rel)
    store.close()


# ---------- 幂等 ----------


def test_hash_hit_is_noop_and_idempotent(tmp_path):
    """已正常命中的草稿 → 不动；连跑两次文件快照完全一致（无多余写）。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    doc_rel = "Articles/挂好的.md"
    _write_doc(ws, doc_rel)
    _write_draft(ws, doc_rel, "# 已挂好\n")
    store.add_recovery(doc_rel, _draft_rel_for(doc_rel))
    before = _fs_snapshot(ws)

    s1 = self_heal.run_startup_self_heal(ws, store)
    s2 = self_heal.run_startup_self_heal(ws, store)

    assert s1["recovery_hit"] == 1 and s1["recovery_healed"] == 0, s1
    assert s2["recovery_hit"] == 1 and s2["recovery_healed"] == 0, s2
    assert _fs_snapshot(ws) == before, "命中路径产生了多余写"
    store.close()


def test_second_run_after_heal_changes_nothing(tmp_path):
    """自愈一次后再次运行（幂等）：只命中、不再改名/迁移。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    _old, _new, _old_draft, new_draft = _craft_crash_window(ws, store)

    s1 = self_heal.run_startup_self_heal(ws, store)
    assert s1["recovery_healed"] == 1 and s1["records_migrated"] == 1, s1
    after_first = _fs_snapshot(ws)
    s2 = self_heal.run_startup_self_heal(ws, store)

    assert s2["recovery_healed"] == 0 and s2["records_migrated"] == 0, s2
    assert s2["recovery_hit"] == 1, s2
    assert _fs_snapshot(ws) == after_first, "第二次运行产生了变化"
    assert new_draft.is_file()
    store.close()


# ---------- fail-safe：0 / 多候选 ----------


def test_zero_candidates_keeps_draft_untouched(tmp_path, caplog):
    """0 个候选：文档确已不在 → 不动 + WARNING + 计数。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    _write_doc(ws, "Articles/别的文档.md")
    missing = "Articles/失联文档.md"
    draft = _write_draft(ws, missing, "# 失联草稿\n")
    store.add_recovery(missing, _draft_rel_for(missing))
    before = _fs_snapshot(ws)

    with caplog.at_level(logging.WARNING, logger="app.services.self_heal"):
        stats = self_heal.run_startup_self_heal(ws, store)

    assert stats["recovery_unmatched"] == 1, stats
    assert stats["recovery_healed"] == 0
    assert draft.is_file() and draft.read_text(encoding="utf-8") == "# 失联草稿\n"
    assert _fs_snapshot(ws) == before
    assert "未匹配到现存文档" in caplog.text
    assert store.get_recovery(missing) is not None, "记录被误删/误迁"
    store.close()


def test_multiple_candidates_keeps_draft_untouched(tmp_path, caplog):
    """歧义（2 个同 stem 文档）→ 一律不动 + WARNING + 计数（绝不猜）。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    _write_doc(ws, "Articles/甲/同名.md")
    _write_doc(ws, "Articles/乙/同名.md")
    missing = "Articles/同名.md"
    draft = _write_draft(ws, missing, "# 歧义草稿\n")
    store.add_recovery(missing, _draft_rel_for(missing))
    before = _fs_snapshot(ws)

    with caplog.at_level(logging.WARNING, logger="app.services.self_heal"):
        stats = self_heal.run_startup_self_heal(ws, store)

    assert stats["recovery_ambiguous"] == 1, stats
    assert stats["recovery_healed"] == 0
    assert draft.is_file() and draft.read_text(encoding="utf-8") == "# 歧义草稿\n"
    assert _fs_snapshot(ws) == before
    assert "歧义" in caplog.text
    assert store.get_recovery(missing) is not None
    store.close()


def test_canonical_draft_conflict_never_overwrites(tmp_path, caplog):
    """规范草稿名已被占用 → 绝不覆盖：两个文件都原样保留 + 计数。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    new_rel = "Articles/归档/报告.md"
    _write_doc(ws, new_rel)
    old_draft = _write_draft(ws, "Articles/报告.md", "# 旧路径草稿\n")
    canonical = _write_draft(ws, new_rel, "# 规范名草稿（不得被覆盖）\n")

    with caplog.at_level(logging.WARNING, logger="app.services.self_heal"):
        stats = self_heal.run_startup_self_heal(ws, store)

    assert stats["recovery_conflict"] == 1, stats
    assert stats["recovery_healed"] == 0
    assert old_draft.read_text(encoding="utf-8") == "# 旧路径草稿\n"
    assert canonical.read_text(encoding="utf-8") == "# 规范名草稿（不得被覆盖）\n"
    assert "不覆盖" in caplog.text
    store.close()


# ---------- 记录侧兜底（崩在文件改名与 DB 迁移之间） ----------


def test_record_only_orphan_is_migrated(tmp_path):
    """草稿文件已改名但 DB 记录未迁移 → 仅迁移记录（文件不动）。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    old_rel = "Articles/记档文档.md"
    new_rel = "Articles/归档/记档文档.md"
    _write_doc(ws, new_rel)
    canonical = _write_draft(ws, new_rel, "# 规范草稿\n")
    # 崩溃残留：记录仍指旧路径 + 旧草稿名（文件已不存在）
    store.add_recovery(old_rel, _draft_rel_for(old_rel))
    before = _fs_snapshot(ws)

    stats = self_heal.run_startup_self_heal(ws, store)

    assert stats["orphan_records"] == 1, stats
    assert stats["records_migrated"] == 1, stats
    assert store.get_recovery(old_rel) is None
    rec = store.get_recovery(new_rel)
    assert rec is not None and rec["draft_path"] == _draft_rel_for(new_rel)
    assert _fs_snapshot(ws) == before, "记录侧兜底不应触碰文件"
    assert canonical.is_file()
    store.close()


# ---------- ② 历史快照孤儿：只统计、绝不删除 ----------


def test_backup_orphans_counted_but_never_deleted(tmp_path, caplog):
    ws = _make_ws(tmp_path)
    store = _store(ws)
    # 存活文档：其快照目录不算孤儿
    _write_doc(ws, "Articles/存活.md")
    live_snap = ws / config.DIR_DRAFT_BACKUP / "Articles/存活.md/20260101-000000-000.md"
    live_snap.parent.mkdir(parents=True, exist_ok=True)
    live_snap.write_text("# 存活的历史版本\n", encoding="utf-8")
    # 孤儿：文档已不存在
    orphan_snap = ws / config.DIR_DRAFT_BACKUP / "Articles/已删除.md/20260101-000001-000.md"
    orphan_snap.parent.mkdir(parents=True, exist_ok=True)
    orphan_snap.write_text("# 已删除文档的历史版本\n", encoding="utf-8")

    with caplog.at_level(logging.WARNING, logger="app.services.self_heal"):
        stats = self_heal.run_startup_self_heal(ws, store)

    assert stats["backup_orphans"] == 1, stats
    # 绝不删除任何用户内容
    assert orphan_snap.is_file()
    assert orphan_snap.read_text(encoding="utf-8") == "# 已删除文档的历史版本\n"
    assert live_snap.is_file()
    assert "历史快照孤儿" in caplog.text
    store.close()


# ---------- 空态 / no-op / 失败不阻断 ----------


def test_empty_workspace_and_missing_root_are_noop(tmp_path):
    ws = _make_ws(tmp_path)
    stats = self_heal.run_startup_self_heal(ws, None)
    assert stats == self_heal._new_stats(), stats

    missing = tmp_path / "不存在的工作区"
    assert self_heal.run_startup_self_heal(missing, None) == self_heal._new_stats()
    assert self_heal.run_startup_self_heal(None, None) == self_heal._new_stats()


def test_non_draft_files_are_ignored(tmp_path):
    ws = _make_ws(tmp_path)
    store = _store(ws)
    d = ws / config.DIR_DRAFT_RECOVERY
    d.mkdir(parents=True, exist_ok=True)
    (d / "readme.txt").write_text("x", encoding="utf-8")
    (d / "报告-notahash.draft.md").write_text("x", encoding="utf-8")
    (d / "报告-1234567.draft.md").write_text("x", encoding="utf-8")  # hash 长度不足
    before = _fs_snapshot(ws)

    stats = self_heal.run_startup_self_heal(ws, store)

    assert stats["recovery_scanned"] == 0, stats
    assert _fs_snapshot(ws) == before
    store.close()


def test_store_failure_does_not_raise_or_block(tmp_path):
    """自愈内部异常只记日志 + 计数，绝不抛出（启动不被阻断）。"""
    ws = _make_ws(tmp_path)
    old_rel = "Articles/坏库文档.md"
    new_rel = "Articles/归档/坏库文档.md"
    _write_doc(ws, new_rel)
    _write_draft(ws, old_rel, "# 草稿\n")  # 可重挂 → 触发内部 store 调用

    class _BrokenStore:
        def list_recovery(self):
            raise RuntimeError("boom")

        def get_recovery(self, doc_path):  # pragma: no cover - 不会被走到
            raise RuntimeError("boom")

    stats = self_heal.run_startup_self_heal(ws, _BrokenStore())
    assert stats["errors"] >= 1, stats
    # 草稿文件仍按唯一 stem 完成重挂（文件侧不受 DB 失败影响）
    assert (ws / _draft_rel_for(new_rel)).is_file()


def test_recovery_table_schema_unchanged(tmp_path):
    """不改 schema：自愈只读写既有 recovery 表（列名/列数不变）。"""
    ws = _make_ws(tmp_path)
    store = _store(ws)
    cols = [r[1] for r in store.conn.execute("PRAGMA table_info(recovery)").fetchall()]
    assert cols == ["id", "doc_path", "draft_path", "saved_at", "session_id"]
    tables = {
        r[0]
        for r in store.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "recovery" in tables
    store.close()


def test_entry_exception_does_not_block_startup(tmp_path, monkeypatch):
    """★ E1b 加固：入口函数整体被替换成抛异常函数 → 启动仍成功（健康检查 200）。

    调用点纵深防御：`main.py` lifespan 对自愈入口调用单独 try/except，
    不依赖入口内部兜底——入口将来重构出 try 之外的异常也不阻断启动。
    """
    from fastapi.testclient import TestClient

    from app.main import app

    ws = tmp_path / "ws"
    monkeypatch.setattr(config, "WORKSPACE_ROOT", ws)

    def _boom(*_a, **_k):
        raise RuntimeError("injected self-heal failure")

    monkeypatch.setattr(self_heal, "run_startup_self_heal", _boom)

    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200, "自愈入口抛异常阻断了启动"
        assert c.get("/api/tree").status_code == 200

    # 判别性：注入生效 → 崩溃态保持未愈（证明补丁确实命中调用点）
    old_rel = "Articles/注入文档.md"
    new_rel = "Articles/注入文档2.md"
    _write_doc(ws, new_rel)
    old_draft = _write_draft(ws, old_rel, "# 草稿\n")
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200
    assert old_draft.is_file(), "注入 raise 后草稿仍被改名（补丁未命中调用点）"
    assert not (ws / _draft_rel_for(new_rel)).exists()
