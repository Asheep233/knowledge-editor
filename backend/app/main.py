"""KnowledgeEditor backend 入口。

启动流程：
1. 加载软件级配置（app_config.json：最近工作区/最近文档）
2. 确保 workspace 目录结构存在（含按类型分类的 Attachments/）
3. 打开 SQLite 集中索引 + 全量重建（Markdown 为唯一事实源，索引可重建）
4. 启动文件监听线程（Phase 4.3：外部修改检测，自身写入自动抑制）

由 Tauri 桌面壳以 sidecar 方式拉起，本机 HTTP 通信（决策点 1）。
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, config
from .routers import (
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
from .routers.workspace import activate_workspace
from .services.app_config import AppConfig
from .services.fs_watch import FsWatcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0) 软件级配置（与 workspace 无关）
    app_config = AppConfig()
    # 服务启动时间（Phase 5E：health 握手 / 前端版本检查依据）
    app.state.started_at = datetime.now(timezone.utc).isoformat()

    # 1) workspace 结构初始化 + 索引 + 监听（初始工作区可经 KE_WORKSPACE 指定）
    watcher = FsWatcher(root=None)
    watcher.start()
    app.state.app_config = app_config
    app.state.watcher = watcher
    app.state.workspace_root = None
    app.state.store = None
    app.state.indexer = None
    app.state.index_stats = {}
    app.state.history = None

    try:
        activate_workspace(app, config.WORKSPACE_ROOT)
    except OSError:
        # 默认工作区不可用时保持「未打开」状态，由前端引导创建/打开
        pass

    yield

    watcher.stop()
    store = getattr(app.state, "store", None)
    if store is not None:
        store.close()


app = FastAPI(
    title="KnowledgeEditor Backend",
    description="本地优先个人知识创作软件的后端服务（sidecar）",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_workspace(request, call_next):
    """未打开工作区时，除健康检查与工作区管理外一律 409。

    关闭工作区后文件树/搜索/编辑等接口不再可用，前端回到工作区选择页。
    """
    path = request.url.path
    if (
        getattr(app.state, "workspace_root", None) is None
        and path.startswith("/api/")
        and not path.startswith("/api/health")
        and not path.startswith("/api/workspace")
    ):
        return JSONResponse(status_code=409, content={"detail": "未打开工作区"})
    return await call_next(request)


app.include_router(health.router)
app.include_router(workspace.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(modules.router)
app.include_router(attachments.router)
app.include_router(import_export.router)
app.include_router(drafts.router)
app.include_router(history.router)
app.include_router(index.router)
app.include_router(fs.router)
app.include_router(tags.router)


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level="info",
    )
