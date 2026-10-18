# -*- coding: utf-8 -*-
"""UI 工坊 T09（P1）纵向切片：WorkspaceContext / 租约 / 幂等 CAS 写入 API。

设计见 `backend/app/services/context_registry.py`。本路由是**增量接口**（不改既有端点行为）：
- `/api/context/*` 之前不存在，属于工坊新能力；
- 现有全局工作区 API（`/api/workspace/*`、`/api/articles/*` 等）保持原样，后续 T12 分域迁移时
  再统一到 Core；本切片只验证「上下文/epoch/租约/幂等/CAS/结果查询」语义。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.context_registry import ContextError, ContextRegistry

router = APIRouter(prefix="/api/context", tags=["context"])

# 模块级注册表（原型切片；后续 T12 迁入 app.state/Core 生命周期）
registry = ContextRegistry()


def _reset_for_tests() -> None:
    """测试钩子：重置注册表（不暴露为 HTTP API）。"""
    global registry
    registry = ContextRegistry()


class ContextOpenReq(BaseModel):
    id: str = Field(..., min_length=1)
    root: str = Field(..., min_length=1)


class ContextIdReq(BaseModel):
    id: str = Field(..., min_length=1)


class ContextLeaseReq(BaseModel):
    id: str = Field(..., min_length=1)
    epoch: int


class ContextReleaseReq(BaseModel):
    lease_id: str = Field(..., min_length=1)


class ContextSnapshotReq(BaseModel):
    context_id: str = Field(..., min_length=1)
    epoch: int
    rel_path: str = Field(..., min_length=1)


class ContextTreeReq(BaseModel):
    context_id: str = Field(..., min_length=1)
    epoch: int


class ContextSearchReq(BaseModel):
    context_id: str = Field(..., min_length=1)
    epoch: int
    query: str = Field(..., min_length=1)
    limit: int = Field(50, ge=1, le=200)


class ContextWriteReq(BaseModel):
    context_id: str = Field(..., min_length=1)
    epoch: int
    rel_path: str = Field(..., min_length=1)
    content: str
    expected_revision: int
    request_id: str | None = None


def _http(exc: ContextError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/open")
def context_open(req: ContextOpenReq) -> dict:
    try:
        ctx = registry.open(req.id, req.root)
    except ContextError as exc:
        raise _http(exc) from exc
    return {"id": ctx.id, "epoch": ctx.epoch, "root": str(ctx.root), "current": registry.current()}


@router.post("/switch")
def context_switch(req: ContextIdReq) -> dict:
    try:
        ctx = registry.switch(req.id)
    except ContextError as exc:
        raise _http(exc) from exc
    return {"id": ctx.id, "epoch": ctx.epoch, "current": registry.current()}


@router.get("/current")
def context_current() -> dict:
    return {"current": registry.current()}


@router.post("/close")
def context_close(req: ContextIdReq) -> dict:
    try:
        registry.close(req.id)
    except ContextError as exc:
        raise _http(exc) from exc
    return {"closed": req.id}


@router.post("/lease")
def context_lease(req: ContextLeaseReq) -> dict:
    try:
        lease_id = registry.acquire_lease(req.id, req.epoch)
    except ContextError as exc:
        raise _http(exc) from exc
    return {"lease_id": lease_id}


@router.post("/release")
def context_release(req: ContextReleaseReq) -> dict:
    registry.release_lease(req.lease_id)
    return {"released": req.lease_id}


@router.post("/snapshot")
def context_snapshot(req: ContextSnapshotReq) -> dict:
    try:
        return registry.snapshot(req.context_id, req.epoch, req.rel_path)
    except ContextError as exc:
        raise _http(exc) from exc


@router.post("/tree")
def context_tree(req: ContextTreeReq) -> dict:
    try:
        return registry.tree(req.context_id, req.epoch)
    except ContextError as exc:
        raise _http(exc) from exc


@router.post("/search")
def context_search(req: ContextSearchReq) -> dict:
    try:
        return registry.search(req.context_id, req.epoch, req.query, req.limit)
    except ContextError as exc:
        raise _http(exc) from exc


@router.post("/write")
def context_write(req: ContextWriteReq) -> dict:
    try:
        return registry.write(
            req.context_id, req.epoch, req.rel_path, req.content, req.expected_revision, req.request_id
        )
    except ContextError as exc:
        raise _http(exc) from exc


@router.get("/request/{request_id}")
def context_request_result(request_id: str) -> dict:
    result = registry.query_result(request_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"请求不存在: {request_id}")
    return result
