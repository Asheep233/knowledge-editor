"""Phase 5 模块系统测试。

覆盖验收项：
1. 模块创建（fs /doc 在 Modules 下建普通 Markdown 文件）
2. 模块编辑（双击打开后经文章 API 读取/保存）
3. 模块列表与读取（含子目录分类、多种路径写法）
4. 独立性（插入后模块与文章互不影响）
5. 附件（Attachments/ 相对路径插入后仍有效、不产生重复附件）
6. 复杂内容（公式/信息块/图片/视频/表格/代码块）
"""
from __future__ import annotations

from pathlib import Path


def _fs_path(client, rel: str) -> Path:
    return Path(client.app.state.workspace_root) / rel


def _write(client, rel: str, content: str) -> None:
    p = _fs_path(client, rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def _read(client, rel: str) -> str:
    return _fs_path(client, rel).read_text(encoding="utf-8")


def _mk_article(client, title: str, content: str) -> str:
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- 1. 模块创建 ----------

def test_create_module_via_fs_doc(client):
    """5.2：Modules/ 顶层创建模块；内容为普通 Markdown；文件树与索引一致。"""
    r = client.post("/api/fs/doc", json={"title": "定义", "dir": "Modules"})
    assert r.status_code == 201, r.text
    rel = r.json()["id"]
    assert rel == "Modules/定义.md"
    assert _fs_path(client, rel).exists()
    assert _read(client, rel).startswith("# 定义")  # Markdown 文件
    assert client.app.state.store.get_file(rel) is not None  # 仅索引
    assert rel in client.get("/api/tree").json()["modules"]


def test_create_module_in_subfolder(client):
    """5.6：文件夹分类（Modules/Math/...）。"""
    r = client.post("/api/fs/dir", json={"path": "Modules/Math"})
    assert r.status_code == 201
    r = client.post("/api/fs/doc", json={"title": "定理", "dir": "Modules/Math"})
    assert r.status_code == 201, r.text
    assert r.json()["id"] == "Modules/Math/定理.md"
    assert _fs_path(client, "Modules/Math/定理.md").exists()


def test_create_module_rejects_non_module_dir(client):
    """创建文档仍禁止 Modules 之外的顶层目录。"""
    r = client.post("/api/fs/doc", json={"title": "x", "dir": "Drafts"})
    assert r.status_code == 400
    r = client.post("/api/fs/doc", json={"title": "x", "dir": "Attachments"})
    assert r.status_code == 400


# ---------- 2. 模块列表与读取（子目录） ----------

def test_list_modules_nested(client):
    _write(client, "Modules/Math/Definition.md", "## 定义\n\n设 X 是集合。")
    _write(client, "Modules/Physics/Formula.md", "## 公式\n\n$E=mc^2$")
    r = client.get("/api/modules")
    assert r.status_code == 200
    paths = {m["path"] for m in r.json()["modules"]}
    assert "Modules/Math/Definition.md" in paths
    assert "Modules/Physics/Formula.md" in paths


def test_get_module_nested_variants(client):
    _write(client, "Modules/Math/Definition.md", "## 定义\n\n设 X 是集合。")
    # 完整路径（含 .md）
    r = client.get("/api/modules/Math/Definition.md")
    assert r.status_code == 200
    assert r.json()["path"] == "Modules/Math/Definition.md"
    assert r.json()["content"] == "## 定义\n\n设 X 是集合。"
    # 无 .md 后缀
    r = client.get("/api/modules/Math/Definition")
    assert r.status_code == 200
    assert r.json()["path"] == "Modules/Math/Definition.md"
    # 带 Modules/ 前缀（与 ke-module source 值一致）
    r = client.get("/api/modules/Modules/Math/Definition.md")
    assert r.status_code == 200
    assert r.json()["path"] == "Modules/Math/Definition.md"
    # 扁平旧写法（Modules/Definition.md）
    _write(client, "Modules/Flat.md", "## 扁平")
    r = client.get("/api/modules/Flat")
    assert r.status_code == 200
    assert r.json()["path"] == "Modules/Flat.md"


def test_get_module_404_and_traversal(client):
    assert client.get("/api/modules/NoSuch.md").status_code == 404
    # 目录穿越：../ 解析后逃出 Modules/ 被拒绝
    _write(client, "Articles/secret.md", "secret")
    r = client.get("/api/modules/%2e%2e/Articles/secret.md")
    assert r.status_code == 404
    assert client.get("/api/modules/%2e%2e%2f%2e%2e%2fetc%2fpasswd").status_code in (400, 404)


# ---------- 3. 模块编辑（双击打开 -> 保存） ----------

def test_module_edit_via_article_api(client):
    """5.2：模块复用文章 API 打开与保存（真实 Markdown 文件）。"""
    _write(client, "Modules/Math/Definition.md", "## 定义\n\n设 X 是集合。")
    rel = "Modules/Math/Definition.md"
    r = client.get(f"/api/articles/{rel}")
    assert r.status_code == 200
    assert "设 X 是集合" in r.json()["content"]
    r = client.put(f"/api/articles/{rel}", json={"content": "## 定义\n\n设 X 是拓扑空间。"})
    assert r.status_code == 200, r.text
    assert "拓扑空间" in _read(client, rel)
    assert client.app.state.store.get_file(rel) is not None


# ---------- 4. 独立性 ----------

def test_module_independent_from_article(client):
    """约束 2：插入 = 内容复制；模块/文章修改互不影响。"""
    _write(client, "Modules/Math/Definition.md", "## 定义\n\n设 X 是集合。")
    article_md = (
        "原正文\n\n"
        '<!-- ke-module: {"source":"Modules/Math/Definition.md"} -->\n\n'
        "## 定义\n\n设 X 是集合。\n"
    )
    rel = _mk_article(client, "插入测试", article_md)
    # 修改模块：文章不变
    _write(client, "Modules/Math/Definition.md", "## 定义\n\n设 X 是新的集合。（已修改）")
    saved = _read(client, rel)
    assert "设 X 是集合。" in saved
    assert "已修改" not in saved
    # 修改文章：模块不变
    client.put(f"/api/articles/{rel}", json={"content": "文章被修改。"})
    assert "已修改" in _read(client, "Modules/Math/Definition.md")
    assert "文章被修改" not in _read(client, "Modules/Math/Definition.md")


def test_delete_module_keeps_article(client):
    """约束：删除模块文件后，已插入文章内容仍然完整。"""
    _write(client, "Modules/Math/Definition.md", "## 定义\n\n设 X 是集合。")
    article_md = "<!-- ke-module: {\"source\":\"Modules/Math/Definition.md\"} -->\n\n## 定义\n\n设 X 是集合。"
    rel = _mk_article(client, "删除模块后", article_md)
    r = client.delete(f"/api/articles/Modules/Math/Definition.md")
    assert r.status_code == 204
    assert not _fs_path(client, "Modules/Math/Definition.md").exists()
    assert "设 X 是集合。" in _read(client, rel)


# ---------- 5. 附件 ----------

def test_module_attachment_refs(client):
    """约束 4：Attachments/ 相对路径插入后仍有效；不复制附件文件。"""
    module_md = (
        "## 架构图\n\n"
        "![架构](Attachments/images/arch.png)\n\n"
        '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4"} -->\n'
    )
    _write(client, "Modules/Math/Diagram.md", module_md)
    _write(client, "Attachments/images/arch.png", "fake-png")
    _write(client, "Attachments/videos/demo.mp4", "fake-mp4")
    before = len(list(_fs_path(client, "Attachments").rglob("*")))
    rel = _mk_article(
        client,
        "附件模块",
        '<!-- ke-module: {"source":"Modules/Math/Diagram.md"} -->\n\n' + module_md,
    )
    saved = _read(client, rel)
    assert "Attachments/images/arch.png" in saved
    assert "Attachments/videos/demo.mp4" in saved
    after = len(list(_fs_path(client, "Attachments").rglob("*")))
    assert after == before  # 不产生重复附件


# ---------- 6. 复杂内容 ----------

def test_module_complex_content(client):
    """5.4：公式/信息块/图片/视频/表格/代码块全部保留。"""
    module_md = "\n".join(
        [
            "## 公式",
            "",
            "$$E = mc^2$$",
            "",
            '<!-- ke-note: {"kind":"note","id":"n1","title":"定理","color":"yellow"} -->',
            "",
            "定理内容。",
            "",
            "![图](Attachments/images/x.png)",
            "",
            '<!-- ke-video: {"kind":"video","id":"v2","src":"Attachments/videos/v.mp4","title":"演示"} -->',
            "",
            "| A | B |",
            "| --- | --- |",
            "| 1 | 2 |",
            "",
            "```python",
            "print(1)",
            "```",
        ]
    )
    _write(client, "Modules/Physics/Note.md", module_md)
    _write(client, "Attachments/images/x.png", "png")
    _write(client, "Attachments/videos/v.mp4", "mp4")
    r = client.get("/api/modules/Physics/Note.md")
    assert r.status_code == 200
    body = r.json()["content"]
    for token in ["$$E = mc^2$$", "ke-note", "Attachments/images/x.png", "ke-video", "| A | B |", "```python"]:
        assert token in body
    # 插入后：文章文件保留完整内容
    rel = _mk_article(
        client,
        "复杂内容",
        '<!-- ke-module: {"source":"Modules/Physics/Note.md"} -->\n\n' + body,
    )
    saved = _read(client, rel)
    for token in ["$$E = mc^2$$", "ke-note", "ke-video", "| A | B |", "print(1)"]:
        assert token in saved


# ---------- 模块管理（文件树能力复用） ----------

def test_module_rename_move_delete(client):
    """5.2：模块支持重命名 / 移动 / 删除（复用 Phase 4 文件树能力）。"""
    _write(client, "Modules/Math/Definition.md", "## 定义")
    # 重命名
    r = client.put("/api/fs/doc", json={"path": "Modules/Math/Definition.md", "new_name": "Def.md"})
    assert r.status_code == 200, r.text
    assert _fs_path(client, "Modules/Math/Def.md").exists()
    # 移动（同顶层内）
    client.post("/api/fs/dir", json={"path": "Modules/Physics"})
    r = client.post("/api/fs/move", json={"src": "Modules/Math/Def.md", "dst": "Modules/Physics/Def.md"})
    assert r.status_code == 200, r.text
    assert _fs_path(client, "Modules/Physics/Def.md").exists()
    # 删除
    r = client.delete("/api/articles/Modules/Physics/Def.md")
    assert r.status_code == 204
    assert not _fs_path(client, "Modules/Physics/Def.md").exists()
