"""回收站 MVP 验收测试（2026-09-15 立项）。

契约：`docs/design-trash-mvp.md` §9 验收标准 1–8。
重点关注**不变量**（`Trash/` 不进 tree/搜索/watcher）与**数据完整性**（C2 零内容改动）。
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from app import config


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _mk(client, title: str, content: str | None = None) -> str:
    body = content if content is not None else f"# {title}\n\n正文 MARKER-{title}\n"
    r = client.post("/api/articles", json={"title": title, "content": body})
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


# ---------- 1. 删除改道 ----------


def test_delete_moves_into_trash_and_clears_original(client):
    """契约 §9-1：原路径腾空 + 索引清干净 + 文件出现在 Trash/<entry>/<原rel>。"""
    rel = _mk(client, "回收站用例A")
    ws = _ws(client)
    before = _sha(ws / rel)

    assert client.delete(f"/api/articles/{rel}").status_code == 204

    assert not (ws / rel).exists(), "原路径未腾空"
    assert rel not in [a["path"] for a in client.get("/api/articles").json()], "索引未清理"

    entries = list((ws / config.DIR_TRASH).iterdir())
    assert len(entries) == 1
    moved = entries[0] / rel
    assert moved.is_file(), f"文件未落到 Trash：{list(entries[0].rglob('*'))}"
    assert _sha(moved) == before, "文件内容被修改（违反契约 C2）"


def test_delete_keeps_p1_11_snapshot_behaviour(client):
    """P1-11 行为**未变**：删除仍产生 Drafts/backup 快照（双份保留是有意的）。"""
    rel = _mk(client, "快照保持用例")
    ws = _ws(client)
    client.delete(f"/api/articles/{rel}")
    backups = list((ws / config.DIR_DRAFT_BACKUP).rglob("*.md"))
    assert backups, "删除前强制快照（P1-11）不再生效"


# ---------- 2. C4 不变量：Trash 不进任何扫描面 ----------


def test_trash_is_invisible_to_tree_search_and_attachments(client):
    """契约 §9-2 / C4：Trash 内容不得出现在 tree、搜索、附件列表、孤儿列表。"""
    ws = _ws(client)
    # 造一个带附件引用的文档，删除后附件仍被回收站文档引用
    up = client.post("/api/attachments", files={"file": ("t.png", b"PNG", "image/png")})
    att_rel = up.json()["path"]
    rel = _mk(client, "带附件文档", f"# 带附件文档\n\n![](/{att_rel})\n")
    client.delete(f"/api/articles/{rel}")

    trash_files = [p for p in (ws / config.DIR_TRASH).rglob("*") if p.is_file()]
    assert trash_files, "前置失败：Trash 内应有文件"
    needle = trash_files[0].stem

    tree = str(client.get("/api/documents/tree").json())
    assert config.DIR_TRASH not in tree, f"Trash 出现在 tree：{tree[:300]}"

    hits = client.get("/api/search", params={"q": needle}).json()
    assert hits.get("count", 0) == 0, f"Trash 内容被搜到：{hits}"

    atts = client.get("/api/attachments/list").json()["attachments"]
    assert all(config.DIR_TRASH not in a["rel_path"] for a in atts)


def test_trash_is_not_watched(client):
    """契约 §9-2 / C4：Trash 内的写操作不得产生 watcher 事件。"""
    ws = _ws(client)
    watcher = client.app.state.watcher
    watcher.sniff()  # 清空待处理事件
    target = ws / config.DIR_TRASH / "20260915-120000-abcd" / "Articles"
    target.mkdir(parents=True, exist_ok=True)
    (target / "x.md").write_text("# x\n", encoding="utf-8")
    events = watcher.sniff()
    assert not [e for e in events if config.DIR_TRASH in str(e)], f"Trash 触发 watcher：{events}"


# ---------- 3. 列表 ----------


def test_list_trash_payload_matches_contract(client):
    """契约 §3：载荷字段与语义。"""
    rel = _mk(client, "列表用例")
    client.delete(f"/api/articles/{rel}")

    body = client.get("/api/trash").json()
    assert body["count"] == 1
    it = body["items"][0]
    assert set(it) == {"id", "rel_path", "name", "deleted_at", "size"}
    assert it["rel_path"] == rel
    assert it["name"] == Path(rel).name
    assert it["size"] > 0
    assert len(it["deleted_at"]) >= 16, "deleted_at 应可解析出时间"
    assert client.get("/api/trash").json()["count"] == 1  # 幂等读取


def test_list_trash_empty_when_never_used(client):
    assert client.get("/api/trash").json() == {"count": 0, "items": []}


# ---------- 4. 恢复 ----------


def test_restore_returns_file_byte_identical_and_reindexes(client):
    """契约 §9-4 + C2：恢复后逐字节一致、索引自动重建、Trash 清空。"""
    content = "# 恢复用例\n\n带 **ke-note** 与 $x^2$。\n\n<!-- ke-note: {\"kind\":\"note\",\"id\":\"n1\",\"title\":\"要点\"} -->\n内容\n<!-- /ke-note -->\n"
    rel = _mk(client, "恢复用例", content)
    ws = _ws(client)
    before = _sha(ws / rel)
    entry = client.get("/api/trash").json()  # noqa: F841 (ensure endpoint usable)
    client.delete(f"/api/articles/{rel}")
    sid = client.get("/api/trash").json()["items"][0]["id"]

    r = client.post("/api/trash/restore", json={"id": sid})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": sid, "restored_to": rel, "renamed": False}
    assert _sha(ws / rel) == before, "恢复后内容不一致（违反 C2）"
    assert rel in [a["path"] for a in client.get("/api/articles").json()], "索引未重建"
    assert client.get("/api/trash").json()["count"] == 0, "恢复后条目未清理"


def test_restore_conflict_renames_without_overwriting(client):
    """契约 §9-5 / C6：目标已存在 → 自动改名、**绝不覆盖**。"""
    rel = _mk(client, "冲突用例", "# 冲突用例\n\n原文\n")
    ws = _ws(client)
    client.delete(f"/api/articles/{rel}")
    sid = client.get("/api/trash").json()["items"][0]["id"]

    # 原路径被新建的同名文档占用
    _mk(client, "冲突用例", "# 冲突用例\n\n新文（不可被覆盖）\n")
    occupied = _sha(ws / rel)

    r = client.post("/api/trash/restore", json={"id": sid})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["renamed"] is True
    assert data["restored_to"] != rel
    assert Path(data["restored_to"]).stem.endswith("-1"), data
    assert _sha(ws / rel) == occupied, "原文件被覆盖（违反 C6）"
    assert (ws / data["restored_to"]).is_file()


def test_restore_conflict_increments_suffix(client):
    """`-1` 已存在 → 应得 `-2`。"""
    rel = _mk(client, "递增用例", "# 递增用例\n\nA\n")
    ws = _ws(client)
    client.delete(f"/api/articles/{rel}")
    sid = client.get("/api/trash").json()["items"][0]["id"]
    _mk(client, "递增用例", "# 递增用例\n\nB\n")
    stem, suffix = Path(rel).stem, Path(rel).suffix
    (ws / rel).with_name(f"{stem}-1{suffix}").write_text("# 占位\n", encoding="utf-8")

    data = client.post("/api/trash/restore", json={"id": sid}).json()
    assert Path(data["restored_to"]).stem.endswith("-2"), data


# ---------- 5. 彻底删除 / 清空 ----------


def test_purge_and_clear(client):
    """契约 §9-6。"""
    ws = _ws(client)
    a, b = _mk(client, "彻底删A"), _mk(client, "彻底删B")
    client.delete(f"/api/articles/{a}")
    client.delete(f"/api/articles/{b}")
    items = client.get("/api/trash").json()["items"]
    assert len(items) == 2

    assert client.delete(f"/api/trash/{items[0]['id']}").status_code == 204
    assert client.get("/api/trash").json()["count"] == 1
    assert not (ws / config.DIR_TRASH / items[0]["id"]).exists()

    assert client.delete("/api/trash").status_code == 204
    assert client.get("/api/trash").json()["count"] == 0
    assert client.delete("/api/trash").status_code == 204, "清空应幂等"


# ---------- 6. 孤儿附件数据安全（契约 §6）----------


def test_attachment_referenced_by_trashed_doc_is_not_orphan(client):
    """契约 §9-7：被回收站文档引用的附件不算孤儿、且不可删除。"""
    up = client.post("/api/attachments", files={"file": ("keep.png", b"PNG", "image/png")})
    att_rel = up.json()["path"]
    rel = _mk(client, "引用保留用例", f"# 引用保留用例\n\n![]({att_rel})\n")
    assert client.delete(f"/api/articles/{rel}").status_code == 204

    orphans = client.get("/api/attachments/orphans").json()
    assert att_rel not in [o["path"] for o in orphans["orphans"]], "回收站文档的引用被误判为孤儿"

    d = client.delete(f"/api/attachments/{att_rel}")
    assert d.status_code == 409, f"允许删除仍被回收站文档引用的附件（数据丢失路径）：{d.status_code}"

    # 恢复后引用链正常
    sid = client.get("/api/trash").json()["items"][0]["id"]
    assert client.post("/api/trash/restore", json={"id": sid}).status_code == 200
    listed = client.get("/api/attachments/list").json()["attachments"]
    assert [a for a in listed if a["rel_path"] == att_rel][0]["referenced_by"] == [rel]


# ---------- 7. 路径穿越与幂等 ----------


def test_trash_id_traversal_rejected(client):
    """契约：id 严格白名单，任何越界/非法输入都被拒且不产生写入。"""
    ws = _ws(client)
    # 先放一个真实条目，确保 workspace 有 Trash 且能被扫描
    rel = _mk(client, "穿越用例")
    client.delete(f"/api/articles/{rel}")
    before = sorted(str(p.relative_to(ws)) for p in ws.rglob("*"))

    for bad in [
        "..",
        "../..",
        "../../etc",
        "/etc/passwd",
        "20260915-120000-abcd/../../..",
        "20260915-120000-ABCD",  # 大写不符白名单
        "20260915-120000-abc",  # 长度不足
        "",
        "x" * 300,
    ]:
        assert client.post("/api/trash/restore", json={"id": bad}).status_code in (400, 404, 422), bad
        if bad == "":
            continue  # 空 id 的 DELETE 路径即「清空回收站」端点，另有用例覆盖
        assert client.delete(f"/api/trash/{bad}").status_code in (400, 404, 422), bad

    after = sorted(str(p.relative_to(ws)) for p in ws.rglob("*"))
    assert before == after, "非法 id 请求产生了文件系统副作用"


def test_restore_and_purge_missing_id(client):
    assert client.post("/api/trash/restore", json={"id": "20260915-120000-abcd"}).status_code == 404
    assert client.delete("/api/trash/20260915-120000-abcd").status_code == 404


def test_double_restore_second_is_404(client):
    rel = _mk(client, "二次恢复")
    client.delete(f"/api/articles/{rel}")
    sid = client.get("/api/trash").json()["items"][0]["id"]
    assert client.post("/api/trash/restore", json={"id": sid}).status_code == 200
    assert client.post("/api/trash/restore", json={"id": sid}).status_code == 404


# ---------- 8. Trash 为受保护根（C1）----------


def test_trash_is_protected_from_fs_endpoints(client):
    ws = _ws(client)
    (ws / config.DIR_TRASH).mkdir(exist_ok=True)
    assert client.delete(f"/api/fs/dir?path={config.DIR_TRASH}").status_code in (400, 403, 404, 409)
    assert client.post("/api/fs/move", json={"src": config.DIR_TRASH, "dst": "Articles/T"}).status_code in (
        400,
        403,
        404,
        409,
    )


def test_cjk_and_space_filenames_roundtrip(client):
    """CJK / 空格文件名在删除→恢复后逐字节一致（Windows 语义对齐）。"""
    rel = _mk(client, "我的 报告 v2", "# 我的 报告 v2\n\n内容\n")
    assert " " in rel and "我的" in rel, f"文件名未保留原文：{rel}"
    ws = _ws(client)
    before = _sha(ws / rel)
    client.delete(f"/api/articles/{rel}")
    sid = client.get("/api/trash").json()["items"][0]["id"]
    data = client.post("/api/trash/restore", json={"id": sid}).json()
    assert data["restored_to"] == rel and data["renamed"] is False
    assert _sha(ws / rel) == before
