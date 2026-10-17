"""二批回归：BE-06/M-2（LIKE 转义）、M-3（中文多词搜索）、M-7（case-only rename）、
L-8（坏 zip 400）、S-02（NUL 路径 4xx）。

背景（2026-10-17 两份独立审查）：
- BE-06/M-2：`list_files(prefix)` 直接把路径拼进 SQL LIKE，目录名含 `_`/`%` 时
  改名会误删兄弟目录索引（如 `a_b` 改名误删 `aXb` 整棵子树），且重启不自愈。
- M-3：FTS5 trigram 对 <3 字词元（中文两字词常见）无索引 → `公式 渲染` 恒 0 结果。
- M-7：Windows 大小写不敏感 FS 上「只改大小写」的重命名/移动被 409 拒绝/误导。
- L-8：畸形 zip（有 magic、坏中央目录/CRC）触发未捕获异常 → 500。
- S-02：NUL 路径在多个端点 500（F9c 只修了 fs 路由）。
"""
from __future__ import annotations

from pathlib import Path

import pytest


def _ws(client) -> Path:
    return client.app.state.workspace_root


def _put_file(client, rel: str, content: bytes) -> None:
    p = _ws(client) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    client.app.state.indexer.update_file(rel)


def _read(client, rel: str) -> bytes:
    return (_ws(client) / rel).read_bytes()


# ---------- BE-06 / M-2：list_files 前缀 LIKE 必须按字面匹配 ----------

def test_list_files_prefix_escapes_like_wildcards(store):
    for rel, title in (
        ("Articles/a_b/x.md", "x"),
        ("Articles/aXb/y.md", "y"),
        ("Articles/a%b/z.md", "z"),
        ("Articles/aTb/w.md", "w"),
    ):
        store.upsert_file(
            rel_path=rel,
            kind="document",
            title=title,
            content="",
            content_hash="",
            size=0,
            tags=[],
            meta={},
        )
    rows = store.list_files(prefix="Articles/a_b")
    assert {r["rel_path"] for r in rows} == {"Articles/a_b/x.md"}
    rows = store.list_files(prefix="Articles/a%b")
    assert {r["rel_path"] for r in rows} == {"Articles/a%b/z.md"}


def test_dir_rename_with_underscore_keeps_sibling_index(client):
    _put_file(
        client, "Articles/a_b/under.md",
        b"---\ntitle: under\n---\n\nUNDERTOKEN\n",
    )
    _put_file(
        client, "Articles/aXb/sibling.md",
        b"---\ntitle: sibling\n---\n\nUNRELATEDTOKEN\n",
    )
    # 兄弟目录 aXb 的索引存在
    assert client.get("/api/search", params={"q": "UNRELATEDTOKEN"}).json()["count"] >= 1

    r = client.put("/api/fs/dir", json={"path": "Articles/a_b", "new_name": "a_b2"})
    assert r.status_code == 200, r.text
    assert r.json()["to"] == "Articles/a_b2"

    # 旧缺陷：a_b 的 LIKE 通配把 aXb 的索引一并删掉 → 搜索/列表消失
    assert client.get("/api/search", params={"q": "UNRELATEDTOKEN"}).json()["count"] >= 1
    assert client.get("/api/articles/Articles/aXb/sibling.md").status_code == 200
    assert client.get("/api/articles/Articles/a_b2/under.md").status_code == 200


# ---------- M-3：中文多词搜索 ----------

def _mk_doc(client, title: str, body: str) -> str:
    r = client.post("/api/articles", json={"title": title, "content": body})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_multitoken_chinese_search_hits(client):
    _mk_doc(client, "公式渲染", "本文讨论公式的渲染问题：公式与渲染流程。")
    _mk_doc(client, "无关文档", "这里只有排版和别的内容。")

    # 含 <3 字词元（公式/渲染都是 2 字）→ 旧实现 FTS trigram 恒 0
    r = client.get("/api/search", params={"q": "公式 渲染"})
    assert r.status_code == 200, r.text
    titles = [item["title"] for item in r.json()["results"]]
    assert "公式渲染" in titles, f"多词中文搜索假阴性: {titles}"

    # 单词仍工作；不匹配的组合理应为 0（不是把所有词都当 OR）
    assert client.get("/api/search", params={"q": "公式"}).json()["count"] >= 1
    assert client.get("/api/search", params={"q": "公式 不存在的词"}).json()["count"] == 0


