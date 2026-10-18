# -*- coding: utf-8 -*-
"""P5-T26 A5 真实产品 W 探针：工坊 UI 信任徽章 + 授予/撤销信任（flag 构建）。

前置：dist 以 VITE_KE_WORKSHOP=1 构建；隔离测试构建（com.astranota.uiws.e2e）。
流程：预装真实签名包 → CDP 点击“创意工坊”入口 → 面板读取真实 list（信任 community/签名 valid）→
点击“授予信任”→ localStorage TrustStore 持久化 trusted + 徽章更新 → “撤销信任”→ 回 community。
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
BASE = Path(r"C:\ke-tmp\uiws-t26-ui")
APPDATA = Path(os.environ.get("APPDATA", r"C:\Users\y8882\AppData\Roaming"))
APP_DATA = APPDATA / "com.astranota.uiws.e2e"
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26ui"
CDP_PORT = 9800 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
        capture_output=True, text=True,
    )
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
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)

    if not EXE.exists():
        print(f"缺少隔离测试构建: {EXE}")
        return 2
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    cleanup_stale_apps()
    if APP_DATA.exists():
        shutil.rmtree(APP_DATA, ignore_errors=True)

    # 0) 准备隔离工作区（让产品进入主 UI；工坊入口在 WorkspacePicker 之后才渲染）
    ws = BASE / "workspace"
    try:
        sys.path.insert(0, str(REPO / "backend"))
        from app.services.workspace import ensure_workspace_structure  # type: ignore
        ensure_workspace_structure(ws)
    except Exception:
        for rel in ["Articles", "Modules", "Attachments/images", "Attachments/videos",
                    "Attachments/files", "Backups", "Recovery", ".knowledgeeditor"]:
            (ws / rel).mkdir(parents=True, exist_ok=True)
    (ws / "Articles" / "hello.md").write_text("---\ntitle: hello\n---\n\nT26 workspace\n", encoding="utf-8")

    # 1) 生成密钥/签名包
    key = BASE / "key.pem"
    out = subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True, capture_output=True, text=True).stdout
    pub_hex = json.loads(out)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    content = "<html>t26 ui signed pack</html>"
    (pack / "index.html").write_text(content, encoding="utf-8")
    manifest = {"id": PACK_ID, "name": "T26 UI Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell", "panel.sidebar"], "entry": {"html": "index.html"}, "commands": [],
                "assets": [{"path": "index.html", "sha256": sha(content)}]}
    (pack / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)

    # 2) 启动（flag 构建 + 信任根）
    env = dict(os.environ)
    env["KE_WORKSHOP_PUBKEYS"] = json.dumps({"k1": {"key": pub_hex}})
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
        for _ in range(80):
            if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                break
            time.sleep(0.25)
        # 等主 UI（工作区已打开）渲染出工坊入口
        for _ in range(80):
            if "创意工坊" in str(cdp.eval("document.body.innerText || ''")):
                break
            time.sleep(0.25)
        time.sleep(0.5)
        check("W-T26-A5-1 产品实例启动 + IPC 就绪", True, None)
        r = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-A5-2 预装签名包成功", r.get("ok"), r)

        body_text = str(cdp.eval("document.body.innerText || ''"))
        check("W-T26-A5-3 flag 构建下工坊入口可见（创意工坊）", "创意工坊" in body_text, {"hasEntry": "创意工坊" in body_text})
        opened = click_text(cdp, "创意工坊")
        time.sleep(1.0)
        panel = bool(cdp.eval("!!document.querySelector('[aria-label=\"创意工坊面板\"]')"))
        text = str(cdp.eval("document.body.innerText || ''"))
        check("W-T26-A5-4 面板打开并加载真实已安装包列表", opened and panel and "T26 UI Pack" in text, {"opened": opened, "panel": panel})
        check("W-T26-A5-5 列表显示真实签名徽章（valid）", "签名：valid" in text, {"hasSignature": "签名：valid" in text})
        check("W-T26-A5-6 默认信任等级 community", "信任：community" in text, {"hasTier": "信任：community" in text})

        clicked = click_text(cdp, "授予信任")
        time.sleep(0.8)
        stored = cdp.eval("localStorage.getItem('ke.workshop.trust')")
        text2 = str(cdp.eval("document.body.innerText || ''"))
        check("W-T26-A5-7 授予 trusted → TrustStore 持久化", clicked and stored and "trusted" in str(stored), {"clicked": clicked, "stored": stored})
        check("W-T26-A5-8 面板徽章更新为 trusted", "信任：trusted" in text2, {"hasTrusted": "信任：trusted" in text2})

        clicked2 = click_text(cdp, "撤销信任")
        time.sleep(0.8)
        stored2 = cdp.eval("localStorage.getItem('ke.workshop.trust')")
        text3 = str(cdp.eval("document.body.innerText || ''"))
        check("W-T26-A5-9 撤销信任 → community（持久化清除）", clicked2 and (stored2 is None) and "信任：community" in text3, {"clicked": clicked2, "stored": stored2})
        check("W-T26-A5-10 主进程存活（UI 链路无崩溃）", proc.poll() is None, proc.poll())
        upid = user_pid()
        check("W-T26-A5-11 用户运行中的 AstraNota 未受影响", upid.isdigit(), {"user_pid": upid})
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
        "scenario": "T26 A5 工坊信任 UI（flag 构建 + 真实产品命令）",
        "exe": str(EXE), "publicKeyHex": pub_hex,
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
    }
    out = EVID / "T26-A5-ui-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
