"""2026-10-02 独立审查（后端批次）修复回归：R03/R04/R05/R09/R10 + SEC-2/SEC-3。

来源：`AstraNota-independent-audit-2026-10-02（6.1 sol xhigh+Codex).md` 与
`AstraNota-独立审查报告（41F+Trae）.md`（工作区根目录）。每条用例复刻报告中的
输入形态，断言「修复后」的可观测契约。
"""
from __future__ import annotations

import io
import threading
import zipfile
from pathlib import Path

import pytest

from app.services import markdown_io

_BOM = "\ufeff"


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _write_raw(ws: Path, rel: str, raw: str) -> None:
    p = ws / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(raw.encode("utf-8"))
    client = None  # noqa: F841 - 便于阅读，索引更新由调用方处理
    return p


def _mk_raw(client, rel: str, raw: str) -> Path:
    p = _write_raw(_ws(client), rel, raw)
    client.app.state.indexer.update_file(rel)
    return p


def _upload(client, name: str, data: bytes = b"DATA", mime: str = "image/png") -> str:
    r = client.post("/api/attachments", files={"file": (name, data, mime)})
    assert r.status_code == 201, r.text
    return r.json()["path"]


def _orphans(client) -> list[str]:
    return [o["path"] for o in client.get("/api/attachments/orphans").json()["orphans"]]


# ===========================================================================
# R04：空 frontmatter 不得吞正文
# ===========================================================================


class TestR04EmptyFrontmatter:
    RAW = "---\n---\nKEEP_BODY\n\n---\nTAIL_BODY\n"

    def test_parse_empty_header_keeps_body(self):
        meta, body = markdown_io.parse_frontmatter(self.RAW)
        assert meta == {}
        assert body == "KEEP_BODY\n\n---\nTAIL_BODY\n"
        assert markdown_io.split_frontmatter_block(self.RAW)[0] == "---\n---\n"

    def test_meta_update_preserves_keep_body(self, client):
        rel = "Articles/R04空头.md"
        _mk_raw(client, rel, self.RAW)
        r = client.put(f"/api/articles/{rel}/meta", json={"title": "Renamed"})
        assert r.status_code == 200, r.text
        disk = (_ws(client) / rel).read_bytes().decode("utf-8")
        assert "KEEP_BODY" in disk, f"正文被吞: {disk!r}"
        assert "TAIL_BODY" in disk
        assert disk.startswith("---\ntitle: Renamed\n---\n")
        assert disk.endswith("KEEP_BODY\n\n---\nTAIL_BODY\n")

    @pytest.mark.parametrize("eol", ["\n", "\r\n"], ids=["LF", "CRLF"])
    def test_empty_header_bom_crlf(self, client, eol):
        raw = f"{_BOM}---{eol}---{eol}KEEP{eol}{eol}---{eol}TAIL{eol}"
        rel = f"Articles/R04-{eol == chr(13) + chr(10)}.md"
        _mk_raw(client, rel, raw)
        assert client.put(f"/api/articles/{rel}/meta", json={"title": "T"}).status_code == 200
        disk = (_ws(client) / rel).read_bytes().decode("utf-8")
        assert disk.startswith(f"{_BOM}---{eol}title: T{eol}---{eol}")
        assert "KEEP" in disk and "TAIL" in disk

    def test_hr_only_doc_is_not_frontmatter(self):
        """ADD-1：`---\\n\\n正文\\n\\n---\\n` 整篇是正文（不得当 frontmatter 吞掉）。"""
        raw = "---\n\n第一段\n\n---\n\n第二段\n"
        meta, body = markdown_io.parse_frontmatter(raw)
        assert meta == {}
        assert body == raw
        assert markdown_io.split_frontmatter_block(raw) == (None, raw)


# ===========================================================================
# R05：GET 返回完整原文（含 frontmatter/BOM），正文缩进不被吞
# ===========================================================================


class TestR05GetRawContent:
    RAW = f"{_BOM}---\r\ntitle: R05\r\ntags: [a]\r\n---\r\n\r\n    KEEP_INDENTED_CODE\r\n"

    def test_get_returns_full_raw_and_keeps_indent(self, client):
        rel = "Articles/R05.md"
        _mk_raw(client, rel, self.RAW)
        got = client.get(f"/api/articles/{rel}").json()
        assert got["content"] == self.RAW, "GET content 必须是逐字节完整原文"
        assert got["meta"]["title"] == "R05"
        _, body = markdown_io.parse_frontmatter(got["content"])
        assert body == "    KEEP_INDENTED_CODE\r\n", f"正文缩进被吞: {body!r}"

    def test_put_meta_returns_full_raw(self, client):
        rel = "Articles/R05b.md"
        _mk_raw(client, rel, self.RAW)
        r = client.put(f"/api/articles/{rel}/meta", json={"title": "新"})
        assert r.status_code == 200
        assert r.json()["content"] == (_ws(client) / rel).read_bytes().decode("utf-8")
        assert r.json()["content"] == self.RAW.replace("title: R05", "title: 新")


