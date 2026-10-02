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
        cleaned = self_heal.cleanup_stale_tmp_files(workspace)
        if cleaned:
            logger.info("启动自愈：清理 %d 个原子写残留临时文件（.tmp-*）", cleaned)
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
    allow_origins=list(config.CORS_ORIGINS),
    # R07（2026-10-02 独立审查）：本服务**不使用 Cookie / HTTP 认证**，
    # 因此必须关闭凭据模式（allow_credentials=True 只在有凭据可带时才有意义，
    # 却会把跨源响应暴露给带凭据请求）。
    # 注：浏览器形态（Web 版）需要独立的 CSP 头；桌面形态由 Tauri 配置提供。
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── R07：非安全方法的来源校验（副作用执行前）────────────────────────────────
# 审查实测（真实本机服务，`Origin: https://untrusted.example`）：
#   · multipart POST /api/import/markdown → 201，真的新增 Articles/untrusted.md
#   · 无正文 POST /api/workspace/close   → 200，工作区真的被关闭
# 原因：CORS 只阻止「跨源**读响应**」，不阻止「跨源**发请求**」；multipart /
# text/plain / 无正文 POST 属 CORS 简单请求，不触发预检。Host 白名单只约束访问目标。
#
# 策略（仅在带 Origin 时生效，且只约束非安全方法）：
#   · 安全方法（GET/HEAD/OPTIONS）与 /api/health 一律放行（健康检查是 sidecar 握手依赖）；
#   · 无 Origin → 放行（非浏览器客户端：桌面原生调用、curl、TestClient）。
#     浏览器对非 GET 请求**总会**带 Origin，故这不构成 CSRF 面；若连无 Origin 也拒绝，
#     会重演 P2-16 那次的半成品事故（设置该环境变量曾让整个应用不可用：
#     预检 401 + 前端不发头 + sidecar 不生成 → 前端/测试/脚本全断）。
#   · 带 Origin 且不在受信任集合 → 403，副作用不会发生。
#
# 受信任集合 = 固定本地来源（Tauri WebView + 默认 dev 端口）
#            ∪ config.CORS_ORIGINS（sidecar 按实际 dev 端口注入）
#            ∪ 请求自身同源（后端直接提供页面时的同源调用）
_TRUSTED_ORIGINS_FIXED = frozenset(
    {
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }
)
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# 健康检查永远放行：sidecar 启动握手 / 版本核对依赖它，任何来源策略都不得阻断
_R07_EXEMPT_PATHS = ("/api/health",)


def _trusted_origins(request: Request) -> set[str]:
    """受信任来源集合（固定项 + CORS 配置项 + 请求自身同源）"""
    allowed = set(_TRUSTED_ORIGINS_FIXED)
    allowed.update(config.CORS_ORIGINS)
    host = request.headers.get("host")
    if host:
        # 同源（后端自己提供页面的场景）：只由 TrustedHostMiddleware 已校验的 Host 头推导
        allowed.add(f"http://{host}")
        allowed.add(f"https://{host}")
    return allowed


@app.middleware("http")
async def verify_request_origin(request: Request, call_next):
    """R07：拒绝来源不可信的**写请求**（在进入路由、产生副作用之前）。"""
    path = request.url.path
    if request.method in _SAFE_METHODS or path.startswith(_R07_EXEMPT_PATHS):
        return await call_next(request)
    if not path.startswith("/api"):
        return await call_next(request)
    origin = request.headers.get("origin")
    if origin is None:
        # 非浏览器客户端（桌面原生 / curl / 测试）——浏览器发非 GET 一定带 Origin
        return await call_next(request)
    if origin.rstrip("/") not in _trusted_origins(request):
        logger.warning("R07 拒绝来源不可信的写请求：%s %s origin=%s", request.method, path, origin)
        return JSONResponse(status_code=403, content={"detail": "请求来源不可信，已拒绝"})
    return await call_next(request)


@app.middleware("http")
async def require_workspace(request, call_next):
    """未打开工作区时，除健康检查与工作区管理外一律 409。

    关闭工作区后文件树/搜索/编辑等接口不再可用，前端回到工作区选择页。

    M7（2026-09-20 发布前审查）：原 P2-16 的令牌鉴权已**整体移除**——它是半成品：
    中间件顺序使 OPTIONS 预检 401、前端从不发送该头、Rust sidecar 也从不生成/注入，
    任何设置该环境变量的用户会直接砖掉整个应用。当前无人使用，移除后中间件只保留
    「未打开工作区 409」职责，不再读取任何令牌配置。

    R07（2026-10-02 独立审查）：写操作来源校验由上方 `verify_request_origin`
    承担（Origin 白名单，**不引入 token**，避免重演上述事故）。
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
app.include_router(trash.router)


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level="info",
    )
