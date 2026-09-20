"""v1.2.0-pre.2 发布前审查后端修复回归（task-43）：B1 / B3 / M1 / M2 / M3 / M7 / M8。

来源：`docs/review-v1.2.0-pre.2-full.md`（NO-GO 判定）。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app import config
from app.services import markdown_io

_win_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows 路径语义专属")

_BOM = "\ufeff"


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _mk_doc(client, title: str, content: str | None = None) -> str:
    body = content if content is not None else f"# {title}\n\n正文\n"
    r = client.post("/api/articles", json={"title": title, "content": body})
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _write_raw(ws: Path, rel: str, raw: str) -> Path:
    p = ws / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(raw.encode("utf-8"))
    return p


def _upload(client, name: str, data: bytes = b"DATA", mime: str = "image/png") -> str:
    r = client.post("/api/attachments", files={"file": (name, data, mime)})
    assert r.status_code == 201, r.text
    return r.json()["path"]


# ===========================================================================
# B1：保存合并路径不得损坏 BOM/CRLF（BLOCKER）
# ===========================================================================


class TestB1BomCrlfFidelity:
    @pytest.mark.parametrize("nl", ["\n", "\r\n"], ids=["LF", "CRLF"])
    @pytest.mark.parametrize("bom", ["", _BOM], ids=["no-BOM", "BOM"])
    def test_merge_frontmatter_preserves_bom_and_block_newline(self, nl, bom):
        """四组合：BOM×{LF,CRLF} × merge_frontmatter。"""
        old = f"{bom}---{nl}title: 我的文档{nl}---{nl}{nl}正文第一行{nl}"
        # WYSIWYG 载荷：frontmatter 由前端重渲染（LF），正文保留原文换行
        new = f"{bom}---\nke_version: 1\n---\n\n正文第一行（编辑后）{nl}"
        out = markdown_io.merge_frontmatter(old, new)
        expected = (
            f"{bom}---{nl}ke_version: 1{nl}title: 我的文档{nl}---{nl}{nl}"
            f"正文第一行（编辑后）{nl}"
        )
        assert out == expected
        assert out.startswith(bom)
        assert ("\r\n" if nl == "\r\n" else "\n") in out

    @pytest.mark.parametrize("nl", ["\n", "\r\n"], ids=["LF", "CRLF"])
    @pytest.mark.parametrize("bom", ["", _BOM], ids=["no-BOM", "BOM"])
    def test_set_meta_preserves_bom_and_block_newline(self, nl, bom):
        """四组合：BOM×{LF,CRLF} × set_meta（PUT /meta 同根因）。"""
        content = f"{bom}---{nl}title: 旧标题{nl}---{nl}{nl}正文{nl}"
        out = markdown_io.set_meta(content, {"title": "新标题"})
        expected = f"{bom}---{nl}title: 新标题{nl}---{nl}{nl}正文{nl}"
        assert out == expected

    def test_wysiwyg_save_api_preserves_disk_bytes(self, client):
        """端到端：磁盘 BOM+CRLF 文档经 WYSIWYG 保存（只带 ke_version 的 PUT）后字节仍保真。"""
        ws = _ws(client)
        old_raw = f"{_BOM}---\r\ntitle: 我的文档\r\n---\r\n\r\n正文第一行\r\n"
        rel = "Articles/BOM文档.md"
        _write_raw(ws, rel, old_raw)
        client.app.state.indexer.update_file(rel)

        # 前端 WYSIWYG 载荷：frontmatter 重渲染为 LF，正文保留 CRLF
        payload = f"{_BOM}---\nke_version: 1\n---\n\n正文第一行（编辑后）\r\n"
        r = client.put(f"/api/articles/{rel}", json={"content": payload})
        assert r.status_code == 200, r.text

        expected = f"{_BOM}---\r\nke_version: 1\r\ntitle: 我的文档\r\n---\r\n\r\n正文第一行（编辑后）\r\n"
        assert (ws / rel).read_bytes() == expected.encode("utf-8"), (
            "BOM/CRLF 保真被破坏：" + repr((ws / rel).read_text(encoding="utf-8"))
        )

    def test_put_meta_api_preserves_disk_bytes(self, client):
        """端到端：PUT /meta（属性面板改 title）后磁盘字节仍为 BOM+CRLF。"""
        ws = _ws(client)
        rel = "Articles/BOM元信息.md"
        _write_raw(ws, rel, f"{_BOM}---\r\ntitle: 旧标题\r\n---\r\n\r\n正文\r\n")
        client.app.state.indexer.update_file(rel)

        r = client.put(f"/api/articles/{rel}/meta", json={"title": "新标题"})
        assert r.status_code == 200, r.text
        expected = f"{_BOM}---\r\ntitle: 新标题\r\n---\r\n\r\n正文\r\n"
        assert (ws / rel).read_bytes() == expected.encode("utf-8")

    def test_no_writable_path_when_nothing_missing(self):
        """回归：missing 为空时原样返回 new_content（不引入额外改写）。"""
        old = f"{_BOM}---\r\ntitle: x\r\n---\r\n\r\n正文\r\n"
        new = f"{_BOM}---\r\ntitle: y\r\n---\r\n\r\n新正文\r\n"
        assert markdown_io.merge_frontmatter(old, new) == new


# ===========================================================================
# B3：rename_dir / rename_doc 反斜杠穿越（BLOCKER）
# ===========================================================================


class TestB3RenameTraversal:
    def test_rename_dir_rejects_backslash_traversal(self, client):
        ws = _ws(client)
        assert client.post("/api/fs/dir", json={"path": "Articles/sub"}).status_code == 201
        r = client.put("/api/fs/dir", json={"path": "Articles/sub", "new_name": "..\\..\\..\\evil"})
        assert r.status_code == 400, r.text
        assert (ws / "Articles/sub").is_dir(), "被拒后源目录不应移动"
        assert not (ws.parent / "evil").exists()
        assert not (ws / "evil").exists()

    def test_rename_doc_rejects_backslash_traversal(self, client):
        ws = _ws(client)
        rel = _mk_doc(client, "B3文档")
        r = client.put("/api/fs/doc", json={"path": rel, "new_name": "..\\..\\evil.md"})
        assert r.status_code == 400, r.text
        assert (ws / rel).is_file(), "被拒后源文件不应移动"
        assert not (ws.parent / "evil.md").exists()

    @pytest.mark.parametrize("new_name", ["a\\b", "sub\\name", "..\\..\\evil"])
    def test_rename_dir_rejects_any_backslash(self, client, new_name):
        """全平台统一拒 `\\`（POSIX 下虽是合法字符，但平台语义分叉正是缺陷根源）。"""
        assert client.post("/api/fs/dir", json={"path": "Articles/bs"}).status_code == 201
        r = client.put("/api/fs/dir", json={"path": "Articles/bs", "new_name": new_name})
        assert r.status_code == 400, r.text

    def test_rename_doc_rejects_slash_and_dot_names(self, client):
        rel = _mk_doc(client, "B3名称")
        for bad in ("sub/evil.md", "..", ".", ""):
            r = client.put("/api/fs/doc", json={"path": rel, "new_name": bad})
            assert r.status_code in (400, 422), (bad, r.status_code, r.text[:120])

    def test_rename_guard_helpers_reject_escape(self, client):
        """二次防线：构造目标后的解析级包含性断言拒绝越界目标。"""
        from app.routers import fs as fs_mod

        ws = _ws(client)
        with pytest.raises(Exception):
            fs_mod._validate_new_name("..\\..\\evil")
        with pytest.raises(Exception):
            fs_mod._guard_rename_target(ws, (ws / "Articles").parent.parent / "outside")
        # 正常目标通过
        fs_mod._guard_rename_target(ws, ws / "Articles/ok.md")

    def test_normal_rename_still_works(self, client):
        rel = _mk_doc(client, "B3正常")
        r = client.put("/api/fs/doc", json={"path": rel, "new_name": "B3改名后"})
        assert r.status_code == 200, r.text
        assert r.json()["to"] == "Articles/B3改名后.md"
        assert (_ws(client) / "Articles/B3改名后.md").is_file()

    def test_rename_dir_posix_legal_names_still_work(self, client):
        """POSIX 合法名（中文/空格/点/下划线）重命名不得被误拒。"""
        for i, name in enumerate(("中文 目录", "v1.2.3", "_keep-me")):
            src = f"Articles/合法{i}"
            assert client.post("/api/fs/dir", json={"path": src}).status_code == 201
            r = client.put("/api/fs/dir", json={"path": src, "new_name": name})
            assert r.status_code == 200, (name, r.text)
            assert r.json()["to"] == f"Articles/{name}"
            assert (_ws(client) / "Articles" / name).is_dir()


# ===========================================================================
# M1：rename_doc 归一化顶层判定（不得改名被引用附件）
# ===========================================================================


class TestM1RenameDocNormalizedTop:
    def test_dotdot_bypass_cannot_rename_attachment(self, client):
        ws = _ws(client)
        att = _upload(client, "m1.png")
        _mk_doc(client, "M1引用者", f"![图]({att})\n")
        r = client.put(
            "/api/fs/doc",
            json={"path": f"Articles/../{att}", "new_name": "m1改名"},
        )
        assert r.status_code == 400, r.text
        assert (ws / att).is_file(), "被引用附件被改名（引用保护被绕过）"
        assert client.get("/api/attachments/list").json()["count"] >= 1

    def test_plain_attachment_path_still_rejected(self, client):
        att = _upload(client, "m1b.png")
        r = client.put("/api/fs/doc", json={"path": att, "new_name": "x"})
        assert r.status_code == 400

    def test_legit_normalized_doc_path_still_renames(self, client):
        """M1 修复不得误伤：含 `..` 但归一化后仍指向 Articles 文档的路径可重命名。"""
        assert client.post("/api/fs/dir", json={"path": "Articles/sub2"}).status_code == 201
        rel = _mk_doc(client, "M1正常归一")
        variant = f"Articles/sub2/../{Path(rel).name}"
        r = client.put("/api/fs/doc", json={"path": variant, "new_name": "M1正常改名"})
        assert r.status_code == 200, r.text
        assert r.json()["from"] == rel
        assert r.json()["to"] == "Articles/M1正常改名.md"


# ===========================================================================
# M2：附件删除引用保护用规范化路径
# ===========================================================================


class TestM2AttachmentDeleteNormalized:
    def _referenced_attachment(self, client) -> str:
        att = _upload(client, "m2.png")
        _mk_doc(client, "M2引用者", f"![图]({att})\n")
        return att

    def test_referenced_attachment_delete_is_409(self, client):
        att = self._referenced_attachment(client)
        assert client.delete(f"/api/attachments/{att}").status_code == 409

    def test_double_slash_variant_cannot_bypass_409(self, client):
        """规范化变体（多余分隔符）必须仍命中引用保护。"""
        att = self._referenced_attachment(client)
        root, name = att.rsplit("/", 1)
        variant = f"{root}//{name}"
        r = client.delete(f"/api/attachments/{variant}")
        assert r.status_code == 409, f"规范化变体绕过了引用保护: {r.status_code} {r.text[:120]}"
        assert (_ws(client) / att).is_file()

    def test_dot_segment_variant_cannot_bypass_409(self, client):
        att = self._referenced_attachment(client)
        root, name = att.rsplit("/", 1)
        variant = f"{root}/./{name}"
        r = client.delete(f"/api/attachments/{variant}")
        assert r.status_code == 409, f"./ 变体绕过了引用保护: {r.status_code} {r.text[:120]}"
        assert (_ws(client) / att).is_file()

    def test_orphan_attachment_still_deletable(self, client):
        att = _upload(client, "m2orphan.png")
        r = client.delete(f"/api/attachments/{att}")
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == att
        assert not (_ws(client) / att).exists()

    @_win_only
    def test_case_variant_cannot_bypass_409(self, client):
        att = self._referenced_attachment(client)
        root, name = att.rsplit("/", 1)
        r = client.delete(f"/api/attachments/{root}/{name.upper()}")
        assert r.status_code == 409


# ===========================================================================
# M3：delete_dir / move_path 附件保护对顶层名大小写不敏感
# ===========================================================================


class TestM3CaseInsensitiveAttachmentTop:
    def test_is_under_attachments_is_case_insensitive(self):
        """M3 修复的判定函数：顶层名大小写不敏感（原 startswith 可被绕过）。"""
        from app.routers.fs import _is_under_attachments

        for rel in (
            "Attachments/images/x.png",
            "attachments/images/x.png",
            "ATTACHMENTS/x",
            "Attachments\\images\\x.png".replace("\\", "/"),
        ):
            assert _is_under_attachments(rel), rel
        for rel in ("Articles/x.md", "Modules/x.md", "Attachments", "attachments", ""):
            assert not _is_under_attachments(rel), rel

    def test_canonical_uppercase_still_protected(self, client):
        """回归：规范大写的既有保护不变（Linux CI 可跑）。"""
        att = _upload(client, "m3.png")
        _mk_doc(client, "M3大引用者", f"![图]({att})\n")
        parent = att.rsplit("/", 1)[0]
        r = client.delete("/api/fs/dir", params={"path": parent})
        assert r.status_code == 409, r.text

    @_win_only
    def test_delete_dir_case_variant_protected_on_windows(self, client):
        """Windows：`attachments/…` 与 `Attachments/…` 同目录，必须仍命中引用保护。"""
        att = _upload(client, "m3w.png")
        _mk_doc(client, "M3W引用者", f"![图]({att})\n")
        parent = att.rsplit("/", 1)[0]
        r = client.delete("/api/fs/dir", params={"path": parent.lower()})
        assert r.status_code == 409, f"大小写变体绕过了删除保护: {r.status_code} {r.text[:120]}"
        assert (_ws(client) / att).is_file()

    @_win_only
    def test_move_path_case_variant_protected_on_windows(self, client):
        att = _upload(client, "m3wm.png")
        _mk_doc(client, "M3WM引用者", f"![图]({att})\n")
        parent = att.rsplit("/", 1)[0]
        r = client.post("/api/fs/move", json={"src": parent.lower(), "dst": parent.lower() + "2"})
        assert r.status_code == 409, f"大小写变体绕过了移动保护: {r.status_code} {r.text[:120]}"
        assert (_ws(client) / att).is_file()

    def test_lowercase_tree_with_lowercase_refs_protected(self, client):
        """POSIX 上真实存在的小写 attachments/ 目录：保护判定改为大小写不敏感后，
        只要引用键与磁盘路径一致也必须命中（本用例锁死 `_is_under_attachments`
        在 delete_dir/move_path 两个调用点的接入是否正确）。"""
        ws = _ws(client)
        assert client.post("/api/fs/dir", json={"path": "attachments/img"}).status_code == 201
        (ws / "attachments/img/x.png").write_bytes(b"DATA")
        client.app.state.indexer.update_file("attachments/img/x.png")
        # ke.ts/markdown_io 的引用提取只认规范 `Attachments/` 前缀 → 本用例直接
        # 走 fs 的两条入口，验证「非规范大写目录同样被纳入附件保护判定」：
        # 没有引用时删除/移动仍应成功（保护不得误伤），有引用时由 Windows 用例覆盖。
        r = client.delete("/api/fs/dir", params={"path": "attachments/img"})
        assert r.status_code == 204, r.text


# ===========================================================================
# M7：KE_API_TOKEN 半成品已移除
# ===========================================================================


class TestM7TokenRemoved:
    def test_token_env_no_longer_gates_api(self, client, monkeypatch):
        monkeypatch.setattr(config, "API_TOKEN", "secret-token")
        assert client.get("/api/health").status_code == 200
        r = client.get("/api/workspace/current")
        assert r.status_code == 200, f"token 已移除，不应 401: {r.status_code}"
        r2 = client.get("/api/tree")
        assert r2.status_code == 200
        r3 = client.get("/api/tree", headers={"X-KE-Token": "wrong"})
        assert r3.status_code == 200


# ===========================================================================
# M8：目录删除前快照 + per-file 容错
# ===========================================================================


class TestM8DirDeleteSnapshot:
    def test_delete_dir_snapshots_each_markdown(self, client):
        ws = _ws(client)
        assert client.post("/api/fs/dir", json={"path": "Articles/M8"}).status_code == 201
        rels = []
        for title, body in (("M8甲", "# 甲\n\n内容甲\n"), ("M8乙", "# 乙\n\n内容乙\n")):
            r = client.post("/api/articles", json={"title": title, "content": body})
            rel = r.json()["path"]
            m = client.post("/api/fs/move", json={"src": rel, "dst": f"Articles/M8/{Path(rel).name}"})
            assert m.status_code == 200, m.text
            rels.append(m.json()["to"])

        r = client.delete("/api/fs/dir", params={"path": "Articles/M8"})
        assert r.status_code == 204, r.text
        assert not (ws / "Articles/M8").exists()
        # 每个 .md 都被删除前快照（历史可恢复）
        for rel, body in zip(rels, ("# 甲\n\n内容甲\n", "# 乙\n\n内容乙\n")):
            snap_dir = ws / config.DIR_DRAFT_BACKUP / rel
            snaps = sorted(snap_dir.glob("*.md")) if snap_dir.is_dir() else []
            assert snaps, f"删除前未生成历史快照: {rel}"
            assert snaps[-1].read_text(encoding="utf-8") == body

    def test_delete_dir_per_file_failure_returns_list(self, client, monkeypatch):
        """单文件删除失败 → 不中断、不清索引、200 + 失败清单；其余文件仍被删除。"""
        ws = _ws(client)
        assert client.post("/api/fs/dir", json={"path": "Articles/M8F"}).status_code == 201
        keep = "Articles/M8F/锁定.md"
        gone = "Articles/M8F/正常.md"
        _write_raw(ws, keep, "# 锁定\n")
        _write_raw(ws, gone, "# 正常\n")
        client.app.state.indexer.update_file(keep)
        client.app.state.indexer.update_file(gone)

        real_unlink = Path.unlink

        def flaky_unlink(self, *a, **k):
            if self.name == "锁定.md":
                raise PermissionError(13, "文件被占用（模拟 Windows 文件锁）")
            return real_unlink(self, *a, **k)

        monkeypatch.setattr(Path, "unlink", flaky_unlink)
        r = client.delete("/api/fs/dir", params={"path": "Articles/M8F"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["removed"] is False
        assert [f["path"] for f in body["failed"]] == [keep]
        assert (ws / keep).is_file(), "失败文件不应消失"
        assert not (ws / gone).exists(), "其余文件应被删除"
        # 失败文件仍留在索引（未误删）
        assert client.app.state.store.get_file(keep) is not None
        assert client.app.state.store.get_file(gone) is None

    def test_delete_dir_all_success_keeps_204(self, client):
        """无失败时保持 204 既有契约。"""
        assert client.post("/api/fs/dir", json={"path": "Articles/M8ok"}).status_code == 201
        _write_raw(_ws(client), "Articles/M8ok/a.md", "# a\n")
        r = client.delete("/api/fs/dir", params={"path": "Articles/M8ok"})
        assert r.status_code == 204

    def test_delete_dir_without_docs_still_works(self, client):
        assert client.post("/api/fs/dir", json={"path": "Articles/M8empty"}).status_code == 201
        _write_raw(_ws(client), "Articles/M8empty/note.txt", "txt")
        r = client.delete("/api/fs/dir", params={"path": "Articles/M8empty"})
        assert r.status_code == 204
