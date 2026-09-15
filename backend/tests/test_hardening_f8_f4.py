"""F8 / F4 加固回归测试（2026-09-15）。

两条都是**用户可操作触发**的缺陷，来自文件管理可行性侦察（见
`docs/design-file-management-feasibility.md` §3.2 与 §4.2c）：

- **F8**：`POST /api/fs/move` 用**原始字符串**做顶层判定，而 `_guard_rel` 已把 `..` 归一化
  → 「校验看 A、落盘看 B」→ 跨区/越界可绕过，甚至把文档移到工作区根并**从 /api/tree 消失**。
  经已上线的右键「移动到…」裸 prompt 打 `Articles/..` 即可触发。
- **F4**：附件引用索引不扫 `Drafts/recovery` → 只被**恢复草稿**引用的附件被判「孤儿」→
  前端给删除按钮 → 用户「清理孤儿」会删掉恢复草稿后仍需的附件。
"""
from __future__ import annotations

from pathlib import Path

from app import config


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _mk(client, title: str, content: str | None = None) -> str:
    body = content if content is not None else f"# {title}\n\n正文\n"
    r = client.post("/api/articles", json={"title": title, "content": body})
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _up(client, name: str) -> str:
    r = client.post("/api/attachments", files={"file": (name, b"DATA", "image/png")})
    assert r.status_code == 201, r.text
    return r.json()["path"]


class TestF8MoveGuard:
    """移动的越界/跨区校验必须基于**归一化后**的路径。"""

    def test_cross_top_level_via_dotdot_is_rejected(self, client):
        """★ 核心：`Articles/../Modules/x.md` 曾实测 200 且文件真的落到 Modules/。"""
        ws = _ws(client)
        rel = _mk(client, "绕过用例A")

        r = client.post("/api/fs/move", json={"src": rel, "dst": "Articles/../Modules/绕过用例A.md"})
        assert r.status_code == 400, f"跨区绕过仍未拦：{r.status_code} {r.text[:120]}"
        assert (ws / rel).is_file(), "被拒后源文件不应移动"
        assert not (ws / "Modules/绕过用例A.md").exists(), "文件被移出区（跨区绕过）"

    def test_escape_to_workspace_root_is_rejected(self, client):
        """★ `Articles/../x.md` 曾实测 200 且文件落到工作区根，从 /api/tree 消失。"""
        ws = _ws(client)
        rel = _mk(client, "绕过用例B")

        r = client.post("/api/fs/move", json={"src": rel, "dst": "Articles/../绕过用例B.md"})
        assert r.status_code == 400, f"越界到工作区根仍未拦：{r.status_code}"
        assert not (ws / "绕过用例B.md").exists(), "文件落到了工作区根（会从界面消失）"
        assert (ws / rel).is_file()

    def test_escape_into_forbidden_root_is_rejected(self, client):
        ws = _ws(client)
        rel = _mk(client, "绕过用例C")
        for dst in ["Articles/../Drafts/x.md", "Articles/../.knowledgeeditor/x.md", "Articles/../Trash/x.md"]:
            r = client.post("/api/fs/move", json={"src": rel, "dst": dst})
            assert r.status_code == 400, f"{dst} -> {r.status_code}"
        assert (ws / rel).is_file()

    def test_missing_target_dir_returns_4xx_not_500(self, client):
        """★ F9：目标父目录不存在时原实现让 FileNotFoundError 冒泡成 500。"""
        rel = _mk(client, "缺目录用例")
        r = client.post("/api/fs/move", json={"src": rel, "dst": "Articles/不存在/文档.md"})
        assert r.status_code == 400, f"应为明确 4xx，实际 {r.status_code}"
        assert "不存在" in r.json().get("detail", "")

    def test_illegal_name_returns_4xx_not_500(self, client):
        """★ F9：Windows 非法字符 → 原先 OSError 冒泡 500。"""
        rel = _mk(client, "非法名用例")
        r = client.post("/api/fs/move", json={"src": rel, "dst": "Articles/ill:egal/文档.md"})
        assert r.status_code < 500, f"不得 500，实际 {r.status_code}"

    def test_dir_into_own_subtree_is_rejected(self, client):
        """★ 目录移入自身子树 → 原实现 OSError(Errno 22) → 500。"""
        assert client.post("/api/fs/dir", json={"path": "Articles/A"}).status_code == 201
        assert client.post("/api/fs/dir", json={"path": "Articles/A/B"}).status_code == 201
        r = client.post("/api/fs/move", json={"src": "Articles/A", "dst": "Articles/A/B/A"})
        assert r.status_code == 400, f"自嵌套应为 400，实际 {r.status_code}"

    def test_legit_move_still_works_and_preserves_content(self, client):
        """回归护栏：区内正常移动不受影响，内容逐字节不变（勿因加固破坏主功能）。"""
        ws = _ws(client)
        body = "# 正常移动\n\n正文 **加粗** 与 ke 标记\n\n<!-- ke-note: {\"kind\":\"note\",\"id\":\"n1\"} -->\n块\n<!-- /ke-note -->\n"
        rel = _mk(client, "正常移动", body)
        before = (ws / rel).read_bytes()
        assert client.post("/api/fs/dir", json={"path": "Articles/归档"}).status_code == 201

        r = client.post("/api/fs/move", json={"src": rel, "dst": "Articles/归档/正常移动.md"})
        assert r.status_code == 200, r.text
        assert r.json() == {"from": rel, "to": "Articles/归档/正常移动.md"}
        assert not (ws / rel).exists()
        assert (ws / "Articles/归档/正常移动.md").read_bytes() == before, "移动改动内容（违反 C2）"
        assert "Articles/归档/正常移动.md" in [a["path"] for a in client.get("/api/articles").json()]

    def test_returned_paths_are_normalized(self, client):
        """返回值应为归一化路径（原实现回显请求体的原始字符串）。"""
        rel = _mk(client, "归一化回显")
        r = client.post("/api/fs/move", json={"src": f"./Articles/归一化回显.md", "dst": "Articles/./归一化回显.md"})
        # 归一化后 src==dst，目标已存在 → 409；关键是**不得回显带 ./ 的原始串**
        assert r.status_code in (409, 400), r.text
        if r.status_code == 409:
            assert "./" not in r.json().get("detail", "")


