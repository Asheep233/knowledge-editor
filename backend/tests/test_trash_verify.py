"""回收站 MVP **独立对抗验证**套件（task-8 · verifier-trash）。

与开发者的 `test_trash.py` **完全独立**：本文件只依据契约
`docs/design-trash-mvp.md` 与可行性实测 `docs/design-file-management-feasibility.md` §2
构造断言，不读取实现内部细节（唯一例外：C1 要求显式声明 `_FORBIDDEN_ROOT`，
行为断言无法区分「显式声明」与「顺带 400」，见 TestForbiddenRootTrash 的说明）。

验证优先级（按"最高价值"排序）：
  1. C4 不变量：Trash 不得出现在 tree / FTS / 附件列表 / 孤儿列表 / 索引 / watcher；
  2. C2 数据完整性：删除→恢复**逐字节**相等，绝不修改 Markdown；
  3. C6 恢复冲突：不覆盖 + renamed:true + 后缀递增；
  4. 路径穿越：全工作区 + 父目录扫描确认无越界；
  5. §6 孤儿附件数据安全：Trash 中的引用必须保护附件；
  6. 幂等 / 删除端点回归 / C1 _FORBIDDEN_ROOT / 契约快照未弱化。

命名约定：`test_<面>_<断言>`。所有断言附实际值，失败即可直接复制进报告。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import pytest

# ---------------------------------------------------------------------------
# 契约常量（独立于实现）
# ---------------------------------------------------------------------------

TRASH_TOP = "Trash"
ENTRY_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")  # YYYYMMDD-HHMMSS-<4hex>
DOC_TOPS = ("Articles", "Modules")
REQUIRED_ITEM_KEYS = {"id", "rel_path", "name", "deleted_at", "size"}

# ---------------------------------------------------------------------------
# 冻结基线（phase-1 时点，未含回收站；用于验证「快照更新合理、未删断言」）
# 来源：git HEAD 的 tests/test_openapi_snapshot.py（本文件独立抄录，不 import）
# ---------------------------------------------------------------------------

BASELINE_OPENAPI_PATHS = [
    "/api/articles",
    "/api/articles/{article_id}",
    "/api/articles/{article_id}/meta",
    "/api/attachments",
    "/api/attachments/list",
    "/api/attachments/orphans",
    "/api/attachments/{rel_path}",
    "/api/drafts/recovery",
    "/api/drafts/recovery/restore",
    "/api/drafts/recovery/{doc_path}",
    "/api/export/package",
    "/api/fs/dir",
    "/api/fs/doc",
    "/api/fs/events",
    "/api/fs/move",
    "/api/health",
    "/api/history/list",
    "/api/history/preview",
    "/api/history/restore",
    "/api/import/markdown",
    "/api/import/package",
    "/api/index/rebuild",
    "/api/modules",
    "/api/modules/{module_path}",
    "/api/search",
    "/api/tags",
    "/api/tags/{tag_name}",
    "/api/tree",
    "/api/workspace/close",
    "/api/workspace/create",
    "/api/workspace/current",
    "/api/workspace/info",
    "/api/workspace/init",
    "/api/workspace/open",
    "/api/workspace/recent",
    "/api/workspace/recent-documents",
]

BASELINE_OPENAPI_METHODS = 47
CONTRACT_TRASH_PATHS = ["/api/trash", "/api/trash/restore", "/api/trash/{id}"]

BASELINE_SCHEMAS: dict[str, list[str]] = {
    "ArticleCreate": ["content:string:opt", "title:string:req"],
    "ArticleMetaUpdate": ["tags:anyOf:array+null:opt", "title:anyOf:null+string:opt"],
    "ArticleOut": [
        "content:string:req",
        "created_at:anyOf:null+string:opt",
        "id:string:req",
        "meta:object:opt",
        "path:string:req",
        "size:anyOf:integer+null:opt",
        "tags:array:opt",
        "title:string:req",
        "updated_at:anyOf:null+string:opt",
        "word_count:anyOf:integer+null:opt",
    ],
    "ArticleUpdate": ["content:string:req", "title:anyOf:null+string:opt"],
    "Body_import_markdown_api_import_markdown_post": ["file:string:req"],
    "Body_import_package_api_import_package_post": ["file:string:req"],
    "Body_upload_attachment_api_attachments_post": ["file:string:req"],
    "DirCreate": ["path:string:req"],
    "DocCreate": ["dir:string:opt", "title:string:req"],
    "ExportPackageReq": ["md:string:req", "refs:array:opt", "title:string:req"],
    "HTTPValidationError": ["detail:array:opt"],
    "HistoryRestoreBody": ["doc_path:string:req", "version_id:string:req"],
    "MoveBody": ["dst:string:req", "src:string:req"],
    "PathBody": ["path:string:req"],
    "RecentDocBody": ["rel_path:string:req", "title:string:opt"],
    "RecoveryCreate": [
        "content:anyOf:null+string:opt",
        "doc_path:string:req",
        "draft_path:string:opt",
        "session_id:string:opt",
    ],
    "RecoveryRestore": ["doc_path:string:req"],
    "RenameBody": ["new_name:string:req", "path:string:req"],
    "ValidationError": [
        "ctx:object:opt",
        "input:obj:opt",
        "loc:array:req",
        "msg:string:req",
        "type:string:req",
    ],
}

_UNIQUE = "ZQTRASHMARKER7731"


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def paused_watcher(client):
    """暂停后台轮询，保证 sniff 确定性（与既有测试同一手法）。"""
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _trash(client) -> Path:
    return _ws(client) / TRASH_TOP


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _entry_dirs(ws: Path) -> list[str]:
    t = ws / TRASH_TOP
    if not t.is_dir():
        return []
    return sorted(p.name for p in t.iterdir() if p.is_dir())


def _raw_write(ws: Path, rel: str, data: bytes) -> Path:
    p = ws / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def _index_rebuild(client) -> None:
    r = client.post("/api/index/rebuild")
    assert r.status_code == 200, r.text


def _mk_raw_doc(client, rel: str, data: bytes) -> Path:
    """直接落盘（精确控制字节）+ 重建索引，返回绝对路径。"""
    p = _raw_write(_ws(client), rel, data)
    _index_rebuild(client)
    return p


def _mk_doc(client, title: str) -> str:
    r = client.post("/api/articles", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _upload(client, name: str, data: bytes) -> str:
    r = client.post(
        "/api/attachments",
        files={"file": (name, data, "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _delete_doc(client, rel: str):
    return client.delete(f"/api/articles/{quote(rel)}")


def _trash_payload(client) -> dict:
    r = client.get("/api/trash")
    assert r.status_code == 200, f"GET /api/trash -> {r.status_code}: {r.text}"
    return r.json()


def _trash_items(client) -> list[dict]:
    payload = _trash_payload(client)
    assert isinstance(payload.get("items"), list), payload
    return payload["items"]


def _entry_for(client, rel: str) -> str:
    """按 rel_path 找 entry id（失败信息含实际 items，便于归因）。"""
    items = _trash_items(client)
    for it in items:
        if it.get("rel_path") == rel:
            assert ENTRY_RE.match(it["id"]), f"entry 名不符契约: {it['id']!r}"
            return it["id"]
    raise AssertionError(f"Trash 列表中没有 rel_path={rel!r} 的条目；实际 items={items}")


def _restore(client, entry_id: str):
    return client.post("/api/trash/restore", json={"id": entry_id})


def _purge(client, entry_id: str):
    """purge 的 id 走 URL path，必须**编码点号**：httpx 会先把字面 `.`/`..` 段做
    RFC3986 归一化（`/api/trash/..` → `/api/`、`/api/trash/.` → `/api/trash`），
    那样请求根本到不了 `{entry_id}` 路由，测的就不是服务端校验了。
    `%2E` 在服务端解码回 `.`，可真实落到 `entry_id` 上。"""
    return client.delete(f"/api/trash/{quote(entry_id, safe='').replace('.', '%2E')}")


def _clear(client):
    return client.delete("/api/trash")


def _all_files(root: Path, skip=(".knowledgeeditor",)) -> list[Path]:
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip]
        for f in filenames:
            out.append(Path(dirpath) / f)
    return sorted(out)


def _fingerprint(root: Path, skip=(".knowledgeeditor",)) -> dict[str, tuple[int, str]]:
    """{相对路径: (size, sha256)}，用于「全工作区 + 父目录」越界扫描。"""
    fp: dict[str, tuple[int, str]] = {}
    for p in _all_files(root, skip=skip):
        try:
            data = p.read_bytes()
        except OSError:
            continue
        fp[p.relative_to(root).as_posix()] = (len(data), hashlib.sha256(data).hexdigest())
    return fp


def _diff_fp(before: dict, after: dict) -> str:
    """返回差异描述；**无差异时返回空串**（调用方用 `== ""` 断言）。"""
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed = sorted(k for k in set(before) & set(after) if before[k] != after[k])
    if not (added or removed or changed):
        return ""
    return f"added={added} removed={removed} changed={changed}"


def _assert_no_5xx(resp, ctx: str) -> None:
    assert resp.status_code < 500, f"{ctx}: 未捕获异常 -> {resp.status_code}: {resp.text}"


def _call_no_5xx(fn, ctx: str):
    """调用端点；TestClient 会重抛未捕获异常——同样按 5xx 级缺陷处理并给出证据。"""
    try:
        resp = fn()
    except Exception as exc:  # noqa: BLE001
        pytest.fail(f"{ctx}: 未捕获异常 {type(exc).__name__}: {exc}")
    assert resp.status_code < 500, f"{ctx}: {resp.status_code}: {resp.text[:200]}"
    return resp


def _safe_call(fn):
    """httpx 对 NUL/畸形 id 可能直接抛错；视为「客户端拒绝」，不影响服务端状态。"""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return exc


def _sentinel(parent: Path, name: str, payload: bytes = b"sentinel-original") -> Path:
    """在 workspace 之外/根级构造金丝雀目录（含一个文件）。"""
    d = parent / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "keep.txt").write_bytes(payload)
    return d


def _sentinel_intact(d: Path, payload: bytes = b"sentinel-original") -> bool:
    f = d / "keep.txt"
    return f.is_file() and f.read_bytes() == payload


def _schema_type(v: dict) -> str:
    """与冻结快照同一归一化口径（独立副本，防止跟随实现漂移）。"""
    if not isinstance(v, dict):
        return "obj"
    if v.get("type"):
        return str(v["type"])
    if v.get("$ref"):
        return v["$ref"].split("/")[-1]
    if v.get("anyOf"):
        parts = {
            str(x.get("type") or x.get("$ref", "any").split("/")[-1])
            if isinstance(x, dict)
            else str(x)
            for x in v["anyOf"]
        }
        return "anyOf:" + "+".join(sorted(parts))
    if v.get("oneOf"):
        parts = {
            str(x.get("type") or x.get("$ref", "any").split("/")[-1])
            if isinstance(x, dict)
            else str(x)
            for x in v["oneOf"]
        }
        return "oneOf:" + "+".join(sorted(parts))
    if "items" in v:
        return "array:" + _schema_type(v["items"])
    return "obj"


def _live_schema_sig(client) -> dict[str, list[str]]:
    schemas = client.get("/openapi.json").json().get("components", {}).get("schemas", {})
    out: dict[str, list[str]] = {}
    for name, sch in schemas.items():
        props = sch.get("properties", {})
        required = set(sch.get("required", []))
        out[name] = sorted(
            f"{k}:{_schema_type(v)}:{'req' if k in required else 'opt'}"
            for k, v in props.items()
        )
    return out


# ===========================================================================
# 面 1：C4 不变量（本方案成立的前提）
# ===========================================================================

class TestC4Invariants:
    def test_c4_tree_never_exposes_trash(self, client, paused_watcher):
        rel = "Articles/inv-tree.md"
        _mk_raw_doc(client, rel, f"---\ntitle: inv\n---\n\n{_UNIQUE}\n".encode())
        assert _delete_doc(client, rel).status_code == 204
        assert (_ws(client) / TRASH_TOP).is_dir(), "删除后应产生落点 Trash/"

        tree = client.get("/api/tree")
        assert tree.status_code == 200
        body = tree.json()
        blob = json.dumps(body, ensure_ascii=False)
        assert TRASH_TOP not in blob, f"tree 出现 Trash 落点: {blob}"
        for key in ("articles", "modules"):
            assert not [p for p in body[key] if p.startswith(TRASH_TOP + "/")], body[key]
        for cat in body["attachments"].values():
            assert not [p for p in cat if p.startswith(TRASH_TOP + "/")], cat

    def test_c4_fts_search_never_finds_trashed_doc(self, client, paused_watcher):
        rel = "Articles/inv-search.md"
        _mk_raw_doc(client, rel, f"---\ntitle: {_UNIQUE}标题\n---\n\n{_UNIQUE}\n".encode())
        hit_before = client.get("/api/search", params={"q": _UNIQUE}).json()
        assert hit_before["count"] >= 1, f"前置条件失败：删前应能搜到 {hit_before}"

        assert _delete_doc(client, rel).status_code == 204
        after = client.get("/api/search", params={"q": _UNIQUE}).json()
        assert after["count"] == 0, f"回收站内容被 FTS 搜到: {after}"

        entry = _entry_for(client, rel)
        by_entry = client.get("/api/search", params={"q": entry}).json()
        assert by_entry["count"] == 0, f"entry 名被搜到（Trash 路径进索引）: {by_entry}"

        assert _restore(client, entry).status_code == 200
        back = client.get("/api/search", params={"q": _UNIQUE}).json()
        assert back["count"] >= 1, f"恢复后未重建索引: {back}"

    def test_c4_articles_list_and_tags_exclude_trash(self, client, paused_watcher):
        rel = "Articles/inv-list.md"
        _mk_raw_doc(
            client,
            rel,
            f"---\ntitle: {_UNIQUE}\ntags: [{_UNIQUE}-tag]\n---\n\nbody\n".encode(),
        )
        tags_before = client.get("/api/tags").json()
        assert any(_UNIQUE in json.dumps(t) for t in tags_before.get("tags", [])), tags_before

        assert _delete_doc(client, rel).status_code == 204
        arts = client.get("/api/articles").json()
        assert not [a for a in arts if a["id"].startswith(TRASH_TOP + "/")], arts
        assert rel not in [a["id"] for a in arts], arts

        tags_after = client.get("/api/tags").json()
        assert not any(_UNIQUE in json.dumps(t) for t in tags_after.get("tags", [])), (
            f"Trash 文档标签仍可见: {tags_after}"
        )

    def test_c4_attachment_endpoints_never_expose_trash(self, client, paused_watcher):
        """Trash 内即使物理存在 Attachments/ 形态文件，也不得出现在附件列表/孤儿列表。"""
        eid = "20260101-000000-abcd"
        _raw_write(
            _ws(client), f"{TRASH_TOP}/{eid}/Attachments/images/ghost.png", b"\x89PNG"
        )
        listed = client.get("/api/attachments/list").json()
        assert not [
            a for a in listed["attachments"] if a["rel_path"].startswith(TRASH_TOP + "/")
        ], listed
        orphans = client.get("/api/attachments/orphans").json()
        assert not [o for o in orphans["orphans"] if o["path"].startswith(TRASH_TOP + "/")], orphans

        r = client.delete(f"/api/attachments/{TRASH_TOP}/{eid}/Attachments/images/ghost.png")
        assert r.status_code == 400, f"Trash 内文件可经附件端点删除: {r.status_code}"
        assert (_ws(client) / f"{TRASH_TOP}/{eid}/Attachments/images/ghost.png").is_file()

    def test_c4_index_db_has_no_trash_rows_and_rebuild_is_stable(self, client, paused_watcher):
        rel = "Articles/inv-index.md"
        _mk_raw_doc(client, rel, f"---\ntitle: {_UNIQUE}\n---\n\n{_UNIQUE}\n".encode())
        assert _delete_doc(client, rel).status_code == 204

        store = client.app.state.store
        rows = [f["rel_path"] for f in store.list_files()]
        assert not [r for r in rows if r.startswith(TRASH_TOP + "/")], rows

        _index_rebuild(client)
        rows2 = [f["rel_path"] for f in client.app.state.store.list_files()]
        assert not [r for r in rows2 if r.startswith(TRASH_TOP + "/")], (
            f"全量重建后 Trash 进索引: {rows2}"
        )
        assert client.get("/api/search", params={"q": _UNIQUE}).json()["count"] == 0
        assert rel not in [a["id"] for a in client.get("/api/articles").json()]

    def test_c4_delete_and_restore_emit_no_trash_watcher_events(self, client, paused_watcher):
        w = paused_watcher
        rel = "Articles/inv-watch.md"
        _mk_raw_doc(client, rel, f"---\ntitle: inv\n---\n\n{_UNIQUE}\n".encode())
        w.sniff()  # 消化建文件事件，稳定快照

        assert _delete_doc(client, rel).status_code == 204
        events = w.sniff()
        trash_events = [e for e in events if e["rel"].split("/", 1)[0].lower() == TRASH_TOP.lower()]
        assert trash_events == [], f"删除产生 Trash 事件: {trash_events}"

        entry = _entry_for(client, rel)
        assert _restore(client, entry).status_code == 200
        events2 = w.sniff()
        trash_events2 = [e for e in events2 if e["rel"].split("/", 1)[0].lower() == TRASH_TOP.lower()]
        assert trash_events2 == [], f"恢复产生 Trash 事件: {trash_events2}"

    def test_c4_external_file_dropped_into_trash_is_not_watched(self, client, paused_watcher):
        """用户在资源管理器里手工拖文件进 Trash/（可见目录）→ 不得产生任何事件。"""
        w = paused_watcher
        w.sniff()
        _raw_write(
            _ws(client),
            f"{TRASH_TOP}/20260101-010101-beef/Articles/manual.md",
            b"manual",
        )
        events = w.sniff()
        assert events == [], f"手工放入 Trash 触发事件: {events}"


# ===========================================================================
# 面 2：C2 数据完整性（最高优先）
# ===========================================================================

BYTE_EXACT_CASES = [
    ("plain", "Articles/plain.md", "---\ntitle: t\n---\n\n正文 body\n".encode()),
    ("crlf", "Articles/crlf.md", "---\ntitle: t\r\n---\r\n\r\nline1\r\nline2\r\n".encode()),
    ("bom", "Articles/bom.md", b"\xef\xbb\xbf---\ntitle: t\n---\n\nBOM body\n"),
    ("cjk_space_name", "Articles/中文 文档 名.md", "---\ntitle: t\n---\n\nCJK\n".encode()),
    ("nested_subdir", "Articles/深/子层/文档.md", b"---\ntitle: t\n---\n\nnested\n"),
    ("no_trailing_newline", "Articles/no-nl.md", b"---\ntitle: t\n---\n\nno newline"),
    ("empty_file", "Articles/empty.md", b""),
    ("ke_markers", "Articles/ke.md", b'---\ntitle: t\n---\n\n<!-- ke-attach: {"src":"Attachments/files/x.pdf"} -->\n'),
    ("invalid_utf8", "Articles/binary.md", b"\xff\xfe\x00\x01not-utf8"),
    ("hash_and_quotes", "Articles/a#b&c'd+e%f.md", b"---\ntitle: t\n---\n\nspecial\n"),
]


@pytest.mark.parametrize("case_id,rel,data", BYTE_EXACT_CASES, ids=[c[0] for c in BYTE_EXACT_CASES])
def test_c2_delete_restore_is_byte_exact(client, paused_watcher, case_id, rel, data):
    ws = _ws(client)
    p = _mk_raw_doc(client, rel, data)
    sha_before, size_before = _sha(p), p.stat().st_size
    mtime_before, ino_before = p.stat().st_mtime_ns, p.stat().st_ino

    r = _delete_doc(client, rel)
    assert r.status_code == 204, f"[{case_id}] DELETE 失败 {r.status_code}: {r.text}"
    assert not p.exists(), f"[{case_id}] 原路径未腾空"

    entry = _entry_for(client, rel)
    trashed = ws / TRASH_TOP / entry / rel
    assert trashed.is_file(), f"[{case_id}] Trash 内未保留完整原相对路径: {trashed}"
    assert _sha(trashed) == sha_before, f"[{case_id}] Trash 内字节已改变（C2 违例）"
    assert trashed.stat().st_ino == ino_before, (
        f"[{case_id}] 删除不是原子 rename（inode 变化 → 疑似 copy+delete）"
    )

    rr = _restore(client, entry)
    assert rr.status_code == 200, f"[{case_id}] 恢复失败 {rr.status_code}: {rr.text}"
    body = rr.json()
    assert body.get("restored_to") == rel, f"[{case_id}] restored_to={body.get('restored_to')!r}"
    assert body.get("renamed") is False, f"[{case_id}] 非冲突却 renamed={body.get('renamed')!r}"

    assert p.is_file(), f"[{case_id}] 恢复后原路径不存在"
    after = p.read_bytes()
    assert after == data, f"[{case_id}] 恢复后字节不等（长度 {len(after)} vs {len(data)}）"
    assert _sha(p) == sha_before, f"[{case_id}] 恢复后 sha256 不等"
    assert p.stat().st_size == size_before, f"[{case_id}] size 不等"
    assert p.stat().st_mtime_ns == mtime_before, f"[{case_id}] mtime 变化（移动不该改写文件）"
    assert p.stat().st_ino == ino_before, f"[{case_id}] 恢复不是原子 rename（inode 变化）"


def test_c2_history_snapshot_still_written_and_content_unchanged(client, paused_watcher):
    """C5：P1-11 删除前快照必须保留；且快照不得改写 Markdown 本体。"""
    from app.services.history_store import MAX_VERSIONS

    assert MAX_VERSIONS == 30, f"C5 要求 MAX_VERSIONS=30 不动，实际 {MAX_VERSIONS}"
    rel = "Articles/snap.md"
    data = f"---\ntitle: snap\n---\n\n{_UNIQUE}\n".encode()
    p = _mk_raw_doc(client, rel, data)
    assert _sha(p) == hashlib.sha256(data).hexdigest()

    assert _delete_doc(client, rel).status_code == 204
    backup_dir = _ws(client) / "Drafts" / "backup" / rel
    snaps = sorted(backup_dir.glob("*.md")) if backup_dir.is_dir() else []
    assert snaps, f"P1-11 删除前快照丢失：{backup_dir} 不存在或无快照"
    assert any(s.read_bytes() == data for s in snaps), "快照内容与删除前原文不符"


def test_c2_restore_recreates_missing_parent_dirs(client, paused_watcher):
    ws = _ws(client)
    rel = "Articles/深/子/文档.md"
    data = b"---\ntitle: t\n---\n\ndeep\n"
    _mk_raw_doc(client, rel, data)
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    # 删除只移动文件，空目录仍在 → 手工清掉，模拟用户整理工作区
    shutil.rmtree(ws / "Articles/深")
    assert not (ws / "Articles/深").exists()

    r = _restore(client, entry)
    assert r.status_code == 200, r.text
    assert (ws / rel).is_file(), "恢复未重建缺失的父目录"
    assert (ws / rel).read_bytes() == data


# ===========================================================================
# 面 3：C6 恢复冲突 —— 必须不覆盖
# ===========================================================================

def test_c6_conflict_renames_and_never_overwrites(client, paused_watcher):
    ws = _ws(client)
    rel = "Articles/conflict.md"
    data_a = b"---\ntitle: A\n---\n\nAAAA-original\n"
    _mk_raw_doc(client, rel, data_a)
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    data_b = b"---\ntitle: B\n---\n\nBBBB-new-live\n"
    _mk_raw_doc(client, rel, data_b)
    sha_b = _sha(ws / rel)

    r = _restore(client, entry)
    assert r.status_code == 200, f"冲突恢复失败 {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("renamed") is True, f"冲突未标记 renamed: {body}"
    assert body.get("restored_to") == "Articles/conflict-1.md", body
    assert _sha(ws / rel) == sha_b, "原有文件被覆盖（C6 违例）"
    assert (ws / rel).read_bytes() == data_b
    assert (ws / "Articles/conflict-1.md").read_bytes() == data_a, "改名后的恢复文件内容不符"


def test_c6_conflict_suffix_increments_when_1_exists(client, paused_watcher):
    ws = _ws(client)
    rel = "Articles/inc.md"
    data_a = b"---\ntitle: A\n---\n\nA\n"
    _mk_raw_doc(client, rel, data_a)
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    live = b"---\ntitle: live\n---\n\nlive\n"
    _mk_raw_doc(client, rel, live)
    _raw_write(ws, "Articles/inc-1.md", b"occupied")
    sha_live = _sha(ws / rel)
    sha_occ = _sha(ws / "Articles/inc-1.md")

    r = _restore(client, entry)
    assert r.status_code == 200, r.text
    assert r.json().get("renamed") is True, r.json()
    assert r.json().get("restored_to") == "Articles/inc-2.md", r.json()
    assert _sha(ws / rel) == sha_live, "原文件被覆盖"
    assert _sha(ws / "Articles/inc-1.md") == sha_occ, "已存在的 -1 被覆盖"
    assert (ws / "Articles/inc-2.md").read_bytes() == data_a


@pytest.mark.parametrize(
    "rel,expected",
    [
        ("Articles/doc.markdown", "Articles/doc-1.markdown"),
        ("Articles/up.MD", "Articles/up-1.MD"),
        ("Modules/mod-conflict.md", "Modules/mod-conflict-1.md"),
        ("Articles/深/嵌套冲突.md", "Articles/深/嵌套冲突-1.md"),
    ],
)
def test_c6_conflict_suffix_preserves_extension_and_dir(client, paused_watcher, rel, expected):
    ws = _ws(client)
    data_a = b"---\ntitle: A\n---\n\nA\n"
    _mk_raw_doc(client, rel, data_a)
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    _mk_raw_doc(client, rel, b"---\ntitle: live\n---\n\nlive\n")
    r = _restore(client, entry)
    assert r.status_code == 200, r.text
    assert r.json().get("renamed") is True, r.json()
    assert r.json().get("restored_to") == expected, (
        f"后缀/扩展名/目录处理不符: {r.json()}"
    )
    assert (ws / expected).read_bytes() == data_a


def test_c6_conflict_against_existing_directory(client, paused_watcher):
    ws = _ws(client)
    rel = "Articles/dirconflict.md"
    data_a = b"---\ntitle: A\n---\n\nA\n"
    _mk_raw_doc(client, rel, data_a)
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    (ws / rel).mkdir(parents=True)
    (ws / rel / "inner.txt").write_bytes(b"keep")
    r = _restore(client, entry)
    _assert_no_5xx(r, "恢复目标为目录")
    assert r.status_code == 200, r.text
    assert r.json().get("renamed") is True, r.json()
    assert r.json().get("restored_to") == "Articles/dirconflict-1.md", r.json()
    assert (ws / rel).is_dir() and (ws / rel / "inner.txt").read_bytes() == b"keep"
    assert (ws / "Articles/dirconflict-1.md").read_bytes() == data_a


def test_c6_dedup_cap_returns_409_not_500(client, paused_watcher):
    """契约 §5：1000 次尝试后 409（不得 500，不得覆盖，entry 仍可恢复）。"""
    ws = _ws(client)
    rel = "Articles/cap.md"
    data_a = b"---\ntitle: A\n---\n\nA\n"
    _mk_raw_doc(client, rel, data_a)
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    _raw_write(ws, rel, b"live")
    # 占满全部 1000 个候选后缀（cap-1 .. cap-1000），强制走到上限分支
    for i in range(1, 1001):
        _raw_write(ws, f"Articles/cap-{i}.md", b"x")

    r = _call_no_5xx(lambda: _restore(client, entry), "去重上限（1000 候选全占用）")
    assert r.status_code == 409, f"超过上限应 409，实际 {r.status_code}: {r.text}"
    assert (ws / rel).read_bytes() == b"live", "失败路径却覆盖了原文件"
    assert (_ws(client) / TRASH_TOP / entry / rel).is_file(), "409 后 entry 应保持可恢复"


# ===========================================================================
# 面 4：路径穿越（id 传入）
# ===========================================================================

def _traversal_setup(client) -> tuple[Path, dict]:
    """构造金丝雀 + 一条真实 entry，返回 (tmp_path, 快照)。"""
    ws = _ws(client)
    parent = ws.parent
    sent_parent = _sentinel(parent, "sentinel_parent")
    sent_wsroot = _sentinel(ws, "sentinel_wsroot")
    sent_abs = _sentinel(parent, "sentinel_abs")
    rel = "Articles/trav.md"
    _mk_raw_doc(client, rel, b"---\ntitle: trav\n---\n\nTRAV\n")
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)
    return parent, {
        "entry": entry,
        "rel": rel,
        "sentinels": [sent_parent, sent_wsroot, sent_abs],
        "fp_parent": _fingerprint(parent),
        "fp_ws": _fingerprint(ws),
        "outside_abs": str(sent_abs),
    }


BAD_IDS = [
    "..",
    ".",
    "../sentinel_wsroot",
    "../../sentinel_parent",
    "../..",
    "sentinel_wsroot/../Articles",
    "Articles/../../sentinel_wsroot",
    "..%2f..%2fsentinel_parent",
    "%2e%2e%2f%2e%2e%2fsentinel_parent",
    "....//....//sentinel_parent",
    "\\..\\..\\sentinel_parent",
    "a/../../sentinel_wsroot",
    "Trash/../sentinel_wsroot",
    "CON",
    "NUL",
    "PRN",
    "AUX",
    "COM1",
    "LPT1",
    "con.md",
    "x" * 5000,
    "\x00",
    "  ",
    "\t",
]


@pytest.mark.parametrize("bad_id", BAD_IDS, ids=[repr(b)[:32] for b in BAD_IDS])
def test_traversal_restore_id_has_no_side_effect(client, paused_watcher, bad_id):
    parent, ctx = _traversal_setup(client)
    before_parent, before_ws = ctx["fp_parent"], ctx["fp_ws"]

    resp = _safe_call(lambda: _restore(client, bad_id))
    if isinstance(resp, Exception):
        status = f"client-side: {type(resp).__name__}"
    else:
        status = resp.status_code
        assert 400 <= resp.status_code < 500, (
            f"restore id={bad_id!r} -> {resp.status_code}: {resp.text[:200]}"
        )

    for s in ctx["sentinels"]:
        assert _sentinel_intact(s), f"restore id={bad_id!r} 破坏了金丝雀 {s}（status={status}）"
    assert _diff_fp(before_parent, _fingerprint(parent)) == "", (
        f"restore id={bad_id!r} 引起父目录变化: {_diff_fp(before_parent, _fingerprint(parent))}"
    )
    assert _diff_fp(before_ws, _fingerprint(_ws(client))) == "", (
        f"restore id={bad_id!r} 引起工作区变化: {_diff_fp(before_ws, _fingerprint(_ws(client)))}"
    )


@pytest.mark.parametrize("bad_id", BAD_IDS, ids=[repr(b)[:32] for b in BAD_IDS])
def test_traversal_purge_id_has_no_side_effect(client, paused_watcher, bad_id):
    parent, ctx = _traversal_setup(client)
    before_parent, before_ws = ctx["fp_parent"], ctx["fp_ws"]

    resp = _safe_call(lambda: _purge(client, bad_id))
    if isinstance(resp, Exception):
        status = f"client-side: {type(resp).__name__}"
    else:
        status = resp.status_code
        assert 400 <= resp.status_code < 500, (
            f"purge id={bad_id!r} -> {resp.status_code}: {resp.text[:200]}"
        )

    for s in ctx["sentinels"]:
        assert _sentinel_intact(s), f"purge id={bad_id!r} 破坏了金丝雀 {s}（status={status}）"
    assert (_ws(client) / TRASH_TOP / ctx["entry"]).is_dir(), (
        f"purge id={bad_id!r} 误删了合法 entry（status={status}）"
    )
    assert _diff_fp(before_parent, _fingerprint(parent)) == "", (
        f"purge id={bad_id!r} 引起父目录变化: {_diff_fp(before_parent, _fingerprint(parent))}"
    )
    assert _diff_fp(before_ws, _fingerprint(_ws(client))) == "", (
        f"purge id={bad_id!r} 引起工作区变化: {_diff_fp(before_ws, _fingerprint(_ws(client)))}"
    )


def test_traversal_absolute_path_id_is_rejected(client, paused_watcher):
    parent, ctx = _traversal_setup(client)
    abs_id = ctx["outside_abs"]
    before_parent = ctx["fp_parent"]

    for resp in (_safe_call(lambda: _restore(client, abs_id)), _safe_call(lambda: _purge(client, abs_id))):
        if not isinstance(resp, Exception):
            assert 400 <= resp.status_code < 500, f"绝对路径 id -> {resp.status_code}: {resp.text}"

    assert _sentinel_intact(Path(abs_id)), "绝对路径 id 删除了工作区外目录"
    assert _diff_fp(before_parent, _fingerprint(parent)) == "", _diff_fp(
        before_parent, _fingerprint(parent)
    )


def test_traversal_symlink_entry_purge_does_not_remove_target(client, paused_watcher):
    """Trash/<entry> 本身是指向工作区外的符号链接：purge 不得沿链接删目标。"""
    ws = _ws(client)
    parent = ws.parent
    target = _sentinel(parent, "sentinel_symlink_target")
    link = ws / TRASH_TOP / "20260101-020202-cafe"
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(target, link, target_is_directory=True)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"平台不支持符号链接: {exc}")

    resp = _call_no_5xx(lambda: _purge(client, "20260101-020202-cafe"), "purge 符号链接 entry")
    assert resp.status_code in (204, 400, 404, 409), f"意外状态: {resp.status_code}"
    assert _sentinel_intact(target), "purge 沿符号链接删除了工作区外目标内容"


def test_traversal_symlink_entry_restore_does_not_move_external_files(client, paused_watcher):
    """Trash/<entry> 是符号链接：restore 不得把链接目标里的文件搬进工作区。"""
    ws = _ws(client)
    parent = ws.parent
    target = _sentinel(parent, "sentinel_symlink_restore")
    link = ws / TRASH_TOP / "20260101-020203-cafe"
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(target, link, target_is_directory=True)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"平台不支持符号链接: {exc}")

    before_parent = _fingerprint(parent)
    resp = _call_no_5xx(
        lambda: _restore(client, "20260101-020203-cafe"), "restore 符号链接 entry"
    )
    assert resp.status_code in (400, 404, 409), f"符号链接 entry 不应可恢复: {resp.status_code}"
    assert _sentinel_intact(target), "restore 把工作区外文件搬走了"
    assert _diff_fp(before_parent, _fingerprint(parent)) == "", (
        f"restore 符号链接 entry 引起父目录变化: {_diff_fp(before_parent, _fingerprint(parent))}"
    )


def test_traversal_symlinked_dir_inside_entry_restore(client, paused_watcher):
    """entry 内含指向外部的**目录符号链接**：restore 不得取链接内文件当 entry 内容。"""
    ws = _ws(client)
    parent = ws.parent
    outside = parent / "sentinel_rglob_dir"
    outside.mkdir(parents=True, exist_ok=True)
    (outside / "outside-doc.md").write_bytes(b"OUTSIDE-MUST-STAY")

    eid = "20260101-020204-cafe"
    link_dir = ws / TRASH_TOP / eid / "Articles"
    link_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(outside, link_dir / "linked")
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"平台不支持符号链接: {exc}")

    before_parent = _fingerprint(parent)
    resp = _call_no_5xx(lambda: _restore(client, eid), "restore 含目录符号链接的 entry")
    assert resp.status_code in (400, 404, 409), (
        f"entry 内仅符号链接时不应恢复出文件: {resp.status_code} {resp.text}"
    )
    assert (outside / "outside-doc.md").read_bytes() == b"OUTSIDE-MUST-STAY", (
        "restore 把链接目标内的外部文件搬进了工作区"
    )
    assert not (ws / "Articles/linked/outside-doc.md").exists(), "外部文件被搬进工作区"
    assert _diff_fp(before_parent, _fingerprint(parent)) == "", (
        f"restore 引起父目录变化: {_diff_fp(before_parent, _fingerprint(parent))}"
    )


def test_traversal_symlink_inside_entry_does_not_remove_target(client, paused_watcher):
    ws = _ws(client)
    target = _ws(client).parent / "sentinel_inner_target"
    target.mkdir(parents=True, exist_ok=True)
    (target / "keep.txt").write_bytes(b"sentinel-original")
    eid = "20260101-030303-d00d"
    inner = ws / TRASH_TOP / eid / "Articles"
    inner.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(target, inner / "linked.md")
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"平台不支持符号链接: {exc}")

    r = _purge(client, eid)
    _assert_no_5xx(r, "purge 含内部符号链接的 entry")
    assert (target / "keep.txt").read_bytes() == b"sentinel-original", (
        "purge 跟随内部符号链接删除了外部目标内容"
    )


def test_traversal_symlinked_article_delete_does_not_follow(client, paused_watcher):
    """Articles 下的 .md 符号链接：删除不得删除链接目标。"""
    ws = _ws(client)
    target = ws.parent / "sentinel_link_target.md"
    target.write_bytes(b"TARGET-MUST-SURVIVE")
    try:
        os.symlink(target, ws / "Articles/linked-doc.md")
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"平台不支持符号链接: {exc}")

    r = _delete_doc(client, "Articles/linked-doc.md")
    _assert_no_5xx(r, "删除符号链接文档")
    assert target.read_bytes() == b"TARGET-MUST-SURVIVE", (
        f"删除符号链接文档删除了链接目标（status={r.status_code}）"
    )


# ===========================================================================
# 面 5：§6 孤儿附件数据安全
# ===========================================================================

def _orphan_paths(client) -> list[str]:
    return [o["path"] for o in client.get("/api/attachments/orphans").json()["orphans"]]


def test_orphan_safety_trashed_doc_still_protects_attachment(client, paused_watcher):
    ws = _ws(client)
    att = _upload(client, "guard.png", b"\x89PNG-guard")
    rel = "Articles/ref-guard.md"
    _mk_raw_doc(
        client,
        rel,
        f"---\ntitle: ref\n---\n\n![]( {att} )\n\n{_UNIQUE}\n".encode(),
    )
    # 前置条件：引用被识别
    item = next(
        a for a in client.get("/api/attachments/list").json()["attachments"]
        if a["rel_path"] == att
    )
    assert rel in item["referenced_by"], f"前置条件失败：{item}"

    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    # 1) 不得进孤儿列表
    orphans = _orphan_paths(client)
    assert att not in orphans, f"回收站文档引用的附件被列为孤儿: {orphans}"

    # 2) referenced_by 必须仍指向 Trash 中的文档（契约 §6）
    item2 = next(
        a for a in client.get("/api/attachments/list").json()["attachments"]
        if a["rel_path"] == att
    )
    assert item2["referenced_by"], f"referenced_by 丢失（Trash 未被扫描）: {item2}"
    assert any(r.startswith(TRASH_TOP + "/") for r in item2["referenced_by"]), item2

    # 3) 不可删除（含磁盘未变）
    d = client.delete(f"/api/attachments/{att}")
    assert d.status_code == 409, f"可删除被回收站引用的附件（数据丢失路径）: {d.status_code}"
    assert (ws / att).is_file(), "拒绝后附件仍被删除"

    # 4) 目录级删除保护同样生效（走 references.py 而非 attachments.py 重复实现）
    r = client.delete("/api/fs/dir", params={"path": "Attachments/images"})
    assert r.status_code == 409, f"目录级保护未生效: {r.status_code}"
    assert (ws / att).is_file()

    # 5) 恢复后引用链回到活文档
    assert _restore(client, entry).status_code == 200
    item3 = next(
        a for a in client.get("/api/attachments/list").json()["attachments"]
        if a["rel_path"] == att
    )
    assert rel in item3["referenced_by"], item3
    assert not any(r.startswith(TRASH_TOP + "/") for r in item3["referenced_by"]), item3
    assert att not in _orphan_paths(client)
    assert client.delete(f"/api/attachments/{att}").status_code == 409


def test_orphan_safety_purge_releases_protection(client, paused_watcher):
    """语义闭环：彻底删除 entry 后，附件才变孤儿且可删。"""
    ws = _ws(client)
    att = _upload(client, "release.png", b"\x89PNG-release")
    rel = "Articles/ref-release.md"
    _mk_raw_doc(client, rel, f"---\ntitle: r\n---\n\n![]({att})\n".encode())

    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)
    assert att not in _orphan_paths(client), "回收站引用期间被列为孤儿"
    assert client.delete(f"/api/attachments/{att}").status_code == 409

    assert _purge(client, entry).status_code == 204
    assert att in _orphan_paths(client), "entry 彻底删除后附件应成为孤儿"
    d = client.delete(f"/api/attachments/{att}")
    assert d.status_code == 200, f"孤儿清理失败: {d.status_code}"
    assert not (ws / att).exists()


def test_orphan_safety_ke_attach_marker_form(client, paused_watcher):
    att = _upload(client, "kefile.pdf", b"%PDF-ke")
    rel = "Articles/ref-ke.md"
    _mk_raw_doc(
        client,
        rel,
        f'---\ntitle: r\n---\n\n<!-- ke-attach: {{"src":"{att}"}} -->\n'.encode(),
    )
    assert _delete_doc(client, rel).status_code == 204
    assert att not in _orphan_paths(client), f"ke-attach 形态引用未被保护（{att}）"
    assert client.delete(f"/api/attachments/{att}").status_code == 409


def test_orphan_safety_live_reference_survives_purge(client, paused_watcher):
    """同一附件被「活文档 + 回收站文档」共同引用：purge 回收站条目后仍受保护。"""
    att = _upload(client, "shared.png", b"\x89PNG-shared")
    live_rel = "Articles/ref-live.md"
    dead_rel = "Articles/ref-dead.md"
    _mk_raw_doc(client, live_rel, f"---\ntitle: l\n---\n\n![]({att})\n".encode())
    _mk_raw_doc(client, dead_rel, f"---\ntitle: d\n---\n\n![]({att})\n".encode())

    assert _delete_doc(client, dead_rel).status_code == 204
    entry = _entry_for(client, dead_rel)
    assert _purge(client, entry).status_code == 204
    assert att not in _orphan_paths(client), "活文档仍在引用，不得成为孤儿"
    assert client.delete(f"/api/attachments/{att}").status_code == 409


# ===========================================================================
# 面 6：幂等 / 异常输入
# ===========================================================================

def test_idempotent_restore_twice(client, paused_watcher):
    ws = _ws(client)
    rel = "Articles/idem-restore.md"
    data = b"---\ntitle: i\n---\n\nIDEM\n"
    _mk_raw_doc(client, rel, data)
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    assert _restore(client, entry).status_code == 200
    sha_after = _sha(ws / rel)
    r2 = _restore(client, entry)
    _assert_no_5xx(r2, "二次 restore")
    assert r2.status_code in (400, 404, 409), f"二次 restore 返回 {r2.status_code}: {r2.text}"
    assert _sha(ws / rel) == sha_after, "二次 restore 改动了已恢复文件"
    assert not (ws / "Articles/idem-restore-1.md").exists(), "二次 restore 产生了副本"


def test_idempotent_purge_twice_and_unknown_id(client, paused_watcher):
    ws = _ws(client)
    rel = "Articles/idem-purge.md"
    _mk_raw_doc(client, rel, b"---\ntitle: p\n---\n\nP\n")
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)

    r1 = _purge(client, entry)
    _assert_no_5xx(r1, "首次 purge")
    assert r1.status_code == 204, r1.text
    assert not (ws / TRASH_TOP / entry).exists()

    r2 = _purge(client, entry)
    _assert_no_5xx(r2, "二次 purge")
    assert r2.status_code in (204, 404), f"二次 purge -> {r2.status_code}: {r2.text}"

    r3 = _purge(client, "20200101-000000-dead")
    _assert_no_5xx(r3, "不存在 id purge")
    assert r3.status_code in (204, 404), f"不存在 id -> {r3.status_code}"

    r4 = _restore(client, "20200101-000000-dead")
    _assert_no_5xx(r4, "不存在 id restore")
    assert r4.status_code == 404, f"不存在 id restore -> {r4.status_code}: {r4.text}"


def test_idempotent_clear_twice_and_when_empty(client, paused_watcher):
    ws = _ws(client)
    r0 = _clear(client)  # Trash 尚未创建
    _assert_no_5xx(r0, "空 Trash 清空")
    assert r0.status_code == 204, f"空清空 -> {r0.status_code}: {r0.text}"

    rels = []
    for i in range(3):
        rel = f"Articles/clear-{i}.md"
        _mk_raw_doc(client, rel, f"---\ntitle: c{i}\n---\n\nC{i}\n".encode())
        assert _delete_doc(client, rel).status_code == 204
        rels.append(rel)
    assert len(_entry_dirs(ws)) == 3

    keep = _mk_raw_doc(client, "Articles/keep.md", b"---\ntitle: keep\n---\n\nKEEP\n")
    sha_keep = _sha(keep)

    r1 = _clear(client)
    assert r1.status_code == 204, r1.text
    assert _entry_dirs(ws) == [], _entry_dirs(ws)
    assert _sha(keep) == sha_keep, "清空破坏了 Articles 内的活文档"

    r2 = _clear(client)
    _assert_no_5xx(r2, "二次清空")
    assert r2.status_code == 204, f"二次清空 -> {r2.status_code}"


def test_idempotent_double_delete_same_doc(client, paused_watcher):
    rel = "Articles/double-del.md"
    _mk_raw_doc(client, rel, b"---\ntitle: d\n---\n\nD\n")
    assert _delete_doc(client, rel).status_code == 204
    items_after_first = _trash_items(client)
    assert len(items_after_first) == 1, items_after_first

    r2 = _delete_doc(client, rel)
    assert r2.status_code == 404, f"二次删除应 404，实际 {r2.status_code}"
    assert len(_trash_items(client)) == 1, "二次删除产生了重复 entry"


def test_robustness_multifile_entry_listed_without_error(client, paused_watcher):
    """契约 §3：异常多文件 entry 只取首个并在 rel_path 标注，不报错。"""
    ws = _ws(client)
    eid = "20260101-040404-aaaa"
    _raw_write(ws, f"{TRASH_TOP}/{eid}/Articles/first.md", b"first")
    _raw_write(ws, f"{TRASH_TOP}/{eid}/Articles/second.md", b"second")

    r = client.get("/api/trash")
    _assert_no_5xx(r, "多文件 entry 列表")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    mine = [i for i in items if i["id"] == eid]
    assert mine, f"多文件 entry 未被列出: {items}"
    assert mine[0]["rel_path"].startswith("Articles/"), mine[0]


def test_robustness_junk_in_trash_root_does_not_crash(client, paused_watcher):
    ws = _ws(client)
    (ws / TRASH_TOP).mkdir(parents=True, exist_ok=True)
    (ws / TRASH_TOP / "loose.md").write_bytes(b"loose")
    (ws / TRASH_TOP / ".gitkeep").write_bytes(b"")
    (ws / TRASH_TOP / "not-an-entry").mkdir()

    r = client.get("/api/trash")
    _assert_no_5xx(r, "Trash 根级杂项列表")
    assert r.status_code == 200, r.text

    # 非法 entry 名的 restore 不得 500、不得越界
    rr = _restore(client, "not-an-entry")
    _assert_no_5xx(rr, "非法 entry 名 restore")


def test_robustness_entry_without_files_restore(client, paused_watcher):
    ws = _ws(client)
    eid = "20260101-050505-bbbb"
    (ws / TRASH_TOP / eid / "Articles").mkdir(parents=True, exist_ok=True)
    r = _restore(client, eid)
    _assert_no_5xx(r, "空 entry restore")
    assert r.status_code in (400, 404, 409), f"空 entry restore -> {r.status_code}: {r.text}"


def test_robustness_handmade_entry_cannot_write_protected_dirs(client, paused_watcher):
    """用户可在可见 Trash/ 里手工放文件：restore 不得写进受保护目录/工作区根。"""
    ws = _ws(client)
    cases = [
        ("20260101-060601-cccc", ".knowledgeeditor/evil.md"),
        ("20260101-060602-cccc", "Drafts/evil.md"),
        ("20260101-060603-cccc", "Attachments/evil.md"),
        ("20260101-060604-cccc", "evil-root.md"),
    ]
    for eid, inner in cases:
        _raw_write(ws, f"{TRASH_TOP}/{eid}/{inner}", b"EVIL")

    for eid, inner in cases:
        r = _restore(client, eid)
        _assert_no_5xx(r, f"手工 entry {inner} restore")
        assert r.status_code >= 400, (
            f"手工 entry rel={inner!r} 未经文档白名单校验即恢复成功（{r.status_code}）"
        )

    # 受保护/非文档位置不得被写入
    for _, inner in cases:
        assert not (ws / inner).exists(), f"restore 把手工 entry 写到了 {inner}"


# ===========================================================================
# 面 7：删除端点回归
# ===========================================================================

def test_delete_regression_original_path_index_tree_and_trash(client, paused_watcher):
    rel = "Articles/del-reg.md"
    data = f"---\ntitle: {_UNIQUE}\n---\n\n{_UNIQUE}\n".encode()
    _mk_raw_doc(client, rel, data)
    store = client.app.state.store
    assert store.get_file(rel) is not None, "前置条件：索引应含该文档"

    assert _delete_doc(client, rel).status_code == 204
    assert not (_ws(client) / rel).exists(), "原路径未腾空"
    assert store.get_file(rel) is None, "索引未清干净"
    assert rel not in client.get("/api/tree").json()["articles"], "tree 未更新"
    assert rel not in [a["id"] for a in client.get("/api/articles").json()]
    assert (_ws(client) / TRASH_TOP / _entry_for(client, rel) / rel).is_file()


def test_delete_regression_guards_and_404(client, paused_watcher):
    parent = _ws(client).parent
    sent = _sentinel(parent, "sentinel_del_guard")
    before = _fingerprint(parent)

    assert _delete_doc(client, "Articles/nope.md").status_code == 404
    for bad in ("../sentinel_del_guard/keep.txt", ".knowledgeeditor/settings.json",
                "Drafts/backup/x.md", "Attachments/images/x.png", "notmd.txt"):
        r = _delete_doc(client, bad)
        assert 400 <= r.status_code < 500, f"DELETE /api/articles/{bad} -> {r.status_code}"

    # 不得把 Trash 内文件当文档二次删除
    rel = "Articles/del-guard.md"
    _mk_raw_doc(client, rel, b"---\ntitle: g\n---\n\ng\n")
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)
    rt = _delete_doc(client, f"{TRASH_TOP}/{entry}/{rel}")
    assert 400 <= rt.status_code < 500, f"可从 Trash 再删: {rt.status_code}"
    assert (_ws(client) / TRASH_TOP / entry / rel).is_file(), "Trash 内容被误删"

    assert _sentinel_intact(sent), "删除守卫路径破坏了工作区外文件"
    after_out = {
        k: v for k, v in _fingerprint(parent).items() if not k.startswith(_ws(client).name + "/")
    }
    before_out = {k: v for k, v in before.items() if not k.startswith(_ws(client).name + "/")}
    assert before_out == after_out, (
        f"删除守卫路径改动了工作区外文件: {_diff_fp(before_out, after_out)}"
    )


def test_delete_regression_modules_doc_goes_to_trash(client, paused_watcher):
    rel = "Modules/mod-del.md"
    _mk_raw_doc(client, rel, b"---\ntitle: m\n---\n\nM\n")
    assert _delete_doc(client, rel).status_code == 204
    entry = _entry_for(client, rel)
    assert (_ws(client) / TRASH_TOP / entry / rel).is_file(), "Modules 文档未按原 rel 落 Trash"
    assert _restore(client, entry).status_code == 200
    assert (_ws(client) / rel).is_file()


def test_delete_regression_fs_dir_still_hard_deletes(client, paused_watcher):
    """MVP 明确排除文件夹回收站：DELETE /api/fs/dir 仍硬删。"""
    ws = _ws(client)
    assert client.post("/api/fs/dir", json={"path": "Articles/harddir"}).status_code == 201
    rel = client.post(
        "/api/fs/doc", json={"title": "hard", "dir": "Articles/harddir"}
    ).json()["id"]
    assert (ws / rel).is_file()

    r = client.delete("/api/fs/dir", params={"path": "Articles/harddir"})
    assert r.status_code == 204, r.text
    assert not (ws / rel).exists(), "目录删除应为硬删"
    assert not (ws / TRASH_TOP).is_dir() or _entry_dirs(ws) == [], (
        "文件夹删除不应产生回收站 entry（MVP 排除）"
    )


def test_delete_regression_orphan_attachment_still_hard_deletes(client, paused_watcher):
    ws = _ws(client)
    att = _upload(client, "hard-orphan.pdf", b"hard")
    assert att in _orphan_paths(client)
    r = client.delete(f"/api/attachments/{att}")
    assert r.status_code == 200, r.text
    assert not (ws / att).exists()


# ===========================================================================
# 面 8：C1 _FORBIDDEN_ROOT（Trash 显式声明）
# ===========================================================================

class TestForbiddenRootTrash:
    """⚠️ 行为上 `Trash` 不在 `_BUSINESS_TOP` 也会被 `_require_business_top` 顺带 400，
    因此行为断言**无法区分**「显式声明 C1」与「偶然不可达」。两条都断言：
    - 结构断言：`Trash` 必须在 `fs._FORBIDDEN_ROOT`（C1 的明文要求）；
    - 行为矩阵：所有 fs 端点对 Trash 一律 4xx。"""

    def test_c1_trash_is_explicitly_declared_forbidden(self):
        from app.routers import fs as fs_router

        forbid = {d.lower() for d in fs_router._FORBIDDEN_ROOT}
        assert TRASH_TOP.lower() in forbid, (
            f"C1 违例：_FORBIDDEN_ROOT={sorted(fs_router._FORBIDDEN_ROOT)} 未显式包含 Trash"
        )

    @pytest.mark.parametrize(
        "path", ["Trash", "trash", "TRASH", "Trash/sub", "Articles/../Trash/x.md", "./Trash"]
    )
    def test_c1_fs_dir_endpoints_reject_trash(self, client, paused_watcher, path):
        ws = _ws(client)
        (ws / TRASH_TOP / "20260101-070707-eeee").mkdir(parents=True, exist_ok=True)
        before = _fingerprint(ws)

        for resp, ctx in [
            (client.post("/api/fs/dir", json={"path": path}), "POST /api/fs/dir"),
            (client.delete("/api/fs/dir", params={"path": path}), "DELETE /api/fs/dir"),
            (client.put("/api/fs/dir", json={"path": path, "new_name": "X"}), "PUT /api/fs/dir"),
        ]:
            assert resp.status_code == 400, f"{ctx} path={path!r} -> {resp.status_code}: {resp.text[:120]}"

        assert _diff_fp(before, _fingerprint(ws)) == "", (
            f"fs 端点操作 Trash 产生了副作用: {_diff_fp(before, _fingerprint(ws))}"
        )

    def test_c1_fs_move_doc_endpoints_reject_trash(self, client, paused_watcher):
        ws = _ws(client)
        eid = "20260101-080808-ffff"
        _raw_write(ws, f"{TRASH_TOP}/{eid}/Articles/t.md", b"t")
        rel = "Articles/move-src.md"
        _mk_raw_doc(client, rel, b"---\ntitle: s\n---\n\nS\n")

        cases = [
            client.post("/api/fs/move", json={"src": rel, "dst": f"{TRASH_TOP}/{eid}/x.md"}),
            client.post("/api/fs/move", json={"src": f"{TRASH_TOP}/{eid}/Articles/t.md", "dst": rel}),
            client.post("/api/fs/move", json={"src": rel, "dst": f"Articles/../{TRASH_TOP}/x.md"}),
            client.put("/api/fs/doc", json={"path": f"{TRASH_TOP}/{eid}/Articles/t.md", "new_name": "y.md"}),
        ]
        for resp in cases:
            assert resp.status_code == 400, f"fs 端点可操作 Trash: {resp.status_code}: {resp.text[:120]}"

    def test_c1_article_and_attachment_endpoints_reject_trash(self, client, paused_watcher):
        ws = _ws(client)
        eid = "20260101-090909-1111"
        _raw_write(ws, f"{TRASH_TOP}/{eid}/Articles/t.md", b"---\ntitle: t\n---\n\nT\n")
        _raw_write(ws, f"{TRASH_TOP}/{eid}/Attachments/images/t.png", b"\x89PNG")

        g1 = client.get(f"/api/articles/{TRASH_TOP}/{eid}/Articles/t.md")
        assert g1.status_code == 400, f"GET 文档可读 Trash: {g1.status_code}"
        g2 = client.get(f"/api/attachments/{TRASH_TOP}/{eid}/Attachments/images/t.png")
        assert g2.status_code == 400, f"GET 附件可读 Trash: {g2.status_code}"
        p1 = client.put(
            f"/api/articles/{TRASH_TOP}/{eid}/Articles/t.md",
            json={"content": "hacked"},
        )
        assert p1.status_code == 400, f"PUT 文档可写 Trash: {p1.status_code}"
        assert (ws / TRASH_TOP / eid / "Articles/t.md").read_bytes() == b"---\ntitle: t\n---\n\nT\n"

    def test_c1_fs_doc_create_cannot_target_trash(self, client, paused_watcher):
        for d in ("Trash", "Trash/x", "Articles/../Trash"):
            r = client.post("/api/fs/doc", json={"title": "evil", "dir": d})
            assert 400 <= r.status_code < 500, f"POST /api/fs/doc dir={d!r} -> {r.status_code}"


# ===========================================================================
# 面 9：契约一致性（载荷 / entry 命名 / 惰性创建 / 快照未弱化）
# ===========================================================================

class TestContractConformance:
    def test_contract_payload_fields_exact(self, client, paused_watcher):
        ws = _ws(client)
        rel = "Articles/payload.md"
        data = b"---\ntitle: p\n---\n\npayload-body\n"
        _mk_raw_doc(client, rel, data)
        assert _delete_doc(client, rel).status_code == 204

        payload = _trash_payload(client)
        assert set(payload.keys()) == {"count", "items"}, f"顶层字段偏离契约: {sorted(payload)}"
        assert payload["count"] == len(payload["items"]), payload
        assert payload["count"] == 1, payload

        item = payload["items"][0]
        missing = REQUIRED_ITEM_KEYS - set(item)
        assert not missing, f"TrashItem 缺字段 {sorted(missing)}: {item}"
        extra = set(item) - REQUIRED_ITEM_KEYS
        assert not extra, f"TrashItem 多出字段（契约 §3 逐字段一致）: {sorted(extra)}"

        assert ENTRY_RE.match(item["id"]), f"entry 名不符 YYYYMMDD-HHMMSS-<4hex>: {item['id']!r}"
        assert item["rel_path"] == rel, item
        assert item["name"] == Path(rel).name, item
        assert isinstance(item["size"], int) and item["size"] == len(data), item
        assert isinstance(item["deleted_at"], str), item
        dt = datetime.fromisoformat(item["deleted_at"])
        now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
        assert abs((now - dt).total_seconds()) < 86400, f"deleted_at 偏离当前时间: {item}"
        stamp = dt.strftime("%Y%m%d-%H%M%S")
        assert stamp == item["id"][:15], (
            f"deleted_at 未由 entry 名派生: {item['deleted_at']} vs id={item['id']}"
        )

    def test_contract_entry_layout_and_lazy_creation(self, client, paused_watcher):
        ws = _ws(client)
        assert not (ws / TRASH_TOP).exists(), "前置条件：全新工作区不应有 Trash/"

        r = client.get("/api/trash")
        assert r.status_code == 200 and r.json() == {"count": 0, "items": []}, r.text
        assert not (ws / TRASH_TOP).exists(), "GET /api/trash 不应创建 Trash/（契约 §1 惰性创建）"

        rel = "Articles/lazy.md"
        _mk_raw_doc(client, rel, b"---\ntitle: l\n---\n\nL\n")
        assert _delete_doc(client, rel).status_code == 204
        assert (ws / TRASH_TOP).is_dir(), "首次删除应创建 Trash/"
        entry = _entry_for(client, rel)
        assert ENTRY_RE.match(entry), entry

    def test_contract_rapid_deletes_get_unique_entries(self, client, paused_watcher):
        ws = _ws(client)
        rels = []
        for i in range(20):
            rel = f"Articles/rapid-{i}.md"
            _mk_raw_doc(client, rel, f"---\ntitle: r{i}\n---\n\nR{i}\n".encode())
            assert _delete_doc(client, rel).status_code == 204
            rels.append(rel)

        entries = _entry_dirs(ws)
        assert len(entries) == 20, f"同秒多次删除 entry 冲突: {entries}"
        assert len(set(entries)) == 20
        assert all(ENTRY_RE.match(e) for e in entries), entries
        items = _trash_items(client)
        assert sorted(i["rel_path"] for i in items) == sorted(rels)
        for e in entries:
            files = [p for p in (ws / TRASH_TOP / e).rglob("*") if p.is_file()]
            assert len(files) == 1, f"entry {e} 应只含一个文件: {files}"

    def test_contract_restore_reactivates_index(self, client, paused_watcher):
        rel = "Articles/reactivate.md"
        _mk_raw_doc(client, rel, f"---\ntitle: {_UNIQUE}\n---\n\n{_UNIQUE}\n".encode())
        assert _delete_doc(client, rel).status_code == 204
        entry = _entry_for(client, rel)
        assert client.get("/api/search", params={"q": _UNIQUE}).json()["count"] == 0

        assert _restore(client, entry).status_code == 200
        assert client.app.state.store.get_file(rel) is not None, "恢复后索引未重建"
        assert client.get(f"/api/articles/{rel}").status_code == 200
        assert rel in client.get("/api/tree").json()["articles"]


class TestOpenAPISnapshotIntegrity:
    """契约快照审查：更新必须只做加法，不得为了让测试过而删/弱化既有断言。"""

    def _paths(self, client) -> list[str]:
        return sorted(client.get("/openapi.json").json()["paths"].keys())

    def test_openapi_no_baseline_path_removed(self, client):
        paths = set(self._paths(client))
        missing = sorted(set(BASELINE_OPENAPI_PATHS) - paths)
        assert not missing, f"冻结基线端点被移除/改名（快照被弱化）: {missing}"

    def test_openapi_added_paths_are_exactly_the_trash_contract(self, client):
        """路径**形状**：恰好新增 3 条 /api/trash* 路径，无其它新增。"""
        added = sorted(set(self._paths(client)) - set(BASELINE_OPENAPI_PATHS))
        assert len(added) == 3, f"新增路径数量偏离契约 §9（+3 路径）: {added}"
        assert all(p.startswith("/api/trash") for p in added), f"新增了非回收站路径: {added}"
        norm = sorted(re.sub(r"\{[^}]*\}", "{}", p) for p in added)
        assert norm == ["/api/trash", "/api/trash/restore", "/api/trash/{}"], (
            f"回收站路径形状偏离契约 §3: {added}"
        )

    def test_openapi_path_param_naming_matches_contract(self, client):
        """契约 §3 逐字段一致：DELETE 模板参数名为 `{id}`（而非 {entry_id} 等）。"""
        added = sorted(set(self._paths(client)) - set(BASELINE_OPENAPI_PATHS))
        assert added == CONTRACT_TRASH_PATHS, (
            f"路径模板与契约 §3 字面不一致（URL 功能等价但契约文本为 {CONTRACT_TRASH_PATHS}）: {added}"
        )

    def test_openapi_method_count_delta(self, client):
        methods = sum(
            len([m for m in item if m in {"get", "post", "put", "delete", "patch"}])
            for item in client.get("/openapi.json").json()["paths"].values()
        )
        assert methods == BASELINE_OPENAPI_METHODS + 4, (
            f"方法端点数应 {BASELINE_OPENAPI_METHODS}+4={BASELINE_OPENAPI_METHODS + 4}，实际 {methods}"
        )

    def test_openapi_baseline_schemas_unchanged(self, client):
        sig = _live_schema_sig(client)
        missing = sorted(set(BASELINE_SCHEMAS) - set(sig))
        assert not missing, f"冻结 schema 被移除（快照被弱化）: {missing}"
        diffs = {
            n: {"now": sig[n], "frozen": BASELINE_SCHEMAS[n]}
            for n in BASELINE_SCHEMAS
            if sig[n] != BASELINE_SCHEMAS[n]
        }
        assert not diffs, f"冻结 schema 结构被改动: {diffs}"

    def test_openapi_added_schemas_are_single_restore_body(self, client):
        sig = _live_schema_sig(client)
        added = sorted(set(sig) - set(BASELINE_SCHEMAS))
        assert len(added) == 1, f"契约 §9：应只 +1 schema，实际新增 {added}"
        assert sig[added[0]] == ["id:string:req"], (
            f"新增 schema 应为 restore 请求体 {{id:string:req}}，实际 {added[0]}={sig[added[0]]}"
        )


# ===========================================================================
# 面 10：原子性（行为代理）与回归底线提示
# ===========================================================================

def test_atomicity_uses_rename_not_copy(client, paused_watcher):
    """os.replace/rename 保留 inode；copy+delete 会换 inode（C3 行为代理）。"""
    ws = _ws(client)
    rel = "Articles/atomic.md"
    p = _mk_raw_doc(client, rel, b"---\ntitle: a\n---\n\nA\n")
    ino = p.stat().st_ino

    assert _delete_doc(client, rel).status_code == 204
    trashed = ws / TRASH_TOP / _entry_for(client, rel) / rel
    assert trashed.stat().st_ino == ino, f"删除非原子 rename：inode {ino} -> {trashed.stat().st_ino}"


def test_entry_id_collision_must_not_lose_data(client, paused_watcher, monkeypatch):
    """契约 §1「同秒多次删除不冲突」：4 位 hex 撞号时**不得覆盖**已有 entry 内容。

    自然撞号概率 1/65536；此处用 monkeypatch 冻结时间 + 冻结 token 使之**必然发生**，
    从而让「无唯一性检查 + os.replace 直接覆盖」这一失败模式可观测。
    """
    import secrets

    import app.services.trash as trash_mod

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return cls(2026, 9, 15, 12, 0, 0)

    monkeypatch.setattr(trash_mod, "datetime", _FrozenDatetime)
    monkeypatch.setattr(secrets, "token_hex", lambda n=2: "abcd")

    ws = _ws(client)
    rel = "Articles/collide.md"
    data_a = b"---\ntitle: A\n---\n\nVERSION-A\n"
    data_b = b"---\ntitle: B\n---\n\nVERSION-B\n"
    _mk_raw_doc(client, rel, data_a)
    assert _delete_doc(client, rel).status_code == 204
    _mk_raw_doc(client, rel, data_b)
    assert _delete_doc(client, rel).status_code == 204

    items = _trash_items(client)
    assert len(items) == 2, (
        f"同秒两次删除应产生两个独立 entry（契约 §1），实际 {len(items)}: {items}"
    )
    blobs = [(ws / TRASH_TOP / it["id"] / it["rel_path"]).read_bytes() for it in items]
    assert data_a in blobs, "entry id 撞号被 os.replace 覆盖 → 第一份删除内容永久丢失（数据丢失）"
    assert data_b in blobs
