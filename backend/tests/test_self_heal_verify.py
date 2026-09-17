"""独立对抗验证：K3-I2 方案 A 启动自愈 —— task-23（验证者所有）。

验证对象：task-21「启动自愈」——① `Drafts/recovery/*.draft.md` 按**唯一 stem** 重挂到
现存文档（`Articles/`+`Modules/` 口径），② `Drafts/backup` 孤儿**只统计不删除**。

判据来源（验证员独立推导，不照抄 task-21 验收条目）：
- K3-I2 原文验收：「崩溃注入（rename 中 kill）后重启：文件与索引一致或自动收敛；无孤儿恢复点」；
- `routers/drafts.py::_draft_name/_scan_drafts`（草稿名 = `{stem}-{hash8(完整相对路径)}.draft.md`）
  与 `store.move_recovery`（保留 id/saved_at/session_id）的既有语义；
- 验证员补充攻击面：反向残缺态、非业务顶层同名、子目录/`.markdown` 候选、
  hash 命中优先、全工作区非破坏性不变量、异常注入的**判别性**（注入生效则崩溃态必须保持未愈）。

⚠️ 自解除 gate：`app/services/self_heal.py` 不存在时整模块 skip（不产生假红、不阻塞他人
全量 pytest）；源码落地即自动转实跑，无需手动开关。

运行：
    cd backend && python3 -m pytest tests/test_self_heal_verify.py -o addopts="" -q
"""
from __future__ import annotations

import hashlib
import logging
from contextlib import contextmanager
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# 自解除 gate（task-21 落地即生效）
# ---------------------------------------------------------------------------
_SELF_HEAL_PATH = Path(__file__).resolve().parents[1] / "app" / "services" / "self_heal.py"
_SELF_HEAL_LANDED = _SELF_HEAL_PATH.is_file()
pytestmark = pytest.mark.skipif(
    not _SELF_HEAL_LANDED,
    reason="task-21 未落地：app/services/self_heal.py 不存在（源码落地后自动实跑）",
)

_DRAFT_DIR = "Drafts/recovery"
_BACKUP_DIR = "Drafts/backup"
_DB_NAME = "index.db"

_DRAFT_CONTENT = (
    b"\xef\xbb\xbf---\r\nke_version: 1\r\ntitle: \"\xe4\xb8\xad\xe6\x96\x87\xe6\xa0\x87\xe9\xa2\x98\"\r\n---\r\n\r\n"
    b"# \xe6\x9c\xaa\xe4\xbf\x9d\xe5\xad\x98\xe7\x9a\x84\xe4\xb8\xad\xe6\x96\x87\xe5\x86\x85\xe5\xae\xb9\r\n\r\n"
    b"<!-- ke-attach: {\"src\":\"Attachments/files/x.pdf\",\"title\":\"\xe5\x90\xab } \xe6\213\xac\xe5\x8f\xb7\"} -->\r\n"
)


# ---------------------------------------------------------------------------
# 基础工具（独立实现；不 import 被测自愈模块）
# ---------------------------------------------------------------------------
def _h8(doc_path: str) -> str:
    return hashlib.sha1(doc_path.encode("utf-8")).hexdigest()[:8]


def _draft_name(doc_path: str) -> str:
    return f"{Path(doc_path).stem}-{_h8(doc_path)}.draft.md"


def _draft_rel(doc_path: str) -> str:
    return f"{_DRAFT_DIR}/{_draft_name(doc_path)}"


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _write(root: Path, rel: str, data: bytes | str) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        p.write_text(data, encoding="utf-8")
    else:
        p.write_bytes(data)
    return p


def _snapshot(root: Path, *, include_internal_db: bool = False) -> dict[str, str]:
    """工作区全量文件 rel→sha256（默认排除索引库自身噪声）。"""
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.is_symlink():
            continue
        rel = p.relative_to(root).as_posix()
        if not include_internal_db and rel.startswith(".knowledgeeditor/") and _DB_NAME in rel:
            continue
        out[rel] = _sha(p)
    return out


