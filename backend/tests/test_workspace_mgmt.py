"""Phase 4.1 Workspace 管理测试：创建 / 打开 / 关闭 / 最近 / 恢复。"""
from __future__ import annotations

import os
import tempfile

import pytest

from app.services.app_config import AppConfig
from app.services.workspace import ensure_workspace_structure


@pytest.fixture()
def paused_watcher(client):
    """暂停后台轮询线程，测试手动 sniff 保证确定性。"""
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _restore_default(client, default_ws_root):
    r = client.post("/api/workspace/open", json={"path": default_ws_root})
    assert r.status_code == 200


def test_create_workspace_structure_and_current(client, tmp_path, default_ws_root):
    ws = tmp_path / "my-ws"
    r = client.post("/api/workspace/create", json={"path": str(ws)})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["open"] is True
    assert str(ws.resolve()) == body["root"]
    for sub in ("Articles", "Modules", "Attachments/images", "Attachments/videos",
                "Attachments/files", ".knowledgeeditor"):
        assert (ws / sub).is_dir(), sub
    # 当前工作区已切换
    cur = client.get("/api/workspace/current").json()
    assert cur["open"] and cur["root"] == str(ws.resolve())
    # 最近记录写入软件配置文件（不写入 Markdown）
    recent = client.get("/api/workspace/recent").json()["workspaces"]
    assert any(w["path"] == str(ws.resolve()) and w["exists"] for w in recent)
    _restore_default(client, default_ws_root)


def test_create_rejects_non_empty_dir(client, tmp_path, default_ws_root):
    ws = tmp_path / "occupied"
    ws.mkdir()
    (ws / "keep.txt").write_text("x", encoding="utf-8")
    r = client.post("/api/workspace/create", json={"path": str(ws)})
    assert r.status_code == 409
    _restore_default(client, default_ws_root)


def test_open_existing_workspace_reindexes(client, tmp_path, default_ws_root):
    ws = tmp_path / "ws-b"
    ensure_workspace_structure(ws)
    (ws / "Articles" / "已有文档.md").write_text(
        "---\ntags:\n  - beta\n---\n\n# 已有文档\n\n内容。", encoding="utf-8"
    )
    r = client.post("/api/workspace/open", json={"path": str(ws)})
    assert r.status_code == 200
    # 索引已重建：文件树可见 + 标签已入索引
    tree = client.get("/api/tree").json()
    assert "Articles/已有文档.md" in tree["articles"]
    tags = client.get("/api/tags").json()["tags"]
    assert any(t["name"] == "beta" for t in tags)
    # 最近列表去重且在最前
    recent = client.get("/api/workspace/recent").json()["workspaces"]
    assert recent[0]["path"] == str(ws.resolve())
    assert recent[0]["exists"] is True
    _restore_default(client, default_ws_root)


def test_close_workspace_blocks_doc_apis(client, default_ws_root):
    r = client.post("/api/workspace/close")
    assert r.status_code == 200
    assert r.json()["open"] is False
    cur = client.get("/api/workspace/current").json()
    assert cur["open"] is False
    # 文件树 / 搜索等被守卫中间件拦截
    assert client.get("/api/tree").status_code == 409
    assert client.get("/api/search", params={"q": "x"}).status_code == 409
    # 健康检查与工作区管理仍可用
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/workspace/recent").status_code == 200
    _restore_default(client, default_ws_root)


def test_app_config_file_persists_and_reloads(tmp_path):
    """软件配置文件：损坏回退默认；保存后可重新加载（启动恢复依据）。"""
    from pathlib import Path

    cfg_path = tmp_path / "cfg" / "app_config.json"
    cfg = AppConfig(cfg_path)
    cfg.add_recent_workspace("C:/ws/one")
    cfg.add_recent_document("Articles/a.md", "文档A")
    assert cfg_path.is_file()
    # 重新加载（模拟下次启动）；add_recent_workspace 内部做了 resolve（Windows 反斜杠）
    cfg2 = AppConfig(cfg_path)
    assert cfg2.list_recent_workspaces() == [str(Path("C:/ws/one").resolve())]
    assert cfg2.list_recent_documents()[0]["rel_path"] == "Articles/a.md"
    # 损坏文件回退默认，不抛异常
    cfg_path.write_text("{broken json", encoding="utf-8")
    cfg3 = AppConfig(cfg_path)
    assert cfg3.list_recent_workspaces() == []