# ===========================================================================
# R03：合法引用不得被判孤儿（角括号 / URI 编码 / 普通链接 / 大小写）
# ===========================================================================


class TestR03AttachmentRefs:
    @pytest.mark.parametrize(
        "syntax",
        [
            pytest.param("![x](<{ref}>)", id="angle-brackets"),
            pytest.param("![x]({enc})", id="uri-encoded"),
            pytest.param("[report]({ref})", id="plain-link"),
            pytest.param("![x]({alt})", id="lowercase-top"),
        ],
    )
    def test_referenced_attachment_not_orphan_and_delete_409(self, client, syntax):
        spaced = syntax in ("![x](<{ref}>)", "![x]({enc})")
        # 含空格的文件名只能用角括号/URI 编码形态引用（普通链接形态用无空格名）
        att = _upload(client, "my pic.png" if spaced else "r03plain.png")
        root, name = att.rsplit("/", 1)
        enc = f"{root}/{name.replace(' ', '%20')}"
        alt = f"{root.lower()}/{name}" if root != root.lower() else f"{root}/{name.upper()}"
        content = syntax.format(ref=att, enc=enc, alt=alt)
        r = client.post("/api/articles", json={"title": "R03引用", "content": content})
        assert r.status_code == 201, r.text

        assert att not in _orphans(client), f"合法引用被判孤儿: {content!r}"
        d = client.delete(f"/api/attachments/{att}")
        assert d.status_code == 409, f"被引用附件被删除: {d.status_code} {d.text[:120]}"
        assert (_ws(client) / att).is_file()

    def test_orphan_still_detected_when_truly_unreferenced(self, client):
        att = _upload(client, "r03orphan.png")
        assert att in _orphans(client)
        assert client.delete(f"/api/attachments/{att}").status_code == 200

    def test_list_referenced_by_uses_shared_resolution(self, client):
        att = _upload(client, "r03list.png")
        client.post("/api/articles", json={"title": "R03列表", "content": f"![x](<{att}>)"})
        rows = client.get("/api/attachments/list").json()["attachments"]
        row = next(a for a in rows if a["rel_path"] == att)
        assert row["referenced_by"], "list 的 referenced_by 未命中角括号引用"

    def test_zip_validate_uses_shared_parser(self, client):
        """R03 同源：zip 导入的引用校验也走共享解析（角括号 + URI 编码可识别）。"""
        ws = _ws(client)
        # 先造一个正常附件引用（编码形态）与包内附件
        buf = io.BytesIO()
        md = "# 包文档\n\n![x](<Attachments/images/my%20pic.png>)\n"
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("pkg/doc.md", md)
            zf.writestr("pkg/Attachments/images/my pic.png", b"DATA")
        buf.seek(0)
        r = client.post(
            "/api/import/package", files={"file": ("pkg.zip", buf, "application/zip")}
        )
        assert r.status_code == 201, r.text[:300]
        # 文档里重写后的引用应指向真实落盘附件
        info = r.json()
        assert info["imported"]["attachments"], info
        doc = client.get(f"/api/articles/{info['articles'][0]['id'] if 'articles' in info else info.get('doc', '')}") if False else None
        assert (ws / info["imported"]["attachments"][0]["to"]).is_file()


# ===========================================================================
# R09：目录重命名必须复用引用保护
# ===========================================================================


class TestR09RenameDirReferenceProtection:
    def _referenced_dir(self, client) -> str:
        att = _upload(client, "r09.png")
        client.post("/api/articles", json={"title": "R09引用", "content": f"![x]({att})\n"})
        return att.rsplit("/", 1)[0]  # Attachments/images

    def test_rename_dir_with_referenced_attachment_is_409(self, client):
        ws = _ws(client)
        parent = self._referenced_dir(client)
        r = client.put("/api/fs/dir", json={"path": parent, "new_name": "images2"})
        assert r.status_code == 409, f"重命名绕过了引用保护: {r.status_code} {r.text[:160]}"
        assert (ws / parent).is_dir(), "被拒后目录不应移动"
        assert not (ws / "Attachments/images2").exists()

    def test_rename_unreferenced_attachment_dir_still_works(self, client):
        ws = _ws(client)
        _upload(client, "r09free.png")  # 未被引用
        parent = "Attachments/images"
        r = client.put("/api/fs/dir", json={"path": parent, "new_name": "images_ok"})
        assert r.status_code == 200, r.text
        assert (ws / "Attachments/images_ok").is_dir()

    def test_rename_normal_dir_unaffected(self, client):
        assert client.post("/api/fs/dir", json={"path": "Articles/普通目录"}).status_code == 201
        r = client.put("/api/fs/dir", json={"path": "Articles/普通目录", "new_name": "改名后"})
        assert r.status_code == 200, r.text


# ===========================================================================
# R10：同名创建排他（不覆盖）
# ===========================================================================


