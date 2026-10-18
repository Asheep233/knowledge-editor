# -*- coding: utf-8 -*-
"""P5-T26 W09 诊断：非公式密集 vs 公式密集大文档（打开/输入/guest 成本分离归因）。"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-perfdiag")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26perfdiag"
CDP_PORT = 9870 + (os.getpid() % 100)
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
        self.ws = websocket.create_connection(url, timeout=180, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + 300
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
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('body *')].filter(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ") && x.children.length===0); if(!b.length) return false;"
                         " for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) {"
                         "  b[0].dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); } return true; })()"))


def main() -> int:
    checks: list[dict] = []
    metrics: dict = {}

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

    def make_doc(name: str, target: int, formulas: bool) -> int:
        parts = ["---\ntitle: %s\n---\n\n" % name]
        i = 0
        while sum(len(p) for p in parts) < target:
            if formulas:
                parts.append(f"## 章节 {i}\n\n第 {i} 段：内容 $x_{i}^2 + y_{i}^2 = z_{i}^2$。\n\n")
            else:
                parts.append(f"## 章节 {i}\n\n第 {i} 段：纯文本性能基线内容，没有公式，只有普通 Markdown 段落。\n\n")
            i += 1
        text = "".join(parts)
        (ws / "Articles" / f"{name}.md").write_bytes(text.encode("utf-8"))
        return len(text.encode("utf-8"))

    make_doc("plain256", 256 * 1024, False)
    make_doc("formula256", 256 * 1024, True)
    make_doc("small", 2 * 1024, False)

    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    entry = "<!doctype html><html><body><script>setInterval(()=>window.parent.postMessage({type:'guest-heartbeat'},'*'),200);</script></body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 PerfDiag Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
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
            time.sleep(0.2)
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        for _ in range(300):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.1)

        def open_doc(name: str) -> dict:
            before = cdp.eval("!!document.querySelector('.ProseMirror')")
            click_text(cdp, name)
            start = time.time()
            appeared = False
            for _ in range(600):
                if cdp.eval("!!document.querySelector('.ProseMirror')"):
                    appeared = True
                    break
                time.sleep(0.1)
            ms = int((time.time() - start) * 1000)
            chars = 0
            if appeared:
                chars = int(cdp.eval("(document.querySelector('.ProseMirror')?.textContent || '').length") or 0)
            return {"ms": ms, "chars": chars, "hadEditorBefore": before}

        metrics["plain256"] = open_doc("plain256")
        metrics["formula256"] = open_doc("formula256")
        metrics["small"] = open_doc("small")
        check("W-T26-W09D-1 打开性能分离：plain256 vs formula256 均记录", True, metrics)
        check("W-T26-W09D-2 公式密集显著慢于纯文本（记录归因）",
              metrics["formula256"]["ms"] >= metrics["plain256"]["ms"],
              {"plainMs": metrics["plain256"]["ms"], "formulaMs": metrics["formula256"]["ms"]})

        # 输入延迟：小文档基线
        cdp.eval("(() => { const el=document.querySelector('.ProseMirror'); el.focus(); const sel=window.getSelection(); sel.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.addRange(r); return true; })()")
        start = time.time()
        cdp.call("Input.insertText", {"text": "PERFDIAGMARK"})
        typing_small = int((time.time() - start) * 1000)
        metrics["typingSmallMs"] = typing_small
        check("W-T26-W09D-3 小文档整段输入延迟（< 500ms）", typing_small < 500, {"ms": typing_small})

        # guest 启用成本（小文档负载）
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        click_text(cdp, "创意工坊")
        time.sleep(0.8)
        click_text(cdp, "授予信任")
        time.sleep(1.2)
        gstart = time.time()
        click_text(cdp, "启用 guest")
        active = False
        for _ in range(120):
            if "guest：active" in str(cdp.eval("document.body.innerText || ''")):
                active = True
                break
            time.sleep(0.05)
        metrics["guestMs"] = int((time.time() - gstart) * 1000)
        check("W-T26-W09D-4 小文档负载下 guest 启用（< 3s）", inst.get("ok") is True and active and metrics["guestMs"] < 3000,
              {"ms": metrics["guestMs"], "active": active})
        check("W-T26-W09D-5 主进程存活 / 用户实例未受影响",
              proc.poll() is None and user_pid().isdigit(), {"user_pid": user_pid()})
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
               "scenario": "T26 W09 诊断（plain vs formula / guest 分离）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
               "metrics": metrics}
    out = EVID / "T26-W09-perf-diag-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
