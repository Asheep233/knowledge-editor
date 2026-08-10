"""Markdown 文件读写：原子写入 + frontmatter 解析 + slug 命名 + 元信息编辑。"""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
import unicodedata
from pathlib import Path
from typing import Optional

# 宽松的 YAML frontmatter 解析（仅处理顶层 key: value / key: [..] / key 块列表）
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
_TOP_KEY_RE = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$")

_BAD_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')

# 附件引用提取（与前端 extractAttachmentRefs 语义一致）
_RE_KE_REF = re.compile(r"<!--\s*ke-(?:attach|video):\s*(\{[\s\S]*?\})\s*-->")
_RE_MD_IMAGE = re.compile(r"!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+\"[^\"]*\")?\s*\)")

# CJK 字符范围（字数统计）
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z0-9_]+")


def slugify(name: str, fallback: str = "untitled") -> str:
    """把标题转成安全的文件名 slug。

    保留 CJK 字符；ASCII 字母转小写；连续空白/非法字符折叠为单个 '-'。
    """
    s = unicodedata.normalize("NFKC", name).strip().lower()
    s = _BAD_CHARS.sub("-", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or fallback


def _coerce_value(raw: str):
    """标量值类型化：内联列表 [a, b] -> list；整数 -> int；其余去引号字符串。"""
    raw = raw.strip()
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1]
        return [p.strip().strip("'\"") for p in inner.split(",") if p.strip()]
    try:
        return int(raw)
    except ValueError:
        return raw.strip("'\"")


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """解析 frontmatter，返回 (meta, body)。

    - meta 键保持文件中的插入顺序；
    - 支持标量、内联列表 `tags: [a, b]`、块列表 `tags:\\n  - a`；
    - 无 frontmatter 时返回 ({}, content)。
    """
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return {}, content
    lines = m.group(1).splitlines()
    meta: dict = {}
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        km = _TOP_KEY_RE.match(line)
        if not km:
            i += 1
            continue
        key, raw = km.group(1), km.group(2).strip()
        if not raw and i + 1 < len(lines) and lines[i + 1].lstrip().startswith("- "):
            # 块列表：连续 `- item` 行
            items: list[str] = []
            i += 1
            while i < len(lines):
                ls = lines[i].lstrip()
                if ls.startswith("- "):
                    items.append(ls[2:].strip().strip("'\""))
                    i += 1
                elif not lines[i].strip():
                    break
                else:
                    break
            meta[key] = items
            continue
        meta[key] = _coerce_value(raw)
        i += 1
    return meta, content[m.end():]


def render_frontmatter(meta: dict) -> str:
    """把 meta 渲染为 YAML frontmatter 块（含尾部空行）。空 dict 返回空串。"""
    if not meta:
        return ""
    lines = ["---"]
    for key, value in meta.items():
        if isinstance(value, (list, tuple)):
            lines.append(f"{key}:")
            for v in value:
                lines.append(f"  - {v}")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def set_meta(content: str, updates: dict) -> str:
    """更新（或新增）frontmatter 元信息，返回重写后的完整 Markdown。

    仅重写 frontmatter 块，正文逐字节保持不变（Markdown 唯一事实源）。
    updates 中值为 None 的键会被忽略（不删除）。
    """
    meta, body = parse_frontmatter(content)
    for key, value in updates.items():
        if value is None:
            continue
        meta[key] = value
    return render_frontmatter(meta) + body


def parse_tags(meta: dict) -> list[str]:
    """从 frontmatter meta 提取标签列表（容忍非列表/脏数据）。"""
    raw = meta.get("tags")
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    if isinstance(raw, str) and raw.strip():
        return [raw.strip()]
    return []


def word_count(text: str) -> int:
    """中英混合字数：CJK 字符逐个计数 + 拉丁词/数字串计数。"""
    return len(_CJK_RE.findall(text)) + len(_LATIN_RE.findall(text))


def attachment_refs_in(content: str) -> set[str]:
    """提取正文中的 workspace 附件引用（规范化后相对路径集合）。

    覆盖 ke-attach / ke-video src 与标准 Markdown 图片路径；
    网络 URL 与绝对路径不属于 workspace 附件，直接忽略。
    """
    refs: set[str] = set()
    for m in _RE_KE_REF.finditer(content):
        try:
            import json

            src = (json.loads(m.group(1)) or {}).get("src")
        except ValueError:
            continue
        if isinstance(src, str):
            ref = src.strip()
            if ref.startswith("./"):
                ref = ref[2:]
            if ref.startswith("Attachments/") and ".." not in Path(ref).parts:
                refs.add(ref)
    for m in _RE_MD_IMAGE.finditer(content):
        ref = m.group(1).strip()
        if ref.startswith("./"):
            ref = ref[2:]
        if ref.startswith("Attachments/") and ".." not in Path(ref).parts:
            refs.add(ref)
    return refs


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def atomic_write(path: Path, content: str) -> None:
    """原子写入：临时文件 + os.replace，避免写一半损坏文档。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=".tmp-", suffix=".md", text=True
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_text(path: Path) -> str:
    return Path(path).read_text(encoding="utf-8")


def safe_rel_path(root: Path, rel: str) -> Optional[Path]:
    """校验相对路径不越界（防目录穿越），返回解析后的绝对路径。"""
    root = Path(root).resolve()
    candidate = (root / rel).resolve()
    if candidate == root or root in candidate.parents:
        return candidate
    return None
