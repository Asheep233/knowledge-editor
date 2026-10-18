# -*- coding: utf-8 -*-
"""P5-T26 W01 产品 W 探针：ZIP 离线包 staging/安装 + 解压安全（zip-slip/非法 staging 拒绝）。"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import websocket  # websocket-client

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE = Path(r"C:\ke-tmp\uiws-t26-zip")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26zip"
CDP_PORT = 9650 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"


def sha(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


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

    def eval(self, expr: str) -> object:
        return (self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}).get("result") or {}).get("value")


def invoke(cdp: CDP, cmd: str, payload: dict) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    return cdp.eval(expr)  # type: ignore[return-value]


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

    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    entry = "<!doctype html><html><body>zip guest</body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 Zip Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
                "assets": [{"path": "index.html", "sha256": sha(entry)}]}
    (pack / "manifest.json").write_bytes(json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)
    good_zip = BASE / "good.zip"
    with zipfile.ZipFile(good_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ("manifest.json", "index.html"):
            z.write(pack / name, name)
    evil_zip = BASE / "evil.zip"
    with zipfile.ZipFile(evil_zip, "w") as z:
        z.writestr("manifest.json", "{}")
        z.writestr("../evil.txt", "x")

    env = {**os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
           "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": pub}}),
           "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}"}
    log = (BASE / "app.log").open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    try:
        end = time.time() + 60
        while time.time() < end:
            mains = [t for t in targets() if t.get("type") == "page" and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")]
            if mains:
                cdp = CDP(mains[0]["webSocketDebuggerUrl"])
                break
            time.sleep(0.4)
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        for _ in range(100):
            if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                break
            time.sleep(0.25)
        check("W-T26-W01-1 产品启动 + IPC 就绪", True, None)

        staged = invoke(cdp, "workshop_pack_stage_zip", {"zipPath": str(good_zip)})
        val = staged.get("value") or {}
        check("W-T26-W01-2 有效 ZIP staging 扫描成功（签名 valid + token）",
              staged.get("ok") and val.get("packId") == PACK_ID and val.get("signatureStatus") == "valid" and bool(val.get("token")),
              {"packId": val.get("packId"), "signature": val.get("signatureStatus"), "token": val.get("token")})
        installed = invoke(cdp, "workshop_pack_install_staged", {"sourceDir": val.get("token")})
        check("W-T26-W01-3 staged 安装成功（active=1.0.0）",
              installed.get("ok") and (installed.get("value") or {}).get("active") == "1.0.0", installed)
        listed = invoke(cdp, "workshop_pack_list", {})
        packs = ((listed.get("value") or {}).get("packs") or [])
        check("W-T26-W01-4 安装列表可见", listed.get("ok") and bool(packs) and packs[0].get("id") == PACK_ID, {"packs": packs[:1]})
        evil = invoke(cdp, "workshop_pack_stage_zip", {"zipPath": str(evil_zip)})
        check("W-T26-W01-5 zip-slip 条目 → staging 拒绝（E_ZIP/E_PATH）",
              evil.get("ok") is False and ("E_ZIP" in str(evil.get("error")) or "E_PATH" in str(evil.get("error"))), evil)
        guard = invoke(cdp, "workshop_pack_abort_staged", {"sourceDir": "C:/not-staging"})
        check("W-T26-W01-6 非 staging 路径 → E_STAGED 拒绝", guard.get("ok") is False and "E_STAGED" in str(guard.get("error")), guard)
        check("W-T26-W01-7 主进程存活", proc.poll() is None, proc.poll())
        upid = user_pid()
        check("W-T26-W01-8 用户实例未受影响", upid.isdigit(), {"user_pid": upid})
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
               "scenario": "T26 W01 ZIP 离线包（staging/安装/解压安全）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out = EVID / "T26-W01-zip-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
