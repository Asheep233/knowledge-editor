# -*- coding: utf-8 -*-
"""P1-T09 原型：WorkspaceContext / 租约 / 幂等与 CAS 写入一致性（独立 FastAPI 原型）。

不修改产品后端；用于验证 T09 的语义，之后再移植进 `backend/app/`：
- 每个工作区上下文 = {id, epoch, root, docs(revision/hash), index, history}；
- 切换工作区时 epoch+1：旧 epoch 的写入/结果一律拒绝（旧 UI 迟到请求不得串库）；
- 上下文租约：close 前必须排空租约（在途请求），否则 409；
- 写入：幂等 requestId + expectedRevision CAS + 磁盘指纹（外部改盘冲突）+ 原子写；
- requestId 结果查询：accepted → in_flight/completed，abort/超时后可查真实结果；
- 后台任务（索引重建）绑定发起时上下文，即使随后切库也只改原 context。
"""
from __future__ import annotations

import hashlib
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="UIWS T09 workspace-context prototype")


def sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


@dataclass
class Context:
    id: str
    root: Path
    epoch: int = 0
    docs: dict[str, dict[str, Any]] = field(default_factory=dict)   # rel -> {revision, hash}
    index: list[str] = field(default_factory=list)
    history: list[str] = field(default_factory=list)
    leases: int = 0
    closed: bool = False

    def file(self, rel: str) -> Path:
        return self.root / rel


class Manager:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.contexts: dict[str, Context] = {}
        self.current: Optional[str] = None
        self.results: dict[str, dict[str, Any]] = {}
        self.leases: dict[str, dict[str, Any]] = {}

    # ---------- open / switch / close ----------
    def open(self, ctx_id: str, root: str) -> Context:
        with self.lock:
            if ctx_id in self.contexts and not self.contexts[ctx_id].closed:
                raise HTTPException(409, f"上下文已存在: {ctx_id}")
            ctx = Context(id=ctx_id, root=Path(root))
            ctx.root.mkdir(parents=True, exist_ok=True)
            ctx.epoch += 1
            self.contexts[ctx_id] = ctx
            self.current = ctx_id
            return ctx

    def switch(self, ctx_id: str) -> Context:
        with self.lock:
            ctx = self.contexts.get(ctx_id)
            if ctx is None or ctx.closed:
                raise HTTPException(404, f"上下文不存在: {ctx_id}")
            ctx.epoch += 1  # 旧 epoch 客户端全部失效
            self.current = ctx_id
            return ctx

    def close(self, ctx_id: str) -> None:
        with self.lock:
            ctx = self.contexts.get(ctx_id)
            if ctx is None:
                raise HTTPException(404, f"上下文不存在: {ctx_id}")
            if ctx.leases > 0:
                raise HTTPException(409, f"仍有 {ctx.leases} 个在途租约，拒绝关闭")
            ctx.closed = True
            for key in [k for k, v in self.leases.items() if v["context_id"] == ctx_id]:
                del self.leases[key]
            if self.current == ctx_id:
                self.current = None

    # ---------- lease ----------
    def acquire_lease(self, ctx_id: str, epoch: int) -> str:
        with self.lock:
            ctx = self.contexts.get(ctx_id)
            if ctx is None or ctx.closed:
                raise HTTPException(404, f"上下文不存在: {ctx_id}")
            if ctx.epoch != epoch:
                raise HTTPException(409, f"上下文 epoch 已过期: 期望 {ctx.epoch}, 收到 {epoch}")
            lease_id = uuid.uuid4().hex
            ctx.leases += 1
            self.leases[lease_id] = {"context_id": ctx_id, "epoch": epoch}
            return lease_id

    def release_lease(self, lease_id: str) -> None:
        with self.lock:
            info = self.leases.pop(lease_id, None)
            if info:
                ctx = self.contexts.get(info["context_id"])
                if ctx:
                    ctx.leases = max(0, ctx.leases - 1)

    def _bound_ctx(self, ctx_id: str, epoch: int) -> Context:
        ctx = self.contexts.get(ctx_id)
        if ctx is None or ctx.closed:
            raise HTTPException(404, f"上下文不存在: {ctx_id}")
        if ctx.epoch != epoch:
            raise HTTPException(409, f"上下文 epoch 已过期: 期望 {ctx.epoch}, 收到 {epoch}")
        return ctx

    def snapshot(self, ctx_id: str, epoch: int, rel: str) -> dict[str, Any]:
        """可信快照：binding 校验 + revision + 磁盘指纹（不修改状态）。"""
        with self.lock:
            ctx = self._bound_ctx(ctx_id, epoch)
            rel = self._safe_rel(rel)
            rec = ctx.docs.get(rel) or {"revision": 0, "hash": None}
            p = ctx.file(rel)
            disk = sha_bytes(p.read_bytes()) if p.exists() else sha_bytes(b"")
            if rec.get("hash") is None:
                rec = {"revision": int(rec.get("revision") or 0), "hash": disk}
                ctx.docs[rel] = rec
            return {"rel_path": rel, "revision": rec["revision"], "disk_hash": disk}

    def write(
        self,
        ctx_id: str,
        epoch: int,
        rel: str,
        content: bytes,
        expected_revision: int,
        request_id: Optional[str] = None,
        delay_ms: int = 0,
    ) -> dict[str, Any]:
        request_id = request_id or uuid.uuid4().hex
        with self.lock:
            # 幂等：已完成的结果直接返回（重复请求不得重复写）
            if request_id in self.results and self.results[request_id]["status"] in ("completed", "conflict", "stale"):
                return self.results[request_id]
            ctx = self._bound_ctx(ctx_id, epoch)
            rel = self._safe_rel(rel)
            rec = ctx.docs.get(rel) or {"revision": 0, "hash": sha_bytes(b"")}
            p = ctx.file(rel)
            disk = sha_bytes(p.read_bytes()) if p.exists() else sha_bytes(b"")
            # 外部改盘检查（磁盘必须仍等于快照时登记的 hash）
            if rec.get("hash") is not None and disk != rec["hash"]:
                result = {"request_id": request_id, "status": "conflict", "kind": "external", "detail": "磁盘已被外部修改"}
                self.results[request_id] = result
                return result
            # revision CAS
            if int(expected_revision) != int(rec["revision"]):
                result = {"request_id": request_id, "status": "conflict", "kind": "revision",
                          "current_revision": int(rec["revision"]), "detail": "expectedRevision 已过期"}
                self.results[request_id] = result
                return result
            self.results[request_id] = {"request_id": request_id, "status": "in_flight", "rel_path": rel,
                                        "accepted": True, "context_id": ctx_id}
            new_hash = sha_bytes(content)
        # 模拟慢写入（accepted 后的处理窗口；期间可 query_result）
        if delay_ms:
            time.sleep(delay_ms / 1000.0)
        with self.lock:
            ctx = self._bound_ctx(ctx_id, epoch)  # 写入前再次校验（切库屏障）
            rec = ctx.docs.get(rel) or {"revision": 0, "hash": sha_bytes(b"")}
            p = ctx.file(rel)
            # 原子写：tmp + os.replace
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_name(f".{p.name}.tmp-{uuid.uuid4().hex[:8]}")
            tmp.write_bytes(content)
            os.replace(tmp, p)
            ctx.docs[rel] = {"revision": int(rec["revision"]) + 1, "hash": new_hash}
            ctx.history.append(f"{rel}@{ctx.docs[rel]['revision']}")
            result = {"request_id": request_id, "status": "completed", "context_id": ctx_id,
                      "rel_path": rel, "revision": ctx.docs[rel]["revision"], "accepted": True, "file_durable": True}
            self.results[request_id] = result
            return result

    def rebuild_index(self, ctx_id: str, epoch: int) -> None:
        """后台任务：绑定发起时上下文；切库后仍只改原 context（不串库）。"""
        with self.lock:
            ctx = self._bound_ctx(ctx_id, epoch)

        def work() -> None:
            time.sleep(0.05)
            with self.lock:
                target = self.contexts.get(ctx_id)
                if target is not None:
                    target.index = sorted(target.docs.keys())
                    target.history.append(f"index-rebuilt@{target.epoch}")

        threading.Thread(target=work, daemon=True).start()

    @staticmethod
    def _safe_rel(rel: str) -> str:
        parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
        if not parts or any(p == ".." for p in parts):
            raise HTTPException(400, f"非法相对路径: {rel!r}")
        return "/".join(parts)


