"""Phase 3E 导入导出测试：文档包导出/导入闭环、Markdown 导入、附件冲突处理。"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from app.services import markdown_io


def _mk_doc(title: str) -> str:
    """构造含全部节点类型 + 附件引用的文档（与 phase3-roundtrip 样例一致）。"""
    return "\n".join(
        [
            f"---",
            f"ke_version: 1",
            f"---",
            "",
            f"# {title}",
            "",
            "这是**粗体**、*斜体* 与 [链接](https://example.com)。",
            "",
            "- 无序项一",
            "- 无序项二",
            "",
            "| 列A | 列B |",
            "| --- | --- |",
            "| 值1 | 值2 |",
            "",
            "行内公式 $E=mc^2$，块级公式：",
            "",
            "$$",
            "\\int_0^1 x \\, dx",
            "$$",
            "",
            "![图片说明](Attachments/images/img.png)",
            "",
            '<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"Attachments/files/doc.pdf","title":"文档"} -->',
            "",
            '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4","title":"演示"} -->',
            "",
            '<!-- ke-module: {"kind":"module","id":"m1","name":"步骤","params":{"a":1}} -->',
            "",
            '脚注引用<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->在此。',
            "",
            '<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"yellow","content":"重要内容"} -->',
            "",
            "```ts",
            "const a = 1",
            "```",
            "",
            '<!-- ke-futureblock: {"future":true} -->',
            "",
            "<!-- ke-footnotes:start -->",
            '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"脚注内容"} -->',
            "<!-- ke-footnotes:end -->",
            "",
        ]
    )


def _upload_attachment(client, name: str, data: bytes, mime: str) -> str:
    r = client.post("/api/attachments", files={"file": (name, data, mime)})
    assert r.status_code == 201
    return r.json()["path"]


def test_export_package_zip_structure(client):
    """导出包：md 在包根、附件按 workspace 相对路径归档、引用路径不变。"""
    title = "导出结构测试"
    md = _mk_doc(title)
    refs = [
        _upload_attachment(client, "img.png", b"png-data", "image/png"),
        _upload_attachment(client, "demo.mp4", b"mp4-data", "video/mp4"),
        _upload_attachment(client, "doc.pdf", b"%PDF-1.4", "application/pdf"),
    ]

    r = client.post("/api/export/package", json={"title": title, "md": md, "refs": refs})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/zip")

    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        assert "导出结构测试_export/导出结构测试.md" in names
        # 附件按 workspace 相对路径归档（上传接口使用时间戳随机名，refs 为准）
        for ref in refs:
            assert f"导出结构测试_export/{ref}" in names
        # md 内容原样（引用路径不变）
        assert zf.read("导出结构测试_export/导出结构测试.md").decode("utf-8") == md
        # 附件内容一致
        assert zf.read(f"导出结构测试_export/{refs[0]}") == b"png-data"

    # 不修改 workspace 原文件
    for rel in refs:
        r = client.get(f"/api/attachments/{rel}")
        assert r.status_code == 200


def test_roundtrip_full_loop(client):
    """端到端闭环：创建 → 导出 → 移除原文档 → 导入 → 打开 → 再导出 → 零漂移。"""
    title = "闭环测试文档"
    refs = [
        _upload_attachment(client, "img.png", b"img-1", "image/png"),
        _upload_attachment(client, "doc.pdf", b"pdf-1", "application/pdf"),
        _upload_attachment(client, "demo.mp4", b"vid-1", "video/mp4"),
    ]
    # 文档引用真实上传的附件路径（导入后所有引用必须可解析）
    md = _mk_doc(title)
    md = (
        md.replace("Attachments/images/img.png", refs[0])
        .replace("Attachments/files/doc.pdf", refs[1])
        .replace("Attachments/videos/demo.mp4", refs[2])
    )
    _, md_body = markdown_io.parse_frontmatter(md)

    # 1) 创建文档
    r = client.post("/api/articles", json={"title": title, "content": md})
    assert r.status_code == 201
    art_id = r.json()["id"]

    # 2) 导出文档包
    r = client.post("/api/export/package", json={"title": title, "md": md, "refs": refs})
    assert r.status_code == 200
    pkg = r.content

    # 3) 移除原文档（附件保留在 workspace，供冲突复用分支验证）
    r = client.delete(f"/api/articles/{art_id}")
    assert r.status_code == 204

    # 4) 导入文档包
    r = client.post(
        "/api/import/package",
        files={"file": ("闭环测试文档_export.zip", pkg, "application/zip")},
    )
    assert r.status_code == 201
    info = r.json()
    new_id = info["id"]
    assert new_id.startswith("Articles/")
    # 附件冲突规则 2：内容一致 → 复用已有文件（workspace 附件未被删除）
    assert len(info["imported"]["attachments"]) == 3
    for a in info["imported"]["attachments"]:
        assert a["reused"] is True, a

    # 5) 打开恢复后的文档：内容一致
    #    get_article 剥离 frontmatter 返回正文；将正文重新包装后应与导出前的 md 完全相同（零漂移）
    r = client.get(f"/api/articles/{new_id}")
    assert r.status_code == 200
    restored = r.json()["content"]
    assert restored == md_body
    md2 = f"---\nke_version: 1\n---\n\n{restored}"
    assert md2 == md

    # 6) 附件引用可解析（引用路径未变，指向 workspace 原附件）
    for a in info["imported"]["attachments"]:
        r = client.get(f"/api/attachments/{a['to']}")
        assert r.status_code == 200
        assert restored.count(a["to"]) >= 1

    # 7) 二次导出：解压后内容与首次导出完全一致（无格式漂移）
    r = client.post(
        "/api/export/package",
        json={"title": title, "md": md2, "refs": [a["to"] for a in info["imported"]["attachments"]]},
    )
    assert r.status_code == 200

    def unzip(data: bytes) -> dict:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            return {n: zf.read(n) for n in zf.namelist()}

    first, second = unzip(pkg), unzip(r.content)
    assert set(first) == set(second)
    for name in first:
        assert first[name] == second[name], name


def test_import_markdown_preserves_remote_and_absolute_paths(client):
    """普通 Markdown 导入：网络图片与本地绝对路径保持原样；ke-* 与未知标记原样保留。"""
    md = "\n".join(
        [
            "# 导入的普通文档",
            "",
            "![远程图片](https://example.com/a.png)",
            "",
            "![本地图片](C:\\Users\\me\\Pictures\\b.png)",
            "",
            '<!-- ke-note: {"kind":"note","id":"n1","title":"要点","content":"保留"} -->',
            "",
            '<!-- ke-future-thing: {"x":1} -->',
            "",
            "正文结束。",
            "",
        ]
    )
    r = client.post(
        "/api/import/markdown",
        files={"file": ("plain.md", md.encode("utf-8"), "text/markdown")},
    )
    assert r.status_code == 201
    art_id = r.json()["id"]

    r = client.get(f"/api/articles/{art_id}")
    content = r.json()["content"]
    assert "https://example.com/a.png" in content
    assert "C:\\Users\\me\\Pictures\\b.png" in content
    assert "ke-note" in content
    assert "ke-future-thing" in content

    # 原文件（上传副本）未被修改：内容与导入时一致
    assert content == md


def test_import_package_attachment_conflicts(client):
    """附件冲突规则：无冲突原名 / 同内容复用 / 不同内容唯一名并改写引用。"""
    # 准备 workspace 已有附件：Attachments/images/exist.png（内容 A）。
    # 注意：上传接口会用时间戳随机命名，这里直接写文件模拟「目标已存在」。
    ws = Path(client.app.state.workspace_root)
    exist = ws / "Attachments/images/exist.png"
    exist.parent.mkdir(parents=True, exist_ok=True)
    exist.write_bytes(b"AAAA")
    client.app.state.indexer.update_file("Attachments/images/exist.png")

    # 构造文档包：引用 Attachments/images/exist.png
    md = "# 冲突文档\n\n![图](Attachments/images/exist.png)\n\n结束。"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("conflict_export/conflict.md", md)
        zf.writestr("conflict_export/Attachments/images/exist.png", b"BBBB")  # 内容不同
    buf.seek(0)

    r = client.post(
        "/api/import/package",
        files={"file": ("conflict_export.zip", buf.getvalue(), "application/zip")},
    )
    assert r.status_code == 201
    info = r.json()
    atts = info["imported"]["attachments"]
    assert len(atts) == 1
    a = atts[0]
    assert a["reused"] is False
    assert a["to"] != "Attachments/images/exist.png"  # 内容不同 → 唯一名
    assert a["to"].startswith("Attachments/images/exist-")

    # 引用已同步改写：旧路径消失、新路径生效且附件可访问
    content = client.get(f"/api/articles/{info['id']}").json()["content"]
    assert f"![图]({a['to']})" in content
    assert "![图](Attachments/images/exist.png)" not in content
    r = client.get(f"/api/attachments/{a['to']}")
    assert r.status_code == 200
    assert r.content == b"BBBB"

    # 复用分支：导入同一内容包（content 与 workspace 中已存在的唯一名文件一致）
    md2 = f"# 冲突文档\n\n![图]({a['to']})\n\n结束。"
    buf2 = io.BytesIO()
    with zipfile.ZipFile(buf2, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("conflict_export/conflict.md", md2)
        zf.writestr(f"conflict_export/{a['to']}", b"BBBB")
    buf2.seek(0)
    r2 = client.post(
        "/api/import/package",
        files={"file": ("conflict_export.zip", buf2.getvalue(), "application/zip")},
    )
    assert r2.status_code == 201
    a2 = r2.json()["imported"]["attachments"][0]
    assert a2["to"] == a["to"]
    assert a2["reused"] is True


def test_import_package_nested_attachments(client):
    """包内附件子目录保留到 workspace 对应类别目录下。"""
    md = "# 子目录附件\n\n![图](Attachments/images/sub/photo.png)"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("pkg_export/pkg.md", md)
        zf.writestr("pkg_export/Attachments/images/sub/photo.png", b"NESTED")
    buf.seek(0)

    r = client.post(
        "/api/import/package",
        files={"file": ("pkg.zip", buf.getvalue(), "application/zip")},
    )
    assert r.status_code == 201
    to = r.json()["imported"]["attachments"][0]["to"]
    assert to == "Attachments/images/sub/photo.png"
    r = client.get(f"/api/attachments/{to}")
    assert r.status_code == 200
    assert r.content == b"NESTED"


def test_import_package_invalid_inputs(client):
    """非法输入：非 zip、zip 内无文档 → 400。"""
    r = client.post(
        "/api/import/package",
        files={"file": ("bad.zip", b"not-a-zip", "application/zip")},
    )
    assert r.status_code == 400

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("empty_export/Attachments/images/x.png", b"x")
    buf.seek(0)
    r = client.post(
        "/api/import/package",
        files={"file": ("no-doc.zip", buf.getvalue(), "application/zip")},
    )
    assert r.status_code == 400
    assert "未找到 Markdown 文档" in r.json()["detail"]

    r = client.post(
        "/api/import/markdown",
        files={"file": ("bad.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400
