# -*- coding: utf-8 -*-
"""崩溃注入辅助：在指定提交点执行一次保存并 os._exit（供 test_s3 进程终止用例）。

用法：python crash_save.py <root> <rel> <content> <crash_at> <lease_epoch>
环境：S3_CRASH_AT=<crash_at>
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from store import StoreManager, WorkspaceContext  # noqa: E402


def main() -> int:
    root = Path(sys.argv[1])
    rel = sys.argv[2]
    content = sys.argv[3].encode("utf-8")
    crash_at = sys.argv[4]
    epoch = int(sys.argv[5])
    ctx = WorkspaceContext("ws1", root)
    ctx.load()
    mgr = StoreManager(root.parent)
    mgr.contexts["ws1"] = ctx
    snap = mgr.snapshot("ws1", rel)
    # S3_CRASH_AT 已由父进程设置；保存流程会在对应提交点退出
    import os

    os.environ.setdefault("S3_CRASH_AT", crash_at)
    mgr.save({"context_id": "ws1", "epoch": epoch}, snap, content, request_id="crash-req")
    print("NO-CRASH", file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main())
