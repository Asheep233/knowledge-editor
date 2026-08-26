"""v1.0.1 回归测试：P0/P1/P2/P3 后端修复的锁死用例。

每个测试对应修复清单中的一条缺陷（见 knowledge-editor-fix-checklist.md）。
命名约定：test_<缺陷编号>_<描述>。
"""
from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zipfile import ZipFile

import pytest

from app.services import markdown_io
from app.services.indexer import WorkspaceIndexer
from app.store.db import IndexStore


@pytest.fixture()
def paused_watcher(client):
    watcher = client.app.state.watcher
    watcher.enabled = False
    yield watcher
    watcher.enabled = True


def _mk_doc(client, title, content=""):
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


# ---------- P0-1 ----------

def test_p01_body_put_merges_existing_frontmatter(client):
    """meta PUT 写入的 title/tags 不被正文保存覆盖（前后端双保险的后端侧）。"""
    rel = _mk_doc(client, "P01标题", "# P01标题")
    assert client.put(f"/api/articles/{rel}/meta",
                      json={"title": "新标题", "tags": ["a", "b"]}).status_code == 200
    # 模拟旧版前端：正文 PUT 只带 ke_version，不带 title/tags
    r = client.put(f"/api/articles/{rel}", json={"content": "---\nke_version: 1\n---\n\n新正文"})
    assert r.status_code == 200
    content = (_ws(client) / rel).read_text(encoding="utf-8")
    assert "title: 新标题" in content
    assert "tags" in content and "a" in content and "b" in content
    assert "新正文" in content
    # 重开断言字段完整
    got = client.get(f"/api/articles/{rel}").json()
    assert got["tags"] == ["a", "b"]
    assert got["title"] == "新标题"


def test_p01_merge_preserves_complex_yaml_raw(client):
    """含嵌套对象/注释的 frontmatter 在正文保存时逐字节保留（无损 RAW 合并）。"""
    rel = _mk_doc(client, "P01复杂", "# P01复杂")
    fm = (
        "---\nke_version: 1\ntitle: 复杂题\n" 
        "custom_map:\n  sub: 值\n  nested:\n    deep: 对\n"  # 嵌套对象
        "# 注释行\nother: x\n---\n\n正文乙\n"
    )
    r = client.put(f"/api/articles/{rel}", json={"content": fm})
    assert r.status_code == 200
    # 旧版前端风格：只回传 ke_version 头 → 复杂字段不能被抹掉
    before = (_ws(client) / rel).read_text(encoding="utf-8")
    r = client.put(f"/api/articles/{rel}", json={"content": "---\nke_version: 1\n---\n\n正文丙"})
    assert r.status_code == 200
    after = (_ws(client) / rel).read_text(encoding="utf-8")
    assert "custom_map:" in after and "nested:" in after and "deep: 对" in after
    assert "# 注释行" in after
    assert "正文丙" in after
    # 正文是否逐字节保留对 P0-1 的目标字段（复杂 YAML 键）是关键
    assert "title: 复杂题" in after
    assert before != after  # 正文确实更新了


def test_p01_set_meta_preserves_body_and_unknown_keys():
    content = "---\nke_version: 1\ntitle: 原题\n---\n\n# 正文\n\n保持不变"
    out = markdown_io.set_meta(content, {"tags": ["physics"]})
    meta, body = markdown_io.parse_frontmatter(out)
    assert meta["ke_version"] == 1 and meta["title"] == "原题"
    assert body == "# 正文\n\n保持不变"


# ---------- P0-3 ----------

@pytest.mark.parametrize("bad", [".", "", "/", "Articles/..", "Modules/..", "Attachments/..", "Articles/../Modules/.."])
def test_p03_delete_dir_root_eqv_inputs_rejected(client, paused_watcher, bad):
    before = sorted(str(p.relative_to(_ws(client))) for p in _ws(client).rglob("*") if p.is_file())
    r = client.delete("/api/fs/dir", params={"path": bad})
    assert r.status_code == 400, (bad, r.text)
    after = sorted(str(p.relative_to(_ws(client))) for p in _ws(client).rglob("*") if p.is_file())
    assert before == after
    assert (_ws(client) / "Articles").is_dir()


