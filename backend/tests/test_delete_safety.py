"""Phase 4.2/4.7 删除操作安全测试：不得误删 workspace 外文件、受保护目录。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# P1-16：以下用例断言 Windows 专属路径语义（盘符绝对路径），
# Linux/macOS 下 "C:/Windows" 会按相对路径解析，语义不同，跳过。
_win_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows 路径语义专属")


@pytest.fixture()
def paused_watcher(client):
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _mk_doc(client, title):
    r = client.post("/api/articles", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_delete_dir_rejects_traversal(client, paused_watcher):
    r = client.delete("/api/fs/dir", params={"path": "../outside"})
    assert r.status_code == 400


@_win_only
def test_delete_dir_rejects_absolute(client, paused_watcher):
    r = client.delete("/api/fs/dir", params={"path": "C:/Windows"})
    assert r.status_code == 400


def test_delete_dir_protects_internal(client, paused_watcher):
    r = client.delete("/api/fs/dir", params={"path": ".knowledgeeditor"})
    assert r.status_code == 400
    assert (_ws(client) / ".knowledgeeditor" / "settings.json").exists()


def test_delete_dir_protects_top_level(client, paused_watcher):
    for top in ("Articles", "Modules", "Attachments", "Drafts"):
        r = client.delete("/api/fs/dir", params={"path": top})
        assert r.status_code == 400, top
    assert (_ws(client) / "Articles").is_dir()


def test_delete_dir_recursive_removes_files_and_index(client, paused_watcher):
    client.post("/api/fs/dir", json={"path": "Articles/深层/子层"})
    rel = client.post("/api/fs/doc", json={"title": "递归删除", "dir": "Articles/深层/子层"}).json()["id"]
    assert client.app.state.store.get_file(rel) is not None
    r = client.delete("/api/fs/dir", params={"path": "Articles/深层"})
    assert r.status_code == 204
    assert not (_ws(client) / "Articles" / "深层").exists()
    assert client.app.state.store.get_file(rel) is None
    # 文件树中已消失
    tree = client.get("/api/tree").json()
    assert rel not in tree["articles"]


def test_delete_nonexistent_returns_404(client, paused_watcher):
    r = client.delete("/api/fs/dir", params={"path": "Articles/不存在"})
    assert r.status_code == 404


@_win_only
def test_safe_rel_path_blocks_traversal(client, paused_watcher):
    """安全路径解析：目录穿越 / 绝对路径 / 越界一律返回 None（Windows 语义）。"""
    from app.services import markdown_io

    root = _ws(client)
    assert markdown_io.safe_rel_path(root, "../outside.md") is None
    assert markdown_io.safe_rel_path(root, "Articles/../../x.md") is None
    assert markdown_io.safe_rel_path(root, "C:/Windows/system32") is None
    assert markdown_io.safe_rel_path(root, "/etc/passwd") is None
    assert markdown_io.safe_rel_path(root, "Articles/正常文档.md") is not None


def test_workspace_outside_file_untouched(client, tmp_path, paused_watcher):
    """删除操作只作用于 workspace 内：外部文件不受影响。"""
    outside = tmp_path / "outside.txt"
    outside.write_text("keep", encoding="utf-8")
    rel = _mk_doc(client, "安全删除")
    client.delete(f"/api/articles/{rel}")
    assert outside.read_text(encoding="utf-8") == "keep"
