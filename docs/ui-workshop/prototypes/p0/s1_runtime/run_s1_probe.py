# -*- coding: utf-8 -*-
"""P0-S1 实机探针：Windows/WebView2 + 迷你 Tauri 宿主原型。

流程：
  1) 启动隔离后端（Windows Python + uvicorn，临时工作区，端口 8101）
  2) 运行原型 app（正常路径）：宿主创建 sandbox allow-scripts iframe（独立 opaque origin），
     MessagePort 握手，guest 执行 DOM/宿主 IPC/后端 loopback/worker/WS/导航/下载 探测；
     Rust 命令面写 results.json 后退出。
  3) 恢复路径：模拟坏包启动崩溃（写 bootPending 后 exit 99）两次 → 第三次启动 Rust
     判定连续失败进入 safe mode（官方兜底）→ 宿主从 safe mode 显式恢复。
  4) 断言：guest 不可访问宿主 DOM/宿主 IPC；guest 对后端读写与宿主源 fetch 被拒；
     guest 写入无副作用；恢复动作由 Rust 状态驱动。
运行（Windows Python）：python run_s1_probe.py
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

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-s1-probe")
WINPY = Path(r"C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
BACKEND_PORT = 8101
HOST_ORIGIN = "http://tauri.localhost"


def reset() -> None:
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    (BASE / "backend-ws" / "Articles").mkdir(parents=True, exist_ok=True)
    (BASE / "backend-ws" / "Attachments").mkdir(parents=True, exist_ok=True)


def start_backend() -> subprocess.Popen:
    env = dict(os.environ)
    env.update(
        {
            "KE_WORKSPACE": str(BASE / "backend-ws"),
            "KE_APP_CONFIG": str(BASE / "app_config.json"),
            "KE_APP_CONFIG_LEGACY": str(BASE / "legacy-missing.json"),
            "KE_CORS_ORIGINS": HOST_ORIGIN,
            "PYTHONIOENCODING": "utf-8",
        }
    )
    log = (BASE / "backend.log").open("w", encoding="utf-8")
    p = subprocess.Popen(
        [
            str(WINPY), "-m", "uvicorn", "app.main:app",
            "--app-dir", str(REPO / "backend"),
            "--host", "127.0.0.1", "--port", str(BACKEND_PORT),
        ],
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
    raise RuntimeError("backend 未就绪（见 backend.log）")


def run_app(probe_dir: Path, extra_env: dict | None = None, timeout: int = 120, fresh: bool = True) -> dict:
    if fresh and probe_dir.exists():
        shutil.rmtree(probe_dir, ignore_errors=True)
    probe_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.update(
        {
            "S1_PROBE_DIR": str(probe_dir),
            "S1_BACKEND_BASE": f"http://127.0.0.1:{BACKEND_PORT}",
            "S1_HOST_ORIGIN": HOST_ORIGIN,
        }
    )
    env.update(extra_env or {})
    p = subprocess.Popen([str(EXE)], env=env)
    results = None
    end = time.time() + timeout
    while time.time() < end:
        f = probe_dir / "results.json"
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
        p.wait(timeout=20)
    except subprocess.TimeoutExpired:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    events = (probe_dir / "events.log").read_text(encoding="utf-8") if (probe_dir / "events.log").exists() else ""
    recovered = (probe_dir / "recovered.json").read_text(encoding="utf-8") if (probe_dir / "recovered.json").exists() else None
    return {
        "exit_code": p.poll(),
        "results": results,
        "events": events,
        "recovered": json.loads(recovered) if recovered else None,
        "boot_pending_left": (probe_dir / "bootPending.json").exists(),
        "safe_mode_file": json.loads((probe_dir / "safe-mode.json").read_text(encoding="utf-8"))
        if (probe_dir / "safe-mode.json").exists() else None,
    }


def kill_probe_app() -> None:
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:220], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}（先 cargo build --release）")
        return 2
    EVID.mkdir(parents=True, exist_ok=True)
    reset()
    backend = start_backend()
    try:
        print("== 1) 正常路径：sandbox iframe + MessagePort + 权限探测 ==")
        normal = run_app(BASE / "probe-normal")
        r = normal["results"] or {}
        host = (r.get("host") or {})
        guest = (r.get("guest") or {})
        print("host:", json.dumps(host, ensure_ascii=False)[:400])
        print("guest:", json.dumps(guest, ensure_ascii=False)[:800])
        check("H1 宿主 Tauri IPC 可用（invoke 正常）", host.get("invokeOkay") is True, host.get("invokeOkay"))
        check("H2 宿主可访问后端 health", str(host.get("fetchBackend", "")).startswith("ok:"), host.get("fetchBackend"))
        check("G1 guest 无 Tauri IPC（__TAURI_INTERNALS__ undefined）", guest.get("tauriInternals") == "undefined", guest.get("tauriInternals"))
        check("G2 guest 无全局 Tauri API", guest.get("tauriGlobal") == "undefined", guest.get("tauriGlobal"))
        check("G3 guest 无法访问 parent DOM", guest.get("parentDom") in ("SecurityError", "ACCESSIBLE") and guest.get("parentDom") == "SecurityError", guest.get("parentDom"))
        check("G4 guest 无法访问 top DOM", guest.get("topDom") == "SecurityError", guest.get("topDom"))
        check("G5 guest 不能导航宿主顶层", guest.get("topNav") not in ("ALLOWED",), guest.get("topNav"))
        check("G6 guest popup 被 sandbox 阻止", guest.get("popup") in ("null", "undefined") or "blocked" in str(guest.get("popup")), guest.get("popup"))
        check("G7 guest Worker 可运行（沙箱内脚本能力存在）", guest.get("worker") == "alive", guest.get("worker"))
        check("G8 guest 对后端 health 跨源读取被拒", str(guest.get("fetchBackendHealth", "")).startswith("blocked:"), guest.get("fetchBackendHealth"))
        check("G9 guest 对后端写请求被拒", str(guest.get("fetchBackendWrite", "")).startswith("blocked:"), guest.get("fetchBackendWrite"))
        check("G10 guest 对宿主源 fetch 被拒", str(guest.get("fetchHostOrigin", "")).startswith("blocked:"), guest.get("fetchHostOrigin"))
        check("G11 guest WebSocket 探测记录", guest.get("websocket") in ("error", "timeout", "blocked", "SecurityError", "SyntaxError"), guest.get("websocket"))
        check("G12 guest 下载被 sandbox 记录", guest.get("download") in ("attempted",) or "blocked" in str(guest.get("download")), guest.get("download"))
        side_effect = (BASE / "backend-ws" / "Articles" / "guest-should-fail.md").exists()
        check("G13 guest 写请求无副作用（后端未创建文档）", not side_effect, f"file_exists={side_effect}")
        guest_invoke = str(guest.get("guestInvoke", ""))
        guest_call_file = (BASE / "probe-normal" / "guest-call.json")
        check(
            "G14 guest 不能调用宿主 Rust 命令（隔离边界）",
            not guest_invoke.startswith("CALLABLE:"),
            f"guestInvoke={guest_invoke[:160]} guest_call_file={guest_call_file.exists()}",
        )
        same = (r.get("guestSameOrigin") or {})
        same_invoke = str(same.get("invoke", ""))
        check(
            "G16 同源 iframe 可调用宿主命令（证明隔离边界=Origin 校验，包必须跨源）",
            same_invoke.startswith("CALLABLE:"),
            f"sameOriginInvoke={same_invoke[:120]} origin={same.get('origin')} href={same.get('href')}",
        )
        check(
            "G15 guest 的 Tauri IPC 可见性记录（iframe 继承 webview IPC 证据）",
            guest.get("tauriInternals") is not None,
            f"tauriInternals={guest.get('tauriInternals')} tauriGlobal={guest.get('tauriGlobal')}",
        )
        check("H3 Rust 健康标记后 bootPending 清除", not normal["boot_pending_left"], normal["boot_pending_left"])

        print("== 2) 恢复路径：坏启动崩溃 ×2 → Rust safe mode → 显式恢复 ==")
        recovery_dir = BASE / "probe-recovery"
        bad1 = run_app(recovery_dir, {"S1_BAD_START": "1"}, timeout=40, fresh=True)
        bad2 = run_app(recovery_dir, {"S1_BAD_START": "1"}, timeout=40, fresh=False)
        check("R1 坏启动模拟崩溃（exit 99）", bad1["exit_code"] == 99 and bad2["exit_code"] == 99,
              f"{bad1['exit_code']}/{bad2['exit_code']}")
        safe = run_app(recovery_dir, timeout=60, fresh=False)
        sr = safe["results"] or {}
        check("R2 连续失败后 Rust 进入 safe mode", bool((sr.get("boot") or {}).get("safe_mode")) is True,
              (sr.get("boot") or {}).get("safe_mode"))
        check("R3 safe mode 由 Rust 状态文件记录", bool(safe["safe_mode_file"]), safe["safe_mode_file"])
        check("R4 宿主从 safe mode 显式恢复到官方", safe["recovered"] is not None, safe["recovered"])
        check("R5 恢复后 bootPending 清除", not safe["boot_pending_left"], safe["boot_pending_left"])
        check("R6 事件日志记录 Rust 恢复过程", "safe-mode-entered" in (safe["events"] or ""), (safe["events"] or "")[:160])

        summary = {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "exe": str(EXE),
            "host_origin": HOST_ORIGIN,
            "backend": f"http://127.0.0.1:{BACKEND_PORT}",
            "checks": checks,
            "pass_count": sum(1 for c in checks if c["pass"]),
            "total": len(checks),
            "raw": {"normal": normal, "bad1": bad1, "bad2": bad2, "safe": safe},
            "findings": {
                "iframe_inherits_tauri_globals": (r.get("guest") or {}).get("tauriInternals") == "object",
                "opaque_origin_invoke_rejected": str(((r.get("guest") or {}).get("guestInvoke", ""))).startswith("error:"),
                "same_origin_iframe_invoke_allowed": same_invoke.startswith("CALLABLE:"),
            },
        }
        out = EVID / "P0-S1-probe-results.json"
        out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
        return 0 if summary["pass_count"] == summary["total"] else 1
    finally:
        backend.kill()
        try:
            backend.wait(timeout=10)
        except subprocess.TimeoutExpired:
            backend.kill()
        kill_probe_app()


if __name__ == "__main__":
    sys.exit(main())