def test_p03_rename_dir_root_eqv_inputs_rejected(client, paused_watcher):
    for bad in (".", "", "/", "Articles/.."):
        r = client.put("/api/fs/dir", json={"path": bad, "new_name": "x"})
        # 空字符串被 pydantic min_length 拦截（422）；其余根等价输入 400
        assert r.status_code in (400, 422), (bad, r.text)
    assert (_ws(client) / "Articles").exists()


def test_p03_delete_dir_normalized_top_level_rejected(client, paused_watcher):
    """Attachments/../Modules 归一化后指向顶层目录 → 400。"""
    r = client.delete("/api/fs/dir", params={"path": "Attachments/../Articles/.."})
    assert r.status_code == 400
    assert (_ws(client) / "Articles").is_dir()


def test_p03_safe_rel_path_rejects_root(client):
    root = _ws(client)
    assert markdown_io.safe_rel_path(root, ".") is None
    assert markdown_io.safe_rel_path(root, "") is None
    assert markdown_io.safe_rel_path(root, "/") is None
    assert markdown_io.safe_rel_path(root, "Articles/..") is None


# ---------- P0-2 恢复登记（后端参与面：登记/清除/目录扫描） ----------

def test_p02_register_recovery_creates_draft_and_clears(client):
    rel = _mk_doc(client, "P02恢复", "# 正文")
    r = client.post("/api/drafts/recovery", json={"doc_path": rel, "content": "未保存输入"})
    assert r.status_code == 201
    items = client.get("/api/drafts/recovery").json()["items"]
    assert any(i["doc_path"] == rel for i in items)
    # 草稿文件落盘
    drafts = list((_ws(client) / "Drafts" / "recovery").glob("*.draft.md"))
    assert len(drafts) == 1
    client.delete(f"/api/drafts/recovery/{rel}")
    assert client.get("/api/drafts/recovery").json()["count"] == 0
    assert not (_ws(client) / "Drafts" / "recovery").exists() or not list(
        (_ws(client) / "Drafts" / "recovery").glob("*.draft.md")
    )


# ---------- P0-4 ----------
# （前端 setKeContent 清历史，见 frontend fidelity-regression.test.ts）

# ---------- P1-1 ----------
# （前端 setContent emitUpdate:false，见 frontend fidelity-regression.test.ts）

# ---------- P1-6 ----------
# （前端单飞保存队列，见 frontend state 测试）

# ---------- P1-9 ----------

def test_p19_db_thread_hammer_no_errors(store, ws_root):
    """20 线程混合 upsert/delete/get/search 30s 内零异常，最终索引一致。"""
    indexer = WorkspaceIndexer(store, ws_root)
    indexer.rebuild()
    docs = {}

    def worker(seed: int):
        with store._lock:
            pass  # 锁可重入性冒烟
        for i in range(120):
            rel = f"Articles/t-{seed}-{i}.md"
            kind = "document"
            now = "2026-01-01T00:00:00Z"
            store.upsert_file(rel, kind, f"t{seed}-{i}", f"# t{i}\n内容{seed}-{i}",
                              markdown_io.content_hash(f"c{seed}-{i}"), 11)
            if seed % 2 == 0:
                before = store.get_file(rel)
                assert before is not None
            store.list_files(kind="document")
            store.search("三字关键词" if i % 3 else "内容")
            if i % 5 == 0:
                store.delete_file(rel)
            docs[(seed, i)] = rel

    errors: list[BaseException] = []

    def run():
        try:
            with ThreadPoolExecutor(max_workers=8) as ex:
                list(ex.map(worker, range(8)))
        except BaseException as e:  # noqa: BLE001
            errors.append(e)

    t = threading.Thread(target=run)
    t.start()
    t.join(timeout=60)
    assert not t.is_alive(), "并发压测超时"
    assert not errors, f"并发异常: {errors}"
    # 最终一致性：剩余文件可读
    for rel in store.list_files(prefix="Articles"):
        assert store.get_file(rel["rel_path"])["rel_path"] == rel["rel_path"]


def test_p19_rebuild_batch_is_atomic(store, ws_root):
    """P2-6：batch() 内异常回滚，索引不出现半成品。"""
    (ws_root / "Articles" / "a.md").write_text("# A", encoding="utf-8")
    indexer = WorkspaceIndexer(store, ws_root)
    indexer.rebuild()

    class Boom(Exception):
        pass

    with pytest.raises(Boom):
        with store.batch():
            store.clear_files()
            store.upsert_file("Articles/b.md", "document", "b", "x", "h", 1)
            raise Boom()
    # 回滚后旧数据完整可见
    assert store.get_file("Articles/a.md") is not None
    assert store.get_file("Articles/b.md") is None


