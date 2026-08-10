"""Phase 3E.4 导入安全性测试。

每个失败场景验证四件事：
- workspace 内容保持不变（Articles/ 与 Attachments/ 文件集合不变）；
- 不产生孤儿文件（临时导入区被清理）；
- 不产生错误索引（SQLite files 行数不变）；
- 失败以 4xx/5xx 返回（复制失败在 TestClient 下向上抛出原始异常）。
"""
from __future__ import annotations

import io
import sqlite3
import zipfile
from pathlib import Path

import pytest


def _workspace_snapshot(root: Path) -> list[str]:
    """Articles/ 与 Attachments/ 下所有文件相对路径（workspace 内容快照）。"""
    files: list[str] = []
    for sub in ("Articles", "Attachments"):
        d = root / sub
        if d.is_dir():
            files += [p.relative_to(root).as_posix() for p in d.rglob("*") if p.is_file()]
    return sorted(files)


def _tmp_imports(root: Path) -> list[str]:
    """当前残留的临时导入目录名（应为空）。"""
    d = root / ".knowledgeeditor/tmp"
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir() if p.name.startswith("import_"))


def _index_count(root: Path) -> int:
    with sqlite3.connect(root / ".knowledgeeditor/index.db") as conn:
        return conn.execute("SELECT count(*) FROM files").fetchone()[0]


def _zip_of(entries: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    buf.seek(0)
    return buf.getvalue()


def _post(client, url: str, pkg: bytes) -> object:
    return client.post(url, files={"file": ("pkg.zip", pkg, "application/zip")})


def test_import_markdown_corrupted_encoding(client):
    """Markdown 损坏（非 UTF-8）：拒绝导入，workspace / 索引 / 临时区均无残留。"""
    ws = Path(client.app.state.workspace_root)
    before, count = _workspace_snapshot(ws), _index_count(ws)

    r = client.post(
        "/api/import/markdown",
        files={"file": ("bad.md", "中文".encode("utf-16"), "text/markdown")},
    )
    assert r.status_code == 400
    assert _workspace_snapshot(ws) == before
    assert _tmp_imports(ws) == []
    assert _index_count(ws) == count


def test_import_package_bad_ke_json(client):
    """ke-* 节点 JSON 损坏：校验失败，不触碰 workspace。"""
    ws = Path(client.app.state.workspace_root)
    before, count = _workspace_snapshot(ws), _index_count(ws)

    pkg = _zip_of({"pkg_export/pkg.md": "# 坏节点\n\n<!-- ke-note: {bad json} -->\n"})
    r = _post(client, "/api/import/package", pkg)
    assert r.status_code == 400
    assert "ke-*" in r.json()["detail"]
    assert _workspace_snapshot(ws) == before
    assert _tmp_imports(ws) == []
    assert _index_count(ws) == count


def test_import_package_missing_attachment(client):
    """md 引用包内缺失的附件：校验失败。"""
    ws = Path(client.app.state.workspace_root)
    before, count = _workspace_snapshot(ws), _index_count(ws)

    pkg = _zip_of({"pkg_export/pkg.md": "# 缺附件\n\n![图](Attachments/images/ghost.png)\n"})
    r = _post(client, "/api/import/package", pkg)
    assert r.status_code == 400
    assert "缺失" in r.json()["detail"]
    assert _workspace_snapshot(ws) == before
    assert _tmp_imports(ws) == []
    assert _index_count(ws) == count


def test_import_package_illegal_ref(client):
    """附件引用路径穿越（..）：校验失败。"""
    ws = Path(client.app.state.workspace_root)
    before, count = _workspace_snapshot(ws), _index_count(ws)

    pkg = _zip_of(
        {
            "pkg_export/pkg.md": "# 穿越\n\n![图](Attachments/../../Articles/secret.md)\n",
            "pkg_export/Attachments/images/ok.png": b"OK",
        }
    )
    r = _post(client, "/api/import/package", pkg)
    assert r.status_code == 400
    assert "非法附件引用" in r.json()["detail"]
    assert _workspace_snapshot(ws) == before
    assert _tmp_imports(ws) == []
    assert _index_count(ws) == count


def test_import_package_copy_failure_rolls_back(client, monkeypatch):
    """staging 复制失败：未写入任何目标，workspace / 索引不变，临时区清理。"""
    import app.routers.import_export as ie

    ws = Path(client.app.state.workspace_root)
    before, count = _workspace_snapshot(ws), _index_count(ws)

    def boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(ie.shutil, "copyfile", boom)

    pkg = _zip_of(
        {
            "pkg_export/pkg.md": "# 复制失败\n\n![图](Attachments/images/a.png)\n",
            "pkg_export/Attachments/images/a.png": b"AAA",
        }
    )
    with pytest.raises(OSError):  # TestClient(raise_server_exceptions=True) 向上抛出
        _post(client, "/api/import/package", pkg)

    assert _workspace_snapshot(ws) == before
    assert _tmp_imports(ws) == []
    assert _index_count(ws) == count


def test_import_package_conflict_failure(client, monkeypatch):
    """附件冲突处理失败（唯一名 50 次全冲突）：409，workspace 不变。"""
    import app.routers.import_export as ie

    ws = Path(client.app.state.workspace_root)
    (ws / "Attachments/images").mkdir(parents=True, exist_ok=True)
    (ws / "Attachments/images/exist.png").write_bytes(b"OLD")
    (ws / "Attachments/images/exist-abc123.png").write_bytes(b"TAKEN")
    client.app.state.indexer.update_file("Attachments/images/exist.png")
    client.app.state.indexer.update_file("Attachments/images/exist-abc123.png")

    before, count = _workspace_snapshot(ws), _index_count(ws)

    # 固定随机后缀 → 唯一名候选永远命中 exist-abc123.png → 50 次全冲突
    monkeypatch.setattr(ie.secrets, "token_hex", lambda n: "abc123")

    pkg = _zip_of(
        {
            "pkg_export/pkg.md": "# 冲突\n\n![图](Attachments/images/exist.png)\n",
            "pkg_export/Attachments/images/exist.png": b"NEW-CONTENT",
        }
    )
    r = _post(client, "/api/import/package", pkg)
    assert r.status_code == 409
    assert "冲突处理失败" in r.json()["detail"]
    assert _workspace_snapshot(ws) == before
    assert _tmp_imports(ws) == []
    assert _index_count(ws) == count


def test_import_package_success_cleans_tmp_and_indexes(client):
    """正向：导入成功后临时区同样被清理，索引仅增加文章 + 附件各一条。"""
    ws = Path(client.app.state.workspace_root)
    count_before = _index_count(ws)

    pkg = _zip_of(
        {
            "pkg_export/pkg.md": "# 成功文档\n\n![图](Attachments/images/a.png)\n",
            "pkg_export/Attachments/images/a.png": b"AAA",
        }
    )
    r = _post(client, "/api/import/package", pkg)
    assert r.status_code == 201
    art = r.json()["id"]

    assert _tmp_imports(ws) == []
    assert _index_count(ws) == count_before + 2  # 文章 + 附件
    snapshot = _workspace_snapshot(ws)
    assert art in snapshot
    assert "Attachments/images/a.png" in snapshot