def test_recent_documents_dedupe_and_clear(client, tmp_path, default_ws_root):
    r = client.post("/api/workspace/recent-documents",
                    json={"rel_path": "Articles/a.md", "title": "A"})
    assert r.status_code == 201
    r = client.post("/api/workspace/recent-documents",
                    json={"rel_path": "Articles/a.md", "title": "A-新标题"})
    assert r.status_code == 201
    docs = client.get("/api/workspace/recent-documents").json()["documents"]
    assert len(docs) == 1
    assert docs[0]["title"] == "A-新标题"  # 去重并更新标题
    r = client.delete("/api/workspace/recent-documents")
    assert r.status_code == 204
    assert client.get("/api/workspace/recent-documents").json()["documents"] == []


def test_recent_workspaces_mark_missing_path(client, tmp_path, default_ws_root):
    """路径已失效的最近工作区：列表标记 exists=False，仍可单独删除。"""
    from pathlib import Path

    # 记录一个真实存在的工作区
    alive = tmp_path / "alive"
    r = client.post("/api/workspace/create", json={"path": str(alive)})
    assert r.status_code == 201

    # 记录一个随后被删除的工作区路径（模拟目录被移动/删除）
    gone = tmp_path / "gone"
    gone.mkdir()
    r = client.post("/api/workspace/create", json={"path": str(gone)})
    assert r.status_code == 201
    # 切回 alive 释放 gone 的 SQLite 连接，再删除目录（模拟外部删除）
    r = client.post("/api/workspace/open", json={"path": str(alive)})
    assert r.status_code == 200
    import shutil

    shutil.rmtree(gone)

    recent = client.get("/api/workspace/recent").json()["workspaces"]
    by_path = {w["path"]: w["exists"] for w in recent}
    assert by_path[str(alive.resolve())] is True
    assert by_path[str(gone.resolve())] is False

    # 单独删除失效条目（校验 resolve 后路径匹配）
    r = client.delete("/api/workspace/recent", params={"path": str(gone)})
    assert r.status_code == 200
    recent = client.get("/api/workspace/recent").json()["workspaces"]
    assert all(w["path"] != str(gone.resolve()) for w in recent)
    assert any(w["path"] == str(alive.resolve()) for w in recent)
    _restore_default(client, default_ws_root)


def test_open_workspace_with_corrupt_index_recovers(client, tmp_path, default_ws_root):
    """索引文件损坏（无效 SQLite 文件）时打开工作区自动丢弃重建，不阻塞服务。

    索引是派生数据（Markdown 唯一事实源）：损坏自愈而不是让整个后端启动失败。
    """
    ws = tmp_path / "ws-corrupt"
    ensure_workspace_structure(ws)
    (ws / "Articles" / "幸存文档.md").write_text(
        "---\ntags:\n  - keep\n---\n\n# 幸存\n\n内容。", encoding="utf-8"
    )
    # 写入损坏的索引文件（无效字节，connect 时即抛 sqlite3.DatabaseError）
    (ws / ".knowledgeeditor" / "index.db").write_bytes(b"NOT-A-SQLITE-DB" * 64)

    r = client.post("/api/workspace/open", json={"path": str(ws)})
    assert r.status_code == 200, r.text
    # 重建成功：文件树可见 + 标签入索引，Markdown 数据无丢失
    tree = client.get("/api/tree").json()
    assert "Articles/幸存文档.md" in tree["articles"]
    tags = client.get("/api/tags").json()["tags"]
    assert any(t["name"] == "keep" for t in tags)
    # 损坏文件已被替换为有效索引
    db_file = ws / ".knowledgeeditor" / "index.db"
    assert db_file.is_file() and db_file.stat().st_size > 0
    _restore_default(client, default_ws_root)