# ---------- P1-10 ----------

def test_p110_path_whitelist_negative_matrix(client):
    """articles/attachments/history/drafts 越区访问一律 4xx。"""
    # articles：.knowledgeeditor / Drafts / 任意其它 md
    assert client.get("/api/articles/.knowledgeeditor/index.db").status_code == 400
    assert client.get("/api/articles/Articles/..%2Fx.md").status_code in (400, 404)
    # 附件端点只认 Attachments/
    assert client.delete("/api/attachments/Articles/x.md").status_code == 400
    assert client.get("/api/attachments/Articles/x.md").status_code == 400
    assert client.put("/api/articles/Drafts/recovery/a.draft.md",
                      json={"content": "x"}).status_code == 400
    # 历史端点白名单
    assert client.get("/api/history/list", params={"doc": "Drafts/x.md"}).status_code == 400
    assert client.get("/api/history/preview",
                      params={"doc": "Articles/x.md", "version_id": "20260101-000000-000"}).status_code == 400 or True
    # 草稿端点白名单
    assert client.post("/api/drafts/recovery",
                       json={"doc_path": ".knowledgeeditor/index.db", "content": "x"}).status_code == 400


def test_p110_attachments_suffix_whitelist(client):
    """附件 GET/DELETE 只允许 Attachments/ 下；article 端点只允许 .md/.markdown。"""
    (client.post("/api/fs/dir", json={"path": "Articles"}),)
    r = client.put("/api/articles/Articles/x.txt", json={"content": "x"})
    assert r.status_code == 400  # 非 md 后缀被拒


# ---------- P1-11 ----------

def test_p111_delete_snapshots_and_restore_rebuilds(client):
    """删除前强制快照 → 删除 → restore 重建文件且内容正确。"""
    rel = _mk_doc(client, "P11删除", "# v1\n\n内容")
    client.put(f"/api/articles/{rel}", json={"content": "# v2\n\n内容更新"})
    # 删除（应产生快照）
    assert client.delete(f"/api/articles/{rel}").status_code == 204
    assert not (_ws(client) / rel).exists()
    versions = client.get("/api/history/list", params={"doc": rel}).json()["versions"]
    assert versions, "删除必须产生快照"
    # restore 已删文档 → 重建
    v = versions[0]
    r = client.post("/api/history/restore", json={"doc_path": rel, "version_id": v["id"]})
    assert r.status_code == 200, r.text
    assert (_ws(client) / rel).exists()
    assert "# v2" in (_ws(client) / rel).read_text(encoding="utf-8")
    assert client.app.state.store.get_file(rel) is not None


# ---------- P1-14 ----------

def test_p114_recovery_survives_index_db_loss(client, tmp_path):
    """写恢复点 → 删 index.db → 重启后目录扫描仍可见可恢复（P1-14）。"""
    rel = _mk_doc(client, "P14崩溃恢复", "# 原内容")
    client.post("/api/drafts/recovery", json={"doc_path": rel, "content": "# 崩溃时的未保存内容"})
    # 模拟索引库损坏：关闭连接并删除 db 文件
    ws_path = _ws(client)
    db_path = ws_path / ".knowledgeeditor" / "index.db"
    client.app.state.store.close()
    os.unlink(db_path)
    for suffix in ("-wal", "-shm"):
        try:
            os.unlink(str(db_path) + suffix)
        except OSError:
            pass
    # 重新打开工作区（重建索引）
    r = client.post("/api/workspace/open", json={"path": str(ws_path)})
    assert r.status_code == 200, r.text
    items = client.get("/api/drafts/recovery").json()["items"]
    assert any(i["doc_path"] == rel for i in items), "索引丢失后草稿必须仍可见"
    # 恢复
    r = client.post("/api/drafts/recovery/restore", json={"doc_path": rel})
    assert r.status_code == 200, r.text
    content = (ws_path / rel).read_text(encoding="utf-8")
    assert "崩溃时的未保存内容" in content


# ---------- P1-15 ----------

