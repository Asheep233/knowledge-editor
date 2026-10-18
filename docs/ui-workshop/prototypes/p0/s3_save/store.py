# -*- coding: utf-8 -*-
"""P0-S3 原型：DocumentSession → 可信快照 → 恢复/保存 链 + WorkspaceContext/CAS。

对应任务包 T04 / ARCHITECTURE.md「保存语义 / 上下文一致性」。本原型**不接真实 UI/后端**，
用最小状态机验证语义，供 T09/T10 移植到 FastAPI/Core：

关键语义（验收项）：
1. 保存前必须取得带 revision 的**可信快照**（全文 + 磁盘指纹）；dirty 标记不足以保存。
2. 服务端按 `(context_id, epoch)` 校验租约；切库/旧 UI 的迟到写入被拒（StaleContext）。
3. 写入采用 revision CAS + 磁盘指纹检查：旧 revision / 外部改盘 → conflict，绝不覆盖。
4. 结果区分 `accepted`（请求受理）/ `recovery_durable`（恢复日志已持久）/ `file_durable`
   （正文已提交）；只有 file_durable 才算「已保存」。
5. requestId 幂等 + `query_result`：客户端 abort/超时后能查真实结果，不能假设「未执行」。
6. 崩溃注入（`S3_CRASH_AT`）覆盖：恢复日志后、正文写入后、状态提交后；重启 `recover()` 会把
   未完成保存收敛为「已提交」或「恢复草稿可用」，不覆盖外部新内容。
7. 两工作区同相对路径：各自独立 state/内容，互不串库。

运行测试：python3 -m pytest docs/ui-workshop/prototypes/p0/s3_save/test_s3.py -q
演示：python3 docs/ui-workshop/prototypes/p0/s3_save/run_demo.py
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

STATE_SCHEMA = 1
UA_DIR = ".uicore"


class S3Error(Exception):
    """业务性错误（非崩溃）。"""


class StaleContext(S3Error):
    def __init__(self, message: str = "上下文已失效（旧 UI/旧 epoch）"):
        super().__init__(message)


class ConflictRevision(S3Error):
    def __init__(self, expected: int, current: int):
        self.expected, self.current = expected, current
        super().__init__(f"revision 冲突: expected={expected} current={current}")


class ConflictExternal(S3Error):
    def __init__(self, message: str = "磁盘内容已被外部修改"):
        super().__init__(message)


class NotFound(S3Error):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _crash_point(name: str) -> None:
    if os.environ.get("S3_CRASH_AT") == name:
        os._exit(98)


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex[:8]}")
    with tmp.open("wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _atomic_write_json(path: Path, obj: Any) -> None:
    _atomic_write(path, json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8"))


def _safe_rel(rel: str) -> str:
    parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise S3Error(f"非法相对路径: {rel!r}")
    return "/".join(parts)


@dataclass
class Snapshot:
    """可信快照：全文 + 目标 revision + 取得时的磁盘指纹。"""

    rel_path: str
    content: bytes
    revision: int
    disk_hash: str

    @property
    def content_hash(self) -> str:
        return _sha(self.content)


@dataclass
class SaveResult:
    request_id: str
    context_id: str
    rel_path: str
    status: str  # completed | conflict_revision | conflict_external | stale_context | failed
    revision: Optional[int] = None
    accepted: bool = False
    recovery_durable: bool = False
    file_durable: bool = False
    detail: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "context_id": self.context_id,
            "rel_path": self.rel_path,
            "status": self.status,
            "revision": self.revision,
            "accepted": self.accepted,
            "recovery_durable": self.recovery_durable,
            "file_durable": self.file_durable,
            "detail": self.detail,
        }


@dataclass
class WorkspaceContext:
    """一个工作区的服务端上下文（id/epoch/root/state/leases）。"""

    context_id: str
    root: Path
    epoch: int = 0
    files: dict[str, dict[str, Any]] = field(default_factory=dict)
    results: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def ua(self) -> Path:
        return self.root / UA_DIR

    def state_path(self) -> Path:
        return self.ua / "state.json"

    def file_path(self, rel: str) -> Path:
        return self.root / _safe_rel(rel)

    def recovery_dir(self) -> Path:
        return self.ua / "recovery"

    def load(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.ua.mkdir(exist_ok=True)
        self.recovery_dir().mkdir(exist_ok=True)
        if self.state_path().exists():
            try:
                data = json.loads(self.state_path().read_text(encoding="utf-8"))
            except Exception:
                data = {}
            self.epoch = int(data.get("epoch") or 0)
            self.files = dict(data.get("files") or {})
            self.results = dict(data.get("results") or {})

    def persist(self) -> None:
        _atomic_write_json(
            self.state_path(),
            {"schemaVersion": STATE_SCHEMA, "epoch": self.epoch, "files": self.files, "results": self.results},
        )

    def open_epoch(self) -> int:
        """每次（重新）打开上下文 epoch+1；旧租约自动失效。"""
        self.epoch += 1
        self.persist()
        return self.epoch

    def lease(self) -> dict[str, Any]:
        return {"context_id": self.context_id, "epoch": self.epoch}


class StoreManager:
    """多工作区管理：打开/切换/关闭，持有 context 与 epoch。"""

    def __init__(self, base: Path | str):
        self.base = Path(base)
        self.contexts: dict[str, WorkspaceContext] = {}
        self.active: Optional[str] = None

    def open_workspace(self, workspace_id: str, root: Path | str) -> WorkspaceContext:
        ctx = WorkspaceContext(workspace_id, Path(root))
        ctx.load()
        ctx.open_epoch()
        self.contexts[workspace_id] = ctx
        self.active = workspace_id
        return ctx

    def switch_workspace(self, workspace_id: str) -> WorkspaceContext:
        """切库：目标上下文重新 open（epoch+1），旧上下文仍可被读取但租约失效。"""
        if workspace_id in self.contexts and self.contexts[workspace_id].root.exists():
            ctx = self.contexts[workspace_id]
        else:
            raise NotFound(f"工作区不存在: {workspace_id}")
        ctx.load()
        ctx.open_epoch()
        self.active = workspace_id
        return ctx

    def close_workspace(self, workspace_id: str) -> None:
        self.contexts.pop(workspace_id, None)
        if self.active == workspace_id:
            self.active = None

    # ---------- 读取快照 ----------
    def snapshot(self, context_id: str, rel_path: str) -> Snapshot:
        ctx = self._ctx(context_id)
        p = ctx.file_path(rel_path)
        content = p.read_bytes() if p.exists() else b""
        disk_hash = _sha(content)
        rec = ctx.files.get(_safe_rel(rel_path)) or {}
        return Snapshot(
            rel_path=_safe_rel(rel_path),
            content=content,
            revision=int(rec.get("revision") or 0),
            disk_hash=disk_hash,
        )

    # ---------- 保存 ----------
    def save(
        self,
        lease: dict[str, Any],
        snapshot: Snapshot,
        content: bytes,
        request_id: Optional[str] = None,
    ) -> SaveResult:
        request_id = request_id or uuid.uuid4().hex
        ctx = self._ctx(str(lease.get("context_id") or ""))
        rel = _safe_rel(snapshot.rel_path)
        # 1) 租约/epoch 校验（旧 UI 迟到写入）
        if int(lease.get("epoch") or -1) != ctx.epoch:
            res = SaveResult(request_id, ctx.context_id, rel, "stale_context", detail="租约 epoch 与当前不符")
            ctx.results[request_id] = res.as_dict()
            ctx.persist()
            return res
        # 2) 幂等：重复 requestId 直接返回历史结果
        if request_id in ctx.results:
            return SaveResult(**{k: ctx.results[request_id][k] for k in SaveResult.__dataclass_fields__ if k in ctx.results[request_id]})
        # 3) revision CAS + 磁盘指纹（外部改盘）
        rec = ctx.files.get(rel) or {}
        current_rev = int(rec.get("revision") or 0)
        p = ctx.file_path(rel)
        disk_hash = _sha(p.read_bytes()) if p.exists() else _sha(b"")
        if current_rev != snapshot.revision:
            res = SaveResult(request_id, ctx.context_id, rel, "conflict_revision", revision=current_rev,
                             detail=f"目标 revision {snapshot.revision} 已过期（当前 {current_rev}）")
            ctx.results[request_id] = res.as_dict()
            ctx.persist()
            return res
        if disk_hash != snapshot.disk_hash:
            res = SaveResult(request_id, ctx.context_id, rel, "conflict_external", revision=current_rev,
                             detail="磁盘内容与快照指纹不一致（外部修改）")
            ctx.results[request_id] = res.as_dict()
            ctx.persist()
            return res
        # 4) accepted：恢复日志持久化（崩溃后可恢复/判定）
        res = SaveResult(request_id, ctx.context_id, rel, "accepted", revision=current_rev + 1, accepted=True)
        new_hash = _sha(content)
        recovery_path = ctx.recovery_dir() / f"{_sha(rel.encode())[:16]}-r{current_rev + 1}.json"
        _atomic_write_json(
            recovery_path,
            {
                "rel_path": rel,
                "base_hash": snapshot.disk_hash,
                "new_hash": new_hash,
                "revision": current_rev + 1,
                "content": content.decode("utf-8", "surrogateescape"),
                "created_at": time.time(),
            },
        )
        res.recovery_durable = True
        _crash_point("save:after_recovery_log")
        # 5) 正文写入（原子 replace）
        _atomic_write(p, content)
        _crash_point("save:after_file_write")
        # 6) 提交状态 + 清理恢复日志
        ctx.files[rel] = {"revision": current_rev + 1, "hash": new_hash}
        res.file_durable = True
        res.status = "completed"
        res.detail = "正文已提交（file durable）"
        ctx.results[request_id] = res.as_dict()
        ctx.persist()
        recovery_path.unlink(missing_ok=True)
        _crash_point("save:after_commit_record")
        return res

    def query_result(self, context_id: str, request_id: str) -> Optional[dict[str, Any]]:
        ctx = self._ctx(context_id)
        return ctx.results.get(request_id)

    # ---------- 恢复 ----------
    def recover(self, context_id: str) -> list[dict[str, Any]]:
        """重启后收敛未完成保存：已提交/恢复草稿写入/冲突保留，不覆盖外部新内容。"""
        ctx = self._ctx(context_id)
        reports: list[dict[str, Any]] = []
        for rec_path in sorted(ctx.recovery_dir().glob("*.json")):
            try:
                rec = json.loads(rec_path.read_text(encoding="utf-8"))
            except Exception:
                rec_path.unlink(missing_ok=True)
                continue
            rel = _safe_rel(str(rec["rel_path"]))
            p = ctx.file_path(rel)
            disk = p.read_bytes() if p.exists() else b""
            disk_hash = _sha(disk)
            content = str(rec.get("content") or "").encode("utf-8", "surrogateescape")
            rev = int(rec.get("revision") or 0)
            if disk_hash == rec.get("new_hash"):
                # 正文其实已写入（崩在状态提交前）→ 标记为已提交
                ctx.files[rel] = {"revision": rev, "hash": disk_hash}
                status = "recovered_committed"
            elif disk_hash == rec.get("base_hash"):
                # 正文未写 → 用恢复草稿补齐（磁盘与快照一致，无外部改动）
                _atomic_write(p, content)
                ctx.files[rel] = {"revision": rev, "hash": _sha(content)}
                status = "recovered_from_log"
            else:
                status = "conflict_left_for_user"
                reports.append({"rel_path": rel, "status": status, "detail": "磁盘已被外部修改，恢复草稿保留待用户选择"})
                continue
            ctx.persist()
            rec_path.unlink(missing_ok=True)
            reports.append({"rel_path": rel, "status": status, "revision": rev})
        return reports

    def _ctx(self, context_id: str) -> WorkspaceContext:
        ctx = self.contexts.get(context_id)
        if ctx is None:
            raise NotFound(f"上下文不存在: {context_id}")
        return ctx


def _cli(argv: list[str]) -> int:
    if len(argv) < 3:
        print("usage: s3.py <base> <status|recover <ctx_id>|save-demo>")
        return 2
    mgr = StoreManager(argv[1])
    cmd = argv[2]
    if cmd == "recover":
        ctx_id = argv[3]
        mgr.contexts[ctx_id] = WorkspaceContext(ctx_id, Path(argv[1]) / ctx_id)
        mgr.contexts[ctx_id].load()
        print(json.dumps(mgr.recover(ctx_id), ensure_ascii=False))
    else:
        print("unknown cmd")
        return 2
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(_cli(sys.argv))