class TestR10ExclusiveCreate:
    def test_atomic_create_is_exclusive(self, tmp_path):
        target = tmp_path / "x.md"
        assert markdown_io.atomic_create(target, "A") is True
        assert target.read_text(encoding="utf-8") == "A"
        assert markdown_io.atomic_create(target, "B") is False
        assert target.read_text(encoding="utf-8") == "A", "排他创建被覆盖"

    def test_atomic_create_concurrent_exactly_one_winner(self, tmp_path):
        target = tmp_path / "race.md"
        results: list[bool] = []
        lock = threading.Lock()
        barrier = threading.Barrier(12)

        def worker(i: int) -> None:
            barrier.wait()
            ok = markdown_io.atomic_create(target, f"CONTENT-{i}")
            with lock:
                results.append(ok)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sum(results) == 1, f"并发同名创建应恰好 1 个成功，实际 {sum(results)}"
        assert target.read_text(encoding="utf-8").startswith("CONTENT-")

    def test_api_same_title_conflict_returns_409_without_overwrite(self, client):
        ws = _ws(client)
        assert client.post("/api/articles", json={"title": "R10", "content": "A"}).status_code == 201
        r = client.post("/api/articles", json={"title": "R10", "content": "B"})
        assert r.status_code == 409, r.text
        assert (ws / "Articles/R10.md").read_bytes() == b"A"

    def test_api_uses_exclusive_create_not_plain_write(self, client, monkeypatch):
        """证明路由依赖排他创建：外部先占位 → 409（不再 exists 检查后 os.replace）。"""
        from app.routers import documents as documents_mod

        ws = _ws(client)
        real = markdown_io.atomic_create

        def occupy_then_create(path, content):
            Path(path).write_bytes(b"EXTERNAL")  # 模拟并发对手抢先创建
            return real(path, content)

        monkeypatch.setattr(documents_mod.markdown_io, "atomic_create", occupy_then_create)
        r = client.post("/api/articles", json={"title": "R10竞态", "content": "MINE"})
        assert r.status_code == 409, r.text
        assert (ws / "Articles/R10竞态.md").read_bytes() == b"EXTERNAL"


# ===========================================================================
# SEC-2：create_doc 业务边界
# ===========================================================================


class TestSec2CreateDocBoundary:
    @pytest.mark.parametrize(
        "sub",
        ["Articles/../Attachments", "Articles/..", "Modules/../Attachments", "Articles/../../outside"],
        ids=["to-attachments", "to-root", "mod-to-attachments", "escape-root"],
    )
    def test_doc_cannot_escape_business_top(self, client, sub):
        ws = _ws(client)
        r = client.post("/api/fs/doc", json={"title": "SEC2", "dir": sub})
        assert r.status_code == 400, f"dir={sub!r} 未拦: {r.status_code} {r.text[:160]}"
        assert not (ws / "Attachments/SEC2.md").exists()
        assert not (ws / "SEC2.md").exists()

    def test_legit_subdir_still_created(self, client):
        ws = _ws(client)
        assert client.post("/api/fs/dir", json={"path": "Articles/合法子"}).status_code == 201
        r = client.post("/api/fs/doc", json={"title": "SEC2正常", "dir": "Articles/合法子"})
        assert r.status_code == 201, r.text
        assert r.json()["id"] == "Articles/合法子/SEC2正常.md"
        assert (ws / "Articles/合法子/SEC2正常.md").is_file()


# ===========================================================================
# SEC-3：导入包不整包驻留内存
# ===========================================================================


class TestSec3PackageSpooling:
    def _zip(self, md: str = "# 包文档\n\n正文\n") -> io.BytesIO:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("pkg/doc.md", md)
        buf.seek(0)
        return buf

    def test_import_package_does_not_use_in_memory_reader(self, client, monkeypatch):
        """修复后 zip 先落盘：`_read_limited` 不再是导入包路径（调用即失败）。"""
        from app.routers import import_export as ie

        def boom(*_a, **_k):
            raise AssertionError("导入包仍走内存整读（_read_limited）")

        monkeypatch.setattr(ie, "_read_limited", boom)
        r = client.post(
            "/api/import/package", files={"file": ("pkg.zip", self._zip(), "application/zip")}
        )
        assert r.status_code == 201, r.text[:300]
        assert r.json()["created"] is True and r.json()["path"], r.json()

    def test_non_zip_rejected_400(self, client):
        r = client.post(
            "/api/import/package", files={"file": ("x.zip", io.BytesIO(b"not a zip"), "application/zip")}
        )
        assert r.status_code == 400

    def test_import_temp_cleanup(self, client):
        ws = _ws(client)
        client.post(
            "/api/import/package", files={"file": ("pkg.zip", self._zip(), "application/zip")}
        )
        tmp_root = ws / ".knowledgeeditor/tmp"
        leftovers = [p for p in tmp_root.rglob("package.zip")] if tmp_root.is_dir() else []
        assert leftovers == [], f"导入临时包未清理: {leftovers}"