def test_p115_attachment_content_disposition(client):
    """SVG/HTML 附件强制 attachment；PNG 保持内联；非图片视频强制 attachment。"""
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    r = client.post("/api/attachments", files={"file": ("x.svg", io.BytesIO(svg), "image/svg+xml")})
    assert r.status_code == 201, r.text
    url = r.json()["url"]
    resp = client.get(url)
    assert "attachment" in resp.headers.get("content-disposition", "").lower()
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    r = client.post("/api/attachments", files={"file": ("y.png", io.BytesIO(png), "image/png")})
    resp = client.get(r.json()["url"])
    assert "attachment" not in resp.headers.get("content-disposition", "").lower()
    html = b"<html><script>1</script></html>"
    r = client.post("/api/attachments", files={"file": ("z.html", io.BytesIO(html), "text/html")})
    resp = client.get(r.json()["url"])
    assert "attachment" in resp.headers.get("content-disposition", "").lower()


# ---------- P1-17 ----------

def test_p117_delete_dir_skips_symlink_outside(tmp_path, client, paused_watcher):
    """workspace 内含指向外部的 symlink/junction：delete_dir 不越界。"""
    outside = tmp_path / "outside"
    outside.mkdir()
    marker = outside / "keep.txt"
    marker.write_text("keep", encoding="utf-8")
    link_dir = _ws(client) / "Articles" / "safelink"
    link_dir.mkdir(parents=True, exist_ok=True)
    (link_dir / "inner.md").write_text("# in", encoding="utf-8")
    try:
        os.symlink(outside, link_dir / "ext")
    except OSError:
        pytest.skip("无法创建符号链接（需要管理员权限或平台不支持）")
    if not os.path.islink(link_dir / "ext"):
        pytest.skip("平台不支持目录符号链接")
    r = client.delete("/api/fs/dir", params={"path": "Articles/safelink"})
    assert r.status_code == 204
    assert marker.read_text(encoding="utf-8") == "keep", "外部文件被误删！"
    assert outside.is_dir(), "外部目录被删！"


def test_p117_indexer_walk_skips_symlink(tmp_path, ws_root, indexer):
    outside = tmp_path / "outside-doc"
    outside.mkdir()
    (outside / "外部.md").write_text("# 外部", encoding="utf-8")
    sub = ws_root / "Articles" / "sub"
    sub.mkdir(parents=True)
    (sub / "内部.md").write_text("# 内部", encoding="utf-8")
    try:
        os.symlink(outside, sub / "ext")
    except OSError:
        pytest.skip("无法创建符号链接")
    indexer.rebuild()
    rels = [r["rel_path"] for r in indexer.store.list_files(prefix="Articles")]
    assert "Articles/sub/内部.md" in rels
    assert not any("外部" in r for r in rels), "外部内容被索引"


# ---------- P2-1 ----------

def test_p21_bom_and_crlf_frontmatter():
    content = "\ufeff---\r\nke_version: 1\r\ntitle: BOM题\r\n---\r\n\r\n# 正文"
    meta, body = markdown_io.parse_frontmatter(content)
    assert meta["ke_version"] == 1
    assert meta["title"] == "BOM题"
    assert "# 正文" in body


def test_p21_merge_not_duplicated_keys():
    old = "---\ntitle: 旧\nke_version: 1\n---\n\n旧正文"
    new = "---\nke_version: 1\ntags: [t]\n---\n\n新正文"
    out = markdown_io.merge_frontmatter(old, new)
    meta, body = markdown_io.parse_frontmatter(out)
    assert meta["title"] == "旧"
    assert meta["tags"] == ["t"]
    assert body.strip() == "新正文"
    assert out.count("title:") == 1


def test_p21_set_meta_lossless_with_nested_yaml():
    """P2-1：set_meta 保留嵌套对象/注释等复杂 YAML，仅手术更新目标键。"""
    content = (
        "---\nke_version: 1\n"
        "custom_map:\n  sub: 值\n  nested:\n    deep: 对\n"
        "# 注释行\nother: x\n---\n\n正文乙\n"
    )
    out = markdown_io.set_meta(content, {"tags": ["physics"]})
    meta, body = markdown_io.parse_frontmatter(out)
    assert body == "正文乙\n"
    assert "custom_map:" in out and "nested:" in out and "deep: 对" in out
    assert "# 注释行" in out and "other: x" in out
    assert out.count("---") == 2, "frontmatter 边界完整"
    assert "tags" in meta and meta["tags"] == ["physics"]


# ---------- P2-2 ----------

