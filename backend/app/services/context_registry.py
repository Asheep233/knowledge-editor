# -*- coding: utf-8 -*-
"""UI 工坊 T09（P1）纵向切片：WorkspaceContext 注册表 / 租约 / 幂等 CAS 写入。

背景：现有后端以**单一全局工作区**（app.state.workspace_root）为中心；UI 工坊需要
「多个工作区上下文」与「切库屏障」，否则旧 UI/迟到请求可能写入新库（T09 红线）。

本模块是**增量、可回退**的第一步：
- 维护 `WorkspaceContext{id, epoch, root, docs(revision/hash), leases}` 注册表；
- 上下文级服务端租约：关闭上下文前必须排空（在途请求）；
- 写入：requestId 幂等 + expectedRevision CAS + 磁盘指纹（外部改盘）→ 原子写；
- 结果查询：requestId → completed/conflict 结果（客户端 abort/超时后可查真实结果）；
- 切库 epoch+1：旧 epoch 的读写一律拒绝（旧 UI 迟到请求不串库）。

未完成（T09 后续）：真实 store/indexer/history/watcher 生命周期绑定、附件/导入/恢复/打印 job
的上下文绑定、HTTP 客户端断开后的 in-flight 结果查询（当前写入同步完成）、持久化幂等表。
"""
from __future__ import annotations

import hashlib
import os
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from ..services.markdown_io import atomic_write


class ContextError(Exception):
    """业务错误（路由层映射 4xx）。"""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class WorkspaceContext:
    id: str
    root: Path
    epoch: int = 0
    leases: int = 0
    closed: bool = False
    docs: dict[str, dict[str, Any]] = field(default_factory=dict)
    index: list[str] = field(default_factory=list)
    history: list[str] = field(default_factory=list)


