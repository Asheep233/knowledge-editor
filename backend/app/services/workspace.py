"""workspace 结构初始化与信息查询。

决策点 5 确认的附件组织方式（按类型，非年月）：
    workspace/
    ├── Articles/
    ├── Modules/
    ├── Attachments/
    │   ├── images/
    │   ├── videos/
    │   └── files/
    ├── Drafts/
    │   ├── backup/
    │   └── recovery/
    └── .knowledgeeditor/   (index.db, settings.json)
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .. import config
from . import markdown_io

STRUCTURE = {
    config.DIR_ARTICLES: "文章（唯一事实源 .md）",
    config.DIR_MODULES: "可复用模块（.md + 独立文件）",
    config.DIR_ATTACH_IMAGES: "图片附件",
    config.DIR_ATTACH_VIDEOS: "视频附件（v1 仅本地引用）",
    config.DIR_ATTACH_FILES: "其他附件",
    config.DIR_DRAFT_BACKUP: "自动备份快照（按日期）",
    config.DIR_DRAFT_RECOVERY: "崩溃恢复草稿",
    config.DIR_INTERNAL: "内部数据（索引/设置，可整体删除重建）",
}
#: 受管理的顶层目录（含 Trash）：必须是工作区内的真实目录，符号链接/junction
#: 或解析到工作区外一律拒绝激活（BE-01）。
_MANAGED_TOPS: tuple[str, ...] = tuple(
    dict.fromkeys([rel.split("/", 1)[0] for rel in STRUCTURE] + [config.DIR_TRASH])
)
#: 激活时必须校验为非链接的关键文件（会被读取/写入/删除）
_MANAGED_FILES: tuple[str, ...] = (
    f"{config.DIR_INTERNAL}/settings.json",
    f"{config.DIR_INTERNAL}/index.db",
)


class UnsafeWorkspaceError(ValueError):
    """工作区布局不安全（托管目录是链接/越界、索引路径异常）→ 拒绝激活。

    由路由层映射为可读 409；lifespan 捕获后保持「未打开」而不是启动崩溃。
    """


def validate_workspace_layout(root: Path) -> None:
    """激活前校验工作区布局：托管目录不得是链接、不得解析到工作区外。

    BE-01 真因：`ensure_workspace_structure` 先 mkdir 再写 settings/索引；若
    `.knowledgeeditor` 是指向工作区外的 junction，`mkdir(exist_ok=True)` 直接
    成功，随后 settings.json/index.db 全部写到区外并覆盖既有文件；Articles 顶层
    junction 则让扫描读到区外文档、创建文章写到区外。因此校验必须发生在**任何
    mkdir / 写盘 / 索引打开之前**。
    """
    root = Path(root)
    if not root.exists():
        return
    root_resolved = root.resolve()
    problems: list[str] = []
    for top in _MANAGED_TOPS:
        p = root / top
        if not os.path.lexists(p):
            continue
        if markdown_io.is_reparse_point(p):
            problems.append(f"{top}/ 是符号链接/junction")
            continue
        try:
            resolved = p.resolve()
        except (OSError, RuntimeError, ValueError):
            problems.append(f"{top}/ 无法解析")
            continue
        if root_resolved not in resolved.parents:
            problems.append(f"{top}/ 指向工作区外")
    for rel in _MANAGED_FILES:
        p = root / rel
        if os.path.lexists(p) and markdown_io.is_reparse_point(p):
            problems.append(f"{rel} 是符号链接")
    if problems:
        raise UnsafeWorkspaceError(
            "工作区包含不安全的链接/越界目录，已拒绝激活：" + "；".join(problems)
        )


def ensure_workspace_structure(root: Path) -> Path:
    """创建缺失目录与默认 settings.json，返回 workspace 根。

    BE-01：链接/越界布局校验必须先于任何 mkdir 与写盘。
    """
    root = Path(root).resolve()
    validate_workspace_layout(root)
    root.mkdir(parents=True, exist_ok=True)
    for rel in STRUCTURE:
        (root / rel).mkdir(parents=True, exist_ok=True)

    settings_path = root / config.DIR_INTERNAL / "settings.json"
    if not settings_path.exists():
        defaults = {
            "schema_version": 1,
            "attachment_org": "by-type",
            "attachment_dirs": {
                "images": config.DIR_ATTACH_IMAGES,
                "videos": config.DIR_ATTACH_VIDEOS,
                "files": config.DIR_ATTACH_FILES,
            },
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        settings_path.write_text(
            json.dumps(defaults, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return root


def collect_structure_info(root: Path) -> dict:
    """统计各目录内容数量，用于 workspace/info 响应（P1-17：跳过符号链接）。"""
    root = Path(root).resolve()
    result: dict = {"root": str(root)}
    for rel, desc in STRUCTURE.items():
        p = root / rel
        result[rel] = {
            "description": desc,
            "exists": p.exists(),
            "file_count": (
                sum(1 for f in markdown_io.walk_files(p) if f.name != ".gitkeep")
                if p.exists()
                else 0
            ),
        }
    return result
