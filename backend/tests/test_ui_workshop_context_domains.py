# -*- coding: utf-8 -*-
"""UI 工坊 T12 切片：只读域（tree/search）绑定 WorkspaceContext（隔离/epoch）。"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.routers import context as context_router

DOCS = {
    "Articles/a.md": "---\ntitle: A\n---\n\nA 文档正文 alpha\n",
    "Articles/sub/b.md": "---\ntitle: B\n---\n\nB 文档正文 beta\n",
}


def _make_ctx(tmp_path: Path, name: str, content: dict[str, str]) -> Path:
    root = tmp_path / name
    for rel, text in content.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return root


@pytest.fixture(autouse=True)
def _reset_registry():
    context_router._reset_for_tests()
    yield
    context_router._reset_for_tests()


def _open(client, ctx_id: str, root: Path) -> dict:
    r = client.post("/api/context/open", json={"id": ctx_id, "root": str(root)})
    assert r.status_code == 200, r.text
    return r.json()


def test_tree_bound_to_context_and_isolated(client, tmp_path):
    a_root = _make_ctx(tmp_path, "A", DOCS)
    b_root = _make_ctx(tmp_path, "B", {"Articles/only-b.md": "B only\n"})
    a = _open(client, "wsA", a_root)
    b = _open(client, "wsB", b_root)
    ta = client.post("/api/context/tree", json={"context_id": "wsA", "epoch": a["epoch"]}).json()
    tb = client.post("/api/context/tree", json={"context_id": "wsB", "epoch": b["epoch"]}).json()
    assert ta["count"] == 2 and [i["rel_path"] for i in ta["items"]] == ["Articles/a.md", "Articles/sub/b.md"]
    assert tb["count"] == 1 and tb["items"][0]["rel_path"] == "Articles/only-b.md"


def test_search_bound_to_context_and_isolated(client, tmp_path):
    a_root = _make_ctx(tmp_path, "A", DOCS)
    b_root = _make_ctx(tmp_path, "B", {"Articles/b.md": "只有 beta 关键字\n"})
    a = _open(client, "wsA", a_root)
    _open(client, "wsB", b_root)
    ra = client.post("/api/context/search", json={"context_id": "wsA", "epoch": a["epoch"], "query": "beta"}).json()
    rb = client.post("/api/context/search", json={"context_id": "wsA", "epoch": a["epoch"], "query": "alpha"}).json()
    assert ra["count"] == 1 and ra["results"][0]["rel_path"] == "Articles/sub/b.md"
    assert rb["count"] == 1 and rb["results"][0]["rel_path"] == "Articles/a.md"


def test_read_domains_require_valid_epoch(client, tmp_path):
    root = _make_ctx(tmp_path, "A", DOCS)
    a = _open(client, "wsA", root)
    client.post("/api/context/switch", json={"id": "wsA"})
    stale = client.post("/api/context/tree", json={"context_id": "wsA", "epoch": a["epoch"]})
    assert stale.status_code == 409
    stale_search = client.post("/api/context/search", json={"context_id": "wsA", "epoch": a["epoch"], "query": "alpha"})
    assert stale_search.status_code == 409


def test_search_validation_and_closed_context(client, tmp_path):
    root = _make_ctx(tmp_path, "A", DOCS)
    a = _open(client, "wsA", root)
    assert client.post("/api/context/search", json={"context_id": "wsA", "epoch": a["epoch"], "query": "  "}).status_code == 400
    client.post("/api/context/close", json={"id": "wsA"})
    r = client.post("/api/context/tree", json={"context_id": "wsA", "epoch": a["epoch"]})
    assert r.status_code == 404


def test_global_workspace_endpoints_unaffected(client):
    """旧 App 的全局端点仍可用（T12 迁移必须保持 App 可用）。"""
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/tree").status_code == 200
