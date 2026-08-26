"""文档导入导出（Phase 3E / 3E.4）。

原则（与 Phase 3 冻结约定一致）：
- Markdown 是唯一事实源；SQLite 仅索引，不参与导入导出内容。
- 导出 Markdown 由前端 Markdown Serializer 提供（含编辑器内未保存修改），
  本模块只负责「附件收集 + zip 打包」与「zip 解包 + 附件落位 + 引用改写」。
- 不修改 Phase 3 已冻结的 ke-* 扩展规范；导入仅做路径改写，不改节点结构。

导入安全（3E.4）：
- 禁止直接向 workspace 写入导入内容：解包/读取 → 校验 → 在临时导入区
  `.knowledgeeditor/tmp/import_{token}/` 内暂存（staged）→ 原子提交。
- 提交前校验：UTF-8 可读、ke-* JSON 可解析、附件引用安全且包内存在、
  路径无穿越、冲突策略（原名/复用/唯一名）已确定。
- 提交仅做同盘 rename（os.replace），失败时回滚已提交文件，已存在文件
  永不被覆盖；SQLite 索引在全部提交完成后才统一刷新。

导出包结构（与 workspace 附件相对路径一致，md 内引用路径无需改写即可解析）：
    {slug}_export/
    ├── {slug}.md
    └── Attachments/
        ├── images/
        ├── videos/
        └── files/
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import secrets
import shutil
import zipfile
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import config
from ..services import markdown_io

router = APIRouter(tags=["import_export"])

_MD_EXTS = {".md", ".markdown"}
_ZIP_MAGIC = b"PK\x03\x04"
_TMP_REL = f"{config.DIR_INTERNAL}/tmp"  # .knowledgeeditor/tmp（workspace 内隔离区）

# 引用字面量位置正则（P3-14：_rewrite_refs 只改这些位置）
_RE_KE_COMMENT = re.compile(r"<!--\s*ke-(?:attach|video):\s*(\{[\s\S]*?\})\s*-->")
_RE_MD_IMAGE_SRC = re.compile(r"!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+\"[^\"]*\")?\s*\)")


# ---------- 导出 ----------

class ExportPackageReq(BaseModel):
    """文档包导出请求。

    md:   前端 Markdown Serializer 输出（含 ke_version frontmatter）。
    refs: 前端从 md 中提取的 workspace 附件相对路径（本模块再校验存在性与归属）。
    """

    title: str = Field(..., min_length=1, max_length=200)
    md: str
    refs: list[str] = []


def _collect_attachments(root: Path, refs: list[str]) -> list[tuple[Path, str]]:
    """校验并收集可打包的附件。

    返回 [(磁盘绝对路径, workspace 相对路径)]，仅接受：
    - 位于 workspace 内（防目录穿越）
    - 位于 Attachments/ 下（只打包附件，不打包 Articles/Modules）
    - 文件真实存在
    去重保序。
    """
    seen: set[str] = set()
    out: list[tuple[Path, str]] = []
    for ref in refs:
        full = markdown_io.safe_rel_path(root, ref)
        if full is None or not full.is_file():
            continue
        rel = full.relative_to(root).as_posix()
        if not rel.startswith(config.DIR_ATTACHMENTS + "/"):
            continue
        if rel in seen:
            continue
        seen.add(rel)
        out.append((full, rel))
    return out


@router.post("/api/export/package")
def export_package(request: Request, body: ExportPackageReq) -> Response:
    """导出文档包：{slug}_export/{slug}.md + Attachments/（保留相对路径）。"""
    root: Path = request.app.state.workspace_root
    slug = markdown_io.slugify(body.title)
    prefix = f"{slug}_export"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{prefix}/{slug}.md", body.md)
        for full, rel in _collect_attachments(root, body.refs):
            zf.write(full, f"{prefix}/{rel}")

    buf.seek(0)
    zip_name = f"{prefix}.zip"
    # RFC 5987：文件名可能含 CJK，HTTP 头仅允许 latin-1，ASCII 兜底 + filename* 扩展
    ascii_fallback = zip_name.encode("ascii", "ignore").decode() or "knowledgeeditor-export.zip"
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(zip_name)}'
        )
    }
    return Response(buf.getvalue(), media_type="application/zip", headers=headers)


# ---------- 导入安全基础设施（3E.4） ----------

def _category_of(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext in config.IMAGE_EXTS:
        return "images"
    if ext in config.VIDEO_EXTS:
        return "videos"
    return "files"


def _file_sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 256), b""):
            h.update(chunk)
    return h.hexdigest()


def _new_import_dir(root: Path) -> Path:
    """创建临时导入区：.knowledgeeditor/tmp/import_{token}/"""
    base = root / _TMP_REL
    base.mkdir(parents=True, exist_ok=True)
    for _ in range(20):
        d = base / f"import_{secrets.token_hex(8)}"
        try:
            d.mkdir(parents=True)
            return d
        except FileExistsError:
            continue
    raise HTTPException(status_code=500, detail="无法创建临时导入目录")


def _validate_ke_nodes(md: str) -> None:
    """校验 ke-* 扩展节点：每个 `<!-- ke-xxx: {json} -->` 的 JSON 必须可解析。

    已知 kind 走对应节点，未知 kind 由 GenericFallbackNode 兜底，
    因此仅要求 JSON 合法（Parser 可处理）。非法 JSON → 校验失败。
    """
    re_ke = re.compile(r"<!--\s*ke-[\w-]+:\s*(\{[\s\S]*?\})\s*-->")
    for m in re_ke.finditer(md):
        try:
            json.loads(m.group(1))
        except ValueError:
            raise HTTPException(status_code=400, detail="Markdown 含无法解析的 ke-* 节点")


def _extract_refs(md: str) -> list[str]:
    """提取 md 中 workspace 附件引用（ke-attach/ke-video src + 标准图片路径）。"""
    refs: list[str] = []
    re_ke = re.compile(r"<!--\s*ke-(?:attach|video):\s*(\{[\s\S]*?\})\s*-->")
    for m in re_ke.finditer(md):
        try:
            src = (json.loads(m.group(1)) or {}).get("src")
        except ValueError:
            continue
        if isinstance(src, str):
            refs.append(src)
    for m in re.finditer(r"!\[[^\]]*\]\(\s*([^\s)]+)", md):
        refs.append(m.group(1))
    return refs


def _validate_refs(md: str, doc_dir: Path) -> None:
    """校验附件引用安全性与存在性。

    - 引用（去 ./ 前缀后）以 Attachments/ 开头 → 视为包内附件引用：
      必须无路径穿越（.. / 绝对路径），且包内该文件真实存在；
    - 网络 URL 与本地绝对路径等其它引用 → 保持原样放行（Phase 4 附件管理范围）。
    """
    for raw in _extract_refs(md):
        ref = raw.strip()
        if ref.startswith("./"):
            ref = ref[2:]
        if not ref.startswith("Attachments/"):
            continue  # 网络/绝对路径/其它相对路径：保持原样
        if ref.startswith("/") or ".." in Path(ref).parts:
            raise HTTPException(status_code=400, detail=f"非法附件引用路径: {ref}")
        if not (doc_dir / ref).is_file():
            raise HTTPException(status_code=400, detail=f"附件引用在文档包中缺失: {ref}")


def _unique_article_path(root: Path, title: str) -> str:
    """Articles/{slug}.md 冲突时自动去重：{slug}-2.md、{slug}-3.md…"""
    slug = markdown_io.slugify(title)
    base = f"{config.DIR_ARTICLES}/{slug}.md"
    if not (root / base).exists():
        return base
    for n in range(2, 1000):
        cand = f"{config.DIR_ARTICLES}/{slug}-{n}.md"
        if not (root / cand).exists():
            return cand
    raise HTTPException(status_code=409, detail="无法生成唯一文章文件名")


def _unique_attachment_rel(root: Path, dest_rel: str) -> Optional[str]:
    """为内容不同的同名附件生成唯一相对路径；50 次仍冲突返回 None。"""
    dest = root / dest_rel
    stem, ext = dest.stem, dest.suffix
    parent_rel = dest.parent.relative_to(root).as_posix()
    for _ in range(50):
        name = f"{stem}-{secrets.token_hex(3)}{ext}"
        cand_rel = f"{parent_rel}/{name}"
        if not (root / cand_rel).exists():
            return cand_rel
    return None


# 导入上限（P2-5）：单 .md 50MB；zip 整包 512MB；解压单文件 512MB、总量 1GB
MAX_MARKDOWN_SIZE = 50 * 1024 * 1024
MAX_ZIP_SIZE = 512 * 1024 * 1024
MAX_EXTRACTED_TOTAL = 1024 * 1024 * 1024


async def _read_limited(file: UploadFile, limit: int) -> bytes:
    """分块读取并限制总量（P2-5：超限报 413，不整包入内存先行裁剪）。"""
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 256):
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=413, detail="文件超过大小上限")
        chunks.append(chunk)
    return b"".join(chunks)


def _extract_zip_safe(zf: zipfile.ZipFile, dest: Path) -> None:
    """解压到临时目录，拒绝 zip-slip（绝对路径 / .. / 符号链接）与超大文件。

    P2-5：单文件与总大小按「实际写入字节」计（info.file_size 可伪造）。
    """
    total = 0
    for info in zf.infolist():
        name = info.filename
        if name.startswith(("/", "\\")) or ".." in Path(name).parts:
            raise HTTPException(status_code=400, detail=f"压缩包包含非法路径: {name}")
        target = (dest / name).resolve()
        if not (target == dest or dest in target.parents):
            raise HTTPException(status_code=400, detail=f"压缩包路径越界: {name}")
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        with zf.open(info) as src, target.open("wb") as out:
            while chunk := src.read(1024 * 256):
                written += len(chunk)
                if written > MAX_EXTRACTED_TOTAL or total + written > MAX_EXTRACTED_TOTAL:
                    raise HTTPException(status_code=400, detail="压缩包内容超过大小上限")
                out.write(chunk)
        total += written


def _find_doc(tmp: Path) -> Optional[tuple[Path, str]]:
    """在解压树中定位 Markdown 文档。

    规则：深度优先找第一个 .md，跳过名为 Attachments 的目录
    （附件目录里可能也含 .md 文件，不能当作文档）。
    返回 (md 绝对路径, 文本)；找不到返回 None。
    """
    stack = [tmp]
    while stack:
        cur = stack.pop(0)
        for p in sorted(cur.iterdir()):
            if p.name == "Attachments" or p.name.startswith("."):
                continue
            if p.is_dir():
                stack.append(p)
            elif p.suffix.lower() in _MD_EXTS:
                try:
                    return p, markdown_io.read_text(p)
                except UnicodeDecodeError:
                    raise HTTPException(status_code=400, detail="Markdown 文档必须为 UTF-8 编码")
    return None


def _mask_code_regions(md: str) -> str:
    """把围栏代码块与行内代码的字符替换为 '\\x00'（等长掩码，位置不变）。

    用于 P3-14：引用改写只针对正文中的引用字面量，
    代码块/行内代码里出现的 `![...](Attachments/..)` 不是真实附件引用。
    """
    chars = list(md)
    spans: list[tuple[int, int]] = []
    for m in re.finditer(r"`[^`\n]+`", md):
        spans.append((m.start(), m.end()))
    for m in re.finditer(r"^(```|~~~)[^\n]*\n?[\s\S]*?\n\1[ \t]*$", md, re.M):
        spans.append((m.start(), m.end()))
    for s, e in spans:
        for i in range(s, e):
            chars[i] = "\x00"
    return "".join(chars)


def _rewrite_refs(md: str, mapping: dict[str, str]) -> str:
    """P3-14：仅改写「引用字面量位置」的路径，绝不做全局字符串替换。

    改写范围严格限定为：
    - ke-attach / ke-video 注释 JSON 的 `src` 值；
    - 标准 Markdown 图片 `![](url)` 的 url。
    URL 文本与代码块/行内代码里的同名字符串不受影响（先掩码代码区域，
    命中区间含掩码字符的候选直接跳过）。未命中映射的引用保持原样。
    """
    if not mapping:
        return md
    masked = _mask_code_regions(md)

    def _map_ref(ref: str) -> str:
        r = ref.strip()
        if r.startswith("./"):
            r = r[2:]
        return mapping.get(r, ref)

    edits: list[tuple[int, int, str]] = []  # (start, end, replacement)

    def fix_ke(m: re.Match) -> None:
        raw = md[m.start() : m.end()]
        if "\x00" in raw:
            return  # 位于代码块/行内代码内
        try:
            obj = json.loads(m.group(1))
        except ValueError:
            return
        src = obj.get("src")
        if not isinstance(src, str):
            return
        new = _map_ref(src)
        if new == src:
            return
        old_lit, new_lit = json.dumps(src), json.dumps(new)
        for variant in (f'"src": {old_lit}', f'"src":{old_lit}', f'"src" : {old_lit}'):
            replaced = raw.replace(variant, f'"src": {new_lit}', 1)
            if replaced != raw:
                edits.append((m.start(), m.end(), replaced))
                return

    def fix_img(m: re.Match) -> None:
        url = m.group(1)
        if "\x00" in m.group(0) or "\x00" in url:
            return  # 位于代码块/行内代码内
        new = _map_ref(url)
        if new == url:
            return
        s = m.start(1)
        e = m.end(1)
        edits.append((s, e, new))

    for m in _RE_KE_COMMENT.finditer(masked):
        fix_ke(m)
    for m in _RE_MD_IMAGE_SRC.finditer(masked):
        fix_img(m)

    out = md
    for s, e, repl in sorted(edits, key=lambda t: -t[0]):
        out = out[:s] + repl + out[e:]
    return out


def _commit_staged(root: Path, staged: Path) -> list[str]:
    """原子提交 staged（workspace 相对布局）到目标 workspace。

    - staged 位于 workspace 内（.knowledgeeditor/tmp/...），os.replace 同盘原子；
    - 已存在且内容一致的目标 → 跳过（复用）；
    - 目标已存在但内容不同 → 提交失败（规划阶段应已消除此情况）；
    - 任一提交失败 → 回滚：删除本次已提交的新文件并清理空目录链，
      已存在文件自始至终不被覆盖，失败后 workspace 与原状一致。
    返回本次实际写入的相对路径列表（不含复用）。
    """
    committed: list[Path] = []
    try:
        for p in sorted(staged.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(staged).as_posix()
            dest = root / rel
            if dest.exists():
                if _file_sha256(dest) == _file_sha256(p):
                    continue  # 复用已有文件
                raise FileExistsError(f"目标已存在且内容不同: {rel}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(p, dest)
            committed.append(dest)
    except Exception:
        for d in committed:
            try:
                d.unlink()
            except OSError:
                pass
            cur = d.parent
            while cur != root:
                try:
                    cur.rmdir()
                except OSError:
                    break
                cur = cur.parent
        raise
    return [c.relative_to(root).as_posix() for c in committed]


def _import_article_from_staged(root: Path, staged: Path, rel: str, indexer) -> None:
    """把 staged 内容提交到 workspace，全部成功后才统一刷新索引。"""
    committed = _commit_staged(root, staged)
    indexer.update_file(rel)  # 索引刷新必须在提交完成后
    for r in committed:
        indexer.update_file(r)


# ---------- 导入 ----------

@router.post("/api/import/markdown", status_code=201)
async def import_markdown(request: Request, file: UploadFile = File(...)) -> dict:
    """导入普通 Markdown 文件：暂存 → 校验 → 原子提交到 Articles/ 并建立索引。

    不破坏原文件（浏览器上传副本）；网络图片链接与本地绝对路径保持原样，
    不下载、不改写（Phase 4 附件管理范围）。
    """
    raw = file.filename or "untitled.md"
    if Path(raw).suffix.lower() not in _MD_EXTS:
        raise HTTPException(status_code=400, detail="仅支持 .md / .markdown 文件")
    data = await _read_limited(file, MAX_MARKDOWN_SIZE)
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="文件必须为 UTF-8 编码")

    # 校验（提交前）：frontmatter 可解析、ke-* 节点可处理
    meta, _ = markdown_io.parse_frontmatter(content)
    _validate_ke_nodes(content)
    title = (meta.get("title") or "").strip() or Path(raw).stem
    rel = _unique_article_path(root := request.app.state.workspace_root, title)

    # 暂存到临时导入区，再原子提交
    tmp_dir = _new_import_dir(root)
    try:
        staged = tmp_dir / "staged"
        art_staged = staged / rel
        art_staged.parent.mkdir(parents=True, exist_ok=True)
        markdown_io.atomic_write(art_staged, content)
        _import_article_from_staged(root, staged, rel, request.app.state.indexer)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return {
        "id": rel,
        "path": rel,
        "title": title,
        "created": True,
        "imported": {"attachments": []},
    }


@router.post("/api/import/package", status_code=201)
async def import_package(request: Request, file: UploadFile = File(...)) -> dict:
    """导入文档包 .zip：解包到临时区 → 校验 → 冲突规划 → staged 暂存 → 原子提交。"""
    raw = file.filename or "package.zip"
    if not raw.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="文档包必须是 .zip 文件")
    data = await _read_limited(file, MAX_ZIP_SIZE)
    if not data.startswith(_ZIP_MAGIC):
        raise HTTPException(status_code=400, detail="文件不是有效的 zip 压缩包")

    root: Path = request.app.state.workspace_root
    tmp_dir = _new_import_dir(root)
    try:
        pkg_dir = tmp_dir / "pkg"
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            _extract_zip_safe(zf, pkg_dir)

        # 1) 校验：定位文档 + UTF-8 可读 + ke-* 节点可处理 + 附件引用安全
        doc = _find_doc(pkg_dir)
        if doc is None:
            raise HTTPException(status_code=400, detail="压缩包内未找到 Markdown 文档")
        md_path, md_text = doc
        doc_dir = md_path.parent
        _validate_ke_nodes(md_text)
        _validate_refs(md_text, doc_dir)

        # 2) 冲突规划：为每个附件确定最终目标与动作（原名复制 / 复用 / 唯一名复制）
        attach_dir = doc_dir / "Attachments"
        plan: list[dict] = []  # {in_pkg, dest_rel, reused}
        if attach_dir.is_dir():
            for p in sorted(attach_dir.rglob("*")):
                if not p.is_file():
                    continue
                in_pkg = p.relative_to(doc_dir).as_posix()  # Attachments/images/x.png
                sub = p.relative_to(attach_dir).as_posix()  # images/sub/x.png（保留子目录）
                first = sub.split("/", 1)[0]
                if first in ("images", "videos", "files"):
                    dest_rel = f"{config.DIR_ATTACHMENTS}/{sub}"
                else:
                    dest_rel = f"{config.DIR_ATTACHMENTS}/{_category_of(p.name)}/{p.name}"
                reused = False
                dest = root / dest_rel
                if dest.exists():
                    if _file_sha256(dest) == _file_sha256(p):
                        reused = True
                    else:
                        cand = _unique_attachment_rel(root, dest_rel)
                        if cand is None:
                            raise HTTPException(status_code=409, detail=f"附件冲突处理失败: {dest_rel}")
                        dest_rel = cand
                plan.append({"in_pkg": in_pkg, "dest_rel": dest_rel, "reused": reused})

        # 3) 引用改写 + 文章落位规划
        mapping = {item["in_pkg"]: item["dest_rel"] for item in plan}
        new_md = _rewrite_refs(md_text, mapping)
        meta, _ = markdown_io.parse_frontmatter(new_md)
        title = (meta.get("title") or "").strip() or md_path.stem
        art_rel = _unique_article_path(root, title)

        # 4) staged 暂存（全在临时导入区内，未触碰 workspace 目标）
        staged = tmp_dir / "staged"
        for item in plan:
            src = doc_dir / item["in_pkg"]  # 相对文档目录，与 md 引用同基准
            tgt = staged / item["dest_rel"]
            tgt.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, tgt)  # 复制失败 → 校验失败，workspace 未受影响
        art_staged = staged / art_rel
        art_staged.parent.mkdir(parents=True, exist_ok=True)
        markdown_io.atomic_write(art_staged, new_md)

        # 5) 原子提交 → 全部成功后再统一刷新索引
        _import_article_from_staged(root, staged, art_rel, request.app.state.indexer)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    copied = [
        {"from": item["in_pkg"], "to": item["dest_rel"], "reused": item["reused"]}
        for item in plan
    ]
    return {
        "id": art_rel,
        "path": art_rel,
        "title": title,
        "created": True,
        "imported": {
            "attachments": copied,
            "rewritten_refs": len([c for c in copied if c["from"] != c["to"]]),
        },
    }
