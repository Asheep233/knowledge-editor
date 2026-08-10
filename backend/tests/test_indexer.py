"""索引器与原子写入单元测试。"""
from __future__ import annotations

from app.services import markdown_io


def test_rebuild_counts(ws_root, indexer):
    (ws_root / "Articles" / "a.md").write_text("# A\n\n内容 alpha", encoding="utf-8")
    (ws_root / "Modules" / "m.md").write_text("模块内容", encoding="utf-8")
    (ws_root / "Attachments" / "images" / "x.png").write_bytes(b"png")
    stats = indexer.rebuild()
    assert stats["document"] == 1
    assert stats["module"] == 1
    assert stats["attachment"] == 1


def test_search_chinese_substring(indexer, ws_root, store):
    (ws_root / "Articles" / "昆仑.md").write_text(
        "# 昆仑山脉\n\n海拔很高，风景壮丽。", encoding="utf-8"
    )
    indexer.rebuild()
    res = store.search("昆仑")
    assert len(res) >= 1
    assert res[0]["rel_path"] == "Articles/昆仑.md"
    # 子串匹配（trigram）
    res2 = store.search("风景壮")
    assert len(res2) >= 1


def test_slugify():
    assert markdown_io.slugify("Hello World") == "hello-world"
    assert markdown_io.slugify("我的第一篇文章") == "我的第一篇文章"
    assert markdown_io.slugify("a/b:c*d") == "a-b-c-d"


def test_atomic_write_overwrites_cleanly(ws_root):
    p = ws_root / "Articles" / "x.md"
    markdown_io.atomic_write(p, "v1")
    markdown_io.atomic_write(p, "v2")
    assert p.read_text(encoding="utf-8") == "v2"
    # 不应残留临时文件
    assert not list((p.parent).glob(".tmp-*"))


def test_frontmatter_parse():
    content = '---\ntitle: "我的标题"\ntags: [a, b]\n---\n正文'
    meta, body = markdown_io.parse_frontmatter(content)
    assert meta["title"] == "我的标题"
    assert body.strip() == "正文"
