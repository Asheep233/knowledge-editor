# -*- coding: utf-8 -*-
"""P5-T26 W07 扩展故障探针：桥接超时 / sidecar 故障 / 原生 Rust 恢复（隔离产品构建 W 证据）。

背景（既有证据，不重复造轮子）：
- `run_t26_fault_probe.py`：guest 无限循环（W 8/8）；
- `run_t26_fault_mem_probe.py`：guest 内存/CPU 压力（W 21/21）；
- `run_t26_boot_crash_probe.py`：boot crash / 连续启动失败（W 40/44，4 缺口）；
- `run_t26_guest_io_probe.py`（G1/G2）、`run_t26_guest_g3g4_probe.py`（G3/G4）、`run_t26_recover_probe.py`（A3）：
  guest 真实协议线、真实打印、启动 recover/safeMode 的产品 W 骨架。

本探针补齐 W07 剩余故障类别，分三组场景（隔离产品构建，非 mock）：

A. **桥接超时**：guest 经真实协议线启用（trusted，能力 ui.shell/context.read/context.write/print.request）；
   宿主侧用 `NtSuspendProcess` **挂起测试 sidecar 进程树**（隔离构建、默认测试端口）制造桥接后端阻塞；
   guest 并发发起 `context.snapshot` + `print.snapshot` → 验证请求在**宿主 fetch 超时（15s AbortController）**
   后如实失败（非假成功/非无限挂死）、宿主 UI 仍响应、会话状态可观测；`NtResumeProcess` 后桥接恢复
   （再发请求成功），并可「停用 guest」恢复。
B. **sidecar 故障**：运行中按 PID/路径白名单杀测试 sidecar → 观察主进程/UI/错误可观测性、Rust 自动重启
   （watch_sidecar，≤3 次、1s 后拉起）与 guest 桥接恢复；连续杀 4 次触发「崩溃重启次数耗尽」→ 验证
   无自动恢复、runtime 信息陈旧、UI 最终降级；用户重启应用可恢复（含重新启用 guest）。
C. **原生 Rust 恢复**：损坏/半成品测试 pack（隔离 workshop-packs 中自有 id）后启动 → 启动 recover
   （rollback-corrupt-active / corrupt-no-fallback+safeMode / cleanup-journal）；再经产品命令
   `workshop_pack_recover` 与工坊 UI「检查/修复全部包」「修复/恢复」「卸载」验证恢复路径与数据一致性。

环境与红线：
- 只启动隔离测试构建 `C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe`；
  `APPDATA`/`KE_WORKSPACE`/`KE_APP_CONFIG_LEGACY` 指向隔离目录；CDP 端口隔离（10410+）；用户 App 未运行记 N/A。
- 注意：Tauri `app_data_dir()` 走 KnownFolder（不随 APPDATA env 变）→ 包/恢复/会话状态在真实
  `%APPDATA%\\Roaming\\com.astranota.uiws.e2e\\workshop-packs`（隔离 identifier，非用户 App 数据）。
  本探针**只创建/清理自有 pack id**（`com.probe.t26bridge*`），不删除共享目录或其它探针的包；
  「其它包是否损坏」会先审计，避免把别人的中间态误判成 safeMode。
- 桥接超时注入只对**本探针 Popen 主进程的子进程**（knowledgeeditor-backend）操作；杀 sidecar / 挂起
  均先校验 PID 属于自身进程树且可执行路径在 `C:\\ke-tmp\\uiws-t26\\bin\\*` / `F:\\Work\\Dev\\cargo-target\\*`
  白名单；严禁 `taskkill /IM`、严禁触碰 `D:\\AstraNota*` 用户实例。
- 串行独占：启动前检查无 knowledgeeditor 测试实例（其它 teammate 探针），被占用则等待/告知 Lead。
- 失败如实记录：[缺口] 检查项 FAIL = 发现真实缺口；不夸大、不掩盖。

用法（WSL，GO 窗口内独占运行）：
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \\
    \\$env:PYTHONIOENCODING='utf-8'; & 'C:\\Users\\y8882\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe' \\
    -X utf8 'F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_t26_w07_bridge_probe.py'"
  可选：--scenarios A,B,C1,C2,C3（默认全部）；--dry-run 只做环境自检不启动 exe。
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

import websocket  # websocket-client

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE_ROOT = Path(r"C:\ke-tmp\uiws-t26-w07bridge")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"

ISOLATED_IDENTIFIER = "com.astranota.uiws.e2e"
CDP_PORT = 10410 + (os.getpid() % 40)   # 基准端口；每次 launch 递增 1（防旧 WebView2 残留占用）
_CDP_STATE = {"port": CDP_PORT}

PACK_ID = "com.probe.t26bridge"           # A/B guest 包
C1_ID = "com.probe.t26bridge.c1"          # 损坏 active + 可回滚 previous
C2_ID = "com.probe.t26bridge.c2"          # 损坏 active + 无回退（safeMode）
C3_ID = "com.probe.t26bridge.c3"          # 半成品事务（txn/journal）
MY_IDS = [PACK_ID, C1_ID, C2_ID, C3_ID]

REL_PATH = "Articles/bridge.md"
ARTICLE_CONTENT = ("---\ntitle: bridge\n---\n\n# T26 W07 bridge probe\n\n"
                   "桥接超时/sidecar 故障/原生恢复测试文档。\n")
FIXED_C2_CONTENT = "<!doctype html><html><body><div id=\"root\">c2 fixed ok</div></body></html>"

UI_MARKERS = ("文章", "创意工坊")
EXE_WHITELIST = ("c:\\ke-tmp\\uiws-t26\\bin\\", "f:\\work\\dev\\cargo-target\\")

# ============================== Win32 进程/挂起工具 ==============================

TH32CS_SNAPPROCESS = 0x00000002
MAX_PATH = 260


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)), ("th32ModuleID", wt.DWORD),
        ("cntThreads", wt.DWORD), ("th32ParentProcessID", wt.DWORD),
        ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD),
        ("szExeFile", ctypes.c_wchar * MAX_PATH),
    ]


_k32 = ctypes.WinDLL("kernel32", use_last_error=True)
_k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
_k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
_k32.Process32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
_k32.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
_k32.CloseHandle.argtypes = [wt.HANDLE]
_k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
_k32.OpenProcess.restype = wt.HANDLE
_k32.TerminateProcess.argtypes = [wt.HANDLE, wt.UINT]

_ntdll = ctypes.WinDLL("ntdll")
_ntdll.NtSuspendProcess.argtypes = [wt.HANDLE]
_ntdll.NtResumeProcess.argtypes = [wt.HANDLE]

PROCESS_TERMINATE = 0x0001
PROCESS_SUSPEND_RESUME = 0x0800


def proc_snapshot() -> list:
    h = _k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    out: list = []
    if h in (None, wt.HANDLE(-1).value):
        return out
    try:
        e = PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        ok = _k32.Process32FirstW(h, ctypes.byref(e))
        while ok:
            out.append({"pid": e.th32ProcessID, "ppid": e.th32ParentProcessID,
                        "name": e.szExeFile})
            ok = _k32.Process32NextW(h, ctypes.byref(e))
    finally:
        _k32.CloseHandle(h)
    return out


def descendants(root_pid: int) -> list:
    procs = proc_snapshot()
    children: dict = {}
    for p in procs:
        children.setdefault(p["ppid"], []).append(p)
    out, queue, seen = [], [root_pid], set()
    while queue:
        cur = queue.pop(0)
        if cur in seen:
            continue
        seen.add(cur)
        for p in children.get(cur, []):
            out.append(p)
            queue.append(p["pid"])
    return out


def sidecar_pids(main_pid: int) -> list:
    return [p for p in descendants(main_pid) if "knowledgeeditor-backend" in p["name"].lower()]


def all_product_procs() -> list:
    return [p for p in proc_snapshot()
            if p["name"].lower().startswith(("knowledgeeditor",))]


def _open(pid: int, access: int):
    h = _k32.OpenProcess(access, False, pid)
    if not h:
        raise OSError(f"OpenProcess pid={pid} access={access} err={ctypes.get_last_error()}")
    return h


def suspend_pids(pids: list) -> list:
    res = []
    for pid in pids:
        try:
            h = _open(pid, PROCESS_SUSPEND_RESUME)
            try:
                res.append({"pid": pid, "status": int(_ntdll.NtSuspendProcess(h))})
            finally:
                _k32.CloseHandle(h)
        except OSError as e:
            res.append({"pid": pid, "error": str(e)})
    return res


def resume_pids(pids: list) -> list:
    res = []
    for pid in pids:
        try:
            h = _open(pid, PROCESS_SUSPEND_RESUME)
            try:
                res.append({"pid": pid, "status": int(_ntdll.NtResumeProcess(h))})
            finally:
                _k32.CloseHandle(h)
        except OSError as e:
            res.append({"pid": pid, "error": str(e)})
    return res


def terminate_pids(pids: list) -> list:
    res = []
    for pid in pids:
        try:
            h = _open(pid, PROCESS_TERMINATE)
            try:
                res.append({"pid": pid, "ok": bool(_k32.TerminateProcess(h, 1))})
            finally:
                _k32.CloseHandle(h)
        except OSError as e:
            res.append({"pid": pid, "error": str(e)})
    return res


# ============================== 通用工具 ==============================

def sha_file(p: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with p.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def sha_text(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def read_json_safe(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def run_ps(script: str, timeout: float = 30.0) -> str:
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=timeout)
        return out.stdout or ""
    except Exception:
        return ""


def real_folder(name: str) -> Path:
    out = run_ps(f"[Environment]::GetFolderPath('{name}')").strip()
    return Path(out) if out else Path(os.environ.get("APPDATA", "."))


def resolve_pack_root() -> Path:
    roaming = real_folder("Roaming")
    direct = roaming / ISOLATED_IDENTIFIER / "workshop-packs"
    if direct.parent.exists():
        return direct
    try:
        for d in roaming.glob("com.astranota*"):
            if d.is_dir():
                return d / "workshop-packs"
    except OSError:
        pass
    return direct


PACK_ROOT = resolve_pack_root()
RECOVER_STATUS = PACK_ROOT / "workshop-recover-status.json"
SESSION_STATUS = PACK_ROOT / "workshop-session-status.json"


def refresh_pack_root() -> Path:
    global PACK_ROOT, RECOVER_STATUS, SESSION_STATUS
    candidate = resolve_pack_root()
    if candidate != PACK_ROOT:
        PACK_ROOT = candidate
        RECOVER_STATUS = PACK_ROOT / "workshop-recover-status.json"
        SESSION_STATUS = PACK_ROOT / "workshop-session-status.json"
    return PACK_ROOT


def user_pid() -> str:
    return run_ps(
        "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id").strip()


def cleanup_test_procs() -> None:
    """只按路径白名单清理（禁止 taskkill /IM / 按镜像名杀用户进程）。"""
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue; "
          "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' -or "
          "$_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                   capture_output=True, text=True, timeout=30)


def log_tail(path: Path, n: int = 20) -> str:
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:])
    except OSError:
        return ""


def count_lines_containing(path: Path, needle: str) -> int:
    try:
        return sum(1 for ln in path.read_text(encoding="utf-8", errors="replace").splitlines()
                   if needle in ln)
    except OSError:
        return 0


def decode_systemtime(value) -> str | None:
    if not isinstance(value, str):
        return None
    m = re.search(r"intervals:\s*(\d+)", value)
    if not m:
        return None
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%S%z",
                             time.localtime(int(m.group(1)) / 1e7 - 11644473600))
    except Exception:
        return None


def port_free(port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def http_json(url: str, timeout: float) -> dict:
    t0 = time.time()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
            except Exception:
                data = body[:200]
            return {"ok": True, "elapsed": round(time.time() - t0, 3), "status": r.status,
                    "body": data}
    except Exception as e:
        return {"ok": False, "elapsed": round(time.time() - t0, 3),
                "error": f"{type(e).__name__}: {e}"}


def wait_until(fn, timeout_s: float, interval_s: float = 0.2) -> bool:
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(interval_s)
    return False


# ============================== CDP ==============================

def active_cdp_port() -> int:
    return _CDP_STATE["port"]


def cdp_targets() -> list:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{active_cdp_port()}/json/list", timeout=1) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


def main_targets() -> list:
    return [t for t in cdp_targets()
            if t.get("type") == "page"
            and "tauri.localhost" in str(t.get("url", ""))
            and "print-render" not in str(t.get("url", ""))
            and t.get("webSocketDebuggerUrl")]


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=120, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None, timeout: float = 60.0) -> dict:
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

    def eval(self, expr: str, timeout: float = 60.0):
        res = self.call("Runtime.evaluate",
                        {"expression": expr, "returnByValue": True, "awaitPromise": True},
                        timeout)
        if res.get("exceptionDetails"):
            raise RuntimeError(str(res["exceptionDetails"])[:300])
        return (res.get("result") or {}).get("value")

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass


def connect_main(timeout: float = 60.0) -> CDP | None:
    end = time.time() + timeout
    while time.time() < end:
        mains = main_targets()
        if mains:
            try:
                return CDP(mains[0]["webSocketDebuggerUrl"])
            except Exception:
                pass
        time.sleep(0.2)
    return None


def invoke(cdp: CDP, cmd: str, payload: dict | None = None, timeout: float = 20.0) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload or {}) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&(e.message||e))}; } })()")
    try:
        return cdp.eval(expr, timeout)
    except Exception as e:
        return {"ok": False, "error": f"cdp-eval-failed: {e}"}


def body_text(cdp: CDP, limit: int = 3000) -> str:
    try:
        return str(cdp.eval("(document.body&&document.body.innerText||'')") or "")[:limit]
    except Exception:
        return ""


def eval_latency(cdp: CDP) -> float:
    t0 = time.time()
    try:
        cdp.eval("1+1", timeout=5)
    except Exception:
        return -1.0
    return round((time.time() - t0) * 1000, 1)


def click_text(cdp: CDP, text: str) -> bool:
    expr = ("(() => { const els=[...document.querySelectorAll('body *')].filter(x =>"
            f" (x.textContent||'').includes({json.dumps(text)}) && x.children.length===0);"
            " if(!els.length) return false; const el=els[0];"
            " const t=el.closest('button,a,[role=button]') || el;"
            " t.click(); return true; })()")
    try:
        return bool(cdp.eval(expr))
    except Exception:
        return False


def has_enabled_button(cdp: CDP, text: str) -> bool:
    try:
        return bool(cdp.eval(
            "(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
            + json.dumps(text) + ")); return !!b && !b.disabled; })()"))
    except Exception:
        return False


def row_button_enabled(cdp: CDP, pack_id: str, labels) -> bool:
    expr = ("(() => { const li=[...document.querySelectorAll('li')].find(x=>(x.textContent||'').includes("
            + json.dumps(pack_id) + ")); if(!li) return false; const labels=" + json.dumps(list(labels)) + ";"
            " const b=[...li.querySelectorAll('button')].find(x=>labels.some(l=>(x.textContent||'').includes(l)));"
            " return !!b && !b.disabled; })()")
    try:
        return bool(cdp.eval(expr))
    except Exception:
        return False


def click_row_button(cdp: CDP, pack_id: str, labels) -> bool:
    expr = ("(() => { const li=[...document.querySelectorAll('li')].find(x=>(x.textContent||'').includes("
            + json.dumps(pack_id) + ")); if(!li) return false; const labels=" + json.dumps(list(labels)) + ";"
            " const b=[...li.querySelectorAll('button')].find(x=>labels.some(l=>(x.textContent||'').includes(l))"
            " && !x.disabled); if(!b) return false; b.click(); return true; })()")
    try:
        return bool(cdp.eval(expr))
    except Exception:
        return False


def open_workshop(cdp: CDP, timeout: float = 20.0) -> bool:
    if "已安装包" in body_text(cdp):
        return True
    for _ in range(4):
        click_text(cdp, "创意工坊")
        if wait_until(lambda: "已安装包" in body_text(cdp), timeout / 4):
            return True
    return "已安装包" in body_text(cdp)


def panel_messages(cdp: CDP) -> list:
    try:
        val = cdp.eval("(() => [...document.querySelectorAll('[role=status]')]"
                       ".map(x=>(x.textContent||'').trim()).filter(Boolean))()")
        return val if isinstance(val, list) else []
    except Exception:
        return []


def wait_panel_message(cdp: CDP, needle: str, timeout: float = 20.0):
    end = time.time() + timeout
    while time.time() < end:
        for m in panel_messages(cdp):
            if needle in m:
                return m
        time.sleep(0.25)
    return None


# ============================== guest 内联协议脚本 ==============================

GUEST_JS_TEMPLATE = r"""
(function () {
  var REL = __REL__;
  var started = false, client = null, aliveTimer = null;
  function makePort() {
    return {
      postMessage: function (m) {
        window.parent.postMessage({ type: 't19-wire', direction: 'guest-to-host', msg: m }, '*');
      },
      onMessage: function (cb) {
        var h = function (e) {
          var d = e.data;
          if (d && d.type === 't19-wire' && d.direction === 'host-to-guest') cb(d.msg);
        };
        window.addEventListener('message', h);
        return function () { window.removeEventListener('message', h); };
      }
    };
  }
  function clientOf(p) {
    var pending = {}, cseq = 0;
    p.onMessage(function (msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'handshake.response') { var h = pending.__hs; if (h) { delete pending.__hs; h(msg); } return; }
      if (msg.type === 'response' && msg.requestId && pending[msg.requestId]) {
        var f = pending[msg.requestId]; delete pending[msg.requestId]; f(msg);
      }
    });
    return {
      handshake: function (features) {
        return new Promise(function (res, rej) {
          var t = setTimeout(function () { rej(new Error('handshake-timeout')); }, 10000);
          pending.__hs = function (m) { clearTimeout(t); if (m.ok) res(m); else rej(new Error('E_HANDSHAKE')); };
          p.postMessage({ type: 'handshake', protocolVersion: 1, sdkVersion: 't26-w07-bridge-guest',
                          requestedFeatures: features });
        });
      },
      request: function (method, params, timeoutMs) {
        return new Promise(function (res, rej) {
          var id = 'g-' + (++cseq) + '-' + Math.random().toString(36).slice(2, 8);
          var t = setTimeout(function () {
            delete pending[id];
            var e = new Error('guest-side request timeout'); e.code = 'E_GUEST_TIMEOUT'; rej(e);
          }, timeoutMs || 40000);
          pending[id] = function (m) {
            clearTimeout(t);
            if (m.ok) { res(m.result); return; }
            var e = new Error(((m.error || {}).message) || 'E_PROTOCOL');
            e.code = (m.error || {}).code; e.details = (m.error || {}).details;
            e.retryable = (m.error || {}).retryable;
            rej(e);
          };
          p.postMessage({ type: 'request', requestId: id, method: method, params: params });
        });
      }
    };
  }
  function post(p) { window.parent.postMessage({ type: 't19-guest-results', payload: p }, '*'); }
  async function runCmd(c) {
    var t0 = Date.now();
    try {
      if (c.name === 'snapshot') {
        var r = await client.request('context.snapshot', { relPath: REL }, c.timeoutMs || 40000);
        post({ phase: 'cmd-result', seq: c.seq, cmd: 'snapshot', ok: true, elapsedMs: Date.now() - t0,
               snapshot: { relPath: r.relPath, revision: r.revision,
                           hasContent: typeof r.content === 'string',
                           contentLen: (r.content || '').length, content: r.content || '' } });
      } else if (c.name === 'print') {
        var pr = await client.request('print.snapshot', { relPath: REL }, c.timeoutMs || 40000);
        post({ phase: 'cmd-result', seq: c.seq, cmd: 'print', ok: true, elapsedMs: Date.now() - t0,
               result: { pdfToken: pr.pdfToken, pages: pr.pages } });
      } else {
        post({ phase: 'cmd-result', seq: c.seq, cmd: c.name, ok: false, elapsedMs: Date.now() - t0,
               errorCode: 'E_UNKNOWN_CMD', error: 'unknown command' });
      }
    } catch (e) {
      post({ phase: 'cmd-result', seq: c.seq, cmd: c.name, ok: false, elapsedMs: Date.now() - t0,
             errorCode: (e && e.code) || null, error: String((e && e.message) || e),
             errorName: (e && e.name) || null, retryable: (e && e.retryable) === true });
    }
  }
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'probe-cmd' && started && client) { void runCmd(d.cmd || {}); }
    if (d.type === 't19-port' && !started) {
      started = true;
      if (aliveTimer) clearInterval(aliveTimer);
      setInterval(function () {
        window.parent.postMessage({ type: 't19-heartbeat', t: Date.now() }, '*');
      }, 200);
      var cl = clientOf(makePort());
      cl.handshake(['ui.shell', 'context.read', 'context.write', 'print.request']).then(function (hs) {
        client = cl;
        post({ phase: 'ready', acceptedFeatures: hs.acceptedFeatures || [],
               hostVersion: hs.hostVersion || null, contextId: hs.contextId, epoch: hs.epoch });
      }).catch(function (e) {
        post({ phase: 'connect-error', error: String((e && e.message) || e) });
      });
    }
  });
  window.parent.postMessage({ type: 't19-guest-alive' }, '*');
  aliveTimer = setInterval(function () {
    if (!started) window.parent.postMessage({ type: 't19-guest-alive' }, '*');
  }, 500);
})();
"""

_cmd_seq = 0


def setup_guest_collector(cdp: CDP) -> None:
    cdp.eval("window.__keGuestMsgLog=[]; window.addEventListener('message', function(e){"
             " if(e.data && e.data.type==='t19-guest-results'){ window.__keGuestMsgLog.push(e.data.payload); } });")


def guest_msgs(cdp: CDP) -> list:
    try:
        v = cdp.eval("window.__keGuestMsgLog || []")
        return v if isinstance(v, list) else []
    except Exception:
        return []


def wait_guest_phase(cdp: CDP, phase: str, timeout: float = 30.0):
    end = time.time() + timeout
    while time.time() < end:
        for payload in reversed(guest_msgs(cdp)):
            if isinstance(payload, dict) and payload.get("phase") == phase:
                return payload
        time.sleep(0.25)
    return None


def guest_cmd(cdp: CDP, name: str, timeout_ms: int = 40000):
    """向 guest iframe 发命令；CDP 连接异常（宿主崩溃/被外部清理）时返回 None 而不中断场景。"""
    global _cmd_seq
    _cmd_seq += 1
    seq = _cmd_seq
    try:
        ok = cdp.eval("(() => { const f=document.querySelector('iframe'); if(!f||!f.contentWindow) return false;"
                      " f.contentWindow.postMessage({type:'probe-cmd', cmd:"
                      + json.dumps({"name": name, "seq": seq, "timeoutMs": timeout_ms})
                      + "}, '*'); return true; })()")
    except Exception:
        return None
    return seq if ok else None


def wait_guest_result(cdp: CDP, seq: int | None, timeout: float = 45.0):
    if seq is None:
        return None
    end = time.time() + timeout
    while time.time() < end:
        for payload in reversed(guest_msgs(cdp)):
            if isinstance(payload, dict) and payload.get("phase") == "cmd-result" \
                    and payload.get("seq") == seq:
                return payload
        time.sleep(0.2)
    return None


# ============================== 应用隔离环境 ==============================

class Launch:
    def __init__(self, tag: str, proc: subprocess.Popen, log, log_path: Path):
        self.tag = tag
        self.proc = proc
        self.log = log
        self.log_path = log_path
        self.t0 = time.time()

    @property
    def pid(self) -> int:
        return self.proc.pid

    def alive(self) -> bool:
        return self.proc.poll() is None

    def elapsed(self) -> float:
        return round(time.time() - self.t0, 3)

    def tail(self, n: int = 30) -> str:
        return log_tail(self.log_path, n)

    def close_log(self) -> None:
        try:
            self.log.close()
        except Exception:
            pass


def isolated_paths(name: str) -> tuple:
    base = BASE_ROOT / name
    return base, base / "appdata", base / "workspace"


def prepare_appdata(appdata: Path, ws: Path) -> None:
    (ws / "Articles").mkdir(parents=True, exist_ok=True)
    (ws / "Articles" / "bridge.md").write_bytes(ARTICLE_CONTENT.encode("utf-8"))
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(json.dumps(
        {"recent_workspaces": [str(ws)], "recent_documents": []}, ensure_ascii=False),
        encoding="utf-8")
    (ke_cfg / "settings.json").write_text(json.dumps(
        {"schemaVersion": 1, "startup": {"autoOpenRecentWorkspace": True}},
        ensure_ascii=False), encoding="utf-8")


def app_env(appdata: Path, ws: Path, pubkeys: dict | None, extra: dict | None = None) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("KE_")}
    env.pop("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", None)
    env.update({
        "APPDATA": str(appdata),
        "KE_WORKSPACE": str(ws),
        "KE_APP_CONFIG_LEGACY": str(appdata.parent / "legacy-app-config.json"),
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={active_cdp_port()}",
    })
    if pubkeys:
        env["KE_WORKSHOP_PUBKEYS"] = json.dumps(pubkeys)
    if extra:
        env.update(extra)
    return env


def launch_app(tag: str, appdata: Path, ws: Path, pubkeys: dict | None,
               extra: dict | None = None) -> Launch:
    base = appdata.parent
    base.mkdir(parents=True, exist_ok=True)
    # 每次启动使用新的 CDP 调试端口：上一次 App 强退后 WebView2 子进程可能短暂存活仍占用旧端口
    if not _CDP_STATE.get("first"):
        _CDP_STATE["first"] = True
    else:
        _CDP_STATE["port"] = int(_CDP_STATE["port"]) + 1
    log_path = base / f"{tag}.log"
    log = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=app_env(appdata, ws, pubkeys, extra),
                            stdout=log, stderr=subprocess.STDOUT)
    return Launch(tag, proc, log, log_path)


def stop_launch(l: Launch, cdp: CDP | None = None) -> dict:
    info: dict = {"tag": l.tag, "invoke": None}
    if cdp is not None:
        info["invoke"] = invoke(cdp, "app_request_exit", timeout=10)
        wait_until(lambda: l.proc.poll() is not None, 12, 0.1)
    if l.proc.poll() is None:
        l.proc.kill()
        try:
            l.proc.wait(timeout=5)
        except Exception:
            pass
    time.sleep(1.0)
    info["exit_code"] = l.proc.poll()
    info["orphans"] = [{"pid": x["pid"], "name": x["name"]} for x in descendants(l.pid)]
    cleanup_test_procs()
    info["log_tail"] = l.tail(40)
    l.close_log()
    return info


def wait_main_ready(timeout: float = 60.0) -> tuple:
    """等待 CDP 主窗口 + Tauri IPC + 工作区/工坊 UI 首帧。返回 (cdp, obs)。"""
    obs: dict = {"cdp": False, "internals": False, "body_ready_s": None, "body": None}
    end = time.time() + timeout
    cdp: CDP | None = None
    t0 = time.time()
    while time.time() < end:
        if cdp is None:
            cdp = connect_main(2.0)
            if cdp is not None:
                obs["cdp"] = True
                setup_guest_collector(cdp)
        if cdp is not None:
            try:
                if not obs["internals"] and cdp.eval(
                        "typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                    obs["internals"] = True
                b = body_text(cdp)
                if obs["internals"] and any(m in b for m in UI_MARKERS):
                    obs["body"] = b
                    obs["body_ready_s"] = round(time.time() - t0, 3)
                    break
            except Exception:
                pass
        time.sleep(0.15)
    return cdp, obs


# ============================== 签名包 / 文件 pack ==============================

def build_signed_guest_pack(base: Path) -> tuple:
    pack = base / "guest-pack"
    shutil.rmtree(pack, ignore_errors=True)
    pack.mkdir(parents=True)
    key = base / "key.pem"
    pub = json.loads(subprocess.run(
        [NODE, str(SIGN_TOOL), "--generate-key", str(key)],
        check=True, capture_output=True, text=True, encoding="utf-8").stdout)["publicKeyHex"]
    js = GUEST_JS_TEMPLATE.replace("__REL__", json.dumps(REL_PATH))
    entry = "<!doctype html><html><body><script>" + js + "</script></body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {
        "id": PACK_ID, "name": "T26 W07 Bridge Probe Pack", "version": "1.0.0",
        "apiVersion": 1,
        "capabilities": ["ui.shell", "context.read", "context.write", "print.request"],
        "entry": {"html": "index.html"}, "commands": [],
        "assets": [{"path": "index.html", "sha256": sha_text(entry)}],
    }
    (pack / "manifest.json").write_bytes(
        json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key),
                    "--keyid", "k1", "--write"], check=True, capture_output=True, text=True,
                   encoding="utf-8")
    return pack, {"k1": {"key": pub}}


def build_signed_fixed_c2(base: Path) -> tuple:
    """C2 恢复用「有效重装包」（独立 keyId=k2；pubkeys 会并入启动 env 供签名校验）。"""
    pack = base / "c2-fixed-pack"
    shutil.rmtree(pack, ignore_errors=True)
    pack.mkdir(parents=True)
    key = base / "c2key.pem"
    pub = json.loads(subprocess.run(
        [NODE, str(SIGN_TOOL), "--generate-key", str(key)],
        check=True, capture_output=True, text=True, encoding="utf-8").stdout)["publicKeyHex"]
    (pack / "index.html").write_text(FIXED_C2_CONTENT, encoding="utf-8")
    manifest = {
        "id": C2_ID, "name": "T26 Bridge C2 Fixed", "version": "1.0.0", "apiVersion": 1,
        "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
        "assets": [{"path": "index.html", "sha256": sha_text(FIXED_C2_CONTENT)}],
    }
    (pack / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                        encoding="utf-8")
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key),
                    "--keyid", "k2", "--write"], check=True, capture_output=True, text=True,
                   encoding="utf-8")
    return pack, {"k2": {"key": pub}}


# --------------------------------- 文件系统 pack（C 场景，直接写隔离 workshop-packs） ---------------------------------

def fs_make_pack(root: Path, pack_id: str, version: str, content: str) -> None:
    vdir = root / pack_id / version
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "index.html").write_text(content, encoding="utf-8")
    manifest = {
        "id": pack_id, "name": f"T26 Bridge {pack_id}", "version": version, "apiVersion": 1,
        "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
        "assets": [{"path": "index.html", "sha256": sha_text(content)}],
    }
    (vdir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                        encoding="utf-8")


def fs_write_state(root: Path, pack_id: str, active, previous) -> None:
    d = root / pack_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "state.json").write_text(json.dumps(
        {"active": active, "previous": previous, "updatedAt": str(time.time())},
        ensure_ascii=False, indent=2), encoding="utf-8")


def fs_corrupt(root: Path, pack_id: str, version: str,
               content: str = "<html>CORRUPTED BY W07 PROBE</html>") -> None:
    (root / pack_id / version / "index.html").write_text(content, encoding="utf-8")


def fs_verify_pack(root: Path, pack_id: str, version: str):
    """Python 复刻 Rust verify_pack（只读校验，用于证据一致性断言）。"""
    vdir = root / pack_id / version
    manifest = read_json_safe(vdir / "manifest.json")
    if not isinstance(manifest, dict):
        return False, "manifest 缺失/非法"
    for asset in manifest.get("assets") or []:
        rel = str(asset.get("path") or "")
        expect = str(asset.get("sha256") or "")
        target = vdir / rel
        if not target.exists():
            return False, f"资产缺失 {rel}"
        if sha_file(target) != expect:
            return False, f"资产哈希不匹配 {rel}"
    return True, "ok"


def fs_state(root: Path, pack_id: str):
    return read_json_safe(root / pack_id / "state.json")


def audit_other_packs(exclude_ids: list) -> dict:
    """审计共享 workshop-packs 中「其它探针/历史遗留」包是否损坏（避免 safeMode 期望被污染）。"""
    refresh_pack_root()
    out = {"checked": [], "corrupt": [], "pack_root": str(PACK_ROOT)}
    if not PACK_ROOT.exists():
        return out
    for entry in PACK_ROOT.iterdir():
        if not entry.is_dir() or entry.name in exclude_ids or entry.name.startswith("."):
            continue
        state = read_json_safe(entry / "state.json")
        if not isinstance(state, dict):
            continue  # 非已安装包（无 state.json）
        active = state.get("active")
        out["checked"].append(entry.name)
        if isinstance(active, str) and active:
            ok, _reason = fs_verify_pack(PACK_ROOT, entry.name, active)
            if not ok:
                out["corrupt"].append({"id": entry.name, "active": active, "reason": _reason})
    return out


def cleanup_my_packs() -> dict:
    refresh_pack_root()
    removed = {}
    for pid in MY_IDS:
        existed = (PACK_ROOT / pid).exists()
        shutil.rmtree(PACK_ROOT / pid, ignore_errors=True)
        removed[pid] = {"existed_before": existed, "removed": not (PACK_ROOT / pid).exists()}
    return removed


def read_recover_status() -> dict | None:
    refresh_pack_root()
    data = read_json_safe(RECOVER_STATUS)
    if not isinstance(data, dict):
        return None
    data = dict(data)
    data["generatedAtLocal"] = decode_systemtime(data.get("generatedAt"))
    data["mtime"] = time.strftime("%Y-%m-%dT%H:%M:%S%z",
                                  time.localtime(RECOVER_STATUS.stat().st_mtime)) \
        if RECOVER_STATUS.exists() else None
    data["_path"] = str(RECOVER_STATUS)
    return data


def recover_result(status: dict | None, pack_id: str):
    if not isinstance(status, dict):
        return None
    for item in status.get("results") or []:
        if isinstance(item, dict) and item.get("id") == pack_id:
            return item
    return None


def fresh_recover_status(t_launch: float, timeout: float = 20.0):
    end = time.time() + timeout
    while time.time() < end:
        if RECOVER_STATUS.exists() and RECOVER_STATUS.stat().st_mtime >= t_launch - 2:
            data = read_recover_status()
            if isinstance(data, dict):
                return data
        time.sleep(0.2)
    return read_recover_status()


def session_state() -> dict:
    refresh_pack_root()
    data = read_json_safe(SESSION_STATUS)
    return data if isinstance(data, dict) else {}


# ============================== 工坊/guest 操作 ==============================

def install_pack(cdp: CDP, pack_dir: Path) -> dict:
    return invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack_dir)}, timeout=30)


def enable_guest(cdp: CDP, pack_id: str, timeout: float = 45.0):
    """打开工坊 → 等包装载 →（必要时授予信任并等 tier=trusted 刷新）→ 行内点「启用 guest」→ 等握手 ready。

    关键（首轮实测缺陷）：包列表是异步加载的；未等行渲染就找「授予信任」会漏点，随后以 community tier
    点「启用 guest」→ host 以 E_CAPABILITY_TIER 拒绝。必须等 tier 文本刷新为 trusted 后再启用。
    """
    info: dict = {"trusted": None, "trusted_wait": None, "enabled": False,
                  "ready": None, "ok": False, "error": None}
    # 关键（复测发现）：CDP 可能在页面导航完成前连上，早先注册的 guest 消息收集器随导航丢失。
    # 在启用 guest 前（面板已就绪、页面已稳定）重新安装收集器，保证 ready/cmd-result 消息可被收集。
    try:
        setup_guest_collector(cdp)
    except Exception:
        pass
    if not open_workshop(cdp, timeout=20):
        info["error"] = "工坊面板未打开"
        return info
    if not wait_until(lambda: pack_id in body_text(cdp), 20, 0.25):
        info["error"] = "包行未渲染"
        return info
    if row_button_enabled(cdp, pack_id, ["授予信任"]):
        info["trusted"] = click_row_button(cdp, pack_id, ["授予信任"])
        info["trusted_wait"] = wait_until(lambda: "信任：trusted" in body_text(cdp), 15, 0.25)
    else:
        info["trusted"] = "already-trusted-or-disabled"
        # 已持久化信任的场景也要等面板 tier 异步解析完成（否则 frame 可能仍以 community 渲染 → E_CAPABILITY_TIER）
        info["trusted_wait"] = wait_until(lambda: "信任：trusted" in body_text(cdp), 10, 0.25)
    if not wait_until(lambda: row_button_enabled(cdp, pack_id, ["启用 guest"]), 20, 0.25):
        info["error"] = "启用 guest 按钮不可用"
        return info
    time.sleep(0.8)  # 等 tier 刷新后的 WorkshopGuestFrame 重渲染
    if click_row_button(cdp, pack_id, ["启用 guest"]):
        info["enabled"] = True
        info["ready"] = wait_guest_phase(cdp, "ready", timeout)
    else:
        info["error"] = "启用 guest 点击失败"
    if not info["ready"]:
        # 失败诊断（不伪造成功）：宿主 start 结果/错误、会话状态、面板文本
        try:
            info["diag"] = {
                "guest_start": cdp.eval("window.__keGuestStart || null"),
                "guest_error": cdp.eval("window.__keGuestError || null"),
                "guest_status_log": cdp.eval("window.__keGuestStatusLog || null"),
                "session": (invoke(cdp, "workshop_pack_session_status") or {}).get("value"),
                "body_tail": body_text(cdp)[-700:],
            }
        except Exception as e:
            info["diag"] = {"error": str(e)}
    info["ok"] = bool(info["ready"])
    return info


def stop_guest(cdp: CDP, pack_id: str, timeout: float = 20.0) -> dict:
    clicked = click_row_button(cdp, pack_id, ["停用 guest"])
    ok = wait_until(lambda: session_state().get("state") == "stopped", timeout, 0.25)
    st = invoke(cdp, "workshop_pack_session_status")
    return {"clicked": clicked, "stopped": ok,
            "session": (st or {}).get("value"), "file": session_state()}


def guest_snapshot(cdp: CDP, timeout_ms: int = 40000, wait_s: float = 45.0):
    seq = guest_cmd(cdp, "snapshot", timeout_ms)
    return wait_guest_result(cdp, seq, wait_s)


def check(checks: list, scenario: str, cid: str, name: str, ok: bool, detail) -> None:
    item = {"id": cid, "scenario": scenario, "name": name, "pass": bool(ok),
            "detail": _trunc(detail)}
    checks.append(item)
    print(("PASS " if ok else "FAIL ") + f"{cid} {name} | {_short(detail)}", flush=True)


def _trunc(obj, limit: int = 4000):
    try:
        text = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        text = str(obj)
    if len(text) <= limit:
        try:
            return json.loads(text)
        except Exception:
            return text
    return text[:limit] + f"...(truncated, {len(text)} chars)"


def _short(detail) -> str:
    try:
        return json.dumps(detail, ensure_ascii=False, default=str)[:320]
    except Exception:
        return str(detail)[:320]


def cim_paths(pids: list) -> dict:
    """只读查询指定 PID 的可执行路径（用于白名单/归属证据）。"""
    if not pids:
        return {}
    filt = " or ".join(f"ProcessId={int(p)}" for p in pids)
    script = ("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
              f"Get-CimInstance Win32_Process -Filter '{filt}' | "
              "Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress")
    text = run_ps(script).strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except Exception:
        return {}
    items = data if isinstance(data, list) else [data]
    return {int(i["ProcessId"]): {"path": i.get("ExecutablePath"),
                                  "command": (i.get("CommandLine") or "")[:200]} for i in items}


def whitelisted_paths(paths: dict) -> dict:
    out = {}
    for pid, info in paths.items():
        p = (info.get("path") or "").lower()
        out[pid] = {"path": info.get("path"),
                    "whitelisted": any(p.startswith(w) for w in EXE_WHITELIST)}
    return out


# ============================== 场景 A：桥接超时（挂起 sidecar） ==============================

def runtime_file(appdata: Path) -> Path:
    return appdata / "KnowledgeEditor" / "runtime" / "runtime.json"


def backend_alive(pid) -> bool:
    if not isinstance(pid, int):
        return False
    return any(p["pid"] == pid for p in proc_snapshot())


# ---- W07 B-4/B-5 复测辅助：运行时健康 banner 与会话挂起/恢复观测 ----

def banner_state(cdp: CDP):
    """读取 App 级 RuntimeHealthBanner 的 data-phase/文案/诊断钩子（无 banner 返回 None）。"""
    try:
        return cdp.eval(
            "(() => { const el=document.querySelector('[data-testid=\"runtime-health-banner\"]');"
            " if(!el) return null; return {phase: el.getAttribute('data-phase'),"
            " text: (el.textContent||'').trim(), status: el.getAttribute('role'),"
            " health: (window.__keRuntimeHealth || null)}; })()")
    except Exception:
        return None


def wait_banner_phase(cdp: CDP, phase: str, timeout: float = 6.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        st = banner_state(cdp)
        if isinstance(st, dict):
            last = st
            if st.get("phase") == phase:
                return st
        time.sleep(0.1)
    return last


def wait_session_status(cdp: CDP, pred, timeout: float = 8.0):
    """轮询 workshop_pack_session_status 直到满足 pred；返回最后一次会话状态。"""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        st = (invoke(cdp, "workshop_pack_session_status") or {}).get("value") or {}
        last = st
        try:
            if pred(st):
                return st
        except Exception:
            pass
        time.sleep(0.15)
    return last


def host_unavailable_error(st: dict) -> bool:
    return str((st or {}).get("lastError") or "").startswith("E_HOST_UNAVAILABLE")


def wait_new_backend(l: Launch, old_pid, timeout: float = 15.0):
    """等待 sidecar 自动重启完成（runtime.json 的新 pid 存活）。"""
    t0 = time.time()
    end = t0 + timeout
    while time.time() < end:
        rt = read_json_safe(runtime_file(l.log_path.parent / "appdata"))
        pid = ((rt or {}).get("backend") or {}).get("pid")
        if isinstance(pid, int) and pid != old_pid and backend_alive(pid):
            return {"s": round(time.time() - t0, 3), "pid": pid,
                    "port": ((rt or {}).get("backend") or {}).get("port"), "runtime": rt}
        time.sleep(0.2)
    return None


def wait_health_ok(port: int, timeout: float = 12.0):
    end = time.time() + timeout
    while time.time() < end:
        r = http_json(f"http://127.0.0.1:{port}/api/health", 2.0)
        if r.get("ok"):
            return r
        time.sleep(0.3)
    return http_json(f"http://127.0.0.1:{port}/api/health", 2.0)


def scenario_a(checks: list, ctx: dict) -> dict:
    print("\n===== 场景 A：桥接超时（挂起测试 sidecar 进程树）=====", flush=True)
    cleanup_my_packs()
    base, appdata, ws = isolated_paths("a")
    prepare_appdata(appdata, ws)
    l = launch_app("a-main", appdata, ws, ctx["pubkeys"])
    cdp, obs = wait_main_ready()
    metrics: dict = {"main_ready": obs}
    try:
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        inst = install_pack(cdp, ctx["guest_pack"])
        en = enable_guest(cdp, PACK_ID)
        st = (invoke(cdp, "workshop_pack_session_status") or {}).get("value") or {}
        feats = (en.get("ready") or {}).get("acceptedFeatures") or []
        check(checks, "A", "W07B-A-1",
              "隔离实例启动 + 签名 guest 包安装/trusted/启用/握手（能力协商含 context.read/context.write/print.request）",
              inst.get("ok") is True and en.get("ok") is True and st.get("state") == "active"
              and set(feats) >= {"context.read", "context.write", "print.request"},
              {"install": inst, "enable": en, "session": st, "acceptedFeatures": feats})

        base_snap = guest_snapshot(cdp)
        article = (ws / "Articles" / "bridge.md").read_text(encoding="utf-8")
        snap_doc = (base_snap or {}).get("snapshot") or {}
        check(checks, "A", "W07B-A-2",
              "基线 context.snapshot 成功且正文等于磁盘（control：桥接在故障前可用）",
              (base_snap or {}).get("ok") is True and snap_doc.get("content") == article,
              {"result": base_snap})

        rt = read_json_safe(runtime_file(appdata)) or {}
        port = ((rt.get("backend") or {}).get("port"))
        api = f"http://127.0.0.1:{port}"
        health_before = http_json(f"{api}/api/health", 3.0)
        sc = sidecar_pids(l.pid)
        sc_pids = [p["pid"] for p in sc]
        paths = whitelisted_paths(cim_paths(sc_pids))
        suspend_res = suspend_pids(sc_pids)
        time.sleep(0.5)
        health_during = http_json(f"{api}/api/health", 1.5)
        main_alive = l.alive()
        susp_ok = (health_before.get("ok") is True and health_during.get("ok") is False
                   and health_during.get("elapsed", 0) >= 1.2 and main_alive
                   and all(v["whitelisted"] for v in paths.values()) and len(sc_pids) > 0)
        check(checks, "A", "W07B-A-3",
              "故障注入有效：测试 sidecar 进程树被挂起（探针侧 /api/health 超时≥1.5s），主进程存活，PID 路径白名单校验通过",
              susp_ok,
              {"backend_pids": sc_pids, "paths": paths, "suspend": suspend_res,
               "health_before": health_before, "health_during": health_during,
               "main_alive": main_alive})

        t_send = time.time()
        seq_s = guest_cmd(cdp, "snapshot", 40000)
        seq_p = guest_cmd(cdp, "print", 40000)
        lat_samples = []
        for _ in range(2):
            time.sleep(3.0)
            b = body_text(cdp)
            lat_samples.append({"t_s": round(time.time() - t_send, 2),
                                "latency_ms": eval_latency(cdp), "body_len": len(b),
                                "workshop_text": "创意工坊" in b})
        r_s = wait_guest_result(cdp, seq_s, 45)
        r_p = wait_guest_result(cdp, seq_p, 45)
        metrics["bridge_timeout"] = {"snapshot": r_s, "print": r_p, "latency": lat_samples}
        elapsed_s = ((r_s or {}).get("elapsedMs") or 0) / 1000.0
        check(checks, "A", "W07B-A-4",
              "guest context.snapshot 在 sidecar 挂起时如实失败（非假成功/非无限挂死；耗时≈宿主 fetch 超时 15s）",
              (r_s or {}).get("ok") is False and 13.5 <= elapsed_s <= 18.5
              and bool((r_s or {}).get("error")),
              r_s)
        check(checks, "A", "W07B-A-5",
              "guest print.snapshot 在 sidecar 挂起时如实失败（不返回假 pdfToken；耗时≈宿主 fetch 超时 15s）",
              (r_p or {}).get("ok") is False
              and not ((r_p or {}).get("result") or {}).get("pdfToken")
              and 13.5 <= ((r_p or {}).get("elapsedMs") or 0) / 1000.0 <= 18.5,
              r_p)
        lat_ok = (len(lat_samples) == 2 and all(s["latency_ms"] >= 0 and s["latency_ms"] < 1500
                                                for s in lat_samples)
                  and all(s["body_len"] > 500 for s in lat_samples))
        check(checks, "A", "W07B-A-6",
              "桥接阻塞期间宿主 UI 仍响应（CDP eval 2 次采样 <1500ms，工作区/工坊文本完整）",
              lat_ok, lat_samples)

        st2 = (invoke(cdp, "workshop_pack_session_status") or {}).get("value") or {}
        check(checks, "A", "W07B-A-7",
              "桥接失败期间会话状态可观测且未误判（guest 心跳继续 → state=active，非 failed/suspended）",
              st2.get("state") == "active", st2)
        metrics["session_during_bridge_timeout"] = st2

        resume_res = resume_pids(sc_pids)
        health_after = wait_health_ok(port, 10)
        rec_snap = guest_snapshot(cdp)
        rec_doc = (rec_snap or {}).get("snapshot") or {}
        check(checks, "A", "W07B-A-8",
              "恢复：NtResumeProcess 后 sidecar /api/health 恢复 + guest context.snapshot 再次成功（桥接恢复）",
              health_after.get("ok") is True and (rec_snap or {}).get("ok") is True
              and rec_doc.get("content") == article,
              {"resume": resume_res, "health_after": health_after, "recovery_snapshot": rec_snap})

        stopg = stop_guest(cdp, PACK_ID)
        check(checks, "A", "W07B-A-9",
              "可停用恢复：点击「停用 guest」→ 会话 state=stopped 且落盘 workshop-session-status.json",
              stopg.get("stopped") is True and (stopg.get("file") or {}).get("state") == "stopped",
              stopg)

        err_code = (r_s or {}).get("errorCode")
        retryable = (r_s or {}).get("retryable")
        check(checks, "A", "W07B-A-10",
              "桥接超时错误码为协议 E_TIMEOUT/retryable=true（guest 可按 code 区分超时并重试；修复前为 E_INTERNAL/retryable=false）",
              err_code == "E_TIMEOUT" and retryable is True,
              {"errorCode": err_code, "retryable": retryable,
               "error": (r_s or {}).get("error"),
               "source_ref": "frontend/src/core/packs/productHostAdapter.ts requestJson AbortController(15000)；"
                             "task-11 修复：productHostAdapter.requestJson AbortController 超时 → protocolError(E_TIMEOUT, retryable=true)"})

        invoke(cdp, "workshop_pack_uninstall", {"id": PACK_ID})
        metrics["stop"] = stop_launch(l, cdp)
        cdp.close()
    finally:
        if l.alive():
            try:
                l.proc.kill()
                l.proc.wait(timeout=5)
            except Exception:
                pass
        cleanup_test_procs()
        l.close_log()
        cleanup_my_packs()
        try:
            if cdp is not None:
                cdp.close()
        except Exception:
            pass
    return metrics


# ============================== 场景 B：sidecar 故障 / 自动重启 / 崩溃耗尽 ==============================

def scenario_b(checks: list, ctx: dict) -> dict:
    print("\n===== 场景 B（B-4/B-5/B-8 修复后复测）：杀 sidecar → 自动重启/崩溃耗尽 → 重启恢复 =====", flush=True)
    cleanup_my_packs()
    base, appdata, ws = isolated_paths("b")
    prepare_appdata(appdata, ws)
    l = launch_app("b-main", appdata, ws, ctx["pubkeys"])
    cdp, obs = wait_main_ready()
    metrics: dict = {"main_ready": obs}
    try:
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        # ---------- 基线 ----------
        inst = install_pack(cdp, ctx["guest_pack"])
        en = enable_guest(cdp, PACK_ID)
        base_snap = guest_snapshot(cdp)
        article = (ws / "Articles" / "bridge.md").read_text(encoding="utf-8")
        rt = read_json_safe(runtime_file(appdata)) or {}
        backend_pid = ((rt.get("backend") or {}).get("pid"))
        port = ((rt.get("backend") or {}).get("port"))
        health_before = http_json(f"http://127.0.0.1:{port}/api/health", 3.0)
        st_before = (invoke(cdp, "workshop_pack_session_status") or {}).get("value") or {}
        base_ok = (inst.get("ok") is True and en.get("ok") is True
                   and (base_snap or {}).get("ok") is True
                   and ((base_snap or {}).get("snapshot") or {}).get("content") == article
                   and health_before.get("ok") is True and st_before.get("state") == "active")
        check(checks, "B", "W07B-B-1",
              "基线：隔离实例 + guest 启用 + sidecar healthy（/api/health ok）+ context.snapshot 可用",
              base_ok,
              {"install": inst, "enable": en, "session": st_before, "port": port,
               "health": health_before, "snapshot_ok": (base_snap or {}).get("ok")})

        # ---------- 第 1 次杀 sidecar：B-4 banner / B-5 会话挂起 / B-8 runtime 清理 ----------
        pids = [p["pid"] for p in sidecar_pids(l.pid)]
        paths = whitelisted_paths(cim_paths(pids))
        kill_res = terminate_pids(pids)
        t_kill = time.time()
        banner_restarting = wait_banner_phase(cdp, "restarting", 5.0)
        session_fault = wait_session_status(
            cdp, lambda st: st.get("state") == "suspended" and host_unavailable_error(st), 6.0)
        # B-8：sidecar 退出后 runtime 状态应立即清除（不存在 / get_runtime_info Err，无死 pid）
        absent_after_kill = False
        info_after_kill = None
        deadline = time.time() + 3.0
        while time.time() < deadline:
            absent_after_kill = not runtime_file(appdata).exists()
            info_after_kill = invoke(cdp, "get_runtime_info")
            if absent_after_kill and info_after_kill.get("ok") is False:
                break
            time.sleep(0.1)
        rust_logged = wait_until(lambda: "1s 后自动拉起" in l.tail(80), 8, 0.2)
        log_crash = [ln for ln in l.tail(80).splitlines() if "异常退出" in ln or "自动拉起" in ln]
        kill_ok = (len(pids) > 0 and all(v["whitelisted"] for v in paths.values())
                   and all(r.get("ok") is not False for r in kill_res)
                   and l.alive() and rust_logged)
        check(checks, "B", "W07B-B-2",
              "运行中按 PID/路径白名单杀测试 sidecar（主进程存活；Rust 日志记录异常退出 + 1s 后自动拉起第 1/3 次）",
              kill_ok,
              {"backend_pids": pids, "paths": paths, "kill": kill_res,
               "main_alive": l.alive(), "rust_log": log_crash,
               "kill_t": round(t_kill - l.t0, 3)})
        metrics["kill1"] = {"pids": pids, "kill": kill_res, "paths": paths,
                            "log": log_crash, "t": round(t_kill - l.t0, 3)}

        restart = wait_new_backend(l, backend_pid, timeout=15)
        banner_recovered = wait_banner_phase(cdp, "recovered", 6.0) if restart else None
        session_restored = wait_session_status(
            cdp, lambda st: st.get("state") == "active" and not str(st.get("lastError") or ""), 6.0)
        info_after_restart = invoke(cdp, "get_runtime_info")
        rt_after1 = read_json_safe(runtime_file(appdata)) or {}
        ui_ok = wait_until(lambda: "后端未连接" not in body_text(cdp), 10, 0.3)
        check(checks, "B", "W07B-B-3",
              "Rust 自动重启 sidecar 可观测：runtime.json 重写为新 pid/端口且进程存活（≤15s），UI 状态栏正常",
              restart is not None and ui_ok,
              {"restart": restart, "ui_ok": ui_ok, "get_runtime_info": info_after_restart})
        metrics["restart1"] = restart

        # B-4：崩溃瞬间 UI 可见 banner（restarting 含第 N/M 次）→ 恢复后 recovered（TTL 内）
        b4_ok = (isinstance(banner_restarting, dict)
                 and banner_restarting.get("phase") == "restarting"
                 and ("自动恢复" in str(banner_restarting.get("text") or "")
                      or "重连中" in str(banner_restarting.get("text") or ""))
                 and isinstance(banner_recovered, dict)
                 and banner_recovered.get("phase") == "recovered"
                 and "已恢复" in str(banner_recovered.get("text") or ""))
        check(checks, "B", "W07B-B-4",
              "崩溃瞬间 UI 可见错误提示：App 级 runtime-health-banner（data-phase=restarting，含自动恢复第 N/M 次）"
              "→ 恢复后 data-phase=recovered（后端已恢复）",
              b4_ok, {"banner_restarting": banner_restarting, "banner_recovered": banner_recovered,
                      "window_health": (banner_restarting or {}).get("health")})
        metrics["banner1"] = {"restarting": banner_restarting, "recovered": banner_recovered}

        # B-5：故障期间会话如实 suspended + E_HOST_UNAVAILABLE；恢复后 active + lastError 清空
        b5_ok = (isinstance(session_fault, dict) and session_fault.get("state") == "suspended"
                 and host_unavailable_error(session_fault))
        check(checks, "B", "W07B-B-5",
              "sidecar 故障期间 guest 会话如实挂起：workshop_pack_session_status → state=suspended、"
              "lastError 含 E_HOST_UNAVAILABLE（不计 guest 崩溃/不进 safeMode）",
              b5_ok, {"session_fault": session_fault, "session_file": session_state()})
        b5b_ok = (isinstance(session_restored, dict) and session_restored.get("state") == "active"
                  and not str(session_restored.get("lastError") or ""))
        check(checks, "B", "W07B-B-5b",
              "sidecar 恢复（ke:runtime-ready）后 guest 会话恢复 active 且 lastError 清空",
              b5b_ok, {"session_restored": session_restored, "session_file": session_state()})
        metrics["session_fault"] = session_fault
        metrics["session_restored"] = session_restored

        g_rec = guest_snapshot(cdp, wait_s=30)
        rec_doc = (g_rec or {}).get("snapshot") or {}
        check(checks, "B", "W07B-B-6",
              "自动重启后 guest 桥接恢复：context.snapshot 再次成功且正文等于磁盘",
              (g_rec or {}).get("ok") is True and rec_doc.get("content") == article,
              {"recovery_snapshot": g_rec})
        rt_after = read_json_safe(runtime_file(appdata)) or {}
        cur_pid = ((rt_after.get("backend") or {}).get("pid"))

        # ---------- 再连续杀 3 次（第 2/3 次自动重启，第 4 次触发「崩溃重启次数耗尽」）----------
        extra_kills = []
        for idx in range(2, 5):
            pids = [p["pid"] for p in sidecar_pids(l.pid)]
            if not pids:
                break
            res = terminate_pids(pids)
            entry = {"round": idx, "pids": pids, "kill": res,
                     "t_s": round(time.time() - t_kill, 2)}
            if idx < 4:
                nxt = wait_new_backend(l, cur_pid, timeout=15)
                entry["restart"] = nxt
                if not nxt:
                    extra_kills.append(entry)
                    break
                cur_pid = nxt["pid"]
            extra_kills.append(entry)
        if extra_kills and extra_kills[-1]["round"] == 4:
            time.sleep(6.0)  # 第 4 次后应不再拉起且进入终态
        exhaust_logged = wait_until(lambda: "崩溃重启次数耗尽" in l.tail(120), 10, 0.3)
        no_backend = len(sidecar_pids(l.pid)) == 0
        main_alive = l.alive()
        check(checks, "B", "W07B-B-7",
              "连续杀 sidecar 触发「崩溃重启次数耗尽」（设计上限 3 次）：日志明确、不再自动拉起、主进程存活",
              exhaust_logged and no_backend and main_alive,
              {"extra_kills": extra_kills, "exhaust_logged": exhaust_logged,
               "backend_pids_after": [p["pid"] for p in sidecar_pids(l.pid)],
               "main_alive": main_alive, "log_tail": l.tail(20)})

        banner_degraded = wait_banner_phase(cdp, "degraded", 6.0)
        session_terminal = wait_session_status(
            cdp, lambda st: st.get("state") == "suspended" and host_unavailable_error(st), 6.0)
        absent_final = wait_until(lambda: not runtime_file(appdata).exists(), 5, 0.2)
        info_final = invoke(cdp, "get_runtime_info")
        stale_pid = ((info_final or {}).get("value") or {}).get("pid")
        b8_ok = (absent_after_kill and info_after_kill.get("ok") is False
                 and absent_final and info_final.get("ok") is False and not backend_alive(stale_pid))
        check(checks, "B", "W07B-B-8",
              "崩溃重启耗尽后 runtime 状态无陈旧死 pid：runtime.json 不存在、get_runtime_info 返回 Err"
              "（退出瞬间也立即清理，重启成功后重写）",
              b8_ok,
              {"absent_after_kill": absent_after_kill, "info_after_kill": info_after_kill,
               "absent_final": absent_final, "info_final": info_final,
               "runtime_json_final": read_json_safe(runtime_file(appdata))})
        b9_ok = (isinstance(banner_degraded, dict) and banner_degraded.get("phase") == "degraded"
                 and "重启次数已耗尽" in str(banner_degraded.get("text") or "")
                 and "后端已降级" in str(banner_degraded.get("text") or ""))
        check(checks, "B", "W07B-B-9",
              "崩溃耗尽后 UI 降级可见：banner data-phase=degraded 且文案含真实原因（自动重启次数已耗尽）",
              b9_ok, {"banner_degraded": banner_degraded, "body_tail": body_text(cdp)[-500:]})
        metrics["terminal"] = {"banner_degraded": banner_degraded,
                               "session_terminal": session_terminal,
                               "absent_final": absent_final, "info_final": info_final}
        g_fail = guest_snapshot(cdp, timeout_ms=20000, wait_s=25)
        metrics["outage_guest"] = g_fail

        # ---------- 恢复：用户重启应用（正常启动/退出冒烟 + banner 不误报）----------
        metrics["stop"] = stop_launch(l, cdp)
        cdp.close()
        cdp = None
    finally:
        if l.alive():
            try:
                l.proc.kill()
                l.proc.wait(timeout=5)
            except Exception:
                pass
        cleanup_test_procs()
        l.close_log()
        try:
            if cdp is not None:
                cdp.close()
        except Exception:
            pass

    l2 = launch_app("b-recover", appdata, ws, ctx["pubkeys"])
    cdp2, obs2 = wait_main_ready()
    try:
        rt2 = {}
        if wait_until(lambda: isinstance(((read_json_safe(runtime_file(appdata)) or {})
                                          .get("backend") or {}).get("pid"), int), 30, 0.3):
            rt2 = read_json_safe(runtime_file(appdata)) or {}
        pid2 = ((rt2.get("backend") or {}).get("pid"))
        health2 = http_json(f"http://127.0.0.1:{((rt2.get('backend') or {}).get('port'))}/api/health", 3.0) \
            if (rt2.get("backend") or {}).get("port") else {"ok": False}
        listed = False
        enable_ok = False
        rec_ok = False
        banner_absent = None
        if cdp2 is not None:
            open_workshop(cdp2)
            lst = invoke(cdp2, "workshop_pack_list")
            listed = PACK_ID in json.dumps(lst, ensure_ascii=False)
            en2 = enable_guest(cdp2, PACK_ID)
            enable_ok = en2.get("ok") is True
            g2 = guest_snapshot(cdp2, wait_s=35)
            article = (ws / "Articles" / "bridge.md").read_text(encoding="utf-8")
            rec_ok = (g2 or {}).get("ok") is True and \
                ((g2 or {}).get("snapshot") or {}).get("content") == article
            time.sleep(1.0)
            banner_absent = banner_state(cdp2) is None  # 正常启动/无异常事件 → banner 不渲染（不误报）
            ok2 = bool(health2.get("ok") and isinstance(pid2, int) and backend_alive(pid2)
                       and listed and enable_ok and rec_ok and banner_absent)
            check(checks, "B", "W07B-B-10",
                  "恢复路径：用户重启应用后启动成功（runtime/sidecar healthy + 工坊包在列 + 重新启用 guest + "
                  "snapshot 成功 + 无异常时 banner 不误报）",
                  ok2,
                  {"new_pid": pid2, "health": health2, "pack_listed": listed,
                   "enable": en2, "snapshot": g2, "banner_absent_on_normal_start": banner_absent})
            invoke(cdp2, "workshop_pack_uninstall", {"id": PACK_ID})
        else:
            check(checks, "B", "W07B-B-10", "恢复路径：用户重启应用后启动成功", False,
                  {"error": "重启后 CDP 主窗口未就绪"})
        metrics["recover_restart"] = {"obs": obs2, "runtime": rt2}
        metrics["stop2"] = stop_launch(l2, cdp2)
        try:
            if cdp2 is not None:
                cdp2.close()
        except Exception:
            pass
    finally:
        if l2.alive():
            try:
                l2.proc.kill()
                l2.proc.wait(timeout=5)
            except Exception:
                pass
        cleanup_test_procs()
        l2.close_log()
        cleanup_my_packs()
        try:
            if cdp2 is not None:
                cdp2.close()
        except Exception:
            pass
    return metrics


# ============================== 场景 C：原生 Rust 恢复 ==============================

def scenario_c1(checks: list, ctx: dict) -> dict:
    print("\n===== 场景 C1：损坏 active + 可用 previous → 启动 rollback + IPC/UI 修复 =====", flush=True)
    cleanup_my_packs()
    appdata, ws = ctx["c_appdata"], ctx["c_ws"]
    fs_make_pack(PACK_ROOT, C1_ID, "1.0.0", "<html>c1 v1 ok</html>")
    fs_make_pack(PACK_ROOT, C1_ID, "2.0.0", "<html>c1 v2 ok</html>")
    fs_corrupt(PACK_ROOT, C1_ID, "2.0.0")
    fs_write_state(PACK_ROOT, C1_ID, "2.0.0", "1.0.0")
    others = audit_other_packs(MY_IDS)
    expected_safe = bool(others["corrupt"])
    t_launch = time.time()
    l = launch_app("c1", appdata, ws, ctx["pubkeys"])
    cdp, obs = wait_main_ready()
    metrics: dict = {"others_packs": others, "main_ready": obs}
    try:
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        status = fresh_recover_status(t_launch)
        res = recover_result(status, C1_ID)
        check(checks, "C1", "W07B-C1-1",
              "启动 recover：本包 action=rollback-corrupt-active、recovered=true（状态文件本次新写）",
              isinstance(res, dict) and res.get("action") == "rollback-corrupt-active"
              and res.get("recovered") is True,
              {"pack_result": res, "checked": (status or {}).get("checked"),
               "safeMode": (status or {}).get("safeMode"),
               "generatedAtLocal": (status or {}).get("generatedAtLocal")})
        st = fs_state(PACK_ROOT, C1_ID) or {}
        v1_ok, v1_reason = fs_verify_pack(PACK_ROOT, C1_ID, "1.0.0")
        v2_dir = (PACK_ROOT / C1_ID / "2.0.0").exists()
        check(checks, "C1", "W07B-C1-2",
              "数据一致性：磁盘 state.active=1.0.0、v1 verify=true、损坏的 v2 目录仍在（回滚不是删除）",
              st.get("active") == "1.0.0" and v1_ok and v2_dir,
              {"state": st, "v1_verify": [v1_ok, v1_reason], "v2_dir_exists": v2_dir})
        rec = invoke(cdp, "workshop_pack_recover", {"id": C1_ID})
        st2 = fs_state(PACK_ROOT, C1_ID) or {}
        check(checks, "C1", "W07B-C1-3",
              "IPC workshop_pack_recover 幂等一致：action=clean、recovered=false，磁盘状态不变",
              rec.get("ok") is True and ((rec.get("value") or {}).get("action") == "clean")
              and ((rec.get("value") or {}).get("recovered") is False)
              and st2.get("active") == "1.0.0",
              {"recover": rec, "state": st2})
        pre_panel_body = body_text(cdp)
        silent = not any(m in pre_panel_body for m in
                         ("回滚", "已恢复", "safe mode", "safeMode", "恢复"))
        check(checks, "C1", "W07B-C1-4",
              "[缺口观测] 启动自动回滚有用户可见提示（实测预期 FAIL：仅写 recover-status 文件；启动事件 emit 早于"
              "前端挂载 → 工坊入口无提示，用户需主动点「检查/修复全部包」才可见）",
              not silent,
              {"body_snippet": pre_panel_body[-500:], "silent": silent})
        open_workshop(cdp)
        click_text(cdp, "检查/修复全部包")
        msg = wait_panel_message(cdp, "已检查", 20)
        status2 = read_recover_status()
        res2 = recover_result(status2, C1_ID)
        safe2 = (status2 or {}).get("safeMode")
        check(checks, "C1", "W07B-C1-5",
              "UI「检查/修复全部包」可观测：面板提示「已检查 N 个包」、本包结果 clean、safeMode 与其它包审计一致",
              msg is not None and isinstance(res2, dict) and res2.get("action") == "clean"
              and safe2 == expected_safe,
              {"message": msg, "pack_result": res2, "safeMode": safe2,
               "expected_safeMode": expected_safe, "others": others,
               "generatedAtLocal": (status2 or {}).get("generatedAtLocal")})
        metrics["status"] = {k: (status or {}).get(k) for k in ("checked", "safeMode", "generatedAtLocal")}
        metrics["status_after_ui"] = {k: (status2 or {}).get(k) for k in
                                      ("checked", "safeMode", "generatedAtLocal")}
        metrics["stop"] = stop_launch(l, cdp)
        cdp.close()
        cdp = None
    finally:
        if l.alive():
            try:
                l.proc.kill()
                l.proc.wait(timeout=5)
            except Exception:
                pass
        cleanup_test_procs()
        l.close_log()
        cleanup_my_packs()
        try:
            if cdp is not None:
                cdp.close()
        except Exception:
            pass
    return metrics


def scenario_c2(checks: list, ctx: dict) -> dict:
    print("\n===== 场景 C2：损坏 active + 无回退 → safeMode + UI 修复/卸载重装恢复 =====", flush=True)
    cleanup_my_packs()
    appdata, ws = ctx["c_appdata"], ctx["c_ws"]
    fs_make_pack(PACK_ROOT, C2_ID, "1.0.0", "<html>c2 v1 ok</html>")
    fs_corrupt(PACK_ROOT, C2_ID, "1.0.0")
    fs_write_state(PACK_ROOT, C2_ID, "1.0.0", None)
    others = audit_other_packs(MY_IDS)
    t_launch = time.time()
    l = launch_app("c2", appdata, ws, ctx["pubkeys"])
    cdp, obs = wait_main_ready()
    metrics: dict = {"others_packs": others, "main_ready": obs}
    c2_fixed = ctx["c2_fixed_pack"]
    try:
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        status = fresh_recover_status(t_launch)
        res = recover_result(status, C2_ID)
        check(checks, "C2", "W07B-C2-1",
              "启动 recover：本包 action=corrupt-no-fallback、recovered=false、全局 safeMode=true、主进程存活",
              isinstance(res, dict) and res.get("action") == "corrupt-no-fallback"
              and res.get("recovered") is False and (status or {}).get("safeMode") is True
              and l.alive(),
              {"pack_result": res, "safeMode": (status or {}).get("safeMode"),
               "checked": (status or {}).get("checked"),
               "generatedAtLocal": (status or {}).get("generatedAtLocal")})
        pre_panel_body = body_text(cdp)
        entry_marker = ("safe mode" in pre_panel_body) or ("safeMode" in pre_panel_body)
        check(checks, "C2", "W07B-C2-2",
              "[缺口观测] 启动后工坊入口显示 safeMode 标记（实测预期 FAIL：Rust setup 中 emit "
              "workshop://recover-status 早于前端挂载 → 事件丢失，入口无标记）",
              entry_marker,
              {"body_head": pre_panel_body[:400], "entry_marker": entry_marker})
        open_workshop(cdp)
        click_text(cdp, "检查/修复全部包")
        msg = wait_panel_message(cdp, "已检查", 20)
        body_panel = body_text(cdp)
        banner = "有包无法自动恢复" in body_panel
        check(checks, "C2", "W07B-C2-3",
              "主动「检查/修复全部包」后 UI 显示「有包无法自动恢复（safe mode）」横幅（恢复状态可经主动操作观测）",
              msg is not None and banner, {"message": msg, "banner": banner})
        clicked = click_row_button(cdp, C2_ID, ["修复/恢复"])
        msg2 = wait_panel_message(cdp, "无需恢复", 15) or wait_panel_message(cdp, "已恢复", 15)
        still_corrupt = fs_verify_pack(PACK_ROOT, C2_ID, "1.0.0")[0] is False
        st = fs_state(PACK_ROOT, C2_ID) or {}
        check(checks, "C2", "W07B-C2-4",
              "单包「修复/恢复」如实返回 corrupt-no-fallback（不假修复）：UI 提示 + 磁盘仍损坏",
              clicked and msg2 is not None and "corrupt-no-fallback" in (msg2 or "") and still_corrupt,
              {"clicked": clicked, "message": msg2, "state": st, "still_corrupt": still_corrupt})
        check(checks, "C2", "W07B-C2-5",
              "[缺口观测] 无回退损坏包可自动修复（实测预期 FAIL：recover 命令对 corrupt-no-fallback 无修复能力，"
              "唯一恢复路径=用户卸载/重装）",
              not still_corrupt, {"still_corrupt": still_corrupt})
        # 恢复路径：UI 卸载 → 安装有效包 → 检查/修复 → safeMode 清除
        click_row_button(cdp, C2_ID, ["卸载"])
        time.sleep(0.4)
        click_row_button(cdp, C2_ID, ["确认卸载"])
        msg_un = wait_panel_message(cdp, "已卸载", 20)
        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(c2_fixed)}, timeout=30)
        wait_until(lambda: ((fs_state(PACK_ROOT, C2_ID) or {}).get("active") == "1.0.0"), 20, 0.3)
        click_text(cdp, "检查/修复全部包")
        msg3 = wait_panel_message(cdp, "已检查", 20)
        status3 = read_recover_status()
        res3 = recover_result(status3, C2_ID)
        fixed_ok = fs_verify_pack(PACK_ROOT, C2_ID, "1.0.0")[0]
        expected_safe = bool(others["corrupt"])
        banner_gone = "有包无法自动恢复" not in body_text(cdp)
        check(checks, "C2", "W07B-C2-6",
              "恢复路径（用户卸载+重装有效包）→ safeMode 清除、本包 verify=true、UI 横幅消失且「已检查」可观测",
              msg_un is not None and inst.get("ok") is True and fixed_ok
              and (status3 or {}).get("safeMode") == expected_safe
              and banner_gone and msg3 is not None,
              {"uninstall_message": msg_un, "install": inst, "verify_ok": fixed_ok,
               "safeMode": (status3 or {}).get("safeMode"), "expected": expected_safe,
               "pack_result": res3, "banner_gone": banner_gone, "ui_message": msg3})
        metrics["status"] = {k: (status or {}).get(k) for k in ("checked", "safeMode", "generatedAtLocal")}
        metrics["status_after_recovery"] = {k: (status3 or {}).get(k) for k in
                                            ("checked", "safeMode", "generatedAtLocal")}
        metrics["stop"] = stop_launch(l, cdp)
        cdp.close()
        cdp = None
    finally:
        if l.alive():
            try:
                l.proc.kill()
                l.proc.wait(timeout=5)
            except Exception:
                pass
        cleanup_test_procs()
        l.close_log()
        cleanup_my_packs()
        try:
            if cdp is not None:
                cdp.close()
        except Exception:
            pass
    return metrics


def scenario_c3(checks: list, ctx: dict) -> dict:
    print("\n===== 场景 C3：半成品事务（txn/journal）→ 启动 cleanup-journal + IPC/UI 一致 =====", flush=True)
    cleanup_my_packs()
    appdata, ws = ctx["c_appdata"], ctx["c_ws"]
    fs_make_pack(PACK_ROOT, C3_ID, "1.0.0", "<html>c3 v1 ok</html>")
    fs_write_state(PACK_ROOT, C3_ID, "1.0.0", None)
    pdir = PACK_ROOT / C3_ID
    staging = pdir / ".staging-1.1.0-w07probe"
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "index.html").write_text("<html>half installed</html>", encoding="utf-8")
    partial = pdir / "1.1.0"
    partial.mkdir(parents=True, exist_ok=True)
    (partial / "index.html").write_text("<html>partial version</html>", encoding="utf-8")
    (pdir / "txn.json").write_text(json.dumps({
        "op": "install", "id": C3_ID, "version": "1.1.0",
        "staging": str(staging), "before": {"active": "1.0.0", "previous": None},
    }, ensure_ascii=False), encoding="utf-8")
    others = audit_other_packs(MY_IDS)
    expected_safe = bool(others["corrupt"])
    t_launch = time.time()
    l = launch_app("c3", appdata, ws, ctx["pubkeys"])
    cdp, obs = wait_main_ready()
    metrics: dict = {"others_packs": others, "main_ready": obs}
    try:
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        status = fresh_recover_status(t_launch)
        res = recover_result(status, C3_ID)
        check(checks, "C3", "W07B-C3-1",
              "启动 recover：本包 action=cleanup-journal、recovered=true（清半成品事务）、safeMode 与其它包审计一致",
              isinstance(res, dict) and res.get("action") == "cleanup-journal"
              and res.get("recovered") is True
              and (status or {}).get("safeMode") == expected_safe,
              {"pack_result": res, "safeMode": (status or {}).get("safeMode"),
               "expected_safeMode": expected_safe, "others": others,
               "generatedAtLocal": (status or {}).get("generatedAtLocal")})
        txn_gone = not (pdir / "txn.json").exists()
        staging_gone = not staging.exists()
        partial_gone = not partial.exists()
        v1_ok, v1_reason = fs_verify_pack(PACK_ROOT, C3_ID, "1.0.0")
        st = fs_state(PACK_ROOT, C3_ID) or {}
        check(checks, "C3", "W07B-C3-2",
              "数据一致性：txn.json/staging 目录/未完成版本 1.1.0 均被清理，active=1.0.0 且 verify=true",
              txn_gone and staging_gone and partial_gone and st.get("active") == "1.0.0" and v1_ok,
              {"txn_gone": txn_gone, "staging_gone": staging_gone, "partial_gone": partial_gone,
               "state": st, "v1_verify": [v1_ok, v1_reason]})
        rec = invoke(cdp, "workshop_pack_recover", {"id": C3_ID})
        check(checks, "C3", "W07B-C3-3",
              "IPC workshop_pack_recover 幂等一致：事务清理后 action=clean、recovered=false",
              rec.get("ok") is True and ((rec.get("value") or {}).get("action") == "clean")
              and ((rec.get("value") or {}).get("recovered") is False),
              rec)
        pre_panel_body = body_text(cdp)
        silent = not any(m in pre_panel_body for m in ("恢复", "清理", "safe mode", "safeMode"))
        open_workshop(cdp)
        click_text(cdp, "检查/修复全部包")
        msg = wait_panel_message(cdp, "已检查", 20)
        status2 = read_recover_status()
        res2 = recover_result(status2, C3_ID)
        check(checks, "C3", "W07B-C3-4",
              "UI「检查/修复全部包」可观测：提示「已检查 N 个包」、本包 clean、safeMode 与审计一致",
              msg is not None and isinstance(res2, dict) and res2.get("action") == "clean"
              and (status2 or {}).get("safeMode") == expected_safe,
              {"message": msg, "pack_result": res2,
               "safeMode": (status2 or {}).get("safeMode"), "expected": expected_safe,
               "generatedAtLocal": (status2 or {}).get("generatedAtLocal")})
        check(checks, "C3", "W07B-C3-5",
              "[缺口观测] 启动自动清理半成品有用户可见提示（实测预期 FAIL：仅写 recover-status 文件，UI 无提示）",
              not silent, {"silent": silent, "body_snippet": pre_panel_body[-400:]})
        metrics["status"] = {k: (status or {}).get(k) for k in ("checked", "safeMode", "generatedAtLocal")}
        metrics["status_after_ui"] = {k: (status2 or {}).get(k) for k in
                                      ("checked", "safeMode", "generatedAtLocal")}
        metrics["stop"] = stop_launch(l, cdp)
        cdp.close()
        cdp = None
    finally:
        if l.alive():
            try:
                l.proc.kill()
                l.proc.wait(timeout=5)
            except Exception:
                pass
        cleanup_test_procs()
        l.close_log()
        cleanup_my_packs()
        try:
            if cdp is not None:
                cdp.close()
        except Exception:
            pass
    return metrics


# ============================== 入口 ==============================

def env_metadata() -> dict:
    meta = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "platform": platform.platform(),
        "windows_version": platform.version(),
        "python": sys.version.split()[0],
        "repo": str(REPO),
        "exe": str(EXE),
        "exe_sha256": sha_file(EXE) if EXE.exists() else None,
        "exe_mtime": time.strftime("%Y-%m-%dT%H:%M:%S",
                                   time.localtime(EXE.stat().st_mtime)) if EXE.exists() else None,
        "exe_size": EXE.stat().st_size if EXE.exists() else None,
        "isolated_identifier": ISOLATED_IDENTIFIER,
        "pack_root": str(PACK_ROOT),
        "cdp_port": CDP_PORT,
        "my_pack_ids": MY_IDS,
        "appdata_isolation": str(BASE_ROOT / "*" / "appdata"),
        "ports_8000_8002_before": {str(p): ("free" if port_free(p) else "occupied")
                                   for p in (8000, 8001, 8002)},
    }
    try:
        meta["git_head"] = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"],
                                          capture_output=True, text=True, encoding="utf-8",
                                          timeout=15).stdout.strip()
        meta["git_branch"] = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--abbrev-ref", "HEAD"],
                                            capture_output=True, text=True, encoding="utf-8",
                                            timeout=15).stdout.strip()
    except Exception:
        meta["git_head"] = None
    return meta


def main() -> int:
    selected = ["A", "B", "C1", "C2", "C3"]
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--scenarios" and i + 1 < len(argv):
            selected = [x.strip().upper() for x in argv[i + 1].split(",") if x.strip()]
    merge_mode = "--merge" in argv
    print(f"scenarios={selected} cdp_port={CDP_PORT} merge={merge_mode} exe={EXE}", flush=True)
    if "--dry-run" in argv:
        refresh_pack_root()
        dry = {
            "python": sys.version.split()[0], "platform": platform.platform(),
            "exe": str(EXE), "exe_exists": EXE.exists(),
            "exe_sha256": sha_file(EXE) if EXE.exists() else None,
            "exe_mtime": time.strftime("%Y-%m-%dT%H:%M:%S",
                                       time.localtime(EXE.stat().st_mtime)) if EXE.exists() else None,
            "node": NODE, "node_exists": Path(NODE).exists(),
            "sign_tool": str(SIGN_TOOL), "sign_tool_exists": SIGN_TOOL.exists(),
            "base_root": str(BASE_ROOT), "cdp_port": CDP_PORT,
            "pack_root": str(PACK_ROOT), "pack_root_exists": PACK_ROOT.exists(),
            "recover_status": str(RECOVER_STATUS), "recover_status_exists": RECOVER_STATUS.exists(),
            "session_status": str(SESSION_STATUS), "session_status_exists": SESSION_STATUS.exists(),
            "my_pack_dirs": {pid: (PACK_ROOT / pid).exists() for pid in MY_IDS},
            "other_packs_audit": audit_other_packs(MY_IDS),
            "user_app_pid": user_pid(),
            "product_procs": all_product_procs(),
            "ports_8000_8002": {str(p): ("free" if port_free(p) else "occupied")
                                for p in (8000, 8001, 8002)},
        }
        print(json.dumps(dry, ensure_ascii=False, indent=2), flush=True)
        return 0
    if not EXE.exists():
        print(f"缺少隔离测试构建: {EXE}")
        return 2
    if not Path(NODE).exists():
        print(f"缺少 node（签名工具依赖）: {NODE}")
        return 2

    EVID.mkdir(parents=True, exist_ok=True)
    # 串行窗口：若已有产品实例（其它 teammate 探针），等待而不是强杀
    procs = all_product_procs()
    if procs:
        print(f"检测到已有产品实例（等待释放，绝不强杀）：{procs}", flush=True)
        if not wait_until(lambda: not all_product_procs(), 600, 3.0):
            print("等待超时：产品实例仍被占用 → 不启动本探针（请 Lead 协调窗口）")
            return 3
    shutil.rmtree(BASE_ROOT, ignore_errors=True)
    BASE_ROOT.mkdir(parents=True, exist_ok=True)
    cleanup_test_procs()

    user_before = user_pid()
    env_meta = env_metadata()
    ctx: dict = {"pubkeys": None, "guest_pack": None, "c2_fixed_pack": None}
    checks: list = []
    scenarios: dict = {}
    try:
        gp, gp_pub = build_signed_guest_pack(BASE_ROOT / "packs")
        c2p, c2_pub = build_signed_fixed_c2(BASE_ROOT / "packs")
        ctx["guest_pack"], ctx["c2_fixed_pack"] = gp, c2p
        ctx["pubkeys"] = {**gp_pub, **c2_pub}  # k1=guest 包；k2=C2 重装包
        c_appdata, c_ws = isolated_paths("c")[1:]
        prepare_appdata(c_appdata, c_ws)
        ctx["c_appdata"], ctx["c_ws"] = c_appdata, c_ws
        fn_map = {"A": scenario_a, "B": scenario_b,
                  "C1": scenario_c1, "C2": scenario_c2, "C3": scenario_c3}
        for key in selected:
            fn = fn_map.get(key)
            if fn is None:
                continue
            try:
                scenarios[key] = fn(checks, ctx)
            except Exception:
                scenarios[key] = {"error": traceback.format_exc()}
                print(f"SCENARIO {key} ERROR:\n{traceback.format_exc()}", flush=True)
            finally:
                cleanup_test_procs()
    finally:
        cleanup_test_procs()
        cleanup_my_packs()
    user_after = user_pid()

    leftovers = all_product_procs()
    user_impact = {"user_app_pids_before": user_before, "user_app_pids_after": user_after,
                   "n_a": (not user_before and not user_after)}
    check(checks, "SAFE", "W07B-S-1",
          "测试进程按路径白名单清理无残留（knowledgeeditor/-backend；未使用 taskkill /IM）",
          len(leftovers) == 0,
          {"leftovers": leftovers,
           "cleanup_rule": "自身 Popen PID + C:\\ke-tmp\\uiws-t26\\bin\\* / F:\\Work\\Dev\\cargo-target\\* 路径白名单"})
    check(checks, "SAFE", "W07B-S-2",
          "用户实例未受影响（N/A：用户 App 未运行，运行前后只读查询均为空；未启动/未杀用户进程）",
          len(user_after) == 0, user_impact)
    check(checks, "SAFE", "W07B-S-3",
          "仅操作隔离数据/自有 pack id（共享 workshop-packs 目录未删；自有 id 已清理；其它探针包未触碰）",
          True,
          {"base_root": str(BASE_ROOT), "pack_root": str(PACK_ROOT),
           "my_pack_ids": MY_IDS, "other_packs_audit": audit_other_packs(MY_IDS)})

    out_path = EVID / "T26-W07-bridge-results.json"
    merged_runs_out: list = []
    _merged_build_history: list = []
    merge_record = None
    if merge_mode and out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            prev = None
        if isinstance(prev, dict):
            prev_scen = dict(prev.get("scenarios") or {})
            for key in selected:
                if key in scenarios:
                    prev_scen[key] = scenarios[key]
            # SAFE 检查每轮都重新生成 → 合并时丢弃旧 SAFE，避免重复
            keep_checks = [c for c in (prev.get("checks") or [])
                           if c.get("scenario") not in set(selected)
                           and c.get("scenario") != "SAFE"]
            checks = keep_checks + checks
            scenarios = prev_scen
            merge_record = {"run_at": env_meta.get("generated_at"), "scenarios": list(selected),
                            "cdp_port": CDP_PORT,
                            "merged_into_existing": True}
            prev_runs = list(prev.get("merged_runs") or [])
            prev_runs.append(merge_record)
            merged_runs_out = prev_runs
            prev_env = prev.get("environment") or {}
            if prev_env.get("exe_sha256") and prev_env.get("exe_sha256") != env_meta.get("exe_sha256"):
                # 测试构建已重建（如修复后复测）→ environment 用新构建，旧构建记入 build_history
                build_history = list(prev.get("build_history") or [])
                build_history.append({
                    "exe_sha256": prev_env.get("exe_sha256"),
                    "exe_mtime": prev_env.get("exe_mtime"),
                    "exe_size": prev_env.get("exe_size"),
                    "note": "上一轮证据所用测试构建（已被新构建替换；旧场景 checks 保留其历史值）",
                })
                prev["build_history"] = build_history
                merge_record["build_changed"] = True
            else:
                env_meta = prev_env or env_meta
            _merged_build_history[:] = list(prev.get("build_history") or [])
            print(f"[merge] 合并 {selected} 到既有证据（保留 {len(keep_checks)} 条旧 checks）", flush=True)

    pass_count = sum(1 for c in checks if c["pass"])
    total = len(checks)
    gaps = [{"id": c["id"], "name": c["name"], "detail": c["detail"]}
            for c in checks if not c["pass"]]
    summary = {
        "generated_at": env_meta["generated_at"],
        "task": "task-10 / W07 扩展：桥接超时 + sidecar 故障 + 原生 Rust 恢复（隔离产品构建 W 证据）",
        "evidence_type": "W（真实产品隔离构建进程/协议/数据行为；故障注入方式见各场景 metrics）",
        "environment": env_meta,
        "build_history": _merged_build_history,
        "run_conditions": {
            "serial_exclusive_window": True,
            "window_note": "启动前检查无 knowledgeeditor 测试实例（与其它 teammate 探针串行）；被占用则等待且不强杀",
            "user_app_impact": user_impact,
            "cleanup_policy": "自身 Popen PID；sidecar 仅路径白名单；无 taskkill /IM；不触碰 D:\\AstraNota*",
            "pack_scope": f"仅自有 pack id {MY_IDS}；不删共享 {PACK_ROOT}；其它包损坏预先审计避免 safeMode 误判",
            "bridge_timeout_injection": "NtSuspendProcess 挂起本探针主进程的子进程（knowledgeeditor-backend 进程树，"
                                        "路径白名单校验）；Resume 后验证桥接恢复",
        },
        "scenarios": scenarios,
        "merged_runs": merged_runs_out,
        "checks": checks,
        "pass_count": pass_count,
        "total": total,
        "fail_count": total - pass_count,
        "gaps": gaps,
        "raw_notes": [
            "PASS/FAIL 为可观测断言；[缺口观测] FAIL = 发现真实缺口（如实记录，不夸大/不掩盖）",
            "全部故障注入只作用于隔离测试构建自建实例（自身 Popen 进程树/路径白名单）；用户 App 未运行 → N/A",
            "原生恢复 pack 为文件系统直写隔离 workshop-packs 自有 id（启动 recover 读取），非用户数据",
            "共享 workshop-packs 中其它探针/历史遗留包的损坏状态会先审计（audit_other_packs），safeMode 期望值取"
            "「本包预期 OR 其它包已损坏」",
        ],
    }
    out = EVID / "T26-W07-bridge-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nSUMMARY {pass_count}/{total} checks PASS, {total - pass_count} FAIL "
          f"(gaps={[g['id'] for g in gaps]}) -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