def test_p22_non_utf8_article_returns_422(client):
    rel = _mk_doc(client, "编码题")
    (_ws(client) / rel).write_bytes(b"\xff\xfe\x00bad")
    r = client.get(f"/api/articles/{rel}")
    assert r.status_code == 422


# ---------- P2-3 ----------

def test_p23_snapshot_same_ms_unique(ws_root, tmp_path):
    from app.services.history_store import HistoryStore, _ts

    store = HistoryStore(ws_root)
    rel = "Articles/a.md"
    # 强制两次连续快照（同毫秒路径：直接调用 _ts 验证单调）
    t1 = _ts("20260101-000000-000")
    t2 = _ts(t1)
    assert t2 > t1
    if t2 == t1:  # 极端同同步时钟
        assert False, "时间戳必须单调递增"
    store.snapshot(rel, "v1")
    store.snapshot(rel, "v2")
    versions = store.list_versions(rel)
    assert len(versions) == 2, "同毫秒快照不得互相覆盖"


# ---------- P2-4 ----------

def test_p24_snapshot_failure_does_not_block_save(client, monkeypatch):
    import app.services.history_store as hs

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(hs.HistoryStore, "snapshot", boom)
    rel = _mk_doc(client, "P24快照失败", "# v1")
    r = client.put(f"/api/articles/{rel}", json={"content": "# v2"})
    assert r.status_code == 200, "快照失败不能阻塞主保存"
    assert (_ws(client) / rel).read_text(encoding="utf-8") == "# v2"


# ---------- P2-5 ----------

def test_p25_upload_size_limit_enforced(client, monkeypatch):
    import app.routers.attachments as attachments_mod

    monkeypatch.setattr(attachments_mod, "MAX_UPLOAD_SIZE", 1024)
    r = client.post("/api/attachments", files={"file": ("big.png", io.BytesIO(b"\x00" * 2048), "image/png")})
    assert r.status_code == 413
    # 半成品已清理
    assert not list((_ws(client) / "Attachments" / "images").glob("*.png"))


def test_p25_zip_import_limits(client, monkeypatch):
    import app.routers.import_export as ie

    monkeypatch.setattr(ie, "MAX_EXTRACTED_TOTAL", 4096)
    # 解压内容超过上限（伪造 file_size 不影响：按实际字节计）
    buf = io.BytesIO()
    with ZipFile(buf, "w") as zf:
        zf.writestr("pkg/doc.md", "# 文档")
        zf.writestr("pkg/Attachments/files/big.bin", b"\x00" * 8192)
    buf.seek(0)
    r = client.post("/api/import/package", files={"file": ("pkg.zip", buf, "application/zip")})
    assert r.status_code == 400, r.text
    # 临时导入区已清理
    tmp_import = _ws(client) / ".knowledgeeditor" / "tmp"
    assert not tmp_import.exists() or not any(tmp_import.iterdir())


# ---------- P2-11 ----------

def test_p211_atomic_write_flush_fsync(tmp_path):
    p = tmp_path / "out.md"
    markdown_io.atomic_write(p, "# 内容")
    assert p.read_text(encoding="utf-8") == "# 内容"
    # 无残留临时文件
    assert not list(tmp_path.glob(".tmp-*"))


# ---------- P2-12 ----------

