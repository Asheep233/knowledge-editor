"""索引器与原子写入单元测试。"""
from __future__ import annotations

from app.services import markdown_io
from app.services.indexer import WorkspaceIndexer


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


# ---------- B1 / K3-I1（v1.1.2） ----------

def test_b1_same_size_same_mtime_content_change_detected(store, ws_root):
    """等长 + 强制同 mtime_ns 的内容修改，reconcile 仍须识别（hash 入签名）。"""
    import os

    p = ws_root / "Articles" / "a.md"
    p.write_text("# A\n\nAAA", encoding="utf-8")
    indexer = WorkspaceIndexer(store, ws_root)
    indexer.rebuild()
    assert "AAA" in store.get_file("Articles/a.md")["content"]

    # 等长修改 + 把 mtime_ns 拨回原值（模拟同 tick 写入的极端情形）
    p.write_text("# A\n\nBBB", encoding="utf-8")
    st = p.stat()
    p.write_text("# A\n\nBBB", encoding="utf-8")
    os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))

    indexer.reconcile()
    rec = store.get_file("Articles/a.md")
    assert rec is not None
    assert "BBB" in rec["content"], "等长同 mtime 内容变更未被识别"


def test_k3i1_incremental_update_refreshes_signature(store, ws_root, monkeypatch):
    """增量保存/移动/删除后签名同步刷新：模拟重启后 reconcile 不得退化全量重建。"""
    (ws_root / "Articles" / "a.md").write_text("# A\n\n内容1", encoding="utf-8")
    (ws_root / "Articles" / "b.md").write_text("# B\n\n初始", encoding="utf-8")
    indexer = WorkspaceIndexer(store, ws_root)
    indexer.rebuild()

    calls = []
    orig_rebuild = indexer.rebuild

    def spy(self=None):
        calls.append("rebuild")
        return orig_rebuild()

    # 1) 增量保存
    (ws_root / "Articles" / "a.md").write_text("# A\n\n内容2", encoding="utf-8")
    indexer.update_file("Articles/a.md")
    # 2) 增量移动
    (ws_root / "Articles" / "b.md").rename(ws_root / "Articles" / "b-renamed.md")
    indexer.update_move("Articles/b.md", "Articles/b-renamed.md")
    # 3) 增量删除
    (ws_root / "Articles" / "b-renamed.md").unlink()
    indexer.delete_file("Articles/b-renamed.md")

    # 模拟重启：新实例 + reconcile；签名一致时不应触发 rebuild
    indexer2 = WorkspaceIndexer(store, ws_root)
    monkeypatch.setattr(indexer2, "rebuild", spy)
    stats = indexer2.reconcile()
    assert stats["document"] == 1
    assert calls == [], f"增量更新后 reconcile 退化为全量重建: {calls}"
    assert "内容2" in store.get_file("Articles/a.md")["content"]
    assert store.get_file("Articles/b-renamed.md") is None
