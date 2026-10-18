# -*- coding: utf-8 -*-
"""P5-T26 A7+A5 真实产品 W 探针：工坊 guest 宿主（启用/能力上限/崩溃/safeMode/停用持久化）。

前置：dist 以 VITE_KE_WORKSHOP=1 构建（工坊入口），隔离测试构建（独立 identifier），隔离 APPDATA/
工作区，env KE_WORKSHOP_PUBKEYS 提供签名公钥，当前源码打包 sidecar 后端。
"""
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
BASE = Path(r"C:\ke-tmp\uiws-t26-guest")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26guest"
CDP_PORT = 9350 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def real_roaming() -> Path:
    """Tauri app_data_dir 在 Windows 用真实 Roaming（不受 env APPDATA 影响）→ 需清理测试 identifier 目录。"""
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('ApplicationData')"],
        capture_output=True, text=True)
    base = out.stdout.strip()
    return Path(base) if base else Path(os.environ.get("APPDATA", ""))


def user_pid() -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
        capture_output=True, text=True)
    return out.stdout.strip()


def cleanup_test_apps() -> None:
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue; "
          "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' -or $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue")
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


def invoke(cdp: CDP, cmd: str, payload: dict) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok: true, value: r}; }"
              " catch (e) { return {ok: false, error: String(e && e.message || e)}; } })()")
    return cdp.eval(expr)  # type: ignore[return-value]


