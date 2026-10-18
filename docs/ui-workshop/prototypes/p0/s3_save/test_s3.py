# -*- coding: utf-8 -*-
"""P0-S3 原型测试：可信快照 → 恢复/保存链 + WorkspaceContext/CAS + 崩溃恢复。

运行：python3 -m pytest docs/ui-workshop/prototypes/p0/s3_save/test_s3.py -q
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from store import (  # noqa: E402
    SaveResult,
    StoreManager,
    WorkspaceContext,
    _sha,
)


REL = "Articles/note.md"


def _ctx(mgr: StoreManager, ws: str, root: Path) -> WorkspaceContext:
    ctx = WorkspaceContext(ws, root)
    ctx.load()
    mgr.contexts[ws] = ctx
    return ctx


@pytest.fixture()
def ws(tmp_path: Path):
    root = tmp_path / "ws1"
    (root / "Articles").mkdir(parents=True)
    (root / REL).write_bytes(b"v1 content")
    mgr = StoreManager(tmp_path)
    ctx = mgr.open_workspace("ws1", root)
    return mgr, ctx, root


def test_snapshot_save_chain(ws) -> None:
    mgr, ctx, root = ws
    snap = mgr.snapshot("ws1", REL)
    assert snap.revision == 0 and snap.content == b"v1 content"
    res = mgr.save(ctx.lease(), snap, b"v2 content", request_id="req-1")
    assert res.status == "completed" and res.accepted and res.recovery_durable and res.file_durable
    assert res.revision == 1
    assert (root / REL).read_bytes() == b"v2 content"
    q = mgr.query_result("ws1", "req-1")
    assert q and q["status"] == "completed" and q["file_durable"] is True
    # 再次快照 revision 已是 1
    assert mgr.snapshot("ws1", REL).revision == 1


def test_stale_revision_rejected(ws) -> None:
    mgr, ctx, root = ws
    snap0 = mgr.snapshot("ws1", REL)
    assert mgr.save(ctx.lease(), snap0, b"first save").status == "completed"
    res2 = mgr.save(ctx.lease(), snap0, b"second save with stale snapshot")
    assert res2.status == "conflict_revision" and res2.file_durable is False
    assert (root / REL).read_bytes() == b"first save", "旧 revision 不得覆盖新内容"


def test_external_modification_rejected(ws) -> None:
    mgr, ctx, root = ws
    snap = mgr.snapshot("ws1", REL)
    (root / REL).write_bytes(b"external change")
    res = mgr.save(ctx.lease(), snap, b"my save")
    assert res.status == "conflict_external" and res.file_durable is False
    assert (root / REL).read_bytes() == b"external change", "外部修改不得被覆盖"


def test_stale_lease_after_switch_rejected(ws) -> None:
    mgr, ctx, root = ws
    old_lease = ctx.lease()
    snap = mgr.snapshot("ws1", REL)
    mgr.switch_workspace("ws1")  # epoch+1，旧 UI 租约失效
    res = mgr.save(old_lease, snap, b"late write from old ui")
    assert res.status == "stale_context"
    assert (root / REL).read_bytes() == b"v1 content", "迟到写入不得落盘"


def test_two_workspaces_same_rel_path_isolated(tmp_path: Path) -> None:
    mgr = StoreManager(tmp_path)
    r1, r2 = tmp_path / "w1", tmp_path / "w2"
    for r, body in ((r1, b"w1 body"), (r2, b"w2 body")):
        (r / "Articles").mkdir(parents=True)
        (r / REL).write_bytes(body)
    c1 = mgr.open_workspace("w1", r1)
    c2 = mgr.open_workspace("w2", r2)
    s1 = mgr.snapshot("w1", REL)
    assert mgr.save(c1.lease(), s1, b"w1 saved", request_id="w1-req").status == "completed"
    # 切到 w2：同相对路径内容不串
    mgr.switch_workspace("w2")
    assert (r2 / REL).read_bytes() == b"w2 body"
    s2 = mgr.snapshot("w2", REL)
    assert s2.content == b"w2 body" and s2.revision == 0
    assert mgr.save(c2.lease(), s2, b"w2 saved").status == "completed"
    assert (r1 / REL).read_bytes() == b"w1 saved"
    assert (r2 / REL).read_bytes() == b"w2 saved"
    assert mgr.query_result("w1", "w1-req")["status"] == "completed"
    assert mgr.query_result("w2", "w1-req") is None


def test_idempotent_request_id(ws) -> None:
    mgr, ctx, root = ws
    snap = mgr.snapshot("ws1", REL)
    r1 = mgr.save(ctx.lease(), snap, b"once", request_id="dup-req")
    r2 = mgr.save(ctx.lease(), snap, b"twice", request_id="dup-req")
    assert r1.status == r2.status == "completed"
    assert (root / REL).read_bytes() == b"once", "重复 requestId 不得重复写入"
    assert mgr.snapshot("ws1", REL).revision == 1, "revision 不得重复递增"


# ---------- 崩溃注入（子进程 os._exit） ----------
def _run_crash_save(root: Path, content: bytes, crash_at: str, epoch: int = 1) -> subprocess.CompletedProcess:
    args = [
        sys.executable,
        str(HERE / "crash_save.py"),
        str(root),
        REL,
        content.decode("utf-8"),
        crash_at,
        str(epoch),
    ]
    env = dict(os.environ)
    env["S3_CRASH_AT"] = crash_at
    return subprocess.run(args, capture_output=True, text=True, env=env)


def _prepare_root(tmp_path: Path) -> Path:
    root = tmp_path / "ws1"
    (root / "Articles").mkdir(parents=True)
    (root / REL).write_bytes(b"base content")
    ctx = WorkspaceContext("ws1", root)
    ctx.load()
    ctx.epoch = 1
    ctx.persist()
    return root


def _recover(root: Path) -> list[dict]:
    ctx = WorkspaceContext("ws1", root)
    ctx.load()
    mgr = StoreManager(root.parent)
    mgr.contexts["ws1"] = ctx
    return mgr.recover("ws1")


def test_crash_after_recovery_log_recovers_draft(tmp_path: Path) -> None:
    root = _prepare_root(tmp_path)
    r = _run_crash_save(root, b"draft content", "save:after_recovery_log")
    assert r.returncode == 98, r.stderr
    assert (root / REL).read_bytes() == b"base content", "崩溃时正文尚未写"
    reports = _recover(root)
    assert reports and reports[0]["status"] == "recovered_from_log"
    assert (root / REL).read_bytes() == b"draft content"
    ctx = WorkspaceContext("ws1", root)
    ctx.load()
    assert ctx.files[REL]["revision"] == 1


def test_crash_after_file_write_recovers_committed(tmp_path: Path) -> None:
    root = _prepare_root(tmp_path)
    r = _run_crash_save(root, b"written content", "save:after_file_write")
    assert r.returncode == 98
    assert (root / REL).read_bytes() == b"written content"
    reports = _recover(root)
    assert reports and reports[0]["status"] == "recovered_committed"


def test_crash_after_commit_record_is_clean(tmp_path: Path) -> None:
    root = _prepare_root(tmp_path)
    r = _run_crash_save(root, b"committed content", "save:after_commit_record")
    assert r.returncode == 98
    reports = _recover(root)
    assert reports == [], "已提交后不应有恢复日志"
    ctx = WorkspaceContext("ws1", root)
    ctx.load()
    assert ctx.files[REL]["revision"] == 1
    assert (root / REL).read_bytes() == b"committed content"


def test_crash_then_external_change_keeps_external(tmp_path: Path) -> None:
    root = _prepare_root(tmp_path)
    r = _run_crash_save(root, b"draft content", "save:after_recovery_log")
    assert r.returncode == 98
    (root / REL).write_bytes(b"external newer content")
    reports = _recover(root)
    assert reports and reports[0]["status"] == "conflict_left_for_user"
    assert (root / REL).read_bytes() == b"external newer content", "恢复不得覆盖外部新内容"
