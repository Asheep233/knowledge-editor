"""工作区管理（Phase 4.1）与最近文档（Phase 4.8）。

- 创建 / 打开 / 关闭 / 当前状态；
- 最近打开的 Workspace 与最近文档统一存于软件配置文件（app_config.json），
  不写入任何 Markdown；
- 切换 Workspace 时重建 SQLite 索引（索引可删除后重建，Markdown 为唯一事实源；
  索引文件损坏时自动丢弃重建，不阻塞工作区打开）。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import config
from ..services import workspace as ws_service
from ..services.history_store import HistoryStore
from ..services.indexer import WorkspaceIndexer
from ..store.db import IndexStore

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class PathBody(BaseModel):
    path: str = Field(..., min_length=1)


class RecentDocBody(BaseModel):
    rel_path: str = Field(..., min_length=1)
    title: str = ""


def _app_config(request: Request):
    return request.app.state.app_config


def _open_index(root: Path) -> tuple[IndexStore, WorkspaceIndexer, dict]:
    """打开索引并（按需）重建；索引损坏（sqlite malformed / not a database 等，
    均属 sqlite3.DatabaseError）时丢弃损坏文件重建——索引是派生数据，
    Markdown 为唯一事实源，损坏不应阻塞工作区打开。返回 (store, indexer, stats)。

    P3-3：正常路径先用 reconcile()（磁盘扫描签名一致则跳过全量重建），
    只有签名变化才重建，避免每次启动/切库全量重灌。
    """
    db_path = root / config.DIR_INTERNAL / "index.db"
    store: IndexStore | None = None
    try:
        store = IndexStore(db_path).connect()
        indexer = WorkspaceIndexer(store, root)
        stats = indexer.reconcile() or {}
        return store, indexer, stats
    except sqlite3.DatabaseError:
        # 先关连接（Windows 文件锁），再删除主库 + WAL/SHM，最后干净重建
        if store is not None:
            try:
                store.close()
            except Exception:
                pass
        for suffix in ("", "-wal", "-shm"):
            try:
                db_path.with_name(db_path.name + suffix).unlink(missing_ok=True)
            except OSError:
                pass
        store = IndexStore(db_path).connect()
        indexer = WorkspaceIndexer(store, root)
        stats = indexer.rebuild()
        return store, indexer, stats


def activate_workspace(app, root: Path) -> dict:
    """切换当前工作区：重建结构 + 重开索引 + 全量重建。返回状态。"""
    root = ws_service.ensure_workspace_structure(root)
    store, indexer, stats = _open_index(root)
    old = getattr(app.state, "store", None)
    if old is not None and old is not store:
        old.close()
    app.state.workspace_root = root
    app.state.store = store
    app.state.indexer = indexer
    app.state.index_stats = stats
    # Phase 6.3：历史版本快照存储（随工作区切换，基于工作区根）
    app.state.history = HistoryStore(root)
    watcher = getattr(app.state, "watcher", None)
    if watcher is not None:
        watcher.set_root(root)
        # P2-13：外部变化 → 增量同步索引（watcher 线程内调用，IndexStore 已加锁）
        watcher.set_handler(indexer.update_file)
    return {"root": str(root), "stats": stats}


def close_workspace(app) -> None:
    """关闭当前工作区（保留最近记录，不自动打开其它工作区）。"""
    old = getattr(app.state, "store", None)
    if old is not None:
        old.close()
    app.state.store = None
    app.state.indexer = None
    app.state.workspace_root = None
    app.state.index_stats = {}
    app.state.history = None
    watcher = getattr(app.state, "watcher", None)
    if watcher is not None:
        watcher.set_root(None)


@router.post("/init")
def workspace_init(request: Request) -> dict:
    """兼容旧接口：仅确保默认工作区结构存在，不切换当前工作区。"""
    root = getattr(request.app.state, "workspace_root", None) or config.WORKSPACE_ROOT
    root = ws_service.ensure_workspace_structure(root)
    return {"root": str(root), "initialized": True}


@router.get("/info")
def workspace_info(request: Request) -> dict:
    root = request.app.state.workspace_root
    if root is None:
        raise HTTPException(status_code=409, detail="未打开工作区")
    return ws_service.collect_structure_info(root)


@router.get("/current")
def workspace_current(request: Request) -> dict:
    root = request.app.state.workspace_root
    if root is None:
        return {"open": False}
    return {"open": True, "root": str(root), "stats": request.app.state.index_stats}


@router.post("/create", status_code=201)
def workspace_create(request: Request, body: PathBody) -> dict:
    target = Path(body.path).expanduser().resolve()
    if target.exists() and not target.is_dir():
        # P3-9：传入文件路径 → 400 而不是 500（any(iterdir) 在文件上抛异常）
        raise HTTPException(status_code=400, detail="目标不是目录")
    if target.exists() and any(target.iterdir()):
        raise HTTPException(status_code=409, detail="目标目录非空，请使用「打开」")
    state = activate_workspace(request.app, target)
    _app_config(request).add_recent_workspace(target)
    return {"open": True, **state}


@router.post("/open")
def workspace_open(request: Request, body: PathBody) -> dict:
    target = Path(body.path).expanduser().resolve()
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="工作区目录不存在")
    state = activate_workspace(request.app, target)
    _app_config(request).add_recent_workspace(target)
    return {"open": True, **state}


@router.post("/close")
def workspace_close(request: Request) -> dict:
    root = request.app.state.workspace_root
    if root is not None:
        close_workspace(request.app)
    return {"open": False}


# ---------- recent workspaces ----------

@router.get("/recent")
def recent_workspaces(request: Request) -> dict:
    items = _app_config(request).list_recent_workspaces()
    # 逐条标记路径是否仍然存在（失效条目由前端置灰提示，不自动删除）
    return {
        "workspaces": [{"path": p, "exists": Path(p).is_dir()} for p in items]
    }


@router.delete("/recent")
def remove_recent_workspace(request: Request, path: str) -> dict:
    _app_config(request).remove_recent_workspace(path)
    return {"removed": path}


# ---------- recent documents (Phase 4.8) ----------

@router.get("/recent-documents")
def recent_documents(request: Request) -> dict:
    items = _app_config(request).list_recent_documents()
    return {"documents": items}


@router.post("/recent-documents", status_code=201)
def add_recent_document(request: Request, body: RecentDocBody) -> dict:
    _app_config(request).add_recent_document(body.rel_path, body.title)
    return {"status": "ok", "rel_path": body.rel_path}


@router.delete("/recent-documents", status_code=204)
def clear_recent_documents(request: Request) -> None:
    _app_config(request).clear_recent_documents()
