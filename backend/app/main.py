"""KnowledgeEditor backend 入口。

启动流程：
1. 加载软件级配置（app_config.json：最近工作区/最近文档）
2. 确保 workspace 目录结构存在（含按类型分类的 Attachments/）
3. 打开 SQLite 集中索引 + 全量重建（Markdown 为唯一事实源，索引可重建）
4. 启动文件监听线程（Phase 4.3：外部修改检测，自身写入自动抑制）
5. K3-I2 方案 A 自愈：每次工作区激活（启动 / 打开 / 切换）后——恢复草稿按
   唯一 stem 重挂 + 历史快照孤儿只统计（幂等；失败不阻断启动/打开）

由 Tauri 桌面壳以 sidecar 方式拉起，本机 HTTP 通信（决策点 1）。
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
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
    trash,
    workspace,
)
from .routers.workspace import activate_workspace as _activate_workspace_impl
from .services import self_heal
from .services.app_config import AppConfig
from .services.fs_watch import FsWatcher

logger = logging.getLogger(__name__)

# K3-I2 方案 A：自愈入口在工作区激活之后执行。`workspace.py` 不在本任务写入
# 边界内，故在 main 侧包装其入口并替换模块属性——运行期
# /api/workspace/open|create 与测试直接调用 activate_workspace 都会触发自愈；
# lifespan 启动路径在下方显式调用入口，并加**调用点纵深防御**（失败不阻断启动）。
self_heal.install_workspace_hook(workspace)


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
        _activate_workspace_impl(app, config.WORKSPACE_ROOT)
    except OSError:
        # 默认工作区不可用时保持「未打开」状态，由前端引导创建/打开
        pass

    # K3-I2 方案 A：启动自愈（恢复草稿重挂 + 历史快照孤儿只统计）。
    # 调用点纵深防御：即使入口整体被替换成抛异常函数（或将来重构出 try 之外
    # 的异常），也绝不阻断启动。
    try:
        self_heal.run_startup_self_heal(
            getattr(app.state, "workspace_root", None),
            getattr(app.state, "store", None),
        )
    except Exception:  # noqa: BLE001 自愈失败不影响启动
        logger.exception("启动自愈失败（不影响启动）")

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

# P2-16：Host 白名单——仅接受本机来源（127.0.0.1 / localhost / 测试用 testserver），
# 阻断来自局域网/浏览器的 DNS rebinding 类请求。
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", "::1", "testserver"],
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

    P2-16：设置 KE_API_TOKEN 环境变量时，/api/*（除健康检查）必须带
    X-KE-Token 头（sidecar 生成随机 token 注入前端，防本机其它进程调用）。
    """
    path = request.url.path
    token = config.API_TOKEN
    if (
        token
        and path.startswith("/api/")
        and not path.startswith("/api/health")
        and request.headers.get("x-ke-token") != token
    ):
        return JSONResponse(status_code=401, content={"detail": "未授权"})
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
app.include_router(trash.router)


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level="info",
    )
