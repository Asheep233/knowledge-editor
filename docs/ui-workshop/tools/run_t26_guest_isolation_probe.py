# -*- coding: utf-8 -*-
"""P5-T26 A7 安全核对：guest（workshop 自定义协议 origin）内是否可以访问 Tauri IPC。

关键：ADR-001 发现「iframe 继承 __TAURI_INTERNALS__」；必须验证**独立 origin iframe 内的 guest**
能否直接调用 app 命令（若可以 → 隔离失败，A7/A5 结论无效）。
方法：CDP Runtime.enable → 枚举 executionContext（找 origin=workshop.localhost）→ 在该上下文
执行 `typeof window.__TAURI_INTERNALS__`，并尝试 invoke 只读命令（workshop_pack_list）。
"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-isolation")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26iso"
CDP_PORT = 9520 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"


def sha(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def real_folder(name: str) -> Path:
    out = subprocess.run(["powershell", "-NoProfile", "-Command", f"[Environment]::GetFolderPath('{name}')"],
                         capture_output=True, text=True)
    return Path(out.stdout.strip()) if out.stdout.strip() else Path(os.environ.get("APPDATA", "."))


def user_pid() -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
        capture_output=True, text=True)
    return out.stdout.strip()


def cleanup() -> None:
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue; "
          "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' -or $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)


def cdp_targets():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=2) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []


class CDP:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=30, suppress_origin=True)
        self.seq = 0

    def send(self, method: str, params: dict | None = None) -> int:
        self.seq += 1
        self.ws.send(json.dumps({"id": self.seq, "method": method, "params": params or {}}))
        return self.seq

    def wait(self, mid: int) -> dict:
        end = time.time() + 60
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(mid)

    def call(self, method: str, params: dict | None = None) -> dict:
        return self.wait(self.send(method, params))

    def eval(self, expression: str, context_id: int | None = None) -> object:
        params: dict = {"expression": expression, "returnByValue": True, "awaitPromise": True}
        if context_id is not None:
            params["contextId"] = context_id
        res = self.call("Runtime.evaluate", params)
        return (res.get("result") or {}).get("value")


def main() -> int:
    checks: list[dict] = []
    contexts: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:320], flush=True)

    if not EXE.exists():
        print(f"缺少测试构建: {EXE}")
        return 2
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    cleanup()
    for folder in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(folder) / "com.astranota.uiws.e2e", ignore_errors=True)
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)

    # workspace + signed pack
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    (ws / "Articles" / "hello.md").write_text("---\ntitle: hello\n---\n\niso\n", encoding="utf-8")
    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    entry = """<!doctype html><html><body>
