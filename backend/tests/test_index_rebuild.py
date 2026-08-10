"""Phase 4.4/4.5/4.6 相关：索引重建一致性（删除 SQLite 索引后重新扫描必须一致）。"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.services.indexer import WorkspaceIndexer


@pytest.fixture()
def paused_watcher(client):
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _mk_doc(client, title, content=""):
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _rebuild_from_scratch(client):
    """模拟删除 SQLite 索引文件后重新扫描重建。"""
    root = Path(client.app.state.workspace_root)
    db_path = root / ".knowledgeeditor" / "index.db"
    client.app.state.store.close()
    db_path.unlink()
    from app.store.db import IndexStore

    store = IndexStore(db_path).connect()
    indexer = WorkspaceIndexer(store, root)
    stats = indexer.rebuild()
    client.app.state.store = store
    client.app.state.indexer = indexer
    client.app.state.index_stats = stats
    return stats


def test_tags_survive_rebuild(client, paused_watcher):
    rel = _mk_doc(client, "标签重建", "---\ntags:\n  - physics\n  - math\n---\n\n# 标签重建\n\n正文")
    # 索引中已有标签
    assert "physics" in client.app.state.store.get_file(rel)["tags"]
    _rebuild_from_scratch(client)
    rec = client.app.state.store.get_file(rel)
    assert rec is not None
    assert "physics" in rec["tags"] and "math" in rec["tags"]
    tags = client.get("/api/tags").json()["tags"]
    assert any(t["name"] == "physics" and t["count"] >= 1 for t in tags)


def test_search_consistent_after_rebuild(client, paused_watcher):
    kw = "重建一致性关键词"
    rel = _mk_doc(client, "一致性", f"# 一致性\n\n{kw} 出现于正文。")
    before = client.get("/api/search", params={"q": kw}).json()
    assert before["count"] >= 1
    assert any(r["rel_path"] == rel for r in before["results"])
    _rebuild_from_scratch(client)
    after = client.get("/api/search", params={"q": kw}).json()
    assert after["count"] == before["count"]
    assert any(r["rel_path"] == rel for r in after["results"])


def test_search_results_match_by_meta_after_rebuild(client, paused_watcher):
    rel = _mk_doc(client, "元信息", "---\nauthor: 李四\n---\n\n# 元信息\n\n正文不含特殊词。")
    before = client.get("/api/search", params={"q": "李四"}).json()
    assert any(r["rel_path"] == rel for r in before["results"])
    _rebuild_from_scratch(client)
    after = client.get("/api/search", params={"q": "李四"}).json()
    assert any(r["rel_path"] == rel for r in after["results"])


def test_old_schema_db_migrates_to_fts_v2(tmp_path):
    """老库（无 meta 列 / 旧 FTS 结构）连接时自动迁移且可正常搜索。"""
    from app.store.db import IndexStore

    db = tmp_path / "old" / "index.db"
    # 构造一个 Phase 3 时代的库：旧 files 表（无 meta 列）+ 旧 files_fts(title, content)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    conn.executescript(
        """
        CREATE TABLE files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rel_path TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL DEFAULT 'document',
          title TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          content_hash TEXT NOT NULL DEFAULT '',
          size INTEGER NOT NULL DEFAULT 0
        );
        CREATE VIRTUAL TABLE files_fts USING fts5(title, content,
          content='files', content_rowid='id', tokenize='trigram');
        INSERT INTO files(rel_path, kind, title, tags, created_at, updated_at,
                          content, content_hash, size)
        VALUES('Articles/老文档.md', 'document', '老文档', '["old"]',
               '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z',
               '# 老文档', 'abc', 10);
        """
    )
    conn.commit()
    conn.close()
    # 连接触发迁移
    store = IndexStore(db).connect()
    row = store.get_file("Articles/老文档.md")
    assert row is not None and "meta" in row  # meta 列已补齐
    # 迁移后重建 FTS 结构版本
    assert store.get_setting("index_schema_version") == "2"
    store.close()
