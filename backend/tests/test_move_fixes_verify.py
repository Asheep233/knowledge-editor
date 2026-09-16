"""独立对抗式验证：移动路径 4 项修复（F9b / F9c / F11 / F12）—— task-16。

本文件由**独立验证员**编写，与开发者自测 `backend/tests/test_move_fixes.py`
**无复用、无调用、无共享断言**：用例矩阵、期望语义与「副作用」判定全部独立推导，
并先在**修复前工作树**上取过基线（见各用例 docstring 中的「修复前实测」）。

来源：
- `docs/design-file-management-feasibility.md` §3.2 的 F9b/F9c/F11/F12 实测登记；
- task-15 的修复意图（净化 / 最近列表迁移 / recovery 草稿迁移 / F9b 文案）；
- 验证员自行推导的补充攻击面（NUL 未捕获、扩展名丢失、目录迁移下的草稿、
  清洗与归一化的顺序、目录段不得被净化、清洗后冲突、原子 rename 的 inode 证据…）。

运行：
    cd backend && python3 -m pytest tests/test_move_fixes_verify.py -o addopts="" -q

约定：`pytest.ini` 已有 `addopts = -q`；要看统计行需再传 `-o addopts=""`。
"""
from __future__ import annotations

import hashlib
import os
import re
import unicodedata
from pathlib import Path

import pytest

_ATT = "Attachments"
_DRAFT_DIR = "Drafts/recovery"
_ILLEGAL = set('<>:"/\\|?*')
_DB_CHURN_TAILS = {"index.db", "index.db-journal", "index.db-wal", "index.db-shm"}
_DB_CHURN_DIR = ".knowledgeeditor"
_WIN_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}


# ===========================================================================
# 基础设施（全部独立实现）
# ===========================================================================
def _ws(client) -> Path:
    return Path(client.app.state.workspace_root).resolve()


def _sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _hash8(doc_path: str) -> str:
    """草稿名 hash：与 ``drafts.py::_hash8`` 同语义，但由验证员独立实现（sha1[:8]）。"""
    return hashlib.sha1(doc_path.encode("utf-8")).hexdigest()[:8]


def _draft_name(doc_path: str) -> str:
    stem = Path(doc_path).stem or "doc"
    return f"{stem}-{_hash8(doc_path)}.draft.md"


def _draft_rel(doc_path: str) -> str:
    return f"{_DRAFT_DIR}/{_draft_name(doc_path)}"


def _snapshot(ws: Path) -> dict[str, str]:
    """工作区全量文件 rel→sha256（仅排除索引库写入噪声）。"""
    out: dict[str, str] = {}
    for p in sorted(ws.rglob("*")):
        if not p.is_file() or p.is_symlink():
            continue
        rel = p.relative_to(ws).as_posix()
        tail = rel.rsplit("/", 1)[-1]
        if tail in _DB_CHURN_TAILS and _DB_CHURN_DIR in rel.split("/"):
            continue
        out[rel] = _sha256_file(p)
    return out


def _move(client, src: str, dst: str):
    return client.post("/api/fs/move", json={"src": src, "dst": dst})


def _detail(r) -> str:
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        return (getattr(r, "text", "") or "")[:300]
    if isinstance(body, dict):
        return str(body.get("detail") or body)
    return str(body)


def _new_doc(client, title: str, content: str = "# 内容") -> str:
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text[:300]
    return r.json()["id"]


def _write_file(ws: Path, rel: str, content: str) -> Path:
    p = ws / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def _mk_dir(client, rel: str) -> None:
    r = client.post("/api/fs/dir", json={"path": rel})
    assert r.status_code in (201, 409), r.text[:300]


def _clear_recent(client) -> None:
    assert client.delete("/api/workspace/recent-documents").status_code == 204


def _add_recent(client, rel_path: str, title: str = "") -> None:
    r = client.post("/api/workspace/recent-documents", json={"rel_path": rel_path, "title": title})
    assert r.status_code == 201, r.text[:300]


def _recent(client) -> list[dict]:
    r = client.get("/api/workspace/recent-documents")
    assert r.status_code == 200, r.text[:300]
    return r.json()["documents"]


def _recovery_items(client) -> list[dict]:
    r = client.get("/api/drafts/recovery")
    assert r.status_code == 200, r.text[:300]
    return r.json()["items"]


def _register_draft(client, ws: Path, doc_rel: str, content: str) -> str:
    r = client.post("/api/drafts/recovery", json={"doc_path": doc_rel, "content": content})
    assert r.status_code == 201, r.text[:300]
    rel = _draft_rel(doc_rel)
    assert (ws / rel).is_file(), f"前置：草稿文件未按预期落盘 {rel}"
    return rel


@pytest.fixture(autouse=True)
def _isolate_recent(client):
    """app_config 在会话内共享（conftest 的 KE_APP_CONFIG 路径固定）→ 每个用例先清空最近列表。"""
    _clear_recent(client)
    yield


# ===========================================================================
# 断言原语
# ===========================================================================
def _assert_safe_doc_name(name: str, *, require_md: bool = True) -> None:
    """落盘文件名的最小契约（与文档模型 + 统一净化策略一致）。"""
    assert name and name not in (".", ".."), f"非法落盘名: {name!r}"
    assert "/" not in name and "\\" not in name, f"落盘名含路径分隔符: {name!r}"
    bad = sorted(set(name) & _ILLEGAL)
    assert not bad, f"落盘名仍含非法字符 {bad}: {name!r}"
    assert not re.search(r"[\x00-\x1f\x7f]", name), f"落盘名含控制字符: {name!r}"
    assert not name.startswith("."), f"落盘名以点开头（隐藏文件）: {name!r}"
    assert not name.endswith((".", " ")), f"落盘名以点/空格结尾: {name!r}"
    assert name == name.strip(), f"落盘名首尾有空白: {name!r}"
    assert len(name.encode("utf-8")) <= 255, f"落盘名超过 255 字节: {len(name.encode('utf-8'))}"
    stem = name.split(".", 1)[0].lower()
    assert stem not in _WIN_RESERVED, f"Windows 保留名未加前缀: {name!r}"
    if require_md:
        assert name.lower().endswith((".md", ".markdown")), (
            f"落盘名不再以 .md/.markdown 结尾 → 文档在文件树/索引中不可见: {name!r}"
        )


