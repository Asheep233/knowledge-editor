"""软件级配置文件（跨 Workspace 的应用状态）。

存储内容（Phase 4.8 / 4.1）：
- recent_workspaces: 最近打开的 Workspace（根路径列表，最多 10 条）
- recent_documents:  最近打开的文档（rel_path + title，最多 20 条）

位置：config.APP_CONFIG_PATH（默认 ~/.knowledgeeditor/app_config.json，
测试环境经 KE_APP_CONFIG 重定向）。与 Workspace 内部 .knowledgeeditor/
完全不同：这里存的是「软件自己」的状态，不写入任何 Markdown。

Phase 7 M4：桌面版侧车注入 KE_APP_CONFIG 指向 %APPDATA%\\KnowledgeEditor\\
app_config.json；首次启动若发现旧 Web 版位置（~/.knowledgeeditor/
app_config.json）存在，自动并入新位置（只复制，不动源文件），保留最近
工作区/文档列表。
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .. import config

MAX_RECENT_WORKSPACES = 10
MAX_RECENT_DOCUMENTS = 20


def _defaults() -> dict:
    return {"recent_workspaces": [], "recent_documents": []}


class AppConfig:
    """单文件配置读写：原子保存，损坏时回退默认值（不阻塞启动）。"""

    def __init__(self, path: Path | None = None):
        self.path = Path(path or config.APP_CONFIG_PATH)
        self.data: dict[str, Any] = _defaults()
        self._migrate_legacy()
        self._load()

    def _migrate_legacy(self) -> None:
        """桌面版（KE_APP_CONFIG 生效）首次启动：旧 Web 版 app_config.json 并入新位置。

        触发条件：新位置与旧位置不同（Web 版二者相同，不迁移）、新位置文件不存在、
        旧位置文件存在。复制失败不阻塞（回退默认配置）。
        """
        legacy = config.APP_CONFIG_LEGACY_PATH
        if self.path == legacy or self.path.is_file():
            return
        try:
            if legacy.is_file():
                self.path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(legacy, self.path)
        except OSError:
            self.data = _defaults()

    def _load(self) -> None:
        try:
            if self.path.is_file():
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self.data = raw
        except (OSError, ValueError):
            self.data = _defaults()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp.replace(self.path)

    # ---------- recent workspaces ----------

    def list_recent_workspaces(self) -> list[str]:
        items = self.data.get("recent_workspaces", [])
        return [str(i) for i in items if isinstance(i, str)][:MAX_RECENT_WORKSPACES]

    def add_recent_workspace(self, root: str | Path) -> None:
        path = str(Path(root).resolve())
        items = [i for i in self.list_recent_workspaces() if i != path]
        items.insert(0, path)
        self.data["recent_workspaces"] = items[:MAX_RECENT_WORKSPACES]
        self.save()

    def remove_recent_workspace(self, root: str | Path) -> None:
        path = str(Path(root).resolve())
        self.data["recent_workspaces"] = [
            i for i in self.list_recent_workspaces() if i != path
        ]
        self.save()

    # ---------- recent documents ----------

    def list_recent_documents(self) -> list[dict]:
        items = self.data.get("recent_documents", [])
        out = []
        for it in items:
            if isinstance(it, dict) and isinstance(it.get("rel_path"), str):
                out.append(
                    {
                        "rel_path": it["rel_path"],
                        "title": it.get("title") or it["rel_path"],
                        "opened_at": it.get("opened_at", ""),
                    }
                )
        return out[:MAX_RECENT_DOCUMENTS]

    def add_recent_document(self, rel_path: str, title: str = "") -> None:
        from datetime import datetime, timezone

        items = [
            i
            for i in self.list_recent_documents()
            if i["rel_path"] != rel_path
        ]
        items.insert(
            0,
            {
                "rel_path": rel_path,
                "title": title or rel_path,
                "opened_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
        )
        self.data["recent_documents"] = items[:MAX_RECENT_DOCUMENTS]
        self.save()

    def clear_recent_documents(self) -> None:
        self.data["recent_documents"] = []
        self.save()
