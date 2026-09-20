"""task-48 回收站硬化回归：审计条目 F-1…F-5 的**可追溯锁死**。

背景：verifier-trash 预跑审计的 5 项在提交 `ff7e9b8`（「对抗验证发现的 6 处缺陷
（含数据丢失与符号链接逃逸）」）中已修复，且已被 `tests/test_trash_verify.py`
（57 例）覆盖。本文件把**审计条目 ↔ 断言**一一对应，作为独立可追溯回归层
（在既有大套件之外再给每条审计结论一个直接锚点，不重复实现细节）。

- F-3：符号链接 entry 的 restore 不得把**工作区之外**的文件搬进工作区；
- F-4：手工 entry 的恢复目标必须过文档白名单（`Articles/`/`Modules/` + `.md`）；
- F-5：同秒 + 随机源被固定导致 entry id 撞号时**绝不覆盖**（数据丢失）；
- F-1：恢复去重上限耗尽 → **409**（不得未捕获 `FileExistsError` = 真实 500）；
- F-2：符号链接 entry 的 purge → **4xx**，且**不得误删链接目标**。
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

import pytest

import app.services.trash as trash_mod

_TRASH = "Trash"


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _write(ws: Path, rel: str, data: bytes) -> Path:
    p = ws / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def _mk_raw_doc(client, rel: str, data: bytes) -> None:
    _write(_ws(client), rel, data)
    client.app.state.indexer.update_file(rel)


def _delete_doc(client, rel: str):
    return client.delete(f"/api/articles/{rel}")


def _items(client) -> list[dict]:
    r = client.get("/api/trash")
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _entry_for(client, rel: str) -> str:
    for it in _items(client):
        if it["rel_path"] == rel:
            return it["id"]
    raise AssertionError(f"Trash 中没有 rel_path={rel!r}: {_items(client)}")


def _symlink_or_skip(target: Path, link: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(target, link)
    except (OSError, NotImplementedError) as e:  # Windows 未授权 / 平台不支持
        pytest.skip(f"本平台不支持符号链接: {e}")


# ---------- F-3 ----------


def test_f3_symlink_entry_restore_rejected_and_outside_intact(client, tmp_path):
    """符号链接 entry → restore 必须 4xx；工作区外文件不动，工作区内不新增文件。"""
    ws = _ws(client)
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    outside_file = outside_dir / "keep.txt"
    outside_file.write_bytes(b"KEEP")
    eid = "20260915-000012-aaaa"
    _symlink_or_skip(outside_dir, ws / _TRASH / eid)

    r = client.post("/api/trash/restore", json={"id": eid})

    assert r.status_code < 500, f"符号链接 entry restore 不得 500: {r.status_code} {r.text[:160]}"
    assert r.status_code >= 400, f"符号链接 entry 竟可恢复: {r.status_code} {r.text[:160]}"
    assert outside_file.is_file() and outside_file.read_bytes() == b"KEEP", "工作区外文件被搬走"
    assert not (ws / "keep.txt").exists(), "文件被搬进工作区根（/api/tree 不可见）"


# ---------- F-4 ----------


@pytest.mark.parametrize(
    "inner",
    ["Attachments/evil.md", "evil-root.md", ".knowledgeeditor/evil.md", "Drafts/evil.md"],
    ids=["attachments", "workspace-root", "internal", "drafts"],
)
def test_f4_handmade_entry_target_must_be_doc_whitelisted(client, inner):
    """手工构造的 Trash entry 不得把内容恢复到文档白名单之外的位置。"""
    ws = _ws(client)
    eid = "20260101-060603-cccc"
    _write(ws, f"{_TRASH}/{eid}/{inner}", b"EVIL")

    r = client.post("/api/trash/restore", json={"id": eid})

    assert r.status_code < 500, f"{inner} restore 不得 500: {r.status_code}"
    assert r.status_code >= 400, f"手工 entry 恢复到 {inner} 未被拒绝: {r.status_code}"
    assert not (ws / inner).exists(), f"restore 把手工 entry 写到了 {inner}"


def test_f4_legit_trash_entry_still_restores(client):
    """反例：正常删除产生的 entry 仍可恢复（保护不得过度）。"""
    rel = "Articles/f4正常.md"
    _mk_raw_doc(client, rel, b"# ok\n")
    assert _delete_doc(client, rel).status_code == 204
    r = client.post("/api/trash/restore", json={"id": _entry_for(client, rel)})
    assert r.status_code == 200, r.text
    assert r.json()["restored_to"] == rel
    assert (_ws(client) / rel).read_bytes() == b"# ok\n"


# ---------- F-5 ----------


def test_f5_entry_id_collision_never_overwrites(client, monkeypatch):
    """同秒 + 固定 token → id 必然撞号：必须产生两个独立 entry，两份内容都在。"""
    import secrets

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return cls(2026, 9, 15, 12, 0, 0)

    monkeypatch.setattr(trash_mod, "datetime", _FrozenDatetime)
    monkeypatch.setattr(secrets, "token_hex", lambda n=2: "abcd")

    ws = _ws(client)
    rel = "Articles/collide.md"
    _mk_raw_doc(client, rel, b"VERSION-A")
    assert _delete_doc(client, rel).status_code == 204
    _mk_raw_doc(client, rel, b"VERSION-B")
    assert _delete_doc(client, rel).status_code == 204

    items = _items(client)
    assert len(items) == 2, f"同秒两次删除应产生两个 entry（契约 §1），实际 {len(items)}: {items}"
    blobs = [(ws / _TRASH / it["id"] / it["rel_path"]).read_bytes() for it in items]
    assert b"VERSION-A" in blobs, "entry id 撞号覆盖 → 第一份删除内容永久丢失"
    assert b"VERSION-B" in blobs
    assert all(it["id"].startswith("20260915-120000-abcd") for it in items), [it["id"] for it in items]


# ---------- F-1 ----------


def test_f1_dedupe_cap_exhausted_returns_409_not_500(client, monkeypatch, tmp_path):
    """去重后缀耗尽 → 409（真实服务不得 500）；原文件与 entry 均保持可恢复。"""
    ws = _ws(client)
    rel = "Articles/cap.md"
    _mk_raw_doc(client, rel, b"CAP")
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    _write(ws, rel, b"LIVE")
    monkeypatch.setattr(trash_mod, "_DEDUP_MAX", 2)
    _write(ws, "Articles/cap-1.md", b"x")
    _write(ws, "Articles/cap-2.md", b"x")

    r = client.post("/api/trash/restore", json={"id": entry})

    assert r.status_code == 409, f"去重耗尽应 409，实际 {r.status_code}: {r.text[:160]}"
    assert (ws / rel).read_bytes() == b"LIVE", "失败路径覆盖了原文件"
    assert (ws / _TRASH / entry / rel).is_file(), "409 后 entry 应保持可恢复"


# ---------- F-2 ----------


def test_f2_symlink_entry_purge_rejected_and_target_intact(client, tmp_path):
    """符号链接 entry → purge 必须 4xx，且链接目标（工作区外）字节不变。"""
    ws = _ws(client)
    target_dir = tmp_path / "purge_target"
    target_dir.mkdir()
    inner = target_dir / "inner.txt"
    inner.write_bytes(b"INNER")
    eid = "20260101-070000-bbbb"
    _symlink_or_skip(target_dir, ws / _TRASH / eid)

    r = client.delete(f"/api/trash/{eid}")

    assert r.status_code < 500, f"符号链接 entry purge 不得 500: {r.status_code}"
    assert r.status_code >= 400, f"符号链接 entry 竟被接受 purge: {r.status_code}"
    assert inner.is_file() and inner.read_bytes() == b"INNER", "purge 误删/改写了链接目标"
    assert (ws / _TRASH / eid).is_symlink(), "purge 不得删除链接本体以外的任何内容"
