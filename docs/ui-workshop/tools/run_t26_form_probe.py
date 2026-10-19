# -*- coding: utf-8 -*-
"""P5-T26 W02 产品 W 探针：guest 经 Broker command.invoke 提交 title（宿主原子写 meta）+ 未知命令拒绝。"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-form")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26w02"
CDP_PORT = 8990 + (os.getpid() % 60)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"
GUEST_BUNDLE = REPO / "docs" / "ui-workshop" / "core" / "packs" / "probe" / "w02-guest-code.txt"


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

    if not EXE.exists() or not GUEST_BUNDLE.exists():
        print(f"缺少测试构建或 guest bundle: {EXE} / {GUEST_BUNDLE}")
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
    article = ws / "Articles" / "a.md"
    article.write_bytes("---\ntitle: 原标题\n---\n\nW02 form\n".encode("utf-8"))
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(json.dumps({"recent_workspaces": [str(ws)], "recent_documents": []}), encoding="utf-8")
    (ke_cfg / "settings.json").write_text(json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8")

    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    guest = GUEST_BUNDLE.read_text(encoding="utf-8").replace("</script>", "<\\/script>")
    entry = "<!doctype html><html><body><script>" + guest + "</script></body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 W02 Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell", "context.read"], "entry": {"html": "index.html"},
                "commands": [{"name": "article.set-title", "handler": "setTitle"},
                             {"name": "article.set-tags", "handler": "setTags"},
                             {"name": "article.delete", "handler": "delete"}],
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
        cdp.eval("window.__keGuestResults = null")
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-W02-1 安装签名包", inst.get("ok") is True, inst)
        click_text(cdp, "创意工坊")
        for _ in range(60):
            if cdp.eval("(() => [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('启用 guest')))()"):
                break
            time.sleep(0.25)
        click_text(cdp, "授予信任")
        for _ in range(60):
            if cdp.eval("(() => [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('启用 guest')))()"):
                break
            time.sleep(0.25)
        click_text(cdp, "启用 guest")
        time.sleep(1.5)
        diag = cdp.eval("({start: window.__keGuestStart, log: window.__keGuestStatusLog, buttons: [...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).filter(Boolean).slice(0,40), body: (document.body.innerText||'').slice(-800)})")
        (BASE / "diag.json").write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
        print("diag:", json.dumps(diag, ensure_ascii=False)[:900], flush=True)
        results = None
        for _ in range(120):
            results = cdp.eval("window.__keGuestResults || null")
            if isinstance(results, dict) and results.get("phase") == "w02-guest-done":
                break
            time.sleep(0.25)
        print("guest results:", json.dumps(results, ensure_ascii=False)[:600], flush=True)
        hs = (results or {}).get("handshakeAccepted") or {}
        features = hs.get("acceptedFeatures") if isinstance(hs, dict) else hs
        check("W-T26-W02-2 guest 握手（ui.shell/context.read）",
              isinstance(features, list) and set(features) >= {"ui.shell", "context.read"},
              {"features": features})
        set_title = (results or {}).get("setTitle") or {}
        check("W-T26-W02-3 guest 经 Broker command.invoke 提交 title 成功",
              isinstance(set_title, dict) and set_title.get("ok") is True, set_title)
        article_text = article.read_text(encoding="utf-8", errors="replace")
        check("W-T26-W02-4 宿主后端原子写生效（frontmatter title 已更新）",
              "W02 交接标题" in article_text and "原标题" not in article_text.split("---")[1] if article_text.count("---") >= 2 else False,
              {"head": article_text[:160]})
        set_tags = (results or {}).get("setTags") or {}
        check("W-T26-W02-4b guest 提交 tags 成功且后端落盘",
              isinstance(set_tags, dict) and set_tags.get("ok") is True and "w02" in article.read_text(encoding="utf-8", errors="replace"),
              set_tags)
        check("W-T26-W02-5 未知命令被拒绝（E_COMMAND_NOT_ALLOWED）",
              "E_COMMAND_NOT_ALLOWED" in str((results or {}).get("forbiddenError") or ""),
              (results or {}).get("forbiddenError"))
        status = invoke(cdp, "workshop_pack_session_status", {})
        check("W-T26-W02-6 会话 active", ((status or {}).get("value") or {}).get("state") == "active", status)
        upid = user_pid()
        check("W-T26-W02-7 主进程存活 / 用户实例未运行（N/A）",
              proc.poll() is None, {"user_pid": upid or "(not running)"})
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
               "scenario": "T26 W02 表单交接产品 W（command.invoke title + 未知命令拒绝）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out = EVID / "T26-W02-form-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
