# -*- coding: utf-8 -*-
"""P5-T26 W09 性能基线（部分）：大文档打开/输入延迟、guest 打开成本、无双编辑器复制。"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-perf")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26perf"
CDP_PORT = 9830 + (os.getpid() % 100)
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
        end = time.time() + 120
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

    # 大文档 fixtures：256KB / 512KB（README 正文重复 + 段落）
    def make_doc(name: str, target: int) -> Path:
        path = ws / "Articles" / name
        title = name.removesuffix(".md")
        body_parts = ["---\ntitle: %s\n---\n\n" % title]
        i = 0
        while sum(len(p) for p in body_parts) < target:
            body_parts.append(f"## 章节 {i}\n\n第 {i} 段：Markdown 性能基线测试内容，公式 $x_{i}^2 + y_{i}^2 = z_{i}^2$。\n\n")
            i += 1
        path.write_text("".join(body_parts), encoding="utf-8")
        return path

    doc256 = make_doc("perf256.md", 256 * 1024)
    doc512 = make_doc("perf512.md", 512 * 1024)

    # 签名包（guest 打开成本）
    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    entry = "<!doctype html><html><body><script>setInterval(()=>window.parent.postMessage({type:'guest-heartbeat'},'*'),200);</script></body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 Perf Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
                "assets": [{"path": "index.html", "sha256": sha(entry)}]}
    (pack / "manifest.json").write_bytes(json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)

    env = {**os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
           "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": pub}}),
           "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}"}
    log = (BASE / "app.log").open("w", encoding="utf-8")
    t0 = time.time()
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
        for _ in range(200):
            if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                break
            time.sleep(0.1)
        for _ in range(200):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.1)
        startup_ms = int((time.time() - t0) * 1000)
        check("W-T26-W09-1 启动到主 UI 就绪（< 30s）", startup_ms < 30000, {"startupMs": startup_ms})

        def open_doc(name: str, expect_bytes: int) -> tuple[int, int]:
            click_text(cdp, name)
            start = time.time()
            appeared = False
            for _ in range(600):
                if cdp.eval("!!document.querySelector('.ProseMirror')"):
                    appeared = True
                    break
                time.sleep(0.1)
            ms = int((time.time() - start) * 1000)
            if not appeared:
                return ms, 0
            size = int(cdp.eval("(document.querySelector('.ProseMirror')?.textContent || '').length") or 0)
            return ms, size

        try:
            t256, len256 = open_doc("perf256", 256 * 1024)
            check("W-T26-W09-2 打开 256KB 文档（< 5s）", len256 > 0 and t256 < 5000, {"ms": t256, "chars": len256})
        except Exception as e:
            check("W-T26-W09-2 打开 256KB 文档（< 5s）", False, {"error": f"renderer unresponsive: {e}"})
            t256 = len256 = None
        try:
            t512, len512 = open_doc("perf512", 512 * 1024)
            check("W-T26-W09-3 打开 512KB 文档（< 8s）", len512 > 0 and t512 < 8000, {"ms": t512, "chars": len512})
        except Exception as e:
            check("W-T26-W09-3 打开 512KB 文档（< 8s）", False, {"error": f"renderer unresponsive: {e}"})
        editors = int(cdp.eval("document.querySelectorAll('.ProseMirror').length") or 0)
        check("W-T26-W09-4 无双编辑器复制（ProseMirror 实例数=1）", editors == 1, {"editors": editors})

        # 输入延迟：512KB 文档尾部插入 20 个字符，测量总耗时/字符
        cdp.eval("(() => { const el=document.querySelector('.ProseMirror'); el.focus(); const sel=window.getSelection();"
                 " sel.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.addRange(r); return true; })()")
        start = time.time()
        for ch in "W09PERFTESTW09PERF1":
            cdp.call("Input.insertText", {"text": ch})
        typing_ms = int((time.time() - start) * 1000)
        per_char = typing_ms / 18
        check("W-T26-W09-5 大文档输入延迟（≤ 50ms/字符）", per_char <= 50, {"totalMs": typing_ms, "perCharMs": round(per_char, 2)})

        # guest 打开成本
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
        guest_ms = int((time.time() - gstart) * 1000)
        check("W-T26-W09-6 启用 guest 成本（< 3s）", inst.get("ok") is True and active and guest_ms < 3000,
              {"ms": guest_ms, "active": active})
        check("W-T26-W09-7 主进程存活 / 用户实例未受影响",
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
               "scenario": "T26 W09 性能基线（部分）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out = EVID / "T26-W09-perf-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
