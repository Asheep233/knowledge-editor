# -*- coding: utf-8 -*-
"""P0-S5 演示：安装 v1 → 激活 → 安装 v2 → 激活 → 健康失败回滚 → 校验笔记不动。

用法：python3 docs/ui-workshop/prototypes/p0/s5_txn/run_demo.py [临时根目录]
输出可直接作为 evidence/P0-S5-prototype.md 的运行记录。
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from registry import PackageLayout, build_package_zip  # noqa: E402


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="s5-demo-"))
    layout = PackageLayout(root)
    layout.init()
    print(f"# S5 演示根目录: {root}")
    layout.write_note("note.md", "Core 笔记：不可被 UI 回滚影响")
    notes0 = layout.read_notes()
    print("notes:", notes0)

    z1 = build_package_zip(root / "sage-1.zip", "sage", "1.0.0", {"index.html": b"<html>v1</html>"})
    r1 = layout.install(z1)
    p1 = layout.activate(r1)
    (layout.state_dir() / "settings.json").write_text('{"panelWidth": 300}', encoding="utf-8")
    print("installed/activated:", p1["current"])

    z2 = build_package_zip(root / "sage-2.zip", "sage", "2.0.0", {"index.html": b"<html>v2</html>"})
    r2 = layout.install(z2)
    p2 = layout.activate(r2)
    print("activated v2:", p2["current"], "previous:", p2["previous"]["version"])

    # 模拟激活后健康检查失败 → 以新事务回滚
    p3 = layout.health_fail_rollback()
    print("health-fail rollback -> current:", p3["current"]["version"], "previous:", p3["previous"]["version"])
    assert p3["current"]["version"] == "1.0.0"
    assert layout.read_notes() == notes0, "笔记必须保持不变"
    print("OK: 回滚后包=v1，笔记 hash 未变")


if __name__ == "__main__":
    main()