def _assert_move_ok(client, src_rel: str, dst_sent: str, *, expect_to: str | None = None,
                    expect_parent: str | None = None, require_md: bool = True,
                    allow_drafts: bool = False) -> dict:
    """合法移动：200 + 原子 rename（inode 保持）+ 字节不变 + 无额外落盘。

    `allow_drafts=True` 用于 F12 场景：Drafts/recovery/ 下的草稿改名是**预期**的
    额外变更，不计入「意外落盘」（草稿侧仍由各用例独立断言）。
    """
    ws = _ws(client)
    src = ws / src_rel
    is_dir_src = src.is_dir()
    assert is_dir_src or src.is_file(), f"前置：源不存在 {src_rel}"
    src_sha = None if is_dir_src else _sha256_file(src)
    src_ino = src.stat().st_ino
    before = _snapshot(ws)

    r = _move(client, src_rel, dst_sent)
    assert r.status_code == 200, (
        f"{src_rel} -> {dst_sent!r} 期望 200，实际 {r.status_code}: {_detail(r)}"
    )
    body = r.json()
    assert set(body) >= {"from", "to"}, f"响应字段不足: {body}"
    assert body["from"] == src_rel, f"from 不符: {body['from']!r} != {src_rel!r}"

    to = body["to"]
    dst = ws / to
    assert not src.exists(), "旧路径仍存在（不是 rename 语义）"
    assert dst.stat().st_ino == src_ino, "inode 变化 → 不是原子 rename（疑似 copy+delete）"

    after = _snapshot(ws)

    def _is_draft(rel: str) -> bool:
        return rel.startswith(_DRAFT_DIR + "/")

    if is_dir_src:
        # 目录移动：期望「子树整体改名」，逐文件比对内容映射
        assert dst.is_dir(), f"响应 to={to!r} 不是目录（目录移动）"
        expect_removed = sorted(rel for rel in before if rel == src_rel or rel.startswith(src_rel + "/"))
        expect_added = sorted(rel for rel in after if rel == to or rel.startswith(to + "/"))
        mapping = {rel: to + rel[len(src_rel):] for rel in expect_removed}
        for old_rel, new_rel in mapping.items():
            assert after.get(new_rel) == before[old_rel], (
                f"目录移动后文件内容/位置不符: {old_rel} -> {new_rel}"
            )
    else:
        assert dst.is_file(), f"响应 to={to!r} 与实际落盘不一致（磁盘不存在）"
        assert _sha256_file(dst) == src_sha, "移动后文档内容字节改变"
        expect_removed = [src_rel]
        expect_added = [to]

    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    if allow_drafts:
        added = [r_ for r_ in added if not _is_draft(r_)]
        removed = [r_ for r_ in removed if not _is_draft(r_)]
    assert removed == expect_removed, (
        f"移动删除了意外文件/目录内容: 实际 {removed}，期望 {expect_removed}"
    )
    assert added == expect_added, f"移动产生了意外落盘: 实际 {added}，期望 {expect_added}"

    if not is_dir_src:
        _assert_safe_doc_name(Path(to).name, require_md=require_md)
    if expect_to is not None:
        assert to == expect_to, f"落盘路径不符：实际 {to!r}，期望 {expect_to!r}"
    if expect_parent is not None:
        assert Path(to).parent.as_posix() == expect_parent, (
            f"落盘父目录不符：实际 {Path(to).parent.as_posix()!r}，期望 {expect_parent!r}"
        )
    assert to.split("/")[0] == src_rel.split("/")[0], "移动跨出了顶层目录"
    return body


def _assert_move_rejected(client, src_rel: str, dst_sent: str, *, allowed=(400, 409, 422),
                          dir_hint: bool = False) -> tuple[int, str]:
    """非法/冲突移动：4xx + 零落盘副作用 + 源文件未动。"""
    ws = _ws(client)
    src = ws / src_rel
    assert src.is_file(), f"前置：源文件不存在 {src_rel}"
    before = _snapshot(ws)
    src_sha = _sha256_file(src)

    try:
        r = _move(client, src_rel, dst_sent)
    except Exception as exc:  # noqa: BLE001
        pytest.fail(
            f"{src_rel} -> {dst_sent!r} 未返回 HTTP 响应而是抛出 {type(exc).__name__}: {exc}"
            "（真实 uvicorn 下即 500；F9 家族不允许）"
        )
    detail = _detail(r)
    after = _snapshot(ws)
    assert before == after, (
        f"失败请求产生落盘副作用: +{sorted(set(after) - set(before))} "
        f"-{sorted(set(before) - set(after))}"
    )
    assert r.status_code in allowed, f"期望 {allowed}，实际 {r.status_code}: {detail}"
    assert src.is_file() and _sha256_file(src) == src_sha, "失败请求改动了源文件"
    if dir_hint:
        assert any(k in detail for k in ("文件夹", "目录", "folder", "directory")), (
            f"dst 指向已存在目录，但文案未点明「目录/文件夹」: {detail!r}"
        )
        assert detail != f"目标已存在: {dst_sent}", "仍是误导性的裸「目标已存在」文案"
    return r.status_code, detail


# ===========================================================================
# F9c：目标文件名净化
# ===========================================================================
_F9C_SANITIZE_CASES = [
    pytest.param("Articles/非法:名*.md", "illegal-colon-star"),
    pytest.param("Articles/尖<括>号.md", "angle-brackets"),
    pytest.param("Articles/问号?.md", "question"),
    pytest.param("Articles/竖线|名.md", "pipe"),
    pytest.param('Articles/引号"名.md', "quote"),
    pytest.param("Articles/反斜杠\\名.md", "backslash"),
    pytest.param("Articles/CON.md", "reserved-con"),
    pytest.param("Articles/NUL.md", "reserved-nul"),
    pytest.param("Articles/PRN.md", "reserved-prn"),
    pytest.param("Articles/AUX.md", "reserved-aux"),
    pytest.param("Articles/COM1.md", "reserved-com1"),
    pytest.param("Articles/LPT1.md", "reserved-lpt1"),
    pytest.param("Articles/con.md", "reserved-lower"),
    pytest.param("Articles/尾点.md.", "trailing-dot"),
    pytest.param("Articles/尾空格.md ", "trailing-space"),
    pytest.param("Articles/ 前导空格.md", "leading-space"),
    pytest.param("Articles/.hidden.md", "leading-dot"),
    pytest.param("Articles/我的 报告 v2.md", "cjk-space"),
    pytest.param("Articles/" + ("长" * 150) + ".md", "cjk-150"),
    pytest.param("Articles/" + ("a" * 295) + ".md", "len-299"),
    pytest.param("Articles/" + ("a" * 300) + ".md", "len-304"),
    pytest.param("Articles/控制\x01字符\x07.md", "control-chars"),
    pytest.param("Articles/制表\t符.md", "tab"),
    pytest.param("Articles/换\n行.md", "newline"),
    pytest.param("Articles/....md", "only-dots-ext"),
    pytest.param("Articles/...", "all-dots-no-ext"),
    pytest.param("Articles/.md", "hidden-md-only"),
    pytest.param("Articles/..md", "dotdot-md"),
    pytest.param("Articles/.. .md", "dot-space-dot-md"),
]


