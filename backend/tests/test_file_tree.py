"""Phase 4.2 文件树管理测试：文件夹/文档 增删改移动（真实文件系统 + 索引一致）。"""
from __future__ import annotations

from pathlib import Path

import pytest


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


def _fs_exists(client, rel: str) -> bool:
    return (Path(client.app.state.workspace_root) / rel).exists()


def _index_has(client, rel: str) -> bool:
    return client.app.state.store.get_file(rel) is not None


def test_folder_create_and_nested_doc(client):
    r = client.post("/api/fs/dir", json={"path": "Articles/项目/物理"})
    assert r.status_code == 201
    assert _fs_exists(client, "Articles/项目/物理")
    # 在子目录创建文档
    r = client.post("/api/fs/doc", json={"title": "力学笔记", "dir": "Articles/项目/物理"})
    assert r.status_code == 201
    rel = r.json()["id"]
    assert rel == "Articles/项目/物理/力学笔记.md"
    assert _fs_exists(client, rel)
    # 索引一致
    assert _index_has(client, rel)
    tree = client.get("/api/tree").json()
    assert rel in tree["articles"]


def test_folder_rename_and_index_move(client):
    r = client.post("/api/fs/dir", json={"path": "Articles/旧目录"})
    r = client.post("/api/fs/doc", json={"title": "重命名测试", "dir": "Articles/旧目录"})
    rel = r.json()["id"]
    r = client.put("/api/fs/dir", json={"path": "Articles/旧目录", "new_name": "新目录"})
    assert r.status_code == 200
    assert not _fs_exists(client, "Articles/旧目录")
    assert _fs_exists(client, "Articles/新目录/重命名测试.md")
    assert not _index_has(client, rel)
    assert _index_has(client, "Articles/新目录/重命名测试.md")


def test_folder_move(client):
    client.post("/api/fs/dir", json={"path": "Articles/甲"})
    client.post("/api/fs/dir", json={"path": "Articles/乙"})
    client.post("/api/fs/doc", json={"title": "移动测试", "dir": "Articles/甲"})
    r = client.post("/api/fs/move", json={"src": "Articles/甲", "dst": "Articles/乙/甲"})
    assert r.status_code == 200, r.text
    assert _fs_exists(client, "Articles/乙/甲/移动测试.md")
    assert _index_has(client, "Articles/乙/甲/移动测试.md")


def test_doc_rename(client):
    rel = _mk_doc(client, "旧文件名")
    r = client.put("/api/fs/doc", json={"path": rel, "new_name": "新文件名"})
    assert r.status_code == 200
    new_rel = r.json()["to"]
    assert new_rel == "Articles/新文件名.md"
    assert _fs_exists(client, new_rel) and not _fs_exists(client, rel)
    assert _index_has(client, new_rel) and not _index_has(client, rel)


def test_doc_move_between_folders_preserves_content(client):
    client.post("/api/fs/dir", json={"path": "Articles/来源"})
    client.post("/api/fs/dir", json={"path": "Articles/目标"})
    rel = _mk_doc(client, "内容保留", "# 内容保留\n\n重要内容 ABC")
    # 先创建到默认位置，再移动到子目录
    r = client.post("/api/fs/move", json={"src": rel, "dst": "Articles/目标/内容保留.md"})
    assert r.status_code == 200, r.text
    new_rel = r.json()["to"]
    # 只移动位置：Markdown 内容逐字节不变
    content = (Path(client.app.state.workspace_root) / new_rel).read_text(encoding="utf-8")
    assert "重要内容 ABC" in content
    # 索引已更新
    assert _index_has(client, new_rel) and not _index_has(client, rel)


def test_cross_top_level_move_forbidden(client):
    rel = _mk_doc(client, "跨界测试")
    r = client.post("/api/fs/move", json={"src": rel, "dst": "Modules/跨界测试.md"})
    assert r.status_code == 400
    assert _fs_exists(client, rel)