mgr = Manager()


# ---------- 请求模型 ----------
class OpenReq(BaseModel):
    id: str = Field(..., min_length=1)
    root: str = Field(..., min_length=1)


class CtxReq(BaseModel):
    id: str


class LeaseReq(BaseModel):
    id: str
    epoch: int


class SnapshotReq(BaseModel):
    context_id: str
    epoch: int
    rel_path: str


class WriteReq(BaseModel):
    context_id: str
    epoch: int
    rel_path: str
    content: str
    expected_revision: int
    request_id: Optional[str] = None
    delay_ms: int = 0


class IndexReq(BaseModel):
    context_id: str
    epoch: int


# ---------- 路由 ----------
@app.post("/api/context/open")
def context_open(req: OpenReq) -> dict[str, Any]:
    ctx = mgr.open(req.id, req.root)
    return {"id": ctx.id, "epoch": ctx.epoch, "root": str(ctx.root)}


@app.post("/api/context/switch")
def context_switch(req: CtxReq) -> dict[str, Any]:
    ctx = mgr.switch(req.id)
    return {"id": ctx.id, "epoch": ctx.epoch, "current": mgr.current}


@app.get("/api/context/current")
def context_current() -> dict[str, Any]:
    return {"current": mgr.current}


@app.post("/api/context/close")
def context_close(req: CtxReq) -> dict[str, str]:
    mgr.close(req.id)
    return {"closed": req.id}


@app.post("/api/context/lease")
def context_lease(req: LeaseReq) -> dict[str, str]:
    lease_id = mgr.acquire_lease(req.id, req.epoch)
    return {"lease_id": lease_id}


@app.post("/api/context/release")
def context_release(req: dict[str, str]) -> dict[str, str]:
    mgr.release_lease(req.get("lease_id", ""))
    return {"released": req.get("lease_id", "")}


@app.post("/api/doc/read")
def doc_read(req: SnapshotReq) -> dict[str, Any]:
    return mgr.snapshot(req.context_id, req.epoch, req.rel_path)


@app.post("/api/doc/write")
def doc_write(req: WriteReq) -> dict[str, Any]:
    return mgr.write(req.context_id, req.epoch, req.rel_path, req.content.encode("utf-8"),
                     req.expected_revision, req.request_id, req.delay_ms)


@app.get("/api/request/{request_id}")
def request_result(request_id: str) -> dict[str, Any]:
    result = mgr.results.get(request_id)
    if result is None:
        raise HTTPException(404, "请求不存在")
    return result


@app.post("/api/index/rebuild")
def index_rebuild(req: IndexReq) -> dict[str, str]:
    mgr.rebuild_index(req.context_id, req.epoch)
    return {"accepted": "true"}
