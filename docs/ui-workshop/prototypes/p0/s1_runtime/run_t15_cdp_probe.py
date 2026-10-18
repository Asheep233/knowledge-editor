# -*- coding: utf-8 -*-
"""P2-T15 实机探针：WebView2 CDP 驱动真实编辑面的 IME 组词/focus/缩放验收。

流程：启动原型 app（S2 持续编辑面窗口），开启 WebView2 remote debugging →
CDP 连接 → 调真实协议 Input.imeSetComposition/insertText 走浏览器 IME 输入路径 →
验证编辑面文本、焦点、缩放后仍可编辑；结果落盘。
运行：python run_t15_cdp_probe.py
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
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-t15-probe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
CDP_PORT = 9400 + (os.getpid() % 200)


class CDP:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=20, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + 30
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expression: str, await_promise: bool = False) -> object:
        res = self.call("Runtime.evaluate", {
            "expression": expression, "returnByValue": True, "awaitPromise": await_promise,
        })
        if "exceptionDetails" in res:
            raise RuntimeError(json.dumps(res["exceptionDetails"], ensure_ascii=False)[:300])
        return res.get("result", {}).get("value")

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass


LAST_DIAG: dict = {}


def find_target(port: int) -> str | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as resp:
            targets = json.loads(resp.read().decode("utf-8"))
        LAST_DIAG["targets"] = [(t.get("type"), str(t.get("url"))[:80]) for t in targets]
    except Exception as e:
        LAST_DIAG["error"] = str(e)[:200]
        return None
    for t in targets:
        if "s2.html" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl"):
            return str(t["webSocketDebuggerUrl"])
    return None


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:260], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    probe = BASE / "probe-t15"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({
        "S1_PROBE_DIR": str(probe), "S1_SCENARIO": "s2", "S1_OPEN_S2": "1",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
    })
    p = subprocess.Popen([str(EXE)], env=env)
    cdp: CDP | None = None
    results: dict = {}
    try:
        end = time.time() + 40
        while time.time() < end and cdp is None:
            ws_url = find_target(CDP_PORT)
            if ws_url:
                try:
                    cdp = CDP(ws_url)
                except Exception:
                    cdp = None
            if cdp is None:
                time.sleep(0.3)
        check("W-T15-1 连接的 CDP 页面存在（WebView2 remote debugging）", cdp is not None,
              {"port": CDP_PORT, "diag": LAST_DIAG})
        if cdp is None:
            raise RuntimeError("CDP 未连接")
        cdp.call("Runtime.enable")
        # 让页面获得焦点（否则 activeElement/focus 断言在后台窗口不可靠）
        try:
            cdp.call("Emulation.setFocusEmulationEnabled", {"enabled": True})
        except Exception:
            pass
        try:
            cdp.call("Page.bringToFront")
            cdp.call("Page.enable")
        except Exception:
            pass
        # 等 harness 就绪（window.__s2 暴露）
        ready = False
        end = time.time() + 30
        while time.time() < end:
            try:
                if cdp.eval("typeof window.__s2 === 'object'"):
                    ready = True
                    break
            except Exception:
                pass
            time.sleep(0.2)
        check("W-T15-2 持续编辑面 harness 就绪（window.__s2）", ready, {"ready": ready, "diag": LAST_DIAG})
        if not ready:
            raise RuntimeError("s2 harness 未就绪（可能连到了错误页面）")
        ua = cdp.eval("navigator.userAgent")
        results["ua"] = ua
        results["baselineText"] = cdp.eval("window.__s2.getText()")
        check("W-T15-3 真实 WebView2 环境", "Edg/" in str(ua), str(ua)[:80])

        # 焦点：优先 API focus，若窗口后台导致 activeElement 不生效则用 CDP 真实鼠标点击编辑面
        focus_diag: dict = {"documentHasFocus": cdp.eval("document.hasFocus()")}
        cdp.eval("window.__s2.focus()")
        time.sleep(0.15)
        editable = cdp.eval("window.__s2.activeElementEditable()")
        if not editable:
            rect = cdp.eval(
                "(()=>{const el=window.__s2.editor.view.dom;const r=el.getBoundingClientRect();"
                "return {x:r.x+r.width/2,y:r.y+r.height/2,connected:el.isConnected,"
                "contenteditable:el.getAttribute('contenteditable')}})()"
            )
            focus_diag["rect"] = rect
            if rect and rect.get("x") and rect.get("y"):
                for ev in ("mouseMoved", "mousePressed", "mouseReleased"):
                    cdp.call("Input.dispatchMouseEvent", {
                        "type": ev, "x": rect["x"], "y": rect["y"],
                        "button": "left", "clickCount": 1,
                    })
                time.sleep(0.2)
                editable = cdp.eval("window.__s2.activeElementEditable()")
        tag = cdp.eval("window.__s2.activeElementTag()")
        focus_diag.update({"tag": tag, "editable": editable})
        results["focus"] = focus_diag
        check("W-T15-4 编辑面可聚焦（activeElement 为 contenteditable）", editable is True, focus_diag)

        # IME 组词路径（CDP Input.imeSetComposition + insertText）
        cdp.eval("window.__s2.focus()")
        cdp.call("Input.imeSetComposition", {"text": "zhongwen", "selectionStart": 8, "selectionEnd": 8})
        time.sleep(0.1)
        cdp.call("Input.insertText", {"text": "中文组词"})
        time.sleep(0.2)
        text_after_ime = cdp.eval("window.__s2.getText()")
        results["textAfterIme"] = text_after_ime
        check("W-T15-5 IME 组词输入进入编辑面", "中文组词" in str(text_after_ime), {"text": text_after_ime})

        # 撤销（IME 提交后 undo 可用）
        cdp.eval("window.__s2.editor.commands.undo()")
        time.sleep(0.1)
        text_after_undo = cdp.eval("window.__s2.getText()")
        results["textAfterUndo"] = text_after_undo
        check("W-T15-6 IME 输入可撤销（history 正常）", "中文组词" not in str(text_after_undo) and text_after_undo != text_after_ime,
              {"afterIme": text_after_ime, "afterUndo": text_after_undo})

        # 缩放（Tauri setZoom；不可用则记录 unsupported 不算通过）
        dpr_before = cdp.eval("window.__s2.dpr()")
        zoom_ok = False
        try:
            zoom_res = cdp.eval(
                "(async()=>{const w=window.__TAURI__&&window.__TAURI__.webviewWindow;"
                "if(!w||!w.getCurrentWebviewWindow)return 'no-api';"
                "try{await w.getCurrentWebviewWindow().setZoom(1.25);return 'ok'}catch(e){return 'err:'+String(e)}})()",
                await_promise=True,
            )
            results["zoom"] = {"result": zoom_res, "dprBefore": dpr_before,
                               "dprAfter": cdp.eval("window.__s2.dpr()"),
                               "visualViewportScale": cdp.eval("window.__s2.visualViewportScale()")}
            zoom_ok = results["zoom"]["result"] == "ok"
        except Exception as e:
            results["zoom"] = {"error": str(e)}
        check("W-T15-7 缩放可用且 dpr 变化（Tauri setZoom）", zoom_ok and results.get("zoom", {}).get("dprAfter") != dpr_before,
              results.get("zoom"))

        # 缩放后仍可编辑（再次输入）
        if zoom_ok:
            cdp.eval("window.__s2.focus()")
            cdp.call("Input.insertText", {"text": "ZOOMED"})
            time.sleep(0.15)
            text_after_zoom = cdp.eval("window.__s2.getText()")
            results["textAfterZoom"] = text_after_zoom
            check("W-T15-8 缩放后编辑面仍可输入", "ZOOMED" in str(text_after_zoom), text_after_zoom)
            cdp.eval("window.__s2.editor.commands.undo()")
    except Exception as e:
        results["error"] = str(e)
        print("probe error:", e)
    finally:
        if cdp:
            cdp.close()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.terminate()
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
        subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
    }
    out = EVID / "T15-ime-zoom-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
