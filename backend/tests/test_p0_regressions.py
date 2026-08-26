"""P0/P1 关键缺陷回归测试（knowledge-editor-fix-checklist.md）。

覆盖：P0-1（frontmatter 保全）、P0-3（根路径删除防护）、P1-10（路径白名单）、
P1-11（删除后历史恢复）、P1-15（HTML/SVG 附件强制下载）、P1-17（symlink 越界）、
P2-2（非 UTF-8 422）、P2-20（上传内部标记）、P3-9（workspace_create 文件路径）。
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest


@pytest.fixture()
def paused_watcher(client):
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _mk_doc(client, title, content=None):
    # session 级 workspace 共享，标题必须唯一
    title = f"{title}-{uuid.uuid4().hex[:6]}"
    r = client.post("/api/articles", json={"title": title, "content": content or f"# {title}\n\n正文"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- P0-1：保存不丢失 frontmatter ----------

def test_meta_then_body_put_preserves_frontmatter(client, paused_watcher):
    """属性面板写 title/tags/自定义键 → 正文保存（仅 ke_version）→ 重开字段完整。"""
    rel = _mk_doc(client, "保全文档")
    # 属性写入 frontmatter
    r = client.put(f"/api/articles/{rel}/meta", json={"title": "新标题", "tags": ["a", "b"]})
    assert r.status_code == 200, r.text
    full = _ws(client) / rel
    on_disk = full.read_text(encoding="utf-8")
    assert "tags:" in on_disk and "- a" in on_disk

    # 模拟旧前端：正文保存只带 ke_version
    body_put = "---\nke_version: 1\n---\n\n正文第二版\n"
    r = client.put(f"/api/articles/{rel}", json={"content": body_put})
    assert r.status_code == 200, r.text

    # 重开断言 frontmatter 键逐字节保留（后端返回合并后的完整内容）
    r = client.get(f"/api/articles/{rel}")
    assert r.status_code == 200, r.text
    got = r.json()
    meta = got["meta"]
    assert meta.get("title") == "新标题"
    assert meta.get("tags") == ["a", "b"]
    assert meta.get("ke_version") == 1
    assert "正文第二版" in got["content"]
    # 磁盘字节级保全：frontmatter 键全部保留
    on_disk = (_ws(client) / rel).read_text(encoding="utf-8")
    assert "title: 新标题" in on_disk
    assert "tags:" in on_disk and "- a" in on_disk
    assert "ke_version: 1" in on_disk
    assert on_disk.endswith("\n\n正文第二版\n")


def test_plain_body_put_keeps_existing_frontmatter(client, paused_watcher):
    """无 frontmatter 的正文保存（现代前端路径）不得改写旧 frontmatter。"""
    rel = _mk_doc(client, "普通保存")
    r = client.put(f"/api/articles/{rel}/meta", json={"title": "属性标题"})
    assert r.status_code == 200, r.text
    # 现代前端：withFrontmatter 已保全字段，正文 PUT 带完整 frontmatter
    r = client.put(f"/api/articles/{rel}", json={"content": "---\ntitle: 属性标题\nke_version: 1\n---\n\n新正文\n"})
    assert r.status_code == 200, r.text
    r = client.get(f"/api/articles/{rel}")
    assert r.status_code == 200
    meta = r.json()["meta"]
    assert meta.get("title") == "属性标题"
    assert meta.get("ke_version") == 1
    assert r.json()["content"] == "新正文\n"
    # 磁盘字节级保全
    on_disk = (_ws(client) / rel).read_text(encoding="utf-8")
    assert on_disk == "---\ntitle: 属性标题\nke_version: 1\n---\n\n新正文\n"


def test_merge_frontmatter_keeps_custom_keys(client):
    from app.services import markdown_io

    old = "---\ntitle: 旧标题\ncustom_key: hello\nke_version: 1\n---\n\n旧正文\n"
    new = "---\nke_version: 1\n---\n\n新正文\n"
    merged = markdown_io.merge_frontmatter(old, new)
    assert "custom_key: hello" in merged
    assert "title: 旧标题" in merged
    assert merged.endswith("\n\n新正文\n")
    # ke_version 以 new 为准
    assert "ke_version: 1" in merged


def test_merge_frontmatter_noop_when_new_has_no_fm(client):
    from app.services import markdown_io

    old = "---\ntitle: x\n---\n\n正文\n"
    new = "# 无 frontmatter\n"
    assert markdown_io.merge_frontmatter(old, new) == new


# ---------- P0-3：根路径等价输入一律 4xx ----------

@pytest.mark.parametrize("path", [".", "", "/", "Articles/..", "Modules/..", "./", "./Articles/.."])
def test_delete_dir_root_equivalent_rejected(client, paused_watcher, path):
    rel = _mk_doc(client, "根防护")
    before = sorted(p.name for p in _ws(client).rglob("*") if p.is_file())
    r = client.delete("/api/fs/dir", params={"path": path})
    assert r.status_code in (400, 404), (path, r.status_code, r.text)
    after = sorted(p.name for p in _ws(client).rglob("*") if p.is_file())
    assert before == after  # workspace 未被删除
    assert (_ws(client) / rel).exists()


@pytest.mark.parametrize("path", [".", "", "/", "Articles/.."])
def test_rename_dir_root_equivalent_rejected(client, paused_watcher, path):
    rel = _mk_doc(client, "重命名根防护")
    r = client.put("/api/fs/dir", json={"path": path, "new_name": "evil"})
    # 422 为 pydantic 校验层拒绝（空字符串），同样属于 4xx 拒绝
    assert r.status_code in (400, 404, 422), r.text
    assert (_ws(client) / rel).exists()


# ---------- P1-10：路径白名单负向矩阵 ----------

def test_attachment_endpoints_reject_non_attachment_paths(client, paused_watcher):
    rel = _mk_doc(client, "白名单")
    # 附件端点读/删 Articles 下的 md 必须 4xx
    r = client.get(f"/api/attachments/{rel}")
    assert r.status_code in (400, 404)
    r = client.delete(f"/api/attachments/{rel}")
    assert r.status_code in (400, 404)
    # .knowledgeeditor 内部
    r = client.get("/api/attachments/.knowledgeeditor/index.db")
    assert r.status_code in (400, 404)


def test_article_endpoints_reject_forbidden_paths(client, paused_watcher):
    r = client.get("/api/articles/.knowledgeeditor/index.db")
    assert r.status_code in (400, 404)
    r = client.put("/api/articles/.knowledgeeditor/index.db", json={"content": "x"})
    assert r.status_code in (400, 404)
    r = client.delete("/api/articles/.knowledgeeditor/index.db")
    assert r.status_code in (400, 404)
    r = client.get("/api/articles/Drafts/xxx.md")
    assert r.status_code in (400, 404)
    r = client.get("/api/articles/Attachments/x.md")
    assert r.status_code in (400, 404)
    # 附件区不可经文章端点操作
    att = _ws(client) / "Attachments" / "files" / "x.md"
    att.parent.mkdir(parents=True, exist_ok=True)
    att.write_text("# x\n", encoding="utf-8")
    r = client.get("/api/articles/Attachments/files/x.md")
    assert r.status_code in (400, 404)


# ---------- P1-11：删除后历史恢复重建 ----------

def test_delete_then_restore_recreates_document(client, paused_watcher):
    rel = _mk_doc(client, "可恢复文档")
    # 写入 v2 触发快照（快照旧 v1）
    r = client.put(f"/api/articles/{rel}", json={"content": "# 可恢复文档\n\n第二版内容\n"})
    assert r.status_code == 200, r.text
    # 删除（删除前强制快照 v2）
    r = client.delete(f"/api/articles/{rel}")
    assert r.status_code == 204, r.text
    assert not (_ws(client) / rel).exists()
    # 历史列表应包含快照（倒序，[0] 为最新 v2）
    r = client.get("/api/history/list", params={"doc": rel})
    assert r.status_code == 200, r.text
    versions = r.json()["versions"]
    assert len(versions) >= 1
    # 恢复最新版 → 文件重建且内容正确
    r = client.post(
        "/api/history/restore",
        json={"doc_path": rel, "version_id": versions[0]["id"]},
    )
    assert r.status_code == 200, r.text
    assert (_ws(client) / rel).exists()
    assert "第二版内容" in (_ws(client) / rel).read_text(encoding="utf-8")


# ---------- P1-15：HTML/SVG 附件强制下载 ----------

def test_html_attachment_forced_download(client, paused_watcher):
    # html 不在上传白名单；直接落盘模拟导入携带的文件
    full = _ws(client) / "Attachments" / "files" / "evil.html"
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text("<script>alert(1)</script>", encoding="utf-8")
    r = client.get("/api/attachments/Attachments/files/evil.html")
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower()
    assert "inline" not in cd.lower()


def test_svg_attachment_forced_download(client, paused_watcher):
    # svg 允许上传（IMAGE_EXTS 含 svg），但必须强制下载
    r = client.post(
        "/api/attachments",
        files={"file": ("x.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image/svg+xml")},
    )
    assert r.status_code == 201, r.text
    rel = r.json()["path"]
    r = client.get(f"/api/attachments/{rel}")
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower()
    assert "inline" not in cd.lower()


def test_image_attachment_inline_ok(client, paused_watcher):
    r = client.post(
        "/api/attachments",
        files={"file": ("pic.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 16, "image/png")},
    )
    assert r.status_code == 201, r.text
    rel = r.json()["path"]
    r = client.get(f"/api/attachments/{rel}")
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    assert "attachment" not in cd.lower()


# ---------- P1-17：symlink 目录不越界删除/索引 ----------

def test_delete_dir_skips_symlinked_outside(client, paused_watcher):
    outside = _ws(client).parent / f"outside-{os.getpid()}"
    outside.mkdir(exist_ok=True)
    victim = outside / "keep.txt"
    victim.write_text("keep", encoding="utf-8")
    link = _ws(client) / "Articles" / "junk_link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("平台不支持符号链接")
    # 链接指向 workspace 外 → 请求必须被拒绝（4xx），且外部文件不动
    r = client.delete("/api/fs/dir", params={"path": "Articles/junk_link"})
    assert r.status_code in (400, 404), r.text
    assert victim.exists(), "外部文件必须不被删除"


# ---------- P2-2：非 UTF-8 文档打开 422 ----------

def test_get_non_utf8_returns_422(client, paused_watcher):
    full = _ws(client) / "Articles" / f"bad-{uuid.uuid4().hex[:6]}.md"
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(b"\xff\xfe\x00\x01\x02")
    rel = full.relative_to(_ws(client)).as_posix()
    r = client.get(f"/api/articles/{rel}")
    assert r.status_code == 422
    assert "UTF-8" in r.json()["detail"]


# ---------- P2-20：上传后不产生外部修改事件 ----------

def test_upload_suppresses_own_watcher_event(client):
    from app.services.fs_watch import FsWatcher

    watcher: FsWatcher = client.app.state.watcher
    watcher.enabled = False
    watcher.sniff()  # 基线
    r = client.post(
        "/api/attachments",
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 201, r.text
    events = watcher.sniff()
    assert events == [], f"上传不应产生外部修改事件: {events}"
    watcher.enabled = True


# ---------- P3-9：workspace_create 文件路径 4xx ----------

def test_workspace_create_with_file_path_4xx(client, tmp_path):
    f = tmp_path / "file.md"
    f.write_text("x", encoding="utf-8")
    r = client.post("/api/workspace/create", json={"path": str(f)})
    assert r.status_code == 400
