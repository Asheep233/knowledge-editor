"""Phase 4.5 标签系统测试：解析 / 索引 / 筛选 / 列表 / frontmatter 同步。"""
from __future__ import annotations

import pytest

from app.services import markdown_io


def _mk_doc(client, title, content=""):
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- 解析 ----------

def test_parse_inline_tags():
    content = "---\nke_version: 1\ntags: [physics, \"math\"]\n---\n\nbody"
    meta, body = markdown_io.parse_frontmatter(content)
    assert meta["tags"] == ["physics", "math"]
    assert meta["ke_version"] == 1
    assert body.strip() == "body"


def test_parse_block_tags_and_ke_version_int():
    content = "---\nke_version: 1\ntags:\n  - physics\n  - math\n---\n\nbody"
    meta, _ = markdown_io.parse_frontmatter(content)
    assert meta["tags"] == ["physics", "math"]
    assert meta["ke_version"] == 1


def test_parse_tags_returns_list():
    assert markdown_io.parse_tags({"tags": ["a", "b"]}) == ["a", "b"]
    assert markdown_io.parse_tags({"tags": "x"}) == ["x"]
    assert markdown_io.parse_tags({}) == []


def test_set_meta_preserves_body_and_keys():
    content = "---\nke_version: 1\ntitle: 原题\n---\n\n# 正文\n\n保持不变"
    out = markdown_io.set_meta(content, {"tags": ["physics", "math"]})
    meta, body = markdown_io.parse_frontmatter(out)
    assert meta["ke_version"] == 1
    assert meta["title"] == "原题"
    assert meta["tags"] == ["physics", "math"]
    assert body == "# 正文\n\n保持不变"


# ---------- 索引 / 筛选 / 列表 ----------

def test_tags_indexed_and_listed(client):
    rel_phys = _mk_doc(client, "物理笔记", "---\ntags:\n  - physics\n  - math\n---\n\n# 物理笔记")
    rel_math = _mk_doc(client, "数学笔记", "---\ntags:\n  - math\n---\n\n# 数学笔记")
    _mk_doc(client, "无标签", "# 无标签")
    tags = client.get("/api/tags").json()["tags"]
    by_name = {t["name"]: t["count"] for t in tags}
    # session 共享 workspace，其他测试可能已建带 math 标签的文档，故用 >=
    assert by_name["math"] >= 2
    assert by_name["physics"] >= 1
    assert "无标签" not in by_name
    # 聚合计数与索引一致
    recs = [f for f in client.app.state.store.list_files(prefix=rel_phys)]
    assert recs and set(recs[0]["tags"]) == {"physics", "math"}
    recs = [f for f in client.app.state.store.list_files(prefix=rel_math)]
    assert recs and recs[0]["tags"] == ["math"]


def test_tag_filter_returns_exact_files(client):
    rel1 = _mk_doc(client, "物理A", "---\ntags:\n  - physics\n---\n\n# 物理A")
    rel2 = _mk_doc(client, "物理B", "---\ntags:\n  - physics\n---\n\n# 物理B")
    _mk_doc(client, "化学C", "---\ntags:\n  - chemistry\n---\n\n# 化学C")
    r = client.get("/api/tags/physics")
    assert r.status_code == 200
    files = r.json()["files"]
    rels = {f["rel_path"] for f in files}
    # 本测试创建的两篇必须命中（session 共享 workspace，其他测试也可能有 physics 标签）
    assert {rel1, rel2} <= rels
    assert r.json()["count"] >= 2


def test_tag_update_writes_frontmatter(client, tmp_path):
    from pathlib import Path

    rel = _mk_doc(client, "标签更新", "---\nke_version: 1\ntitle: 标签更新\n---\n\n# 正文")
    r = client.put(f"/api/articles/{rel}/meta",
                   json={"tags": ["physics", "quantum"]})
    assert r.status_code == 200
    # 标签必须写入 Markdown frontmatter（唯一事实源）
    full = Path(client.app.state.workspace_root) / rel
    content = full.read_text(encoding="utf-8")
    assert "physics" in content and "quantum" in content
    assert "ke_version: 1" in content
    assert "标签更新" in content  # 原 title 保留
    # 索引同步
    rec = client.app.state.store.get_file(rel)
    assert set(rec["tags"]) == {"physics", "quantum"}
    # 筛选命中
    files = client.get("/api/tags/quantum").json()["files"]
    assert any(f["rel_path"] == rel for f in files)


def test_tag_remove_from_frontmatter(client, tmp_path):
    from pathlib import Path

    rel = _mk_doc(client, "标签删除", "---\ntags:\n  - keep\n  - drop\n---\n\n# 正文")
    r = client.put(f"/api/articles/{rel}/meta", json={"tags": ["keep"]})
    assert r.status_code == 200
    content = (Path(client.app.state.workspace_root) / rel).read_text(encoding="utf-8")
    assert "drop" not in content
    assert "keep" in content
    files = client.get("/api/tags/drop").json()["files"]
    assert not any(f["rel_path"] == rel for f in files)


def test_title_update_via_meta(client, tmp_path):
    from pathlib import Path

    rel = _mk_doc(client, "原名", "# 原名")
    r = client.put(f"/api/articles/{rel}/meta", json={"title": "新标题"})
    assert r.status_code == 200
    content = (Path(client.app.state.workspace_root) / rel).read_text(encoding="utf-8")
    assert "title: 新标题" in content
    got = client.get(f"/api/articles/{rel}").json()
    assert got["title"] == "新标题"
