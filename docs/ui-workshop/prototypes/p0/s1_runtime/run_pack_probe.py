# -*- coding: utf-8 -*-
"""P3-T21 实机探针：Rust 原生包存储在 Windows 文件系统上的安装/升级/回滚/损坏/崩溃恢复。

流程：启动原型 app（S1_SCENARIO=pack, S1_OPEN_PACK=1, S1_PACK_ROOT=临时目录）→ Rust setup 打开
pack-render 窗口加载 pack.js（真实 Tauri 命令）→ 依次执行安装/升级/回滚/损坏恢复/拒绝/崩溃恢复 →
runner 断言结果并直接检查磁盘（state.json/版本目录/staging 残留/文件内容）。
运行：python run_pack_probe.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-t21-probe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.hello"


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:240], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    probe = BASE / "probe-pack"
    pack_root = BASE / "data"
    probe.mkdir(parents=True)
    pack_root.mkdir(parents=True)
    env = dict(os.environ)
    env.update({"S1_PROBE_DIR": str(probe), "S1_SCENARIO": "pack", "S1_OPEN_PACK": "1", "S1_PACK_ROOT": str(pack_root)})
    p = subprocess.Popen([str(EXE)], env=env)
    results = None
    end = time.time() + 150
    while time.time() < end:
        f = probe / "results.json"
        if f.exists():
            try:
                results = json.loads(f.read_text(encoding="utf-8"))
                break
            except Exception:
                pass
        if p.poll() is not None and not f.exists():
            break
        time.sleep(0.3)
    try:
        p.wait(timeout=20)
    except subprocess.TimeoutExpired:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)
    events = (probe / "events.log").read_text(encoding="utf-8") if (probe / "events.log").exists() else ""
    r = results or {}
    id_dir = pack_root / "packs" / PACK_ID
    state_file = id_dir / "state.json"
    state = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
    versions = sorted([d.name for d in id_dir.iterdir() if d.is_dir()]) if id_dir.is_dir() else []
    has_staging = any(v.startswith(".staging") for v in versions)
    has_txn = (id_dir / "txn.json").exists()
    print("pack results:", json.dumps(r, ensure_ascii=False)[:1200])
    print("disk:", {"state": state, "versions": versions, "staging": has_staging, "txn": has_txn}, flush=True)

    def state_ok(key: str, value) -> bool:
        return (state or {}).get(key) == value

    check("W-T21-1 Rust setup 打开 pack-render 窗口", "pack-render opened by rust setup" in events, events.splitlines()[:3])
    check("W-T21-2 探针完成（无异常）", r.get("phase") == "pack-probe-done", {"phase": r.get("phase"), "error": r.get("error")})
    check("W-T21-3 安装 v1 后 active=1.0.0", state_ok("active", "1.0.0") or (r.get("stateAfterInstallV1") or {}).get("active") == "1.0.0",
          r.get("stateAfterInstallV1"))
    v2_state = r.get("stateAfterInstallV2") or {}
    check("W-T21-4 升级 v2 后 active=2.0.0, previous=1.0.0", v2_state.get("active") == "2.0.0" and v2_state.get("previous") == "1.0.0", v2_state)
    check("W-T21-5 回滚成功（rollback 返回 active=1.0.0）", (r.get("stateAfterRollback") or {}).get("active") == "1.0.0", r.get("stateAfterRollback"))
    check("W-T21-6 verify v1/v2 均通过", r.get("verifyV1") is True and r.get("verifyV2") is True, {"v1": r.get("verifyV1"), "v2": r.get("verifyV2")})
    check("W-T21-7 损坏 active 后 verify=false", r.get("verifyCorrupted") is False, r.get("verifyCorrupted"))
    check("W-T21-8 recover 自动回滚损坏 active", (r.get("recoverFromCorruption") or {}).get("action") == "rollback-corrupt-active"
          and (r.get("recoverFromCorruption") or {}).get("state", {}).get("active") == "2.0.0", r.get("recoverFromCorruption"))
    check("W-T21-9 坏哈希安装被拒（E_HASH）且未生成版本目录", "E_HASH" in str(r.get("badHashError")) and r.get("verifyRejectedV3") is False,
          {"err": r.get("badHashError"), "verify": r.get("verifyRejectedV3")})
    check("W-T21-10 路径穿越被拒（E_PATH）", "E_PATH" in str(r.get("traversalError")), r.get("traversalError"))
    check("W-T21-11 重复安装被拒（E_DUPLICATE）", "E_DUPLICATE" in str(r.get("duplicateError")), r.get("duplicateError"))
    check("W-T21-12 崩溃注入后 state 不变", "E_INJECTED" in str(r.get("crashError"))
          and (r.get("stateAfterCrash") or {}).get("active") == (r.get("stateBeforeCrash") or {}).get("active"),
          {"crash": r.get("crashError"), "after": r.get("stateAfterCrash"), "before": r.get("stateBeforeCrash")})
    rec = r.get("recoverAfterCrash") or {}
    check("W-T21-13 崩溃后无孤儿版本（recover 后 verify=false，无 journal 残留）",
          r.get("verifyOrphanV4") is False and rec.get("action") in ("clean", "cleanup-journal") and rec.get("active") == "2.0.0",
          {"recover": rec, "verifyOrphan": r.get("verifyOrphanV4")})
    check("W-T21-14 重新安装 v4 成功 final active=4.0.0", (r.get("finalState") or {}).get("active") == "4.0.0", r.get("finalState"))
    check("W-T21-15 磁盘 state.json active=4.0.0 previous=2.0.0", state_ok("active", "4.0.0") and state_ok("previous", "2.0.0"), state)
    check("W-T21-16 磁盘版本目录 1.0.0/2.0.0/4.0.0 存在且 3.0.0 不存在",
          set(versions) == {"1.0.0", "2.0.0", "4.0.0"}, versions)
    check("W-T21-17 无 staging/journal 残留", not has_staging and not has_txn, {"staging": has_staging, "txn": has_txn})
    check("W-T21-18 磁盘文件内容与最近安装一致", (id_dir / "4.0.0" / "index.html").exists()
          and "v4" in (id_dir / "4.0.0" / "index.html").read_text(encoding="utf-8"),
          (id_dir / "4.0.0" / "index.html").read_text(encoding="utf-8") if (id_dir / "4.0.0" / "index.html").exists() else None)
    check("W-T21-19 损坏文件保持损坏（未被静默修复）", (id_dir / "1.0.0" / "index.html").exists()
          and "corrupted" in (id_dir / "1.0.0" / "index.html").read_text(encoding="utf-8"),
          (id_dir / "1.0.0" / "index.html").read_text(encoding="utf-8") if (id_dir / "1.0.0" / "index.html").exists() else None)
    check("W-T21-20 真实 Windows 文件系统/环境", "Edg/" in str(r.get("ua", "")) and pack_root.exists(), str(pack_root))
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
        "disk": {"state": state, "versions": versions, "staging": has_staging, "txn": has_txn},
    }
    out = EVID / "T21-pack-install-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
