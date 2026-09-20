"""独立对抗验证：发布前审查后端修复（B1 / B3 / M1 / M2 / M3 / M7 / M8）—— task-46。

被验证提交：`dc4f99e`（冻结 sha 见 `docs/verification-review-backend.md`）。
本文件由验证员（verifier）**重写**：判据与用例自推，不照抄审查报告验收条目，
也不照抄实现者的 `test_review_pre2_fixes.py`（上任骨架仅作参考，其 42 处 `skip` 占位已全部落地为实测断言）。

判据分层：
  A 严格字节：BOM / frontmatter 块换行风格 / 既有键 / 正文 逐字节 + sha256
  B 安全不变量：拒绝请求后「工作区文件集合与逐文件 sha256 完全一致」
  C 既有契约不回归：POSIX 合法名、孤儿附件删除、文档级删除、全成功目录删除 204

平台：Windows 专属路径语义（大小写不敏感 FS）在 Linux 不可复现者标 `_win_only`，
并给**等价证据**（谓词级单测 + 源码核对），不拿 Linux 结果冒充。
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

_win_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows 路径语义专属（Linux 给等价证据）")

BOM = "\ufeff"


# ─────────────────────────── 独立工具（不 import 被测实现） ───────────────────────────
def _ws(client) -> Path:
    return Path(client.app.state.workspace_root).resolve()


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _snapshot(root: Path) -> dict[str, str]:
    """工作区全量文件 rel→sha256（含 .knowledgeeditor，用于「零副作用」断言）。"""
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and not p.is_symlink():
            out[p.relative_to(root).as_posix()] = _sha(p)
    return out


def _write_bytes(root: Path, rel: str, data: bytes) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def _mk_doc(client, title: str, content: str = "") -> str:
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _upload(client, name: str, data: bytes = b"%PDF-1.4 KE") -> str:
    r = client.post("/api/attachments", files={"file": (name, data, "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _assert_no_side_effects(before: dict[str, str], after: dict[str, str], label: str) -> None:
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed = sorted(rel for rel in set(before) & set(after) if before[rel] != after[rel])
    assert not added, f"[{label}] 出现越界/意外新增文件: {added}"
    assert not removed, f"[{label}] 请求删除了既有文件: {removed}"
    assert not changed, f"[{label}] 请求改写了既有文件: {changed}"


def _fm_block_of(text: str) -> str:
    """截取 frontmatter 块（含首尾 --- 与尾随空行），供换行风格断言。"""
    core = text[1:] if text.startswith(BOM) else text
    assert core.startswith("---"), repr(core[:20])
    end = core.index("\n---", 3)
    end = core.index("\n", end + 1) + 1
    return core[:end]


# ===========================================================================
# 一、B1 字节级矩阵：merge_frontmatter / set_meta × {无BOM,BOM} × {LF,CRLF}
# ===========================================================================
_B1_MATRIX = [
    pytest.param(False, "\n", id="no-bom-lf"),
    pytest.param(True, "\n", id="bom-lf"),
    pytest.param(False, "\r\n", id="no-bom-crlf"),
    pytest.param(True, "\r\n", id="bom-crlf"),
]


def _old_doc(bom: bool, nl: str, body: str = "正文第一行") -> str:
    prefix = BOM if bom else ""
    block = nl.join(["---", "title: 我的文档", "ke_version: 1", "---"])
    return f"{prefix}{block}{nl}{nl}{body}{nl}"


def _wysiwyg_payload(nl: str, body: str = "正文（编辑后）") -> str:
    """模拟前端 WYSIWYG 保存载荷：frontmatter 只含 ke_version（LF 渲染）。"""
    return nl.join(["---", "ke_version: 1", "---"]) + f"{nl}{nl}{body}{nl}"


@pytest.mark.parametrize("bom,nl", _B1_MATRIX)
def test_b1_merge_preserves_bom_and_block_eol(bom, nl):
    """merge_frontmatter：原 BOM + 原块换行风格 + 原 title + 新正文（逐字节）。"""
    from app.services import markdown_io

    out = markdown_io.merge_frontmatter(_old_doc(bom, nl), _wysiwyg_payload(nl))
    prefix = BOM if bom else ""
    # 载荷 frontmatter 区含闭合 --- 后的空行（`---{nl}{nl}`），合并结果原样保留该空行
    expect_block = nl.join(["---", "ke_version: 1", "title: 我的文档", "---"]) + nl + nl
    expect_body = f"正文（编辑后）{nl}"   # 正文风格随前端载荷（本次载荷以 nl 构造）
    assert out == prefix + expect_block + expect_body, f"逐字节不符\n实际={out!r}"
    assert out.startswith(BOM) is bom, "BOM 保真失败"
    assert ("\r\n" in _fm_block_of(out)) is (nl == "\r\n"), "frontmatter 块换行风格未保真"
    assert "title: 我的文档" in out, "既有 title 键丢失"
    assert out.endswith(expect_body), "新正文未逐字节保留"


@pytest.mark.parametrize("bom,nl", _B1_MATRIX)
def test_b1_set_meta_preserves_bom_and_block_eol(bom, nl):
    """set_meta：改 title 后 BOM/块换行/正文逐字节不变，仅 title 更新。"""
    from app.services import markdown_io

    out = markdown_io.set_meta(_old_doc(bom, nl), {"title": "新标题"})
    prefix = BOM if bom else ""
    expect_block = nl.join(["---", "title: 新标题", "ke_version: 1", "---"]) + nl + nl
    expect_body = f"正文第一行{nl}"
    assert out == prefix + expect_block + expect_body, f"逐字节不符\n实际={out!r}"


def test_b1_discrimination_legacy_algorithm_fails_the_matrix():
    """判别性（非空测试）：按**修复前算法**（块重建 splitlines + "\\n".join）复现 → BOM 丢 + 块折 LF。

    旧算法形态取自审查报告 §B1 实证与修复提交的删除行；真实旧模块的执行对照见
    `docs/verification-review-backend.md` 附录 A（已验证旧实现四种组合全部 BOM=False/块 CRLF=False）。
    """
    from app.services import markdown_io

    legacy = "---\nke_version: 1\ntitle: 我的文档\n---\n\n正文（编辑后）\n"   # 旧算法产物
    modern = markdown_io.merge_frontmatter(_old_doc(True, "\r\n"), _wysiwyg_payload("\n"))

    assert not legacy.startswith(BOM), "前置：旧算法确实丢 BOM"
    assert "\r\n" not in _fm_block_of(legacy), "前置：旧算法确实折块 CRLF"
    assert modern.startswith(BOM), "新实现必须保 BOM"
    assert "\r\n" in _fm_block_of(modern), "新实现必须保块 CRLF"
    assert legacy != modern, "旧/新不可区分 → 矩阵是空的（FAIL）"


@pytest.mark.parametrize("fn_name", ["merge_frontmatter", "set_meta"])
def test_b1_reverse_no_bom_lf_doc_not_upgraded(fn_name):
    """反例：无 BOM + LF 文档**不得**被改成 BOM 或 CRLF。"""
    from app.services import markdown_io

    old = _old_doc(False, "\n")
    if fn_name == "merge_frontmatter":
        out = markdown_io.merge_frontmatter(old, _wysiwyg_payload("\n"))
    else:
        out = markdown_io.set_meta(old, {"title": "新标题"})
    assert not out.startswith(BOM), "无 BOM 文档被加上 BOM"
    assert "\r\n" not in out, "LF 文档被改成 CRLF"


def test_b1_old_without_frontmatter_returns_new_verbatim():
    """旧文无 frontmatter → 原样返回新内容（不得补 BOM、不得造块）。"""
    from app.services import markdown_io

    new = "正文没有版本头\n"
    assert markdown_io.merge_frontmatter("旧文也没有头\n", new) == new


def test_b1_new_without_frontmatter_prepends_old_block_and_bom():
    """新文无 frontmatter → 旧块逐字节前置 + 原 BOM 还原。"""
    from app.services import markdown_io

    old = BOM + "---\r\ntitle: T\r\n---\r\n\r\n旧\r\n"
    out = markdown_io.merge_frontmatter(old, "新正文\n")
    assert out == BOM + "---\r\ntitle: T\r\n---\r\n\r\n新正文\n", repr(out)


def test_b1_mixed_eol_records_actual_behavior():
    """混合换行（块 CRLF + 正文 LF）：记录实际行为，断言 BOM 与原块风格不被破坏。"""
    from app.services import markdown_io

    old = BOM + "---\r\ntitle: 混排\r\n---\r\n\r\n" + "正文A\n正文B\n"
    out = markdown_io.merge_frontmatter(old, _wysiwyg_payload("\n"))
    print(f"\n[ke-verify] mixed-EOL 实测输出 = {out!r}")
    assert out.startswith(BOM), "BOM 丢失"
    assert "\r\n" in _fm_block_of(out), "原块 CRLF 被折成 LF"
    assert "正文（编辑后）" in out, "新正文丢失"


def test_b1_read_text_byte_exact_and_atomic_write_roundtrip():
    """B1 第二根因：read_text 必须逐字节（不折 CRLF/BOM），且可原样写回。"""
    import shutil

    from app.services import markdown_io

    root = Path(os.environ.get("KE_WORKSPACE", "/tmp")) / "ke-b1-probe"
    raw = (BOM + "---\r\ntitle: 逐字节\r\n---\r\n\r\n正文\r\n").encode("utf-8")
    try:
        p = _write_bytes(root, "bom_crlf.md", raw)
        got = markdown_io.read_text(p)
        assert got == raw.decode("utf-8"), "read_text 折换了 CRLF/BOM（未逐字节）"
        # 对照：Python 默认通用换行读法会折 CRLF（证明差异真实存在）
        assert p.read_text(encoding="utf-8") != raw.decode("utf-8")
        tmp = root / "reout.md"
        markdown_io.atomic_write(tmp, got)
        assert tmp.read_bytes() == raw, "atomic_write(read_text(x)) 未字节还原"
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_b1_api_put_articles_end_to_end_bytes(client):
    """真实 API：BOM+CRLF 文档经 WYSIWYG 载荷 PUT 后落盘逐字节保真（含 sha256）。"""
    ws = _ws(client)
    doc = _mk_doc(client, "端到端")
    raw = (BOM + "---\r\ntitle: 端到端\r\nke_version: 1\r\n---\r\n\r\n旧正文\r\n").encode("utf-8")
    target = _write_bytes(ws, doc, raw)
    client.app.state.indexer.update_file(doc)
    sha_before = _sha(target)

    r = client.put(f"/api/articles/{doc}", json={"content": _wysiwyg_payload("\n", "新正文内容")})
    assert r.status_code == 200, r.text[:300]

    expect = (BOM + "---\r\nke_version: 1\r\ntitle: 端到端\r\n---\r\n\r\n新正文内容\n").encode("utf-8")
    got = target.read_bytes()
    assert got == expect, f"落盘字节不符\n期望={expect!r}\n实际={got!r}"
    print(f"\n[ke-verify] B1 PUT /articles: before={sha_before[:16]}… after={_sha_bytes(got)[:16]}…（期望 {_sha_bytes(expect)[:16]}…）")
    assert r.json()["content"] == got.decode("utf-8")


def test_b1_api_put_articles_second_save_idempotent(client):
    """同一 API 连续保存两次 → 第二次落盘字节不再变化（损坏不重演）。"""
    ws = _ws(client)
    doc = _mk_doc(client, "幂等保存")
    _write_bytes(ws, doc, (BOM + "---\r\ntitle: 幂等保存\r\nke_version: 1\r\n---\r\n\r\n旧\r\n").encode("utf-8"))
    client.app.state.indexer.update_file(doc)
    payload = {"content": _wysiwyg_payload("\n", "同一份新正文")}
    assert client.put(f"/api/articles/{doc}", json=payload).status_code == 200
    sha1 = _sha(ws / doc)
    assert client.put(f"/api/articles/{doc}", json=payload).status_code == 200
    sha2 = _sha(ws / doc)
    assert sha1 == sha2, f"连续保存字节不稳定: {sha1} != {sha2}"


def test_b1_api_put_meta_end_to_end_bytes(client):
    """真实 API：PUT /meta 后 BOM/CRLF/正文逐字节保真，仅 title 更新。"""
    ws = _ws(client)
    doc = _mk_doc(client, "元信息")
    body = "正文第一行\r\n正文第二行\r\n"
    raw = (BOM + "---\r\ntitle: 元信息\r\nke_version: 1\r\n---\r\n\r\n" + body).encode("utf-8")
    target = _write_bytes(ws, doc, raw)
    client.app.state.indexer.update_file(doc)

    r = client.put(f"/api/articles/{doc}/meta", json={"title": "改名后"})
    assert r.status_code == 200, r.text[:300]
    got = target.read_bytes()
    assert got.startswith(BOM.encode("utf-8")), "BOM 丢失"
    assert b"---\r\n" in got, "frontmatter 块 CRLF 丢失"
    assert "title: 改名后\r\n".encode("utf-8") in got, "新 title 未写入（或换行风格错）"
    assert got.endswith(body.encode("utf-8")), "正文被改写（应逐字节不变）"
    print(f"\n[ke-verify] B1 PUT /meta 落盘 sha256={_sha(target)}")


def test_b1_api_lf_doc_never_gains_bom_or_crlf(client):
    """反例（API 端到端）：无 BOM + LF 文档经两条保存路径后不得出现 BOM/CRLF。"""
    ws = _ws(client)
    doc = _mk_doc(client, "LF 文档")
    target = _write_bytes(ws, doc, "---\ntitle: LF 文档\nke_version: 1\n---\n\n旧正文\n".encode("utf-8"))
    client.app.state.indexer.update_file(doc)

    assert client.put(f"/api/articles/{doc}", json={"content": _wysiwyg_payload("\n", "新正文")}).status_code == 200
    assert client.put(f"/api/articles/{doc}/meta", json={"title": "LF 改名"}).status_code == 200
    got = target.read_bytes()
    assert not got.startswith(BOM.encode("utf-8")), "LF 文档被加上 BOM"
    assert b"\r\n" not in got, "LF 文档被改成 CRLF"


def test_b1_index_content_hash_matches_disk_bytes(client):
    """B1 副作用复核：索引 content_hash == 磁盘字节 sha256；全量重建幂等（无害）。"""
    ws = _ws(client)
    doc = _mk_doc(client, "索引哈希")
    raw = (BOM + "---\r\ntitle: 索引哈希\r\nke_version: 1\r\n---\r\n\r\n正文\r\n").encode("utf-8")
    target = _write_bytes(ws, doc, raw)
    client.app.state.indexer.update_file(doc)

    rec = client.app.state.store.get_file(doc)
    assert rec is not None, "文档未被索引"
    assert rec["content_hash"] == _sha(target), (
        f"索引 content_hash 与磁盘字节不一致: {rec['content_hash']} != {_sha(target)}"
    )
    before = {r["rel_path"]: r["content_hash"] for r in client.app.state.store.list_files()}
    client.app.state.indexer.rebuild()
    after = {r["rel_path"]: r["content_hash"] for r in client.app.state.store.list_files()}
    assert after == before, "全量 reconcile 重建后索引不一致（非幂等）"

    # 升级场景模拟：把索引里的 hash 改成「旧读法（折 CRLF）」结果 → 首次 reconcile 自愈
    stale = hashlib.sha256(target.read_text(encoding="utf-8").encode("utf-8")).hexdigest()
    assert stale != _sha(target), "前置：旧读法 hash 应与字节 hash 不同"
    store = client.app.state.store
    store.conn.execute("UPDATE files SET content_hash = ? WHERE rel_path = ?", (stale, doc))
    store.conn.commit()
    client.app.state.indexer.rebuild()
    rec2 = store.get_file(doc)
    assert rec2 is not None and rec2["content_hash"] == _sha(target), "首次 reconcile 未收敛到字节 hash"
    rows = [r for r in store.list_files() if r["rel_path"] == doc]
    assert len(rows) == 1, f"reconcile 后出现重复行: {rows}"


# ===========================================================================
# 二、B3 穿越族：rename_dir / rename_doc 分隔符与穿越
# ===========================================================================
_B3_NAMES = [
    pytest.param("..\\..\\evil", id="win-up2"),
    pytest.param("..\\..\\..\\evil", id="win-up3"),
    pytest.param("a\\b", id="single-backslash"),
    pytest.param("\\evil", id="leading-backslash"),
    pytest.param("..\\evil\\..\\x", id="mixed-backslash"),
    pytest.param("../evil", id="slash-up"),
    pytest.param("..", id="dotdot"),
    pytest.param(".", id="dot"),
]


@pytest.mark.parametrize("new_name", _B3_NAMES)
def test_b3_rename_dir_rejects_separators_without_side_effects(client, new_name):
    ws = _ws(client)
    client.post("/api/fs/dir", json={"path": "Articles/secret"})
    _write_bytes(ws, "Articles/secret/inside.md", "# 内容\n".encode("utf-8"))
    before = _snapshot(ws)

    r = client.put("/api/fs/dir", json={"path": "Articles/secret", "new_name": new_name})
    after = _snapshot(ws)
    assert r.status_code in (400, 409), f"{new_name!r} -> {r.status_code}: {r.text[:200]}"
    _assert_no_side_effects(before, after, f"rename_dir {new_name!r}")
    assert (ws / "Articles/secret/inside.md").is_file(), "源目录被动过"


@pytest.mark.parametrize("new_name", _B3_NAMES)
def test_b3_rename_doc_rejects_separators_without_side_effects(client, new_name):
    ws = _ws(client)
    doc = _mk_doc(client, "改名目标", "# 正文\n")
    before = _snapshot(ws)

    r = client.put("/api/fs/doc", json={"path": doc, "new_name": new_name})
    after = _snapshot(ws)
    assert r.status_code in (400, 409), f"{new_name!r} -> {r.status_code}: {r.text[:200]}"
    _assert_no_side_effects(before, after, f"rename_doc {new_name!r}")
    assert (ws / doc).is_file(), "源文档被动过"


def test_b3_posix_legal_names_still_work(client):
    """正向对照：CJK/空格等合法名不回归。"""
    ws = _ws(client)
    doc = _mk_doc(client, "合法名", "# 正文\n")
    r = client.put("/api/fs/doc", json={"path": doc, "new_name": "我的 报告 v2"})
    assert r.status_code == 200, r.text[:200]
    assert (ws / "Articles/我的 报告 v2.md").is_file()

    client.post("/api/fs/dir", json={"path": "Articles/目录A"})
    r2 = client.put("/api/fs/dir", json={"path": "Articles/目录A", "new_name": "目录 B2"})
    assert r2.status_code == 200, r2.text[:200]
    assert (ws / "Articles/目录 B2").is_dir()


def test_b3_business_top_rename_still_rejected(client):
    """既有保护不回归：业务顶层目录本身不可重命名。"""
    ws = _ws(client)
    before = _snapshot(ws)
    r = client.put("/api/fs/dir", json={"path": "Articles", "new_name": "X"})
    after = _snapshot(ws)
    assert r.status_code in (400, 409), f"{r.status_code}: {r.text[:200]}"
    _assert_no_side_effects(before, after, "顶层目录改名")
    assert (ws / "Articles").is_dir()


def test_b3_existing_backslash_name_can_be_renamed_to_legal_name(client):
    r"""边界如实记录：拒绝的是「**新名称**含 `\`」，不是「源路径含 `\`」。

    - 磁盘上真有 POSIX 字面名 `Articles/a\b.md` 时，仍可改名为合法名（200）；
    - 但把新名写成含 `\` 的字面名会被拒（由 `test_b3_*_rejects_separators_*` 参数化覆盖）。
    """
    ws = _ws(client)
    rel = "Articles/a\\b.md"
    _write_bytes(ws, rel, "# 反斜杠字面名\n".encode("utf-8"))
    client.app.state.indexer.update_file(rel)
    r = client.put("/api/fs/doc", json={"path": rel, "new_name": "c"})
    assert r.status_code == 200, f"既有文件名含 \\ 应仍可改名为合法名，实际 {r.status_code}: {r.text[:200]}"
    assert (ws / "Articles/c.md").is_file(), "改名未生效"
    assert not (ws / rel).exists(), "旧名未消失"


# ===========================================================================
# 三、M1 rename_doc 归一化顶层判定（跨区改名绕过 P2-15）
# ===========================================================================
def test_m1_rename_doc_cross_top_via_dotdot_rejected(client):
    """`Articles/../Attachments/...` 改名 → 400，附件与引用链不变。"""
    ws = _ws(client)
    att = _upload(client, "被引用.pdf")
    _write_bytes(ws, "Articles/引用者.md", f'# 引用\n\n<!-- ke-attach: {{"src":"{att}"}} -->\n'.encode("utf-8"))
    client.app.state.indexer.update_file("Articles/引用者.md")
    att_sha = _sha(ws / att)
    before = _snapshot(ws)

    r = client.put("/api/fs/doc", json={"path": f"Articles/../{att}", "new_name": "改掉"})
    after = _snapshot(ws)
    assert r.status_code == 400, f"跨区改名未拒绝: {r.status_code} {r.text[:200]}"
    _assert_no_side_effects(before, after, "M1 跨区改名")
    assert _sha(ws / att) == att_sha, "附件字节被改动"

    d = client.delete(f"/api/attachments/{att}")
    assert d.status_code == 409, f"被引用附件仍应 409，实际 {d.status_code}"


def test_m1_legit_dotdot_still_allowed(client):
    """归一化后仍指 Articles 的合法 `..` 不误伤。"""
    ws = _ws(client)
    client.post("/api/fs/dir", json={"path": "Articles/sub"})
    doc = _mk_doc(client, "合法归一化", "# 正文\n")
    normalized = f"Articles/sub/../{Path(doc).name}"
    r = client.put("/api/fs/doc", json={"path": normalized, "new_name": "归一化后"})
    assert r.status_code == 200, r.text[:200]
    assert (ws / "Articles/归一化后.md").is_file(), "合法 `..` 归一化改名失败"


# ===========================================================================
# 四、M2/M3 附件引用保护：规范化 rel + 大小写顶层（+ 正向对照）
# ===========================================================================
_M2_VARIANTS = [
    pytest.param("{p}", id="plain"),
    pytest.param("{dir}//{name}", id="double-slash"),
    pytest.param("{dir}/./{name}", id="dot-segment"),
    pytest.param("{dir}/../{sub}/{name}", id="dotdot-normalize"),
]


@pytest.mark.parametrize("tpl", _M2_VARIANTS)
def test_m2_referenced_attachment_delete_variants_blocked(client, tpl):
    ws = _ws(client)
    att = _upload(client, "保护.pdf")            # Attachments/files/保护.pdf
    _write_bytes(ws, "Articles/引用.md", f'# 引用\n\n![x]({att})\n'.encode("utf-8"))
    client.app.state.indexer.update_file("Articles/引用.md")
    att_sha = _sha(ws / att)

    d, name = att.rsplit("/", 1)
    sub = d.rsplit("/", 1)[-1]
    variant = tpl.format(p=att, dir=d, name=name, sub=sub)
    r = client.delete(f"/api/attachments/{variant}")
    assert r.status_code == 409, f"变体 {variant!r} 未触发引用保护: {r.status_code} {r.text[:200]}"
    assert (ws / att).is_file(), "被引用附件被删除"
    assert _sha(ws / att) == att_sha, "被引用附件字节被改动"


def test_m2_unreferenced_attachment_still_deletable_with_variant(client):
    """正向对照：未被引用的附件仍可删除（保护不得扩大化）。"""
    ws = _ws(client)
    att = _upload(client, "孤儿.pdf")
    d, name = att.rsplit("/", 1)
    r = client.delete(f"/api/attachments/{d}//{name}")
    assert r.status_code == 200, f"孤儿附件变体删除失败: {r.status_code} {r.text[:200]}"
    assert not (ws / att).exists()


def test_m3_case_insensitive_predicate_and_wiring_evidence():
    """M3 等价证据（Linux 可测部分）：大小写不敏感谓词 + 接线溯源核对。"""
    from app.routers import fs as fs_mod

    assert fs_mod._is_under_attachments("Attachments/x.png") is True
    assert fs_mod._is_under_attachments("attachments/x.png") is True
    assert fs_mod._is_under_attachments("ATTACHMENTS/a/b.png") is True
    assert fs_mod._is_under_attachments("Articles/x.md") is False
    assert fs_mod._is_under_attachments("Attachments") is False      # 顶层自身不是「其下」
    assert fs_mod._is_under_attachments("Attachments1/x.png") is False  # 前缀不得误伤

    src = Path(fs_mod.__file__).read_text(encoding="utf-8")
    assert src.count("_is_under_attachments(") >= 3, "M3 谓词未接入全部保护点（delete_dir/move_path）"
    assert 'startswith(config.DIR_ATTACHMENTS + "/")' not in src, "仍有大小写敏感的旧判定残留"


def test_m3_lowercase_dir_delete_on_linux_is_conservative(client):
    """Linux 上真实存在的小写 `attachments/` 目录：无引用时仍可删（保护不扩大化）。"""
    ws = _ws(client)
    lowered = "attachments/files"
    client.post("/api/fs/dir", json={"path": lowered})
    _write_bytes(ws, f"{lowered}/孤立.pdf", b"%PDF-1.4")
    r = client.delete("/api/fs/dir", params={"path": lowered})
    assert r.status_code in (204, 409), f"意外状态: {r.status_code} {r.text[:200]}"
    assert not (ws / lowered).exists(), "无引用时应可删"


@_win_only
def test_m3_delete_dir_case_variant_top_windows(client):
    """Windows 真机：`attachments/...` 与被引用附件同库时删除应 409。"""
    att = _upload(client, "大小写.pdf")
    _write_bytes(_ws(client), "Articles/引用2.md", f'# 引用\n\n![x]({att})\n'.encode("utf-8"))
    lowered = f"attachments/{att.split('/', 1)[1]}"
    r = client.delete("/api/fs/dir", params={"path": lowered})
    assert r.status_code == 409, f"大小写变体目录删除未触发保护: {r.status_code}"


def test_b1_set_meta_without_frontmatter_preserves_bom_and_eol():
    """set_meta 对**无 frontmatter** 的 BOM+CRLF 文档：新增块也用原文风格，BOM 不丢。"""
    from app.services import markdown_io

    old = BOM + "正文甲\r\n正文乙\r\n"
    out = markdown_io.set_meta(old, {"title": "补块"})
    assert out.startswith(BOM), "BOM 丢失"
    assert out.startswith(BOM + "---\r\n"), f"新增 frontmatter 块未沿用 CRLF: {out[:30]!r}"
    assert out.endswith("正文甲\r\n正文乙\r\n"), "正文被改写"


def test_b3_guard_rename_target_resolve_level_blocks_symlink_escape(client):
    """resolve 级包含性断言（`_guard_rename_target`）真实命中：目标名是**单组件**但解析到区外。

    构造：`Articles/link` 是指向工作区外的符号链接目录 → 把 `Articles/moveme` 改名为
    **单组件名** `link`（绕不过字符串校验，只能由 resolve 级断言拦下）。
    同时覆盖悬空链接变体。
    """
    import shutil
    import tempfile

    ws = _ws(client)
    client.post("/api/fs/dir", json={"path": "Articles/moveme"})
    outside = Path(tempfile.mkdtemp(prefix="ke-outside-"))
    link = ws / "Articles/link"
    dangling_target = Path(tempfile.mkdtemp(prefix="ke-outside-")) / "not-yet"
    dangling = ws / "Articles/dangling"
    try:
        link.symlink_to(outside, target_is_directory=True)
        dangling.symlink_to(dangling_target, target_is_directory=True)
    except OSError:
        pytest.skip("本环境不支持创建符号链接")

    before = _snapshot(ws)
    try:
        for name, label in (("link", "指向区外已存在目录"), ("dangling", "指向区外悬空路径")):
            r = client.put("/api/fs/dir", json={"path": "Articles/moveme", "new_name": name})
            assert r.status_code == 400, f"{label}: 经符号链接越界改名未拒绝 {r.status_code}: {r.text[:200]}"
            detail = r.json().get("detail", "")
            assert "越出工作区" in detail or "目标必须位于" in detail, (
                f"{label}: 未由包含性守卫拦下（detail={detail!r}）"
            )
            print(f"\n[ke-verify] B3 符号链接守卫（{label}）-> 400 {detail}")
        after = _snapshot(ws)
        _assert_no_side_effects(before, after, "符号链接越界改名")
        assert list(outside.iterdir()) == [], "工作区外出现文件"
        assert not dangling_target.exists(), "悬空目标被创建"
    finally:
        link.unlink(missing_ok=True)
        dangling.unlink(missing_ok=True)
        shutil.rmtree(outside, ignore_errors=True)
        shutil.rmtree(dangling_target.parent, ignore_errors=True)


def test_b3_rename_to_existing_target_409_no_overwrite(client):
    """目标已存在 → 409 且被撞文件字节不变（不覆盖）。"""
    ws = _ws(client)
    a = _mk_doc(client, "甲", "# 甲\n")
    b = _mk_doc(client, "乙", "# 乙\n")
    b_sha = _sha(ws / b)
    r = client.put("/api/fs/doc", json={"path": a, "new_name": Path(b).stem})
    assert r.status_code == 409, f"应 409，实际 {r.status_code}: {r.text[:200]}"
    assert _sha(ws / b) == b_sha, "被撞文件被覆盖"
    assert (ws / a).is_file(), "源文件消失"


def test_m2_encoded_and_backslash_delete_variants_blocked(client):
    """编码/反斜杠变体：被引用附件不得经 URL 编码绕过保护。"""
    ws = _ws(client)
    att = _upload(client, "编码.pdf")
    _write_bytes(ws, "Articles/引用4.md", f'# 引用\n\n![x]({att})\n'.encode("utf-8"))
    client.app.state.indexer.update_file("Articles/引用4.md")
    d, name = att.rsplit("/", 1)
    observed = []
    for variant in (f"{d}/%2e%2e/{d.split('/', 1)[1]}/{name}", f"{d}%2F{name}", att.replace("/", "%5C")):
        r = client.delete(f"/api/attachments/{variant}")
        observed.append((variant, r.status_code))
        assert r.status_code in (400, 404, 409), f"变体 {variant!r} 异常状态 {r.status_code}"
    print(f"\n[ke-verify] M2 编码/反斜杠变体实测状态: {observed}")
    assert (ws / att).is_file(), "被引用附件被删除"


def test_m8_unremovable_dir_without_file_failures_returns_409(client, monkeypatch):
    """契约分支：无 per-file 失败但目录删不掉（并发写入）→ 409（不被 200 吞掉）。"""
    from app.services import markdown_io

    ws = _ws(client)
    client.post("/api/fs/dir", json={"path": "Articles/幽灵"})
    _write_bytes(ws, "Articles/幽灵/hidden.md", "# 幽灵文件\n".encode("utf-8"))
    real_walk = markdown_io.walk_files

    def _hide(base):
        # 模拟「扫描时不可见、但 rmdir 时仍存在」的并发写入文件
        return [p for p in real_walk(base) if p.name != "hidden.md"]

    monkeypatch.setattr(markdown_io, "walk_files", _hide)
    r = client.delete("/api/fs/dir", params={"path": "Articles/幽灵"})
    monkeypatch.undo()
    assert r.status_code == 409, f"无失败清单但目录未删净应 409，实际 {r.status_code}: {r.text[:200]}"
    assert (ws / "Articles/幽灵/hidden.md").is_file(), "幽灵文件被误删"


# ===========================================================================
# 五、M7 KE_API_TOKEN 移除：源码核对 + 默认路径 + 子进程实证
# ===========================================================================
def test_m7_source_level_no_token_wiring():
    """源码核对：backend/app 内不得再引用 token 校验。"""
    app_dir = Path(__file__).resolve().parents[1] / "app"
    hits: list[str] = []
    for p in app_dir.rglob("*.py"):
        if p.name == "config.py":
            continue  # 允许保留常量定义（无消费方即符合「功能移除」）
        text = p.read_text(encoding="utf-8")
        for needle in ("KE_API_TOKEN", "API_TOKEN", "x-ke-token", "X-KE-Token"):
            if needle in text:
                hits.append(f"{p.relative_to(app_dir)}: {needle}")
    assert hits == [], f"token 仍有消费方/校验分支: {hits}"
    # main.py 的中间件不得再出现 token 校验
    main_src = (app_dir / "main.py").read_text(encoding="utf-8")
    assert "ke-token" not in main_src.lower(), "main.py 仍存在 token 校验"


def test_m7_default_paths_unaffected(client):
    """默认路径全通：health / CORS 预检 / tree / 文档读写。"""
    assert client.get("/api/health").status_code == 200
    opt = client.options(
        "/api/tree",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert opt.status_code in (200, 204), f"CORS 预检失败: {opt.status_code}"
    assert "access-control-allow-origin" in {k.lower() for k in opt.headers}
    assert client.get("/api/tree").status_code == 200

    doc = _mk_doc(client, "Token 无关", "# 正文\n")
    assert client.get(f"/api/articles/{doc}").status_code == 200
    assert client.put(f"/api/articles/{doc}", json={"content": "# 改后\n"}).status_code == 200


def test_m7_token_env_is_inert_subprocess(tmp_path):
    """子进程实证：`KE_API_TOKEN=secret` 时应用仍完全可用（修复前该环境变量砖掉应用）。"""
    script = textwrap.dedent(
        """
        import os, json
        from fastapi.testclient import TestClient
        from app.main import app
        from app.routers.workspace import activate_workspace
        from app.services.workspace import ensure_workspace_structure
        from pathlib import Path
        ws = ensure_workspace_structure(Path(os.environ["KE_WORKSPACE"]) / "ws")
        with TestClient(app) as c:
            activate_workspace(app, ws)
            out = {
                "token_env": os.environ.get("KE_API_TOKEN"),
                "health": c.get("/api/health").status_code,
                "tree": c.get("/api/tree").status_code,
            }
            print("KE_VERIFY_JSON=" + json.dumps(out))
        """
    )
    env = dict(os.environ)
    env["KE_API_TOKEN"] = "secret"
    env["KE_WORKSPACE"] = str(tmp_path / "ws-env")
    env["KE_APP_CONFIG"] = str(tmp_path / "cfg" / "app_config.json")
    env["KE_APP_CONFIG_LEGACY"] = str(tmp_path / "cfg" / "legacy.json")
    proc = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(Path(__file__).resolve().parents[1]),
        env=env, capture_output=True, text=True, timeout=180,
    )
    assert proc.returncode == 0, f"子进程失败: {proc.stderr[-800:]}"
    line = [ln for ln in proc.stdout.splitlines() if ln.startswith("KE_VERIFY_JSON=")][-1]
    data = json.loads(line.split("=", 1)[1])
    assert data["token_env"] == "secret"
    assert data["health"] == 200 and data["tree"] == 200, f"token 设置后应用不可用: {data}"


# ===========================================================================
# 六、M8 目录删除：快照 + per-file 容错 + 契约保持
# ===========================================================================
def test_m8_dir_delete_snapshots_each_doc_and_restorable(client):
    """目录删除后每篇 .md 都有快照，且可恢复出原文。"""
    ws = _ws(client)
    client.post("/api/fs/dir", json={"path": "Articles/批量"})
    docs: dict[str, bytes] = {}
    for i in (1, 2):
        rel = f"Articles/批量/文档{i}.md"
        body = f"---\ntitle: 文档{i}\n---\n\n# 内容{i}\n\n第{i}篇正文。\n".encode("utf-8")
        _write_bytes(ws, rel, body)
        client.app.state.indexer.update_file(rel)
        docs[rel] = body

    r = client.delete("/api/fs/dir", params={"path": "Articles/批量"})
    assert r.status_code == 204, f"全成功应 204，实际 {r.status_code}: {r.text[:200]}"
    assert not (ws / "Articles/批量").exists()

    for rel, original in docs.items():
        versions = client.get("/api/history/list", params={"doc": rel}).json()["versions"]
        assert versions, f"{rel} 删除前未产生快照"
        rr = client.post("/api/history/restore", json={"doc_path": rel, "version_id": versions[0]["id"]})
        assert rr.status_code == 200, rr.text[:200]
        assert (ws / rel).read_bytes() == original, f"{rel} 恢复内容与原文不一致"


def test_m8_per_file_failure_continues_and_reports(client):
    """单个文件删除失败（真实权限错误）→ 其余继续删、响应含失败清单、失败文件保留。"""
    ws = _ws(client)
    client.post("/api/fs/dir", json={"path": "Articles/混合"})
    _write_bytes(ws, "Articles/混合/ok.md", "# 可删\n".encode("utf-8"))
    locked_dir = ws / "Articles/混合/锁住"
    locked_dir.mkdir(parents=True, exist_ok=True)
    locked = _write_bytes(ws, "Articles/混合/锁住/keep.md", "# 删不掉\n".encode("utf-8"))
    client.app.state.indexer.update_file("Articles/混合/ok.md")
    client.app.state.indexer.update_file("Articles/混合/锁住/keep.md")
    before_sha = _sha(locked)

    locked_dir.chmod(0o555)  # 目录不可写 → unlink 失败（等价 Windows 文件锁）
    try:
        r = client.delete("/api/fs/dir", params={"path": "Articles/混合"})
        assert r.status_code == 200, f"含失败时应 200 + 清单，实际 {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("failed"), f"响应缺少失败清单: {body}"
        failed_paths = [f["path"] for f in body["failed"]]
        assert any("锁住/keep.md" in p for p in failed_paths), f"失败清单未含被锁文件: {failed_paths}"
        assert locked.is_file(), "失败文件被误删"
        assert _sha(locked) == before_sha, "失败文件字节被改动"
        assert not (ws / "Articles/混合/ok.md").exists(), "可删文件未继续删除（容错未生效）"
        versions = client.get("/api/history/list", params={"doc": "Articles/混合/锁住/keep.md"}).json()["versions"]
        assert versions, "失败文件缺少删除前快照"
    finally:
        locked_dir.chmod(0o755)


def test_m8_dir_delete_with_referenced_attachment_still_409(client):
    """P2-15 不回归：目录内含被引用附件 → 409 且目录/文件原地不动。"""
    ws = _ws(client)
    att = _upload(client, "目录内.pdf")
    _write_bytes(ws, "Articles/引用者3.md", f'# 引用\n\n![x]({att})\n'.encode("utf-8"))
    client.app.state.indexer.update_file("Articles/引用者3.md")
    parent = att.rsplit("/", 1)[0]
    before = _snapshot(ws)
    r = client.delete("/api/fs/dir", params={"path": parent})
    after = _snapshot(ws)
    assert r.status_code == 409, f"应 409，实际 {r.status_code}: {r.text[:200]}"
    _assert_no_side_effects(before, after, "含被引用附件的目录删除")


def test_m8_doc_level_delete_not_regressed(client):
    """文档级删除不回归：仍走回收站 + 快照。"""
    ws = _ws(client)
    doc = _mk_doc(client, "文档级删除", "# 正文\n")
    r = client.delete(f"/api/articles/{doc}")
    assert r.status_code == 204, r.text[:200]
    assert not (ws / doc).exists()
    versions = client.get("/api/history/list", params={"doc": doc}).json()["versions"]
    assert versions, "文档级删除未产生快照"
    trash = client.get("/api/trash").json()
    assert any(item.get("rel_path") == doc for item in trash.get("items", [])), f"未进回收站: {trash}"


def test_m8_empty_dir_delete_still_204(client):
    ws = _ws(client)
    client.post("/api/fs/dir", json={"path": "Articles/空目录"})
    r = client.delete("/api/fs/dir", params={"path": "Articles/空目录"})
    assert r.status_code == 204, f"空目录删除应 204，实际 {r.status_code}: {r.text[:200]}"
    assert not (ws / "Articles/空目录").exists()
