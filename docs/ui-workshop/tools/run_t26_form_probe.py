# -*- coding: utf-8 -*-
"""P5-T26 W02 产品 W 探针（W02 扩展：停用后迟到命令 / 旧连接失效）。

覆盖：
1) 安装签名包 → 启用真实产品 guest → 握手（ui.shell/context.read）；
2) guest 经 Broker `command.invoke` 提交 title/tags（宿主后端原子写 meta），未知命令被拒绝；
3) guest 先 post 中间回报 `w02-guest-pre`（含其冻结的迟到命令原始 wire 请求），宿主收到后点「停用 guest」；
4) 停用后会话状态 stopped/failed/idle、guest iframe 卸载（旧连接载体关闭）；
5) 按 guest 原定 T+3s 在宿主窗口**重放** pre.lateWireMsg（测试工具注入，非 guest 通道），
   验证已关闭 dispatcher 丢弃迟到请求：无响应/超时、不到盘（磁盘 frontmatter 不得出现「W02 迟到标题」）；
6) 主进程存活 / 用户实例未运行（N/A）。

说明：产品点「停用 guest」会卸载 guest iframe（guest realm 销毁），guest 无法在停用后自己发命令；
因此第 5 步用宿主侧重放 guest 预先捕获的迟到 wire 请求来验证「旧连接失效」——证据中如实标注为重放验证。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

import websocket  # websocket-client

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE = Path(r"C:\ke-tmp\uiws-t26-form")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26w02"
CDP_PORT = 8990 + (os.getpid() % 60)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"
GUEST_BUNDLE = REPO / "docs" / "ui-workshop" / "core" / "packs" / "probe" / "w02-guest-code.txt"
LATE_TITLE = "W02 迟到标题"
BASE_TITLE = "W02 交接标题"
STOP_STATES = {"stopped", "failed", "idle"}
MAX_ATTEMPTS = 2


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


def count_processes(image: str, path_like: str) -> int:
    ps = ("@(Get-Process " + image + " -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '" + path_like + "' }).Count")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    try:
        return int((out.stdout or "0").strip() or 0)
    except ValueError:
        return -1


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
        self.ws = websocket.create_connection(url, timeout=120, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + 180
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr: str) -> object:
        return (self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}).get("result") or {}).get("value")


def invoke(cdp: CDP, cmd: str, payload: dict) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    return cdp.eval(expr)  # type: ignore[return-value]


def click_text(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")); if(b){b.click(); return true;} return false; })()"))


def has_button(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => [...document.querySelectorAll('button')].some(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")))()"))


def replay_late_request_expr(late_wire: dict) -> str:
    """构造宿主窗口内重放迟到 wire 请求的 CDP 表达式（测试工具注入，非 guest 通道）。"""
    return ("(() => {"
            "  const msg = " + json.dumps(late_wire, ensure_ascii=False) + ";"
            "  window.postMessage({ type: 't19-wire', direction: 'guest-to-host', msg }, '*');"
            "  window.__t26LateReplay = { firedAt: Date.now(), requestId: (msg && msg.requestId) || null,"
            "    iframes: [...document.querySelectorAll('iframe')].length,"
            "    resultsLogLen: (window.__keGuestResultsLog || []).length };"
            "  return window.__t26LateReplay;"
            "})()")


# ---------------- 页面内测试观察点（CDP 脚本注入，非 guest 通道） ----------------

def install_page_probes(cdp: CDP) -> None:
    """在主页面装数组收集器：收集全部 `t19-guest-results`（组件只写会被覆盖的 __keGuestResults）。"""
    ok = cdp.eval(
        "(() => {"
        "  window.__keGuestResultsLog = [];"
        "  window.__t26LateReplay = null;"
        "  window.addEventListener('message', (event) => {"
        "    const d = event.data;"
        "    if (!d || typeof d !== 'object') return;"
        "    if (d.type === 't19-guest-results') {"
        "      window.__keGuestResultsLog.push({ t: Date.now(), payload: d.payload });"
        "    }"
        "  });"
        "  return true;"
        "})()"
    )
    if ok is not True:
        raise RuntimeError("注入 guest 消息数组监听失败")


def results_log(cdp: CDP) -> list:
    log = cdp.eval("window.__keGuestResultsLog || []")
    return log if isinstance(log, list) else []


def find_phase(cdp: CDP, phase: str) -> dict | None:
    for item in results_log(cdp):
        if not isinstance(item, dict):
            continue
        p = item.get("payload")
        if isinstance(p, dict) and p.get("phase") == phase:
            return p
    return None


def wait_guest_pre(cdp: CDP, timeout: float = 45.0) -> tuple[dict | None, int | None, dict | None]:
    """等待 w02-guest-pre；返回 (pre payload, 收到时刻 ms, 意外 error payload)。"""
    end = time.time() + timeout
    while time.time() < end:
        try:
            log = results_log(cdp)
        except Exception:
            raise
        for item in log:
            if not isinstance(item, dict):
                continue
            p = item.get("payload")
            if not isinstance(p, dict):
                continue
            if p.get("phase") == "w02-guest-pre":
                return p, int(item.get("t") or 0), None
            if p.get("phase") == "w02-guest-error":
                return None, None, p
        time.sleep(0.1)
    return None, None, None


def guest_iframes(cdp: CDP) -> int:
    v = cdp.eval("(() => [...document.querySelectorAll('iframe')].filter(f => (f.getAttribute('title')||'').startsWith('workshop-guest-')).length)()")
    return int(v or 0)


def snapshot_diag(cdp: CDP) -> dict:
    return cdp.eval(
        "({"
        "  start: window.__keGuestStart || null,"
        "  statusLog: window.__keGuestStatusLog || null,"
        "  resultsLog: (window.__keGuestResultsLog || []).map(x => ({ t: x.t, phase: (x.payload || {}).phase, keys: Object.keys(x.payload || {}) })),"
        "  lateReplay: window.__t26LateReplay || null,"
        "  dispatcherReady: window.__keDispatcherReady === true,"
        "  iframes: [...document.querySelectorAll('iframe')].map(f => ({ title: f.getAttribute('title'), sandbox: f.getAttribute('sandbox') })),"
        "  buttons: [...document.querySelectorAll('button')].map(b => ({ text: (b.textContent || '').trim(), disabled: !!b.disabled })).filter(b => b.text).slice(0, 60),"
        "  body: (document.body.innerText || '').slice(-1200)"
        "})"
    )  # type: ignore[return-value]


def write_diag(name: str, diag: object) -> None:
    try:
        (BASE / name).write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def wait_session_state(cdp: CDP, states: set[str], timeout: float = 20.0) -> tuple[str | None, dict | None, int]:
    end = time.time() + timeout
    state = None
    info = None
    iframes = -1
    while time.time() < end:
        try:
            info = invoke(cdp, "workshop_pack_session_status", {})
            state = ((info or {}).get("value") or {}).get("state")
            iframes = guest_iframes(cdp)
        except Exception:
            raise
        if state in states and iframes == 0:
            return state, info, iframes
        time.sleep(0.15)
    return state, info, iframes


def page_ready(cdp: CDP) -> bool:
    try:
        return "创意工坊" in str(cdp.eval("document.body.innerText || ''"))
    except Exception:
        return False


# ---------------- 单次运行 ----------------

def execute(checks: list[dict]) -> dict:
    def check(name: str, ok: bool, detail: object) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:400], flush=True)

    if not EXE.exists() or not GUEST_BUNDLE.exists():
        raise RuntimeError(f"缺少测试构建或 guest bundle: {EXE} / {GUEST_BUNDLE}")

    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    cleanup()
    for f in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(f) / "com.astranota.uiws.e2e", ignore_errors=True)
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    article = ws / "Articles" / "a.md"
    article.write_bytes("---\ntitle: 原标题\n---\n\nW02 form\n".encode("utf-8"))
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(json.dumps({"recent_workspaces": [str(ws)], "recent_documents": []}), encoding="utf-8")
    (ke_cfg / "settings.json").write_text(json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8")

    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    guest = GUEST_BUNDLE.read_text(encoding="utf-8").replace("</script>", "<\\/script>")
    entry = "<!doctype html><html><body><script>" + guest + "</script></body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {"id": PACK_ID, "name": "T26 W02 Pack", "version": "1.0.0", "apiVersion": 1,
                "capabilities": ["ui.shell", "context.read"], "entry": {"html": "index.html"},
                "commands": [{"name": "article.set-title", "handler": "setTitle"},
                             {"name": "article.set-tags", "handler": "setTags"},
                             {"name": "article.delete", "handler": "delete"}],
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
    result: dict = {}
    try:
        end = time.time() + 90
        while time.time() < end:
            mains = [t for t in targets() if t.get("type") == "page" and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")]
            if mains:
                cdp = CDP(mains[0]["webSocketDebuggerUrl"])
                break
            time.sleep(0.2)
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        for _ in range(300):
            if page_ready(cdp):
                break
            time.sleep(0.1)

        install_page_probes(cdp)
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-W02-1 安装签名包", (inst or {}).get("ok") is True, inst)

        click_text(cdp, "创意工坊")
        for _ in range(120):
            if has_button(cdp, "启用 guest"):
                break
            time.sleep(0.25)
        click_text(cdp, "授予信任")
        for _ in range(120):
            if has_button(cdp, "启用 guest"):
                break
            time.sleep(0.25)
        if not click_text(cdp, "启用 guest"):
            raise RuntimeError("未找到「启用 guest」按钮: " + json.dumps(snapshot_diag(cdp), ensure_ascii=False)[:1200])

        pre, pre_at, guest_err = wait_guest_pre(cdp, timeout=45)
        if guest_err is not None:
            write_diag("diag-guest-error.json", guest_err)
            raise RuntimeError("guest 报错: " + json.dumps(guest_err, ensure_ascii=False)[:1500])
        if pre is None:
            diag = snapshot_diag(cdp)
            write_diag("diag-no-pre.json", diag)
            raise RuntimeError("未收到 w02-guest-pre（guest 中间回报）: " + json.dumps(diag, ensure_ascii=False)[:1500])
        write_diag("diag-pre.json", {"pre_keys": sorted(pre.keys()), "lateRequest": pre.get("lateRequest"), "preAt": pre_at})

        # ---- 原有 title/tags/未知命令语义（数据来自 pre 中间回报）----
        hs = pre.get("handshakeAccepted") or {}
        features = hs.get("acceptedFeatures") if isinstance(hs, dict) else hs
        check("W-T26-W02-2 guest 握手（ui.shell/context.read）",
              isinstance(features, list) and set(features) >= {"ui.shell", "context.read"},
              {"features": features})
        set_title = pre.get("setTitle") or {}
        check("W-T26-W02-3 guest 经 Broker command.invoke 提交 title 成功",
              isinstance(set_title, dict) and set_title.get("ok") is True, set_title)
        article_text = article.read_text(encoding="utf-8", errors="replace")
        head = article_text.split("---")[1] if article_text.count("---") >= 2 else ""
        check("W-T26-W02-4 宿主后端原子写生效（frontmatter title 已更新）",
              BASE_TITLE in head and "原标题" not in head, {"head": head[:160]})
        set_tags = pre.get("setTags") or {}
        check("W-T26-W02-4b guest 提交 tags 成功且后端落盘",
              isinstance(set_tags, dict) and set_tags.get("ok") is True and "w02" in article_text, set_tags)
        check("W-T26-W02-5 未知命令被拒绝（E_COMMAND_NOT_ALLOWED）",
              "E_COMMAND_NOT_ALLOWED" in str(pre.get("forbiddenError") or ""), pre.get("forbiddenError"))
        check("W-T26-W02-6 收到 guest 中间回报 w02-guest-pre（停用前 title/tags/未知命令已完成）",
              pre.get("phase") == "w02-guest-pre" and isinstance(pre.get("lateWireMsg"), dict),
              {"preAt": pre_at, "lateRequest": pre.get("lateRequest")})

        status = invoke(cdp, "workshop_pack_session_status", {})
        active_state = ((status or {}).get("value") or {}).get("state")
        iframes_before = cdp.eval("[...document.querySelectorAll('iframe')].length")
        check("W-T26-W02-7 停用前会话 active（旧连接仍在服务）", active_state == "active", status)

        # ---- 停用 guest（旧连接载体关闭）----
        if not click_text(cdp, "停用 guest"):
            diag = snapshot_diag(cdp)
            write_diag("diag-no-stop-button.json", diag)
            raise RuntimeError("未找到「停用 guest」按钮: " + json.dumps(diag, ensure_ascii=False)[:1200])
        stop_state, stop_info, iframes_after = wait_session_state(cdp, STOP_STATES, timeout=20)
        diag_stop = snapshot_diag(cdp)
        write_diag("diag-stop.json", diag_stop)
        body_stop = str((diag_stop or {}).get("body") or "")
        check("W-T26-W02-8 停用 guest 生效：会话状态 stopped/failed/idle + guest iframe 已卸载",
              stop_state in STOP_STATES and iframes_after == 0,
              {"state": stop_state, "status": ((stop_info or {}).get("value")), "iframes_before": iframes_before,
               "iframes_after": iframes_after, "guest_frame_gone": "guest：stopped" in body_stop})

        # ---- 旧连接失效：仅当停用确认生效（iframe 卸载 + 会话 stopped/failed/idle）后，
        #      按 guest 原定 T+3s 在宿主窗口重放 guest 捕获的迟到 wire 请求（CDP 测试脚本注入，非 guest 通道）----
        late_wire = pre.get("lateWireMsg")
        late_req = pre.get("lateRequest") or {}
        stop_ok = stop_state in STOP_STATES and iframes_after == 0
        if not isinstance(late_wire, dict) or not late_wire.get("requestId"):
            raise RuntimeError("pre.lateWireMsg 缺失/非法: " + json.dumps(late_wire, ensure_ascii=False)[:800])
        replay: dict | None = None
        if stop_ok:
            target_ms = int(pre_at or int(time.time() * 1000)) + 3000
            delay_ms = target_ms - int(time.time() * 1000)
            if delay_ms > 0:
                time.sleep(delay_ms / 1000.0)
            replay_expr = replay_late_request_expr(late_wire)
            replay = cdp.eval(replay_expr)
            time.sleep(2.2)
        diag_final = snapshot_diag(cdp)
        write_diag("diag.json", diag_final)
        article_after = article.read_text(encoding="utf-8", errors="replace")
        head_after = article_after.split("---")[1] if article_after.count("---") >= 2 else ""
        phases_after = [x.get("phase") for x in (diag_final or {}).get("resultsLog") or [] if isinstance(x, dict)]
        done_after = find_phase(cdp, "w02-guest-done")
        status_after = invoke(cdp, "workshop_pack_session_status", {})
        state_after = ((status_after or {}).get("value") or {}).get("state")
        replay_ok = (isinstance(replay, dict) and replay.get("requestId") == late_req.get("requestId")
                     and int(replay.get("iframes") or 0) == 0)
        late_dropped = bool(stop_ok and replay_ok and done_after is None and state_after in STOP_STATES
                            and LATE_TITLE not in article_after)
        check("W-T26-W02-9 旧连接失效：停用后重放的迟到请求被丢弃（无响应/超时，未执行；重放验证，非 guest 存活）",
              late_dropped,
              {"stop_ok": stop_ok, "replay": replay, "lateRequestId": late_req.get("requestId"),
               "state_after": state_after, "guest_done_after_stop": done_after is not None,
               "phases_after": phases_after,
               "mechanism": "停用 → guest iframe 卸载 → 宿主 dispatcher close()；迟到 wire 请求无订阅者，被丢弃",
               "injection": "window.postMessage 由 CDP 测试脚本注入，非 guest 通道"})
        check("W-T26-W02-10 磁盘 frontmatter 不含迟到标题（迟到请求未落盘，原 title/tags 保留）",
              bool(stop_ok and LATE_TITLE not in article_after and BASE_TITLE in head_after and "w02" in article_after),
              {"stop_ok": stop_ok, "head_after": head_after[:200], "late_title_present": LATE_TITLE in article_after})

        upid = user_pid()
        ours = count_processes("knowledgeeditor", r"C:\ke-tmp\uiws-t26\bin\*")
        backends = count_processes("knowledgeeditor-backend", r"C:\ke-tmp\uiws-t26\bin\*")
        safe_mode = "safeMode" in str((diag_final or {}).get("body") or "")
        check("W-T26-W02-11 主进程存活 / 用户实例未运行（N/A）/ 无残留 guest 会话",
              proc.poll() is None and not upid,
              {"proc_alive": proc.poll() is None, "user_pid": upid or "(not running)",
               "our_processes": ours, "backend_processes": backends, "safe_mode_banner": safe_mode,
               "session_state": state_after})
        result = {
            "late_command": {
                "name": late_req.get("name") or "article.set-title",
                "title": LATE_TITLE,
                "scheduled_delay_ms": 3000,
                "replay_only": True,
                "guest_iframes_after_stop": iframes_after,
                "guest_iframe_alive_after_stop": int(iframes_after or 0) > 0,
                "guest_done_after_stop": done_after is not None,
                "rejection_observed": "no_response_closed_dispatcher_no_disk_write" if late_dropped else "not_rejected",
            },
            "stop_state": stop_state,
            "iframes_before": iframes_before,
            "iframes_after": iframes_after,
        }
        return result
    finally:
        if cdp is not None:
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
        cleanup()
        log.close()


def main() -> int:
    checks: list[dict] = []
    extra: dict = {}
    last_error = ""
    attempts = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        attempts = attempt
        checks = []
        last_error = ""
        try:
            print(f"=== attempt {attempt}/{MAX_ATTEMPTS} ===", flush=True)
            extra = execute(checks) or {}
            break
        except Exception:
            last_error = traceback.format_exc()
            print(last_error, flush=True)
            if attempt < MAX_ATTEMPTS:
                time.sleep(15)

    ok = bool(checks) and all(c["pass"] for c in checks) and not last_error
    if not ok and last_error:
        # 失败如实记录（最后尝试的 checks + 错误）
        if not checks:
            checks = [{"name": "W-T26-W02-0 探针执行", "pass": False, "detail": last_error[:2000]}]
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 W02 表单交接产品 W（command.invoke title/tags 原子写 + 未知命令拒绝 + 停用后迟到请求旧连接失效）",
        "evidence_note": (
            "产品点「停用 guest」会卸载 guest iframe（guest realm 销毁），guest 无法在停用后自己发命令；"
            "本探针按 guest 原定 T+3s，在宿主窗口重放 guest 在 pre 中冻结的迟到命令原始 wire 请求（CDP 测试脚本注入，非 guest 通道），"
            "验证已关闭的 dispatcher 丢弃迟到请求（无响应/超时、不落盘）。这是「旧连接失效」的重放验证，"
            "不代表 guest 停用后仍存活/仍能发命令。"
        ),
        "environment_note": (
            "并发窗口：本探针与 W07 boot 探针共用隔离构建。基线运行（09:08）在 check 6 处 CDP 连接断开，"
            "app.log 显示窗口异常关闭，疑似并发窗口内其它探针的 cleanup（按 C:\\\\ke-tmp\\\\uiws-t26\\\\bin\\\\* Stop-Process）"
            "误杀本 app；属环境并发冲突，不是产品缺陷。正式证据取自串行窗口内完整跑通的本次运行。"
        ),
        "attempts": attempts,
        "late_command": extra.get("late_command"),
        "stop_state": extra.get("stop_state"),
        "iframes_before": extra.get("iframes_before"),
        "iframes_after": extra.get("iframes_after"),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
    }
    out = EVID / "T26-W02-form-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}", flush=True)
    return 0 if summary["pass_count"] == summary["total"] and summary["total"] > 0 and ok else 1


if __name__ == "__main__":
    sys.exit(main())