<script>
(function(){
  var report = { type: 'iso-probe', origin: location.origin, href: location.href,
    hasInternals: typeof window.__TAURI_INTERNALS__ !== 'undefined',
    invokeType: typeof (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) };
  function send(){ try { window.parent.postMessage(report, '*'); } catch(e) {} }
  send();
  if (report.invokeType === 'function') {
    var settled = false;
    var timer = setTimeout(function(){ if(!settled){ settled = true; report.invokeResult = 'timeout'; window.parent.postMessage(report, '*'); } }, 1500);
    try {
      window.__TAURI_INTERNALS__.invoke('workshop_pack_list', {}).then(function(r){
        settled = true; clearTimeout(timer); report.invokeResult = 'callable'; report.result = r; window.parent.postMessage(report, '*');
      }).catch(function(e){
        settled = true; clearTimeout(timer); report.invokeResult = 'blocked'; report.error = String(e && e.message || e); window.parent.postMessage(report, '*');
      });
    } catch(e) {
      settled = true; clearTimeout(timer); report.invokeResult = 'sync-error'; report.error = String(e && e.message || e); window.parent.postMessage(report, '*');
    }
  } else {
    report.invokeResult = 'absent'; window.parent.postMessage(report, '*');
  }
  setInterval(function(){ window.parent.postMessage({type:'guest-heartbeat'},'*'); send(); }, 300);
})();
</script>
<button onclick="window.parent.postMessage({type:'iso-probe', click:'ok'},'*')">probe</button>
</body></html>"""
    (pack / "index.html").write_bytes(entry.encode("utf-8"))  # 避免 Windows 文本模式 CRLF 转换导致哈希不匹配
    manifest = {"id": PACK_ID, "name": "Iso Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell", "context.read"], "entry": {"html": "index.html"},
                "commands": [], "assets": [{"path": "index.html", "sha256": sha(entry)}]}
    (pack / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)

    env = dict(os.environ)
    env["APPDATA"] = str(appdata)
    env["KE_WORKSPACE"] = str(ws)
    env["KE_WORKSHOP_PUBKEYS"] = json.dumps({"k1": {"key": pub}})
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={CDP_PORT}"
    log = (BASE / "app.log").open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    try:
        end = time.time() + 60
        while time.time() < end:
            targets = [t for t in cdp_targets() if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
            main_t = [t for t in targets if "tauri.localhost" in str(t.get("url", ""))]
            if main_t:
                cdp = CDP(main_t[0]["webSocketDebuggerUrl"])
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
        inst = cdp.eval("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke('workshop_pack_install', {sourceDir: " + json.dumps(str(pack)) + "}); return {ok:true, r}; } catch(e) { return {ok:false, error:String(e && e.message || e)}; } })()")
        (BASE / "diag-install.json").write_text(json.dumps(inst, ensure_ascii=False, indent=2), encoding="utf-8")
        print("install:", inst, flush=True)
        # 打开工坊 + 授予 trusted（先不开 guest，等监听器就绪）
        for text in ("创意工坊", "授予信任"):
            cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes(" + json.dumps(text) + ")); if(b) b.click(); return !!b; })()")
            time.sleep(1.0)
        (BASE / "diag-before-guest.txt").write_text(str(cdp.eval("document.body.innerText || ''")), encoding="utf-8")
        for _ in range(60):
            if cdp.eval("!!document.querySelector('iframe')"):
                break
            time.sleep(0.25)
        # 由 guest 自身 postMessage 报告其 origin / Tauri IPC 可达性（最直接、无跨域读取）
        cdp.eval("window.__isoProbe = null; window.addEventListener('message', function(e){ if (e && e.data && e.data.type === 'iso-probe') window.__isoProbe = e.data; });")
        cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('启用 guest')); if(b) b.click(); return !!b; })()")
        time.sleep(2.5)
        iso = cdp.eval("window.__isoProbe || null")
        check("W-T26-A7-ISO-1 guest 已启用且 iframe 加载", bool(cdp.eval("!!document.querySelector('iframe')")) and isinstance(iso, dict), {"iframe": bool(cdp.eval("!!document.querySelector('iframe')"))})
        for _ in range(20):
            if isinstance(iso, dict) and iso.get("invokeResult"):
                break
            time.sleep(0.3)
            iso = cdp.eval("window.__isoProbe || null")
        print("iso:", json.dumps(iso, ensure_ascii=False)[:600], flush=True)
        (BASE / "diag-after-guest.txt").write_text(str(cdp.eval("document.body.innerText || ''")), encoding="utf-8")
        check("W-T26-A7-ISO-2 guest 自报 origin 为 workshop.localhost", isinstance(iso, dict) and "workshop.localhost" in str(iso.get("origin", "")), iso)
        check("W-T26-A7-ISO-3 guest 的 Tauri invoke 不可用（独立 origin + remote IPC 未生效）",
              isinstance(iso, dict) and iso.get("invokeResult") in ("absent", "blocked", "timeout", "sync-error"),
              {"hasInternals": (iso or {}).get("hasInternals"), "invokeResult": (iso or {}).get("invokeResult")})
        # 枚举执行上下文（诊断保留）
        cdp.send("Runtime.enable")
        time.sleep(0.5)
        cdp.eval("(() => { const f=document.querySelector('iframe'); if(f){ f.src = f.src; } return true; })()")
        time.sleep(1.5)
        while True:
            cdp.ws.settimeout(0.5)
            try:
                msg = json.loads(cdp.ws.recv())
            except Exception:
                break
            if msg.get("method") == "Runtime.executionContextCreated":
                ctx = (msg.get("params") or {}).get("context") or {}
                contexts.append({"id": ctx.get("id"), "origin": ctx.get("origin"), "name": ctx.get("name"), "auxData": ctx.get("auxData")})
        cdp.ws.settimeout(30)
        (BASE / "contexts.json").write_text(json.dumps(contexts, ensure_ascii=False, indent=2), encoding="utf-8")
        guest_ctxs = [c for c in contexts if "workshop.localhost" in str(c.get("origin", ""))]
        # OOPIF 备选：自定义协议 iframe 可能是独立 target（/json/list 中可见）
        guest_page_target = None
        for t in cdp_targets():
            if t.get("type") == "page" and "workshop.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl"):
                guest_page_target = t["webSocketDebuggerUrl"]
                break
        print("ctx diagnostic:", json.dumps({"contexts": contexts[:8], "guest": guest_ctxs}, ensure_ascii=False)[:400], flush=True)
        guest = guest_ctxs[0] if guest_ctxs else None
        if guest_page_target:
            try:
                guest_cdp = CDP(guest_page_target)
                own = guest_cdp.eval("typeof window.__TAURI_INTERNALS__")
                probe = guest_cdp.eval(
                    "(async () => { try { const inv = window.__TAURI_INTERNALS__?.invoke;"
                    " if (typeof inv !== 'function') return {invoke: 'absent'};"
                    " const r = await inv('workshop_pack_list', {}); return {invoke: 'callable', result: r}; }"
                    " catch (e) { return {invoke: 'blocked', error: String(e && e.message || e)}; } })()"
                )
                guest_cdp.ws.close()
                guest = {"id": "oopif-target", "origin": "http://workshop.localhost"}
            except Exception as e:
                own, probe = None, {"targetError": str(e)}
        elif guest:
            own = cdp.eval("typeof window.__TAURI_INTERNALS__", guest["id"])
            probe = cdp.eval(
                "(async () => { try { const inv = window.__TAURI_INTERNALS__?.invoke;"
                " if (typeof inv !== 'function') return {invoke: 'absent'};"
                " const r = await inv('workshop_pack_list', {}); return {invoke: 'callable', result: r}; }"
                " catch (e) { return {invoke: 'blocked', error: String(e && e.message || e)}; } })()",
                guest["id"],
            )
            check("W-T26-A7-ISO-3 guest 内不可访问 Tauri IPC（隔离成立）",
                  own in ("undefined", None) and isinstance(probe, dict) and probe.get("invoke") in ("absent", "blocked"),
                  {"typeofInternals": own, "probe": probe})
        check("W-T26-A7-ISO-4 主进程存活", proc.poll() is None, proc.poll())
        check("W-T26-A7-ISO-5 用户实例未受影响", user_pid().isdigit(), {"user_pid": user_pid()})
    finally:
        if cdp:
            try:
                cdp.ws.close()
            except Exception:
                pass
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        cleanup()
        log.close()

    summary = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "scenario": "T26 A7 guest 隔离核对（Tauri IPC 可达性）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
               "contexts": contexts}
    out = EVID / "T26-A7-isolation-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
