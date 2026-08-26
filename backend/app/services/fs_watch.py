"""文件监听：轮询式 workspace 变更检测（Phase 4.3）。

设计：
- 快照 = {rel_path: (mtime_ns, size)}，覆盖 Articles / Modules / Attachments；
- 每次 sniff() 对比磁盘，产出 created / modified / deleted 事件（带递增 seq）；
- 自身写入抑制：保存 / 导入等内部操作在写入完成后调用 mark_internal(rel)，
  记录写入后的 (mtime_ns, size)。sniff 发现变化且与标记一致 → 判定为自身写入，
  不产生事件，从而与「外部修改」严格区分；
- 后台线程按 interval 轮询（测试可暂停线程手动 sniff，保证确定性）。

事件队列有上限，超限时丢弃最旧事件（本地工具场景可接受）。
"""
from __future__ import annotations

import threading
from collections import deque
from pathlib import Path

from .. import config
from . import markdown_io

_INDEXED_DIRS = (
    config.DIR_ARTICLES,
    config.DIR_MODULES,
    config.DIR_ATTACHMENTS,
)
_SKIP = {".gitkeep"}


class FsWatcher:
    def __init__(self, root: Path | None, interval: float = 1.0, max_events: int = 500):
        self.interval = interval
        self.max_events = max_events
        self.snapshot: dict[str, tuple[int, int]] = {}
        self.events: deque = deque(maxlen=max_events)
        self._seq = 0
        self.internal_marks: dict[str, tuple[int, int]] = {}
        self.enabled = True
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.set_root(root)

    # ---------- 生命周期 ----------

    def set_root(self, root: Path | None) -> None:
        """切换工作区根（或传 None 暂停监听），重置快照与事件。"""
        self.root = Path(root).resolve() if root is not None else None
        self.snapshot = {}
        self.events.clear()
        self.internal_marks.clear()
        if self.root is not None:
            self.snapshot = self._take_snapshot(self.root)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="ke-fs-watch", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            if self.enabled and self.root is not None:
                try:
                    self.sniff()
                except OSError:
                    pass  # 目录被外部删除等瞬态错误：下一轮重试

    # ---------- 快照与事件 ----------

    def _take_snapshot(self, root: Path) -> dict[str, tuple[int, int]]:
        snap: dict[str, tuple[int, int]] = {}
        for rel in _INDEXED_DIRS:
            base = root / rel
            if not base.exists():
                continue
            # P1-17：跳过符号链接，避免把 workspace 外内容纳入监听快照
            for p in markdown_io.iter_tree_safe(base):
                if not p.is_file() or p.name in _SKIP:
                    continue
                try:
                    st = p.stat()
                except OSError:
                    continue
                snap[p.relative_to(root).as_posix()] = (st.st_mtime_ns, st.st_size)
        return snap

    def _push(self, event_type: str, rel: str) -> None:
        self._seq += 1
        self.events.append(
            {
                "seq": self._seq,
                "type": event_type,
                "rel": rel,
                "mtime_ms": 0,
            }
        )

    def mark_internal(self, rel: str) -> None:
        """登记一次自身写入：记录文件写入后的 (mtime_ns, size)。

        必须在写入完成后、下一次 sniff 前调用。
        """
        if self.root is None:
            return
        full = markdown_io.safe_rel_path(self.root, rel)
        if full is None or not full.is_file():
            return
        st = full.stat()
        self.internal_marks[rel] = (st.st_mtime_ns, st.st_size)

    def sniff(self) -> list[dict]:
        """执行一次对比，返回本轮新产生的事件（并追加进事件队列）。"""
        if self.root is None:
            return []
        fresh = []
        current = self._take_snapshot(self.root)
        old = self.snapshot
        for rel in sorted(set(old) | set(current)):
            if rel in current and rel not in old:
                # 自身创建（上传/导入等已 mark_internal）应抑制，避免误报外部修改
                mark = self.internal_marks.pop(rel, None)
                if mark == current[rel]:
                    continue
                self._push("created", rel)
                fresh.append(self.events[-1])
            elif rel in old and rel not in current:
                self._push("deleted", rel)
                fresh.append(self.events[-1])
            elif old[rel] != current[rel]:
                # 变化：自身写入标记匹配则抑制
                mark = self.internal_marks.pop(rel, None)
                if mark == current[rel]:
                    continue
                self._push("modified", rel)
                fresh.append(self.events[-1])
        self.snapshot = current
        return fresh

    # ---------- 事件读取 ----------

    def events_since(self, seq: int) -> list[dict]:
        """返回 seq 之后的事件；seq=0 表示从当前队列头开始。"""
        out = [e for e in self.events if e["seq"] > seq]
        return out

    def last_seq(self) -> int:
        return self._seq
