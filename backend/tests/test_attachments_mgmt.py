"""Phase 4.7 附件管理测试：列表（类型/大小/所属文档）、孤儿检测（仅展示）。"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services import markdown_io


@pytest.fixture()
def paused_watcher(client):
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _upload(client, name: str, content: bytes):
    r = client.post(
        "/api/attachments",
        files={"file": (name, content, "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    return r.json()["path"]  # workspace 相对路径


def test_attachment_list_with_referenced_by(client, paused_watcher):
    att_rel = _upload(client, "diagram.png", b"\x89PNG\r\nfake")
    # 创建引用该附件的文档（ke-attach 与 Markdown 图片两种写法）
    md = f"<!-- ke-attach: {{\"src\": \"{att_rel}\"}} -->\n\n![图]({att_rel})\n"
    r = client.post("/api/articles", json={"title": "含附件文档", "content": md})
    doc_rel = r.json()["id"]
    # 再建一个无引用文档
    client.post("/api/articles", json={"title": "无附件文档"})
    resp = client.get("/api/attachments/list").json()
    item = next(a for a in resp["attachments"] if a["rel_path"] == att_rel)
    assert item["category"] == "images"
    assert item["size"] == len(b"\x89PNG\r\nfake")
    assert doc_rel in item["referenced_by"]  # 所属文档


def test_orphan_detection_informational_only(client, paused_watcher):
    used_rel = _upload(client, "used.png", b"used-data")
    orphan_rel = _upload(client, "orphan.pdf", b"orphan-data")
    client.post("/api/articles", json={
        "title": "引用文档",
        "content": f"![图]({used_rel})\n",
    })
    resp = client.get("/api/attachments/orphans").json()
    paths = [o["path"] for o in resp["orphans"]]
    assert orphan_rel in paths
    assert used_rel not in paths
    item = next(o for o in resp["orphans"] if o["path"] == orphan_rel)
    assert item["name"].endswith(".pdf")  # 上传按时间戳重命名
    assert item["size"] == len(b"orphan-data")
    assert "mtime" in item
    # 孤儿附件文件仍然存在（仅检测不自动删除；删除需用户显式调用 DELETE）
    assert (Path(client.app.state.workspace_root) / orphan_rel).is_file()


def test_attachment_open_endpoint(client, paused_watcher):
    att_rel = _upload(client, "notes.txt", b"hello attachment")
    r = client.get(f"/api/attachments/{att_rel}")
    assert r.status_code == 200
    assert r.content == b"hello attachment"


def test_attachment_refs_normalization(client, paused_watcher):
    """./ 前缀引用被归一化，可正确匹配所属文档。"""
    att_rel = _upload(client, "dot-prefix.png", b"png")
    with_dot = f"![图](./{att_rel})\n"
    client.post("/api/articles", json={"title": "点前缀", "content": with_dot})
    resp = client.get("/api/attachments/list").json()
    item = next(a for a in resp["attachments"] if a["rel_path"] == att_rel)
    assert len(item["referenced_by"]) >= 1
    # 单元级：网络 URL / 绝对路径不视为 workspace 附件
    md = "![网络](https://example.com/a.png)\n![绝对](C:/x.png)\n![本地](Attachments/images/ok.png)\n"
    assert markdown_io.attachment_refs_in(md) == {"Attachments/images/ok.png"}

def test_attachment_refs_title_with_brace_balanced_parse():
    """F07：ke-attach title/caption 含 `}` 时括号平衡匹配仍能提取（非贪婪截断修复）。"""
    md = (
        '<!-- ke-attach: {"kind":"attach","id":"a1","type":"file",'
        '"src":"Attachments/files/doc.pdf","title":"含}花括号的标题"} -->\n'
        '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4",'
        '"title":"caption}带括号"} -->'
    )
    refs = markdown_io.attachment_refs_in(md)
    assert "Attachments/files/doc.pdf" in refs
    assert "Attachments/videos/demo.mp4" in refs


def test_attachment_refs_malformed_json_ignored():
    """未闭合 / 非法 JSON 的 ke-attach 头标记不误提取、也不抛错。"""
    md = '<!-- ke-attach: {"kind":"attach","src":"Attachments/files/a.pdf" -->'
    assert markdown_io.attachment_refs_in(md) == set()


def test_delete_orphan_attachment(client, paused_watcher):
    """v0.6.1：孤儿附件可手动删除（仅手动、绝不自动）。"""
    orphan_rel = _upload(client, "to-delete.pdf", b"orphan-data")
    paths = [o["path"] for o in client.get("/api/attachments/orphans").json()["orphans"]]
    assert orphan_rel in paths
    # 删除成功，文件从磁盘消失
    r = client.delete(f"/api/attachments/{orphan_rel}")
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == orphan_rel
    assert not (Path(client.app.state.workspace_root) / orphan_rel).exists()
    # 再删返回 404，且已从孤儿列表消失
    assert client.delete(f"/api/attachments/{orphan_rel}").status_code == 404
    paths = [o["path"] for o in client.get("/api/attachments/orphans").json()["orphans"]]
    assert orphan_rel not in paths


def test_delete_referenced_attachment_rejected(client, paused_watcher):
    """v0.6.1：被引用附件拒绝删除（409），防止误删。"""
    used_rel = _upload(client, "used.png", b"used-data")
    # 标题需唯一：client 为 session 级共享 workspace，与 test_orphan_detection 的
    # 「引用文档」同名会导致 POST 返回 409（已存在同名文章），引用文档无法落盘。
    r = client.post("/api/articles", json={
        "title": "引用文档-删除拒绝",
        "content": f"![图]({used_rel})\n",
    })
    assert r.status_code == 201, r.text
    r = client.delete(f"/api/attachments/{used_rel}")
    assert r.status_code == 409, r.text
    assert (Path(client.app.state.workspace_root) / used_rel).is_file()


def test_delete_attachment_path_traversal(client, paused_watcher):
    """v0.6.1：删除端点防路径穿越（.. 一律拒绝）。"""
    r = client.delete("/api/attachments/..%2F..%2Fconfig.py")
    assert r.status_code in (400, 404)