def _seed_recovery_row(ws: Path, doc_path: str, draft_path: str, session_id: str = "sess-1") -> int:
    """**启动前**直接写 SQLite（不经自愈模块），构造「DB 记录指向旧路径」的崩溃态。"""
    from app.store.db import IndexStore

    db = ws / ".knowledgeeditor" / _DB_NAME
    db.parent.mkdir(parents=True, exist_ok=True)
    store = IndexStore(db).connect()
    try:
        store.add_recovery(doc_path, draft_path, session_id)
        row = store.get_recovery(doc_path)
        assert row is not None
        return int(row["id"])
    finally:
        store.close()


def _db_recovery_rows(ws: Path) -> list[dict]:
    from app.store.db import IndexStore

    db = ws / ".knowledgeeditor" / _DB_NAME
    if not db.is_file():
        return []
    store = IndexStore(db).connect()
    try:
        return [dict(r) for r in store.list_recovery()]
    finally:
        store.close()


@contextmanager
def _boot(ws: Path):
    """**真实启动路径**：把 `config.WORKSPACE_ROOT` 指向本测试工作区后进入 TestClient。

    `app/main.py::lifespan` 在启动时 `activate_workspace(app, config.WORKSPACE_ROOT)`
    并紧接着调用 `self_heal.run_startup_self_heal(...)`——因此必须让 lifespan 打开
    本测试的工作区，自愈才会作用在注入的崩溃态上（冻结实现核对结论）。
    """
    from fastapi.testclient import TestClient

    from app import config as app_config
    from app.main import app

    original = app_config.WORKSPACE_ROOT
    app_config.WORKSPACE_ROOT = Path(ws)
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app_config.WORKSPACE_ROOT = original


def _recovery_items(client) -> list[dict]:
    r = client.get("/api/drafts/recovery")
    assert r.status_code == 200, r.text[:300]
    return r.json()["items"]


def _assert_bytes_unchanged_map(before: dict[str, str], paths: list[Path], root: Path, label: str) -> None:
    for p in paths:
        rel = p.relative_to(root).as_posix()
        assert p.is_file(), f"[{label}] 文件消失（用户内容被删）: {rel}"
        assert _sha(p) == before[rel], f"[{label}] 文件内容被改写: {rel}"


@pytest.fixture()
def ws(tmp_path) -> Path:
    """真实工作区（结构齐全），供测试在 **启动前** 注入崩溃态。"""
    from app.services.workspace import ensure_workspace_structure

    return ensure_workspace_structure(tmp_path / "ws")


@pytest.fixture()
def ws_factory(tmp_path):
    """多工作区工厂（幂等/重复启动用例需要交替创建）。"""
    from app.services.workspace import ensure_workspace_structure

    created: list[Path] = []

    def _make(name: str = "ws") -> Path:
        w = ensure_workspace_structure(tmp_path / name)
        created.append(w)
        return w

    return _make


