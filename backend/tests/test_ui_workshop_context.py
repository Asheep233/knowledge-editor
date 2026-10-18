# -*- coding: utf-8 -*-
"""UI 工坊 T09（P1）纵向切片：/api/context/* 上下文/租约/幂等/CAS API 回归。

对应任务包 T09 的核心语义（详见 docs/ui-workshop/evidence/P1-T09-workspace-context.md）：
- 切库 epoch+1：旧 epoch 读写一律 4xx（旧 UI 迟到请求不串库）；
- 上下文租约：关闭前必须排空；
- 写入：requestId 幂等 + expectedRevision CAS + 磁盘指纹（外部改盘）+ 原子写；
- requestId 结果查询（客户端 abort/超时后可查真实结果）；
- 两工作区同相对路径互不串库。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.routers import context as context_router

REL = "Articles/note.md"


@pytest.fixture(autouse=True)
def _reset_registry():
    context_router._reset_for_tests()
    yield
    context_router._reset_for_tests()


def _root(tmp_path: Path, name: str) -> Path:
    root = tmp_path / name
    root.mkdir(parents=True, exist_ok=True)
    return root


def _open(client, ctx_id: str, root: Path) -> dict:
    r = client.post("/api/context/open", json={"id": ctx_id, "root": str(root)})
    assert r.status_code == 200, r.text
    return r.json()


def _snapshot(client, ctx: dict, rel: str = REL) -> dict:
    r = client.post(
        "/api/context/snapshot",
        json={"context_id": ctx["id"], "epoch": ctx["epoch"], "rel_path": rel},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _write(client, ctx: dict, content: str, expected: int, request_id: str | None = None):
    return client.post(
        "/api/context/write",
        json={
            "context_id": ctx["id"],
            "epoch": ctx["epoch"],
            "rel_path": REL,
            "content": content,
            "expected_revision": expected,
            "request_id": request_id,
        },
    )


def test_open_current_switch_epoch(client, tmp_path: Path) -> None:
    ws = _root(tmp_path, "w1")
    opened = _open(client, "ws1", ws)
    assert opened["epoch"] == 1 and opened["current"] == "ws1"
    assert client.get("/api/context/current").json() == {"current": "ws1"}
    switched = client.post("/api/context/switch", json={"id": "ws1"}).json()
    assert switched["epoch"] == 2


def test_lease_blocks_close_until_released(client, tmp_path: Path) -> None:
    ctx = _open(client, "ws1", _root(tmp_path, "w1"))
    lease = client.post("/api/context/lease", json={"id": "ws1", "epoch": ctx["epoch"]}).json()
    assert client.post("/api/context/close", json={"id": "ws1"}).status_code == 409
    assert client.post("/api/context/release", json={"lease_id": lease["lease_id"]}).status_code == 200
    assert client.post("/api/context/close", json={"id": "ws1"}).status_code == 200
    # 关闭后写入 → 404
    r = _write(client, ctx, "after-close", 0)
    assert r.status_code == 404


def test_snapshot_write_chain_and_result_query(client, tmp_path: Path) -> None:
    ws = _root(tmp_path, "w1")
    ctx = _open(client, "ws1", ws)
    snap = _snapshot(client, ctx)
    assert snap["revision"] == 0
    r = _write(client, ctx, "正文 v1", snap["revision"], request_id="req-1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "completed" and body["revision"] == 1 and body["file_durable"] is True
    assert (ws / REL).read_text(encoding="utf-8") == "正文 v1"
    q = client.get("/api/context/request/req-1").json()
    assert q["status"] == "completed" and q["request_id"] == "req-1"


def test_idempotent_request_id(client, tmp_path: Path) -> None:
    ctx = _open(client, "ws1", _root(tmp_path, "w1"))
    snap = _snapshot(client, ctx)
    r1 = _write(client, ctx, "first", snap["revision"], request_id="dup")
    r2 = _write(client, ctx, "second", snap["revision"], request_id="dup")
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["revision"] == r2.json()["revision"] == 1
    assert (tmp_path / "w1" / REL).read_text(encoding="utf-8") == "first"


def test_stale_revision_and_external_conflicts(client, tmp_path: Path) -> None:
    ws = _root(tmp_path, "w1")
    ctx = _open(client, "ws1", ws)
    snap = _snapshot(client, ctx)
    assert _write(client, ctx, "v1", snap["revision"]).json()["status"] == "completed"
    stale = _write(client, ctx, "stale", snap["revision"]).json()
    assert stale["status"] == "conflict" and stale["kind"] == "revision" and stale["current_revision"] == 1
    # 外部改盘 → conflict external，不覆盖外部内容
    snap2 = _snapshot(client, ctx)
    (ws / REL).write_text("外部修改", encoding="utf-8")
    ext = _write(client, ctx, "mine", snap2["revision"]).json()
    assert ext["status"] == "conflict" and ext["kind"] == "external"
    assert (ws / REL).read_text(encoding="utf-8") == "外部修改"


def test_switch_invalidates_old_epoch(client, tmp_path: Path) -> None:
    ws = _root(tmp_path, "w1")
    ctx = _open(client, "ws1", ws)
    snap = _snapshot(client, ctx)
    client.post("/api/context/switch", json={"id": "ws1"})
    r = _write(client, ctx, "late write", snap["revision"])
    assert r.status_code == 409
    assert not (ws / REL).exists()
    r2 = client.post(
        "/api/context/snapshot",
        json={"context_id": "ws1", "epoch": ctx["epoch"], "rel_path": REL},
    )
    assert r2.status_code == 409


def test_two_workspaces_same_rel_path_isolated(client, tmp_path: Path) -> None:
    a = _open(client, "wsA", _root(tmp_path, "A"))
    b = _open(client, "wsB", _root(tmp_path, "B"))
    sa, sb = _snapshot(client, a), _snapshot(client, b)
    assert _write(client, a, "A body", sa["revision"]).json()["status"] == "completed"
    assert _write(client, b, "B body", sb["revision"]).json()["status"] == "completed"
    assert (tmp_path / "A" / REL).read_text(encoding="utf-8") == "A body"
    assert (tmp_path / "B" / REL).read_text(encoding="utf-8") == "B body"


def test_path_traversal_rejected(client, tmp_path: Path) -> None:
    ctx = _open(client, "ws1", _root(tmp_path, "w1"))
    r = client.post(
        "/api/context/write",
        json={
            "context_id": "ws1",
            "epoch": ctx["epoch"],
            "rel_path": "../escape.md",
            "content": "x",
            "expected_revision": 0,
        },
    )
    assert r.status_code == 400
