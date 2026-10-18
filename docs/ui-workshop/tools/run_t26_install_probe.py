# -*- coding: utf-8 -*-
"""P5-T26 A4+A6 真实产品 W 探针：签名安装拒绝 + 安装→启用→回滚→卸载（CDP 调真实命令）。

- A4：env 公钥信任根（KE_WORKSHOP_PUBKEYS）→ scan 签名 valid/missing/invalid；
  篡改清单 → install 拒绝（E_SIGNATURE）；撤销密钥 → scan/install 拒绝；
- A6：signed v1/v2 安装 → activate v2 → rollback v1 → uninstall，逐步校验磁盘 state 与列表。
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
BASE = Path(r"C:\ke-tmp\uiws-t26-install")
APPDATA = Path(os.environ.get("APPDATA", r"C:\Users\y8882\AppData\Roaming"))
APP_DATA = APPDATA / "com.astranota.uiws.e2e"
PACK_ROOT = APP_DATA / "workshop-packs"
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26install"
CDP_PORT = 9700 + (os.getpid() % 200)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_pack(dir_path: Path, version: str, content: str) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / "index.html").write_text(content, encoding="utf-8")
    manifest = {
        "id": PACK_ID, "name": "T26 Install Pack", "version": version, "apiVersion": 1,
        "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
        "assets": [{"path": "index.html", "sha256": sha(content)}],
    }
    (dir_path / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def node_sign(pack_dir: Path, key_path: Path) -> None:
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack_dir), "--key", str(key_path),
                    "--keyid", "k1", "--write"], check=True, capture_output=True, text=True)


def gen_key(key_path: Path) -> str:
    out = subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key_path)],
                         check=True, capture_output=True, text=True).stdout
    data = json.loads(out)
    return data["publicKeyHex"]


def cleanup_sidecars() -> None:
    ps = ("Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
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


def cleanup_stale_test_apps() -> None:
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    cleanup_sidecars()


def launch(keyring: dict) -> tuple[subprocess.Popen, CDP, Path]:
    cleanup_stale_test_apps()
    log = BASE / f"app-{int(time.time()*1000)}.log"
    # 红线：产品 data_dir() = %APPDATA%\KnowledgeEditor（不随 identifier 变化）→ 必须隔离 APPDATA
    isolated_appdata = BASE / "appdata"
    isolated_appdata.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["APPDATA"] = str(isolated_appdata)
    env["KE_WORKSHOP_PUBKEYS"] = json.dumps(keyring)
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={CDP_PORT}"
    proc = subprocess.Popen([str(EXE)], env=env, stdout=open(log, "w", encoding="utf-8"), stderr=subprocess.STDOUT)
    end = time.time() + 60
    cdp = None
    while time.time() < end:
        targets = [t for t in cdp_targets() if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
        main = [t for t in targets if "tauri.localhost" in str(t.get("url", ""))]
        if main:
            cdp = CDP(main[0]["webSocketDebuggerUrl"])
            break
        time.sleep(0.4)
    if cdp is None:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        cleanup_sidecars()
        raise RuntimeError("CDP 主窗口未就绪")
    for _ in range(80):
        if cdp.eval("typeof window.__TAURI_INTERNALS__ === 'object' && typeof window.__TAURI_INTERNALS__.invoke === 'function'"):
            break
        time.sleep(0.25)
    return proc, cdp, log


def invoke(cdp: CDP, cmd: str, payload: dict) -> dict:
    expr = (
        "(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
        + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok: true, value: r}; }"
        " catch (e) { return {ok: false, error: String(e && e.message || e)}; } })()"
    )
    return cdp.eval(expr)  # type: ignore[return-value]


def stop(proc: subprocess.Popen, cdp: CDP | None) -> None:
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


def user_pid() -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
        capture_output=True, text=True,
    )
    return out.stdout.strip()


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)

    if not EXE.exists():
        print(f"缺少隔离测试构建: {EXE}")
        return 2
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True, exist_ok=True)
    if APP_DATA.exists():
        shutil.rmtree(APP_DATA, ignore_errors=True)

    # 1) 生成密钥 + 包（signed v1/v2、tampered、unsigned）
    key_path = BASE / "keys" / "release.pem"
    key_path.parent.mkdir(parents=True)
    pub_hex = gen_key(key_path)
    p_v1, p_v2 = BASE / "packs" / "v1", BASE / "packs" / "v2"
    p_bad, p_unsigned = BASE / "packs" / "bad", BASE / "packs" / "unsigned"
    write_pack(p_v1, "1.0.0", "<html>signed v1</html>")
    node_sign(p_v1, key_path)
    write_pack(p_v2, "2.0.0", "<html>signed v2</html>")
    node_sign(p_v2, key_path)
    write_pack(p_bad, "9.9.9", "<html>tampered</html>")
    node_sign(p_bad, key_path)
    manifest = json.loads((p_bad / "manifest.json").read_text(encoding="utf-8"))
    manifest["version"] = "9.9.8"  # 签名后篡改 → invalid
    (p_bad / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_pack(p_unsigned, "3.0.0", "<html>unsigned</html>")
    check("W-T26-A4-1 测试包准备（signed v1/v2、tampered、unsigned）", pub_hex != "", {"publicKeyHex": pub_hex[:16] + "…"})

    keyring = {"k1": {"key": pub_hex}}
    proc, cdp, log = launch(keyring)
    try:
        r = invoke(cdp, "workshop_pack_scan", {"sourceDir": str(p_v1)})
        check("W-T26-A4-2 有效签名 scan → signatureStatus=valid", r.get("ok") and (r.get("value") or {}).get("signatureStatus") == "valid", r)
        r = invoke(cdp, "workshop_pack_scan", {"sourceDir": str(p_unsigned)})
        check("W-T26-A4-3 未签名 scan → signatureStatus=missing", r.get("ok") and (r.get("value") or {}).get("signatureStatus") == "missing", r)
        r = invoke(cdp, "workshop_pack_scan", {"sourceDir": str(p_bad)})
        bad_val = r.get("value") or {}
        check("W-T26-A4-4 篡改清单 scan → signatureStatus=invalid", r.get("ok") and bad_val.get("signatureStatus") == "invalid", {"signatureStatus": bad_val.get("signatureStatus"), "reason": bad_val.get("signatureReason")})
        r = invoke(cdp, "workshop_pack_install", {"sourceDir": str(p_bad)})
        check("W-T26-A4-5 篡改包 install → 拒绝（E_SIGNATURE）", r.get("ok") is False and "E_SIGNATURE" in str(r.get("error")), r)
        r = invoke(cdp, "workshop_pack_install", {"sourceDir": str(p_v1)})
        check("W-T26-A6-1 安装 signed v1 → 成功、active=1.0.0", r.get("ok") and (r.get("value") or {}).get("active") == "1.0.0", r)
        r = invoke(cdp, "workshop_pack_list", {})
        packs = ((r.get("value") or {}).get("packs") or [])
        check("W-T26-A6-2 安装列表：signatureStatus=valid", r.get("ok") and packs and packs[0].get("signatureStatus") == "valid" and packs[0].get("activeVersion") == "1.0.0", {"packs": packs[:2]})
        r = invoke(cdp, "workshop_pack_install", {"sourceDir": str(p_v2)})
        check("W-T26-A6-3 安装 signed v2 → 成功", r.get("ok"), r)
        # 安装 v2 已自动激活（active=2.0.0/previous=1.0.0）；activate 当前 active 必须幂等（不改 previous）
        r = invoke(cdp, "workshop_pack_activate", {"id": PACK_ID, "version": "2.0.0"})
        st = (r.get("value") or {})
        check("W-T26-A6-4 activate 当前 active → 幂等（active=2.0.0/previous 仍 1.0.0）",
              r.get("ok") and st.get("active") == "2.0.0" and st.get("previous") == "1.0.0", st)
        r = invoke(cdp, "workshop_pack_rollback", {"id": PACK_ID})
        st = (r.get("value") or {})
        check("W-T26-A6-5 rollback → active=1.0.0 / previous=2.0.0", r.get("ok") and st.get("active") == "1.0.0" and st.get("previous") == "2.0.0", st)
        r = invoke(cdp, "workshop_pack_uninstall", {"id": PACK_ID})
        r2 = invoke(cdp, "workshop_pack_list", {})
        dir_gone = not (PACK_ROOT / PACK_ID).exists()
        check("W-T26-A6-6 uninstall → 列表为空、包目录删除", r.get("ok") and dir_gone and not ((r2.get("value") or {}).get("packs") or []), {"uninstall": r, "dirGone": dir_gone})
        check("W-T26-A6-7 主进程存活（命令链路无崩溃）", proc.poll() is None, proc.poll())
    finally:
        stop(proc, cdp)

    # 2) 撤销密钥场景（新进程 + revoked keyring）
    proc2, cdp2, _ = launch({"k1": {"key": pub_hex, "revoked": True}})
    try:
        r = invoke(cdp2, "workshop_pack_scan", {"sourceDir": str(p_v1)})
        val = r.get("value") or {}
        check("W-T26-A4-6 撤销密钥 scan → invalid（E_SIGNATURE_REVOKED）", r.get("ok") and val.get("signatureStatus") == "invalid" and "E_SIGNATURE_REVOKED" in str(val.get("signatureReason")), {"status": val.get("signatureStatus"), "reason": val.get("signatureReason")})
        r = invoke(cdp2, "workshop_pack_install", {"sourceDir": str(p_v1)})
        check("W-T26-A4-7 撤销密钥 install → 拒绝", r.get("ok") is False, r)
        check("W-T26-A4-8 撤销场景主进程存活", proc2.poll() is None, proc2.poll())
    finally:
        stop(proc2, cdp2)

    upid = user_pid()
    check("W-T26-A4/A6-9 用户运行中的 AstraNota 未受影响（PID 存在）", upid.isdigit(), {"user_pid": upid})

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 A4 签名安装拒绝 + A6 安装/启用/回滚/卸载（真实产品壳隔离构建）",
        "exe": str(EXE), "publicKeyHex": pub_hex,
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]), "total": len(checks),
    }
    out = EVID / "T26-A4-A6-install-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
