"""BE-03 / M-4 / M-5 回归：数据完整性与并发安全。

背景（2026-10-17 两份独立审查）：
- BE-03（61sol P1）：同原路径的两个回收站条目并发恢复时，「exists 检查 →
  os.replace」各自通过、后者覆盖前者 → 两个条目都被清掉、只留一份内容。
- M-4（41F Medium）：`PUT /meta` 的 title/tags 含换行会把 frontmatter 结构
  切断（闭合定界符挤进正文），静默损坏文档。
- M-5（41F Medium）：保存时读旧内容瞬态失败（Windows 文件锁/杀软/同步盘占用）
  被当作「无旧内容」→ 整篇覆盖写，title/tags/自定义 frontmatter 永久丢失且
  返回 200。

修复口径：恢复用「工作区级锁 + 排他发布」；meta 输入显式 400 + 渲染层转义；
读失败区分 404/422/409，任何读失败都不得继续覆盖写。
"""
from __future__ import annotations

import threading

from app.services import markdown_io


# ---------- BE-03：并发恢复同原路径不互相覆盖 ----------

def test_trash_concurrent_restore_same_original_keeps_both(client):
    from app.services import trash

    root = client.app.state.workspace_root
    rel = "Articles/并发恢复.md"
    contents: list[bytes] = []
    ids: list[str] = []
    for body in (b"# A\n\nCONTENT-A\n", b"# B\n\nCONTENT-B\n"):
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
        contents.append(body)
        ids.append(trash.move_to_trash(root, rel))
    assert len(set(ids)) == 2, f"entry id 冲突: {ids}"

    results: dict[str, tuple[str, bool]] = {}
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def worker(entry_id: str) -> None:
        try:
            barrier.wait(timeout=10)
            results[entry_id] = trash.restore(root, entry_id)
        except BaseException as exc:  # noqa: BLE001 - 测试收集线程异常
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert not errors, f"恢复抛错: {errors}"
    restored = [results[i][0] for i in ids]
    assert len(set(restored)) == 2, f"并发恢复互相覆盖，只落了一份: {restored}"

    by_content = {(root / r).read_bytes(): r for r in restored}
    assert set(by_content) == set(contents), f"内容丢失/被覆盖: {by_content}"


# ---------- M-4：meta 换行注入必须 400，且结构不损坏 ----------

def test_put_meta_rejects_newline_title_and_tags(client):
    created = client.post(
        "/api/articles", json={"title": "M4", "content": "# 正文\n"}
    )
    assert created.status_code == 201, created.text
    rel = created.json()["id"]
    ws = client.app.state.workspace_root
    before = (ws / rel).read_bytes()

    r = client.put(
        f"/api/articles/{rel}/meta",
        json={"title": "good\n---\n\nINJECTED-AS-BODY"},
    )
    assert r.status_code == 400, r.text
    assert (ws / rel).read_bytes() == before, "被拒请求仍改写了磁盘"

    r = client.put(
        f"/api/articles/{rel}/meta",
        json={"tags": ["正常", "bad\n---\nINJECTED"]},
    )
    assert r.status_code == 400, r.text
    assert (ws / rel).read_bytes() == before

    # 正常更新仍可用
    r = client.put(
        f"/api/articles/{rel}/meta", json={"title": "正常标题", "tags": ["数学"]}
    )
    assert r.status_code == 200, r.text
    meta, body = markdown_io.parse_frontmatter((ws / rel).read_bytes().decode("utf-8"))
    assert meta.get("title") == "正常标题"
    assert "INJECTED" not in body


def test_set_meta_escapes_newline_scalar():
    content = "---\ntitle: 旧标题\n---\n\n正文内容\n"
    out = markdown_io.set_meta(content, {"title": "good\n---\n\nINJECTED"})
    # 结构不损坏：仍只有一个 frontmatter 块，正文不被注入
    _meta, body = markdown_io.parse_frontmatter(out)
    assert body.strip() == "正文内容"
    assert "INJECTED" not in body
    assert out.startswith("---\n")


# ---------- M-5：读旧内容失败不得覆盖写 ----------

def _make_doc(client) -> str:
    created = client.post(
        "/api/articles",
        json={
            "title": "M5",
            "content": "---\ntitle: 原标题\ntags: [a]\n---\n\n旧正文\n",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def test_put_article_read_failure_returns_409_no_overwrite(client, monkeypatch):
    rel = _make_doc(client)
    ws = client.app.state.workspace_root
    before = (ws / rel).read_bytes()

    real_read = markdown_io.read_text
    state = {"n": 0}

    def flaky(p):
        state["n"] += 1
        if state["n"] == 1:
            raise PermissionError(13, "file is locked")
        return real_read(p)

    monkeypatch.setattr(markdown_io, "read_text", flaky)
    r = client.put(
        f"/api/articles/{rel}",
        json={"content": "---\ntitle: 新\n---\n\n新正文\n"},
    )
    assert r.status_code == 409, r.text
    assert (ws / rel).read_bytes() == before, "读失败后仍覆盖写了文档"


def test_put_article_bad_utf8_returns_422_no_overwrite(client, monkeypatch):
    rel = _make_doc(client)
    ws = client.app.state.workspace_root
    before = (ws / rel).read_bytes()

    def bad_read(p):
        raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")

    monkeypatch.setattr(markdown_io, "read_text", bad_read)
    r = client.put(
        f"/api/articles/{rel}",
        json={"content": "---\ntitle: 新\n---\n\n新正文\n"},
    )
    assert r.status_code == 422, r.text
    assert (ws / rel).read_bytes() == before


def test_put_meta_read_failure_returns_409_no_overwrite(client, monkeypatch):
    rel = _make_doc(client)
    ws = client.app.state.workspace_root
    before = (ws / rel).read_bytes()

    def locked_read(p):
        raise PermissionError(13, "file is locked")

    monkeypatch.setattr(markdown_io, "read_text", locked_read)
    r = client.put(f"/api/articles/{rel}/meta", json={"title": "新标题"})
    assert r.status_code == 409, r.text
    assert (ws / rel).read_bytes() == before