# ===========================================================================
# A. 崩溃窗口真复现（最高优先）—— 不调自愈函数，直接造崩溃后状态
# ===========================================================================
class TestCrashWindow:
    def test_a1_full_crash_state_is_healed_on_real_startup(self, ws):
        """文档已在新路径 + 草稿带旧 hash + DB 记录指向旧路径 → 启动自愈收敛。"""
        old, new = "Articles/draftdoc.md", "Articles/\u5f52\u6863/draftdoc.md"   # 同 stem（移入子目录）
        _write(ws, new, "# 正文（rename 已完成）\n")          # 文档只在新路径
        assert not (ws / old).exists()
        draft = _write(ws, _draft_rel(old), _DRAFT_CONTENT)   # 草稿带旧 hash
        draft_sha = _sha(draft)
        row_id = _seed_recovery_row(ws, old, _draft_rel(old))

        with _boot(ws) as c:
            items = _recovery_items(c)

        new_draft = ws / _draft_rel(new)
        assert (new_draft).is_file(), f"草稿未改名到规范名: {_draft_rel(new)}"
        assert not (ws / _draft_rel(old)).exists(), "旧草稿仍残留（孤儿未收敛）"
        assert _sha(new_draft) == draft_sha, "草稿内容被改写（必须逐字节不变）"
        assert len(items) == 1, f"恢复记录数异常: {items}"
        assert items[0]["doc_path"] == new, f"记录仍指向旧路径: {items[0]}"
        assert items[0]["draft_path"] == _draft_rel(new), f"draft_path 未同步: {items[0]}"
        assert int(items[0]["id"]) == row_id, "迁移应保留记录 id（字段与移动前一致）"

        rows = _db_recovery_rows(ws)
        assert len(rows) == 1 and rows[0]["doc_path"] == new
        assert rows[0]["draft_path"] == _draft_rel(new)

    def test_a2_file_only_crash_state_reattaches_without_db_row(self, ws):
        """只有草稿文件（无 DB 记录）也要重挂到新路径，内容不变。"""
        old, new = "Articles/onlyfile.md", "Articles/sub/onlyfile.md"
        _write(ws, new, "# 正文\n")
        draft = _write(ws, _draft_rel(old), _DRAFT_CONTENT)
        draft_sha = _sha(draft)
        assert _db_recovery_rows(ws) == []

        with _boot(ws) as c:
            items = _recovery_items(c)

        assert (ws / _draft_rel(new)).is_file(), "草稿未重挂到规范名"
        assert not (ws / _draft_rel(old)).exists()
        assert _sha(ws / _draft_rel(new)) == draft_sha
        assert any(i["doc_path"] == new for i in items), f"GET 未在新路径下取到: {items}"
        assert all(i["doc_path"] != old for i in items), f"旧占位记录仍存在: {items}"

    def test_a3_reverse_partial_state_loses_no_content(self, ws):
        """反向残缺：DB 记录指向旧路径、草稿文件已是新 hash（文件改名完成但记录未迁）。

        硬断言只覆盖「不得删除/改写任何用户内容 + 启动可用」；记录是否被修正作观察项。
        """
        old, new = "Articles/rev.md", "Articles/sub/rev.md"
        _write(ws, new, "# 正文\n")
        new_draft = _write(ws, _draft_rel(new), _DRAFT_CONTENT)   # 草稿已是新 hash
        _seed_recovery_row(ws, old, _draft_rel(old))              # 记录却指向旧 hash 草稿
        before = _snapshot(ws)
        new_draft_sha = _sha(new_draft)

        with _boot(ws) as c:
            items = _recovery_items(c)
            assert c.get("/api/health").status_code == 200

        assert (ws / _draft_rel(new)).is_file()
        assert _sha(ws / _draft_rel(new)) == new_draft_sha, "既有规范草稿被改写"
        _assert_bytes_unchanged_map(before, [ws / new, ws / _draft_rel(new)], ws, "A3")
        print(f"\n[ke-verify] A3 观察：自愈后 GET /recovery = {items}")

    def test_a4_hash_hit_is_untouched(self, ws):
        """草稿 hash 命中现存文档（已规范）→ 路径/字节/mtime 全不动。"""
        doc = "Articles/stable.md"
        _write(ws, doc, "# 正文\n")
        draft = _write(ws, _draft_rel(doc), _DRAFT_CONTENT)
        before = _snapshot(ws)
        mtime = draft.stat().st_mtime_ns

        with _boot(ws) as c:
            items = _recovery_items(c)

        assert _sha(draft) == before[_draft_rel(doc)]
        assert draft.stat().st_mtime_ns == mtime, "命中草稿被无谓改写（幂等性破坏）"
        assert any(i["doc_path"] == doc for i in items)


