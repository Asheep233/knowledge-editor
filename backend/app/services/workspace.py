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


def ensure_workspace_structure(root: Path) -> Path:
    """创建缺失目录与默认 settings.json，返回 workspace 根。"""
    root = Path(root).resolve()
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