@pytest.mark.parametrize("dst_sent, case_id", _F9C_SANITIZE_CASES)
def test_f9c_sanitizes_illegal_target_name(client, dst_sent, case_id):
    """F9c：dst 末段必须过统一净化（不是驳回、不得 500），且落盘在业务目录内。

    每条断言：200 + 响应 to == 实际 + 无非法字符/控制字符/保留名/超长 +
    仍以 .md 结尾（文档模型硬要求）+ 原子 rename + 内容字节不变。
    """
    src = _new_doc(client, "待移动源", "# 正文\n\nke-attach: 无\n")
    body = _assert_move_ok(client, src, dst_sent)
    to = body["to"]
    ws = _ws(client)
    print(f"[ke-verify] F9c[{case_id}] {dst_sent!r:>45} -> {to!r}")
    assert (ws / to).parent == (ws / "Articles"), f"应仍在 Articles 下: {to!r}"


def test_f9c_exact_cjk_space_name_preserved(client):
    """CJK/空格/大小写：无非法字符时净化必须**不改变**名称。"""
    src = _new_doc(client, "原文档")
    body = _assert_move_ok(client, src, "Articles/我的 报告 v2.md",
                           expect_to="Articles/我的 报告 v2.md")
    assert body["to"] == "Articles/我的 报告 v2.md"


def test_f9c_nul_in_dst_must_not_500(client):
    """NUL：修复前实测 `_guard_rel → safe_rel_path → Path.resolve()` 抛未捕获 ValueError。

    修复前基线（工作树 3f97f1a，本验证员实测）：
      `POST /api/fs/move {"dst":"Articles/a\\u0000b.md"}` → `ValueError: lstat: embedded
      null character in path`（真实 uvicorn 下 500）。F9c 的净化必须在解析前/或捕获该
      异常 → 允许 200（净化掉）或 400，**绝不允许 500/未处理异常**。
    """
    src = _new_doc(client, "NUL 目标源")
    ws = _ws(client)
    before = _snapshot(ws)
    try:
        r = _move(client, src, "Articles/a\u0000b.md")
    except Exception as exc:  # noqa: BLE001
        pytest.fail(f"NUL dst 抛出未处理异常（= 500）: {type(exc).__name__}: {exc}")
    after = _snapshot(ws)
    assert r.status_code < 500, f"NUL dst → {r.status_code}: {_detail(r)}"
    if r.status_code == 200:
        to = r.json()["to"]
        _assert_safe_doc_name(Path(to).name)
        assert (ws / to).is_file()
        assert before != after, "返回 200 但磁盘无变化（响应与落盘不一致）"
    else:
        assert before == after, "被拒但仍产生落盘副作用"
        assert (ws / src).is_file(), "被拒但源文件受损"


def test_f9c_nul_in_src_must_not_500(client):
    """src 含 NUL 同样不得 500（同一 safe_rel_path 路径）。"""
    ws = _ws(client)
    _write_file(ws, "Articles/正常.md", "# x")
    try:
        r = _move(client, "Articles/正\u0000常.md", "Articles/新名.md")
    except Exception as exc:  # noqa: BLE001
        pytest.fail(f"NUL src 抛出未处理异常（= 500）: {type(exc).__name__}: {exc}")
    assert r.status_code < 500, f"NUL src → {r.status_code}: {_detail(r)}"


def test_f9c_does_not_sanitize_directory_segments(client):
    """只净化末段：目录名含 `:`（Linux 合法）时不得被改写，否则目标目录不存在。"""
    ws = _ws(client)
    _mk_dir(client, "Articles/we:ird")
    assert (ws / "Articles/we:ird").is_dir()
    src = _new_doc(client, "目录段源")
    _assert_move_ok(client, src, "Articles/we:ird/新名.md",
                    expect_to="Articles/we:ird/新名.md",
                    expect_parent="Articles/we:ird")


def test_f9c_sanitized_collision_returns_409_no_side_effect(client):
    """净化后与既有文件同名 → 409（不是静默覆盖，也不是 500）。"""
    ws = _ws(client)
    _write_file(ws, "Articles/x y.md", "# 既有")
    src = _new_doc(client, "冲突源")
    # 连续空格会被折叠为单空格 → 与既有 "x y.md" 同名
    status, detail = _assert_move_rejected(client, src, "Articles/x    y.md", allowed=(400, 409))
    assert (ws / "Articles/x y.md").read_text(encoding="utf-8") == "# 既有", "既有文件被覆盖"
    print(f"[ke-verify] 清洗后冲突 → {status} {detail}")


# ===========================================================================
# F9c/归一化：不得把路径挪出顶层
# ===========================================================================
_NORMALIZE_CASES = [
    pytest.param("Articles/..", "dotdot-to-workspace-root"),
    pytest.param("Articles/.", "dot-current"),
    pytest.param("Articles/../../../../etc/passwd.md", "deep-escape"),
    pytest.param("Articles/../绕过.md", "escape-to-root"),
    pytest.param("Articles/../Modules/绕过.md", "cross-top"),
    pytest.param("Articles/sub/../../Modules/绕过.md", "subdir-cross-top"),
    pytest.param("Articles/./../Modules/绕过.md", "dot-then-cross-top"),
    pytest.param("Articles/../Drafts/绕过.md", "into-drafts"),
    pytest.param("Articles/../Trash/绕过.md", "into-trash"),
    pytest.param("Articles/../Modules/CON.md", "cross-top-reserved"),
]


@pytest.mark.parametrize("dst_sent, case_id", _NORMALIZE_CASES)
def test_f9c_normalized_dst_cannot_leave_top_or_workspace(client, dst_sent, case_id):
    """净化/归一化都不得把目标挪出业务顶层（F8 修复的核心不变量）。"""
    src = _new_doc(client, "归一化源")
    status, detail = _assert_move_rejected(client, src, dst_sent, allowed=(400,))
    print(f"[ke-verify] 归一化拒绝[{case_id}] {dst_sent!r:>45} -> {status} {detail}")


