"""Phase 4.3 文件监听与外部修改检测测试。

覆盖：外部写盘修改/新增/删除检测、自身写入抑制（内部写入标记）、事件游标。
"""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture()
def paused_watcher(client):
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _mk_doc(client, title, content=""):
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_external_modification_detected(client, paused_watcher):
    rel = _mk_doc(client, "外部修改检测")
    paused_watcher.sniff()  # 消化 created 事件，建立快照
    # 直接写盘模拟外部编辑器修改
    (_ws(client) / rel).write_text("# 外部修改检测\n\n外部编辑器写入了新内容", encoding="utf-8")
    events = paused_watcher.sniff()
    mods = [e for e in events if e["rel"] == rel and e["type"] == "modified"]
    assert mods, f"未检测到外部修改事件: {events}"


def test_internal_write_suppressed(client, paused_watcher):
    rel = _mk_doc(client, "自身写入抑制")
    paused_watcher.sniff()
    # 通过保存 API 写盘（后端登记内部写入标记）
    r = client.put(f"/api/articles/{rel}", json={"content": "# 自身写入抑制\n\n保存的新内容"})
    assert r.status_code == 200
    events = paused_watcher.sniff()
    assert not [e for e in events if e["rel"] == rel and e["type"] == "modified"], events


def test_created_and_deleted_detected(client, paused_watcher):
    paused_watcher.sniff()
    new_rel = "Articles/监听新增.md"
    (_ws(client) / new_rel).write_text("# 监听新增", encoding="utf-8")
    events = paused_watcher.sniff()
    assert any(e["rel"] == new_rel and e["type"] == "created" for e in events)
    (_ws(client) / new_rel).unlink()
    events = paused_watcher.sniff()
    assert any(e["rel"] == new_rel and e["type"] == "deleted" for e in events)


def test_rename_produces_delete_then_create(client, paused_watcher):
    rel = _mk_doc(client, "重命名事件")
    paused_watcher.sniff()
    r = client.put("/api/fs/doc", json={"path": rel, "new_name": "重命名后"})
    assert r.status_code == 200
    new_rel = r.json()["to"]
    events = paused_watcher.sniff()
    assert any(e["rel"] == rel and e["type"] == "deleted" for e in events)
    assert any(e["rel"] == new_rel and e["type"] == "created" for e in events)


def test_events_since_cursor(client, paused_watcher):
    paused_watcher.sniff()
    before = client.get("/api/fs/events", params={"since": 0}).json()
    since = before["last_seq"]
    rel = _mk_doc(client, "游标事件")
    paused_watcher.sniff()
    after = client.get("/api/fs/events", params={"since": since}).json()
    assert any(e["rel"] == rel and e["type"] == "created" for e in after["events"])
    assert after["last_seq"] > since
    # 游标推进后不再返回旧事件
    again = client.get("/api/fs/events", params={"since": after["last_seq"]}).json()
    assert all(e["rel"] != rel for e in again["events"])


def test_watcher_ignores_unindexed_dirs(client, paused_watcher):
    """Drafts / .knowledgeeditor 等非索引目录不产生事件。"""
    paused_watcher.sniff()
    (_ws(client) / "Drafts" / "draft.md").write_text("# 草稿", encoding="utf-8")
    (_ws(client) / ".knowledgeeditor" / "tmp.txt").write_text("x", encoding="utf-8")
    events = paused_watcher.sniff()
    assert not any(".knowledgeeditor" in e["rel"] or e["rel"].startswith("Drafts/") for e in events)
