# -*- coding: utf-8 -*-
"""P5-T26 补充 W 探针：真实产品壳 IME 组词 + DPI/缩放后编辑面可用（WebView2 CDP 驱动）。

不读取/写入真实用户库：隔离 APPDATA + 临时工作区 + 隔离测试构建（独立 identifier）。
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
BASE = Path(r"C:\ke-tmp\uiws-t26-ime")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
CDP_PORT = 9450 + (os.getpid() % 100)


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


def cleanup_test_apps() -> None:
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
        vk = ord(key.upper()) if len(key) == 1 else 0
        for t in ("keyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {"type": t, "key": key, "code": code, "modifiers": modifiers,
                                                 "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})


def click_text(cdp: CDP, text: str) -> bool:
    expr = ("(() => { const els=[...document.querySelectorAll('body *')].filter(x=>(x.textContent||'').includes("
            + json.dumps(text) + ") && x.children.length===0); if(!els.length) return false;"
            " for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) {"
            "  els[0].dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); } return true; })()")
    return bool(cdp.eval(expr))


def focus_editor(cdp: CDP) -> bool:
    return bool(cdp.eval(
        "(() => { const el=document.querySelector('.ProseMirror'); if(!el) return false; el.focus();"
        " const sel=window.getSelection(); sel.removeAllRanges(); const r=document.createRange();"
        " r.selectNodeContents(el); r.collapse(false); sel.addRange(r); return true; })()"
    ))


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:320], flush=True)

    if not EXE.exists():
        print(f"缺少隔离测试构建: {EXE}")
        return 2
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    cleanup_test_apps()
    for folder in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(folder) / "com.astranota.uiws.e2e", ignore_errors=True)
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)

    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    article = ws / "Articles" / "ime.md"
    article.write_text("---\ntitle: ime\n---\n\n初始内容\n", encoding="utf-8")

    env = dict(os.environ)
    env["APPDATA"] = str(appdata)
    env["KE_WORKSPACE"] = str(ws)
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
            if "ime" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.25)
        click_text(cdp, "ime")
        for _ in range(80):
            if cdp.eval("!!document.querySelector('.ProseMirror')"):
                break
            time.sleep(0.25)
        check("W-T26-IME/DPI-1 产品启动 + 打开文章编辑器", bool(cdp.eval("!!document.querySelector('.ProseMirror')")), None)

        # 真实窗口激活 + 编辑器聚焦
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"(New-Object -ComObject WScript.Shell).AppActivate({proc.pid}) | Out-Null"],
                       capture_output=True, text=True, timeout=20)
        cdp.call("Page.bringToFront")
        focused = focus_editor(cdp)
        check("W-T26-IME/DPI-2 编辑器可聚焦（contenteditable）",
              focused and bool(cdp.eval("document.activeElement && document.activeElement.classList.contains('ProseMirror')")), {"focused": focused})

        # IME 组词输入（CDP Input.imeSetComposition + insertText，走浏览器 IME 管线）
        cdp.call("Input.imeSetComposition", {"text": "zhongwen", "selectionStart": 8, "selectionEnd": 8})
        time.sleep(0.15)
        cdp.call("Input.imeSetComposition", {"text": "", "selectionStart": 0, "selectionEnd": 0})
        time.sleep(0.05)
        cdp.call("Input.insertText", {"text": "中文组词"})
        time.sleep(0.3)
        text1 = str(cdp.eval("document.querySelector('.ProseMirror')?.innerText || ''"))
        if "中文组词" not in text1:
            focus_editor(cdp)
            cdp.call("Input.insertText", {"text": "中文组词"})
            time.sleep(0.3)
            text1 = str(cdp.eval("document.querySelector('.ProseMirror')?.innerText || ''"))
        check("W-T26-IME/DPI-3 IME 组词进入编辑面", "中文组词" in text1, {"text": text1[-80:]})

        # DPI/缩放：Emulation.setDeviceMetricsOverride（真实 WebView2 渲染层）
        dpr_before = cdp.eval("window.devicePixelRatio")
        cdp.call("Emulation.setDeviceMetricsOverride", {"width": 1200, "height": 800, "deviceScaleFactor": 1.5, "mobile": False})
        time.sleep(0.8)
        dpr_after = cdp.eval("window.devicePixelRatio")
        check("W-T26-IME/DPI-4 DPI/缩放生效（devicePixelRatio 变化）", dpr_before != dpr_after and float(dpr_after) == 1.5,
              {"before": dpr_before, "after": dpr_after})

        focus_editor(cdp)
        cdp.call("Input.insertText", {"text": "ZOOMED"})
        time.sleep(0.3)
        text2 = str(cdp.eval("document.querySelector('.ProseMirror')?.innerText || ''"))
        cdp.call("Emulation.clearDeviceMetricsOverride")
        time.sleep(0.4)
        dpr_restored = cdp.eval("window.devicePixelRatio")
        check("W-T26-IME/DPI-5 缩放后编辑面仍可输入且恢复 DPI", "ZOOMED" in text2 and dpr_restored == dpr_before,
              {"text": text2[-60:], "restored": dpr_restored})
        check("W-T26-IME/DPI-6 主进程存活", proc.poll() is None, proc.poll())
        upid = user_pid()
        check("W-T26-IME/DPI-7 用户运行中的 AstraNota 未受影响", upid.isdigit(), {"user_pid": upid})
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
        cleanup_test_apps()
        log.close()

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 IME/DPI 产品 W（隔离构建 + CDP）",
        "exe": str(EXE), "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
    }
    out = EVID / "T26-IME-DPI-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