@pytest.mark.parametrize(
    "dst_sent,expect_to",
    [
        pytest.param("Articles/./新名.md", "Articles/新名.md", id="dot-segment"),
        pytest.param("Articles/子/../新名.md", "Articles/新名.md", id="subdir-dotdot"),
        pytest.param("Articles//新名.md", "Articles/新名.md", id="double-slash"),
        pytest.param("Modules/../Articles/新名.md", "Articles/新名.md", id="modules-dotdot-articles"),
    ],
)
def test_f9c_normalized_dst_still_lands_correctly(client, dst_sent, expect_to):
    """归一化后的合法目标必须正常落盘，且响应 to 是归一化路径。"""
    src = _new_doc(client, "归一化正常源")
    _assert_move_ok(client, src, dst_sent, expect_to=expect_to)


# ===========================================================================
# F9b：dst 指向已存在目录 / 文件 / 目录内新名
# ===========================================================================
def test_f9b_dst_existing_directory_explicit_message(client):
    """dst 指向已存在子目录 → 明确「文件夹」语义（修复前实测 409「目标已存在: …」）。

    修复前基线（本验证员实测）：`dst="Articles/子目录"`（已存在目录）→
    `409 {"detail":"目标已存在: Articles/子目录"}` —— 用户读不懂。
    """
    _mk_dir(client, "Articles/子目录")
    src = _new_doc(client, "目标目录混淆源")
    status, detail = _assert_move_rejected(client, src, "Articles/子目录",
                                           allowed=(400, 409), dir_hint=True)
    print(f"[ke-verify] F9b 已存在目录 -> {status} {detail}")
    assert "请" in detail or "带上文件名" in detail or "文件名" in detail, (
        f"文案未给出可操作指引（应提示在目标路径里带上文件名）: {detail!r}"
    )


def test_f9b_dst_existing_directory_trailing_slash(client):
    _mk_dir(client, "Articles/目标夹")
    src = _new_doc(client, "斜杠目录源")
    status, detail = _assert_move_rejected(client, src, "Articles/目标夹/",
                                           allowed=(400, 409), dir_hint=True)
    print(f"[ke-verify] F9b 已存在目录(尾斜杠) -> {status} {detail}")


def test_f9b_dst_existing_file_keeps_path_in_message(client):
    """dst 是已存在文件 → 保持 409 且文案含路径（原语义不得丢）。"""
    ws = _ws(client)
    _write_file(ws, "Articles/已存在.md", "# 既有")
    src = _new_doc(client, "撞文件源")
    status, detail = _assert_move_rejected(client, src, "Articles/已存在.md", allowed=(409,))
    assert "Articles/已存在.md" in detail, f"文案未含目标路径: {detail!r}"
    assert (ws / "Articles/已存在.md").read_text(encoding="utf-8") == "# 既有"


def test_f9b_new_name_inside_existing_directory_succeeds(client):
    """dst = 已存在目录 + 新文件名 → 正常移动（与「指向目录」区分开）。"""
    _mk_dir(client, "Articles/归档")
    src = _new_doc(client, "归档内源")
    _assert_move_ok(client, src, "Articles/归档/新名.md",
                    expect_to="Articles/归档/新名.md", expect_parent="Articles/归档")


def test_f9b_directory_src_to_existing_file_rejected(client):
    """目录移动碰到已存在文件 → 4xx 且无副作用。"""
    ws = _ws(client)
    _mk_dir(client, "Articles/目录A")
    _write_file(ws, "Articles/目录A/内.md", "# x")
    _write_file(ws, "Articles/占位.md", "# y")
    before = _snapshot(ws)
    r = _move(client, "Articles/目录A", "Articles/占位.md")
    after = _snapshot(ws)
    assert r.status_code in (400, 409), f"{r.status_code}: {_detail(r)}"
    assert before == after, "目录/文件冲突请求产生落盘副作用"


# ===========================================================================
# F8 不回归：跨区/越界一律 400 且文件在原处
# ===========================================================================
def test_f8_exact_documented_bypass_case_still_400(client):
    """feasibility §3.2 原样用例：`Articles/../Modules/…` 必须 400 且文件仍在原处。"""
    ws = _ws(client)
    src = "Articles/绕过用例A.md"
    _write_file(ws, src, "# 绕过用例正文\n")
    before = _snapshot(ws)
    r = _move(client, src, "Articles/../Modules/绕过用例A.md")
    after = _snapshot(ws)
    assert r.status_code == 400, f"跨区绕过未拒绝: {r.status_code} {_detail(r)}"
    assert before == after, "被拒请求仍有落盘副作用"
    assert (ws / src).is_file(), "源文件不在原处"
    assert not (ws / "Modules/绕过用例A.md").exists(), "文件仍被跨区写入"
    print(f"[ke-verify] F8 原样用例 -> 400 {_detail(r)}")


# ===========================================================================
# P2-15 不回归：被引用附件 / 含引用附件的目录
# ===========================================================================
def _upload_attachment(client, name: str = "被引用.pdf") -> str:
    r = client.post("/api/attachments", files={"file": (name, b"%PDF-1.4 KE-P2-15", "application/pdf")})
    assert r.status_code == 201, r.text[:300]
    return r.json()["path"]


def test_p215_referenced_attachment_move_rejected(client):
    ws = _ws(client)
    att = _upload_attachment(client)
    _write_file(ws, "Articles/引用者.md", f'# 引用\n\n<!-- ke-attach: {{"src":"{att}"}} -->\n')
    before = _snapshot(ws)
    r = _move(client, att, att.rsplit("/", 1)[0] + "/新名.pdf")
    after = _snapshot(ws)
    assert r.status_code == 409, f"被引用附件移动未 409: {r.status_code} {_detail(r)}"
    assert before == after, "409 请求产生落盘副作用"
    assert (ws / att).is_file(), "被引用附件被移走"
    refs = client.get("/api/attachments/list").json()
    assert any(a["rel_path"] == att and a["referenced_by"] for a in refs["attachments"]), "引用链被破坏"


def test_p215_directory_with_referenced_attachment_move_rejected(client):
    ws = _ws(client)
    att = _upload_attachment(client, "目录内.pdf")
    _write_file(ws, "Articles/引用者2.md", f'# 引用\n\n![x]({att})\n')
    parent = att.rsplit("/", 1)[0]  # Attachments/files
    before = _snapshot(ws)
    r = _move(client, parent, "Attachments/归档files")
    after = _snapshot(ws)
    assert r.status_code == 409, f"含被引用附件的目录移动未 409: {r.status_code} {_detail(r)}"
    assert before == after
    assert (ws / att).is_file()
    assert not (ws / "Attachments/归档files").exists()