class TestF4DraftRefProtection:
    """只被恢复草稿引用的附件不得被判「孤儿」（否则「清理孤儿」＝数据丢失）。"""

    def _draft_ref(self, client, doc_rel: str, att_rel: str) -> None:
        r = client.post(
            "/api/drafts/recovery",
            json={"doc_path": doc_rel, "content": f"# 草稿\n\n![]({att_rel})\n"},
        )
        assert r.status_code in (200, 201), r.text

    def test_attachment_referenced_only_by_recovery_draft_is_not_orphan(self, client):
        att = _up(client, "draft-only.png")
        doc = _mk(client, "草稿引用用例", "# 草稿引用用例\n\n（正文暂未引用附件）\n")
        # 用户在编辑中插入了图片但尚未保存 → 只存在于恢复草稿里
        self._draft_ref(client, doc, att)

        orphans = client.get("/api/attachments/orphans").json()
        assert att not in [o["path"] for o in orphans["orphans"]], "恢复草稿引用的附件被误判为孤儿（F4）"

        d = client.delete(f"/api/attachments/{att}")
        assert d.status_code == 409, f"允许删除恢复草稿仍在引用的附件（F4 数据丢失路径）：{d.status_code}"

    def test_attachment_referenced_by_live_doc_still_protected(self, client):
        att = _up(client, "live.png")
        _mk(client, "活文档用例", f"# 活文档用例\n\n![]({att})\n")
        assert att not in [o["path"] for o in client.get("/api/attachments/orphans").json()["orphans"]]
        assert client.delete(f"/api/attachments/{att}").status_code == 409

    def test_truly_orphan_attachment_still_deletable(self, client):
        """加固不得把孤儿清理功能本身堵死。"""
        att = _up(client, "really-orphan.png")
        assert att in [o["path"] for o in client.get("/api/attachments/orphans").json()["orphans"]]
        assert client.delete(f"/api/attachments/{att}").status_code in (200, 204)

    def test_backup_history_is_deliberately_excluded(self, client):
        """**有意边界**：`Drafts/backup/`（历史快照）不计入引用保护 —— 否则几乎任何附件
        都会被「历史引用」永久保护，孤儿清理将彻底失去意义。"""
        att = _up(client, "history-only.png")
        ws = _ws(client)
        bak = ws / config.DIR_DRAFT_BACKUP / "Articles/历史文档.md"
        bak.mkdir(parents=True, exist_ok=True)
        (bak / "20260101-000000-000.md").write_text(f"# 历史\n\n![]({att})\n", encoding="utf-8")

        orphans = client.get("/api/attachments/orphans").json()
        assert att in [o["path"] for o in orphans["orphans"]], (
            "历史备份被计入引用保护 —— 孤儿清理会永久失效（应保持有意排除）"
        )
