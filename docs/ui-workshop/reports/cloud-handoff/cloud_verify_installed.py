# -*- coding: utf-8 -*-
"""云端 VM 安装态 UI 工坊冒烟（CDP）：入口可见性 + 安装签名包 + 信任/启用 guest + 会话 active。

用法示例（在云 VM 上）：
  python cloud_verify_installed.py --exe "C:\\Program Files\\AstraNota\\knowledgeeditor.exe" \
      --expect-entry yes --pack-dir C:\\ke-cloud\\pack --pubkeys '{"k1":{"key":"<hex>"}}' \
      --out C:\\ke-cloud\\evidence\\cloud-workshop-verify.json

说明：隔离 APPDATA/工作区（默认 C:\\ke-cloud\\data），不触碰真实用户数据；进程按自身 PID 清理。
依赖：websocket-client, requests。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

try:
    import websocket  # websocket-client
except Exception as exc:  # pragma: no cover
    print(f"缺少依赖 websocket-client: {exc}\n请 pip install websocket-client requests", file=sys.stderr)
    raise SystemExit(2)


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=30, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + 60
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr: str):
        return (self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
                .get("result") or {}).get("value")


def targets(port: int):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


def invoke(cdp: CDP, cmd: str, payload: dict) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    return cdp.eval(expr)


def click_text(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")); if(b){b.click(); return true;} return false; })()"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--expect-entry", choices=["yes", "no"], default="yes")
    ap.add_argument("--port", type=int, default=9333)
    ap.add_argument("--data-dir", default=r"C:\ke-cloud\data")
    ap.add_argument("--pack-dir", default="")
    ap.add_argument("--pubkeys", default="")
    ap.add_argument("--out", default=r"C:\ke-cloud\evidence\cloud-workshop-verify.json")
    args = ap.parse_args()

    exe = Path(args.exe)
    base = Path(args.data_dir)
    checks: list[dict] = []

    def check(name: str, ok: bool, detail=None) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)

    if not exe.exists():
        check("安装产物存在", False, str(exe))
        return 2
    check("安装产物存在", True, str(exe))

    workspace = base / "workspace"
    appdata = base / "appdata"
    ke_dir = appdata / "KnowledgeEditor"
    if base.exists():
        shutil.rmtree(base, ignore_errors=True)
    (workspace / "Articles").mkdir(parents=True)
    ke_dir.mkdir(parents=True)
    (workspace / "Articles" / "a.md").write_text("---\ntitle: cloud\n---\n\ncloud verify\n", encoding="utf-8")
    (ke_dir / "app_config.json").write_text(json.dumps({"recent_workspaces": [str(workspace)], "recent_documents": []}), encoding="utf-8")
    (ke_dir / "settings.json").write_text(json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8")

    env = dict(os.environ)
    env.update({"APPDATA": str(appdata), "KE_WORKSPACE": str(workspace),
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={args.port}"})
    if args.pubkeys:
        env["KE_WORKSHOP_PUBKEYS"] = args.pubkeys
    log = (base / "app.log").open("w", encoding="utf-8")
    proc = subprocess.Popen([str(exe)], env=env, stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    try:
        end = time.time() + 90
        while time.time() < end:
            mains = [t for t in targets(args.port) if t.get("type") == "page"
                     and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")]
            if mains:
                cdp = CDP(mains[0]["webSocketDebuggerUrl"])
                break
            time.sleep(0.4)
        check("安装态产品启动 + CDP 主窗口就绪", cdp is not None, None)
        if cdp is None:
            return 1
        for _ in range(200):
            if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                break
            time.sleep(0.1)
        for _ in range(200):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.1)
        entry_visible = "创意工坊" in str(cdp.eval("document.body.innerText || ''"))
        check(f"工坊入口期望={args.expect_entry} 实测={'yes' if entry_visible else 'no'}",
              entry_visible == (args.expect_entry == "yes"), {"entryVisible": entry_visible})

        if args.expect_entry == "yes" and args.pack_dir:
            inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(Path(args.pack_dir))})
            check("安装签名测试包（signature valid）", inst.get("ok") is True, inst)
            click_text(cdp, "创意工坊")
            for _ in range(80):
                if cdp.eval("(() => [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('启用 guest')))()"):
                    break
                time.sleep(0.25)
            click_text(cdp, "授予信任")
            time.sleep(1.2)
            click_text(cdp, "启用 guest")
            active = False
            for _ in range(120):
                if "guest：active" in str(cdp.eval("document.body.innerText || ''")):
                    active = True
                    break
                time.sleep(0.1)
            status = invoke(cdp, "workshop_pack_session_status", {})
            check("guest 启用后会话 active", active and ((status.get("value") or {}).get("state") == "active"),
                  {"active": active, "status": status})
            click_text(cdp, "停用 guest")
            time.sleep(0.8)
            st = ((invoke(cdp, "workshop_pack_session_status", {}).get("value") or {}).get("state"))
            check("停用 guest 后状态 stopped", st == "stopped", st)
        check("主进程存活（启动/操作无崩溃）", proc.poll() is None, proc.poll())
    finally:
        if cdp:
            try:
                cdp.ws.close()
            except Exception:
                pass
        try:
            proc.terminate(); proc.wait(timeout=10)
        except Exception:
            try: proc.kill()
            except Exception: pass
        # 仅清理自身进程树（不按镜像名杀）
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -eq '{exe}' }} | Stop-Process -Force -ErrorAction SilentlyContinue"],
                       capture_output=True, text=True)
        log.close()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    summary = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "exe": str(exe),
               "expectEntry": args.expect_entry, "checks": checks,
               "passCount": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['passCount']}/{summary['total']} PASS -> {out}")
    return 0 if summary["passCount"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