def test_p215_unreferenced_attachment_still_movable(client):
    """不回归的另一面：未被引用的附件必须仍可移动（保护不得扩大到误伤）。"""
    ws = _ws(client)
    att = _upload_attachment(client, "孤儿.pdf")
    new_rel = att.rsplit("/", 1)[0] + "/孤儿改名.pdf"
    _assert_move_ok(client, att, new_rel, expect_to=new_rel, require_md=False)


def test_p215_cross_top_attachment_move_rejected(client):
    att = _upload_attachment(client, "跨区.pdf")
    _assert_move_rejected(client, att, f"Articles/{Path(att).name}", allowed=(400,))


# ===========================================================================
# F11：最近更新（recent-documents）同步
# ===========================================================================
def test_f11_move_updates_rel_path_keeps_order_and_title(client):
    """移动后 rel_path 同步为新路径；title 与顺序不变；无旧路径残留。

    修复前基线（本验证员实测）：移动后仍返回旧 `Articles/基线文档.md`。
    """
    a = _new_doc(client, "最近A", "# A")
    b = _new_doc(client, "最近B", "# B")
    c = _new_doc(client, "最近C", "# C")
    for rel, title in ((a, "标题A"), (b, "标题B"), (c, "标题C")):
        _add_recent(client, rel, title)
    before = [d["rel_path"] for d in _recent(client)]
    assert before == [c, b, a], f"前置顺序异常: {before}"

    body = _assert_move_ok(client, b, "Articles/最近B-移动.md")
    new_rel = body["to"]
    items = _recent(client)
    assert [d["rel_path"] for d in items] == [c, new_rel, a], (
        f"最近列表未同步或顺序变化: {[d['rel_path'] for d in items]}"
    )
    assert items[1]["title"] == "标题B", f"title 未保留: {items[1]}"
    assert all(d["rel_path"] != b for d in items), "旧路径仍残留在最近列表"


def test_f11_doc_not_in_recent_is_noop_for_others(client):
    ws = _ws(client)
    x = _new_doc(client, "未记录文档")
    y = _new_doc(client, "已记录文档")
    _add_recent(client, y, "Y")
    before = _recent(client)
    _assert_move_ok(client, x, "Articles/未记录文档-移动.md")
    assert _recent(client) == before, "移动未记录文档改动了最近列表"


def test_f11_duplicate_old_and_new_path_deduped(client):
    """最近列表同时含旧/新路径时：移动后不得留下两条。"""
    a = _new_doc(client, "去重文档")
    _add_recent(client, "Articles/去重文档-新.md", "新标题")  # 先放新路径
    _add_recent(client, a, "旧标题")                          # 再把旧路径插到头部
    _assert_move_ok(client, a, "Articles/去重文档-新.md")
    items = _recent(client)
    paths = [d["rel_path"] for d in items]
    assert paths.count("Articles/去重文档-新.md") == 1, f"新路径重复: {paths}"
    assert a not in paths, f"旧路径残留: {paths}"
    print(f"[ke-verify] F11 去重后 = {paths}")


def test_f11_cap_20_and_order_preserved(client):
    """上限 20 且移动头项后仍为 20，其余顺序不变。"""
    docs = []
    for i in range(25):
        rel = f"Articles/大量文档{i:02d}.md"
        _write_file(_ws(client), rel, f"# {i}")
        docs.append(rel)
    for rel in docs:
        _add_recent(client, rel, rel)
    before = [d["rel_path"] for d in _recent(client)]
    assert len(before) == 20, f"最近列表上限未生效: {len(before)}"
    head = before[0]
    body = _assert_move_ok(client, head, "Articles/大量文档-移动.md")
    after = _recent(client)
    assert len(after) == 20, f"移动后超出/丢失上限: {len(after)}"
    assert [d["rel_path"] for d in after][0] == body["to"]
    assert [d["rel_path"] for d in after][1:] == before[1:], "非头项顺序被改动"


@pytest.mark.parametrize(
    "dst_sent,allowed",
    [
        pytest.param("Articles/../Modules/失败.md", (400,), id="cross-top"),
        pytest.param("Articles/..", (400,), id="escape-root"),
    ],
)
def test_f11_failed_move_does_not_touch_recent(client, dst_sent, allowed):
    src = _new_doc(client, "失败移动源")
    _add_recent(client, src, "失败源")
    before = _recent(client)
    _assert_move_rejected(client, src, dst_sent, allowed=allowed)
    assert _recent(client) == before, "移动失败却改动了最近列表"


def test_f11_failed_move_existing_target_does_not_touch_recent(client):
    ws = _ws(client)
    src = _new_doc(client, "冲突最近源")
    _write_file(ws, "Articles/占位2.md", "# 占位")
    _add_recent(client, src, "冲突源")
    before = _recent(client)
    _assert_move_rejected(client, src, "Articles/占位2.md", allowed=(409,))
    assert _recent(client) == before


def test_f11_migration_persisted_to_app_config_json(client):
    """持久化独立核验：迁移必须落盘到 app_config.json（重启后仍生效），而不是内存视图。"""
    import json

    from app import config as app_config_mod

    a = _new_doc(client, "持久化A")
    b = _new_doc(client, "持久化B")
    _add_recent(client, a, "A")
    _add_recent(client, b, "B")
    body = _assert_move_ok(client, b, "Articles/持久化B-移动.md")

    cfg_path = app_config_mod.APP_CONFIG_PATH
    assert cfg_path.is_file(), f"app_config.json 不存在: {cfg_path}"
    data = json.loads(cfg_path.read_text(encoding="utf-8"))
    persisted = [item["rel_path"] for item in data.get("recent_documents", [])]
    assert body["to"] in persisted, f"新路径未持久化: {persisted}"
    assert b not in persisted, f"旧路径仍在磁盘配置中: {persisted}"
    assert data["recent_documents"][0]["title"] == "B", "title 未随迁移持久化"


# ===========================================================================
# F12：recovery 草稿迁移（数据安全，最高优先）
# ===========================================================================
_DRAFT_CONTENT = (
    "\ufeff---\r\nke_version: 1\r\ntitle: \"草稿标题\"\r\n---\r\n\r\n"
    "# 未保存的中文内容\r\n\r\n"
    "<!-- ke-attach: {\"src\":\"Attachments/files/x.pdf\",\"title\":\"含 } 括号\"} -->\r\n"
)