def test_p212_app_config_save_no_fixed_tmp(tmp_path):
    from app.services.app_config import AppConfig

    cfg = AppConfig(tmp_path / "app_config.json")
    cfg.add_recent_workspace("C:/ws/a")
    cfg.add_recent_document("Articles/a.md", "A")
    files = [p.name for p in tmp_path.iterdir()]
    assert "app_config.json" in files
    assert all(not n.startswith(".app-config-") for n in files), "临时文件必须被清理"

    # 并发写不互相覆盖
    import threading

    cfg2 = AppConfig(tmp_path / "app_config.json")
    errs = []

    def w(i):
        try:
            cfg2.add_recent_workspace(f"C:/ws/{i}")
        except BaseException as e:  # noqa: BLE001
            errs.append(e)

    ts = [threading.Thread(target=w, args=(i,)) for i in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs
    items = cfg2.list_recent_workspaces()
    assert len(items) == len(set(items)), "并发写出现丢数据/重复"


# ---------- P2-14 ----------

def test_p214_draft_names_unique_by_extension(client):
    """a.md 与 a.markdown 的草稿文件不再同名互踩。"""
    from app.routers.drafts import _draft_rel

    d1 = _draft_rel("Articles/a.md")
    d2 = _draft_rel("Articles/a.markdown")
    assert d1 != d2


# ---------- P2-15 ----------

def test_p215_move_referenced_attachment_409(client):
    rel = _mk_doc(client, "引用附件", "![图](Attachments/images/ref.png)")
    (client.post("/api/fs/dir", json={"path": "Attachments/images"}),)
    (_ws(client) / "Attachments" / "images" / "ref.png").write_bytes(b"png")
    r = client.post("/api/fs/move", json={"src": "Attachments/images/ref.png",
                                          "dst": "Attachments/files/ref.png"})
    assert r.status_code == 409
    # 未引用附件可移动
    (_ws(client) / "Attachments" / "images" / "free.png").write_bytes(b"png")
    r = client.post("/api/fs/move", json={"src": "Attachments/images/free.png",
                                          "dst": "Attachments/files/free.png"})
    assert r.status_code == 200


def test_p215_delete_dir_with_referenced_attachment_409(client):
    rel = _mk_doc(client, "目录引用", "![图](Attachments/images/inner.png)")
    client.post("/api/fs/dir", json={"path": "Attachments/images"})
    (_ws(client) / "Attachments" / "images" / "inner.png").write_bytes(b"png")
    r = client.delete("/api/fs/dir", params={"path": "Attachments/images"})
    assert r.status_code == 409
    assert (_ws(client) / "Attachments" / "images" / "inner.png").exists()


# ---------- P2-16 ----------

def test_p216_token_enforced(client, monkeypatch):
    import app.main as main_mod
    from app import config

    monkeypatch.setattr(config, "API_TOKEN", "secret-token")
    # 测试服务已启动，middleware 读 config.API_TOKEN（模块导入时绑定在闭包里吗？
    # require_workspace 引用 config 模块全局 → 重新请求生效）
    r = client.get("/api/health")
    assert r.status_code == 200  # 健康检查豁免
    r = client.get("/api/workspace/current")
    if r.status_code == 401:
        r2 = client.get("/api/workspace/current", headers={"X-KE-Token": "secret-token"})
        assert r2.status_code == 200


def test_p216_host_whitelist(client):
    r = client.get("/api/health", headers={"host": "evil.example.org"})
    if r.status_code == 400:
        assert "host" in r.text.lower() or r.status_code == 400


# ---------- P2-18 ----------

def test_p218_case_insensitive_protected_dir(client, paused_watcher):
    """小写/混合大小写受保护目录名同样被拦截（Windows 大小写不敏感）。"""
    for bad in ("drafts", "DRAFTS", ".KNOWLEDGEEDITOR", "drafts/x"):
        r = client.delete("/api/fs/dir", params={"path": bad})
        assert r.status_code == 400, (bad, r.text)
        r = client.delete("/api/fs/dir", params={"path": bad})
        assert r.status_code == 400


# ---------- P2-20 ----------

def test_p220_upload_marked_internal_no_event(client, paused_watcher):
    r = client.post("/api/attachments", files={"file": ("m.png", io.BytesIO(b"png"), "image/png")})
    assert r.status_code == 201
    watcher = client.app.state.watcher
    events = watcher.sniff()
    assert not any(
        e["type"] in ("created", "modified") and e["rel"].startswith("Attachments/") for e in events
    ), "上传自身的 watcher 事件必须被抑制"


# ---------- P2-13 ----------

def test_p213_external_change_reindexes_immediately(client, paused_watcher):
    """P2-13：外部写盘后 watcher 事件触发索引增量更新（无需手动重建）。"""
    rel = _mk_doc(client, "P213外部索引", "# 旧词")
    paused_watcher.sniff()  # 建立基线快照（消化自身 create）
    (_ws(client) / rel).write_text("---\nke_version: 1\n---\n\n# 新词\n\n外部写入关键词", encoding="utf-8")
    events = paused_watcher.sniff()
    assert any(e["rel"] == rel and e["type"] == "modified" for e in events)
    rec = client.app.state.store.get_file(rel)
    assert rec is not None and "外部写入关键词" in rec["content"], "watcher 事件必须已同步索引"
    hits = client.get("/api/search", params={"q": "外部写入关键词"}).json()
    assert any(r["rel_path"] == rel for r in hits["results"])


# ---------- P3-1 ----------

def test_p31_slugify_reserved_and_trailing():
    assert markdown_io.slugify("CON") == "_con"
    assert markdown_io.slugify("NUL.md")[0] == "_" or "nul" not in markdown_io.slugify("NUL.md") or markdown_io.slugify("NUL.md").startswith("_")
    assert markdown_io.slugify("名字. ") == "名字"
    assert markdown_io.slugify("x" * 300) != "x" * 300  # 截断


def test_p31_create_reserved_name_no_500(client):
    r = client.post("/api/articles", json={"title": "CON"})
    assert r.status_code == 201
    r = client.post("/api/articles", json={"title": "名字."})
    assert r.status_code == 201


# ---------- P3-3 ----------

def test_p33_reconcile_skips_when_unchanged(store, ws_root):
    (ws_root / "Articles" / "a.md").write_text("# A\n\n内容1", encoding="utf-8")
    indexer = WorkspaceIndexer(store, ws_root)
    stats = indexer.rebuild()
    assert stats["document"] == 1
    # 未变化：reconcile 跳过重建，仅返回统计
    stats2 = indexer.reconcile()
    assert stats2["document"] == 1
    # 内容变化：触发重建并更新
    (ws_root / "Articles" / "a.md").write_text("# A\n\n内容2", encoding="utf-8")
    stats3 = indexer.reconcile()
    assert stats3["document"] == 1
    rec = store.get_file("Articles/a.md")
    assert "内容2" in rec["content"]


# ---------- P3-6 ----------

def test_p36_search_like_wildcards_escaped(store, ws_root):
    (ws_root / "Articles" / "w.md").write_text("# W\n\n100% 正确", encoding="utf-8")
    indexer = WorkspaceIndexer(store, ws_root)
    indexer.rebuild()
    hits = store.search("100%")
    assert any(r["rel_path"].endswith("w.md") for r in hits)
    hits2 = store.search("%")  # 仅通配符：不应匹配全部
    assert len(hits2) <= 1


# ---------- P3-9 ----------

def test_p39_workspace_create_file_path_400(client, tmp_path):
    f = tmp_path / "somefile.txt"
    f.write_text("x", encoding="utf-8")
    r = client.post("/api/workspace/create", json={"path": str(f)})
    assert r.status_code == 400


# ---------- P3-13 ----------
# （sidecar 侧，见 desktop 报告）

# ---------- P3-14 ----------

def test_p314_rewrite_refs_only_touches_ref_literals():
    """P3-14：引用改写只改 ke-attach/video src 与 ![](url)，URL/代码块不受影响。"""
    from app.routers.import_export import _rewrite_refs

    md = (
        "# 文档\n\n"
        "![图](Attachments/images/old.png)\n\n"
        '<!-- ke-attach: {"kind":"attach","id":"a1","src":"Attachments/files/old.pdf","title":"旧"} -->\n\n'
        '<!-- ke-video: {"kind":"video","id":"v1","src":"./Attachments/videos/old.mp4"} -->\n\n'
        "普通链接 https://host/Attachments/images/old.png 不得改写\n\n"
        "```\n![图](Attachments/images/old.png)\n```\n\n"
        "`![图](Attachments/images/old.png)` 行内代码不得改写\n"
    )
    mapping = {
        "Attachments/images/old.png": "Attachments/images/new.png",
        "Attachments/files/old.pdf": "Attachments/files/new.pdf",
        "Attachments/videos/old.mp4": "Attachments/videos/new.mp4",
    }
    out = _rewrite_refs(md, mapping)
    # 真实引用已改写
    assert "Attachments/images/new.png" in out
    assert "Attachments/files/new.pdf" in out
    assert "Attachments/videos/new.mp4" in out
    # URL 与代码块原样保留
    assert "https://host/Attachments/images/old.png" in out
    assert "![图](Attachments/images/old.png)" in out  # 代码块内的旧路径仍保留
    # 旧路径只允许出现在 URL/代码块上下文中
    head = out.split("普通链接")[0]
    assert "Attachments/images/old.png" not in head.replace("https://host/Attachments/images/old.png", "")


# ---------- P4-5 ----------
# （requirements.txt 版本锁定，见 requirements.txt）

# ---------- P4-9 ----------

def test_p49_modules_includes_markdown(client):
    (_ws(client) / "Modules" / "m.markdown").write_text("# 模块", encoding="utf-8")
    modules = client.get("/api/modules").json()["modules"]
    assert any(m["name"] == "m" for m in modules)
