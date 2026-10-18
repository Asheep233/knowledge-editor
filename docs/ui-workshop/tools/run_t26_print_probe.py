# -*- coding: utf-8 -*-
"""P5-T26 A2 真实产品 W 探针：隐藏 renderer 快照打印（CDP 注入调用 Tauri 命令）。

流程：启动隔离测试构建（独立 identifier + KE_WS_PRINT_RENDER=1 + remote debugging）→
CDP Runtime.evaluate 调 `print_snapshot_pdf`（真实命令：注入快照 HTML → ready 握手 → PrintToPdf）→
验证 PDF/%PDF 头/大小/不覆盖/非法路径拒绝/无 ready 超时日志 → 清理（路径白名单 sidecar）。
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
BASE = Path(r"C:\ke-tmp\uiws-t26-print")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
CDP_PORT = 9600 + (os.getpid() % 200)


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

    def eval(self, expression: str, await_promise: bool = True) -> object:
        res = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": await_promise})
        return (res.get("result") or {}).get("value")


def cleanup_sidecars() -> None:
    ps = (
        "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' } | "
        "Stop-Process -Force -ErrorAction SilentlyContinue"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    # 红线：禁止 taskkill /IM knowledgeeditor.exe（会杀到用户运行中的 App）；
    # 测试进程只按 Popen PID 终止（见 finally），sidecar 只按 cargo-target 路径白名单清理。


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:320], flush=True)

    if not EXE.exists():
        print(f"缺少隔离测试构建: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    (BASE / "out").mkdir(parents=True)
    target_pdf = BASE / "out" / "a2-print.pdf"
    log_path = BASE / "app.log"
    # 用一份 HTML 快照（真实 Renderer 打印；不读编辑器 DOM）
    html = (
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
        "body{font:16px sans-serif;color:#111}h1{color:#123}h2{color:#456}"
        "@page{margin:12mm}</style></head><body>"
        "<h1>T26 A2 快照打印</h1><h2>hidden renderer + PrintToPdf</h2>"
        "<p>这段内容来自可信快照 HTML，不读取编辑器 DOM。</p></body></html>"
    )
    # app 日志（stderr/stdout）用于判断 ready 握手是否超时兜底
    # 红线：产品 data_dir() = %APPDATA%\KnowledgeEditor（不随 identifier 变化）→ 必须隔离 APPDATA
    isolated_appdata = BASE / "appdata"
    isolated_appdata.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["APPDATA"] = str(isolated_appdata)
    env.update({
        "KE_WS_PRINT_RENDER": "1",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
    })
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen([str(EXE)], env=env, stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    try:
        end = time.time() + 60
        ws_url = None
        targets = []
        while time.time() < end:
            targets = [t for t in cdp_targets() if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
            # 等主窗口（tauri.localhost）就绪，避免过早连到隐藏 renderer 的 about:blank
            if not any("tauri.localhost" in str(t.get("url", "")) for t in targets) and time.time() + 5 < end:
                time.sleep(0.4)
                continue
            # 优先主窗口（tauri.localhost / 应用 index），排除隐藏 print-render
            def score(t):
                url = str(t.get("url", ""))
                if "print-render" in url:
                    return -1
                if "tauri.localhost" in url or "/index" in url or url.endswith("/"):
                    return 2
                return 1
            targets.sort(key=score, reverse=True)
            if targets:
                ws_url = targets[0]["webSocketDebuggerUrl"]
                break
            time.sleep(0.4)
        check("W-T26-A2-1 隔离产品实例启动 + WebView2 remote debugging 可用", ws_url is not None,
              {"port": CDP_PORT, "targets": [t.get("url") for t in targets][:4]})
        if not ws_url:
            raise RuntimeError("CDP 目标未就绪")
        cdp = CDP(ws_url)
        # 等 app 初始化完成（IPC 注入/前端 boot），避免执行上下文竞态
        ready = False
        for _ in range(60):
            try:
                ready = bool(cdp.eval("typeof window.__TAURI_INTERNALS__ === 'object' && typeof window.__TAURI_INTERNALS__.invoke === 'function'"))
            except Exception:
                ready = False
            if ready:
                break
            time.sleep(0.25)
        time.sleep(0.5)
        check("W-T26-A2-2 主窗口执行上下文可用（含 __TAURI_INTERNALS__.invoke）", ready, {"ready": ready})
        appdata = Path(os.environ.get("APPDATA", "")) / "com.astranota.uiws.e2e"
        renderer_status = None
        status_file = appdata / "print-render-status.json"
        if status_file.exists():
            try:
                renderer_status = json.loads(status_file.read_text(encoding="utf-8"))
            except Exception:
                renderer_status = None
        check("W-T26-A2-2b 隐藏打印 renderer 创建成功（状态文件 ok）",
              isinstance(renderer_status, dict) and renderer_status.get("ok") is True, renderer_status)

        # 1) 真实打印命令
        expr = (
            "(async () => { try { const path = await window.__TAURI_INTERNALS__.invoke('print_snapshot_pdf',"
            f"{{html: {json.dumps(html)}, target: {json.dumps(str(target_pdf))}, contentWidth: null}});"
            " return {ok: true, path}; } catch (e) { return {ok: false, error: String(e && e.message || e)}; } })()"
        )
        res = cdp.eval(expr)
        print("print result:", res, flush=True)
        pdf_ok = target_pdf.exists()
        pdf_bytes = target_pdf.read_bytes() if pdf_ok else b""
        check("W-T26-A2-3 快照打印返回成功", isinstance(res, dict) and res.get("ok") is True, res)
        check("W-T26-A2-4 PDF 生成、%PDF 头、大小合理", pdf_ok and pdf_bytes[:4] == b"%PDF" and len(pdf_bytes) > 1000,
              {"exists": pdf_ok, "size": len(pdf_bytes), "head": pdf_bytes[:4].decode("latin1", "replace")})

        # 2) 不覆盖已有文件
        res2 = cdp.eval(expr)
        check("W-T26-A2-5 已存在目标 → 拒绝覆盖", isinstance(res2, dict) and res2.get("ok") is False and "已存在" in str(res2.get("error")), res2)

        # 3) 非法相对路径拒绝
        bad_expr = (
            "(async () => { try { const path = await window.__TAURI_INTERNALS__.invoke('print_snapshot_pdf',"
            f"{{html: {json.dumps(html)}, target: 'relative/out.pdf', contentWidth: null}});"
            " return {ok: true, path}; } catch (e) { return {ok: false, error: String(e && e.message || e)}; } })()"
        )
        res3 = cdp.eval(bad_expr)
        check("W-T26-A2-6 非法路径（相对路径）→ E_PATH 拒绝", isinstance(res3, dict) and res3.get("ok") is False and "E_PATH" in str(res3.get("error")), res3)

        # 4) ready 握手：无超时兜底日志（有则说明握手未生效）
        time.sleep(1.0)
        log_text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
        check("W-T26-A2-7 ready 握手生效（无 E_PRINT_RENDER_TIMEOUT 兜底）", "E_PRINT_RENDER_TIMEOUT" not in log_text,
              {"logTail": log_text.strip().splitlines()[-4:] if log_text else []})

        # 5) 用户实例不受影响
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
            capture_output=True, text=True,
        )
        user_pid = ps.stdout.strip()
        check("W-T26-A2-8 用户运行中的 AstraNota 未受影响（PID 存在）", user_pid.isdigit(), {"user_pid": user_pid})
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

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 A2 快照打印（真实产品壳隔离构建）",
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "pdf": str(target_pdf),
        "pdf_size": target_pdf.stat().st_size if target_pdf.exists() else 0,
    }
    out = EVID / "T26-A2-print-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
