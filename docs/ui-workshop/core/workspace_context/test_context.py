# -*- coding: utf-8 -*-
"""T09 原型测试：WorkspaceContext 租约/epoch/CAS/幂等/结果查询/切库屏障/后台任务绑定。

运行：python3 -m pytest docs/ui-workshop/core/workspace_context/test_context.py -q
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as proto  # noqa: E402

REL = "Articles/note.md"


@pytest.fixture()
def client(tmp_path: Path):
    proto.mgr.__init__()  # 每个测试独立状态
    return TestClient(proto.app)


def open_ctx(client: TestClient, ctx_id: str, root: Path) -> dict:
    r = client.post("/api/context/open", json={"id": ctx_id, "root": str(root)})
    assert r.status_code == 200, r.text
    return r.json()


def read_snapshot(client: TestClient, ctx_id: str, epoch: int, rel: str = REL) -> dict:
    r = client.post("/api/doc/read", json={"context_id": ctx_id, "epoch": epoch, "rel_path": rel})
    assert r.status_code == 200, r.text
    return r.json()


def write(client: TestClient, ctx: dict, content: str, expected: int, request_id: str = "", delay_ms: int = 0):
    return client.post("/api/doc/write", json={
        "context_id": ctx["id"], "epoch": ctx["epoch"], "rel_path": REL, "content": content,
        "expected_revision": expected, "request_id": request_id or None, "delay_ms": delay_ms,
    })


def test_snapshot_write_chain(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    snap = read_snapshot(client, ctx["id"], ctx["epoch"])
    assert snap["revision"] == 0
    r = write(client, ctx, "正文 v1", snap["revision"], request_id="req-1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "completed" and body["revision"] == 1 and body["file_durable"] is True
    assert (tmp_path / "w1" / REL).read_text(encoding="utf-8") == "正文 v1"
    q = client.get("/api/request/req-1").json()
    assert q["status"] == "completed"
    # 原子写不残留临时文件
    assert list((tmp_path / "w1" / "Articles").glob(".note.md.tmp-*")) == []


def test_idempotent_request_id(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    snap = read_snapshot(client, ctx["id"], ctx["epoch"])
    r1 = write(client, ctx, "first", snap["revision"], request_id="dup").json()
    r2 = write(client, ctx, "second", snap["revision"], request_id="dup").json()
    assert r1["revision"] == r2["revision"] == 1
    assert (tmp_path / "w1" / REL).read_text(encoding="utf-8") == "first"


def test_stale_revision_rejected(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    snap = read_snapshot(client, ctx["id"], ctx["epoch"])
    assert write(client, ctx, "v1", snap["revision"]).json()["status"] == "completed"
    r = write(client, ctx, "stale", snap["revision"]).json()
    assert r["status"] == "conflict" and r["kind"] == "revision" and r["current_revision"] == 1
    assert (tmp_path / "w1" / REL).read_text(encoding="utf-8") == "v1"


def test_external_modification_rejected(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    snap = read_snapshot(client, ctx["id"], ctx["epoch"])
    p = tmp_path / "w1" / REL
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("外部修改", encoding="utf-8")
    r = write(client, ctx, "mine", snap["revision"]).json()
    assert r["status"] == "conflict" and r["kind"] == "external"
    assert p.read_text(encoding="utf-8") == "外部修改"


def test_switch_invalidates_old_epoch(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    snap = read_snapshot(client, ctx["id"], ctx["epoch"])
    switched = client.post("/api/context/switch", json={"id": "ws1"}).json()
    assert switched["epoch"] != ctx["epoch"]
    r = write(client, ctx, "late write", snap["revision"])
    assert r.status_code == 409
    assert not (tmp_path / "w1" / REL).exists()
    # 旧 epoch 读快照同样被拒
    r2 = client.post("/api/doc/read", json={"context_id": "ws1", "epoch": ctx["epoch"], "rel_path": REL})
    assert r2.status_code == 409


def test_two_workspaces_same_rel_path_isolated(client: TestClient, tmp_path: Path) -> None:
    a = open_ctx(client, "wsA", tmp_path / "A")
    b = open_ctx(client, "wsB", tmp_path / "B")
    sa = read_snapshot(client, a["id"], a["epoch"])
    sb = read_snapshot(client, b["id"], b["epoch"])
    assert write(client, a, "A body", sa["revision"]).json()["status"] == "completed"
    assert write(client, b, "B body", sb["revision"]).json()["status"] == "completed"
    assert (tmp_path / "A" / REL).read_text(encoding="utf-8") == "A body"
    assert (tmp_path / "B" / REL).read_text(encoding="utf-8") == "B body"


def test_background_task_binds_original_context(client: TestClient, tmp_path: Path) -> None:
    a = open_ctx(client, "wsA", tmp_path / "A")
    sa = read_snapshot(client, a["id"], a["epoch"])
    write(client, a, "A body", sa["revision"])
    # A 上发起后台索引重建，然后立刻切到 B（A epoch 失效）
    assert client.post("/api/index/rebuild", json={"context_id": a["id"], "epoch": a["epoch"]}).status_code == 200
    b = open_ctx(client, "wsB", tmp_path / "B")
    time.sleep(0.2)
    # 后台任务只改 A 的 context，不污染 B
    assert proto.mgr.contexts["wsA"].index == [REL]
    assert proto.mgr.contexts["wsB"].index == []
    assert proto.mgr.contexts["wsB"].epoch == b["epoch"]


def test_close_blocked_by_outstanding_lease(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    lease = client.post("/api/context/lease", json={"id": ctx["id"], "epoch": ctx["epoch"]}).json()
    r = client.post("/api/context/close", json={"id": ctx["id"]})
    assert r.status_code == 409  # 仍有在途租约
    client.post("/api/context/release", json={"lease_id": lease["lease_id"]})
    assert client.post("/api/context/close", json={"id": ctx["id"]}).status_code == 200
    # 关闭后写被拒
    assert write(client, ctx, "after close", 0).status_code == 404


def test_request_result_queryable_while_in_flight(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    snap = read_snapshot(client, ctx["id"], ctx["epoch"])
    outcome: dict = {}

    def do_write() -> None:
        outcome["r"] = write(client, ctx, "slow", snap["revision"], request_id="slow-1", delay_ms=300)

    t = threading.Thread(target=do_write)
    t.start()
    time.sleep(0.08)
    q = client.get("/api/request/slow-1").json()
    assert q["status"] == "in_flight" and q["accepted"] is True
    t.join()
    q2 = client.get("/api/request/slow-1").json()
    assert q2["status"] == "completed"


def test_switch_barrier_aborts_accepted_write_before_commit(client: TestClient, tmp_path: Path) -> None:
    ctx = open_ctx(client, "ws1", tmp_path / "w1")
    snap = read_snapshot(client, ctx["id"], ctx["epoch"])
    outcome: dict = {}

    def do_write() -> None:
        outcome["r"] = write(client, ctx, "cross-switch", snap["revision"], delay_ms=300)

    t = threading.Thread(target=do_write)
    t.start()
    time.sleep(0.08)
    client.post("/api/context/switch", json={"id": "ws1"})  # epoch+1，模拟切库
    t.join()
    assert outcome["r"].status_code == 409, outcome["r"].text
    assert not (tmp_path / "w1" / REL).exists(), "切库屏障必须阻止旧 epoch 落盘"
