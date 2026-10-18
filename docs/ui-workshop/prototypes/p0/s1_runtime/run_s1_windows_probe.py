# -*- coding: utf-8 -*-
"""P0-S1b 实机探针：child WebviewWindow 对照（同源 guest vs 独立来源 guest）+ 命令守卫原型。

检查：
  - 同源 guest 窗口（http://tauri.localhost）：app 命令是否全局可见（whoami/unguarded）、
    受守卫命令是否被拒（label 绑定）、后端 loopback 是否可直连（同源 CORS 放行）。
  - 独立来源 guest 窗口（uiwsguest://）：IPC 是否被拒、后端是否被拒、经本机回调上报结果。
运行（Windows Python）：python run_s1_windows_probe.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-s1-windows-probe")
WINPY = Path(r"C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
BACKEND_PORT = 8101
CALLBACK_PORT = 8122
HOST_ORIGIN = "http://tauri.localhost"

CALLBACK_DATA: list[dict] = []


GUEST_ISO_HTML = r"""<!doctype html>
<html><head><meta charset="utf-8"><title>guest-iso</title></head>
<body style="font:12px monospace;background:#aca;color:#000">
<h4>guest iso</h4><pre id="out">running…</pre>
<script>
(async function () {
  var out = {
    origin: String(location.origin), href: String(location.href),
    tauriInternals: typeof window.__TAURI_INTERNALS__, tauriGlobal: typeof window.__TAURI__,
    whoami: null, unguarded: null, fetchBackend: null
  };
  async function inv(cmd, args) { return window.__TAURI__.core.invoke(cmd, args); }
  try { out.whoami = await inv('whoami'); } catch (e) { out.whoami = 'error:' + String((e && e.message) || e); }
  try { out.unguarded = await inv('unguarded_guest_write', { payload: 'iso-should-fail' }); }
  catch (e) { out.unguarded = 'error:' + String((e && e.message) || e); }
  try { var r = await fetch('http://127.0.0.1:8101/api/health', { mode: 'cors' }); out.fetchBackend = 'ok:' + r.status; }
  catch (e) { out.fetchBackend = 'blocked:' + String(e && e.name); }
  document.getElementById('out').textContent = JSON.stringify(out, null, 2);
  try { var img = new Image(); img.src = 'http://127.0.0.1:8122/report?data=' + encodeURIComponent(JSON.stringify(out)); document.body.appendChild(img); } catch (e) {}
})();
</script></body></html>"""


class GuestPageHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        body = GUEST_ISO_HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:
        pass


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        q = parse_qs(urlparse(self.path).query)
        if "data" in q:
            try:
                CALLBACK_DATA.append(json.loads(q["data"][0]))
            except Exception:
                CALLBACK_DATA.append({"raw": q["data"][0]})
        self.send_response(200)
        self.send_header("Content-Type", "image/gif")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b"GIF89a\x01\x00\x01\x00\x00\x00\x00;")

    def log_message(self, *args) -> None:
        pass


def reset() -> None:
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    (BASE / "backend-ws" / "Articles").mkdir(parents=True, exist_ok=True)
    (BASE / "backend-ws" / "Attachments").mkdir(parents=True, exist_ok=True)


def start_backend() -> subprocess.Popen:
    env = dict(os.environ)
    env.update({
        "KE_WORKSPACE": str(BASE / "backend-ws"),
        "KE_APP_CONFIG": str(BASE / "app_config.json"),
        "KE_APP_CONFIG_LEGACY": str(BASE / "legacy-missing.json"),
        "KE_CORS_ORIGINS": HOST_ORIGIN,
        "PYTHONIOENCODING": "utf-8",
    })
    log = (BASE / "backend.log").open("w", encoding="utf-8")
    p = subprocess.Popen(
        [str(WINPY), "-m", "uvicorn", "app.main:app", "--app-dir", str(REPO / "backend"),
         "--host", "127.0.0.1", "--port", str(BACKEND_PORT)],
        env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    end = time.time() + 30
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{BACKEND_PORT}/api/health", timeout=1) as r:
                if r.status == 200:
                    return p
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("backend 未就绪")


def run_scenario() -> dict:
    probe = BASE / "probe-windows"
    if probe.exists():
        shutil.rmtree(probe, ignore_errors=True)
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({
        "S1_PROBE_DIR": str(probe),
        "S1_BACKEND_BASE": f"http://127.0.0.1:{BACKEND_PORT}",
        "S1_HOST_ORIGIN": HOST_ORIGIN,
        "S1_SCENARIO": "windows",
        "S1_GUEST_ISO_URL": "http://127.0.0.1:8123/guest-iso.html",
        "S1_OPEN_GUESTS": "1",
    })
    p = subprocess.Popen([str(EXE)], env=env)
    results = None
    end = time.time() + 120
    while time.time() < end:
        f = probe / "results.json"
        if f.exists():
            try:
                results = json.loads(f.read_text(encoding="utf-8"))
                break
            except Exception:
                pass
        if p.poll() is not None and not f.exists():
            break
        time.sleep(0.3)
    try:
        p.wait(timeout=25)
    except subprocess.TimeoutExpired:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    def read(name: str):
        f = probe / name
        if not f.exists():
            return None
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return {"raw": f.read_text(encoding="utf-8", errors="replace")}
    return {
        "exit_code": p.poll(),
        "results": results,
        "same": read("guest-report-same.json"),
        "same_unguarded": read("guest-unguarded-write.json"),
        "events": (probe / "events.log").read_text(encoding="utf-8") if (probe / "events.log").exists() else "",
    }


def kill_probe_app() -> None:
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:240], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    EVID.mkdir(parents=True, exist_ok=True)
    reset()
    server = HTTPServer(("127.0.0.1", CALLBACK_PORT), CallbackHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    guest_server = HTTPServer(("127.0.0.1", 8123), GuestPageHandler)
    threading.Thread(target=guest_server.serve_forever, daemon=True).start()
    backend = start_backend()
    try:
        out = run_scenario()
        r = out["results"] or {}
        print("host results:", json.dumps({k: r.get(k) for k in ("phase", "guestWindows", "guestWindowsError")}, ensure_ascii=False))
        print("same guest:", json.dumps(out["same"], ensure_ascii=False)[:500])
        print("same unguarded write:", json.dumps(out["same_unguarded"], ensure_ascii=False)[:300])
        print("iso callback:", json.dumps(CALLBACK_DATA, ensure_ascii=False)[:500])
        same = out["same"] or {}
        same_unguarded = out["same_unguarded"] or {}
        iso = CALLBACK_DATA[0] if CALLBACK_DATA else {}
        events = out.get("events") or ""
        check("W1 场景启动且 Rust setup 创建两个 guest WebviewWindow",
              r.get("phase") == "windows-scenario"
              and "guest-same-origin opened by rust setup" in events
              and "guest-custom-origin opened by rust setup" in events,
              [line for line in events.splitlines() if "guest-" in line][:4])
        check("W2 同源 guest 可执行 app 命令（whoami 返回自身 label）", same.get("whoami") == "guest-same-origin", same.get("whoami"))
        check("W3 同源 guest 可调用未守卫写命令（证明 app 命令全局可达）",
              isinstance(same.get("unguarded"), str) and same.get("unguarded", "").endswith("guest-unguarded-write.json"),
              same.get("unguarded"))
        check("W4 同源 guest 被 label 守卫拒绝敏感命令（守卫原型生效）",
              str(same.get("sensitive", "")).startswith("error:E_FORBIDDEN_WEBVIEW"), same.get("sensitive"))
        check("W5 同源 guest 可直连后端 loopback（同源 CORS 放行的风险证据）",
              str(same.get("fetchBackend", "")).startswith("ok:200"), same.get("fetchBackend"))
        check("W6 独立来源 guest 有回调上报（IPC 被拒时的通道）", bool(iso), iso)
        check("W7 独立来源 guest 的 Tauri invoke 被拒（Origin 边界）",
              str(iso.get("whoami", "")).startswith("error:"), iso.get("whoami"))
        check("W8 独立来源 guest 的未守卫写命令也被拒（无法触达命令面）",
              str(iso.get("unguarded", "")).startswith("error:"), iso.get("unguarded"))
        check("W9 独立来源 guest 对后端 loopback 请求被拒",
              str(iso.get("fetchBackend", "")).startswith("blocked:"), iso.get("fetchBackend"))
        check("W10 独立来源 guest 未产生后端/宿主文件副作用",
              not (BASE / "backend-ws" / "Articles" / "guest-should-fail.md").exists()
              and str(same_unguarded.get("origin", "")) != "uiwsguest://localhost",
              f"same_write_origin={same_unguarded.get('origin')}")
        summary = {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "exe": str(EXE), "host_origin": HOST_ORIGIN,
            "backend": f"http://127.0.0.1:{BACKEND_PORT}",
            "checks": checks,
            "pass_count": sum(1 for c in checks if c["pass"]),
            "total": len(checks),
            "raw": {"scenario": out, "iso_callback": CALLBACK_DATA},
            "findings": {
                "app_commands_global_across_webviews": str(same.get("unguarded", "")).endswith("guest-unguarded-write.json"),
                "same_origin_guest_backend_direct_access": str(same.get("fetchBackend", "")).startswith("ok:200"),
                "guarded_command_denied_for_guest": str(same.get("sensitive", "")).startswith("error:E_FORBIDDEN_WEBVIEW"),
                "custom_origin_guest_ipc_rejected": str(iso.get("whoami", "")).startswith("error:"),
                "custom_origin_guest_backend_blocked": str(iso.get("fetchBackend", "")).startswith("blocked:"),
            },
        }
        out_path = EVID / "P0-S1-windows-probe-results.json"
        out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out_path}")
        return 0 if summary["pass_count"] == summary["total"] else 1
    finally:
        server.shutdown()
        guest_server.shutdown()
        backend.kill()
        try:
            backend.wait(timeout=10)
        except subprocess.TimeoutExpired:
            backend.kill()
        kill_probe_app()


if __name__ == "__main__":
    sys.exit(main())
