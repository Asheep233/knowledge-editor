"""健康检查：桌面壳（Tauri）启动 sidecar 后的端口握手依据。

Phase 5E：作为 start.ps1 的启动握手端点，返回服务状态 / 项目版本 / 启动时间，
供启动流程等待 backend 就绪、并供前端做版本一致性检查。
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from .. import __version__, config

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def health(request: Request) -> dict:
    return {
        "status": "ok",
        "app": config.APP_NAME,
        "version": __version__,
        "started_at": getattr(request.app.state, "started_at", None)
        or datetime.now(timezone.utc).isoformat(),
        "workspace": str(config.WORKSPACE_ROOT),
        "python_ready": True,
    }