def test_multitoken_search_and_semantics(client):
    _mk_doc(client, "甲文档", "关键词甲 与 关键词乙 同时出现。")
    _mk_doc(client, "乙文档", "只有关键词甲。")
    hits = client.get("/api/search", params={"q": "关键词甲 关键词乙"}).json()["results"]
    titles = [item["title"] for item in hits]
    assert "甲文档" in titles
    assert "乙文档" not in titles, f"多词查询未取交集: {titles}"


# ---------- M-7：case-only rename/move ----------

def _no_case_tmp_leftovers(client, parent: str = "Articles") -> list[str]:
    return [p.name for p in (_ws(client) / parent).iterdir() if ".ke-case-" in p.name]


def test_case_only_doc_rename(client):
    created = client.post("/api/fs/doc", json={"title": "Hello", "dir": "Articles"})
    assert created.status_code == 201, created.text
    old = created.json()["path"]
    payload = b"---\ntitle: Hello\n---\n\nCONTENT-KEEP\n"
    (_ws(client) / old).write_bytes(payload)
    client.app.state.indexer.update_file(old)

    r = client.put("/api/fs/doc", json={"path": old, "new_name": "hello.md"})
    assert r.status_code == 200, r.text
    to = r.json()["to"]
    assert to == "Articles/hello.md", to
    assert _read(client, to) == payload
    assert _no_case_tmp_leftovers(client) == []


def test_case_only_dir_rename(client):
    created = client.post("/api/fs/dir", json={"path": "Articles/CaseDir"})
    assert created.status_code == 201, created.text
    r = client.put("/api/fs/dir", json={"path": "Articles/CaseDir", "new_name": "casedir"})
    assert r.status_code == 200, r.text
    assert r.json()["to"] == "Articles/casedir"
    assert _no_case_tmp_leftovers(client) == []


def test_case_only_move(client):
    created = client.post("/api/fs/doc", json={"title": "MoveMe", "dir": "Articles"})
    assert created.status_code == 201, created.text
    old = created.json()["path"]
    payload = b"---\ntitle: MoveMe\n---\n\nMOVE-CONTENT\n"
    (_ws(client) / old).write_bytes(payload)
    client.app.state.indexer.update_file(old)

    r = client.post("/api/fs/move", json={"src": old, "dst": "Articles/moveme.md"})
    assert r.status_code == 200, r.text
    assert r.json()["to"] == "Articles/moveme.md"
    assert _read(client, "Articles/moveme.md") == payload
    assert _no_case_tmp_leftovers(client) == []


# ---------- L-8：畸形 zip → 400 而非 500 ----------

def test_malformed_zip_returns_400(client):
    bad = b"PK\x03\x04" + b"\x00garbage-central-directory" * 4
    r = client.post(
        "/api/import/package",
        files={"file": ("bad.zip", bad, "application/zip")},
    )
    assert r.status_code == 400, f"畸形 zip 应 400，实际 {r.status_code}: {r.text[:200]}"


# ---------- S-02：NUL 路径 → 4xx 而非 500 ----------

@pytest.mark.parametrize(
    "url",
    [
        "/api/articles/Articles/a%00b.md",
        "/api/attachments/Attachments/images/a%00b.png",
        "/api/modules/a%00b.md",
    ],
    ids=["articles", "attachments", "modules"],
)
def test_nul_path_returns_4xx_not_500(client, url):
    r = client.get(url)
    assert r.status_code < 500, f"NUL 路径触发 5xx: {url} → {r.status_code}"
    assert r.status_code in (400, 404)