def test_f12_move_migrates_draft_bytes_and_record(client):
    """① 有草稿移动 → 新路径可恢复、旧路径不残留、草稿**逐字节不变**。"""
    ws = _ws(client)
    old = _new_doc(client, "草稿文档", "# 已保存 v1")
    old_draft = _register_draft(client, ws, old, _DRAFT_CONTENT)
    old_bytes = (ws / old_draft).read_bytes()
    _assert_move_ok(client, old, "Articles/草稿文档2.md", allow_drafts=True)
    new = "Articles/草稿文档2.md"
    new_draft = _draft_rel(new)

    assert not (ws / old_draft).exists(), f"旧草稿残留: {old_draft}"
    assert (ws / new_draft).is_file(), f"新草稿未生成: {new_draft}"
    assert (ws / new_draft).read_bytes() == old_bytes, "草稿内容在迁移中被改写（必须逐字节不变）"

    items = _recovery_items(client)
    assert len(items) == 1, f"恢复记录数异常: {items}"
    assert items[0]["doc_path"] == new, f"记录仍指向旧路径: {items[0]}"
    assert items[0]["draft_path"] == new_draft, f"draft_path 未同步: {items[0]}"
    assert items[0]["draft_path"].startswith(_DRAFT_DIR + "/"), "draft_path 越出 Drafts/recovery/"
    assert old not in [i["doc_path"] for i in items], "旧 doc_path 仍可查出记录"

    drafts = sorted(p.name for p in (ws / _DRAFT_DIR).glob("*.draft.md"))
    assert drafts == [Path(new_draft).name], f"Drafts/recovery 出现多余草稿: {drafts}"

    # DB 级独立核验（不走 API 视图）：记录确实被迁移，旧行不存在
    store = client.app.state.store
    assert store.get_recovery(old) is None, "SQLite 中仍存在旧路径的 recovery 行"
    row = store.get_recovery(new)
    assert row is not None and row.get("draft_path") == new_draft, f"DB 行未迁移: {row}"


def test_f12_restore_still_works_after_move(client):
    """⑤ 移动后 restore 语义仍可用（草稿内容写回新路径并清理）。"""
    ws = _ws(client)
    old = _new_doc(client, "可恢复文档", "# 已保存")
    _register_draft(client, ws, old, _DRAFT_CONTENT)
    body = _assert_move_ok(client, old, "Articles/可恢复文档2.md", allow_drafts=True)
    new = body["to"]

    r = client.post("/api/drafts/recovery/restore", json={"doc_path": new})
    assert r.status_code == 200, f"restore 失败: {r.status_code} {_detail(r)}"
    payload = r.json()
    assert "未保存的中文内容" in payload.get("content", ""), "restore 返回内容不含草稿正文"
    assert payload.get("path") == new
    assert (ws / new).is_file(), "restore 未写回文档"
    assert _recovery_items(client) == [], "restore 后恢复记录未清空"
    assert list((ws / _DRAFT_DIR).glob("*.draft.md")) == [], "restore 后草稿文件未删除"


def test_f12_no_draft_is_noop(client):
    """② 无草稿 → 迁移为 no-op，不产生任何 Drafts/recovery 副作用。"""
    ws = _ws(client)
    src = _new_doc(client, "无草稿文档")
    assert list((ws / _DRAFT_DIR).glob("*.draft.md")) == []
    _assert_move_ok(client, src, "Articles/无草稿文档2.md")
    assert list((ws / _DRAFT_DIR).glob("*.draft.md")) == [], "无草稿移动却产生了草稿"
    assert _recovery_items(client) == []


def test_f12_failed_move_leaves_draft_untouched(client):
    """③ 移动失败（4xx）→ 草稿文件与恢复记录原样不动。"""
    ws = _ws(client)
    old = _new_doc(client, "失败草稿文档", "# v1")
    draft = _register_draft(client, ws, old, _DRAFT_CONTENT)
    draft_sha = _sha256_file(ws / draft)
    before_items = _recovery_items(client)

    _assert_move_rejected(client, old, "Articles/../Modules/失败草稿文档.md", allowed=(400,))
    _assert_move_rejected(client, old, "Articles", allowed=(400, 409))

    assert (ws / draft).is_file() and _sha256_file(ws / draft) == draft_sha, "失败移动改动了草稿"
    assert _recovery_items(client) == before_items, "失败移动改动了恢复记录"
    assert (ws / old).is_file()


def test_f12_draft_never_leaves_recovery_dir(client):
    """④ 白名单不变量：任何迁移后草稿路径都必须仍在 Drafts/recovery/ 内。"""
    ws = _ws(client)
    doc = _new_doc(client, "白名单文档")
    _register_draft(client, ws, doc, _DRAFT_CONTENT)
    _mk_dir(client, "Articles/白名单夹")
    _assert_move_ok(client, doc, "Articles/白名单夹/白名单文档2.md", allow_drafts=True)
    for item in _recovery_items(client):
        draft_path = item["draft_path"]
        assert draft_path.startswith(_DRAFT_DIR + "/"), f"草稿越出白名单: {draft_path}"
        assert ".." not in Path(draft_path).parts, f"草稿路径含 ..: {draft_path}"
        assert (ws / draft_path).is_file(), f"记录指向不存在的草稿: {draft_path}"
    on_disk = sorted(p.name for p in (ws / _DRAFT_DIR).glob("*.draft.md"))
    assert len(on_disk) == 1, f"Drafts/recovery 文件数异常: {on_disk}"


def test_f12_dir_scan_fallback_finds_migrated_draft(client):
    """P1-14 兜底：DB 记录丢失时，移动后目录扫描仍能把草稿关联到新路径。"""
    ws = _ws(client)
    old = _new_doc(client, "扫描兜底文档")
    _register_draft(client, ws, old, _DRAFT_CONTENT)
    client.app.state.store.clear_recovery(old)  # 模拟索引/记录损坏
    assert [i for i in _recovery_items(client) if i["doc_path"] == old] != []
    _assert_move_ok(client, old, "Articles/扫描兜底文档2.md", allow_drafts=True)
    new = "Articles/扫描兜底文档2.md"
    items = _recovery_items(client)
    assert [i for i in items if i["doc_path"] == new], f"目录扫描未能反查新路径: {items}"
    assert all(i["doc_path"] != old for i in items), f"旧路径仍被扫出: {items}"


def test_f12_sanitized_dst_migrates_draft_to_actual_path(client):
    """F9c × F12：dst 被净化时，草稿必须跟随**实际落盘路径**（不是用户输入串）。"""
    ws = _ws(client)
    old = _new_doc(client, "净化草稿文档")
    _register_draft(client, ws, old, _DRAFT_CONTENT)
    body = _assert_move_ok(client, old, "Articles/净化:草稿*.md", allow_drafts=True)
    new = body["to"]
    expected_draft = _draft_rel(new)
    assert (ws / expected_draft).is_file(), f"草稿未跟随实际路径 {new!r}（期望 {expected_draft}）"
    items = _recovery_items(client)
    assert len(items) == 1 and items[0]["doc_path"] == new, f"记录不符: {items}"
    print(f"[ke-verify] F9c×F12 实际路径={new!r} 草稿={items[0]['draft_path']!r}")


