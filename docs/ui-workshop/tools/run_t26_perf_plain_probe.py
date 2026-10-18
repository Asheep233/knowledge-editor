# -*- coding: utf-8 -*-
"""P5-T26 W09 复测：plain vs formula 大文档打开（带 MARKER 精确判定，修正点击/测量问题）。"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-perfplain")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
CDP_PORT = 9910 + (os.getpid() % 80)


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

    def make_doc(name: str, target: int, formulas: bool) -> None:
        marker = f"MARKER_{name}"
        parts = [f"---\ntitle: {name}\n---\n\n{marker}\n\n"]
        i = 0
        while sum(len(p) for p in parts) < target:
            if formulas:
                parts.append(f"## 章节 {i}\n\n第 {i} 段公式 $x_{i}^2 + y_{i}^2 = z_{i}^2$。\n\n")
            else:
                parts.append(f"## 章节 {i}\n\n第 {i} 段纯文本基线内容（无公式）。\n\n")
            i += 1
        (ws / "Articles" / f"{name}.md").write_bytes("".join(parts).encode("utf-8"))

    make_doc("plain256", 256 * 1024, False)
    make_doc("plain512", 512 * 1024, False)
    make_doc("formula256", 256 * 1024, True)

    env = {**os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
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
        # 等文章列表加载
        for _ in range(120):
            if "plain256" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.25)

        def open_doc(name: str) -> dict:
            marker = f"MARKER_{name}"
            clicked = click_text(cdp, name)
            start = time.time()
            ok = False
            for _ in range(600):
                if cdp.eval("(document.querySelector('.ProseMirror')?.textContent || '').includes(" + json.dumps(marker) + ")"):
                    ok = True
                    break
                time.sleep(0.1)
            ms = int((time.time() - start) * 1000)
            return {"clicked": clicked, "ms": ms, "ok": ok}

        for name in ("plain256", "plain512", "formula256"):
            metrics[name] = open_doc(name)
            check(f"W-T26-W09P {name} 打开（marker 命中）", metrics[name]["ok"], metrics[name])

        plain_ms = metrics["plain256"]["ms"]
        plain512_ms = metrics["plain512"]["ms"]
        formula_ms = metrics["formula256"]["ms"]
        check("W-T26-W09P-1 纯文本 256KB 打开 < 5s", metrics["plain256"]["ok"] and plain_ms < 5000, {"ms": plain_ms})
        check("W-T26-W09P-2 纯文本 512KB 打开 < 8s", metrics["plain512"]["ok"] and plain512_ms < 8000, {"ms": plain512_ms})
        check("W-T26-W09P-3 公式密集 256KB 打开 < 8s", metrics["formula256"]["ok"] and formula_ms < 8000, {"ms": formula_ms})
        check("W-T26-W09P-4 公式密集显著慢于纯文本（归因记录）", formula_ms >= plain_ms, {"plainMs": plain_ms, "formulaMs": formula_ms})
        check("W-T26-W09P-5 主进程存活 / 用户实例未受影响",
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
               "scenario": "T26 W09 复测（plain/formula 大文档，MARKER 判定）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
               "metrics": metrics}
    out = EVID / "T26-W09-perf-plain-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
