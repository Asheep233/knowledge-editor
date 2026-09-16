"""task-15：移动路径 4 项修复回归（F9b / F9c / F11 / F12）+ 硬约束。

缺陷登记与原始实测复现：`docs/design-file-management-feasibility.md` §3.2。

- F9b：dst 指向已存在目录 → 误导性 409「目标已存在」；
- F9c：move 路径不看 `sanitize_filename`（v1.1.8 统一命名策略）；
- F11：移动后「最近更新」（app_config）仍留旧路径；
- F12：移动后 `Drafts/recovery` 草稿成孤儿（草稿名 hash 取完整相对路径）。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services import markdown_io


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _mk(client, title: str, content: str | None = None) -> str:
    body = content if content is not None else f"# {title}\n\n正文\n"
    r = client.post("/api/articles", json={"title": title, "content": body})
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _dir(client, path: str) -> None:
    r = client.post("/api/fs/dir", json={"path": path})
    assert r.status_code == 201, r.text


def _move(client, src: str, dst: str):
    return client.post("/api/fs/move", json={"src": src, "dst": dst})


def _recovery(client) -> list[dict]:
    return client.get("/api/drafts/recovery").json()["items"]


def _recent(client) -> list[dict]:
    return client.get("/api/workspace/recent-documents").json()["documents"]


def _drafts_dir(client) -> Path:
    return _ws(client) / "Drafts" / "recovery"


def _upload(client, name: str, data: bytes = b"DATA", mime: str = "image/png") -> str:
    r = client.post("/api/attachments", files={"file": (name, data, mime)})
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _files_snapshot(ws: Path) -> set[str]:
    """workspace 内文件相对路径（忽略 .knowledgeeditor/ 索引自身变动）。"""
    return {
        p.relative_to(ws).as_posix()
        for p in ws.rglob("*")
        if p.is_file() and not p.relative_to(ws).as_posix().startswith(".knowledgeeditor/")
    }


# ---------- F9b：dst 指向已存在目录 ----------


class TestF9bExistingTargetDir:
    def test_move_file_onto_existing_dir_has_clear_message(self, client):
        """★ 核心：dst 是已存在目录时不得只说「目标已存在」，要说明补文件名。"""
        _dir(client, "Articles/归档")
        rel = _mk(client, "F9b目标目录")
        r = _move(client, rel, "Articles/归档")
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        assert "文件夹" in detail, detail
        assert "文件名" in detail, detail
        assert "归档" in detail, detail
        # 源文件未移动，目录未被替换
        assert (_ws(client) / rel).is_file()
        assert (_ws(client) / "Articles/归档").is_dir()

    def test_move_file_onto_existing_dir_trailing_slash(self, client):
        """尾斜杠写法同样命中「目标是文件夹」，不得被扩展名收口成 目标夹.md。"""
        _dir(client, "Articles/目标夹")
        rel = _mk(client, "F9b尾斜杠")
        r = _move(client, rel, "Articles/目标夹/")
        assert r.status_code == 409, r.text
        assert "文件夹" in r.json()["detail"]
        assert (_ws(client) / rel).is_file()
        assert not (_ws(client) / "Articles/目标夹.md").exists()

    def test_move_file_onto_existing_file_keeps_path_in_message(self, client):
        a = _mk(client, "F9b甲")
        b = _mk(client, "F9b乙")
        r = _move(client, a, b)
        assert r.status_code == 409, r.text
        assert r.json()["detail"].startswith("目标已存在:")
        assert b in r.json()["detail"]
        assert (_ws(client) / a).is_file()

    def test_move_dir_onto_existing_dir_has_clear_message(self, client):
        _dir(client, "Articles/甲")
        _dir(client, "Articles/乙")
        r = _move(client, "Articles/甲", "Articles/乙")
        assert r.status_code == 409, r.text
        assert "文件夹" in r.json()["detail"]
        assert (_ws(client) / "Articles/甲").is_dir()


# ---------- F9c：dst 文件名走统一净化 ----------


class TestF9cSanitizeTargetName:
    def test_illegal_char_sanitized_and_actual_path_returned(self, client):
        """★ 核心：净化而非驳回；响应 to 必须是**实际落盘路径**。"""
        ws = _ws(client)
        body = "# 净化用例\n\n逐字节不变 ABC\n"
        rel = _mk(client, "F9c净化", body)
        before = (ws / rel).read_bytes()

        r = _move(client, rel, "Articles/报告:终稿.md")
        assert r.status_code == 200, r.text
        assert r.json()["from"] == rel
        assert r.json()["to"] == "Articles/报告 终稿.md"
        assert not (ws / rel).exists(), "源路径应已不存在"
        target = ws / r.json()["to"]
        assert target.is_file(), "响应 to 与磁盘不一致"
        assert target.read_bytes() == before, "移动改写了内容"
        assert r.json()["to"] in [a["path"] for a in client.get("/api/articles").json()]

    def test_multiple_illegal_chars_follow_shared_policy(self, client):
        """净化和 v1.1.8 统一策略（markdown_io.sanitize_filename）逐字一致。

        策略：主名过 sanitize_filename，扩展名（源文件类型）单独拼回。
        """
        ws = _ws(client)
        rel = _mk(client, "F9c多非法字符")
        dst = "Articles/非法:名*.md"
        r = _move(client, rel, dst)
        assert r.status_code == 200, r.text
        to = r.json()["to"]
        assert to == "Articles/非法 名.md"
        assert to == "Articles/" + markdown_io.sanitize_filename("非法:名*") + ".md"
        assert to != dst
        for ch in ':*/\\?<>|"':
            assert ch not in Path(to).name, (ch, to)
        assert (ws / to).is_file()

    def test_directory_segment_not_sanitized(self, client):
        """只净化最后一段：目录段原样保留。"""
        ws = _ws(client)
        _dir(client, "Articles/归档")
        rel = _mk(client, "F9c子目录")
        r = _move(client, rel, "Articles/归档/报告:终稿.md")
        assert r.status_code == 200, r.text
        assert r.json()["to"] == "Articles/归档/报告 终稿.md"
        assert (ws / r.json()["to"]).is_file()

    def test_long_name_keeps_markdown_extension(self, client):
        """80 字符截断边界不得把 .md 后缀截掉（否则文档从树/索引消失）。"""
        ws = _ws(client)
        rel = _mk(client, "F9c长名")
        r = _move(client, rel, "Articles/" + "x" * 200 + ".md")
        assert r.status_code == 200, r.text
        to = r.json()["to"]
        assert to.endswith(".md"), to
        assert len(Path(to).name) <= 84, to
        assert (ws / to).is_file()
        assert to in [a["path"] for a in client.get("/api/articles").json()]

    def test_degenerate_target_falls_back_with_source_extension(self, client):
        ws = _ws(client)
        rel = _mk(client, "F9c退化")
        r = _move(client, rel, "Articles/...")
        assert r.status_code == 200, r.text
        assert r.json()["to"] == "Articles/untitled.md"
        assert (ws / "Articles/untitled.md").is_file()

    def test_trailing_space_target_no_double_extension(self, client):
        """★ 尾空格：扩展名 oracle 必须先去掉尾空白，否则落成 `文档.md.md `。"""
        ws = _ws(client)
        rel = _mk(client, "F9c尾空格")
        r = _move(client, rel, "Articles/文档.md ")
        assert r.status_code == 200, r.text
        to = r.json()["to"]
        assert to == "Articles/文档.md", to
        assert not to.endswith((" ", ".")), to
        assert Path(to).name.lower().endswith(".md"), to
        assert (ws / to).is_file()

    def test_trailing_dot_target_keeps_single_extension(self, client):
        ws = _ws(client)
        rel = _mk(client, "F9c尾点")
        r = _move(client, rel, "Articles/尾点.md.")
        assert r.status_code == 200, r.text
        assert r.json()["to"] == "Articles/尾点.md"
        assert (ws / r.json()["to"]).is_file()

    @pytest.mark.parametrize(
        "dst,expect",
        [
            ("Articles/....md", "Articles/untitled.md"),
            ("Articles/.md", "Articles/md.md"),
            ("Articles/..md", "Articles/untitled.md"),
            ("Articles/.. .md", "Articles/untitled.md"),
            ("Articles/...", "Articles/untitled.md"),
        ],
    )
    def test_dots_only_target_never_hidden_and_keeps_md(self, client, dst, expect):
        """★ 纯点名/隐藏名：不得落成隐藏文件、不得只剩 `md`、不得丢 .md 后缀。"""
        ws = _ws(client)
        rel = _mk(client, "F9c点名")
        r = _move(client, rel, dst)
        assert r.status_code == 200, (dst, r.text)
        to = r.json()["to"]
        assert to == expect, (dst, to)
        name = Path(to).name
        assert not name.startswith("."), name
        assert name.lower().endswith((".md", ".markdown")), name
        assert (ws / to).is_file()

    def test_control_chars_in_dst_are_sanitized_not_rejected(self, client):
        """非 NUL 控制字符：净化（不是驳回），落盘名不含控制字符。"""
        ws = _ws(client)
        rel = _mk(client, "F9c控制字符")
        r = _move(client, rel, "Articles/控制\x01字符\x07.md")
        assert r.status_code == 200, r.text
        to = r.json()["to"]
        assert to == "Articles/控制 字符.md", to
        assert (ws / to).is_file()

    def test_nul_in_dst_returns_4xx_not_500(self, client):
        """★ NUL：`Path.resolve()` 会抛 ValueError（真实 uvicorn 下 500）→ 必须 4xx。"""
        ws = _ws(client)
        rel = _mk(client, "F9cNUL目标")
        before = _files_snapshot(ws)
        r = _move(client, rel, "Articles/a\x00b.md")
        assert r.status_code < 500, (r.status_code, r.text[:200])
        assert r.status_code in (400, 404, 422), r.status_code
        assert (_files_snapshot(ws)) == before, "被拒请求产生落盘副作用"
        assert (ws / rel).is_file()

    def test_nul_in_src_returns_4xx_not_500(self, client):
        ws = _ws(client)
        rel = _mk(client, "F9cNUL源")
        r = _move(client, f"Articles/{Path(rel).stem}\x00.md", "Articles/新名.md")
        assert r.status_code < 500, (r.status_code, r.text[:200])
        assert r.status_code in (400, 404, 422), r.status_code
        assert (ws / rel).is_file()

    def test_attachment_move_trailing_space_keeps_extension(self, client):
        ws = _ws(client)
        att = _upload(client, "附件.pdf", b"%PDF-1.4", "application/pdf")
        parent = att.rsplit("/", 1)[0]
        r = _move(client, att, f"{parent}/附件改名.pdf ")
        assert r.status_code == 200, r.text
        to = r.json()["to"]
        assert to == f"{parent}/附件改名.pdf", to
        assert not to.endswith((" ", "."))
        assert (ws / to).is_file()

    def test_sanitized_collision_returns_409(self, client):
        """净化后的名字与既有文件冲突 → 409（含实际目标路径）。"""
        _mk(client, "报告 终稿")
        ws = _ws(client)
        src = _mk(client, "F9c冲突")
        r = _move(client, src, "Articles/报告:终稿.md")
        assert r.status_code == 409, r.text
        assert "报告 终稿.md" in r.json()["detail"]
        assert (ws / src).is_file()

    def test_normal_clean_name_unchanged(self, client):
        ws = _ws(client)
        _dir(client, "Articles/归档")
        rel = _mk(client, "F9c正常")
        r = _move(client, rel, "Articles/归档/我的 报告 v2.md")
        assert r.status_code == 200, r.text
        assert r.json() == {"from": rel, "to": "Articles/归档/我的 报告 v2.md"}
        assert (ws / r.json()["to"]).is_file()

    def test_f8_normalization_regressions_still_400(self, client):
        """硬约束：F8 归一化安全修复不得回归。"""
        ws = _ws(client)
        rel = _mk(client, "F8回归")
        for dst in (
            "Articles/../Modules/F8回归.md",
            "Articles/../F8回归.md",
            "Articles/../Drafts/F8回归.md",
            "Articles/../Trash/F8回归.md",
            "Articles/..",
        ):
            r = _move(client, rel, dst)
            assert r.status_code == 400, (dst, r.status_code, r.text[:160])
            assert (ws / rel).is_file(), f"{dst} 被拒后源文件不应移动"


# ---------- F11：最近更新同步 ----------


class TestF11RecentDocumentsSync:
    def test_recent_entry_follows_move(self, client):
        """★ 核心：移动后 rel_path 同步为新路径，title/顺序/opened_at 保留。"""
        client.delete("/api/workspace/recent-documents")
        _dir(client, "Articles/归档")
        rel = _mk(client, "F11同步")
        assert client.post(
            "/api/workspace/recent-documents", json={"rel_path": rel, "title": "F11 标题"}
        ).status_code == 201
        opened_at = _recent(client)[0]["opened_at"]
        other = _mk(client, "F11其它")
        assert client.post(
            "/api/workspace/recent-documents", json={"rel_path": other, "title": "其它"}
        ).status_code == 201
        assert [d["rel_path"] for d in _recent(client)] == [other, rel]

        r = _move(client, rel, "Articles/归档/F11同步.md")
        assert r.status_code == 200, r.text
        after = _recent(client)
        assert [d["rel_path"] for d in after] == [other, "Articles/归档/F11同步.md"]
        assert after[1]["title"] == "F11 标题"
        assert after[1]["opened_at"] == opened_at
        assert all(d["rel_path"] != rel for d in after), "旧路径未清除"

    def test_recent_noop_when_doc_not_listed(self, client):
        client.delete("/api/workspace/recent-documents")
        rel = _mk(client, "F11未登记")
        assert _move(client, rel, "Articles/F11未登记2.md").status_code == 200
        assert _recent(client) == []

    def test_recent_dedup_and_order(self, client):
        """去重：新路径已在列表中时只保留首次出现的一条（title 取首次出现者）。"""
        client.delete("/api/workspace/recent-documents")
        src = _mk(client, "F11去重源")
        assert client.post(
            "/api/workspace/recent-documents", json={"rel_path": "Articles/目标位置.md", "title": "旧条目"}
        ).status_code == 201
        assert client.post(
            "/api/workspace/recent-documents", json={"rel_path": src, "title": "源标题"}
        ).status_code == 201
        assert [d["rel_path"] for d in _recent(client)] == [src, "Articles/目标位置.md"]

        r = _move(client, src, "Articles/目标位置.md")
        assert r.status_code == 200, r.text
        after = _recent(client)
        assert [d["rel_path"] for d in after] == ["Articles/目标位置.md"]
        assert after[0]["title"] == "源标题"

    def test_recent_cap_is_still_20(self, client):
        client.delete("/api/workspace/recent-documents")
        for i in range(20):
            assert client.post(
                "/api/workspace/recent-documents", json={"rel_path": f"Articles/r{i}.md"}
            ).status_code == 201
        assert len(_recent(client)) == 20
        rel = _mk(client, "F11上限")
        assert client.post(
            "/api/workspace/recent-documents", json={"rel_path": rel}
        ).status_code == 201
        assert len(_recent(client)) == 20
        assert _move(client, rel, "Articles/F11上限二.md").status_code == 200
        after = _recent(client)
        assert len(after) == 20, "上限 20 被突破"
        assert after[0]["rel_path"] == "Articles/F11上限二.md"

    def test_recent_dir_move_remaps_prefix(self, client):
        """目录移动：最近更新里该目录下的文档路径整体平移。"""
        client.delete("/api/workspace/recent-documents")
        _dir(client, "Articles/资料")
        _dir(client, "Articles/资料/子")
        a = _mk(client, "F11目录甲")
        b = _mk(client, "F11目录乙")
        assert client.post(
            "/api/workspace/recent-documents", json={"rel_path": a, "title": "甲"}
        ).status_code == 201
        assert client.post(
            "/api/workspace/recent-documents", json={"rel_path": b, "title": "乙"}
        ).status_code == 201
        assert _move(client, a, "Articles/资料/甲.md").status_code == 200
        assert _move(client, b, "Articles/资料/子/乙.md").status_code == 200
        assert _move(client, "Articles/资料", "Articles/资料二").status_code == 200

        rels = [d["rel_path"] for d in _recent(client)]
        assert "Articles/资料二/甲.md" in rels
        assert "Articles/资料二/子/乙.md" in rels
        assert not any(r.startswith("Articles/资料/") for r in rels), rels


# ---------- F12：recovery 草稿迁移 ----------


class TestF12RecoveryDraftMigration:
    def test_draft_follows_move_and_content_unchanged(self, client):
        """★ 核心：草稿文件改名 + DB 记录改指；内容逐字节不变；新路径可恢复。"""
        ws = _ws(client)
        rel = _mk(client, "F12草稿", "# 已保存\n")
        content = '# 未保存草稿\n\n逐字节不变 <!-- ke-note: {"kind":"note","id":"n1"} -->\n'
        assert client.post(
            "/api/drafts/recovery", json={"doc_path": rel, "content": content}
        ).status_code == 201
        before = _recovery(client)
        assert len(before) == 1, before
        old_draft = ws / before[0]["draft_path"]
        old_bytes = old_draft.read_bytes()

        _dir(client, "Articles/归档")
        assert _move(client, rel, "Articles/归档/F12草稿.md").status_code == 200

        after = _recovery(client)
        assert len(after) == 1, after
        item = after[0]
        assert item["doc_path"] == "Articles/归档/F12草稿.md"
        assert item["draft_path"] != before[0]["draft_path"], "草稿名未随新路径更新"
        assert item["draft_path"].startswith("Drafts/recovery/")
        assert item["id"] == before[0]["id"]
        assert item["saved_at"] == before[0]["saved_at"]
        # 草稿文件改名（内容逐字节不变），旧文件不残留
        assert not old_draft.exists(), "旧草稿文件残留成孤儿"
        new_draft = ws / item["draft_path"]
        assert new_draft.is_file()
        assert new_draft.read_bytes() == old_bytes
        names = sorted(p.name for p in _drafts_dir(client).iterdir())
        assert names == [Path(item["draft_path"]).name], names
        # 新路径可恢复
        rr = client.post(
            "/api/drafts/recovery/restore", json={"doc_path": "Articles/归档/F12草稿.md"}
        )
        assert rr.status_code == 200, rr.text
        assert rr.json()["content"] == content
        assert (ws / "Articles/归档/F12草稿.md").read_text(encoding="utf-8") == content
        assert _recovery(client) == []

    def test_move_without_draft_is_noop(self, client):
        rel = _mk(client, "F12无草稿")
        before_items = _recovery(client)
        before_files = sorted(p.name for p in _drafts_dir(client).iterdir())
        assert _move(client, rel, "Articles/F12无草稿2.md").status_code == 200
        assert _recovery(client) == before_items
        assert sorted(p.name for p in _drafts_dir(client).iterdir()) == before_files

    def test_db_only_record_migrates(self, client):
        """无 content 的登记（draft_path 空）也随移动迁移，旧路径不残留。"""
        rel = _mk(client, "F12仅登记")
        assert client.post("/api/drafts/recovery", json={"doc_path": rel}).status_code == 201
        assert [i["doc_path"] for i in _recovery(client)] == [rel]
        assert _move(client, rel, "Articles/F12仅登记2.md").status_code == 200
        items = _recovery(client)
        assert [i["doc_path"] for i in items] == ["Articles/F12仅登记2.md"]
        assert items[0]["saved_at"] != ""

    def test_old_path_not_recoverable_after_move(self, client):
        rel = _mk(client, "F12旧路径")
        assert client.post(
            "/api/drafts/recovery", json={"doc_path": rel, "content": "# 草稿\n"}
        ).status_code == 201
        assert _move(client, rel, "Articles/F12旧路径2.md").status_code == 200
        r = client.post("/api/drafts/recovery/restore", json={"doc_path": rel})
        assert r.status_code == 404, r.text
        assert [i["doc_path"] for i in _recovery(client)] == ["Articles/F12旧路径2.md"]

    def test_directory_move_migrates_descendant_drafts(self, client):
        ws = _ws(client)
        _dir(client, "Articles/资料")
        rel = _mk(client, "F12目录草稿")
        assert _move(client, rel, "Articles/资料/F12目录草稿.md").status_code == 200
        assert client.post(
            "/api/drafts/recovery",
            json={"doc_path": "Articles/资料/F12目录草稿.md", "content": "# 目录草稿\n"},
        ).status_code == 201
        old_draft = ws / _recovery(client)[0]["draft_path"]
        old_bytes = old_draft.read_bytes()

        assert _move(client, "Articles/资料", "Articles/资料二").status_code == 200
        items = _recovery(client)
        assert [i["doc_path"] for i in items] == ["Articles/资料二/F12目录草稿.md"]
        new_draft = ws / items[0]["draft_path"]
        assert new_draft.is_file() and new_draft.read_bytes() == old_bytes
        assert not old_draft.exists()

    def test_rename_doc_migrates_draft(self, client):
        """重命名（PUT /api/fs/doc）走同一条 _sync_after_move 链，草稿同样随迁。"""
        ws = _ws(client)
        rel = _mk(client, "F12改名")
        assert client.post(
            "/api/drafts/recovery", json={"doc_path": rel, "content": "# 改名草稿\n"}
        ).status_code == 201
        old_draft = ws / _recovery(client)[0]["draft_path"]

        r = client.put("/api/fs/doc", json={"path": rel, "new_name": "F12改名后.md"})
        assert r.status_code == 200, r.text
        items = _recovery(client)
        assert [i["doc_path"] for i in items] == ["Articles/F12改名后.md"]
        assert not old_draft.exists()
        assert (ws / items[0]["draft_path"]).is_file()


# ---------- 硬约束（不得回归） ----------


class TestHardConstraints:
    def test_referenced_attachment_move_still_409(self, client):
        att = _upload(client, "ref.png")
        _mk(client, "引用附件文档", f"![图]({att})\n")
        r = _move(client, att, "Attachments/images/ref2.png")
        assert r.status_code == 409, r.text
        assert "引用" in r.json()["detail"]
        assert (_ws(client) / att).is_file()

    def test_dir_with_referenced_attachment_move_still_409(self, client):
        att = _upload(client, "sub.png")
        target = att.rsplit("/", 1)[0] + "/sub/子图.png"
        assert client.post("/api/fs/dir", json={"path": "Attachments/images/sub"}).status_code == 201
        assert _move(client, att, target).status_code == 200
        _mk(client, "目录引用文档", f"![图]({target})\n")
        r = _move(client, "Attachments/images/sub", "Attachments/images/sub2")
        assert r.status_code == 409, r.text
        assert "引用" in r.json()["detail"]

    def test_cross_top_level_still_400(self, client):
        ws = _ws(client)
        rel = _mk(client, "跨区回归")
        assert _move(client, rel, "Modules/跨区回归.md").status_code == 400
        assert _move(client, rel, "Attachments/跨区回归.md").status_code == 400
        assert (ws / rel).is_file()

    def test_dir_self_nesting_still_400(self, client):
        _dir(client, "Articles/A")
        _dir(client, "Articles/A/B")
        r = _move(client, "Articles/A", "Articles/A/B/A")
        assert r.status_code == 400, r.text
        assert "自身" in r.json()["detail"]

    def test_missing_src_still_404(self, client):
        assert _move(client, "Articles/不存在.md", "Articles/x.md").status_code == 404

    def test_missing_target_dir_still_400(self, client):
        rel = _mk(client, "缺目录回归")
        r = _move(client, rel, "Articles/不存在/文档.md")
        assert r.status_code == 400, r.text
        assert "不存在" in r.json()["detail"]

    def test_forbidden_dst_still_400(self, client):
        ws = _ws(client)
        rel = _mk(client, "受保护目标")
        for dst in ("Drafts/x.md", "Trash/x.md", ".knowledgeeditor/x.md"):
            assert _move(client, rel, dst).status_code == 400, dst
        assert (ws / rel).is_file()

    def test_move_dir_to_root_equivalent_still_400(self, client):
        _dir(client, "Articles/待移动")
        assert _move(client, "Articles/待移动", "Articles/..").status_code == 400
        assert (_ws(client) / "Articles/待移动").is_dir()
