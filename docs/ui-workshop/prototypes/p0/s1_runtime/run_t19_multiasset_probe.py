# -*- coding: utf-8 -*-
"""P3-T19 升级探针 2：多资源包（entry/css/js 均从已安装包加载）+ 心跳真实崩溃检测。

流程：构造 3 资产包 → setup 从目录安装 → host 读取 entry/css/js 注入 guest →
guest 握手/快照 → 心跳稳定 → 移除 iframe 模拟 renderer 崩溃 → 宿主心跳超时自动 reportCrash →
suspended → 显式再崩溃 → 超限 failed + deactivate + recover + safeMode。
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
BASE = Path(r"C:\ke-tmp\uiws-t19-multi")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
GUEST_BUNDLE = REPO / "docs" / "ui-workshop" / "core" / "packs" / "probe" / "t19-guest-code.txt"
PACK_ID = "com.probe.t19entry"
PACK_VERSION = "1.0.0"


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:320], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)

    # 1) 多资源包：entry 用占位符引用 style.css / sdk.js（安装期哈希校验）
    guest = GUEST_BUNDLE.read_text(encoding="utf-8").replace("</script>", "<\\/script>")
    entry_html = (
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>t19 multi</title>{{STYLE}}</head>"
        "<body><div id=\"guest\">t19 multi guest</div>{{SCRIPT}}</body></html>"
    )
    style_css = "#guest{color:rgb(1,2,3)}"
    sdk_js = guest
    pack_dir = BASE / "pack"
    pack_dir.mkdir(parents=True)
    assets = {"index.html": entry_html, "style.css": style_css, "sdk.js": sdk_js}
    for name, content in assets.items():
        (pack_dir / name).write_text(content, encoding="utf-8")
    manifest = {
        "id": PACK_ID, "name": "T19 Multi Asset Pack", "version": PACK_VERSION, "apiVersion": 1,
        "capabilities": ["context.read"], "entry": {"html": "index.html"}, "commands": [],
        "assets": [
            {"path": name, "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest()}
            for name, content in assets.items()
        ],
    }
    (pack_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 2) 运行
    data_root = BASE / "data"
    data_root.mkdir(parents=True)
    probe = BASE / "probe"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({
        "S1_PROBE_DIR": str(probe), "S1_SCENARIO": "t19", "S1_OPEN_T19": "1",
        "S1_PACK_ROOT": str(data_root), "S1_PACK_SEED_PACK_DIR": str(pack_dir),
    })
    p = subprocess.Popen([str(EXE)], env=env)
    results = None
    end = time.time() + 180
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
    assets_loaded = r.get("assetsLoaded") or []
    installed = data_root / "packs" / PACK_ID / PACK_VERSION
    print("multi results:", json.dumps(r, ensure_ascii=False)[:1400], flush=True)

    check("W-T19M-1 setup 从真实包目录安装 3 资产（哈希校验）", "pack-seeded-from-dir" in events,
          [ln for ln in events.splitlines() if "pack-seeded" in ln])
    check("W-T19M-2 已安装包完整落盘（manifest/css/js/entry）",
          all((installed / n).exists() for n in assets) and (installed / "manifest.json").exists(),
          sorted(x.name for x in installed.iterdir()) if installed.exists() else None)
    check("W-T19M-3 entry/css/js 多资源从已安装包加载",
          assets_loaded == ["index.html", "style.css", "sdk.js"] or
          (sorted(assets_loaded) == ["index.html", "sdk.js", "style.css"]),
          {"assetsLoaded": assets_loaded, "entryBytes": r.get("entryBytes"), "err": r.get("entryError")})
    check("W-T19M-4 host+guest 握手 + 只读 snapshot",
          guest.get("phase") == "t19-guest-done" and guest.get("handshakeAccepted") == ["context.read"]
          and (guest.get("snapshot") or {}).get("revision") == 1,
          {"phase": guest.get("phase"), "hs": guest.get("handshakeAccepted"), "snap": guest.get("snapshot")})
    check("W-T19M-5 guest 心跳到达宿主（用于崩溃检测）", (r.get("heartbeatCount") or 0) > 0,
          {"heartbeatCount": r.get("heartbeatCount"), "iframeRemoved": r.get("iframeRemovedForCrash")})
    check("W-T19M-6 iframe 移除后宿主**自动检测**崩溃（心跳超时）并 suspended",
          (r.get("autoDetectedCrashes") or 0) >= 1 and r.get("autoCrashState") == "suspended"
          and diag.get("heartbeatCount", 0) > 0,
          {"autoDetected": r.get("autoDetectedCrashes"), "state": r.get("autoCrashState")})
    check("W-T19M-7 超限 → failed + deactivate + recover + safeMode",
          r.get("overLimitState") == "failed" and diag.get("deactivateCalls", 0) >= 1
          and diag.get("recoverCalls", 0) >= 1 and r.get("safeMode") is True,
          {"state": r.get("overLimitState"), "deactivate": diag.get("deactivateCalls"),
           "recover": diag.get("recoverCalls"), "safeMode": r.get("safeMode")})
    check("W-T19M-8 真实 WebView2/Windows 环境", "Edg/" in str(r.get("ua", "")) and data_root.exists(),
          {"ua": str(r.get("ua"))[:70]})

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE), "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
        "raw_results": results,
    }
    out = EVID / "T19-multiasset-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