def test_f12_directory_move_migrates_contained_draft(client):
    """目录移动：目录内文档的草稿也必须迁移（否则草稿成孤儿 = 未保存内容失联）。"""
    ws = _ws(client)
    _mk_dir(client, "Articles/目录甲")
    inner = "Articles/目录甲/内含文档.md"
    _write_file(ws, inner, "# 目录内正文")
    _register_draft(client, ws, inner, _DRAFT_CONTENT)

    body = _assert_move_ok(client, "Articles/目录甲", "Articles/目录乙", allow_drafts=True)
    assert body["to"] == "Articles/目录乙"
    new_inner = "Articles/目录乙/内含文档.md"
    expected_draft = _draft_rel(new_inner)
    assert (ws / expected_draft).is_file(), (
        f"目录移动后草稿未迁移: 期望 {expected_draft}, 实际 {sorted(p.name for p in (ws/_DRAFT_DIR).glob('*.draft.md'))}"
    )
    assert not (ws / _draft_rel(inner)).exists(), "旧草稿残留（孤儿）"
    items = _recovery_items(client)
    assert [i for i in items if i["doc_path"] == new_inner], f"目录移动后记录未指向新路径: {items}"


def test_f12_move_does_not_touch_draft_of_other_doc(client):
    """只迁移被移动文档的草稿，其他文档的草稿/记录不得被牵连。"""
    ws = _ws(client)
    d1 = _new_doc(client, "文档一")
    d2 = _new_doc(client, "文档二")
    draft1 = _register_draft(client, ws, d1, "DRAFT-ONE")
    draft2 = _register_draft(client, ws, d2, "DRAFT-TWO")
    sha2 = _sha256_file(ws / draft2)
    _assert_move_ok(client, d1, "Articles/文档一-移动.md", allow_drafts=True)
    assert (ws / draft2).is_file() and _sha256_file(ws / draft2) == sha2, "无关文档的草稿被改动"
    items = {i["doc_path"]: i for i in _recovery_items(client)}
    assert d2 in items and items[d2]["draft_path"] == draft2
    assert "Articles/文档一-移动.md" in items
    assert d1 not in items


# ===========================================================================
# 不变量：原子性 / 受保护根 / 404 / 端点面
# ===========================================================================
def test_invariant_forbidden_roots_still_blocked(client):
    ws = _ws(client)
    _write_file(ws, "Articles/普通.md", "# x")
    for top in ("Drafts", "Trash", ".knowledgeeditor"):
        r = _move(client, "Articles/普通.md", f"{top}/x.md")
        assert r.status_code == 400, f"dst={top} 未被拒: {r.status_code} {_detail(r)}"
        r2 = _move(client, f"{top}/x.md", "Articles/x.md")
        assert r2.status_code == 400, f"src={top} 未被拒: {r2.status_code} {_detail(r2)}"
    d = client.delete("/api/fs/dir", params={"path": "Trash"})
    assert d.status_code == 400, f"Trash 可被删除: {d.status_code}"
    c = client.post("/api/fs/dir", json={"path": "Trash/子"})
    assert c.status_code == 400, f"Trash 下可建目录: {c.status_code}"
    assert (ws / "Articles/普通.md").is_file(), "受保护根用例改动了源文件"


def test_invariant_missing_src_is_404(client):
    r = _move(client, "Articles/不存在.md", "Articles/新.md")
    assert r.status_code == 404, f"{r.status_code}: {_detail(r)}"


def test_invariant_move_is_atomic_rename_no_temp_files(client):
    """同顶层 move 仍是原子 rename：inode 保持 + 无 .tmp 残留（已在 _assert_move_ok 断言）。"""
    ws = _ws(client)
    src = _new_doc(client, "原子性文档", "# 原子")
    _mk_dir(client, "Articles/原子夹")
    _assert_move_ok(client, src, "Articles/原子夹/原子性文档.md")
    leftovers = [p for p in ws.rglob("*") if p.name.startswith(".tmp-") or p.name.endswith(".tmp")]
    assert leftovers == [], f"出现临时文件残留: {leftovers}"


def test_invariant_openapi_move_endpoint_unchanged(client):
    """无新端点：/api/fs/move 仍恰好一个 POST，且不存在子路径端点。"""
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    assert "/api/fs/move" in paths, "move 端点消失"
    assert set(paths["/api/fs/move"].keys()) == {"post"}, f"方法集变化: {paths['/api/fs/move']}"
    subs = [p for p in paths if p.startswith("/api/fs/move/")]
    assert subs == [], f"新增了 move 子端点: {subs}"


