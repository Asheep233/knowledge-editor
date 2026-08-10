"""API 冒烟测试：health / workspace / article CRUD / search / attachment / 兼容性。"""
from __future__ import annotations


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["app"] == "knowledgeeditor"
    # Phase 5E：版本与启动时间（start.ps1 握手 / 前端版本一致性检查依据）
    assert isinstance(data["version"], str) and data["version"]
    assert isinstance(data["started_at"], str) and data["started_at"]
    assert data["workspace"]


def test_workspace_init_creates_by_type_attachments(client):
    r = client.post("/api/workspace/init")
    assert r.status_code == 200
    ws = __import__("pathlib").Path(r.json()["root"])
    for sub in ("Attachments/images", "Attachments/videos", "Attachments/files"):
        assert (ws / sub).is_dir()
    info = client.get("/api/workspace/info").json()
    assert "Attachments/images" in info


def test_article_crud_and_search(client):
    kw = "昆仑山脉搜索关键词"
    r = client.post(
        "/api/articles",
        json={"title": "测试文章", "content": f"# 测试文章\n\n你好世界。{kw}"},
    )
    assert r.status_code == 201
    art_id = r.json()["id"]
    assert art_id.startswith("Articles/")

    # tree 可见
    tree = client.get("/api/tree").json()
    assert art_id in tree["articles"]

    # 读取
    r = client.get(f"/api/articles/{art_id}")
    assert r.status_code == 200
    assert kw in r.json()["content"]

    # 更新
    r = client.put(f"/api/articles/{art_id}", json={"content": f"# 测试文章\n\n更新后 {kw}"})
    assert r.status_code == 200
    # v0.7.2：保存响应必须携带完整元信息，否则前端右边栏「属性」
    # 的创建/修改时间/字数/大小会被整体替换为空值显示为「—」
    saved = r.json()
    assert saved["created_at"] and saved["updated_at"]
    assert saved["size"] and saved["size"] > 0
    assert saved["word_count"] and saved["word_count"] > 0

    # FTS 搜索命中
    r = client.get("/api/search", params={"q": kw})
    assert r.status_code == 200
    assert r.json()["count"] >= 1

    # 删除
    r = client.delete(f"/api/articles/{art_id}")
    assert r.status_code == 204
    assert art_id not in client.get("/api/tree").json()["articles"]


def test_attachment_upload_classified_by_type(client):
    cases = [
        ("pic.png", b"fake-png", "image/png", "images"),
        ("clip.mp4", b"fake-mp4", "video/mp4", "videos"),
        ("doc.pdf", b"%PDF-1.4", "application/pdf", "files"),
    ]
    saved_paths = []
    for fname, data, mime, expect_cat in cases:
        r = client.post("/api/attachments", files={"file": (fname, data, mime)})
        assert r.status_code == 201
        info = r.json()
        assert info["category"] == expect_cat
        assert info["path"].startswith(f"Attachments/{expect_cat}/")
        saved_paths.append((info["path"], data))

    # 回读附件内容一致
    for rel, data in saved_paths:
        r = client.get(f"/api/attachments/{rel}")
        assert r.status_code == 200
        assert r.content == data


def test_unknown_ke_marker_preserved(client):
    """未知 ke- 标记必须原样保留在文档中（决策点 2：对第三方编辑器友好）。"""
    content = "# 文档\n\n<!-- ke-unknown-thing: {\"a\": 1} -->\n\n正文。"
    r = client.post("/api/articles", json={"title": "兼容性测试", "content": content})
    art_id = r.json()["id"]
    r = client.get(f"/api/articles/{art_id}")
    assert "ke-unknown-thing" in r.json()["content"]


def test_index_rebuild_endpoint_returns_counts(client):
    r = client.get("/api/health")
    assert r.status_code == 200
