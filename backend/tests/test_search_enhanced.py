"""Phase 4.4 搜索增强测试：文件名/路径/标题/frontmatter/标签 均可命中。"""
from __future__ import annotations

import pytest


def _mk_doc(client, title, content=""):
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _hits(resp) -> list[str]:
    return [r["rel_path"] for r in resp.json()["results"]]


def test_search_by_filename(client):
    rel = _mk_doc(client, "月度规划报告")
    hits = _hits(client.get("/api/search", params={"q": "月度规划报告"}))
    assert rel in hits


def test_search_by_folder_path(client):
    client.post("/api/fs/dir", json={"path": "Articles/研究记录"})
    rel = client.post("/api/fs/doc", json={"title": "实验", "dir": "Articles/研究记录"}).json()["id"]
    # 正文与标题均不含“研究记录”，仅路径命中
    hits = _hits(client.get("/api/search", params={"q": "研究记录"}))
    assert rel in hits


def test_search_by_frontmatter_meta(client):
    rel = _mk_doc(client, "无作者词", "---\nauthor: 王小明\n---\n\n# 无作者词\n\n正文不含该词。")
    hits = _hits(client.get("/api/search", params={"q": "王小明"}))
    assert rel in hits


def test_search_by_tag(client):
    rel = _mk_doc(client, "纯标签命中", "---\ntags:\n  - quantumfield\n---\n\n# 纯标签命中\n\n正文不含 quantumfield。")
    hits = _hits(client.get("/api/search", params={"q": "quantumfield"}))
    assert rel in hits


def test_search_result_contains_snippet(client):
    _mk_doc(client, "摘要测试", "# 摘要测试\n\n目标词汇出现在这段正文里以便提取摘要。")
    resp = client.get("/api/search", params={"q": "目标词汇"}).json()
    assert resp["count"] >= 1
    # 结果含文件名与摘要字段
    for r in resp["results"]:
        assert r["rel_path"]
        assert "snippet" in r
        if r["rel_path"].startswith("Articles/摘要测试.md"):
            assert "目标词汇" in r["snippet"]


def test_short_query_fallback(client):
    rel = _mk_doc(client, "短词", "# 短词\n\nab 出现。")
    hits = _hits(client.get("/api/search", params={"q": "ab"}))
    assert rel in hits


def test_empty_query_returns_nothing(client):
    assert client.get("/api/search", params={"q": "  "}).json()["count"] == 0


def test_delete_and_rebuild_removes_search_hits(client):
    from app.services.indexer import WorkspaceIndexer
    from app.store.db import IndexStore

    rel = _mk_doc(client, "待移除", "---\ntags:\n  - remover\n---\n\n# 待移除")
    assert any(r["rel_path"] == rel for r in
               client.get("/api/search", params={"q": "remover"}).json()["results"])
    client.delete(f"/api/articles/{rel}")
    assert not any(r["rel_path"] == rel for r in
                   client.get("/api/search", params={"q": "remover"}).json()["results"])
    # 重建后仍然没有
    root = client.app.state.workspace_root
    store = IndexStore(root / ".knowledgeeditor" / "index.db").connect()
    indexer = WorkspaceIndexer(store, root)
    indexer.rebuild()
    client.app.state.store = store
    client.app.state.indexer = indexer
    assert not any(r["rel_path"] == rel for r in
                   client.get("/api/search", params={"q": "remover"}).json()["results"])
