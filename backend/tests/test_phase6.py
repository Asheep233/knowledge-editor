"""Phase 6：搜索与可靠性增强相关测试。

覆盖：
- 重建索引入口 POST /api/index/rebuild（新增/修改/删除后结果一致）
- 异常恢复：登记 -> 列表 -> 恢复写回（Markdown+索引一致）/ 丢弃清理
- 历史版本：保存产生快照 -> 列表 -> 预览 -> 恢复（Markdown+索引一致）+ 30 份修剪
- 中文搜索 / 多关键词 / 索引更新
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.history_store import HistoryStore, MAX_VERSIONS

# 让 watcher 在测试期间保持静默（与其它测试一致）
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


def _save(client, rel, content):
    r = client.put(f"/api/articles/{rel}", json={"content": content})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 6.1 重建索引入口 ----------

def test_rebuild_index_endpoint(client, paused_watcher):
    kw = "重建入口关键词"
    rel = _mk_doc(client, "重建入口", f"# 重建入口\n\n{kw} 出现于正文。")
    r = client.post("/api/index/rebuild")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["stats"]["document"] >= 1
    # 重建后搜索一致
    res = client.get("/api/search", params={"q": kw}).json()
    assert any(x["rel_path"] == rel for x in res["results"])


def test_search_index_updates_on_crud(client, paused_watcher):
    """新增可搜索 / 修改后结果更新 / 删除后结果消失。"""
    rel = _mk_doc(client, "索引更新", "旧关键词甲乙")
    res = client.get("/api/search", params={"q": "旧关键词甲乙"}).json()
    assert any(x["rel_path"] == rel for x in res["results"])
    # 修改后旧词消失、新词命中
    _save(client, rel, "全新关键词丙丁")
    old = client.get("/api/search", params={"q": "旧关键词甲乙"}).json()
    new = client.get("/api/search", params={"q": "全新关键词丙丁"}).json()
    assert all(x["rel_path"] != rel for x in old["results"])
    assert any(x["rel_path"] == rel for x in new["results"])
    # 删除后消失
    r = client.delete(f"/api/articles/{rel}")
    assert r.status_code == 204
    gone = client.get("/api/search", params={"q": "全新关键词丙丁"}).json()
    assert all(x["rel_path"] != rel for x in gone["results"])


def test_search_multi_keyword_chinese(client, paused_watcher):
    """中文多关键词搜索（FTS5 trigram，多个独立词均可在同一文档命中）。"""
    rel = _mk_doc(client, "多关键词", "# 多关键词\n\n学习笔记：量子纠缠与机器学习。")
    for kw in ("量子", "机器学习", "学习笔记"):
        res = client.get("/api/search", params={"q": kw}).json()
        assert any(x["rel_path"] == rel for x in res["results"]), kw


# ---------- 6.2 异常恢复 ----------

def _register_recovery(client, rel, content):
    r = client.post(
        "/api/drafts/recovery",
        json={"doc_path": rel, "content": content},
    )
    assert r.status_code == 201, r.text


def test_recovery_register_list_restore(client, paused_watcher):
    rel = _mk_doc(client, "恢复文档", "# 恢复文档\n\n原始内容。")
    draft_content = "# 恢复文档\n\n草稿中的未保存内容。"
    _register_recovery(client, rel, draft_content)
    # 列表可见
    items = client.get("/api/drafts/recovery").json()["items"]
    assert any(i["doc_path"] == rel for i in items)
    # 恢复：写回 Markdown + 索引一致 + 清记录
    r = client.post("/api/drafts/recovery/restore", json={"doc_path": rel})
    assert r.status_code == 200, r.text
    assert r.json()["content"] == draft_content
    doc = client.get(f"/api/articles/{rel}").json()
    assert doc["content"] == draft_content
    # 搜索索引同步
    res = client.get("/api/search", params={"q": "草稿中的未保存内容"}).json()
    assert any(x["rel_path"] == rel for x in res["results"])
    # 记录与草稿文件均已清除
    items = client.get("/api/drafts/recovery").json()["items"]
    assert all(i["doc_path"] != rel for i in items)
    ws = Path(client.app.state.workspace_root)
    draft = ws / "Drafts" / "recovery" / "恢复文档.draft.md"
    assert not draft.exists()


def test_recovery_discard_clears_record_and_draft(client, paused_watcher):
    rel = _mk_doc(client, "丢弃文档", "正文 A")
    _register_recovery(client, rel, "草稿 B")
    r = client.delete(f"/api/drafts/recovery/{rel}")
    assert r.status_code == 204
    items = client.get("/api/drafts/recovery").json()["items"]
    assert all(i["doc_path"] != rel for i in items)
    ws = Path(client.app.state.workspace_root)
    draft = ws / "Drafts" / "recovery" / "丢弃文档.draft.md"
    assert not draft.exists()
    # 原文档内容未受影响
    doc = client.get(f"/api/articles/{rel}").json()
    assert doc["content"] == "正文 A"


def test_recovery_restore_none_exists(client, paused_watcher):
    r = client.post("/api/drafts/recovery/restore", json={"doc_path": "Articles/不存在.md"})
    assert r.status_code == 404


# ---------- 6.3 历史版本 ----------

def test_history_snapshot_list_preview_restore(client, paused_watcher):
    rel = _mk_doc(client, "历史版本文档", "# v0\n\n初始。")
    # 两次保存 -> 两份快照（初始内容、v1 内容）
    _save(client, rel, "# v1\n\n第一次修改。")
    _save(client, rel, "# v2\n\n第二次修改。")
    payload = client.get("/api/history/list", params={"doc": rel}).json()
    versions = payload["versions"]
    assert len(versions) == 2, versions
    # 倒序：最新在前
    assert versions[0]["timestamp"] >= versions[1]["timestamp"]
    # 预览：最旧版本应为初始内容
    old_vid = versions[-1]["id"]
    prev = client.get(
        "/api/history/preview",
        params={"doc": rel, "version_id": old_vid},
    ).json()
    assert "# v0" in prev["content"]
    # 恢复旧版本：写回 Markdown + 索引一致
    r = client.post(
        "/api/history/restore",
        json={"doc_path": rel, "version_id": old_vid},
    )
    assert r.status_code == 200, r.text
    assert "# v0" in r.json()["content"]
    doc = client.get(f"/api/articles/{rel}").json()
    assert "# v0" in doc["content"]
    res = client.get("/api/search", params={"q": "初始"}).json()
    assert any(x["rel_path"] == rel for x in res["results"])
    # 恢复动作本身产生新快照（当前 v2 内容）
    payload = client.get("/api/history/list", params={"doc": rel}).json()
    assert len(payload["versions"]) == 3


def test_history_preview_missing_version_404(client, paused_watcher):
    rel = _mk_doc(client, "缺版本", "内容")
    r = client.get(
        "/api/history/preview",
        params={"doc": rel, "version_id": "19990101-000000"},
    )
    assert r.status_code == 404


def test_history_prune_keeps_max_versions(tmp_path):
    """快照修剪：超过 30 份时只保留最近 30 份。"""
    store = HistoryStore(tmp_path / "ws")
    rel = "Articles/prune.md"
    for i in range(MAX_VERSIONS + 5):
        store.snapshot(rel, f"版本 {i}\n")
    versions = store.list_versions(rel)
    assert len(versions) == MAX_VERSIONS
    # 最旧一份被修剪：保留的是最新的 30 份
    assert versions[-1]["timestamp"] <= versions[0]["timestamp"]
    # 读取最新一份成功
    assert store.read_version(rel, versions[0]["id"]) is not None
    # 非法 version_id 返回 None（防目录穿越）
    assert store.read_version(rel, "../../../etc/passwd") is None
