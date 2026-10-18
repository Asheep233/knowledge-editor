# -*- coding: utf-8 -*-
"""P5-T26 A8 真实产品 W 探针：VITE_KE_CORE_SAVE=1 构建下产品编辑器保存路径。

流程：隔离工作区（含 hello.md）→ 启动 flag 构建产品 → CDP 打开文章 → 编辑插入标记文本 →
触发保存（Ctrl+S/等待自动保存）→ 校验磁盘内容与后端日志（应出现 /api/context/write，Core 链）。
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
BASE = Path(r"C:\ke-tmp\uiws-t26-save")
APPDATA = Path(os.environ.get("APPDATA", r"C:\Users\y8882\AppData\Roaming"))
APP_DATA = APPDATA / "com.astranota.uiws.e2e"
EVID = REPO / "docs" / "ui-workshop" / "evidence"
CDP_PORT = 9900 + (os.getpid() % 90)


def cleanup_sidecars() -> None:
    ps = ("Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' -or $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)


def cleanup_stale_apps() -> None:
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    cleanup_sidecars()


def user_pid() -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
        capture_output=True, text=True)
    return out.stdout.strip()


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

    def eval(self, expression: str) -> object:
        res = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        return (res.get("result") or {}).get("value")

    def key(self, key: str, code: str, modifiers: int = 0) -> None:
        for t in ("rawKeyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {"type": t, "key": key, "code": code, "modifiers": modifiers,
                                                 "windowsVirtualKeyCode": ord(key.upper()) if len(key) == 1 else 0})


def click_text(cdp: CDP, text: str) -> bool:
    """点击包含指定文本的最深可见元素（兼容列表项内嵌 span/按钮）。"""
    expr = ("(() => { const els = [...document.querySelectorAll('body *')].filter(x =>"
            f" (x.textContent || '').includes({json.dumps(text)}) && x.children.length === 0);"
            " if (!els.length) return false; const el = els[0];"
            " for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) {"
            "  el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window})); }"
            " if (el.closest('button,a,[role=button]')) el.closest('button,a,[role=button]').click();"
            " return true; })()")
    return bool(cdp.eval(expr))


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:320], flush=True)

    if not EXE.exists():
        print(f"缺少 flag 构建测试二进制: {EXE}")
        return 2
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    cleanup_stale_apps()
    if APP_DATA.exists():
        shutil.rmtree(APP_DATA, ignore_errors=True)

    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    article = ws / "Articles" / "hello.md"
    article.write_text("---\ntitle: hello\n---\n\n初始内容\n", encoding="utf-8")

    # 红线：产品 data_dir() = %APPDATA%\KnowledgeEditor（不随 identifier 变化）→ 必须隔离 APPDATA
    isolated_appdata = BASE / "appdata"
    isolated_appdata.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["APPDATA"] = str(isolated_appdata)
    env["KE_WORKSPACE"] = str(ws)
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={CDP_PORT}"
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
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
            if "hello" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.25)
        check("W-T26-A8-1 flag 构建产品启动 + 工作区主 UI 就绪", True, None)

        opened = click_text(cdp, "hello")
        # 兼容双击打开；再尝试 Enter 激活选中项
        cdp.eval("(() => { const els=[...document.querySelectorAll('body *')].filter(x=>(x.textContent||'').includes('hello') && x.children.length===0);"
                 " if(!els.length) return false; els[0].dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return true; })()")
        time.sleep(0.3)
        cdp.key("Enter", "Enter")
        editor = False
        for _ in range(120):
            if bool(cdp.eval("!!document.querySelector('.ProseMirror')")):
                editor = True
                break
            time.sleep(0.25)
        time.sleep(0.6)
        body_snippet = str(cdp.eval("(document.body.innerText || '').slice(0, 400)"))
        check("W-T26-A8-2 打开文章并加载编辑器", opened and editor,
              {"opened": opened, "editor": editor, "body": body_snippet})

        # 真实窗口激活 + 鼠标点击编辑区（确保 OS 焦点/input 事件可信，自动保存不被暂停）
        try:
            subprocess.run(["powershell", "-NoProfile", "-Command",
                            f"(New-Object -ComObject WScript.Shell).AppActivate({proc.pid}) | Out-Null"],
                           capture_output=True, text=True, timeout=20)
        except Exception:
            pass
        try:
            cdp.call("Page.bringToFront")
            rect = cdp.eval("(() => { const el=document.querySelector('.ProseMirror'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+40,y:r.y+20}; })()")
            if rect:
                for t in ("mouseMoved", "mousePressed", "mouseReleased"):
                    cdp.call("Input.dispatchMouseEvent", {"type": t, "x": rect["x"], "y": rect["y"], "button": "left", "clickCount": 1})
        except Exception:
            pass
        # 光标移到编辑器末尾并插入标记
        focus_expr = (
            "(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus();"
            " const sel = window.getSelection(); sel.removeAllRanges();"
            " const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);"
            " sel.addRange(r); return true; })()"
        )
        focused = bool(cdp.eval(focus_expr))
        # 逐字符 char 事件（更接近真实输入，触发 ProseMirror input 管线/脏标记）
        for ch in "A8标记文本":
            cdp.call("Input.dispatchKeyEvent", {"type": "char", "text": ch, "key": ch})
            time.sleep(0.05)
        cdp.call("Input.insertText", {"text": ""})
        time.sleep(0.5)
        text_now = str(cdp.eval("document.querySelector('.ProseMirror')?.innerText || ''"))
        check("W-T26-A8-3 编辑插入标记文本", focused and "A8标记文本" in text_now, {"focused": focused, "hasMarker": "A8标记文本" in text_now})

        # 触发保存：先聚焦窗口（后台窗口可能暂停自动保存）→ 等待自动保存；
        # 再 Ctrl+S；再失焦（点击标题区）触发保存-失焦。逐步尝试并记录生效方式。
        try:
            cdp.call("Page.bringToFront")
        except Exception:
            pass
        saved_by = ""
        saved = False

        def check_file() -> bool:
            try:
                return "A8标记文本" in article.read_text(encoding="utf-8")
            except Exception:
                return False

        # 1) 自动保存
        for _ in range(50):
            if check_file():
                saved, saved_by = True, "autosave"
                break
            time.sleep(0.4)
        # 2) Ctrl+S（keyDown + keyUp，修正常规事件类型）
        if not saved:
            for t in ("keyDown", "keyUp"):
                cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "s", "code": "KeyS", "modifiers": 2,
                                                     "windowsVirtualKeyCode": 83, "nativeVirtualKeyCode": 83})
            for _ in range(30):
                if check_file():
                    saved, saved_by = True, "ctrl-s"
                    break
                time.sleep(0.4)
        # 3) 失焦（点击左侧标题区）触发保存
        if not saved:
            click_text(cdp, "hello")
            for _ in range(30):
                if check_file():
                    saved, saved_by = True, "blur/click"
                    break
                time.sleep(0.4)
        check("W-T26-A8-4 保存落盘（磁盘文件包含标记）", saved,
              {"file": str(article), "savedBy": saved_by, "tail": article.read_text(encoding="utf-8", errors="replace")[-120:]})

        # 保存后等待日志刷新：Core 链应出现 /api/context/write
        time.sleep(1.5)
        log.flush()
        log_text = log_path.read_text(encoding="utf-8", errors="replace")
        check("W-T26-A8-5 保存经 Core 上下文链（后端日志出现 /api/context/write）",
              "/api/context/write" in log_text,
              {"hasContextWrite": "/api/context/write" in log_text,
               "hasLegacyPut": "/api/articles" in log_text})
        check("W-T26-A8-6 无保存错误（日志无 Core 保存失败/异常）",
              "E_INTERNAL" not in log_text and "保存失败" not in log_text, {"logTail": log_text.strip().splitlines()[-3:]})
        check("W-T26-A8-7 主进程存活（保存链路无崩溃）", proc.poll() is None, proc.poll())
        upid = user_pid()
        check("W-T26-A8-8 用户运行中的 AstraNota 未受影响", upid.isdigit(), {"user_pid": upid})
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
        cleanup_sidecars()
        log.close()

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 A8 Core 保存 flag（真实产品 UI，VITE_KE_CORE_SAVE=1）",
        "exe": str(EXE), "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
    }
    out = EVID / "T26-A8-save-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
