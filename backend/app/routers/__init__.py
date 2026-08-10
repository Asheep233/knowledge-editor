"""API 路由注册（Phase 6E：与 main.py 注册清单同步）。"""
from . import (
    attachments,
    documents,
    drafts,
    fs,
    health,
    history,
    import_export,
    index,
    modules,
    search,
    tags,
    workspace,
)

__all__ = [
    "attachments",
    "documents",
    "drafts",
    "fs",
    "health",
    "history",
    "import_export",
    "index",
    "modules",
    "search",
    "tags",
    "workspace",
]
