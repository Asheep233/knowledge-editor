# -*- coding: utf-8 -*-
"""安装态工坊冒烟；仅 Windows 快照 VM，JSON 证据与每次独立的测试数据。

守卫：Windows、KE_CLOUD_VM=1、--snapshot-id（或 KE_CLOUD_SNAPSHOT_ID）。
yes 必需签名包目录与公钥；no 验证默认包入口隐藏。快照 ID 是操作者的记录，
不代表脚本已验证虚拟化平台或创建快照。依赖 websocket-client、psutil 仅在执行时加载。
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib
import json
import math
import os
from pathlib import Path
import platform
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


class CDP:
    def __init__(self, url: str):
        websocket = importlib.import_module("websocket")
        self.ws = websocket.create_connection(url, timeout=30, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.monotonic() + 60
        while time.monotonic() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr: str):
        result = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        if result.get("exceptionDetails"):
            raise RuntimeError("JavaScript exception: " + json.dumps(result["exceptionDetails"], ensure_ascii=False))
        remote = result.get("result")
        if not isinstance(remote, dict) or remote.get("subtype") == "error":
            raise RuntimeError("Invalid Runtime.evaluate response: " + str(result))
        return remote.get("value")


def targets(port: int):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/json/list", timeout=2) as response:
            value = json.loads(response.read().decode("utf-8"))
        return value if isinstance(value, list) else []
    except (OSError, ValueError):
        return []


def invoke(cdp: CDP, cmd: str, payload: dict):
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    result = cdp.eval(expr)
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeError(f"{cmd}: {result}")
    return result.get("value")


def button_expr(text: str, pack_id: str | None = None, click: bool = False) -> str:
    scope = "document"
    if pack_id is not None:
        scope = ("([...document.querySelectorAll('section[aria-label=\"创意工坊\"] li')].find(li => "
                 "[...li.querySelectorAll('span')].some(s => (s.textContent||'').trim() === "
                 + json.dumps(pack_id) + ")))")
    action = "if(b){b.click();return true;} return false;" if click else "return !!b;"
    is_entry = pack_id is None and text == "创意工坊"
    enabled = "" if is_entry and not click else "!b.disabled && "
    match_text = ("b.getAttribute('aria-label') === '打开创意工坊'" if is_entry else
                  "(b.textContent||'').trim() === " + json.dumps(text))
    return ("(() => { const scope=" + scope + "; if(!scope)return false;"
            "const b=[...scope.querySelectorAll('button')].find(b=> " + enabled +
            "b.getClientRects().length>0 && getComputedStyle(b).visibility!=='hidden' && "
            + match_text + ");" + action + "})()")


class OwnedProcesses:
    """psutil Process 使用 PID + 创建时间，拒绝操作已被复用的 PID。"""
    def __init__(self, proc: subprocess.Popen):
        self.proc = proc
        self.psutil = importlib.import_module("psutil")
        if proc.poll() is not None:
            raise RuntimeError("启动进程已退出，无法确认本次进程树；未清理其他实例")
        root = self.psutil.Process(proc.pid)
        created = root.create_time()
        if proc.poll() is not None:
            raise RuntimeError("启动进程在建立进程树时退出")
        self.owned = {(root.pid, created): root}
        self.refresh()

    def refresh(self):
        for process in list(self.owned.values()):
            try:
                if process.is_running():
                    for child in process.children(recursive=True):
                        self.owned[(child.pid, child.create_time())] = child
            except self.psutil.NoSuchProcess:
                pass

    def cleanup(self) -> dict:
        errors = []
        try:
            self.refresh()
        except Exception as exc:
            errors.append(f"enumeration: {exc}")
        for _identity, process in sorted(self.owned.items(), reverse=True, key=lambda item: item[0][1]):
            try:
                if process.is_running():
                    process.kill()
            except self.psutil.NoSuchProcess:
                pass
            except Exception as exc:
                errors.append(f"kill {process.pid}: {exc}")
        try:
            self.psutil.wait_procs(list(self.owned.values()), timeout=10)
        except Exception as exc:
            errors.append(f"wait: {exc}")
        residual = []
        for process in self.owned.values():
            try:
                if process.is_running():
                    residual.append(process.pid)
            except self.psutil.NoSuchProcess:
                pass
            except Exception as exc:
                errors.append(f"residual {process.pid}: {exc}")
        self.proc.poll()
        return {"ownedPids": sorted({pid for pid, _created in self.owned}),
                "residualPids": sorted(set(residual)), "errors": errors}


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--exe", default="", help="已安装 knowledgeeditor.exe 的路径")
    ap.add_argument("--expect-entry", choices=["yes", "no"], default="yes")
    ap.add_argument("--port", type=int, default=9333)
    ap.add_argument("--data-dir", default=r"C:\ke-cloud\data", help="新建 smoke-* 子目录；保留已有数据")
    ap.add_argument("--pack-dir", default="")
    ap.add_argument("--pubkeys", default="", help="公钥 JSON，也可用 KE_WORKSHOP_PUBKEYS")
    ap.add_argument("--snapshot-id", default="", help="运行前的 VM 快照 ID，也可用 KE_CLOUD_SNAPSHOT_ID")
    ap.add_argument("--startup-timeout", type=float, default=180)
    ap.add_argument("--ui-timeout", type=float, default=30)
    ap.add_argument("--hidden-observe-seconds", type=float, default=5)
    ap.add_argument("--out", default=r"C:\ke-cloud\evidence\cloud-workshop-verify.json")
    return ap


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    checks: list[dict] = []
    summary = {"generatedAt": datetime.now(timezone.utc).isoformat(), "exe": args.exe,
               "expectEntry": args.expect_entry, "platform": platform.system(),
               "snapshotId": args.snapshot_id or os.environ.get("KE_CLOUD_SNAPSHOT_ID", ""),
               "executed": False, "smokeCompleted": False, "status": "BLOCKED", "checks": checks}
    proc = cdp = log = tracker = None
    cleanup_ok = interrupted = False

    def check(name, ok, detail=None):
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)
        return bool(ok)

    def require(name, ok, detail=None):
        if not check(name, ok, detail):
            raise RuntimeError(name)

    last_refresh = 0.0

    def tick():
        nonlocal last_refresh
        if proc.poll() is not None:
            raise RuntimeError(f"主进程提前退出: {proc.returncode}")
        if time.monotonic() - last_refresh >= 2:
            tracker.refresh()
            last_refresh = time.monotonic()

    def wait_for(predicate, timeout):
        end = time.monotonic() + timeout
        while True:
            tick()
            value = predicate()
            if value:
                return value
            if time.monotonic() >= end:
                return None
            time.sleep(0.25)

    try:
        check("Windows VM 执行守卫", platform.system() == "Windows" and os.environ.get("KE_CLOUD_VM") == "1",
              {"platform": platform.system(), "KE_CLOUD_VM": os.environ.get("KE_CLOUD_VM", "")})
        check("已记录运行前快照标识", bool(summary["snapshotId"].strip()), summary["snapshotId"])
        check("安装产物存在", bool(args.exe) and Path(args.exe).is_file(), args.exe)
        check("超时和端口参数有效", 1 <= args.port <= 65535 and args.startup_timeout > 0
              and args.ui_timeout > 0 and args.hidden_observe_seconds >= 1
              and all(math.isfinite(value) for value in
                      (args.startup_timeout, args.ui_timeout, args.hidden_observe_seconds)))
        pubkeys = args.pubkeys or os.environ.get("KE_WORKSHOP_PUBKEYS", "")
        pack_id = version = None
        if args.expect_entry == "yes":
            check("完整冒烟必须提供签名包目录和公钥", bool(args.pack_dir) and bool(pubkeys))
            if args.pack_dir and pubkeys:
                manifest = json.loads((Path(args.pack_dir) / "manifest.json").read_text(encoding="utf-8"))
                keys = json.loads(pubkeys)
                sig = manifest.get("signature") or {}
                key = keys.get(sig.get("keyId"), {}) if isinstance(keys, dict) else {}
                pack_id, version = manifest.get("id"), manifest.get("version")
                check("签名测试包和公钥配置结构有效", isinstance(pack_id, str) and bool(pack_id)
                      and isinstance(version, str) and bool(version) and sig.get("alg") == "ed25519"
                      and isinstance(key, dict) and bool(re.fullmatch(r"[0-9a-fA-F]{64}", str(key.get("key", ""))))
                      and bool(re.fullmatch(r"[0-9a-fA-F]{128}", str(sig.get("signature", "")))),
                      {"packId": pack_id, "version": version, "keyId": sig.get("keyId"),
                       "note": "仅核对输入结构，真实签名由后端 scan/list 验证"})
        if any(not c["pass"] for c in checks):
            return 2
        for module_name, attribute in (("websocket", "create_connection"), ("psutil", "Process")):
            try:
                module = importlib.import_module(module_name)
            except ImportError as exc:
                check("执行依赖可用", False, f"{exc}; pip install websocket-client psutil")
                return 2
            require("执行依赖可用 " + module_name, callable(getattr(module, attribute, None)))
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", args.port))
        check("CDP 端口启动前可用", True, args.port)
        base = Path(args.data_dir).resolve()
        base.mkdir(parents=True, exist_ok=True)
        run_dir = Path(tempfile.mkdtemp(prefix="smoke-", dir=base))
        summary["runDataDir"] = str(run_dir)
        workspace, appdata = run_dir / "workspace", run_dir / "appdata"
        ke_dir = appdata / "KnowledgeEditor"
        for directory in (workspace / "Articles", ke_dir, run_dir / "localappdata", run_dir / "temp", run_dir / "webview"):
            directory.mkdir(parents=True)
        (workspace / "Articles" / "a.md").write_text("---\ntitle: cloud\n---\n\ncloud verify\n", encoding="utf-8")
        (ke_dir / "app_config.json").write_text(json.dumps({"recent_workspaces": [str(workspace)], "recent_documents": []}), encoding="utf-8")
        (ke_dir / "settings.json").write_text(json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8")
        env = dict(os.environ)
        env.update({"APPDATA": str(appdata), "LOCALAPPDATA": str(run_dir / "localappdata"),
                    "TEMP": str(run_dir / "temp"), "TMP": str(run_dir / "temp"), "KE_WORKSPACE": str(workspace),
                    "WEBVIEW2_USER_DATA_FOLDER": str(run_dir / "webview"),
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={args.port} --remote-debugging-address=127.0.0.1"})
        if pubkeys:
            env["KE_WORKSHOP_PUBKEYS"] = pubkeys
        log = (run_dir / "app.log").open("w", encoding="utf-8")
        proc = subprocess.Popen([str(Path(args.exe).resolve())], env=env, stdout=log, stderr=subprocess.STDOUT)
        summary.update({"executed": True, "status": "FAIL", "pid": proc.pid})
        tracker = OwnedProcesses(proc)
        startup_end = time.monotonic() + args.startup_timeout
        mains = wait_for(lambda: [t for t in targets(args.port) if t.get("type") == "page"
                        and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")], args.startup_timeout)
        require("安装态产品启动 + CDP 主窗口就绪", bool(mains))
        cdp = CDP(mains[0]["webSocketDebuggerUrl"])
        require("产品前端与 Tauri invoke 就绪", bool(wait_for(lambda: cdp.eval(
            "document.readyState==='complete' && !!document.querySelector('#root')?.children.length && "
            "typeof window.__TAURI_INTERNALS__?.invoke === 'function'"), max(0, startup_end - time.monotonic()))))
        if args.expect_entry == "no":
            end, visible = time.monotonic() + args.hidden_observe_seconds, False
            while time.monotonic() < end:
                tick()
                visible = visible or bool(cdp.eval(button_expr("创意工坊")))
                time.sleep(0.25)
            require("默认生产包工坊入口持续隐藏", not visible, {"observeSeconds": args.hidden_observe_seconds})
        else:
            require("workshop-enabled 工坊入口可见", bool(wait_for(lambda: cdp.eval(button_expr("创意工坊")), args.ui_timeout)))
            scan = invoke(cdp, "workshop_pack_scan", {"sourceDir": str(Path(args.pack_dir).resolve())})
            require("后端扫描验证签名 valid", isinstance(scan, dict) and scan.get("signatureStatus") == "valid"
                    and scan.get("packId") == pack_id and scan.get("version") == version, scan)
            inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(Path(args.pack_dir).resolve())})
            require("签名包安装并激活目标版本", isinstance(inst, dict) and inst.get("active") == version, inst)
            listing = invoke(cdp, "workshop_pack_list", {})
            installed = next((p for p in listing.get("packs", []) if p.get("id") == pack_id), {})
            require("已安装包后端签名和激活版本正确", installed.get("signatureStatus") == "valid"
                    and installed.get("active") == version and installed.get("activeVersion") == version, installed)
            require("打开创意工坊面板", cdp.eval(button_expr("创意工坊", click=True)))
            require("目标包授予信任按钮可用", bool(wait_for(lambda: cdp.eval(button_expr("授予信任", pack_id)), args.ui_timeout)))
            require("点击目标包授予信任", cdp.eval(button_expr("授予信任", pack_id, click=True)))
            trust_expr = "JSON.parse(localStorage.getItem('ke.workshop.trust')||'{}')[" + json.dumps(pack_id) + "] === 'trusted'"
            require("目标包信任持久化为 trusted", bool(wait_for(lambda: cdp.eval(trust_expr), args.ui_timeout)))
            require("目标包信任 UI 刷新为 trusted", bool(wait_for(lambda: cdp.eval(
                "(() => {const row=[...document.querySelectorAll('section[aria-label=\"创意工坊\"] li')].find(li=>"
                "[...li.querySelectorAll('span')].some(s=>(s.textContent||'').trim()===" + json.dumps(pack_id)
                + "));return !!row && [...row.querySelectorAll('[role=status]')].some(s=>(s.textContent||'').trim()==='信任：trusted');})()"), args.ui_timeout)))
            require("目标包启用 guest 按钮可用", bool(wait_for(lambda: cdp.eval(button_expr("启用 guest", pack_id)), args.ui_timeout)))
            heartbeat_baseline = int(cdp.eval("Number(window.__keGuestHeartbeats || 0)") or 0)
            require("点击目标包启用 guest", cdp.eval(button_expr("启用 guest", pack_id, click=True)))

            def active_session():
                value = invoke(cdp, "workshop_pack_session_status", {})
                return value if isinstance(value, dict) and value.get("state") == "active" and value.get("packId") == pack_id else None

            status = wait_for(active_session, args.ui_timeout)
            require("目标包 guest 后端会话 active", bool(status), status)
            require("目标包 guest UI 及真实 iframe 就绪", bool(wait_for(lambda: cdp.eval(
                "(() => {const frame=[...document.querySelectorAll('iframe')].find(f=>f.title === "
                + json.dumps("workshop-guest-" + pack_id) + ");return !!frame && (frame.parentElement.textContent||'').includes('guest：active');})()"), args.ui_timeout)))
            # 交接的签名测试包使用 reference pack A 的 SDK 探针协议。
            def guest_probe(minimum):
                return cdp.eval("(() => {const r=window.__keGuestResults; return r && r.packId==="
                    + json.dumps(pack_id) + " && r.connected===true && !r.lastError && "
                    "Number.isFinite(r.heartbeatCount) && r.heartbeatCount>=" + str(minimum)
                    + " ? {packId:r.packId,connected:r.connected,heartbeatCount:r.heartbeatCount} : null;})()")

            first_probe = wait_for(lambda: guest_probe(2), args.ui_timeout)
            require("目标 guest SDK 握手完成并产生心跳", bool(first_probe), first_probe)
            second_probe = wait_for(lambda: guest_probe(first_probe["heartbeatCount"] + 2), args.ui_timeout)
            require("目标 guest 心跳继续递增", bool(second_probe), second_probe)
            # 后端在 iframe 加载前即上报 active，须等 guest 实际脚本发出至少两次心跳。
            heartbeat_status = wait_for(lambda: cdp.eval(
                f"Number(window.__keGuestHeartbeats || 0) >= {heartbeat_baseline + 2}") and active_session(), args.ui_timeout)
            require("guest 实际心跳到达且目标后端会话保持 active", bool(heartbeat_status),
                    {"baseline": heartbeat_baseline, "minimumNewHeartbeats": 2, "status": heartbeat_status})
            require("点击目标包停用 guest", cdp.eval(button_expr("停用 guest", pack_id, click=True)))

            def stopped_session():
                value = invoke(cdp, "workshop_pack_session_status", {})
                return value if isinstance(value, dict) and value.get("state") == "stopped" and value.get("packId") == pack_id else None

            status = wait_for(stopped_session, args.ui_timeout)
            require("停用 guest 后目标会话 stopped", bool(status), status)
        require("主进程存活（操作无崩溃）", proc.poll() is None, proc.poll())
        summary["smokeCompleted"] = True
    except (Exception, KeyboardInterrupt) as exc:
        interrupted = isinstance(exc, KeyboardInterrupt)
        check("执行异常" if summary["executed"] else "预检异常", False, f"{type(exc).__name__}: {exc}")
    finally:
        if cdp:
            try:
                cdp.ws.close()
            except Exception as exc:
                check("关闭 CDP", False, str(exc))
        if proc:
            try:
                if tracker:
                    cleanup = tracker.cleanup()
                    cleanup_ok = not cleanup["residualPids"] and not cleanup["errors"]
                    check("本次 PID 树退出且无残留", cleanup_ok, cleanup)
                else:
                    if proc.poll() is None:
                        proc.kill()
                    proc.wait(timeout=10)
                    check("本次 PID 树退出且无残留", False, "未建立进程树，无法确认后代残留")
            except Exception as exc:
                check("本次 PID 树退出且无残留", False, f"{type(exc).__name__}: {exc}")
        if log:
            try:
                log.close()
            except Exception as exc:
                check("关闭应用日志", False, str(exc))
        passed = summary["executed"] and summary["smokeCompleted"] and cleanup_ok and all(c["pass"] for c in checks)
        summary.update({"status": "PASS" if passed else ("FAIL" if summary["executed"] else "BLOCKED"),
                        "passCount": sum(c["pass"] for c in checks), "total": len(checks)})
        out = Path(args.out)
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"SUMMARY {summary['status']} {summary['passCount']}/{summary['total']} -> {out}")
        except Exception as exc:
            summary["status"] = "FAIL" if summary["executed"] else "BLOCKED"
            summary["outputError"] = f"{type(exc).__name__}: {exc}"
            print(json.dumps(summary, ensure_ascii=False))
    if interrupted:
        return 130
    return 0 if summary["status"] == "PASS" else (1 if summary["executed"] else 2)


if __name__ == "__main__":
    sys.exit(main())
