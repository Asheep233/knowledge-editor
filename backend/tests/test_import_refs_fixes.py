"""H-1 / BE-05 / BE-02 / BE-04 回归：导入引用改写 + 附件引用解析。

背景（2026-10-17 两份独立审查）：
- H-1（41F High）/ BE-05（61sol P2）：zip 文档包导入时附件因冲突改名后引用
  未被改写 —— `json.dumps` 默认 ensure_ascii 对 CJK 失效；Markdown 目标旧实现
  只认无空格图片路径，角括号 / %20 / 普通链接都不改写 → 文档指向旧附件、
  新附件成孤儿（清理孤儿即丢导入内容）。
- BE-02（61sol P1）：同一导入包内两个附件规划到同一目标（目录规范化后）时，
  暂存复制互相覆盖，一份内容静默丢失。
- BE-04（61sol P1）：合法裸平衡圆括号引用（`pic(1).png`）被引用提取器漏判 →
  判成孤儿 → DELETE 会永久删除仍在使用的附件。

修复口径：改写/提取共用同一套目标解析（markdown_io.md_link_target_spans）；
规划阶段同时记录本批目标身份；改写按原引用形态回写（角括号/编码保持）。
"""
from __future__ import annotations

import io
import zipfile

import pytest

from app.services import markdown_io


# ---------- helpers ----------