# ===========================================================================
# B. 歧义 fail-safe（绝不猜）
# ===========================================================================
class TestAmbiguityFailSafe:
    def test_b1_zero_candidates_is_untouched(self, ws, caplog):
        _write(ws, "Articles/some.md", "# 其它文档\n")
        old_name = f"{_DRAFT_DIR}/ghost-{_h8('Articles/ghost-old.md')}.draft.md"
        draft = _write(ws, old_name, _DRAFT_CONTENT)
        before = _snapshot(ws)
        mtime = draft.stat().st_mtime_ns

        with caplog.at_level(logging.WARNING):
            with _boot(ws) as c:
                items = _recovery_items(c)

        assert (ws / old_name).is_file(), "0 候选却改动了/删除了草稿"
        assert not (ws / _draft_rel("Articles/ghost.md")).exists(), "0 候选却把草稿改成了规范名"
        assert draft.stat().st_mtime_ns == mtime
        assert _snapshot(ws) == before, "0 候选场景出现文件增删改"
        assert any(r.levelno >= logging.WARNING for r in caplog.records), "无 WARNING 日志"
        assert all(i["doc_path"] != "Articles/some.md" for i in items), "误挂到无关文档"

    def test_b2_two_same_stem_docs_are_ambiguous(self, ws, caplog):
        """Articles/foo.md 与 Modules/foo.md 同时存在 → 不做任何猜测。"""
        _write(ws, "Articles/foo.md", "# A foo\n")
        _write(ws, "Modules/foo.md", "# M foo\n")
        draft = _write(ws, f"{_DRAFT_DIR}/foo-{_h8('Articles/nowhere.md')}.draft.md", _DRAFT_CONTENT)
        before = _snapshot(ws)

        with caplog.at_level(logging.WARNING):
            with _boot(ws) as c:
                _recovery_items(c)

        assert (ws / draft.relative_to(ws)).is_file(), "歧义草稿被改名"
        assert not (ws / _draft_rel("Articles/foo.md")).exists(), "误挂到 Articles/foo.md（猜了）"
        assert not (ws / _draft_rel("Modules/foo.md")).exists(), "误挂到 Modules/foo.md（猜了）"
        assert _snapshot(ws) == before, "歧义场景出现文件增删改"
        assert any(r.levelno >= logging.WARNING for r in caplog.records), "无 WARNING 日志"

    def test_b3_non_business_tops_are_not_candidates(self, ws):
        """同名但位于 Attachments/Trash/Drafts（非 Articles/Modules）→ 不挂。"""
        _write(ws, "Attachments/files/report.pdf", b"%PDF-1.4")
        _write(ws, "Attachments/files/report.md", "# 附件里的同名 md\n")
        _write(ws, "Trash/20260101-000000-abcd/Articles/report.md", "# 回收站里的同名\n")
        draft = _write(ws, f"{_DRAFT_DIR}/report-{_h8('Articles/nowhere2.md')}.draft.md", _DRAFT_CONTENT)
        before = _snapshot(ws)

        with _boot(ws) as c:
            items = _recovery_items(c)

        assert _snapshot(ws) == before, "非业务顶层同名被误当作候选"
        assert not (ws / _draft_rel("Attachments/files/report.md")).exists()
        assert all("Attachments" not in i["doc_path"] for i in items)
        assert draft.is_file()


# ===========================================================================
# C. 幂等
# ===========================================================================
class TestIdempotency:
    def test_c1_second_startup_changes_nothing(self, ws):
        old, new = "Articles/idem.md", "Articles/sub/idem.md"
        _write(ws, new, "# 正文\n")
        _write(ws, _draft_rel(old), _DRAFT_CONTENT)
        _seed_recovery_row(ws, old, _draft_rel(old))

        with _boot(ws) as c1:
            first_items = _recovery_items(c1)
        snap1 = _snapshot(ws)
        rows1 = _db_recovery_rows(ws)
        mtimes1 = {rel: (ws / rel).stat().st_mtime_ns for rel in snap1}

        with _boot(ws) as c2:
            second_items = _recovery_items(c2)

        snap2 = _snapshot(ws)
        assert snap2 == snap1, (
            f"第二次启动仍有变化: +{sorted(set(snap2) - set(snap1))} -{sorted(set(snap1) - set(snap2))}"
        )
        assert {rel: (ws / rel).stat().st_mtime_ns for rel in snap2} == mtimes1, "第二次启动改写了文件 mtime"
        assert _db_recovery_rows(ws) == rows1, "第二次启动改动了 DB 记录"
        assert second_items == first_items, "第二次启动的 GET 结果不同"


