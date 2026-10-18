# -*- coding: utf-8 -*-
"""P5-T26 W06 产品 W 探针：guest 执行/网络边界（CSP 网络/worker 阻断 + 能力越权拒绝）。"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-boundary")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26w06"
CDP_PORT = 9740 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"

GUEST = r"""
<script>
(function(){
  var report = { type:'w06-report', origin: location.origin, items: [] };
  function push(name, result, detail){ report.items.push({name:name, result:result, detail:String(detail||'').slice(0,200)}); }
  async function attempt(name, fn){
    try { var r = await fn(); push(name, 'allowed', r); }
    catch(e){ push(name, 'blocked', (e && e.message) || e); }
  }
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 't19-wire' && d.direction === 'host-to-guest' && d.msg && d.msg.requestId === 'w06-write') {
      var m = d.msg;
      push('capability-write', m.ok === false ? 'blocked' : 'allowed', JSON.stringify(m.error || m.result || {}));
    }
  });
  (async function(){
    await attempt('fetch-relative', function(){ return fetch('/api/health').then(function(r){ return r.status; }); });
    await attempt('fetch-loopback', function(){ return fetch('http://127.0.0.1:8000/api/health').then(function(r){ return r.status; }); });
    await attempt('fetch-external', function(){ return fetch('https://example.com/').then(function(r){ return r.status; }); });
    await attempt('worker-blob', function(){ return new Promise(function(resolve, reject){
      try {
        var w = new Worker(URL.createObjectURL(new Blob(['self.postMessage("ok")'], {type:'text/javascript'})));
        var done = false;
        w.onmessage = function(){ done = true; resolve('executed'); };
        w.onerror = function(){ reject('worker-error'); };
        setTimeout(function(){ if(!done) reject('no-execution'); }, 700);
      } catch(e) { reject(e); }
    }); });
    await attempt('websocket-loopback', function(){ return new Promise(function(resolve, reject){
      try {
        var sock = new WebSocket('ws://127.0.0.1:8000/ws');
        sock.onopen = function(){ resolve('connected'); };
        sock.onerror = function(){ reject('ws-error'); };
        setTimeout(function(){ reject('timeout'); }, 700);
      } catch(e) { reject(e); }
    }); });
    window.parent.postMessage({type:'t19-wire', direction:'guest-to-host', msg:{type:'request', requestId:'w06-write', method:'context.write', params:{relPath:'Articles/t19.md', content:'x', expectedRevision:0}}}, '*');
    setTimeout(function(){ window.parent.postMessage(report, '*'); }, 1800);
  })();
})();
</script>
"""


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
    (ws / "Articles" / "t19.md").write_bytes(b"---\ntitle: t19\n---\n\nw06\n")

    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    entry = "<!doctype html><html><body>" + GUEST + "</body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 Boundary Pack", "version": "1.0.0", "apiVersion": 1,
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
        cdp.eval("window.__w06 = null; window.addEventListener('message', function(e){ if (e && e.data && e.data.type === 'w06-report') window.__w06 = e.data; });")
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-W06-1 安装签名包", inst.get("ok") is True, inst)
        for text in ("创意工坊", "授予信任", "启用 guest"):
            click_text(cdp, text)
            time.sleep(1.0)
        report = None
        for _ in range(40):
            report = cdp.eval("window.__w06 || null")
            if isinstance(report, dict) and report.get("items"):
                if any(i.get("name") == "capability-write" for i in report.get("items") or []):
                    break
            time.sleep(0.3)
        items = {i.get("name"): i for i in ((report or {}).get("items") or [])}
        check("W-T26-W06-2 guest origin 为 workshop.localhost", isinstance(report, dict) and "workshop.localhost" in str(report.get("origin")), (report or {}).get("origin"))
        check("W-T26-W06-3 fetch 相对/loopback/外部均被阻断（CSP connect-src none）",
              all(items.get(n, {}).get("result") == "blocked" for n in ("fetch-relative", "fetch-loopback", "fetch-external")),
              {n: items.get(n, {}).get("result") for n in ("fetch-relative", "fetch-loopback", "fetch-external")})
        check("W-T26-W06-4 worker/blob 被阻断", items.get("worker-blob", {}).get("result") == "blocked", items.get("worker-blob"))
        check("W-T26-W06-5 WebSocket 被阻断", items.get("websocket-loopback", {}).get("result") == "blocked", items.get("websocket-loopback"))
        check("W-T26-W06-6 越权 context.write 被 Capability 拒绝（E_CAPABILITY）",
              items.get("capability-write", {}).get("result") == "blocked" and "E_CAPABILITY" in str(items.get("capability-write", {}).get("detail")),
              items.get("capability-write"))
        check("W-T26-W06-7 主进程存活", proc.poll() is None, proc.poll())
        upid = user_pid()
        check("W-T26-W06-8 用户实例未受影响", upid.isdigit(), {"user_pid": upid})
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
               "scenario": "T26 W06 guest 执行/网络边界（CSP + 能力越权）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out = EVID / "T26-W06-boundary-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
