# -*- coding: utf-8 -*-
"""UI 工坊 T12 写域切片：受控文章保存（Articles/**.md、frontmatter、CAS、上下文隔离）。"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.routers import context as context_router


@pytest.fixture(autouse=True)
def _reset_registry():
    context_router._reset_for_tests()
    yield
    context_router._reset_for_tests()


def _open(client, tmp_path: Path, ctx_id: str = "wsA", name: str = "A") -> dict:
    root = tmp_path / name
    root.mkdir(parents=True, exist_ok=True)
    r = client.post("/api/context/open", json={"id": ctx_id, "root": str(root)})
    assert r.status_code == 200, r.text
    return r.json()


def _save(client, ctx: dict, rel: str = "Articles/hello.md", title: str = "Hello", content: str = "正文内容", expected: int = 0, request_id: str | None = None):
    return client.post("/api/context/article/save", json={
        "context_id": ctx["id"], "epoch": ctx["epoch"], "rel_path": rel, "title": title,
        "content": content, "expected_revision": expected, "request_id": request_id,
    })


def test_save_article_writes_frontmatter_and_appears_in_tree_search(client, tmp_path):
    ctx = _open(client, tmp_path)
    r = _save(client, ctx, content="这是 alpha 文章正文")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "completed" and body["revision"] == 1 and body["title"] == "Hello"
    disk = (tmp_path / "A" / "Articles/hello.md").read_text(encoding="utf-8")
    assert disk.startswith("---\n") and 'title: "Hello"' in disk and "alpha" in disk
    tree = client.post("/api/context/tree", json={"context_id": "wsA", "epoch": ctx["epoch"]}).json()
    assert any(i["rel_path"] == "Articles/hello.md" for i in tree["items"])
    search = client.post("/api/context/search", json={"context_id": "wsA", "epoch": ctx["epoch"], "query": "alpha"}).json()
    assert search["count"] == 1 and search["results"][0]["rel_path"] == "Articles/hello.md"


def test_article_cas_and_idempotency(client, tmp_path):
    ctx = _open(client, tmp_path)
    assert _save(client, ctx, expected=0).json()["revision"] == 1
    r2 = _save(client, ctx, content="第二版", expected=1)
    assert r2.json()["status"] == "completed" and r2.json()["revision"] == 2
    stale = _save(client, ctx, content="过期版本", expected=1).json()
    assert stale["status"] == "conflict" and stale["kind"] == "revision"
    assert "第二版" in (tmp_path / "A" / "Articles/hello.md").read_text(encoding="utf-8")
    dup = _save(client, ctx, content="幂等", expected=2, request_id="same-req").json()
    dup2 = _save(client, ctx, content="幂等2", expected=2, request_id="same-req").json()
    assert dup["revision"] == dup2["revision"]


def test_article_path_restrictions(client, tmp_path):
    ctx = _open(client, tmp_path)
    outside = _save(client, ctx, rel="Notes/x.md")
    assert outside.status_code == 400
    traversal = _save(client, ctx, rel="Articles/../evil.md")
    assert traversal.status_code == 400
    not_md = _save(client, ctx, rel="Articles/x.txt")
    assert not_md.status_code == 400


def test_article_requires_valid_epoch(client, tmp_path):
    ctx = _open(client, tmp_path)
    client.post("/api/context/switch", json={"id": "wsA"})
    r = _save(client, ctx)
    assert r.status_code == 409


def test_article_context_isolation(client, tmp_path):
    a = _open(client, tmp_path, "wsA", "A")
    b = _open(client, tmp_path, "wsB", "B")
    assert _save(client, a, content="A 的内容", expected=0).json()["status"] == "completed"
    assert _save(client, b, content="B 的内容", expected=0).json()["status"] == "completed"
    ta = client.post("/api/context/tree", json={"context_id": "wsA", "epoch": a["epoch"]}).json()
    tb = client.post("/api/context/tree", json={"context_id": "wsB", "epoch": b["epoch"]}).json()
    assert ta["count"] == 1 and tb["count"] == 1
    assert "A 的内容" in (tmp_path / "A" / "Articles/hello.md").read_text(encoding="utf-8")
    assert "B 的内容" in (tmp_path / "B" / "Articles/hello.md").read_text(encoding="utf-8")


def test_global_endpoints_unaffected(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/tree").status_code == 200


def test_context_write_preserves_frontmatter_meta(client):
    """T9/T12：上下文写入与旧链 PUT 一致——保留既有 frontmatter 元信息（title/tags）。"""
    ws = client.app.state.workspace_root
    created = client.post("/api/articles", json={"title": "merge-demo", "content": "---\ntitle: merge-demo\ntags: [x]\n---\n\n旧正文\n"})
    assert created.status_code == 201
    rel = created.json()["path"]
    opened = client.post("/api/context/open", json={"id": "ke-merge", "root": str(ws)})
    if opened.status_code == 409:
        opened = client.post("/api/context/switch", json={"id": "ke-merge"})
    assert opened.status_code == 200
    ctx = opened.json()
    snap = client.post("/api/context/snapshot", json={"context_id": ctx["id"], "epoch": ctx["epoch"], "rel_path": rel})
    assert snap.status_code == 200
    rev = snap.json()["revision"]
    wrote = client.post("/api/context/write", json={
        "context_id": ctx["id"], "epoch": ctx["epoch"], "rel_path": rel,
        "content": "只写正文（不带 frontmatter）\n", "expected_revision": rev,
    })
    assert wrote.status_code == 200, wrote.text
    assert wrote.json()["status"] == "completed"
    raw = (ws / rel).read_text(encoding="utf-8")
    assert "title: merge-demo" in raw        # 元信息保留
    assert "tags:" in raw
    assert "只写正文" in raw                   # 正文更新