# ===========================================================================
# D. 非破坏性（任何用户内容都不得被删/改写）
# ===========================================================================
class TestNonDestructive:
    def test_d1_orphan_backup_is_preserved(self, ws):
        """`Drafts/backup/{doc_rel}` 孤儿目录 + 内容必须原样保留。"""
        orphan_rel = f"{_BACKUP_DIR}/Articles/gone.md/20260101-000000.md"
        orphan = _write(ws, orphan_rel, "# 历史快照正文\n")
        orphan_sha = _sha(orphan)

        with _boot(ws) as c:
            assert c.get("/api/health").status_code == 200

        assert orphan.is_file(), "孤儿历史快照被删除（违反「只统计不删除」）"
        assert _sha(orphan) == orphan_sha, "孤儿历史快照内容被改写"

    def test_d2_whole_workspace_delta_is_only_expected_heal(self, ws):
        """全工作区不变量：启动前后唯一允许的变化 = 草稿改名 +（可选）记录迁移。"""
        old, new = "Articles/delta.md", "Articles/sub/delta.md"
        _write(ws, new, "# 正文\n")
        _write(ws, _draft_rel(old), _DRAFT_CONTENT)
        _seed_recovery_row(ws, old, _draft_rel(old))
        _write(ws, "Articles/untouched.md", "# 不该被动\n")
        _write(ws, "Modules/untouched.md", "# 不该被动\n")
        _write(ws, f"{_BACKUP_DIR}/Modules/x.md/20260101-000000.md", "# 孤儿快照\n")
        before = _snapshot(ws)

        with _boot(ws):
            pass

        after = _snapshot(ws)
        added = sorted(set(after) - set(before))
        removed = sorted(set(before) - set(after))
        assert added == [_draft_rel(new)], f"出现意外新增: {added}"
        assert removed == [_draft_rel(old)], f"出现意外删除: {removed}"
        for rel in set(before) & set(after):
            if rel in (_draft_rel(old),):
                continue
            assert after[rel] == before[rel], f"既有文件被改写: {rel}"


# ===========================================================================
# E. 不阻断启动（异常注入必须是**判别性**的：注入生效 → 崩溃态保持未愈）
# ===========================================================================
class TestStartupResilience:
    def test_e1_inner_step_exception_does_not_block_startup(self, ws, monkeypatch):
        """「自愈**内部**异常不阻断启动」——注入内部步骤（非总入口）。

        冻结实现核对：`run_startup_self_heal` 自身 try/except 全包（契约「任何情况下
        都不抛出」），因此合规的注入点是其内部步骤（`heal_recovery_drafts` /
        `count_backup_orphans` / `reconcile_recovery_records`）。
        """
        import app.services.self_heal as sh

        old = "Articles/boom.md"
        _write(ws, "Articles/sub/boom.md", "# 正文\n")   # 同 stem（本可被自愈）
        draft = _write(ws, _draft_rel(old), _DRAFT_CONTENT)

        def _boom(*_a, **_k):
            raise RuntimeError("verifier-injected inner heal failure")

        patched: list[str] = []
        for name in ("heal_recovery_drafts", "count_backup_orphans", "reconcile_recovery_records"):
            if callable(getattr(sh, name, None)):
                monkeypatch.setattr(sh, name, _boom)
                patched.append(name)
        assert patched, "自愈内部步骤未导出可注入符号（按实际 API 调整）"

        with _boot(ws) as c:
            assert c.get("/api/health").status_code == 200, "自愈内部异常阻断了启动"
            assert c.get("/api/tree").status_code == 200

        # 判别性：注入生效 → 崩溃态必须保持未愈
        assert draft.is_file(), "注入 raise 后草稿仍被改名 → 注入未命中调用点"
        assert not (ws / _draft_rel("Articles/sub/boom.md")).exists()

    def test_e1b_entry_injection_still_boots(self, ws, monkeypatch):
        """**硬契约**（lead 采纳加固后升格）：把总入口整体替换为抛异常函数 → 应用仍能启动。

        - 加固前（task-23 第一段实测，`main.py` 冻结前）：入口异常 ⇒ `RuntimeError` 冒泡出
          lifespan ⇒ **启动被阻断**（当时仅作观察记录）；
        - 加固后（本冻结版 `main.py` 调用点已 `try/except Exception → logger.exception`）：
          必须仍能启动 + `/api/health` 200 + `/api/tree` 可用。
        判别性：注入生效 ⇒ 崩溃态必须**未愈**（证明异常确实发生在自愈入口，而非补丁未命中）。
        """
        import app.services.self_heal as sh

        old = "Articles/entryboom.md"
        _write(ws, "Articles/sub/entryboom.md", "# 正文\n")     # 同 stem（本可被自愈）
        draft = _write(ws, _draft_rel(old), _DRAFT_CONTENT)

        def _boom(*_a, **_k):
            raise RuntimeError("verifier-injected entry failure")

        monkeypatch.setattr(sh, "run_startup_self_heal", _boom)

        survived = False
        try:
            with _boot(ws) as c:
                assert c.get("/api/health").status_code == 200, "入口异常时 /api/health 不可用"
                assert c.get("/api/tree").status_code == 200, "入口异常时 /api/tree 不可用"
                survived = True
        except Exception as exc:  # noqa: BLE001
            pytest.fail(f"入口抛异常阻断了启动（调用点兜底失效）: {type(exc).__name__}: {exc}")
        assert survived is True
        # 判别性：注入生效 ⇒ 崩溃态保持未愈
        assert draft.is_file(), "注入 raise 后草稿仍被改名 → 注入未命中调用点"
        assert not (ws / _draft_rel("Articles/sub/entryboom.md")).exists()

    def test_e2_no_new_endpoints(self, ws):
        with _boot(ws) as c:
            spec = c.get("/openapi.json").json()
        paths = spec["paths"]
        assert "/api/health" in paths
        leaked = [
            p for p in paths
            if ("heal" in p.lower() and p != "/api/health") or "self-heal" in p.lower() or "self_heal" in p.lower()
        ]
        assert leaked == [], f"出现自愈相关新端点: {leaked}"


