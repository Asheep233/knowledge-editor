# -*- coding: utf-8 -*-
"""P5-T26 W07 探针：guest 无限循环故障（验证宿主/原生恢复是否独立于 guest）。

预期风险：guest 与宿主在同一 WebView2 渲染进程 → 无限循环阻塞宿主 JS（心跳/检测/UI），
本探针用于**验证并记录该缺口**（W07 若无法独立恢复 → FAIL，不得冒充通过）。
安全：隔离构建/数据目录；超时后按 PID 终止测试进程；不触碰用户实例。
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
BASE = Path(r"C:\ke-tmp\uiws-t26-fault")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26w07"
CDP_PORT = 9790 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"

GUEST = """
<script>
(function(){
  try { window.parent.postMessage({type:'t19-guest-alive'}, '*'); } catch(e) {}
  setTimeout(function(){ var t = Date.now(); while (Date.now() - t < 60000) { /* busy loop: 阻塞渲染进程 */ } }, 600);
})();
</script>
"""


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
        self.ws = websocket.create_connection(url, timeout=5, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None, timeout: float = 3.0) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr: str, timeout: float = 3.0) -> object:
        res = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}, timeout)
        return (res.get("result") or {}).get("value")


def invoke(cdp: CDP, cmd: str, payload: dict, timeout: float = 3.0) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    return cdp.eval(expr, timeout)  # type: ignore[return-value]


def click_text(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")); if(b){b.click(); return true;} return false; })()"))


def main() -> int:
    checks: list[dict] = []

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
    # 修复环境：预置 app_config（recent workspace）与 settings（启动自动打开），避免停在 WorkspacePicker
    ke_cfg_dir = appdata / "KnowledgeEditor"
    ke_cfg_dir.mkdir(parents=True, exist_ok=True)
    (ke_cfg_dir / "app_config.json").write_text(json.dumps({
        "recent_workspaces": [str(ws)], "recent_documents": [],
    }, ensure_ascii=False), encoding="utf-8")
    (ke_cfg_dir / "settings.json").write_text(json.dumps({
        "schema_version": 1,
        "startup": {"auto_open_recent_workspace": True},
    }, ensure_ascii=False), encoding="utf-8")

    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    entry = "<!doctype html><html><body>" + GUEST + "</body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 Fault Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
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
        end = time.time() + 60
        while time.time() < end:
            mains = [t for t in targets() if t.get("type") == "page" and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")]
            if mains:
                cdp = CDP(mains[0]["webSocketDebuggerUrl"])
                break
            time.sleep(0.4)
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        for _ in range(100):
            if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                break
            time.sleep(0.25)
        # 若仍停在 WorkspacePicker（后端已打开 workspace 但 UI 未刷新）→ 重载一次页面
        body0 = str(cdp.eval("document.body.innerText || ''"))
        if "创意工坊" not in body0 and "选择一个工作区开始" in body0:
            cdp.call("Page.reload", {}, timeout=10)
            time.sleep(3.0)
            for _ in range(40):
                if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                    break
                time.sleep(0.3)
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-W07-1 安装签名包（故障包）", inst.get("ok") is True, inst)
        # 等主 UI（自动打开 recent workspace 可能较慢）后再操作工坊
        for _ in range(120):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.25)
        click_text(cdp, "创意工坊")
        for _ in range(60):
            if cdp.eval("(() => [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('启用 guest')))()"):
                break
            time.sleep(0.25)
        click_text(cdp, "授予信任")
        time.sleep(1.5)
        clicked = click_text(cdp, "启用 guest")
        time.sleep(1.2)
        body = str(cdp.eval("document.body.innerText || ''"))
        (BASE / "body.txt").write_text(body, encoding="utf-8")
        diag = cdp.eval("({start: window.__keGuestStart, log: window.__keGuestStatusLog, clicked: "
                        + json.dumps(clicked) + ", bodyTail: " + json.dumps(body[-500:]) + "})")
        (BASE / "diag.json").write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
        print("diag:", json.dumps(diag, ensure_ascii=False)[:600], flush=True)
        # 等待 guest 进入 busy loop（600ms 后），然后检查宿主是否仍可响应
        check("W-T26-W07-2 guest 已启用（进入无限循环前）",
              isinstance(diag, dict) and bool((diag.get("start") or {}).get("hasSession")), diag)
        time.sleep(2.5)
        host_responsive = True
        status = None
        try:
            status = invoke(cdp, "workshop_pack_session_status", {}, timeout=3.0)
        except Exception as e:
            host_responsive = False
            status = {"error": f"host unresponsive: {e}"}
        check("W-T26-W07-3 故障后宿主 IPC 仍可响应（guest 无限循环未阻塞宿主）", host_responsive, status)
        state1 = ((status or {}).get("value") or {}).get("state")
        check("W-T26-W07-4 心跳中断被检测（会话 suspended/failed 可观测）",
              host_responsive and state1 in ("suspended", "failed"), {"state": state1})
        # 持续无心跳 → 连续 crash 超限 → failed + safeMode（原生恢复策略）
        failed = False
        safe_mode_ui = False
        for _ in range(40):
            st = invoke(cdp, "workshop_pack_session_status", {}, timeout=3.0)
            state = ((st or {}).get("value") or {}).get("state")
            if state == "failed":
                failed = True
                break
            time.sleep(0.4)
        body = str(cdp.eval("document.body.innerText || ''"))
        safe_mode_ui = "safeMode" in body
        check("W-T26-W07-5 连续故障超限 → failed + safeMode（宿主侧恢复策略生效）", failed and safe_mode_ui,
              {"failed": failed, "safeMode": safe_mode_ui})
        # 停用可持久化（恢复操作可用）
        click_text(cdp, "停用 guest")
        time.sleep(1.0)
        st_stop = invoke(cdp, "workshop_pack_session_status", {}, timeout=3.0)
        check("W-T26-W07-5b 停用 guest → stopped 持久化（可恢复操作）",
              ((st_stop or {}).get("value") or {}).get("state") == "stopped", st_stop)
        alive = proc.poll() is None
        check("W-T26-W07-5c 测试进程存活（宿主未被 guest 阻塞/无崩溃）", alive, {"alive": alive})
        upid = user_pid()
        check("W-T26-W07-6 用户实例未受影响", upid.isdigit(), {"user_pid": upid})
        if not host_responsive:
            print("W07 结论：guest 无限循环阻塞宿主渲染进程——原生/独立恢复前提不满足（FAIL，已记录缺口）", flush=True)
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
               "scenario": "T26 W07 guest 无限循环故障（宿主独立性验证）",
               "checks": checks, "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks)}
    out = EVID / "T26-W07-fault-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} checks (W07 通过与否见证据文档) -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
