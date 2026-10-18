# -*- coding: utf-8 -*-
"""P3-T19 升级探针：guest entry 资源来自**已安装包**（真实 manifest/entry/资产），
再由 PackageHost+Broker+HostDispatcher 装配会话并模拟崩溃升级/safeMode。

运行：python run_t19_entry_probe.py
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-t19-entry")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
GUEST_BUNDLE = REPO / "docs" / "ui-workshop" / "core" / "packs" / "probe" / "t19-guest-code.txt"
PACK_ID = "com.probe.t19entry"
PACK_VERSION = "1.0.0"


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if not GUEST_BUNDLE.exists():
        print(f"缺少 guest bundle: {GUEST_BUNDLE}（先运行 build_t19_probe.sh）")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)

    # 1) 构造真实包目录（manifest + entry HTML 内含 guest bundle）
    guest = GUEST_BUNDLE.read_text(encoding="utf-8")
    entry_html = (
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>t19 pack entry</title></head>"
        "<body><div>t19 pack entry guest</div><script>" + guest + "<" + "/script></body></html>"
    )
    pack_dir = BASE / "pack"
    pack_dir.mkdir(parents=True)
    (pack_dir / "index.html").write_text(entry_html, encoding="utf-8")
    sha = hashlib.sha256(entry_html.encode("utf-8")).hexdigest()
    manifest = {
        "id": PACK_ID, "name": "T19 Entry Pack", "version": PACK_VERSION, "apiVersion": 1,
        "capabilities": ["context.read"], "entry": {"html": "index.html"},
        "commands": [], "assets": [{"path": "index.html", "sha256": sha}],
    }
    (pack_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 2) 启动 app：setup 从包目录安装 → t19 窗口读取已安装 entry 资源并跑会话探针
    data_root = BASE / "data"
    data_root.mkdir(parents=True)
    probe = BASE / "probe-t19-entry"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({
        "S1_PROBE_DIR": str(probe),
        "S1_SCENARIO": "t19",
        "S1_OPEN_T19": "1",
        "S1_PACK_ROOT": str(data_root),
        "S1_PACK_SEED_PACK_DIR": str(pack_dir),
        "S1_T19_USE_PACK_ENTRY": "1",
    })
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
    guest = r.get("guest") or {}
    diag = r.get("diag") or {}
    installed_manifest = data_root / "packs" / PACK_ID / PACK_VERSION / "manifest.json"
    installed_entry = data_root / "packs" / PACK_ID / PACK_VERSION / "index.html"
    print("t19 entry results:", json.dumps(r, ensure_ascii=False)[:1200])
    print("events:", [ln for ln in events.splitlines() if "pack-seeded" in ln or "t19" in ln][:5], flush=True)

    check("W-T19E-1 setup 从真实包目录安装成功", "pack-seeded-from-dir" in events, [ln for ln in events.splitlines() if "pack-seeded" in ln])
    check("W-T19E-2 已安装包 manifest/entry 落盘", installed_manifest.exists() and installed_entry.exists(),
          {"manifest": installed_manifest.exists(), "entry": installed_entry.exists()})
    check("W-T19E-3 guest entry 来自已安装包（非内联 fallback）",
          r.get("guestSource") == "pack-entry" and (r.get("entryBytes") or 0) > 0,
          {"source": r.get("guestSource"), "bytes": r.get("entryBytes"), "err": r.get("entryError")})
    check("W-T19E-4 host+guest 探针完成", r.get("phase") == "t19-done" and guest.get("phase") == "t19-guest-done",
          {"host": r.get("phase"), "guest": guest.get("phase"), "error": guest.get("error")})
    check("W-T19E-5 guest 经 Broker 握手+只读 snapshot（能力放行）",
          guest.get("handshakeAccepted") == ["context.read"] and (guest.get("snapshot") or {}).get("revision") == 1,
          {"handshake": guest.get("handshakeAccepted"), "snapshot": guest.get("snapshot")})
    check("W-T19E-6 崩溃未超限 → suspended", (r.get("crashStates") or []) == ["suspended", "suspended"], r.get("crashStates"))
    check("W-T19E-7 超限 → failed + 停用 + recover + safeMode",
          r.get("overLimitState") == "failed" and diag.get("deactivateCalls", 0) >= 1
          and diag.get("recoverCalls", 0) >= 1 and r.get("safeMode") is True,
          {"state": r.get("overLimitState"), "deactivate": diag.get("deactivateCalls"),
           "recover": diag.get("recoverCalls"), "safeMode": r.get("safeMode")})
    check("W-T19E-8 真实 Windows 文件系统/环境", "Edg/" in str(r.get("ua", "")) and data_root.exists(),
          {"ua": str(r.get("ua"))[:60], "root": str(data_root)})

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
    }
    out = EVID / "T19-pack-entry-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