# ===========================================================================
# F. 边界
# ===========================================================================
class TestBoundaries:
    def test_f1_empty_workspace_is_noop(self, ws):
        before = _snapshot(ws)
        with _boot(ws) as c:
            assert c.get("/api/health").status_code == 200
            assert _recovery_items(c) == []
        assert _snapshot(ws) == before, "空工作区出现文件变动"

    def test_f2_missing_recovery_dir_is_safe(self, ws):
        import shutil

        shutil.rmtree(ws / _DRAFT_DIR, ignore_errors=True)
        with _boot(ws) as c:
            assert c.get("/api/health").status_code == 200
        assert not list((ws / _DRAFT_DIR).glob("*.draft.md")), "凭空产生草稿"

    def test_f3_malformed_draft_names_are_untouched(self, ws):
        _write(ws, "Articles/target.md", "# 正文\n")
        names = [
            f"{_DRAFT_DIR}/broken.md",                        # 非 .draft.md
            f"{_DRAFT_DIR}/no-hash.draft.md",                 # 无 hash8
            f"{_DRAFT_DIR}/x-zzzzzzzz.draft.md",              # hash8 非法字符
            f"{_DRAFT_DIR}/target-1234567.draft.md",          # hash 位数不足
        ]
        for i, name in enumerate(names):
            _write(ws, name, f"# 损坏草稿样本 {i}\n")
        before = _snapshot(ws)
        with _boot(ws):
            pass
        for name in names:
            assert (ws / name).is_file(), f"损坏草稿被删除/改名: {name}"
        assert _snapshot(ws) == before, "损坏草稿场景出现文件增删改"

    def test_f4_subdir_candidate_is_unique_match(self, ws):
        doc = "Articles/Sub/nested.md"
        _write(ws, doc, "# 子目录文档\n")
        _write(ws, _draft_rel("Articles/nested.md"), _DRAFT_CONTENT)  # 旧路径 hash（已不存在）
        with _boot(ws):
            pass
        assert (ws / _draft_rel(doc)).is_file(), "子目录唯一 stem 候选未重挂"
        assert not (ws / _draft_rel("Articles/nested.md")).exists()

    def test_f5_markdown_ext_candidate_is_matched(self, ws):
        doc = "Modules/mod.markdown"
        _write(ws, doc, "# markdown 扩展文档\n")
        _write(ws, _draft_rel("Modules/mod.md"), _DRAFT_CONTENT)
        with _boot(ws):
            pass
        assert (ws / _draft_rel(doc)).is_file(), ".markdown 候选未重挂"
        assert not (ws / _draft_rel("Modules/mod.md")).exists()

    def test_f6_hash_hit_wins_over_stem_match(self, ws):
        """草稿 hash 命中 A；同时存在同 stem 的另一文档 B → 不得改挂到 B。"""
        doc_a, doc_b = "Articles/same.md", "Modules/same.md"
        _write(ws, doc_a, "# A\n")
        _write(ws, doc_b, "# B\n")
        draft_a = _write(ws, _draft_rel(doc_a), _DRAFT_CONTENT)  # hash 命中 A
        before = _snapshot(ws)
        with _boot(ws) as c:
            items = _recovery_items(c)
        assert (ws / _draft_rel(doc_a)).is_file(), "命中草稿被移动"
        assert not (ws / _draft_rel(doc_b)).exists(), "命中草稿被误改挂到同 stem 的 B"
        assert _snapshot(ws) == before
        assert any(i["doc_path"] == doc_a for i in items)