def _zip_pkg(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _import_pkg(client, files: dict[str, bytes]):
    return client.post(
        "/api/import/package",
        files={"file": ("pkg.zip", _zip_pkg(files), "application/zip")},
    )


def _ws(client):
    return client.app.state.workspace_root


def _write_existing(client, rel: str, data: bytes) -> None:
    p = _ws(client) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def _doc_text(client, rel: str) -> str:
    return (_ws(client) / rel).read_bytes().decode("utf-8")


def _refs(md: str) -> set[str]:
    return markdown_io.attachment_refs_in(md)


# ---------- H-1：CJK ke-attach/图片引用在冲突改名后必须改写 ----------

def test_import_conflict_rewrites_cjk_ke_attach(client):
    _write_existing(client, "Attachments/images/图片.png", b"OLD-IMAGE")
    md = (
        "---\ntitle: 导入CJK\n---\n\n"
        '<!-- ke-attach: {"src": "Attachments/images/图片.png", "name": "图片.png", "kind": "image"} -->\n\n'
        "![图](Attachments/images/图片.png)\n"
    )
    files = {
        "pkg/doc.md": md.encode("utf-8"),
        "pkg/Attachments/images/图片.png": b"NEW-IMAGE",
    }
    r = _import_pkg(client, files)
    assert r.status_code == 201, r.text
    body = r.json()
    imported = body["imported"]["attachments"]
    assert len(imported) == 1
    new_rel = imported[0]["to"]
    assert new_rel != "Attachments/images/图片.png"

    refs = _refs(_doc_text(client, body["path"]))
    assert new_rel in refs, f"CJK 引用未改写到新附件: {refs}"
    assert "Attachments/images/图片.png" not in refs, f"仍指向旧附件: {refs}"
    assert body["imported"]["rewritten_refs"] >= 1

    ws = _ws(client)
    assert (ws / "Attachments/images/图片.png").read_bytes() == b"OLD-IMAGE"
    assert (ws / new_rel).read_bytes() == b"NEW-IMAGE"


# ---------- BE-05：普通链接 / 角括号 / URI 编码三类目标都要改写 ----------

_BE05_CASES = [
    pytest.param(
        "plain-link",
        "[报告](Attachments/files/report.pdf)",
        "Attachments/files/report.pdf",
        id="plain-link",
    ),
    pytest.param(
        "angle-image",
        "![Pic](<Attachments/images/my pic.png>)",
        "Attachments/images/my pic.png",
        id="angle-image",
    ),
    pytest.param(
        "encoded-image",
        "![Pic](Attachments/images/my%20pic.png)",
        "Attachments/images/my pic.png",
        id="encoded-image",
    ),
]


@pytest.mark.parametrize("case_id, md_ref, dest_rel", _BE05_CASES)
def test_import_conflict_rewrites_md_link_variants(client, case_id, md_ref, dest_rel):
    _write_existing(client, dest_rel, b"OLD")
    md = f"---\ntitle: {case_id}\n---\n\n{md_ref}\n"
    files = {"pkg/doc.md": md.encode("utf-8"), f"pkg/{dest_rel}": b"NEW"}
    r = _import_pkg(client, files)
    assert r.status_code == 201, r.text
    body = r.json()
    to = body["imported"]["attachments"][0]["to"]
    assert to != dest_rel

    refs = _refs(_doc_text(client, body["path"]))
    assert to in refs, f"[{case_id}] 引用未改写到 {to}: {refs}"
    assert dest_rel not in refs, f"[{case_id}] 仍指向旧附件: {refs}"
    assert body["imported"]["rewritten_refs"] == 1


# ---------- BE-02：同一导入包内的目标冲突不得覆盖 ----------

def test_import_same_batch_conflict_keeps_both_contents(client):
    md = (
        "---\ntitle: 包内冲突\n---\n\n"
        "![A](Attachments/a.png)\n\n"
        "![B](Attachments/images/a.png)\n"
    )
    files = {
        "pkg/doc.md": md.encode("utf-8"),
        "pkg/Attachments/a.png": b"CONTENT-A",
        "pkg/Attachments/images/a.png": b"CONTENT-B",
    }
    r = _import_pkg(client, files)
    assert r.status_code == 201, r.text
    body = r.json()
    atts = body["imported"]["attachments"]
    assert len(atts) == 2
    dests = [a["to"] for a in atts]
    assert len(set(dests)) == 2, f"两份内容被规划到同一目标: {dests}"

    ws = _ws(client)
    by_content = {(ws / d).read_bytes(): d for d in dests}
    assert by_content.get(b"CONTENT-A"), f"CONTENT-A 丢失: {dests}"
    assert by_content.get(b"CONTENT-B"), f"CONTENT-B 丢失: {dests}"

    refs = _refs(_doc_text(client, body["path"]))
    assert set(dests) == refs, f"引用与落点不一致: refs={refs} dests={dests}"
    assert body["imported"]["rewritten_refs"] == 2


# ---------- BE-04：平衡圆括号引用不得被判孤儿，且删除受保护 ----------

def test_balanced_paren_attachment_ref_not_orphan_and_delete_protected(client):
    upload = client.post(
        "/api/attachments", files={"file": ("pic(1).png", b"IMAGE", "image/png")}
    )
    assert upload.status_code == 201, upload.text
    rel = upload.json()["path"]
    assert rel.endswith("pic(1).png"), rel

    md = f"---\ntitle: 括号引用\n---\n\n![Pic]({rel})\n"
    ws = _ws(client)
    (ws / "Articles/括号引用.md").write_bytes(md.encode("utf-8"))
    client.app.state.indexer.update_file("Articles/括号引用.md")

    # 引用提取必须识别平衡括号目标
    assert rel in _refs(md)

    orphans = client.get("/api/attachments/orphans").json()["orphans"]
    assert rel not in {o["path"] for o in orphans}, "在用附件被判成孤儿"

    deleted = client.delete(f"/api/attachments/{rel}")
    assert deleted.status_code == 409, deleted.text
    assert (ws / rel).is_file(), "被引用附件被删除"


# ---------- 引用解析单元回归（角括号/编码/title/嵌套括号） ----------

def test_md_link_target_spans_variants():
    cases = [
        ("![a](Attachments/images/pic(1).png)", {"Attachments/images/pic(1).png"}),
        ("[r](<Attachments/images/my pic.png>)", {"Attachments/images/my pic.png"}),
        # URI 编码目标经 normalize_attachment_ref 解码为真实文件名
        ("![x](Attachments/images/x%20y.png)", {"Attachments/images/x y.png"}),
        ('![x](Attachments/a.png "title")', {"Attachments/a.png"}),
        ("[l](Attachments/files/report.pdf)", {"Attachments/files/report.pdf"}),
        ("![x](Attachments/nested(a(b))c.png)", {"Attachments/nested(a(b))c.png"}),
        # 网络 URL / 非附件链接不产生引用
        ("[web](https://example.com/a.png)", set()),
        ("![x](Articles/some.md)", set()),
    ]
    for md, expect in cases:
        assert _refs(md) == expect, f"{md!r} → {_refs(md)} != {expect}"
