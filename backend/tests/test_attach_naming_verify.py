"""独立对抗式验证：S-3（附件保留原名 / 路径穿越）与 S-1（草稿恢复点协议层）。

本文件由**独立验证员**编写（task-3），与开发者自测 `test_attach_naming.py`
**无复用、无调用、无共享断言**——用例矩阵、净化期望与「越界写入」判定全部
由验证员独立推导。

设计原则（对抗式）：
1. 不信任返回值。每条上传用例在**上传前后对工作区根及其父目录做全量
   snapshot（rel → sha256）**，并对「朴素实现会写到的越界目标路径」逐一
   做存在性/哈希比对，任何落在 `root/Attachments/**` 之外的新增或修改
   文件都判 FAIL。
2. 覆盖两类失败面：**(a) 越界写入**（穿越/绝对路径/UNC/盘符/NUL）；
   **(b) 服务端 5xx**（退化文件名不得 500，必须有确定性回退）。
3. 断言与实现细节解耦：不断言具体的净化算法，只断言「落盘必在
   Attachments/<category>/ 内」「返回 path 与真实落盘一致」「扩展名白名单
   仍 400」「同名不覆盖」等可观测契约。

运行：
    cd backend && python3 -m pytest tests/test_attach_naming_verify.py -q

注意：`pytest.ini` 已有 `addopts = -q`；如需完整统计行请加 `-o addopts=""`。
"""
from __future__ import annotations

import hashlib
import io
import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

import pytest

# ---------------------------------------------------------------------------
# 验证员自有的常量与纯函数（不 import 被测模块内部集合，避免同源错误）
# ---------------------------------------------------------------------------
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}
_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
_WIN_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")
_ATT = "Attachments"
# 索引库每次上传都会被重写，属于已知噪声：仅排除这两处精确路径
_DB_CHURN_TAILS = {"index.db", "index.db-journal", "index.db-wal", "index.db-shm"}
_DB_CHURN_DIR = ".knowledgeeditor"


def _ws(client) -> Path:
    return Path(client.app.state.workspace_root).resolve()


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _snapshot(base: Path) -> dict[str, str]:
    """base 下全部常规文件 -> {rel_posix: sha256}。

    索引库（.knowledgeeditor/index.db*）为已知写入噪声，精确排除；
    其余任何变化（新增/修改/删除）都视为信号。
    """
    out: dict[str, str] = {}
    for p in sorted(base.rglob("*")):
        if not p.is_file() or p.is_symlink():
            continue
        rel = p.relative_to(base).as_posix()
        tail = rel.rsplit("/", 1)[-1]
        if tail in _DB_CHURN_TAILS and _DB_CHURN_DIR in rel.split("/"):
            continue
        out[rel] = _sha256_file(p)
    return out


def _upload(client, filename, data: bytes = b"ke-verify", content_type: str = "application/pdf"):
    """直打 POST /api/attachments。

    返回 (response | None, exception | None)。httpx/starlette 在构造含 NUL、
    CR/LF 的 multipart 头时可能自行拒绝——这是客户端侧拒绝，捕获后仍要断言
    无越界写入（不得因捕获异常而放过服务端写入）。
    """
    try:
        r = client.post(
            "/api/attachments",
            files={"file": (filename, io.BytesIO(data), content_type)},
        )
        return r, None
    except Exception as exc:  # noqa: BLE001 - 故意捕获以便继续做越界断言
        return None, exc


def _expected_category(raw_name: str) -> str:
    ext = Path(raw_name).suffix.lower()
    if ext in _IMAGE_EXTS:
        return "images"
    if ext in _VIDEO_EXTS:
        return "videos"
    return "files"


def _naive_escape_targets(ws: Path, filename: str) -> list[Path]:
    """「朴素拼接实现」在收到该 filename 时会写到的**越界**目标路径集合（resolve 后）。

    覆盖三种常见错误写法：`root/Attachments/files/<raw>`、
    `root/Attachments/<raw>`、`root/<raw>`。绝对路径 payload（/etc/passwd、
    C:\\...）在 resolve 后即其绝对目标。

    说明：仅保留 **ws/Attachments/ 之外** 的目标——payload 若不含 POSIX 路径
    分隔符（如全角 `．／` 或 `%2e%2e%2f` 字面量），朴素拼接结果恰好就是合法
    落盘位置，不应被当作越界；「落在 Attachments/ 但目录层级不对」的情况由
    用例中的 category 前缀断言覆盖。
    """
    att = (ws / _ATT).resolve()
    targets: list[Path] = []
    for base in (ws / _ATT / "files", ws / _ATT, ws):
        try:
            t = (base / filename).resolve()
        except (OSError, ValueError, RuntimeError):
            # 含 NUL / 超长等无法 resolve 的输入：跳过（其写入必然抛错）
            continue
        try:
            t.relative_to(att)
        except ValueError:
            targets.append(t)  # 在 Attachments/ 之外 = 真越界目标
    return targets


def _inside_attachments(rel_from_base: str, base: Path, ws: Path) -> str | None:
    """`rel_from_base`（相对 snapshot base）是否位于 ws/Attachments/ 之内。

    是 → 返回其相对 ws 的路径（如 `Attachments/files/x.pdf`）；否 → None。
    snapshot 的键相对 base（= ws.parent），断言需要 ws 相对语义，此处统一换算。
    """
    try:
        inner = (base / rel_from_base).relative_to(ws).as_posix()
    except ValueError:
        return None  # 在 ws 之外
    if inner == _ATT or inner.startswith(_ATT + "/"):
        return inner
    return None