class ContextRegistry:
    """进程内上下文注册表（线程安全；FastAPI 同步端点会在线程池执行）。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._contexts: dict[str, WorkspaceContext] = {}
        self._current: Optional[str] = None
        self._results: dict[str, dict[str, Any]] = {}
        self._leases: dict[str, dict[str, Any]] = {}

    # ---------- 生命周期 ----------
    def open(self, ctx_id: str, root: str) -> WorkspaceContext:
        root_path = Path(root).resolve()
        if not root_path.is_dir():
            raise ContextError(404, f"工作区目录不存在: {root_path}")
        with self._lock:
            existing = self._contexts.get(ctx_id)
            if existing is not None and not existing.closed:
                raise ContextError(409, f"上下文已存在: {ctx_id}")
            ctx = WorkspaceContext(id=ctx_id, root=root_path, epoch=1)
            self._contexts[ctx_id] = ctx
            self._current = ctx_id
            return ctx

    def switch(self, ctx_id: str) -> WorkspaceContext:
        with self._lock:
            ctx = self._require(ctx_id)
            ctx.epoch += 1  # 旧 epoch 客户端全部失效（切库屏障）
            self._current = ctx_id
            return ctx

    def close(self, ctx_id: str) -> None:
        with self._lock:
            ctx = self._require(ctx_id)
            if ctx.leases > 0:
                raise ContextError(409, f"仍有 {ctx.leases} 个在途租约，拒绝关闭")
            ctx.closed = True
            for lease_id in [k for k, v in self._leases.items() if v["context_id"] == ctx_id]:
                del self._leases[lease_id]
            if self._current == ctx_id:
                self._current = None

    def current(self) -> Optional[str]:
        return self._current

    # ---------- 租约 ----------
    def acquire_lease(self, ctx_id: str, epoch: int) -> str:
        with self._lock:
            ctx = self._require_bound(ctx_id, epoch)
            lease_id = uuid.uuid4().hex
            ctx.leases += 1
            self._leases[lease_id] = {"context_id": ctx_id, "epoch": epoch}
            return lease_id

    def release_lease(self, lease_id: str) -> None:
        with self._lock:
            info = self._leases.pop(lease_id, None)
            if info:
                ctx = self._contexts.get(info["context_id"])
                if ctx is not None:
                    ctx.leases = max(0, ctx.leases - 1)

    # ---------- 读快照 ----------
    def snapshot(self, ctx_id: str, epoch: int, rel_path: str) -> dict[str, Any]:
        with self._lock:
            ctx = self._require_bound(ctx_id, epoch)
            rel = self._safe_rel(ctx.root, rel_path)
            rec = ctx.docs.get(rel)
            p = ctx.root / rel
            disk = sha_bytes(p.read_bytes()) if p.is_file() else sha_bytes(b"")
            if rec is None:
                rec = {"revision": 0, "hash": disk}
                ctx.docs[rel] = rec
            return {"rel_path": rel, "revision": int(rec["revision"]), "disk_hash": disk, "context_id": ctx_id}

    # ---------- 写 ----------
    def write(
        self,
        ctx_id: str,
        epoch: int,
        rel_path: str,
        content: str,
        expected_revision: int,
        request_id: Optional[str] = None,
    ) -> dict[str, Any]:
        request_id = request_id or uuid.uuid4().hex
        with self._lock:
            done = self._results.get(request_id)
            if done is not None and done.get("status") in ("completed", "conflict"):
                return done
            ctx = self._require_bound(ctx_id, epoch)
            rel = self._safe_rel(ctx.root, rel_path, allowed_tops=None)
            rec = ctx.docs.get(rel)
            p = ctx.root / rel
            disk = sha_bytes(p.read_bytes()) if p.is_file() else sha_bytes(b"")
            if rec is None:
                rec = {"revision": 0, "hash": disk}
                ctx.docs[rel] = rec
            if rec.get("hash") is not None and disk != rec["hash"]:
                result = {"request_id": request_id, "status": "conflict", "kind": "external",
                          "detail": "磁盘内容已被外部修改", "context_id": ctx_id}
                self._results[request_id] = result
                return result
            if int(expected_revision) != int(rec["revision"]):
                result = {"request_id": request_id, "status": "conflict", "kind": "revision",
                          "current_revision": int(rec["revision"]), "detail": "expectedRevision 已过期",
                          "context_id": ctx_id}
                self._results[request_id] = result
                return result
            digest = sha_bytes(content.encode("utf-8"))
            atomic_write(p, content)
            ctx.docs[rel] = {"revision": int(rec["revision"]) + 1, "hash": digest}
            ctx.history.append(f"{rel}@{ctx.docs[rel]['revision']}")
            result = {
                "request_id": request_id,
                "context_id": ctx_id,
                "rel_path": rel,
                "status": "completed",
                "revision": int(ctx.docs[rel]["revision"]),
                "accepted": True,
                "recovery_durable": True,
                "file_durable": True,
            }
            self._results[request_id] = result
            return result

    def query_result(self, request_id: str) -> Optional[dict[str, Any]]:
        return self._results.get(request_id)

    # ---------- 内部 ----------
    def _require(self, ctx_id: str) -> WorkspaceContext:
        ctx = self._contexts.get(ctx_id)
        if ctx is None or ctx.closed:
            raise ContextError(404, f"上下文不存在或已关闭: {ctx_id}")
        return ctx

    def _require_bound(self, ctx_id: str, epoch: int) -> WorkspaceContext:
        ctx = self._require(ctx_id)
        if int(ctx.epoch) != int(epoch):
            raise ContextError(409, f"上下文 epoch 已过期: 期望 {ctx.epoch}, 收到 {epoch}")
        return ctx

    @staticmethod
    def _safe_rel(root: Path, rel_path: str, allowed_tops: Optional[set[str]] = None) -> str:
        raw = (rel_path or "").replace("\\", "/")
        parts = [p for p in raw.split("/") if p not in ("", ".")]
        if not parts or any(p == ".." for p in parts):
            raise ContextError(400, f"非法相对路径: {rel_path!r}")
        if parts[0].startswith(".") or os.path.isabs(raw) or (len(raw) > 1 and raw[1] == ":"):
            raise ContextError(400, f"非法相对路径: {rel_path!r}")
        if allowed_tops is not None and parts[0] not in allowed_tops:
            raise ContextError(400, f"路径不在允许目录内: {rel_path!r}")
        target = (root / "/".join(parts)).resolve()
        if root.resolve() not in target.parents and target != root:
            raise ContextError(400, f"路径越界: {rel_path!r}")
        return "/".join(parts)
