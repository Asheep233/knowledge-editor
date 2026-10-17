"""BE-01 / M-1 / M-6 回归：工作区链接布局与端点路径归属。

背景（2026-10-17 两份独立审查）：
- 61sol BE-01：打开含 junction 的工作区（`.knowledgeeditor` / `Articles` 指向
  工作区外）时，`ensure_workspace_structure` 先 mkdir 后写 settings/索引 →
  覆盖工作区外既有文件、把区外文档读进索引、创建文章写到区外。
- 41F M-1：工作区内 symlink（`Articles/x.md -> ../.knowledgeeditor/settings.json`）
  可让文档/附件端点读取、改写、删除受保护文件（字符串白名单挡不住 resolve）。
- 41F M-6：`index.db` 是目录等非普通文件时启动崩溃 / 打开工作区 500。

修复口径：激活前校验托管目录/关键文件（拒绝链接与越界）；端点路径改为
「resolve 后按业务顶层白名单判定」；索引路径异常映射为可读 409。
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from app.services import markdown_io
from app.services.workspace import UnsafeWorkspaceError, ensure_workspace_structure


# ---------- 链接构造辅助（Windows junction 无需管理员权限） ----------

def _make_dir_link(link: Path, target: Path) -> None:
    """创建目录链接：Windows 用 junction，POSIX 用 symlink；不可用则跳过。"""
    link.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:  # pragma: no cover - 受限环境
            pytest.skip(f"无法创建 junction：{result.stderr.strip()}")
    else:
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError as exc:  # pragma: no cover - 受限环境
            pytest.skip(f"无法创建目录符号链接：{exc}")


def _make_file_link(link: Path, target: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        link.symlink_to(target)
    except OSError as exc:  # pragma: no cover - Windows 需开发者模式/管理员
        pytest.skip(f"无法创建文件符号链接：{exc}")


# ---------- M-1：端点 resolve 后必须仍在业务顶层 ----------

def test_article_symlink_to_protected_settings_rejected(client, ws_root):
    settings = ws_root / ".knowledgeeditor" / "settings.json"
    assert settings.is_file()
    original = settings.read_text(encoding="utf-8")
    _make_file_link(ws_root / "Articles" / "leak.md", settings)

    assert client.get("/api/articles/Articles/leak.md").status_code == 400
    r = client.put(
        "/api/articles/Articles/leak.md",
        json={"content": "# PWNED\n"},
    )
    assert r.status_code == 400, r.text
    assert client.delete("/api/articles/Articles/leak.md").status_code == 400
    # 受保护文件必须原样未动
    assert settings.read_text(encoding="utf-8") == original


def test_attachment_symlink_to_protected_settings_rejected(client, ws_root):
    settings = ws_root / ".knowledgeeditor" / "settings.json"
    original = settings.read_text(encoding="utf-8")
    _make_file_link(ws_root / "Attachments" / "images" / "leak.png", settings)

    rel = "Attachments/images/leak.png"
    assert client.get(f"/api/attachments/{rel}").status_code == 400
    assert client.delete(f"/api/attachments/{rel}").status_code == 400
    assert settings.read_text(encoding="utf-8") == original


def test_safe_rel_path_allowed_tops(ws_root):
    settings = ws_root / ".knowledgeeditor" / "settings.json"
    _make_file_link(ws_root / "Articles" / "unit-leak.md", settings)
    assert (
        markdown_io.safe_rel_path(
            ws_root, "Articles/unit-leak.md", allowed_tops=markdown_io.DOC_TOPS
        )
        is None
    )
    ok = ws_root / "Articles" / "ok.md"
    ok.write_text("# ok\n", encoding="utf-8")
    assert (
        markdown_io.safe_rel_path(ws_root, "Articles/ok.md", allowed_tops=markdown_io.DOC_TOPS)
        is not None
    )
    # 未传 allowed_tops 时保持旧的「只校验包含性」语义（索引/文件树等全库操作）
    assert markdown_io.safe_rel_path(ws_root, "Attachments") is not None


def test_normal_article_still_accessible(client, ws_root):
    doc = ws_root / "Articles" / "normal.md"
    doc.write_text("---\ntitle: 正常\n---\n\n正文\n", encoding="utf-8")
    r = client.get("/api/articles/Articles/normal.md")
    assert r.status_code == 200, r.text


# ---------- BE-01：激活前拒绝链接布局（先于任何 mkdir/写盘） ----------

def test_ensure_structure_rejects_linked_internal_dir(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "keep.txt"
    sentinel.write_text("USER-FILE", encoding="utf-8")
    ws = tmp_path / "ws-linked"
    ws.mkdir()
    _make_dir_link(ws / ".knowledgeeditor", outside)

    with pytest.raises(UnsafeWorkspaceError):
        ensure_workspace_structure(ws)
    # 区外文件未被改写，区外也未生成 settings.json
    assert sentinel.read_text(encoding="utf-8") == "USER-FILE"
    assert not (outside / "settings.json").exists()


def test_open_workspace_with_linked_internal_dir_409(client, tmp_path):
    outside = tmp_path / "outside-2"
    outside.mkdir()
    sentinel = outside / "index.db"
    payload = b"IMPORTANT-OUTSIDE-USER-FILE-DO-NOT-OVERWRITE"
    sentinel.write_bytes(payload)
    ws = tmp_path / "ws-linked-2"
    ws.mkdir()
    _make_dir_link(ws / ".knowledgeeditor", outside)

    r = client.post("/api/workspace/open", json={"path": str(ws)})
    assert r.status_code == 409, r.text
    assert sentinel.read_bytes() == payload
    assert not (outside / "settings.json").exists()


def test_open_workspace_with_linked_articles_dir_409(client, tmp_path):
    outside = tmp_path / "outside-docs"
    outside.mkdir()
    doc = outside / "outside.md"
    doc.write_text("---\ntitle: 外部\n---\n\nOUTSIDE\n", encoding="utf-8")
    ws = tmp_path / "ws-linked-3"
    ws.mkdir()
    _make_dir_link(ws / "Articles", outside)

    r = client.post("/api/workspace/open", json={"path": str(ws)})
    assert r.status_code == 409, r.text
    assert doc.read_text(encoding="utf-8").endswith("OUTSIDE\n")
    # 不得在区外创建任何东西（旧实现会把 index/settings 或新文档写到区外）
    assert sorted(p.name for p in outside.iterdir()) == ["outside.md"]


# ---------- M-6：索引路径异常 → 可读 409 而非崩溃 ----------

def test_index_db_directory_rejected(client, tmp_path):
    ws = ensure_workspace_structure(tmp_path / "ws-bad-index")
    internal = ws / ".knowledgeeditor"
    db = internal / "index.db"
    if db.exists():
        db.unlink()
    db.mkdir()
    try:
        r = client.post("/api/workspace/open", json={"path": str(ws)})
        assert r.status_code == 409, r.text
        assert "索引" in r.json()["detail"]
    finally:
        db.rmdir()


def test_index_db_symlink_rejected(client, tmp_path):
    ws = ensure_workspace_structure(tmp_path / "ws-linked-index")
    outside = tmp_path / "outside-index"
    outside.mkdir()
    sentinel = outside / "real.db"
    sentinel.write_bytes(b"NOT-AN-INDEX")
    internal = ws / ".knowledgeeditor"
    db = internal / "index.db"
    if db.exists():
        db.unlink()
    _make_file_link(db, sentinel)

    r = client.post("/api/workspace/open", json={"path": str(ws)})
    assert r.status_code == 409, r.text
    assert sentinel.read_bytes() == b"NOT-AN-INDEX"


# ---------- 正常路径回归 ----------

def test_normal_workspace_open_still_works(client, tmp_path):
    ws = ensure_workspace_structure(tmp_path / "ws-ok")
    r = client.post("/api/workspace/open", json={"path": str(ws)})
    assert r.status_code == 200, r.text
    assert r.json()["open"] is True


def test_indexer_skips_linked_scan_dir(tmp_path):
    from app.services.indexer import WorkspaceIndexer
    from app.store.db import IndexStore

    outside = tmp_path / "outside-scan"
    outside.mkdir()
    (outside / "x.md").write_text("---\ntitle: X\n---\n\nOUTSIDE\n", encoding="utf-8")
    ws = tmp_path / "ws-scan"
    ws.mkdir()
    _make_dir_link(ws / "Articles", outside)

    store = IndexStore(tmp_path / "idx-scan" / "index.db").connect()
    try:
        indexer = WorkspaceIndexer(store, ws)
        counts = indexer.rebuild()
    finally:
        store.close()
    assert counts["document"] == 0
    # 区外文档未被读取/改写
    assert (outside / "x.md").read_text(encoding="utf-8").endswith("OUTSIDE\n")
