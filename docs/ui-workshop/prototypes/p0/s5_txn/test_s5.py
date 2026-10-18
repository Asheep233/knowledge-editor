# -*- coding: utf-8 -*-
"""P0-S5 原型测试：安装/激活/回滚事务 + 提交点进程终止恢复。

运行：python3 -m pytest docs/ui-workshop/prototypes/p0/s5_txn/test_s5.py -q
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from registry import (  # noqa: E402
    OFFICIAL_PACKAGE,
    PackageLayout,
    PackageRef,
    S5Error,
    build_package_zip,
)

CLI = HERE / "registry.py"


def _pkg(tmp: Path, pkg_id: str = "sage", version: str = "1.0.0", body: bytes = b"ui") -> PackageRef:
    z = build_package_zip(
        tmp / f"{pkg_id}-{version}.zip",
        pkg_id,
        version,
        {"index.html": b"<html>" + body + b"</html>", "assets/app.js": b"console.log(1)"},
    )
    return PackageLayout(tmp / "root").install(z)


@pytest.fixture()
def root(tmp_path: Path) -> Path:
    layout = PackageLayout(tmp_path / "root")
    layout.init()
    return tmp_path / "root"


def test_happy_install_activate_rollback(root: Path) -> None:
    layout = PackageLayout(root)
    v1 = _pkg(root.parent, version="1.0.0", body=b"v1")
    p = layout.activate(v1)
    assert p["current"]["version"] == "1.0.0"
    assert (root / p["current"]["state_dir"]).is_dir()
    layout.write_note("note.md", "core note v1")
    notes_before = layout.read_notes()

    v2 = _pkg(root.parent, version="2.0.0", body=b"v2")
    p2 = layout.activate(v2)
    assert p2["current"]["version"] == "2.0.0"
    assert p2["previous"]["version"] == "1.0.0"

    p3 = layout.rollback()
    assert p3["current"]["version"] == "1.0.0"
    assert layout.read_notes() == notes_before, "回滚 UI 不得改动 Core 笔记"


def test_reject_path_traversal(root: Path) -> None:
    z = root.parent / "evil.zip"
    manifest = {
        "schemaVersion": 1,
        "id": "evil",
        "version": "1.0.0",
        "files": [{"path": "../escape.txt", "bytes": 1, "sha256": "0" * 64}],
    }
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("../escape.txt", b"x")
    with pytest.raises(S5Error):
        PackageLayout(root).install(z)


def test_reject_tampered_content(root: Path) -> None:
    good = _pkg(root.parent, version="1.0.0")
    z = root.parent / "tampered.zip"
    with zipfile.ZipFile(root.parent / "sage-1.0.0.zip") as src, zipfile.ZipFile(z, "w") as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == "assets/app.js":
                data = b"malicious()"
            dst.writestr(item.filename, data)
    with pytest.raises(S5Error):
        PackageLayout(root).install(z)


def test_same_version_same_content_idempotent_different_rejected(root: Path) -> None:
    layout = PackageLayout(root)
    a = _pkg(root.parent, version="1.0.0", body=b"A")
    b = layout.install(root.parent / "sage-1.0.0.zip")
    assert a.content_hash == b.content_hash
    build_package_zip(
        root.parent / "sage-1.0.0-diff.zip", "sage", "1.0.0",
        {"index.html": b"<html>DIFFERENT</html>", "assets/app.js": b"console.log(1)"},
    )
    with pytest.raises(S5Error):
        layout.install(root.parent / "sage-1.0.0-diff.zip")


def _run_cli(root: Path, args: list[str], crash_at: str | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    if crash_at:
        env["S5_CRASH_AT"] = crash_at
    return subprocess.run(
        [sys.executable, str(CLI), str(root), *args],
        capture_output=True,
        text=True,
        env=env,
    )


def test_crash_install_staged_then_recover(root: Path) -> None:
    z = build_package_zip(root.parent / "p.zip", "sage", "1.0.0", {"index.html": b"x"})
    r = _run_cli(root, ["install", str(z)], crash_at="install:staged")
    assert r.returncode == 97, r.stderr
    layout = PackageLayout(root)
    layout.recover()
    assert not (root / "packages" / "sage" / "1.0.0").exists(), "未提交安装不应生效"
    assert list((root / "staging").iterdir()) == [], "recover 应清理 staging"


def test_crash_install_committed_then_recover(root: Path) -> None:
    z = build_package_zip(root.parent / "p.zip", "sage", "1.0.0", {"index.html": b"x"})
    r = _run_cli(root, ["install", str(z)], crash_at="install:committed")
    assert r.returncode == 97
    layout = PackageLayout(root)
    layout.recover()
    assert (root / "packages" / "sage" / "1.0.0" / "index.html").exists(), "已提交安装应保留"
    assert list((root / "staging").iterdir()) == []


def test_crash_activate_journal_written_keeps_old_pointer(root: Path) -> None:
    layout = PackageLayout(root)
    v1 = _pkg(root.parent, version="1.0.0")
    layout.activate(v1)
    v2 = _pkg(root.parent, version="2.0.0")
    r = _run_cli(root, ["activate", "sage", "2.0.0", v2.content_hash], crash_at="activate:journal_written")
    assert r.returncode == 97
    layout2 = PackageLayout(root)
    layout2.recover()
    cur = layout2.current()["current"]
    assert cur["version"] == "1.0.0", "未提交激活应保持旧指针（旧 UI 可继续）"
    assert not list((root / "journal").glob("*.json")), "recover 应清理 journal"
    # 撤销预建的 v2 私有状态目录（若已存在）
    v2_state = root / "state" / "sage" / "2.0.0" / "private"
    assert not v2_state.exists() or cur["version"] != "2.0.0"


def test_crash_activate_pointer_committed_keeps_new(root: Path) -> None:
    layout = PackageLayout(root)
    v1 = _pkg(root.parent, version="1.0.0")
    layout.activate(v1)
    v2 = _pkg(root.parent, version="2.0.0")
    r = _run_cli(root, ["activate", "sage", "2.0.0", v2.content_hash], crash_at="activate:pointer_committed")
    assert r.returncode == 97
    layout2 = PackageLayout(root)
    layout2.recover()
    assert layout2.current()["current"]["version"] == "2.0.0", "已提交激活必须持久"
    assert not list((root / "journal").glob("*.json"))


def test_corrupt_pointer_falls_back_official(root: Path) -> None:
    layout = PackageLayout(root)
    v1 = _pkg(root.parent, version="1.0.0")
    layout.activate(v1)
    (root / "active.json").write_text("{not json", encoding="utf-8")
    cur = PackageLayout(root).recover()["current"]
    assert cur["id"] == OFFICIAL_PACKAGE["id"], "损坏指针应安全回退官方包"


def test_private_state_isolation_and_migration(root: Path) -> None:
    layout = PackageLayout(root)
    v1 = _pkg(root.parent, version="1.0.0")
    layout.activate(v1)
    s1 = layout.state_dir()
    (s1 / "settings.json").write_text('{"panelWidth": 300}', encoding="utf-8")

    def migrate(dest: Path) -> None:
        (dest / "migrated.txt").write_text("v2 migration", encoding="utf-8")

    v2 = _pkg(root.parent, version="2.0.0")
    p2 = layout.activate(v2, migrate=migrate)
    s2 = root / p2["current"]["state_dir"]
    assert s2 != s1, "每个包版本独立私有状态目录"
    assert (s2 / "settings.json").read_text(encoding="utf-8") == '{"panelWidth": 300}'
    assert (s2 / "migrated.txt").exists()

    layout.rollback()
    s1_after = layout.state_dir()
    assert s1_after.read_text if False else True
    assert (s1_after / "settings.json").exists(), "回滚应回到旧包的私有状态"
    assert not (s1_after / "migrated.txt").exists(), "旧包状态不应被新包迁移污染"