def _assert_contained(
    *,
    ws: Path,
    base: Path,
    before: dict[str, str],
    after: dict[str, str],
    context: str,
) -> list[str]:
    """核心安全断言：不删除既有文件，且新增/修改的文件全部在 ws/Attachments/ 下。

    两套**独立实现**的越界判定同时生效（互为交叉校验，防止单一断言的系统性偏差）：
      (A) 字符串坐标系换算 `_inside_attachments`（相对 ws 前缀判定）；
      (B) 绝对路径坐标系 `Path.resolve().is_relative_to(att)`（跟随符号链接）。
    返回新增文件**相对 ws** 的路径列表（供调用方与返回体 path 比对）。
    """
    deleted = sorted(set(before) - set(after))
    assert not deleted, f"[{context}] 上传过程删除了工作区既有文件: {deleted}"

    att_abs = (ws / _ATT).resolve()

    def _abs_outside(rel: str) -> bool:
        """(B) 绝对路径判定：resolve 后是否落在 ws/Attachments/ 之外。"""
        try:
            return not (base / rel).resolve().is_relative_to(att_abs)
        except (OSError, RuntimeError):
            return True

    changed = sorted(rel for rel, h in after.items() if before.get(rel) not in (None, h))
    outside_changed = [rel for rel in changed if _inside_attachments(rel, base, ws) is None]
    assert not outside_changed, (
        f"[{context}] 检测到 Attachments/ 之外的写入: {outside_changed}\n"
        f"快照根: {base}"
    )
    outside_changed_abs = [rel for rel in changed if _abs_outside(rel)]
    assert not outside_changed_abs, (
        f"[{context}] 独立绝对路径扫描同样判定越界写入: {outside_changed_abs}\n"
        f"快照根: {base}"
    )

    new = sorted(rel for rel in after if rel not in before)
    inside_new: list[str] = []
    outside_new: list[str] = []
    for rel in new:
        inner = _inside_attachments(rel, base, ws)
        if inner is None:
            outside_new.append(rel)
        else:
            inside_new.append(inner)
    assert not outside_new, (
        f"[{context}] 检测到 Attachments/ 之外的新增文件: {outside_new}\n"
        f"快照根: {base}"
    )
    outside_new_abs = [rel for rel in new if _abs_outside(rel)]
    assert not outside_new_abs, (
        f"[{context}] 独立绝对路径扫描同样判定越界新增: {outside_new_abs}\n"
        f"快照根: {base}"
    )
    return inside_new


def _assert_valid_stored_name(name: str) -> None:
    """落盘文件名必须满足的最小可用性/安全契约。"""
    assert name not in ("", ".", ".."), f"非法落盘名: {name!r}"
    assert "/" not in name and "\\" not in name, f"落盘名含路径分隔符: {name!r}"
    assert not _CTRL_RE.search(name), f"落盘名含控制字符/NUL: {name!r}"
    assert '"' not in name and "\r" not in name and "\n" not in name, (
        f"落盘名可用于响应头注入: {name!r}"
    )
    assert len(name.encode("utf-8")) <= 255, (
        f"落盘名单个组件超过 255 字节（ext4/NTFS 上限）: {len(name.encode('utf-8'))}"
    )
    stem = name.split(".", 1)[0].lower()
    assert stem not in _WIN_RESERVED, f"Windows 保留名未加下划线前缀: {name!r}"


