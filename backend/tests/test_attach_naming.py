"""S-3：附件上传保留原始文件名 + 路径穿越防护（task-2 验收用例）。

覆盖：
1. CJK/空格/大小写保留（返回 path/name/url 与磁盘一致）；
2. 同名（含大小写不敏感碰撞）二次上传不覆盖——sha256 比对第一个文件字节；
3. 穿越攻击用例全部被拒或净化到 Attachments/ 目录内，无越界写入；
4. 扩展名白名单 400、配额 413 与半成品清理不回归；
5. 二次防线（落盘前路径校验）与 O_EXCL 并发语义。

穿越用例同时覆盖两条投递路径：
- 普通 ``files=`` multipart（httpx 会在客户端侧剥离部分 Windows 路径前缀）；
- 手工构造的原始 multipart（把 host 侧真正会收到的恶意文件名原样投递给服务端）。
"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi import HTTPException


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root)


def _attach(client) -> Path:
    return _ws(client) / "Attachments"


def _rel_files(ws: Path) -> set[str]:
    """workspace 内文件相对路径（忽略 .knowledgeeditor/ 索引自身变动）。"""
    out = set()
    for p in ws.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(ws).as_posix()
        if not rel.startswith(".knowledgeeditor/"):
            out.add(rel)
    return out


def _outside_files(ws: Path) -> set[str]:
    """workspace 之外（其父目录下）的文件——越界写入探针。"""
    return {
        p.as_posix()
        for p in ws.parent.rglob("*")
        if p.is_file() and p != ws and ws not in p.parents
    }


def _upload(client, filename: str, data: bytes = b"DATA", mime: str = "application/octet-stream"):
    return client.post("/api/attachments", files={"file": (filename, io.BytesIO(data), mime)})


_BOUNDARY = "----ke-test-s3-boundary"


def _raw_upload(client, filename: str, data: bytes = b"DATA", mime: str = "application/octet-stream"):
    """原始 multipart：绕过 httpx 的 filename 客户端预处理，投递 host 视角的恶意文件名。"""
    body = (
        f"--{_BOUNDARY}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode("utf-8") + data + f"\r\n--{_BOUNDARY}--\r\n".encode("utf-8")
    return client.post(
        "/api/attachments",
        content=body,
        headers={"Content-Type": f"multipart/form-data; boundary={_BOUNDARY}"},
    )


# ---------- 1. 保留原始文件名 ----------


def test_upload_preserves_cjk_space_and_case(client):
    """验收 1：中文/空格/大小写原样保留，磁盘与返回 path/name 一致。"""
    ws = _ws(client)
    data = b"%PDF-1.4 \xe4\xb8\xad\xe6\x96\x87"
    r = _upload(client, "我的 报告 v2.pdf", data, "application/pdf")
    assert r.status_code == 201, r.text
    info = r.json()
    assert info["category"] == "files"
    assert info["path"] == "Attachments/files/我的 报告 v2.pdf"
    assert info["name"] == "我的 报告 v2.pdf"
    assert info["url"] == "/api/attachments/Attachments/files/我的 报告 v2.pdf"
    assert info["size"] == len(data)
    assert (ws / info["path"]).read_bytes() == data
    assert client.get(info["url"]).content == data

    # 主名与扩展名大小写均原样保留；分类仍按小写扩展名判定
    r2 = _upload(client, "Photo Album V2.PNG", b"png-bytes", "image/png")
    assert r2.status_code == 201, r2.text
    assert r2.json()["path"] == "Attachments/images/Photo Album V2.PNG"
    assert r2.json()["category"] == "images"

    # 列表端点回读：保留的原始名可见
    names = {a["name"] for a in client.get("/api/attachments/list").json()["attachments"]}
    assert {"我的 报告 v2.pdf", "Photo Album V2.PNG"} <= names


def test_upload_normalization_is_minimal(client):
    """仅折叠连续空白/去首部点与尾部点，其余字符保留（与 v1.1.8 命名策略一致）。"""
    cases = [
        ("a  b.txt", "a b.txt"),
        ("...hidden.txt", "hidden.txt"),
        ("报告 .txt", "报告.txt"),
    ]
    for filename, expect in cases:
        r = _upload(client, filename, b"X", "text/plain")
        assert r.status_code == 201, r.text
        assert r.json()["path"] == f"Attachments/files/{expect}", (filename, r.text)


def test_oversize_name_truncated_inside_directory(client):
    """300 字符名截断到安全长度，不 500、不越界。"""
    ws = _ws(client)
    r = _upload(client, "x" * 300 + ".txt", b"LONG", "text/plain")
    assert r.status_code == 201, r.text
    info = r.json()
    assert info["path"].startswith("Attachments/files/")
    assert info["path"].endswith(".txt")
    assert len(info["name"]) <= 84  # 80 字符主名上限 + 扩展名
    assert (ws / info["path"]).is_file()
    assert (ws / info["path"]).resolve().parent == (_attach(client) / "files").resolve()


def test_reserved_windows_names_prefixed(client):
    """Windows 保留名（CON/PRN/AUX/NUL/COM1..9/LPT1..9）加前缀 `_`，不落成保留名。"""
    cases = [("CON.txt", "_CON.txt"), ("prn.pdf", "_prn.pdf"), ("aux.png", "_aux.png"),
             ("com1.txt", "_com1.txt"), ("LPT9.txt", "_LPT9.txt")]
    for filename, expect in cases:
        r = _upload(client, filename, b"X", "application/octet-stream")
        assert r.status_code == 201, (filename, r.text)
        assert r.json()["name"] == expect, (filename, r.text)


def test_empty_filename_falls_back_to_unnamed(client):
    """空文件名确定性回退 `unnamed` + `.bin`，不 500（原始 multipart 才能发出空 filename）。"""
    ws = _ws(client)
    r = _raw_upload(client, "", b"EMPTY")
    assert r.status_code == 201, r.text
    info = r.json()
    assert info["path"] == "Attachments/files/unnamed.bin"
    assert (ws / info["path"]).read_bytes() == b"EMPTY"


def test_cjk_attachment_disposition_header_is_rfc6266(client):
    """保留 CJK 名后，非内联附件的 Content-Disposition 必须按 RFC 6266 编码。

    直接把 CJK 写进 `filename="..."` 会让 latin-1 头编码抛 UnicodeEncodeError（500）。
    """
    name = "季度 报告.txt"
    r = _upload(client, name, b"TXT", "text/plain")
    assert r.status_code == 201, r.text
    rel = r.json()["path"]
    url = "/api/attachments/" + "/".join(quote(seg, safe="") for seg in rel.split("/"))
    g = client.get(url)
    assert g.status_code == 200, g.text
    cd = g.headers["content-disposition"]
    assert cd.startswith("attachment;")
    assert "filename*=UTF-8''" in cd
    assert quote(name, safe="") in cd
    cd.encode("latin-1")  # 头必须可按 latin-1 编码（uvicorn 头编码约束）
    assert g.content == b"TXT"

    # 内联类型（pdf）不带 Content-Disposition
    r2 = _upload(client, "我的 报告 v2.pdf", b"%PDF-1.4", "application/pdf")
    url2 = "/api/attachments/" + "/".join(quote(s, safe="") for s in r2.json()["path"].split("/"))
    g2 = client.get(url2)
    assert g2.status_code == 200, g2.text
    assert "content-disposition" not in g2.headers


def test_transport_escaped_name_decoded_before_storing(client):
    """multipart 传输层转义（`%22`/`%0D%0A`）先还原再净化：不含 %XX 残留，且可回读。

    HTML 表单规范会把 `"`/CR/LF 转义成 %22/%0D/%0A，客户端侧无法直接发出原字符；
    落盘名必须还原为净化后的真实名（否则磁盘上出现字面量 %22，URL 往返也有歧义）。
    """
    ws = _ws(client)
    cases = [
        ('my"quote".txt', b'QUOTE'),           # httpx 会按规范编码为 %22
        ("line\r\nbreak.txt", b"CRLF"),        # 编码为 %0D%0A
    ]
    for filename, payload in cases:
        r = _upload(client, filename, payload, "text/plain")
        assert r.status_code == 201, (filename, r.text)
        info = r.json()
        assert "%22" not in info["name"] and "%0d" not in info["name"].lower()
        assert "%0a" not in info["name"].lower()
        assert '"' not in info["name"] and "\r" not in info["name"] and "\n" not in info["name"]
        assert (ws / info["path"]).read_bytes() == payload
        # 前端 URL 形态（逐段 encodeURIComponent）可回读
        url = "/api/attachments/" + "/".join(quote(seg, safe="") for seg in info["path"].split("/"))
        g = client.get(url)
        assert g.status_code == 200, (filename, url, g.text)
        assert g.content == payload


# ---------- 2. 同名冲突绝不覆盖 ----------


def test_duplicate_upload_never_overwrites_first(client):
    """验收 2：同文件二次/三次上传 → 确定性去重名，第一个字节不变（sha256 比对）。"""
    ws = _ws(client)
    payloads = [b"FIRST" * 128, b"SECOND" * 128, b"THIRD" * 128]
    paths = []
    for payload in payloads:
        r = _upload(client, "dup.png", payload, "image/png")
        assert r.status_code == 201, r.text
        paths.append(r.json()["path"])
    assert paths == [
        "Attachments/images/dup.png",
        "Attachments/images/dup-1.png",
        "Attachments/images/dup-2.png",
    ]
    digests = [hashlib.sha256((ws / p).read_bytes()).hexdigest() for p in paths]
    assert digests == [hashlib.sha256(p).hexdigest() for p in payloads]
    # 首次上传的文件既未被截断也未被覆盖
    assert (ws / paths[0]).read_bytes() == payloads[0]


def test_case_insensitive_collision_deduped(client):
    """大小写不敏感碰撞（Report.TXT vs report.txt）同样不覆盖。"""
    ws = _ws(client)
    a = _upload(client, "Report.TXT", b"AAA", "text/plain")
    b = _upload(client, "report.txt", b"BBB", "text/plain")
    assert a.status_code == 201 and b.status_code == 201, (a.text, b.text)
    assert a.json()["path"] == "Attachments/files/Report.TXT"
    assert b.json()["path"] == "Attachments/files/report-1.txt"
    assert (ws / "Attachments/files/Report.TXT").read_bytes() == b"AAA"
    assert (ws / b.json()["path"]).read_bytes() == b"BBB"


def test_directory_with_same_name_does_not_break_upload(client):
    """同名目录占位时退到去重名（存在性检查覆盖文件与目录），不 500。"""
    (_attach(client) / "files").mkdir(parents=True, exist_ok=True)
    (_attach(client) / "files" / "occupado.txt").mkdir()
    r = _upload(client, "occupado.txt", b"OK", "text/plain")
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "occupado-1.txt"


# ---------- 3. 路径穿越防护 ----------


_TRAVERSALS = [
    "../../evil.md",
    "..\\evil.md",
    "/etc/passwd",
    "C:\\Windows\\evil.md",
    "....//evil",
    "%2e%2e%2f",
    ".",
    "..",
    "x" * 300 + ".txt",
    "CON.md",
]


@pytest.mark.parametrize("filename", _TRAVERSALS)
def test_traversal_attempts_confined_to_attachments(client, filename):
    """验收 3：穿越用例全部被拒或净化到 Attachments/<category>/ 内，无越界写入。"""
    ws = _ws(client)
    before = _rel_files(ws)
    outside_before = _outside_files(ws)

    r = _upload(client, filename, b"EVIL")

    new = _rel_files(ws) - before
    if r.status_code == 201:
        info = r.json()
        rel = info["path"]
        assert rel.startswith("Attachments/"), rel
        assert ".." not in rel.split("/"), rel
        target = (ws / rel).resolve()
        assert ws.resolve() in target.parents, rel
        assert target.parent == (_attach(client) / info["category"]).resolve(), rel
        assert target.is_file()
        assert info["name"] == target.name
        assert new == {rel}
    else:
        assert 400 <= r.status_code < 500, r.text
        assert new == set(), f"被拒的上传不得留下文件：{new}"

    # 越界探针：workspace 外无新增文件；常见逃逸落点不存在
    assert _outside_files(ws) == outside_before
    assert not (ws / "evil.md").exists()
    assert not (ws / "evil.txt").exists()
    assert not (_attach(client) / "evil.md").exists()
    assert not (_attach(client) / "evil.txt").exists()
    assert not (ws.parent / "evil.md").exists()


_RAW_TRAVERSALS = [
    "/etc/passwd",
    "C:\\Windows\\evil.txt",
    "..\\..\\evil.txt",
    "\\\\server\\share\\evil.txt",
    "%2e%2e%2f",
    "bad\x00name.txt",
    "bad\x01name.txt",
    "tab\tname.txt",
]


@pytest.mark.parametrize("filename", _RAW_TRAVERSALS)
def test_host_side_hostile_filenames_confined(client, filename):
    """host 视角的恶意名（UNC/盘符/控制字符/编码变体）经原始 multipart 投递，仍不出目录。"""
    ws = _ws(client)
    before = _rel_files(ws)
    outside_before = _outside_files(ws)

    r = _raw_upload(client, filename, b"EVIL")

    assert r.status_code in (201, 400), r.text
    if r.status_code == 201:
        info = r.json()
        rel = info["path"]
        assert rel.startswith("Attachments/"), rel
        target = (ws / rel).resolve()
        assert ws.resolve() in target.parents, rel
        assert target.parent == (_attach(client) / info["category"]).resolve(), rel
        assert target.is_file()
        assert _rel_files(ws) - before == {rel}
    assert _outside_files(ws) == outside_before
    assert not (ws.parent / "evil.txt").exists()
    assert not (_attach(client) / "evil.txt").exists()


def test_hostile_names_sanitized_deterministically(client):
    """恶意名被净化到目录内的确定性结果（不是空白/回退到随机名）。"""
    cases = [
        ("/etc/passwd", "Attachments/files/etc passwd.bin"),
        ("....//evil", "Attachments/files/evil.bin"),
        ("\\\\server\\share\\evil.txt", "Attachments/files/server share evil.txt"),
        ("bad\x00name.txt", "Attachments/files/bad name.txt"),
        ("%2e%2e%2f", None),  # 编码穿越：直接 400
        ("CON.txt", "Attachments/files/_CON.txt"),
        ("com1.pdf", "Attachments/files/_com1.pdf"),
    ]
    for filename, expect in cases:
        r = _raw_upload(client, filename, b"X")
        if expect is None:
            assert r.status_code == 400, (filename, r.text)
            continue
        assert r.status_code == 201, (filename, r.text)
        assert r.json()["path"] == expect, (filename, r.text)


def test_second_layer_path_guard_rejects_escapes(client):
    """二次防线：即使净化被绕过，落盘路径校验也必须拒绝越界目标。"""
    import app.routers.attachments as att

    root = _ws(client)
    for evil in ["../evil.txt", "..", ".", "", "a/b.txt", "a\\b.txt", "..\\evil.txt"]:
        with pytest.raises(HTTPException) as ei:
            att._attachment_target(root, "Attachments/files", evil)
        assert ei.value.status_code == 400, evil
    ok = att._attachment_target(root, "Attachments/files", "ok.txt")
    assert ok.name == "ok.txt"
    assert ok.parent == (root / "Attachments/files").resolve()
    assert root.resolve() in ok.parents


def test_excl_open_races_fall_back_to_next_suffix(client, monkeypatch):
    """O_EXCL 语义：存在性扫描后名字被抢占也不会覆盖，退到下一个去重后缀。"""
    import app.routers.attachments as att

    root = _ws(client)
    fdir = root / "Attachments/files"
    fdir.mkdir(parents=True, exist_ok=True)
    (fdir / "race.txt").write_bytes(b"EXISTING")

    # 模拟竞态：扫描结果为空，但名字实际已被占用
    monkeypatch.setattr(att, "_existing_name_keys", lambda d: set())
    target, out = att._create_unique(root, "Attachments/files", "race", ".txt")
    try:
        out.write(b"NEW")
    finally:
        out.close()
    assert target.name == "race-1.txt"
    assert (fdir / "race.txt").read_bytes() == b"EXISTING"


# ---------- 4. 既有约束不回归 ----------


@pytest.mark.parametrize("filename", ["evil.exe", "notes.md", "script.sh", "archive.tar.gz", "x.bin"])
def test_suffix_whitelist_still_enforced(client, filename):
    """验收 4：扩展名白名单仍生效（非白名单 400，且不产生任何文件）。"""
    ws = _ws(client)
    before = _rel_files(ws)
    r = _upload(client, filename, b"X")
    assert r.status_code == 400, r.text
    assert _rel_files(ws) == before


def test_quota_413_and_partial_cleanup_no_regression(client, monkeypatch):
    """验收 4：配额 413 + 半成品清理不回归；清理后可立即用同名重新上传。"""
    import app.routers.attachments as att

    ws = _ws(client)
    monkeypatch.setattr(att, "MAX_UPLOAD_SIZE", 1024)
    r = _upload(client, "配额 测试.png", b"\x00" * 4096, "image/png")
    assert r.status_code == 413, r.text
    assert not list((_attach(client) / "images").glob("*.png")), "半成品必须清理"

    monkeypatch.setattr(att, "MAX_UPLOAD_SIZE", 512 * 1024 * 1024)
    r2 = _upload(client, "配额 测试.png", b"\x00" * 128, "image/png")
    assert r2.status_code == 201, r2.text
    assert r2.json()["path"] == "Attachments/images/配额 测试.png"
    assert (ws / r2.json()["path"]).stat().st_size == 128
