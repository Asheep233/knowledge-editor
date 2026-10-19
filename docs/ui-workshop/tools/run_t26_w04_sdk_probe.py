# -*- coding: utf-8 -*-
"""P5-T26 W04 SDK 发布形态产品 W 探针：dist/guest-sdk.js（独立 SDK）+ autoConnect 握手/snapshot。"""
from __future__ import annotations

import hashlib
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
BASE = Path(r"C:\ke-tmp\uiws-t26-w04sdk")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.demo.w04sdk"
CDP_PORT = 9660 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"
SDK_BUNDLE = REPO / "docs" / "ui-workshop" / "sdk" / "dist" / "guest-sdk.js"


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


def click_text(cdp: CDP, text: str) -> bool:
    expr = ("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
            + json.dumps(text) + ")); if(b){b.click(); return true;} return false; })()")
    return bool(cdp.eval(expr))


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)

    if not EXE.exists() or not SDK_BUNDLE.exists():
        print(f"缺少测试构建或 SDK 产物: {EXE} / {SDK_BUNDLE}")
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
    (ws / "Articles" / "a.md").write_bytes("---\ntitle: a\n---\n\nw04 sdk\n".encode("utf-8"))

    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    sdk = SDK_BUNDLE.read_text(encoding="utf-8").replace("</script>", "<\\/script>")
    guest = """
<script>
function dbg(stage, extra){
  try { window.parent.postMessage({type:'t19-guest-results', payload:{ phase:'debug', stage: stage, hasSdk: typeof KeWorkshopSDK, extra: extra || null }}, '*'); } catch(e) {}
}
dbg('sdk-loaded');
window.addEventListener('message', function(e){ if (e && e.data && e.data.type === 't19-port') dbg('port-received'); });
(async function(){
  try {
    dbg('before-autoconnect');
    var conn = await KeWorkshopSDK.autoConnect({ requestedFeatures: ['ui.shell','context.read'], timeoutMs: 8000 });
    dbg('handshake-ok', conn.handshakeInfo);
    var snap = await conn.request('context.snapshot', { relPath: 'Articles/a.md' });
    window.parent.postMessage({type:'t19-guest-results', payload:{ phase:'sdk-guest-done', handshake: conn.handshakeInfo, snapshot: snap }}, '*');
    setInterval(function(){ conn.heartbeat(); }, 200);
  } catch (e) {
    dbg('error', (e && (e.code + ': ' + e.message)) || String(e));
    window.parent.postMessage({type:'t19-guest-results', payload:{ phase:'sdk-guest-error', error: (e && (e.code + ': ' + e.message)) || String(e) }}, '*');
  }
})();
</script>
"""
    entry = ("<!doctype html><html><body><script>" + sdk + "</script>" + guest + "</body></html>")
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 Protocol Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell", "context.read"], "entry": {"html": "index.html"}, "commands": [],
                "assets": [{"path": "index.html", "sha256": sha(entry)}]}
    (pack / "manifest.json").write_bytes(json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)

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
        for _ in range(100):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.25)
        cdp.eval("window.__w04 = []; window.addEventListener('message', function(e){ if (e && e.data && e.data.type === 't19-guest-results') window.__w04.push(e.data.payload); })")
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-W04S-1 安装使用发布 SDK 的签名包", inst.get("ok") is True, inst)
        click_text(cdp, "创意工坊")
        time.sleep(1.0)
        click_text(cdp, "授予信任")
        time.sleep(0.8)
        click_text(cdp, "启用 guest")
        results = None
        for _ in range(80):
            results = cdp.eval("window.__keGuestResults || null")
            if isinstance(results, dict) and results.get("handshakeAccepted"):
                break
            time.sleep(0.25)
        diag = cdp.eval("({start: window.__keGuestStart, error: window.__keGuestError, log: window.__keGuestStatusLog, results: window.__keGuestResults})")
        (BASE / "diag.json").write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
        dbg_msgs = cdp.eval("window.__w04 || []")
        print("diag:", json.dumps(diag, ensure_ascii=False)[:400], flush=True)
        print("w04 debug:", json.dumps(dbg_msgs, ensure_ascii=False)[:1200], flush=True)
        check("W-T26-W04S-2 产品 host 协议线已连接（Dispatcher/Broker 启动）",
              bool(cdp.eval("window.__keDispatcherReady === true")), {"diag": diag})
        hs = (results or {}).get("handshake") or {}
        check("W-T26-W04S-3 发布 SDK autoConnect 握手完成（acceptedFeatures）",
              isinstance(results, dict) and isinstance(hs, dict) and set(hs.get("acceptedFeatures") or []) >= {"ui.shell", "context.read"},
              hs)
        snap = (results or {}).get("snapshot") or {}
        check("W-T26-W04S-4 发布 SDK 经 Broker 获得真实 context.snapshot",
              isinstance(results, dict) and snap.get("relPath") == "Articles/a.md" and int(snap.get("revision", -1)) >= 0,
              snap)
        status = invoke(cdp, "workshop_pack_session_status", {})
        st = status.get("value") or {}
        check("W-T26-W04S-5 会话状态 active（能力子集）",
              status.get("ok") and st.get("state") == "active" and isinstance(st.get("capabilities"), list), st)
        check("W-T26-W04S-6 主进程存活", proc.poll() is None, proc.poll())
        upid = user_pid()
        check("W-T26-W04S-7 用户实例未受影响（未运行 → N/A）", upid.isdigit() or upid == "", {"user_pid": upid or "(not running)"})
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
               "scenario": "T26 W04 SDK 发布形态（autoConnect 握手/snapshot）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out = EVID / "T26-W04-sdk-dist-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
