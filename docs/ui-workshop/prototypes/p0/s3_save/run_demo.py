# -*- coding: utf-8 -*-
"""P0-S3 演示：可信快照 → 保存 CAS → 外部冲突 → 切库迟到写 → 崩溃恢复。

用法：python3 docs/ui-workshop/prototypes/p0/s3_save/run_demo.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from store import StoreManager, WorkspaceContext  # noqa: E402

REL = "Articles/note.md"


def main() -> None:
    base = Path(tempfile.mkdtemp(prefix="s3-demo-"))
    r1, r2 = base / "ws1", base / "ws2"
    for r in (r1, r2):
        (r / "Articles").mkdir(parents=True)
    (r1 / REL).write_bytes(b"ws1: v1")
    (r2 / REL).write_bytes(b"ws2: other")

    mgr = StoreManager(base)
    c1 = mgr.open_workspace("ws1", r1)
    print("# S3 演示根目录:", base)
    snap = mgr.snapshot("ws1", REL)
    print("snapshot:", snap.rel_path, "rev=", snap.revision, "hash=", snap.disk_hash[:12])

    res = mgr.save(c1.lease(), snap, b"ws1: v2 (saved)", request_id="demo-1")
    print("save:", res.status, "rev=", res.revision, "file_durable=", res.file_durable)
    print("query_result: ", mgr.query_result("ws1", "demo-1"))
    print("disk:", (r1 / REL).read_bytes())

    # 旧快照重放 → revision 冲突
    res2 = mgr.save(c1.lease(), snap, b"stale overwrite")
    print("stale revision save:", res2.status, "->", res2.detail)

    # 外部改盘 → 冲突，不覆盖
    snap2 = mgr.snapshot("ws1", REL)
    (r1 / REL).write_bytes(b"external edit")
    res3 = mgr.save(c1.lease(), snap2, b"mine")
    print("external conflict:", res3.status, "disk=", (r1 / REL).read_bytes())

    # 切库后旧租约迟到写 → stale（ws1 重新打开使旧 lease epoch 失效）
    mgr.open_workspace("ws2", r2)
    old_lease = c1.lease()
    snap4 = mgr.snapshot("ws1", REL)
    mgr.switch_workspace("ws1")
    res4 = mgr.save(old_lease, snap4, b"late write from old ui")
    print("late write after switch:", res4.status)
    print("ws2 disk (不应被 ws1 影响):", (r2 / REL).read_bytes())

    print("OK: 快照/CAS/外部冲突/切库隔离 语义演示完成")


if __name__ == "__main__":
    main()
