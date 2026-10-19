# -*- coding: utf-8 -*-
"""P5-T26 W04 产品 W 探针：外部开发者脚手架（create_pack.mjs）→ 签名 → 产品安装/启用 guest。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websocket  # websocket-client

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE = Path(r"C:\ke-tmp\uiws-t26-w04")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
CDP_PORT = 8930 + (os.getpid() % 60)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"
SCAFFOLD = REPO / "docs" / "ui-workshop" / "tools" / "create_pack.mjs"
PACK_ID = "com.demo.w04"


def real_folder(name: str) -> Path:
    out = subprocess.run(["powershell", "-NoProfile", "-Command", f"[Environment]::GetFolderPath('{name}')"],
                         capture_output=True, text=True)
    return Path(out.stdout.strip()) if out.stdout.strip() else Path(os.environ.get("APPDATA", "."))


def user_pid() -> str:
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
        "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
        capture_output=True, text=True)
    return out.stdout.strip()


def cleanup() -> None:
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue; "
          "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' -or $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)


def targets():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=120, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + 180
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr: str) -> object:
        return (self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}).get("result") or {}).get("value")


def invoke(cdp: CDP, cmd: str, payload: dict) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    return cdp.eval(expr)  # type: ignore[return-value]


def click_text(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")); if(b){b.click(); return true;} return false; })()"))


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)

    if not EXE.exists():
        print(f"缺少测试构建: {EXE}")
        return 2
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    cleanup()
    for f in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(f) / "com.astranota.uiws.e2e", ignore_errors=True)
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(json.dumps({"recent_workspaces": [str(ws)], "recent_documents": []}), encoding="utf-8")
    (ke_cfg / "settings.json").write_text(json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8")

    # 1) 外部开发者脚手架（不修改宿主源码）
    pack = BASE / "pack"
    scaffold = subprocess.run([NODE, str(SCAFFOLD), "--dir", str(pack), "--id", PACK_ID, "--name", "W04 Scaffold",
                               "--version", "1.0.0", "--capability", "ui.shell"],
                              capture_output=True, text=True)
    files = {p.name for p in pack.glob("*")} if pack.exists() else set()
    check("W-T26-W04-1 外部脚手架生成包（manifest/index/README）",
          scaffold.returncode == 0 and {"manifest.json", "index.html", "README.md"} <= files, {"code": scaffold.returncode, "files": sorted(files)})
    manifest = json.loads((pack / "manifest.json").read_text(encoding="utf-8"))
    check("W-T26-W04-2 脚手架 manifest 合法（id/apiVersion/entry/assets）",
          manifest.get("id") == PACK_ID and manifest.get("apiVersion") == 1 and manifest.get("entry", {}).get("html") == "index.html"
          and manifest.get("assets"), manifest)

    # 2) 外部签名（发布密钥自持；宿主配置公钥）
    key = BASE / "release.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    sign = subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                          capture_output=True, text=True)
    check("W-T26-W04-3 外部签名成功（不依赖宿主源码修改）", sign.returncode == 0, {"code": sign.returncode})

    env = {**os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
           "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": pub}}),
           "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}"}
    log = (BASE / "app.log").open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    try:
        end = time.time() + 90
        while time.time() < end:
            mains = [t for t in targets() if t.get("type") == "page" and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")]
            if mains:
                cdp = CDP(mains[0]["webSocketDebuggerUrl"])
                break
            time.sleep(0.2)
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        for _ in range(300):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.1)
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-W04-4 产品安装外部签名包（signature valid）", inst.get("ok") is True, inst)
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
        check("W-T26-W04-5 外部包 guest 启用 active（无需宿主源码修改）", active, {"active": active})
        status = invoke(cdp, "workshop_pack_session_status", {})
        check("W-T26-W04-6 会话状态 active / 能力子集",
              ((status or {}).get("value") or {}).get("state") == "active"
              and ((status or {}).get("value") or {}).get("capabilities") == ["ui.shell"], status)
        check("W-T26-W04-7 主进程存活 / 用户实例未运行（N/A）", proc.poll() is None, {"user_pid": user_pid() or "(not running)"})
    finally:
        if cdp:
            try:
                cdp.ws.close()
            except Exception:
                pass
        try:
            proc.terminate(); proc.wait(timeout=8)
        except Exception:
            try: proc.kill()
            except Exception: pass
        cleanup(); log.close()

    summary = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "scenario": "T26 W04 外部开发者路径（脚手架→签名→安装→启用）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out = EVID / "T26-W04-sdk-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