def _mk_doc(client, title: str, content: str = "") -> str:
    r = client.post("/api/articles", json={"title": title, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture()
def canary(client, tmp_path):
    """工作区之外的越界写入金丝雀（root 的父目录 + /tmp + HOME）。"""
    ws = _ws(client)
    base = ws.parent
    outside_dir = base / "OUTSIDE-canary"
    outside_dir.mkdir(exist_ok=True)
    outside = outside_dir / "canary.txt"
    outside.write_text("CANARY-OUTSIDE-WORKSPACE", encoding="utf-8")

    tmp_file = Path("/tmp") / f"ke-verify-tmp-canary-{uuid.uuid4().hex}.txt"
    tmp_file.write_text("CANARY-TMP", encoding="utf-8")

    home_probe = Path.home() / f".ke-verify-should-never-exist-{uuid.uuid4().hex}.pdf"

    etc_passwd = Path("/etc/passwd")
    passwd_sha = _sha256_file(etc_passwd) if etc_passwd.is_file() else None

    yield {
        "ws": ws,
        "base": base,
        "outside": outside,
        "tmp_file": tmp_file,
        "home_probe": home_probe,
        "passwd_sha": passwd_sha,
    }
    tmp_file.unlink(missing_ok=True)


def _assert_canaries(canary: dict) -> None:
    assert canary["outside"].read_text(encoding="utf-8") == "CANARY-OUTSIDE-WORKSPACE"
    assert canary["tmp_file"].read_text(encoding="utf-8") == "CANARY-TMP"
    assert not canary["home_probe"].exists(), (
        f"HOME 下出现入侵文件（~ 展开/绝对路径逃逸）: {canary['home_probe']}"
    )
    if canary["passwd_sha"] is not None:
        assert _sha256_file(Path("/etc/passwd")) == canary["passwd_sha"], "/etc/passwd 被修改"


# ===========================================================================
# S-3 高危面一：路径穿越 / 绝对路径 / 盘符 / UNC / 编码变体
# ===========================================================================
_TRAVERSAL_TEMPLATES = [
    pytest.param("../../evil.pdf", id="rel-up2"),
    pytest.param("..\\..\\evil.pdf", id="win-backslash-up2"),
    pytest.param("../evil.pdf", id="rel-up1"),
    pytest.param("..\\evil.pdf", id="win-backslash-up1"),
    pytest.param("a/../../evil.pdf", id="subdir-then-up2"),
    pytest.param("a\\..\\..\\evil.pdf", id="subdir-backslash-up2"),
    pytest.param("....//evil.pdf", id="four-dots-slash"),
    pytest.param("....//evil.md", id="four-dots-md"),
    pytest.param("../../evil.md", id="rel-up2-md"),
    pytest.param("..\\..\\evil.md", id="win-up2-md"),
    pytest.param("/etc/passwd", id="abs-etc-passwd"),
    pytest.param("/tmp/ke-verify-{u}.pdf", id="abs-tmp"),
    pytest.param("C:\\Windows\\evil.pdf", id="win-drive-backslash"),
    pytest.param("C:/Windows/evil.pdf", id="win-drive-slash"),
    pytest.param("C:evil.pdf", id="win-drive-relative"),
    pytest.param("\\\\server\\share\\evil.pdf", id="unc-backslash"),
    pytest.param("//server/share/evil.pdf", id="unc-slash"),
    pytest.param("%2e%2e%2fevil.pdf", id="url-pct-dots"),
    pytest.param("..%2f..%2fevil.pdf", id="url-pct-slash"),
    pytest.param("%252e%252e%252fevil.pdf", id="url-double-pct"),
    pytest.param("{u}../../../evil.pdf", id="marker-then-up"),
    pytest.param("../../../../../../ke-verify-{u}.pdf", id="deep-up6"),
    pytest.param("../../../../../../../../ke-verify-{u}.pdf", id="deep-up8"),
    pytest.param("~/.ke-verify-{u}.pdf", id="tilde-home"),
    pytest.param("\u202e../evil.pdf", id="rtl-override-up1"),
    pytest.param("\uff0e\uff0e\uff0f\uff0e\uff0e\uff0fevil.pdf", id="fullwidth-nfkc-dots"),
    pytest.param("Attachments/../../evil.pdf", id="pretend-attachments"),
    pytest.param("evil.pdf/../../../ke-verify-{u}.pdf", id="ext-then-up3"),
]


@pytest.mark.parametrize("filename_tpl", _TRAVERSAL_TEMPLATES)
def test_s3_traversal_never_writes_outside_attachments(client, canary, filename_tpl):
    """穿越类 filename：逐条断言无越界写入、无 5xx、金丝雀未被动。"""
    ws = canary["ws"]
    base = canary["base"]
    filename = filename_tpl.replace("{u}", uuid.uuid4().hex[:10])

    # 朴素实现的目标路径：上传前状态（存在则记录哈希，不存在则必须仍不存在）
    naive_targets = _naive_escape_targets(ws, filename)
    pre = {
        str(t): (_sha256_file(t) if t.is_file() else None)
        for t in naive_targets
        if not t.exists() or t.is_file()
    }

    before = _snapshot(base)
    r, exc = _upload(client, filename, b"KE-TRAVERSAL-PAYLOAD")
    after = _snapshot(base)

    new_inside = _assert_contained(
        ws=ws, base=base, before=before, after=after,
        context=f"traversal {filename!r}",
    )
    _assert_canaries(canary)

    # 朴素目标：原有文件不得被改动；原本不存在者不得被创建
    for target, pre_sha in pre.items():
        t = Path(target)
        if pre_sha is None:
            assert not t.exists(), f"越界写入发生: {t} (payload={filename!r})"
        else:
            assert t.is_file() and _sha256_file(t) == pre_sha, (
                f"越界目标被修改: {t} (payload={filename!r})"
            )

    if r is None:
        pytest.skip(f"客户端侧拒绝（未打到服务端）: {exc!r}")
    assert r.status_code < 500, (
        f"{filename!r} -> HTTP {r.status_code}（退化/恶意名不得 500）: {r.text[:300]}"
    )

    if r.status_code in (200, 201):
        body = r.json()
        rel_path = body["path"]
        assert rel_path.startswith(f"{_ATT}/"), f"返回 path 越界: {rel_path!r}"
        full = ws / rel_path
        assert full.is_file(), f"返回 path 在磁盘不存在: {rel_path!r}"
        assert len(new_inside) == 1, (
            f"2xx 上传应恰好新增 1 个附件文件，实际 {len(new_inside)}: {new_inside}"
        )
        assert new_inside[0] == rel_path, (
            f"返回 path 与真实新增文件不一致: 返回={rel_path!r} 落盘={new_inside[0]!r}"
        )
        _assert_valid_stored_name(full.name)
        cat = _expected_category(filename)
        assert rel_path.startswith(f"{_ATT}/{cat}/"), (
            f"分类目录不符（期望 {cat}）: {rel_path!r}"
        )
    else:
        assert r.status_code in (400, 403, 404, 413, 422), (
            f"未预期的拒绝码 {r.status_code}: {r.text[:200]}"
        )
        assert not new_inside, f"被拒请求仍落盘: {new_inside}"


# ===========================================================================
# S-3 高危面二：退化 / 特殊文件名（不得 500，必须确定性回退）
# ===========================================================================
_DEGENERATE_TEMPLATES = [
    pytest.param("", id="empty"),
    pytest.param(".", id="dot"),
    pytest.param("..", id="dotdot"),
    pytest.param("...", id="three-dots"),
    pytest.param("....", id="four-dots"),
    pytest.param("....pdf", id="dots-pdf"),
    pytest.param(".hidden.pdf", id="leading-dot"),
    pytest.param("..pdf", id="two-dots-pdf"),
    pytest.param("trailing.pdf.", id="trailing-dot"),
    pytest.param("trailing .pdf ", id="trailing-space-ext"),
    pytest.param("trailingspace.pdf ", id="trailing-space"),
    pytest.param(" leadingspace.pdf", id="leading-space"),
    pytest.param("ev\x01il.pdf", id="ctrl-0x01"),
    pytest.param("ev\x07il.pdf", id="ctrl-0x07"),
    pytest.param("ev\til.pdf", id="tab"),
    pytest.param("ev\ril.pdf", id="cr"),
    pytest.param("ev\nil.pdf", id="lf"),
    pytest.param("ev\x00il.pdf", id="nul"),
    pytest.param("ev\x1bil.pdf", id="esc"),
    pytest.param("a" * 295 + ".pdf", id="len299"),
    pytest.param("a" * 300 + ".pdf", id="len304"),
    pytest.param("报" * 200 + ".pdf", id="len-cjk-604bytes"),
    pytest.param("报告🚀 v1.pdf", id="emoji"),
    pytest.param("cafe\u0301.pdf", id="nfd-e-acute"),
    pytest.param("evil\u202egnp.pdf", id="rtl-override-name"),
    pytest.param("evil\u200bzwsp.pdf", id="zero-width-space"),
    pytest.param("CON.pdf", id="win-reserved-con"),
    pytest.param("con.pdf", id="win-reserved-con-lower"),
    pytest.param("NUL.pdf", id="win-reserved-nul"),
    pytest.param("nul.txt", id="win-reserved-nul-txt"),
    pytest.param("PRN.pdf", id="win-reserved-prn"),
    pytest.param("AUX.pdf", id="win-reserved-aux"),
    pytest.param("COM1.pdf", id="win-reserved-com1"),
    pytest.param("LPT1.txt", id="win-reserved-lpt1"),
    pytest.param("NUL.tar.pdf", id="win-reserved-with-inner-ext"),
    pytest.param("CON", id="win-reserved-no-ext"),
]


@pytest.mark.parametrize("filename_tpl", _DEGENERATE_TEMPLATES)
def test_s3_degenerate_names_deterministic_no_5xx(client, canary, filename_tpl):
    """退化名：不得 500；若接受则落盘名必须合法、唯一、在 Attachments 内。"""
    ws = canary["ws"]
    base = canary["base"]
    filename = filename_tpl.replace("{u}", uuid.uuid4().hex[:10])

    before = _snapshot(base)
    r, exc = _upload(client, filename, b"KE-DEGENERATE")
    after = _snapshot(base)
    new_inside = _assert_contained(
        ws=ws, base=base, before=before, after=after,
        context=f"degenerate {filename!r}",
    )
    _assert_canaries(canary)

    if r is None:
        pytest.skip(f"客户端侧拒绝（未打到服务端）: {exc!r}")
    assert r.status_code < 500, (
        f"{filename!r} -> HTTP {r.status_code}（退化名必须确定性回退，不得 500）: {r.text[:300]}"
    )
    if r.status_code in (200, 201):
        body = r.json()
        rel_path = body["path"]
        assert rel_path.startswith(f"{_ATT}/")
        full = ws / rel_path
        assert full.is_file(), f"返回 path 不存在: {rel_path!r}"
        assert len(new_inside) == 1, f"2xx 应恰好新增 1 个文件，实际 {new_inside}"
        _assert_valid_stored_name(full.name)
    else:
        assert not new_inside, f"被拒请求仍落盘: {new_inside}"


# ===========================================================================
# S-3 高危面三：响应头注入（落盘名进入 Content-Disposition）
# ===========================================================================
@pytest.mark.parametrize(
    "filename",
    [
        pytest.param('evil".txt', id="quote-in-name"),
        pytest.param('evil"; x="y.txt', id="header-param-injection"),
        pytest.param("evil\r\nX-Injected: 1.txt", id="crlf-in-name"),
        pytest.param("evil\nX-Injected: 2.txt", id="lf-in-name"),
    ],
)
def test_s3_no_response_header_injection_via_filename(client, filename):
    """落盘名若把 raw filename 带入 Content-Disposition 会造成响应头注入。

    .txt 不在内联白名单 → GET 一定走 Content-Disposition 分支（P1-15）。
    """
    r, exc = _upload(client, filename, b"KE-HEADER")
    if r is None:
        pytest.skip(f"客户端侧拒绝: {exc!r}")
    assert r.status_code < 500, r.text[:200]
    if r.status_code not in (200, 201):
        pytest.skip(f"该名被拒（{r.status_code}），无落盘 → 无头注入面")
    rel_path = r.json()["path"]
    ws = _ws(client)
    stored = (ws / rel_path).name
    for bad in ('"', "\r", "\n", "\x00"):
        assert bad not in stored, f"落盘名含 {bad!r}，可用于响应头注入: {stored!r}"

    url = "/api/attachments/" + quote(rel_path, safe="/")
    g = client.get(url)
    assert g.status_code == 200, g.text[:200]
    cd = g.headers.get("content-disposition", "")
    assert "\r" not in cd and "\n" not in cd, f"响应头含裸换行: {cd!r}"
    assert "X-Injected" not in g.headers, f"注入头出现: {dict(g.headers)!r}"


# ===========================================================================
# S-3 契约：原名保留（CJK / 空格 / 大小写 / 扩展名）
# ===========================================================================
@pytest.mark.parametrize(
    "filename,expected_ext,expected_cat",
    [
        ("我的 报告 v2.pdf", ".pdf", "files"),
        ("Photo 1.PNG", ".PNG", "images"),
        ("Report Final 2026.docx", ".docx", "files"),
        ("数据 汇总.csv", ".csv", "files"),
        ("meeting-notes.txt", ".txt", "files"),
        ("MixedCase Name.Mp4", ".Mp4", "videos"),
    ],
)
def test_s3_original_name_preserved(client, filename, expected_ext, expected_cat):
    """磁盘与返回 path 均为 Attachments/<cat>/<原名>（保留大小写/空格/CJK）。"""
    r, exc = _upload(client, filename, b"KE-ORIGINAL-NAME")
    assert r is not None, f"客户端侧异常: {exc!r}"
    assert r.status_code == 201, f"{filename!r} -> {r.status_code}: {r.text[:200]}"
    body = r.json()
    expected_rel = f"{_ATT}/{expected_cat}/{filename}"
    assert body["path"] == expected_rel, f"未保留原名: 得到 {body['path']!r}，期望 {expected_rel!r}"
    assert body["category"] == expected_cat
    full = _ws(client) / body["path"]
    assert full.is_file(), f"磁盘上不存在 {full}"
    assert full.read_bytes() == b"KE-ORIGINAL-NAME"


def test_s3_chinese_name_readback_and_listing(client):
    """原名附件可经 URL 读回、出现在 /list、可删除（管理端点不回归）。"""
    name = "我的 报告 v2.pdf"
    data = b"KE-CJK-READBACK"
    r, _ = _upload(client, name, data)
    assert r is not None and r.status_code == 201, r.text[:200]
    rel_path = r.json()["path"]

    g = client.get("/api/attachments/" + quote(rel_path, safe="/"))
    assert g.status_code == 200, g.text[:200]
    assert g.content == data

    listing = client.get("/api/attachments/list").json()
    names = {a["rel_path"] for a in listing["attachments"]}
    assert rel_path in names, f"{rel_path!r} 未出现在 list: {sorted(names)}"

    d = client.delete("/api/attachments/" + quote(rel_path, safe="/"))
    assert d.status_code == 200, d.text[:200]
    assert not (_ws(client) / rel_path).exists()


# ===========================================================================
# S-3 契约：同名冲突不覆盖（含大小写变体 / 并发）
# ===========================================================================
def test_s3_second_upload_does_not_overwrite_first(client):
    """同名二次上传：去重名 + 第一份字节级不变（sha256 比对）。"""
    ws = _ws(client)
    a = b"FIRST-VERSION-CONTENT"
    b = b"SECOND-VERSION-CONTENT"

    r1, _ = _upload(client, "report.pdf", a)
    assert r1 is not None and r1.status_code == 201, r1 and r1.text[:200]
    p1 = ws / r1.json()["path"]
    h1 = _sha256_file(p1)

    r2, _ = _upload(client, "report.pdf", b)
    assert r2 is not None and r2.status_code == 201, r2 and r2.text[:200]
    p2 = ws / r2.json()["path"]

    assert p2 != p1, "第二次上传返回了同一路径（覆盖风险）"
    assert p2.parent == p1.parent, "去重文件应落在同目录"
    assert _sha256_file(p1) == h1 == _sha256_bytes(a), "第一份内容被覆盖/修改"
    assert _sha256_file(p2) == _sha256_bytes(b)
    assert p2.name.startswith("report"), f"去重名未承接原名: {p2.name!r}"
    assert p2.suffix == ".pdf", f"去重名丢失扩展名: {p2.name!r}"

    r3, _ = _upload(client, "report.pdf", b"THIRD")
    assert r3 is not None and r3.status_code == 201, r3 and r3.text[:200]
    p3 = ws / r3.json()["path"]
    assert len({p1, p2, p3}) == 3, "三次同名上传未产生 3 个不同文件"
    assert _sha256_file(p1) == h1


def test_s3_case_variant_does_not_clobber_existing(client):
    """大小写变体名：既有文件字节不得被改动。"""
    ws = _ws(client)
    r1, _ = _upload(client, "Report.pdf", b"UPPER-CASE-FILE")
    assert r1 is not None and r1.status_code == 201, r1 and r1.text[:200]
    p1 = ws / r1.json()["path"]
    h1 = _sha256_file(p1)

    r2, _ = _upload(client, "report.pdf", b"LOWER-CASE-FILE")
    assert r2 is not None and r2.status_code == 201, r2 and r2.text[:200]
    p2 = ws / r2.json()["path"]
    print(f"\n[ke-verify] 大小写变体实测: {p1.name!r} -> {p2.name!r}")

    assert _sha256_file(p1) == h1 == _sha256_bytes(b"UPPER-CASE-FILE"), (
        "大小写变体上传改动了既有文件（NTFS 上即为覆盖）"
    )
    if p2 == p1:
        assert _sha256_file(p1) == h1, "同路径写入覆盖了第一份"
    else:
        assert _sha256_file(p2) == _sha256_bytes(b"LOWER-CASE-FILE")


def test_s3_concurrent_same_name_uploads_lose_nothing(client):
    """并发同名上传：不覆盖、不丢内容（内容可区分 → 每份都必须能找到）。"""
    ws = _ws(client)
    n = 4
    payloads = [f"CONCURRENT-BODY-{i}".encode() for i in range(n)]

    def _one(i: int):
        return _upload(client, "race.pdf", payloads[i])

    with ThreadPoolExecutor(max_workers=n) as ex:
        results = list(ex.map(_one, range(n)))

    paths = []
    for i, (r, exc) in enumerate(results):
        assert r is not None, f"并发请求 #{i} 客户端异常: {exc!r}"
        assert r.status_code == 201, f"并发请求 #{i} -> {r.status_code}: {r.text[:200]}"
        paths.append(ws / r.json()["path"])

    assert len(set(paths)) == n, f"并发同名上传产生重复路径: {[p.name for p in paths]}"
    stored = {_sha256_file(p) for p in paths}
    for i, body in enumerate(payloads):
        assert _sha256_bytes(body) in stored, f"并发上传内容丢失: CONCURRENT-BODY-{i}"


# ===========================================================================
# S-3 回归：白名单 / 配额 / 半成品清理 / 内联策略
# ===========================================================================
@pytest.mark.parametrize(
    "filename",
    [
        pytest.param("evil.exe", id="exe"),
        pytest.param("evil.md", id="md"),
        pytest.param("evil.sh", id="sh"),
        pytest.param("evil.bat", id="bat"),
        pytest.param("evil.py", id="py"),
        pytest.param("evil.HTML5", id="html5-unknown"),
    ],
)
def test_s3_suffix_whitelist_still_400(client, filename):
    r, exc = _upload(client, filename, b"WHITELIST")
    assert r is not None, f"客户端侧异常: {exc!r}"
    assert r.status_code == 400, f"{filename!r} -> {r.status_code}（应 400）: {r.text[:200]}"


@pytest.mark.parametrize(
    "filename,expected_cat",
    [
        ("ok.PDF", "files"),
        ("ok.Zip", "files"),
        ("ok.JSON", "files"),
        ("ok.PNG", "images"),
        ("ok.MP4", "videos"),
    ],
)
def test_s3_suffix_whitelist_case_insensitive_accepts(client, filename, expected_cat):
    r, exc = _upload(client, filename, b"WHITELIST-OK")
    assert r is not None, f"客户端侧异常: {exc!r}"
    assert r.status_code == 201, f"{filename!r} -> {r.status_code}: {r.text[:200]}"
    assert r.json()["category"] == expected_cat


def test_s3_quota_413_leaves_no_partial_and_no_existing_file_damage(client, monkeypatch):
    """配额 413：半成品清理不回归；且【不得破坏同名既有文件】。

    确定性命名下若实现先 open('wb') 再检查大小，既有文件会被截断；
    413 分支的 unlink 还会把既有文件删掉——本用例独立锁死该风险。
    """
    import app.routers.attachments as attachments_mod

    ws = _ws(client)
    keep = b"ORIGINAL-MUST-SURVIVE"
    r1, _ = _upload(client, "keep.pdf", keep)
    assert r1 is not None and r1.status_code == 201, r1 and r1.text[:200]
    p1 = ws / r1.json()["path"]
    h1 = _sha256_file(p1)

    monkeypatch.setattr(attachments_mod, "MAX_UPLOAD_SIZE", 1024)
    before = _snapshot(ws.parent)
    r2, exc = _upload(client, "keep.pdf", b"X" * 4096)
    after = _snapshot(ws.parent)

    assert r2 is not None, f"客户端侧异常: {exc!r}"
    assert r2.status_code == 413, f"超配额应 413，实际 {r2.status_code}: {r2.text[:200]}"
    assert p1.is_file(), "413 清理把同名既有文件删除了"
    assert _sha256_file(p1) == h1 == _sha256_bytes(keep), "413 上传破坏了同名既有文件内容"

    new = sorted(rel for rel in after if rel not in before)
    new_no_db = [rel for rel in new if "index.db" not in rel]
    assert not new_no_db, f"413 后仍有半成品/残留: {new_no_db}"


def test_s3_inline_policy_not_regressed_with_new_names(client):
    """.png/.pdf 内联；.html/.svg/.txt 强制 attachment（P1-15 不回归）。"""
    cases = [
        ("pic.png", "image/png", False),
        ("doc.pdf", "application/pdf", False),
        ("page.html", "text/html", True),
        ("vec.svg", "image/svg+xml", True),
        ("plain.txt", "text/plain", True),
    ]
    for name, ctype, must_attach in cases:
        r, exc = _upload(client, name, b"KE-INLINE", content_type=ctype)
        assert r is not None and r.status_code == 201, r and r.text[:200]
        rel_path = r.json()["path"]
        g = client.get("/api/attachments/" + quote(rel_path, safe="/"))
        assert g.status_code == 200, g.text[:200]
        cd = g.headers.get("content-disposition", "")
        if must_attach:
            assert cd.startswith("attachment"), f"{name}: 期望 attachment，实际 {cd!r}"
        else:
            assert not cd.startswith("attachment"), f"{name}: 不应强制 attachment，实际 {cd!r}"


# ===========================================================================
# S-3 观察项（非阻塞）：净化质量矩阵——只 print 观察，断言仅覆盖硬契约
# ===========================================================================
def test_s3_advisory_name_quality_matrix(client, capsys):
    """输出「恶意名 → 实际落盘名」对照表（供报告引用），仅断言硬契约。"""
    ws = _ws(client)
    observations = []
    for tpl in [
        "../../evil.pdf",
        "..\\..\\evil.pdf",
        "\uff0e\uff0e\uff0f\uff0e\uff0e\uff0fevil.pdf",
        "a" * 295 + ".pdf",
        "报" * 200 + ".pdf",
        "cafe\u0301.pdf",
        "NUL.pdf",
        "trailing.pdf.",
        ".hidden.pdf",
    ]:
        before = _snapshot(ws)
        r, _ = _upload(client, tpl, b"KE-ADVISORY")
        after = _snapshot(ws)
        new = sorted(rel for rel in after if rel not in before)
        status = r.status_code if r is not None else "client-reject"
        stored = [Path(rel).name for rel in new]
        observations.append((tpl, status, stored))
        for rel in new:
            assert rel.startswith(f"{_ATT}/"), f"越界: {rel}"
        if r is not None and r.status_code in (200, 201):
            assert len(new) == 1
            _assert_valid_stored_name(Path(new[0]).name)

    print("\n[ke-verify] 恶意名 -> 落盘名 观察表")
    for tpl, status, stored in observations:
        print(f"  {tpl!r:>60} -> {status} {stored}")
    assert observations


# ===========================================================================
# S-3 高危面四：multipart 传输层转义（%22/%0D/%0A）与双重编码顺序差
# ===========================================================================
def test_s3_multipart_escape_decoding_not_resurrected(client):
    """传输层逆变换（%22/%0D/%0A → " / CR / LF）不得让危险字符绕过净化。

    关注「先解码还是先净化」的顺序差：无论实现怎么排序，落盘名与响应头都不得
    出现裸 `"` / CR / LF（否则可响应头注入/字段错位）。
    """
    templates = [
        ("evil%22quote.pdf", "quote"),
        ("evil%0Dquote.pdf", "cr"),
        ("evil%0Aquote.pdf", "lf"),
        ("evil%0d%0aX-Injected.pdf", "crlf"),
        ("%2522quote.pdf", "double-pct-quote"),
        ("%252e%252e%252fevil.pdf", "double-pct-traversal"),
        ("..%252fevil.pdf", "double-pct-slash"),
        ("%2522%2e%2e%2fevil.pdf", "mixed-encodings"),
        ("evil%00nul.pdf", "pct-nul"),
        ("%2e%2e%252fevil.pdf", "single-pct-dotdot-double-slash"),
    ]
    ws = _ws(client)
    for tpl, label in templates:
        before = _snapshot(ws.parent)
        r, exc = _upload(client, tpl, b"KE-ESCAPE")
        after = _snapshot(ws.parent)
        new_inside = _assert_contained(
            ws=ws, base=ws.parent, before=before, after=after,
            context=f"multipart-escape[{label}] {tpl!r}",
        )
        assert r is not None, f"客户端侧异常 {label}: {exc!r}"
        assert r.status_code < 500, f"{label}: HTTP {r.status_code} {r.text[:200]}"
        if r.status_code in (200, 201):
            rel_path = r.json()["path"]
            stored = Path(rel_path).name
            _assert_valid_stored_name(stored)
            assert '"' not in stored and "\r" not in stored and "\n" not in stored, (
                f"{label}: 落盘名含危险字符 → {stored!r}"
            )
            assert new_inside == [rel_path], f"{label}: 落盘/返回不一致 {new_inside} vs {rel_path}"

            g = client.get("/api/attachments/" + quote(rel_path, safe="/"))
            if g.status_code == 200:
                cd = g.headers.get("content-disposition", "")
                assert "\r" not in cd and "\n" not in cd, f"{label}: 响应头含裸换行 {cd!r}"
                assert "X-Injected" not in g.headers, f"{label}: 注入头出现"
            else:
                # TestClient 传输层会二次解码含 % 的路径（starlette unquote）——仅此一类允许 404
                assert "%" in rel_path and g.status_code == 404, (
                    f"{label}: GET 意外失败 {g.status_code} ({rel_path!r})"
                )
                print(f"[ke-verify] note: {rel_path!r} GET 404 = TestClient 双重解码 artifact（名字含 %）")
        else:
            assert not new_inside, f"{label}: 被拒仍落盘 {new_inside}"


# ===========================================================================
# S-3 契约：CJK Content-Disposition（RFC 6266）
# ===========================================================================
def test_s3_content_disposition_rfc6266_cjk(client):
    """中文名附件：头可按 latin-1 编码；filename* 解码 == 落盘名；非内联类型仍 attachment。"""
    roundtrip = [
        ("中文 报告.csv", True),
        ("数据 汇总.txt", True),
        ("矢量 图.svg", True),
        ("网页 页.html", True),
        ("纯 文本.docx", True),
        ("中文 报告.pdf", False),  # .pdf 属 _INLINE_EXTS（S-3 前既有行为，非本次回归）
        ("图片 图.png", False),  # 位图允许内联
    ]
    for name, must_attach in roundtrip:
        r, exc = _upload(client, name, b"KE-DISPOSITION")
        assert r is not None and r.status_code == 201, f"{name}: {exc!r} / {r and r.text[:200]}"
        rel_path = r.json()["path"]
        stored = Path(rel_path).name
        assert stored == name, f"{name}: 落盘名 {stored!r} 与原名不一致"
        g = client.get("/api/attachments/" + quote(rel_path, safe="/"))
        assert g.status_code == 200, f"{name}: GET {g.status_code}"
        cd = g.headers.get("content-disposition", "")
        if not must_attach:
            assert not cd.startswith("attachment"), f"{name}: 位图不应强制 attachment（{cd!r}）"
            continue
        assert cd.startswith("attachment"), f"{name}: 应 attachment，实际 {cd!r}"
        cd.encode("latin-1")  # 不可 latin-1 编码会在响应期炸头
        m = re.fullmatch(r'attachment; filename="([^"]*)"; filename\*=UTF-8\'\'(.+)', cd)
        assert m, f"{name}: 头格式不符 RFC 6266 约定: {cd!r}"
        assert re.fullmatch(r"[\x20-\x7e]*", m.group(1)), f"{name}: ASCII 回退段含非 ASCII: {cd!r}"
        from urllib.parse import unquote as _unquote

        assert _unquote(m.group(2)) == stored, (
            f"{name}: filename* 解码 {_unquote(m.group(2))!r} != 落盘名 {stored!r}"
        )


# ===========================================================================
# S-3 高危面五：目标路径已存在符号链接 / 目录 / 悬空链接
# ===========================================================================
def test_s3_preexisting_symlink_not_followed(client, canary):
    """目标路径上预置符号链接（含悬空/目录）→ 不得跟随写入外部，不得删改链接。

    实测：该场景下实现返回 400「非法路径」而非去重后缀——`_create_unique` 对 i=0
    候选先做 `_attachment_target`（resolve 跟随符号链接 → 判定越界）后查 taken，
    属**失败关闭**（无外部写入），与常规重名（常规文件）走去重后缀不一致。
    本用例断言安全不变量；状态码两种都记录（201 去重 / 400 拒绝均安全）。
    """
    ws = canary["ws"]
    files_dir = ws / _ATT / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    outside_file = canary["base"] / "symlink-target-outside.txt"
    outside_file.write_text("OUTSIDE-ORIGINAL", encoding="utf-8")
    link = files_dir / "link.pdf"
    link.symlink_to(outside_file)

    dangling_target = canary["base"] / "dangling-target.pdf"
    dangling = files_dir / "dangling.pdf"
    dangling.symlink_to(dangling_target)

    observed = []
    for upload_name, symlink_obj in (("link.pdf", link), ("dangling.pdf", dangling)):
        r, exc = _upload(client, upload_name, b"KE-LINK")
        assert r is not None, f"{exc!r}"
        observed.append((upload_name, r.status_code))
        assert r.status_code < 500, f"{upload_name}: 5xx {r.status_code} {r.text[:200]}"
        if r.status_code == 201:
            created = ws / r.json()["path"]
            assert created != symlink_obj, "落盘路径就是既有符号链接"
            assert created.is_file() and not created.is_symlink(), "落盘对象不是常规文件"
    assert outside_file.read_text(encoding="utf-8") == "OUTSIDE-ORIGINAL", "写入跟随符号链接逃逸到外部"
    assert not dangling_target.exists(), "悬空链接被跟随，外部出现文件"
    assert link.is_symlink() and dangling.is_symlink(), "既有符号链接被删除/替换"

    # 指向外部目录的符号链接
    outside_dir = canary["base"] / "symlink-dir-outside"
    outside_dir.mkdir(exist_ok=True)
    dir_link = files_dir / "dir.pdf"
    dir_link.symlink_to(outside_dir, target_is_directory=True)
    r3, e3 = _upload(client, "dir.pdf", b"KE-DIRLINK")
    assert r3 is not None, f"{e3!r}"
    observed.append(("dir.pdf", r3.status_code))
    assert r3.status_code < 500, f"dir.pdf: 5xx {r3.status_code} {r3.text[:200]}"
    assert list(outside_dir.iterdir()) == [], "写入经目录符号链接逃逸到外部目录"
    assert dir_link.is_symlink(), "目录符号链接被删除/替换"
    print(f"\n[ke-verify] 符号链接同名碰撞实测状态码: {observed}（400=失败关闭，201=去重）")


def test_s3_preexisting_directory_name_collision(client):
    """目标名已被**目录**占用 → 确定性去重，不得 500、不得删目录。"""
    ws = _ws(client)
    files_dir = ws / _ATT / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    occupied = files_dir / "folder.pdf"
    occupied.mkdir()

    r, exc = _upload(client, "folder.pdf", b"KE-DIR-COLLISION")
    assert r is not None, f"客户端侧异常: {exc!r}"
    assert r.status_code < 500, f"目录同名碰撞导致 5xx: {r.status_code} {r.text[:200]}"
    assert r.status_code == 201, r.text[:200]
    assert occupied.is_dir(), "既有同名目录被破坏"
    created = ws / r.json()["path"]
    assert created != occupied
    assert created.is_file() and not created.is_symlink()
    assert created.name.startswith("folder"), created.name


# ===========================================================================
# S-3 竞态：barrier 同步的并发同名上传压力
# ===========================================================================
def test_s3_concurrent_stress_barrier(client):
    """8 线程 barrier 同步 + 3 轮同名上传：不覆盖、不丢内容、无半成品。"""
    import threading

    ws = _ws(client)
    files_dir = ws / _ATT / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    sentinel = b"SENTINEL-MUST-NOT-BE-OVERWRITTEN"
    r0, _ = _upload(client, "stress.pdf", sentinel)
    assert r0 is not None and r0.status_code == 201
    sentinel_path = ws / r0.json()["path"]
    sentinel_sha = _sha256_file(sentinel_path)

    n, rounds = 8, 3
    bodies: dict[tuple[int, int], bytes] = {}
    for rd in range(rounds):
        barrier = threading.Barrier(n)

        def _one(i: int, rd: int = rd):
            barrier.wait(timeout=30)
            body = f"STRESS-ROUND{rd}-BODY{i}".encode()
            bodies[(rd, i)] = body
            return _upload(client, "stress.pdf", body)

        with ThreadPoolExecutor(max_workers=n) as ex:
            results = list(ex.map(_one, range(n)))
        for i, (resp, exc) in enumerate(results):
            assert resp is not None, f"round{rd} #{i} 客户端异常: {exc!r}"
            assert resp.status_code == 201, f"round{rd} #{i}: {resp.status_code} {resp.text[:200]}"

    assert _sha256_file(sentinel_path) == sentinel_sha, "并发上传覆盖了既有同名文件"
    stored = sorted(p for p in files_dir.glob("stress*"))
    assert len(stored) == n * rounds + 1, f"文件数不符（丢内容或重复）: {len(stored)}"
    hashes = {_sha256_file(p) for p in stored}
    for key, body in bodies.items():
        assert _sha256_bytes(body) in hashes, f"并发上传内容丢失: {key}"
    for p in stored:
        assert p.is_file() and p.stat().st_size > 0, f"半成品残留: {p}"


# ===========================================================================
# S-3 交叉校验：独立扫描器（绝对路径 + marker），与主断言不同实现
# ===========================================================================
def test_s3_independent_marker_scan_outside_workspace(client, canary):
    """marker 命名 payload：在 ws 各祖先目录 + /tmp 浅层递归中搜索 marker。

    与主断言（相对路径前缀换算）不同实现，防止单一断言系统性偏差。
    """
    ws = canary["ws"]
    marker = uuid.uuid4().hex[:10]
    payloads = [
        f"../../evil-{marker}.pdf",
        f"../../../../../../evil-{marker}.pdf",
        f"/tmp/evil-{marker}.pdf",
        f"~/.ke-verify-{marker}.pdf",
        f"Attachments/../../../evil-{marker}.pdf",
    ]
    for tpl in payloads:
        r, exc = _upload(client, tpl, b"KE-MARKER")
        assert r is not None, f"客户端侧异常 {tpl!r}: {exc!r}"
        assert r.status_code < 500, f"{tpl!r} -> {r.status_code}"

    hits: list[Path] = []
    for ancestor in [ws, *ws.parents]:
        try:
            hits.extend(p for p in ancestor.glob(f"*{marker}*"))
        except OSError:
            continue
    # workspace 内递归扫描（合法落点在工作区内，用于校验扫描器本身有效）
    try:
        hits.extend(p for p in ws.rglob(f"*{marker}*"))
    except OSError:
        pass
    # /tmp 浅层递归（深度 ≤ 2），覆盖深层遍历落点
    tmp = Path("/tmp")
    stack: list[tuple[Path, int]] = [(tmp, 0)]
    seen = 0
    while stack and seen < 20000:
        d, depth = stack.pop()
        try:
            for e in os.scandir(d):
                seen += 1
                p = Path(e.path)
                if marker in e.name:
                    hits.append(p)
                if depth < 2 and e.is_dir(follow_symlinks=False):
                    stack.append((p, depth + 1))
        except OSError:
            continue

    allowed = (ws / _ATT).resolve()
    escaped = []
    for h in hits:
        try:
            if not h.resolve().is_relative_to(allowed):
                escaped.append(h)
        except (OSError, RuntimeError):
            escaped.append(h)
    assert not escaped, f"marker 落点越界: {escaped}"
    assert hits, "扫描器未命中工作区内合法落点（扫描本身可能失效）"
    assert all(_ATT in str(h) for h in hits if str(h).startswith(str(ws))), (
        f"扫描器在 workspace 内命中非 Attachments 路径: {hits}"
    )


# ===========================================================================
# S-1 协议层：恢复点登记 / 清除 / 再登记序列（后端可观测部分）
# ===========================================================================
class TestS1RecoveryProtocol:
    """/api/drafts/recovery 的时序契约——S-1 在编辑防抖里使用的就是这条链路。"""

    def test_s1_debounce_registration_is_visible_within_window(self, client):
        """仅编辑（未保存）：登记后立即可见，且草稿内容 == 编辑器内容。"""
        doc = _mk_doc(client, "S1 恢复点", "# v1 已保存")
        edited = "# v2 未保存的编辑内容\n\n" + "段落。" * 50

        t0 = time.perf_counter()
        r = client.post("/api/drafts/recovery", json={"doc_path": doc, "content": edited})
        dt_ms = (time.perf_counter() - t0) * 1000
        assert r.status_code == 201, r.text[:200]
        assert dt_ms < 3000, f"登记耗时 {dt_ms:.1f}ms 超过 3s 窗口"

        items = client.get("/api/drafts/recovery").json()["items"]
        recs = [i for i in items if i["doc_path"] == doc]
        assert len(recs) == 1, f"期望恰好 1 条恢复记录，实际 {len(recs)}: {items}"
        draft_rel = recs[0]["draft_path"]
        assert draft_rel.startswith("Drafts/recovery/"), draft_rel
        draft = _ws(client) / draft_rel
        assert draft.is_file(), f"草稿文件不存在: {draft}"
        assert draft.read_text(encoding="utf-8") == edited
        print(f"\n[ke-verify] 恢复点登记往返 {dt_ms:.1f} ms (content={len(edited)} chars)")

    def test_s1_clear_after_save_removes_point_and_file(self, client):
        """保存成功 → discardRecovery：列表无记录、草稿文件被删。"""
        doc = _mk_doc(client, "S1 清除", "# v1")
        client.post("/api/drafts/recovery", json={"doc_path": doc, "content": "# 未保存 v2"})
        items = client.get("/api/drafts/recovery").json()["items"]
        rec = [i for i in items if i["doc_path"] == doc][0]
        draft = _ws(client) / rec["draft_path"]
        assert draft.is_file()

        d = client.delete("/api/drafts/recovery/" + quote(doc, safe=""))
        assert d.status_code == 204, d.text[:200]

        items2 = client.get("/api/drafts/recovery").json()["items"]
        assert [i for i in items2 if i["doc_path"] == doc] == [], "保存成功后恢复点未清除"
        assert not draft.exists(), "草稿文件未删除"

    def test_s1_register_clear_reregister_sequence_no_residue(self, client):
        """「保存中登记 → 成功清除 → 继续编辑再登记」：无残留、无错清。"""
        doc = _mk_doc(client, "S1 序列", "# v1")

        # 1) 编辑防抖登记（保存尚未开始）
        client.post("/api/drafts/recovery", json={"doc_path": doc, "content": "# 编辑中 A"})
        recs = [i for i in client.get("/api/drafts/recovery").json()["items"] if i["doc_path"] == doc]
        assert len(recs) == 1

        # 2) 保存：PUT 文档 + 保存成功后的 discardRecovery（前端 buildSaveFn 的顺序）
        put = client.put(f"/api/articles/{quote(doc, safe='/')}", json={"content": "# v2 已保存"})
        assert put.status_code == 200, put.text[:200]
        assert client.delete("/api/drafts/recovery/" + quote(doc, safe="")).status_code == 204
        assert [i for i in client.get("/api/drafts/recovery").json()["items"] if i["doc_path"] == doc] == []

        # 3) 继续编辑再登记：应恰好 1 条，且内容为最新
        client.post("/api/drafts/recovery", json={"doc_path": doc, "content": "# 编辑中 B"})
        recs = [i for i in client.get("/api/drafts/recovery").json()["items"] if i["doc_path"] == doc]
        assert len(recs) == 1, f"再登记后记录数异常: {recs}"
        draft = _ws(client) / recs[0]["draft_path"]
        assert draft.read_text(encoding="utf-8") == "# 编辑中 B", "再登记内容不是最新编辑"

        drafts = sorted(
            p.name for p in (_ws(client) / "Drafts" / "recovery").glob("*.draft.md")
        )
        assert len(drafts) == 1, f"恢复草稿文件残留: {drafts}"
        # 磁盘上的文档未被草稿污染
        assert (_ws(client) / doc).read_text(encoding="utf-8").startswith("# v2 已保存")

    def test_s1_large_document_registration_latency(self, client):
        """191KB 级文档：登记往返耗时测量（防抖窗口预算证据）。"""
        doc = _mk_doc(client, "S1 大文档", "# v1")
        big = "# 大文档\n\n" + ("段落内容" * 4 + "。\n\n") * 4000
        assert len(big.encode("utf-8")) >= 191 * 1024, len(big.encode("utf-8"))

        t0 = time.perf_counter()
        r = client.post("/api/drafts/recovery", json={"doc_path": doc, "content": big})
        dt_ms = (time.perf_counter() - t0) * 1000
        assert r.status_code == 201, r.text[:200]
        assert dt_ms < 3000, f"191KB 登记耗时 {dt_ms:.1f}ms 超出 3s 预算"
        print(
            f"\n[ke-verify] 191KB+ 恢复点登记往返 {dt_ms:.1f} ms "
            f"(bytes={len(big.encode('utf-8'))})"
        )
