"""Markdown 文件读写：原子写入 + frontmatter 解析 + slug 命名 + 元信息编辑。"""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
import unicodedata
from pathlib import Path
from typing import Optional

from .. import config

# 宽松的 YAML frontmatter 解析（仅处理顶层 key: value / key: [..] / key 块列表）
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
_TOP_KEY_RE = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$")

_BAD_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')

# Windows 保留名（CON/NUL/PRN/AUX/COM1-9/LPT1-9，含带扩展名形式）
_WIN_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}

# 附件引用提取（与前端 extractAttachmentRefs 语义一致）
_RE_KE_REF = re.compile(r"<!--\s*ke-(?:attach|video):\s*(\{[\s\S]*?\})\s*-->")
_RE_MD_IMAGE = re.compile(r"!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+\"[^\"]*\")?\s*\)")

# CJK 字符范围（字数统计）
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z0-9_]+")

# slug 最大长度（Windows 完整路径 260 字符预算下留足余量）
_SLUG_MAX = 80


def slugify(name: str, fallback: str = "untitled") -> str:
    """把标题转成安全的文件名 slug。

    保留 CJK 字符；ASCII 字母转小写；连续空白/非法字符折叠为单个 '-'；
    去除尾部点/空格（Windows 语义）；Windows 保留名加前缀 `_`；
    超长截断（P3-1：避免 Windows 路径超长导致 500）。
    """
    s = unicodedata.normalize("NFKC", name).strip().lower()
    s = s.rstrip(". ")
    s = _BAD_CHARS.sub("-", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-").strip(".")
    s = s[:_SLUG_MAX].rstrip("-.") or s[:_SLUG_MAX]
    if not s:
        return fallback
    # Windows 保留名（含带扩展名形式，如 NUL.md）：前缀下划线，使其不再是保留名
    if s.split(".", 1)[0] in _WIN_RESERVED:
        s = f"_{s}"
    return s


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
    - 无 frontmatter 时返回 ({}, content)；
    - 容忍 UTF-8 BOM（P2-1：BOM 前缀剥离后解析，正文不含 BOM）。
    """
    if content.startswith("\ufeff"):
        content = content[1:]
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

    正文逐字节保持不变（Markdown 唯一事实源）。updates 中值为 None 的
    键会被忽略（不删除）。P2-1：含嵌套对象/注释等复杂 YAML 的旧块走
    逐键字符串手术，其余键原样保留——不再整体重渲染丢弃嵌套字段。
    """
    if not updates:
        return content
    block, body = split_frontmatter_block(content)
    if block is None:
        return render_frontmatter({k: v for k, v in updates.items() if v is not None}) + body
    lines = block.splitlines()
    open_idx = 0
    closing_idx = _closing_dash_idx(lines)
    if lines and lines[0].strip() == "---":
        open_idx = 1
    out_lines = list(lines[:open_idx])  # 保留开头 ---
    consumed: set[str] = set()
    for g in _raw_top_level_lines(block):
        key = g[0].split(":", 1)[0].strip()
        if key in updates:
            consumed.add(key)
            out_lines.extend(_render_key_lines(key, updates[key]))
        else:
            out_lines.extend(g)
    for key, value in updates.items():
        if value is None or key in consumed:
            continue
        out_lines.extend(_render_key_lines(key, value))
    # 结尾 ---（原块最后一行）
    if closing_idx >= 0 and lines[closing_idx].strip() == "---":
        out_lines.append("---")
    trailing = "\n" if block.endswith("\n") else ""
    return "\n".join(out_lines) + trailing + body


def _closing_dash_idx(lines: list[str]) -> int:
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() == "---":
            return i
    return len(lines) - 1


def _render_key_lines(key: str, value) -> list[str]:
    """渲染单个 frontmatter 键的原始行（支持列表；不支持时用 JSON 表达）。"""
    if isinstance(value, bool):
        return [f"{key}: {str(value).lower()}"]
    if isinstance(value, (int, float)):
        return [f"{key}: {value}"]
    if isinstance(value, (list, tuple)):
        if not value:
            return [f"{key}: []"]
        return [f"{key}:"] + [f"  - {v}" for v in value]
    if isinstance(value, dict):
        import json as _json

        return [f"{key}: {_json.dumps(value, ensure_ascii=False)}"]
    return [f"{key}: {value}"]


def split_frontmatter_block(content: str) -> tuple[Optional[str], str]:
    """分离 frontmatter 原始块（含首尾 --- 与原始换行，逐字节）与正文。

    与 parse_frontmatter 不同：块内不做任何解析/渲染，供 P0-1 合并时
    无损保留复杂 YAML（嵌套对象/注释/CRLF/日期等）。无块时返回 (None, content)。
    BOM 前缀在返回前剥离（正文随之不含 BOM）。
    """
    if content.startswith("\ufeff"):
        content = content[1:]
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return None, content
    return content[: m.end()], content[m.end():]


def _raw_top_level_lines(block: str) -> list[list[str]]:
    """按原始行切分 frontmatter 块：每组 = 一个顶层键的原始行（含嵌套/注释行）。

    首行必须是 `key:` 形态（顶层键）；无缩进的行开新组。
    块边界 `---` 与空白行不归入任何组。
    """
    groups: list[list[str]] = []
    cur: Optional[list[str]] = None
    for line in block.splitlines():
        if line.strip() == "---":
            cur = None  # 块边界（闭合 ---）：结束当前组
            continue
        if not line.strip():
            continue
        if _TOP_KEY_RE.match(line) and not line.startswith((" ", "\t")):
            cur = [line]
            groups.append(cur)
        elif cur is not None:
            cur.append(line)
    return groups


def merge_frontmatter(old_content: str, new_content: str) -> str:
    """P0-1：正文保存的 frontmatter 无损合并（Markdown 唯一事实源语义）。

    规则（正文始终逐字节保留）：
    - 新内容无 frontmatter、旧内容有 → 旧块原样前置（修复旧前端清空字段的问题）；
    - 双方都有 → 逐行扫描旧块顶层键，其中「新块缺失」的键以原始行
      （含其嵌套子行/注释）原样插回新块的结束 --- 之前；
    - 旧内容无 frontmatter → 原样返回新内容。
    """
    if not new_content:
        return new_content
    old_block, _ = split_frontmatter_block(old_content)
    new_block, new_body = split_frontmatter_block(new_content)
    if old_block is None:
        return new_content
    if new_block is None:
        # 旧块（含尾部换行）原样前置，正文是 new_content 本身
        return old_block + new_body
    old_groups = _raw_top_level_lines(old_block)
    new_keys = {g[0].split(":", 1)[0].strip() for g in _raw_top_level_lines(new_block)}
    missing_lines: list[str] = []
    for g in old_groups:
        key = g[0].split(":", 1)[0].strip()
        if key not in new_keys:
            missing_lines.extend(g)
    if not missing_lines:
        return new_content
    lines = new_block.splitlines()
    close_idx = None
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() == "---":
            close_idx = i
            break
    if close_idx is None:
        # 理论上不可达（块以 --- 结尾），防御性兜底：直接在块后追加
        return new_block.rstrip("\r\n") + "\n" + "\n".join(missing_lines) + "\n" + new_body
    trailing = "\n" if new_block.endswith("\n") else ""
    assembled = "\n".join(lines[:close_idx] + missing_lines + lines[close_idx:]) + trailing
    return assembled + new_body


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
    """原子写入：临时文件 + flush/fsync + os.replace，避免写一半损坏文档。

    P2-11：写入后 fsync 确保落盘后再替换（断电/崩溃不产生损坏文件）。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=".tmp-", suffix=".md", text=True
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
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
    """校验相对路径不越界（防目录穿越），返回解析后的绝对路径。

    P0-3：显式拒绝 candidate == root（"."" / 空串 / "/" 等根路径等价输入），
    调用方拿到的永远是 root 的严格子路径，杜绝整库删除/根目录改名。
    """
    root = Path(root).resolve()
    candidate = (root / rel).resolve()
    if candidate == root:
        return None
    if root in candidate.parents:
        return candidate
    return None


def is_doc_rel(rel: str) -> bool:
    """业务文档相对路径白名单（P1-10）：Articles/ 或 Modules/ 下的 .md/.markdown。"""
    rel = rel.strip().replace("\\", "/")
    return (
        (
            rel.startswith(f"{config.DIR_ARTICLES}/")
            or rel.startswith(f"{config.DIR_MODULES}/")
        )
        and rel.lower().endswith((".md", ".markdown"))
        and ".." not in Path(rel).parts
    )


def is_attachment_rel(rel: str) -> bool:
    """附件相对路径白名单（P1-10）：必须位于 Attachments/ 下。"""
    rel = rel.strip().replace("\\", "/")
    return (
        rel.startswith(f"{config.DIR_ATTACHMENTS}/")
        and ".." not in Path(rel).parts
    )


def is_recovery_draft_rel(rel: str) -> bool:
    """恢复草稿相对路径白名单（P1-10/P2-14）：必须位于 Drafts/recovery/ 下。"""
    rel = rel.strip().replace("\\", "/")
    return (
        rel.startswith(f"{config.DIR_DRAFT_RECOVERY}/")
        and ".." not in Path(rel).parts
    )


def _is_junction(entry: os.DirEntry) -> bool:
    """Windows 目录 junction 判定（Python 3.12+；旧版本退化为 symlink 判定）。"""
    try:
        if entry.is_symlink():
            return True
        if hasattr(os.path, "isjunction") and entry.is_dir(follow_symlinks=False):
            return os.path.isjunction(entry.path)
    except OSError:
        return False
    return False


def walk_files(base: Path) -> list[Path]:
    """递归枚举 base 下的全部文件（不含目录），跳过符号链接与 junction。

    P1-17/P3-10：Python ≤3.12 的 pathlib.rglob 会跟随目录符号链接，
    workspace 内指向外部的 junction 会被递归删除/索引到外部内容。
    统一用本函数做文件枚举，符号链接/Junction 一律不进入。
    """
    return [p for p in walk_entries(base) if p.is_file()]


def walk_dirs(base: Path) -> list[Path]:
    """递归枚举 base 下的全部子目录（不含 base 自身），跳过符号链接与 junction。

    供递归删除时自底向上清理目录（与 walk_files 同规则，P1-17）。
    """
    return [p for p in walk_entries(base) if p.is_dir()]


def walk_entries(base: Path) -> list[Path]:
    """递归枚举 base 下的全部条目（文件+目录），跳过符号链接与 junction。

    符号链接/junction 本体不进入结果；需要「移除链接本体」时用 walk_links。
    """
    out: list[Path] = []
    stack = [Path(base)]
    while stack:
        cur = stack.pop()
        try:
            entries = list(os.scandir(cur))
        except OSError:
            continue
        for e in entries:
            if _is_junction(e):
                continue
            try:
                if e.is_dir(follow_symlinks=False):
                    out.append(Path(e.path))
                    stack.append(Path(e.path))
                elif e.is_file(follow_symlinks=False):
                    out.append(Path(e.path))
            except OSError:
                continue
    return out


def walk_links(base: Path) -> list[Path]:
    """枚举 base 下（含子目录）的符号链接/junction 本体，不跟随、不入其内部。

    P1-17 补充：递归删除目录时，链接本体会阻塞 rmdir；「移除链接本体」永远
    不会删除目标内容（unlink 只移除链接，rmdir 对 junction 只移除链接）。
    """
    out: list[Path] = []
    stack = [Path(base)]
    while stack:
        cur = stack.pop()
        try:
            entries = list(os.scandir(cur))
        except OSError:
            continue
        for e in entries:
            try:
                if _is_junction(e):
                    out.append(Path(e.path))
                    continue
                if e.is_dir(follow_symlinks=False):
                    stack.append(Path(e.path))
            except OSError:
                continue
    return out


def unlink_link(p: Path) -> None:
    """移除符号链接/junction 本体（绝不跟随目标）。

    POSIX 符号链接用 unlink；Windows junction 需以 rmdir 移除（unlink 会报错）。
    目标内容在任何分支都不被触碰。
    """
    try:
        os.unlink(p)
        return
    except OSError:
        pass
    try:
        p.rmdir()  # Windows junction：以目录方式移除链接本体
    except OSError:
        # 快照窗口内被并发删除等瞬态：若已不是链接则视为已完成
        if not (p.is_symlink() or (hasattr(os.path, "isjunction") and os.path.isjunction(p))):
            raise