def click_text(cdp: CDP, text: str) -> bool:
    expr = ("(() => { const els = [...document.querySelectorAll('button,[role=button]')];"
            f" const el = els.find(x => (x.textContent || '').includes({json.dumps(text)}));"
            " if (!el) return false; el.click(); return true; })()")
    return bool(cdp.eval(expr))


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
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)
    # Tauri app_data_dir（workshop-packs 所在）在真实 Roaming，清理测试 identifier 目录避免残留
    tauri_appdata = real_roaming() / "com.astranota.uiws.e2e"
    shutil.rmtree(tauri_appdata, ignore_errors=True)
    # WebView2 用户数据目录可能位于 LocalAppData（localStorage/TrustStore 持久化）→ 一并清理
    local_out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('LocalApplicationData')"],
        capture_output=True, text=True)
    local_base = Path(local_out.stdout.strip()) if local_out.stdout.strip() else None
    if local_base:
        shutil.rmtree(local_base / "com.astranota.uiws.e2e", ignore_errors=True)

    # 1) 隔离工作区 + 签名包（能力包含 ui.shell/context.read → 只有 trusted 等级可启用）
    ws = BASE / "workspace"
    try:
        sys.path.insert(0, str(REPO / "backend"))
        from app.services.workspace import ensure_workspace_structure  # type: ignore
        ensure_workspace_structure(ws)
    except Exception:
        for rel in ["Articles", "Modules", "Attachments/images", "Attachments/videos", "Attachments/files"]:
            (ws / rel).mkdir(parents=True, exist_ok=True)
    (ws / "Articles" / "hello.md").write_text("---\ntitle: hello\n---\n\nT26 guest\n", encoding="utf-8")

    key = BASE / "key.pem"
    pub_hex = json.loads(
        subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True, capture_output=True, text=True).stdout
    )["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir(parents=True)
    guest_js = (
        "window.parent.postMessage({type:'guest-heartbeat'},'*');"
        "setInterval(()=>window.parent.postMessage({type:'guest-heartbeat'},'*'),200);"
        "document.body.innerHTML='<div>t26 guest active</div>';"
    )
    entry = f"<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script>{guest_js}</script></body></html>"
    (pack / "index.html").write_text(entry, encoding="utf-8")
    manifest = {
        "id": PACK_ID, "name": "T26 Guest Pack", "version": "1.0.0", "apiVersion": 1,
        "capabilities": ["ui.shell", "panel.sidebar", "context.read"],
        "entry": {"html": "index.html"}, "commands": [],
        "assets": [{"path": "index.html", "sha256": sha(entry)}],
    }
    (pack / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)

    env = dict(os.environ)
    env["APPDATA"] = str(appdata)
    env["KE_WORKSPACE"] = str(ws)
    env["KE_WORKSHOP_PUBKEYS"] = json.dumps({"k1": {"key": pub_hex}})
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
            if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                break
            time.sleep(0.25)
        for _ in range(100):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.25)
        installed = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-A7/A5-1 隔离产品启动并安装签名包", installed.get("ok") is True, installed)
        opened = click_text(cdp, "创意工坊")
        time.sleep(1.0)
        check("W-T26-A7/A5-2 工坊面板打开（真实已安装包）", opened and "T26 Guest Pack" in str(cdp.eval("document.body.innerText || ''")), {"opened": opened})

        # 诊断：面板结构（按钮文本/guest 按钮是否存在）
        diag = cdp.eval("(() => { const btns=[...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim());"
                       " return {buttons: btns.slice(0,40), hasEnable: btns.some(t=>t.includes('启用 guest')),"
                       " iframe: !!document.querySelector('iframe'), body: (document.body.innerText||'').slice(0,1200)}; })()")
        (BASE / "diag-panel.json").write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
        # 默认 community：启用 guest 应被能力上限拒绝
        clicked_enable = click_text(cdp, "启用 guest")
        time.sleep(1.2)
        body = str(cdp.eval("document.body.innerText || ''"))
        (BASE / "diag-after-enable.txt").write_text(body, encoding="utf-8")
        check("W-T26-A5-1 community 等级启用 → E_CAPABILITY_TIER 拒绝（能力上限）",
              "E_CAPABILITY_TIER" in body,
              {"diag": diag, "clickedEnable": clicked_enable, "bodyTail": body[-400:]})

        # 授予 trusted → 启用 guest → active + iframe + 会话状态
        click_text(cdp, "授予信任")
        time.sleep(1.0)
        click_text(cdp, "启用 guest")
        active = False
        for _ in range(80):
            if "guest：active" in str(cdp.eval("document.body.innerText || ''")):
                active = True
                break
            time.sleep(0.25)
        has_iframe = bool(cdp.eval("!!document.querySelector('iframe')"))
        check("W-T26-A7/A5-3 trusted 启用 → guest active + sandbox iframe", active and has_iframe, {"active": active, "iframe": has_iframe})
        status = invoke(cdp, "workshop_pack_session_status", {})
        st = status.get("value") or {}
        check("W-T26-A7/A5-4 会话状态落盘 active（packId/能力子集）",
              status.get("ok") and st.get("state") == "active" and st.get("packId") == PACK_ID and isinstance(st.get("capabilities"), list),
              st)

        hb = cdp.eval("window.__keGuestHeartbeats || 0")
        check("W-T26-A7/A5-5a guest 心跳到达宿主（postMessage）", int(hb or 0) > 0, {"heartbeats": hb})
        # 移除 iframe 模拟 renderer 崩溃 → 心跳中断 → 自动 reportCrash → suspended→failed+safeMode
        cdp.eval("(() => { const f=document.querySelector('iframe'); if(f) f.remove(); return true; })()")
        failed = False
        for _ in range(60):
            st2 = (invoke(cdp, "workshop_pack_session_status", {}).get("value") or {})
            if st2.get("state") == "failed":
                failed = True
                break
            time.sleep(0.4)
        body2 = str(cdp.eval("document.body.innerText || ''"))
        check("W-T26-A7/A5-5 心跳中断自动检测 → 超限 failed", failed, {"state": (invoke(cdp, 'workshop_pack_session_status', {}).get('value') or {}).get('state')})
        check("W-T26-A7/A5-6 safeMode 提示出现（guest 禁用）", "safeMode" in body2, body2[-200:])

        click_text(cdp, "停用 guest")
        time.sleep(1.0)
        st3 = (invoke(cdp, "workshop_pack_session_status", {}).get("value") or {})
        check("W-T26-A7/A5-7 停用 guest → 会话状态持久化 stopped", st3.get("state") == "stopped", st3)
        check("W-T26-A7/A5-8 主进程存活（宿主链路无崩溃）", proc.poll() is None, proc.poll())
        upid = user_pid()
        check("W-T26-A7/A5-9 用户运行中的 AstraNota 未受影响", upid.isdigit(), {"user_pid": upid})
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
        "scenario": "T26 A7/A5 产品 guest 宿主（启用/能力上限/崩溃/safeMode/停用持久化）",
        "exe": str(EXE), "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
    }
    out = EVID / "T26-A7-A5-guest-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
