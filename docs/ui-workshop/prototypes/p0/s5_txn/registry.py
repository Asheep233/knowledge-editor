# -*- coding: utf-8 -*-
"""P0-S5 原型：UI 包与私有状态的原子安装/激活/回滚（无 UI 版本）。

对应任务包 TASKS.md T06 / ARCHITECTURE.md「切换状态机 / 包与状态事务」的最小可运行原型。
本原型只验证**事务与恢复语义**，不涉及真实 Tauri/前端运行时：

- 包：离线 ZIP（manifest.json + content/**），安装时校验路径/体积/hash，解压到 staging，
  再以**单次 rename** 提交到不可变 packages/<id>/<version>/（不执行任何包内脚本）。
- 私有状态：state/<id>/<version>/private/（每个包版本独立副本；激活时从旧状态复制/迁移）。
- 激活指针：active.json = {"current": {...}, "previous": {...}}，通过
  「写 journal → 临时文件 fsync → os.replace → fsync 目录 → 删 journal」提交；
  崩溃后 recover() 依据 journal 与 active.json 判定：已提交则完成清理，未提交则撤销新状态。
- 崩溃注入：环境变量 S5_CRASH_AT=<point> 在命名提交点 os._exit(97)，供进程终止测试。

运行测试：python3 -m pytest docs/ui-workshop/prototypes/p0/s5_txn/test_s5.py -q
演示：python3 docs/ui-workshop/prototypes/p0/s5_txn/run_demo.py
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

SCHEMA_VERSION = 1
POINTER_SCHEMA_VERSION = 1
MAX_FILES = 2000
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024
OFFICIAL_PACKAGE = {"kind": "official", "id": "official", "version": "builtin"}


class S5Error(Exception):
    """事务/校验失败（预期错误，非崩溃）。"""


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _crash_point(name: str) -> None:
    """测试用进程终止点：命中则立即退出（模拟断电/强杀）。"""
    if os.environ.get("S5_CRASH_AT") == name:
        os._exit(97)


def _safe_rel(name: str) -> str:
    """校验 zip 内路径：必须是相对路径、无 .. / 绝对路径 / 盘符 / 反斜杠逃逸。"""
    norm = name.replace("\\", "/")
    if norm.startswith("/") or (len(norm) > 1 and norm[1] == ":"):
        raise S5Error(f"zip 内绝对路径被拒绝: {name}")
    parts = [p for p in norm.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise S5Error(f"zip 内路径穿越被拒绝: {name}")
    if not parts:
        raise S5Error(f"zip 内空路径: {name!r}")
    return "/".join(parts)


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _atomic_write_json(path: Path, data: Any) -> None:
    tmp = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex[:8]}")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    _fsync_dir(path.parent)


@dataclass
class PackageRef:
    id: str
    version: str
    content_hash: str

    def as_dict(self) -> dict[str, str]:
        return {"id": self.id, "version": self.version, "content_hash": self.content_hash}

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "PackageRef":
        return PackageRef(id=str(d["id"]), version=str(d["version"]), content_hash=str(d["content_hash"]))


class PackageLayout:
    """一个工坊根目录的布局。

    root/
      packages/<id>/<version>/content/**     不可变包内容
      packages/<id>/<version>/manifest.json  安装时校验后的清单
      staging/<txn>/                         安装暂存（崩溃后清理）
      state/<id>/<version>/private/**        包私有状态（激活时切换指针）
      active.json                            当前/上一激活指针（唯一提交点）
      journal/*.json                         激活事务日志（恢复依据）
      notes/                                 模拟「Core 笔记」：不属于 UI 状态，回滚不动
    """

    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.packages = self.root / "packages"
        self.staging = self.root / "staging"
        self.state = self.root / "state"
        self.journal = self.root / "journal"
        self.notes = self.root / "notes"
        self.pointer = self.root / "active.json"

    # ---------- 初始化 / 恢复 ----------
    def init(self) -> None:
        for d in (self.packages, self.staging, self.state, self.journal, self.notes):
            d.mkdir(parents=True, exist_ok=True)
        _fsync_dir(self.root)

    def recover(self) -> dict[str, Any]:
        """进程重启后的恢复：完成或撤销未决激活事务；清理 staging；返回当前指针。"""
        self.init()
        pointer = self._read_pointer()
        for j in sorted(self.journal.glob("*.json")):
            try:
                txn = json.loads(j.read_text(encoding="utf-8"))
            except Exception:
                j.unlink(missing_ok=True)
                continue
            target = txn.get("new")
            committed = pointer is not None and pointer.get("current") == target
            if committed:
                # 指针已提交 → 事务其实成功，仅清理 journal（状态目录已是新的）
                pass
            else:
                # 未提交 → 撤销预建的私有状态目录
                state_rel = str((target or {}).get("state_dir") or "")
                if state_rel:
                    victim = self.root / state_rel
                    if victim.is_dir():
                        shutil.rmtree(victim, ignore_errors=True)
            j.unlink(missing_ok=True)
        for d in list(self.staging.iterdir()):
            if d.is_dir():
                shutil.rmtree(d, ignore_errors=True)
        return pointer or self._default_pointer()

    # ---------- 指针 ----------
    def _default_pointer(self) -> dict[str, Any]:
        return {
            "schemaVersion": POINTER_SCHEMA_VERSION,
            "seq": 0,
            "current": dict(OFFICIAL_PACKAGE),
            "previous": None,
        }

    def _read_pointer(self) -> Optional[dict[str, Any]]:
        if not self.pointer.exists():
            return None
        try:
            data = json.loads(self.pointer.read_text(encoding="utf-8"))
        except Exception:
            return None
        if not isinstance(data, dict) or "current" not in data:
            return None
        return data

    def current(self) -> dict[str, Any]:
        p = self._read_pointer()
        return p or self._default_pointer()

    def read_notes(self) -> dict[str, str]:
        return {p.name: _sha256_file(p) for p in sorted(self.notes.iterdir()) if p.is_file()}

    def write_note(self, name: str, content: str) -> None:
        self.init()
        (self.notes / name).write_text(content, encoding="utf-8")

    # ---------- 安装 ----------
    def install(self, zip_path: Path | str) -> PackageRef:
        self.init()
        txn = self.staging / f"install-{uuid.uuid4().hex[:12]}"
        txn.mkdir(parents=True)
        try:
            manifest = self._validate_zip(Path(zip_path), txn)
            pkg = PackageRef(
                id=str(manifest["id"]),
                version=str(manifest["version"]),
                content_hash=_sha256_bytes(
                    json.dumps(manifest["files"], sort_keys=True, ensure_ascii=False).encode("utf-8")
                ),
            )
            _crash_point("install:staged")
            target = self.packages / pkg.id / pkg.version
            if target.exists():
                existing = self._installed_ref(pkg.id, pkg.version)
                if existing is not None and existing.content_hash == pkg.content_hash:
                    return existing  # 幂等：相同版本且内容一致
                raise S5Error(f"同版本不同内容被拒绝: {pkg.id}@{pkg.version}")
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(txn / "content", target)  # 单次 rename 提交（同一文件系统）
            _fsync_dir(target.parent)
            (target / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            _crash_point("install:committed")
            shutil.rmtree(txn, ignore_errors=True)
            return pkg
        finally:
            if txn.exists():
                shutil.rmtree(txn, ignore_errors=True)

    def _validate_zip(self, zip_path: Path, txn: Path) -> dict[str, Any]:
        try:
            zf = zipfile.ZipFile(zip_path)
        except zipfile.BadZipFile as e:
            raise S5Error(f"非法 zip: {e}") from e
        with zf:
            infos = zf.infolist()
            files = [i for i in infos if not i.is_dir()]
            if len(files) > MAX_FILES:
                raise S5Error(f"文件数超限: {len(files)} > {MAX_FILES}")
            total = 0
            checked: dict[str, dict[str, Any]] = {}
            for info in files:
                rel = _safe_rel(info.filename)
                if info.file_size > MAX_FILE_BYTES:
                    raise S5Error(f"单文件超限: {rel} {info.file_size} B")
                total += info.file_size
                if total > MAX_TOTAL_BYTES:
                    raise S5Error("解压总体积超限（zip bomb 防护）")
                checked[rel] = {"bytes": info.file_size, "crc": info.CRC}
            if "manifest.json" not in checked:
                raise S5Error("包缺少 manifest.json")
            raw = zf.read("manifest.json")
            try:
                manifest = json.loads(raw.decode("utf-8"))
            except Exception as e:
                raise S5Error(f"manifest.json 非法: {e}") from e
            self._validate_manifest(manifest)
            declared = {str(f["path"]): f for f in manifest["files"]}
            missing = [p for p in declared if p not in checked]
            extra = [p for p in checked if p not in declared and p != "manifest.json"]
            if missing:
                raise S5Error(f"manifest 声明的文件缺失: {missing[:3]}")
            if extra:
                raise S5Error(f"包内有未声明文件: {extra[:3]}")
            content_dir = txn / "content"
            content_dir.mkdir()
            for rel, meta in declared.items():
                data = zf.read(rel)
                if len(data) != int(meta["bytes"]):
                    raise S5Error(f"文件字节数不符: {rel}")
                if _sha256_bytes(data) != str(meta["sha256"]):
                    raise S5Error(f"文件 sha256 不符: {rel}")
                dest = content_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            return manifest

    @staticmethod
    def _validate_manifest(manifest: Any) -> None:
        if not isinstance(manifest, dict):
            raise S5Error("manifest 必须是对象")
        if manifest.get("schemaVersion") != SCHEMA_VERSION:
            raise S5Error(f"不支持的 manifest schemaVersion: {manifest.get('schemaVersion')}")
        for key in ("id", "version", "files"):
            if key not in manifest:
                raise S5Error(f"manifest 缺少字段: {key}")
        pkg_id = str(manifest["id"])
        if not (1 <= len(pkg_id) <= 64) or not all(c.islower() or c.isdigit() or c in ".-_" for c in pkg_id):
            raise S5Error(f"非法包 id: {pkg_id!r}")
        if not isinstance(manifest["files"], list) or not manifest["files"]:
            raise S5Error("manifest.files 必须是非空数组")
        for f in manifest["files"]:
            if not isinstance(f, dict) or not {"path", "bytes", "sha256"} <= set(f):
                raise S5Error("manifest.files 条目缺字段")
            _safe_rel(str(f["path"]))

    def _installed_ref(self, pkg_id: str, version: str) -> Optional[PackageRef]:
        target = self.packages / pkg_id / version
        mf = target / "manifest.json"
        if not mf.exists():
            return None
        try:
            manifest = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:
            return None
        return PackageRef(
            id=pkg_id,
            version=version,
            content_hash=_sha256_bytes(
                json.dumps(manifest["files"], sort_keys=True, ensure_ascii=False).encode("utf-8")
            ),
        )

    # ---------- 私有状态 ----------
    def _state_dir_rel(self, ref: PackageRef) -> str:
        return f"state/{ref.id}/{ref.version}/private"

    def _prepare_state(self, ref: PackageRef, previous: Optional[dict[str, Any]]) -> str:
        """为候选版本建立独立私有状态（从旧状态复制；不存在则空目录）。"""
        rel = self._state_dir_rel(ref)
        dest = self.root / rel
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        prev_rel = str((previous or {}).get("state_dir") or "")
        if prev_rel:
            src = self.root / prev_rel
            if src.is_dir():
                for item in src.iterdir():
                    if item.is_dir():
                        shutil.copytree(item, dest / item.name)
                    else:
                        shutil.copy2(item, dest / item.name)
        # 写入包身份与迁移标记（原型：迁移 = 复制 + 标记；真实实现按包声明迁移函数）
        _atomic_write_json(dest / ".s5-state.json", {"package": ref.as_dict(), "schemaVersion": SCHEMA_VERSION})
        return rel

    def state_dir(self, ref: Optional[PackageRef] = None) -> Path:
        if ref is None:
            cur = self.current()["current"]
            return self.root / str(cur.get("state_dir") or f"state/{cur.get('id')}/{cur.get('version')}/private")
        return self.root / self._state_dir_rel(ref)

    # ---------- 激活 / 回滚 ----------
    def activate(self, ref: PackageRef, migrate: Optional[Callable[[Path], None]] = None) -> dict[str, Any]:
        """原子激活：包指针 + 私有状态指针在同一个 active.json 提交点切换。"""
        self.init()
        if not (self.packages / ref.id / ref.version).is_dir():
            raise S5Error(f"包未安装: {ref.id}@{ref.version}")
        pointer = self._read_pointer() or self._default_pointer()
        if (
            pointer.get("current", {}).get("id") == ref.id
            and pointer.get("current", {}).get("version") == ref.version
            and pointer.get("current", {}).get("content_hash") == ref.content_hash
        ):
            return pointer  # 幂等
        state_rel = self._prepare_state(ref, pointer.get("current"))
        if migrate is not None:
            migrate(self.root / state_rel)
        _crash_point("activate:state_ready")
        new_current = {
            "kind": "ui",
            **ref.as_dict(),
            "state_dir": state_rel,
            "activated_at": time.time(),
        }
        new_pointer = {
            "schemaVersion": POINTER_SCHEMA_VERSION,
            "seq": int(pointer.get("seq") or 0) + 1,
            "current": new_current,
            "previous": pointer.get("current"),
        }
        txn_path = self.journal / f"activate-{uuid.uuid4().hex[:12]}.json"
        _atomic_write_json(txn_path, {"new": new_current, "previous": pointer.get("current")})
        _crash_point("activate:journal_written")
        _atomic_write_json(self.pointer, new_pointer)
        _crash_point("activate:pointer_committed")
        txn_path.unlink(missing_ok=True)
        _fsync_dir(self.journal)
        _crash_point("activate:done")
        return new_pointer

    def rollback(self) -> dict[str, Any]:
        """回滚到上一包及其匹配的私有状态（Core 笔记不参与回滚）。"""
        pointer = self._read_pointer() or self._default_pointer()
        prev = pointer.get("previous")
        if not prev:
            raise S5Error("没有可回滚的上一包")
        prev_ref = PackageRef(
            id=str(prev["id"]),
            version=str(prev["version"]),
            content_hash=str(prev.get("content_hash") or ""),
        )
        state_rel = str(prev.get("state_dir") or "")
        new_current = {
            "kind": "ui" if prev_ref.id != "official" else "official",
            **prev_ref.as_dict(),
            "state_dir": state_rel,
            "activated_at": time.time(),
            "rolled_back": True,
        }
        new_pointer = {
            "schemaVersion": POINTER_SCHEMA_VERSION,
            "seq": int(pointer.get("seq") or 0) + 1,
            "current": new_current,
            "previous": pointer.get("current"),
        }
        txn_path = self.journal / f"rollback-{uuid.uuid4().hex[:12]}.json"
        _atomic_write_json(txn_path, {"new": new_current, "previous": pointer.get("current")})
        _crash_point("activate:journal_written")
        _atomic_write_json(self.pointer, new_pointer)
        _crash_point("activate:pointer_committed")
        txn_path.unlink(missing_ok=True)
        _fsync_dir(self.journal)
        return new_pointer

    def health_fail_rollback(self) -> dict[str, Any]:
        """激活后健康检查失败：以**新的一次原子事务**回退（不是覆盖写）。"""
        return self.rollback()


# ---------- 测试/演示用：构造最小合法 zip ----------
def build_package_zip(path: Path, pkg_id: str, version: str, files: dict[str, bytes]) -> Path:
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "id": pkg_id,
        "version": version,
        "files": [
            {"path": rel, "bytes": len(data), "sha256": _sha256_bytes(data)}
            for rel, data in sorted(files.items())
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        for rel, data in sorted(files.items()):
            zf.writestr(rel, data)
    return path


def _cli(argv: list[str]) -> int:
    """最小 CLI（供进程终止测试驱动）：python registry.py <root> <cmd> [args...]"""
    if len(argv) < 3:
        print("usage: registry.py <root> <init|recover|install <zip>|activate <id> <version> <hash>|rollback|status>")
        return 2
    layout = PackageLayout(argv[1])
    cmd = argv[2]
    if cmd == "init":
        layout.init()
        print(json.dumps(layout.recover(), ensure_ascii=False))
    elif cmd == "recover":
        print(json.dumps(layout.recover(), ensure_ascii=False))
    elif cmd == "install":
        ref = layout.install(argv[3])
        print(json.dumps(ref.as_dict(), ensure_ascii=False))
    elif cmd == "activate":
        ref = PackageRef(id=argv[3], version=argv[4], content_hash=argv[5])
        layout.recover()
        print(json.dumps(layout.activate(ref), ensure_ascii=False))
    elif cmd == "rollback":
        print(json.dumps(layout.rollback(), ensure_ascii=False))
    elif cmd == "status":
        print(json.dumps(layout.current(), ensure_ascii=False))
    else:
        print(f"unknown cmd: {cmd}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv))