def test_doc_delete_and_index_cleanup(client):
    rel = _mk_doc(client, "待删除")
    r = client.delete(f"/api/articles/{rel}")
    assert r.status_code == 204
    assert not _fs_exists(client, rel)
    assert not _index_has(client, rel)
    tree = client.get("/api/tree").json()
    assert rel not in tree["articles"]


# ---------- F05：/api/fs/dir 顶层目录约束（规范化后校验） ----------

def test_create_dir_rejects_normalized_top_level_bypass(client):
    """`Articles/../evil` 规范化后落在 workspace 根，必须 400（F05 回归）。"""
    r = client.post("/api/fs/dir", json={"path": "Articles/../evil"})
    assert r.status_code == 400, r.text
    assert not _fs_exists(client, "evil")
    # 根路径等价输入同样拒绝
    r = client.post("/api/fs/dir", json={"path": "Articles/.."})
    assert r.status_code == 400, r.text


def test_create_dir_still_allows_business_subfolders(client):
    r = client.post("/api/fs/dir", json={"path": "Articles/项目/F05"})
    assert r.status_code == 201, r.text
    assert _fs_exists(client, "Articles/项目/F05")


# ---------- F01：重命名/移动迁移历史快照目录 ----------

def test_rename_doc_migrates_history_snapshots(client, paused_watcher):
    rel = _mk_doc(client, "历史迁移", "# v0\n\n初始。")
    # 两次保存 -> 至少一份旧内容快照
    _save(client, rel, "# v1\n\n第一次修改。")
    _save(client, rel, "# v2\n\n第二次修改。")
    before = client.get("/api/history/list", params={"doc": rel}).json()
    assert len(before["versions"]) >= 2, before

    r = client.put("/api/fs/doc", json={"path": rel, "new_name": "历史迁移后"})
    assert r.status_code == 200, r.text
    new_rel = r.json()["to"]

    # 新路径下历史快照可用（旧路径孤儿化修复）
    after = client.get("/api/history/list", params={"doc": new_rel}).json()
    assert len(after["versions"]) == len(before["versions"]), after
    old = client.get("/api/history/list", params={"doc": rel}).json()
    assert len(old["versions"]) == 0

    # 快照内容完整（最旧版本仍可预览）
    old_vid = after["versions"][-1]["id"]
    prev = client.get(
        "/api/history/preview", params={"doc": new_rel, "version_id": old_vid}
    ).json()
    assert "# v0" in prev["content"]


def test_move_doc_migrates_history_snapshots(client, paused_watcher):
    client.post("/api/fs/dir", json={"path": "Articles/甲"})
    client.post("/api/fs/dir", json={"path": "Articles/乙"})
    rel = _mk_doc(client, "移动历史", "# v0\n\n初始。")
    _save(client, rel, "# v1\n\n修改。")
    before = client.get("/api/history/list", params={"doc": rel}).json()
    assert len(before["versions"]) >= 1

    r = client.post("/api/fs/move", json={"src": rel, "dst": "Articles/乙/移动历史.md"})
    assert r.status_code == 200, r.text
    new_rel = r.json()["to"]
    after = client.get("/api/history/list", params={"doc": new_rel}).json()
    assert len(after["versions"]) == len(before["versions"]), after


def test_rename_folder_migrates_doc_history_snapshots(client, paused_watcher):
    client.post("/api/fs/dir", json={"path": "Articles/旧目录"})
    r = client.post("/api/fs/doc", json={"title": "目录内文档", "dir": "Articles/旧目录"})
    rel = r.json()["id"]
    _save(client, rel, "# v1\n\n修改。")
    before = client.get("/api/history/list", params={"doc": rel}).json()
    assert len(before["versions"]) >= 1

    r = client.put("/api/fs/dir", json={"path": "Articles/旧目录", "new_name": "新目录"})
    assert r.status_code == 200, r.text
    new_rel = "Articles/新目录/目录内文档.md"
    after = client.get("/api/history/list", params={"doc": new_rel}).json()
    assert len(after["versions"]) == len(before["versions"]), after