# ===========================================================================
# F9c 扩展名收敛（冻结修订新语义）+ F9b 检查顺序 —— lead 指定独立核验
# ===========================================================================
class TestExtensionConvergence:
    """冻结语义：目标末段扩展名收敛到**源文件类型**（文档恒 .md/.markdown）。

    验证员独立核验点：实际落盘名、响应 `to`、以及「是否会让用户改名改出意外名字」。
    """

    def test_no_ext_dst_gets_source_md(self, client):
        src = _new_doc(client, "无扩展源")
        _assert_move_ok(client, src, "Articles/新名", expect_to="Articles/新名.md")

    def test_other_ext_dst_converges_to_md(self, client):
        """用户写 `新名.txt` → 文档仍必须是 `.md`（否则从树里消失）；响应 `to` 为准。"""
        src = _new_doc(client, "异扩展源")
        body = _assert_move_ok(client, src, "Articles/新名.txt", expect_to="Articles/新名.md")
        print(f"\n[ke-verify] dst='Articles/新名.txt' -> to={body['to']!r}")

    def test_markdown_ext_source_keeps_markdown(self, client):
        ws = _ws(client)
        _write_file(ws, "Articles/源文档.markdown", "# markdown 扩展")
        _assert_move_ok(client, "Articles/源文档.markdown", "Articles/新名",
                        expect_to="Articles/新名.markdown")

    def test_idempotent_md_dst(self, client):
        src = _new_doc(client, "幂等源")
        _assert_move_ok(client, src, "Articles/新名.md", expect_to="Articles/新名.md")

    def test_attachment_no_ext_dst_gets_source_ext(self, client):
        att = _upload_attachment(client, "收敛附件.pdf")
        to = att.rsplit("/", 1)[0] + "/新名"
        _assert_move_ok(client, att, to, expect_to="Attachments/files/新名.pdf", require_md=False)

    def test_attachment_other_ext_converges_to_source_ext(self, client):
        att = _upload_attachment(client, "收敛附件2.pdf")
        body = _assert_move_ok(client, att, "Attachments/files/新名.png",
                               expect_to="Attachments/files/新名.pdf", require_md=False)
        print(f"[ke-verify] 附件 dst='新名.png' -> to={body['to']!r}（收敛到源类型）")

    def test_extensionless_source_stays_extensionless(self, client):
        ws = _ws(client)
        _write_file(ws, "Attachments/files/无扩展源", "raw")
        _assert_move_ok(client, "Attachments/files/无扩展源", "Attachments/files/新名",
                        expect_to="Attachments/files/新名", require_md=False)

    def test_convergence_collision_returns_409(self, client):
        """`新名.txt` 收敛成 `新名.md` 后撞既有文件 → 409 且零副作用。"""
        ws = _ws(client)
        _write_file(ws, "Articles/新名.md", "# 既有")
        src = _new_doc(client, "收敛冲突源")
        _assert_move_rejected(client, src, "Articles/新名.txt", allowed=(409,))
        assert (ws / "Articles/新名.md").read_text(encoding="utf-8") == "# 既有"

    def test_dir_move_dst_not_given_md_suffix(self, client):
        ws = _ws(client)
        _mk_dir(client, "Articles/目录甲")
        _write_file(ws, "Articles/目录甲/内.md", "# x")
        body = _assert_move_ok(client, "Articles/目录甲", "Articles/目录乙")
        assert body["to"] == "Articles/目录乙", f"目录名被误加扩展名: {body['to']!r}"
        assert (ws / "Articles/目录乙/内.md").is_file()

    def test_control_char_sanitization_exact(self, client):
        """非 NUL 控制字符保留净化（dev 声称 `控制\\x01字符\\x07.md` → `控制 字符.md`）。"""
        src = _new_doc(client, "控制字符源")
        _assert_move_ok(client, src, "Articles/控制\x01字符\x07.md",
                        expect_to="Articles/控制 字符.md")

    def test_f9b_dir_target_checked_before_extension_convergence(self, client):
        """`dst=Articles/子目录`（已存在目录）必须走**文件夹提示**，不得被补成 `子目录.md`。"""
        ws = _ws(client)
        _mk_dir(client, "Articles/子目录")
        src = _new_doc(client, "顺序核验源")
        status, detail = _assert_move_rejected(client, src, "Articles/子目录",
                                               allowed=(409,), dir_hint=True)
        assert not (ws / "Articles/子目录.md").exists(), "目录目标被补成 .md 落盘（绕过提示）"
        assert "文件名" in detail, f"文案未提示补文件名: {detail!r}"
        print(f"\n[ke-verify] F9b 顺序核验 dst='Articles/子目录' -> {status} {detail}")

    def test_dot_path_still_400_after_reorder(self, client):
        """`Articles/.` 归一化后是顶层目录本身 → 仍按 F8 语义 400（不得变成文件夹提示 409）。"""
        src = _new_doc(client, "点路径源")
        status, detail = _assert_move_rejected(client, src, "Articles/.", allowed=(400,))
        print(f"[ke-verify] dst='Articles/.' -> {status} {detail}")

    def test_extension_convergence_observation_matrix(self, client):
        """「用户输入 dst → 实际落盘」对照，用于判断是否会让用户改名改出意外名字。

        硬断言：无 5xx、响应 `to` == 实际落盘、文档仍以 .md/.markdown 结尾。
        """
        ws = _ws(client)
        obs: list[tuple[str, str, object, object]] = []
        for i, dst in enumerate(["Articles/报告.PDF", "Articles/新名.MD", "Articles/新名.tar.md"]):
            src = _new_doc(client, f"收敛观察源{i}")
            r = _move(client, src, dst)
            to = r.json().get("to") if r.status_code == 200 else _detail(r)
            obs.append(("doc", dst, r.status_code, to))
            if r.status_code == 200:
                assert str(to).lower().endswith((".md", ".markdown")), f"文档扩展名异常: {to!r}"

        _write_file(ws, "Articles/观.markdown", "# markdown 源")
        r = _move(client, "Articles/观.markdown", "Articles/观2.md")
        obs.append(("doc(.markdown 源)", "Articles/观2.md", r.status_code, r.json().get("to")))

        att = _upload_attachment(client, "photo.jpeg")
        dst_att = att.rsplit("/", 1)[0] + "/photo.jpg"
        r = _move(client, att, dst_att)
        obs.append(("attachment", dst_att, r.status_code, r.json().get("to")))

        print("\n[ke-verify] 扩展名收敛观察表")
        for kind, dst, status, to in obs:
            print(f"  {kind:>18} | 输入 {dst!r:>32} -> {status} {to!r}")
            assert not (isinstance(status, int) and status >= 500), f"{dst!r} → {status}"
            if status == 200:
                assert (ws / str(to)).is_file(), "响应 to 与实际落盘不一致"


# ===========================================================================
# 观察项（非阻塞）：非 .md 目标 / 名称归一化 等质量面
# ===========================================================================
def test_advisory_observation_table(client):
    """输出「输入 dst → 实际落盘」对照表；仅断言无 5xx + 落在顶层内（质量面观察）。"""
    observations = []
    cases = [
        "Articles/新名.txt",          # 非 .md 目标（文档是否会从树里消失）
        "Articles/cafe\u0301.md",     # NFD → NFC?
        "Articles/名称带 空格.md",
        "Articles/中文名.md",
    ]
    for i, dst in enumerate(cases):
        src = _new_doc(client, f"观察源{i}")
        try:
            r = _move(client, src, dst)
        except Exception as exc:  # noqa: BLE001
            observations.append((dst, f"RAISED {type(exc).__name__}", str(exc)))
            continue
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        to = body.get("to") if r.status_code == 200 else _detail(r)
        observations.append((dst, r.status_code, to))
        if r.status_code == 200:
            assert str(to).split("/", 1)[0] == "Articles", f"落盘越出 Articles: {to!r}"
            assert (_ws(client) / str(to)).is_file(), "响应 to 与实际落盘不一致"

    print("\n[ke-verify] 观察表（dst -> 实际落盘）")
    for dst, status, to in observations:
        print(f"  {dst!r:>40} -> {status} {to!r}")
        assert not (isinstance(status, int) and status >= 500), f"{dst!r} → {status}"
    assert observations
