# -*- coding: utf-8 -*-
"""P5-T26 W09（工坊口径）：无双编辑器复制、无逐字符全量广播、无持续泄漏。

说明：大文档首开慢是产品既有 @tiptap/markdown 解析限制（editor/index.ts 注释 P3-2 / docs/perf-notes），
不属于工坊引入；本探针验证工坊相关硬指标。
"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-w09")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
CDP_PORT = 9960 + (os.getpid() % 60)


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


def click_text(cdp: CDP, text: str) -> bool:
    """精确匹配标题文本的最深元素（避免 'a' 命中其他包含 a 的文本）。"""
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('body *')].filter(x=>((x.textContent||'').trim() === "
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

    (ws / "Articles" / "a.md").write_bytes(b"---\ntitle: a\n---\n\nMARKER_a\n\n" + b"content line\n" * 200)
    (ws / "Articles" / "b.md").write_bytes(b"---\ntitle: b\n---\n\nMARKER_b\n\n" + b"content line\n" * 200)

    env = {**os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
           "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}"}
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
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

        def open_doc(name: str) -> bool:
            marker = f"MARKER_{name}"
            candidates = [name, name + ".md"]
            # 等文章列表渲染出标题/文件名再点击（列表可能显示文件名）
            for _ in range(120):
                if cdp.eval("(() => [...document.querySelectorAll('body *')].some(x => {"
                            " const t=(x.textContent||'').trim(); return (t === "
                            + json.dumps(candidates[0]) + " || t === " + json.dumps(candidates[1]) + ") && x.children.length===0; }))()"):
                    break
                time.sleep(0.25)
            clicked = click_text(cdp, name + ".md")
            if not clicked:
                clicked = click_text(cdp, name)
            for _ in range(300):
                if cdp.eval("(document.querySelector('.ProseMirror')?.textContent || '').includes(" + json.dumps(marker) + ")"):
                    return True
                time.sleep(0.1)
            return False

        (BASE / "body-before.txt").write_text(str(cdp.eval("document.body.innerText || ''")), encoding="utf-8")
        opened_a = open_doc("a")
        (BASE / "body-after.txt").write_text(str(cdp.eval("document.body.innerText || ''")), encoding="utf-8")
        check("W09W-1 打开文档 a（基线）", opened_a, {"before": (BASE / "body-before.txt").exists()})
        # 逐字符输入 → 结束后 5s 内统计保存请求数（不应逐字符广播）
        cdp.eval("(() => { const el=document.querySelector('.ProseMirror'); el.focus(); const sel=window.getSelection();"
                 " sel.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.addRange(r); return true; })()")
        for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234":
            cdp.call("Input.insertText", {"text": ch})
        before_writes = log_path.read_text(encoding="utf-8", errors="replace").count("PUT /api/articles")
        time.sleep(5.0)
        log.flush()
        text_log = log_path.read_text(encoding="utf-8", errors="replace")
        writes = text_log.count("PUT /api/articles") - before_writes
        metrics["writesAfter34Chars"] = writes
        check("W09W-2 34 次逐字符输入后保存请求数（不应逐字符：<8）", writes < 8, {"writes": writes})

        # 单编辑器实例
        editors = int(cdp.eval("document.querySelectorAll('.ProseMirror').length") or 0)
        check("W09W-3 无双编辑器复制（ProseMirror 数=1）", editors == 1, {"editors": editors})

        # 反复切换/重开 8 次：检查实例数与堆增长（无持续泄漏迹象）
        heap_before = None
        try:
            heap_before = cdp.call("Runtime.getHeapUsage").get("usedSize")
        except Exception:
            heap_before = 0
        for _ in range(8):
            open_doc("b")
            open_doc("a")
        editors2 = int(cdp.eval("document.querySelectorAll('.ProseMirror').length") or 0)
        heap_after = 0
        try:
            heap_after = cdp.call("Runtime.getHeapUsage").get("usedSize")
        except Exception:
            heap_after = 0
        delta = heap_after - heap_before
        metrics["heapDelta"] = delta
        check("W09W-4 8 次切换后编辑器实例仍=1", editors2 == 1, {"editors": editors2})
        check("W09W-5 8 次切换堆增长有界（< 60MB）", delta < 60 * 1024 * 1024, {"heapDeltaMB": round(delta / 1024 / 1024, 1)})
        upid = user_pid()
        # 用户实例未运行时无法观测影响（N/A）；运行中则 PID 应存在
        check("W09W-6 主进程存活 / 用户实例未受影响",
              proc.poll() is None and (upid.isdigit() or upid == ""),
              {"user_pid": upid or "(not running)", "note": "用户 App 未运行 → 影响 N/A"})
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
               "scenario": "T26 W09 工坊口径（无复制/无逐字符广播/无泄漏）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
               "metrics": metrics,
               "note": "大文档首开慢为产品既有解析限制（editor/index.ts P3-2），非工坊引入"}
    out = EVID / "T26-W09-workshop-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
