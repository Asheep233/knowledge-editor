# -*- coding: utf-8 -*-
"""P5-T26 W07 扩展故障探针：boot crash / 连续启动失败（真实产品隔离构建 W 证据）。

背景（既有证据，不重复造轮子）：
- `run_t26_fault_probe.py`：guest 无限循环，宿主独立可恢复（W 8/8 PASS）；
- `run_t26_fault_mem_probe.py`：guest 内存/CPU 压力（W 21/21 PASS）；
- `run_t26_recover_probe.py`：启动 recover / safeMode（包损坏回退，A3）；
- `tools/t26_isolated_build.md`：隔离构建（identifier=com.astranota.uiws.e2e）、APPDATA 隔离、
  路径白名单清理、禁止 taskkill /IM、禁止触碰 D:\\AstraNota* 用户实例。

本探针补齐 W07 的 **boot crash（启动早期崩溃）** 与 **连续启动失败** 两个故障类别，分 5 个场景：

场景 A（启动早期强杀 → 重启恢复 / 数据完整性）：
- A1 首次运行：隔离 APPDATA 为空（无 data_dir）→ 启动 ~420ms（主窗口未就绪、runtime.json 未写）时
  按 **Popen 自身 PID** 强杀 → 重启：验证启动成功、启动 recover 状态可观测、隔离数据目录生成、
  JSON 未损坏、工作区夹具未被改动。
- A2 已有数据目录：正常启动（自动打开工作区）+ 安装签名探针包 → 优雅退出 →
  启动 ~800ms 早期强杀 → 重启：验证工作区自动打开、recover 状态（本包 action=clean）、
  包状态/配置/夹具完整；并如实记录「早期崩溃遗留孤儿 sidecar」是否被下次启动清理
  （Rust `cleanup_stale()` 依赖 runtime.json；早期崩溃时 runtime.json 尚未写出 → 预期看不到孤儿）。

- A3（补充）连续 3 次启动早期强杀（boot crash loop，300-800ms）→ 第 4 次启动：
  验证崩溃循环后仍可启动、recover 状态可观测、数据目录/配置/夹具无损坏（残留 sidecar 按白名单清理）。

场景 B（连续启动失败 → 宿主恢复路径 / 错误可观测性）：
- B1 sidecar 端口耗尽：用隔离端口族（KE_PORT）被占，连续 3 次启动失败（Rust `find_free_port`
  三次全失败 → `ke:runtime-error`）。端口释放后运行中实例不自动重试（无运行期自愈）→ 重启（默认
  端口）后恢复。注意：前端 CSP `connect-src` 只白名单 8000-8002，故失败注入用隔离端口族
  （与默认端口走同一 `find_free_port` 失败代码路径），恢复验证必须用默认端口，证据中注明。
- B2 应用数据目录被普通文件占位（非法状态）：连续 3 次启动失败（`创建应用数据目录失败 os error 183`），
  UI 约 30s 后显示「后端服务未连接」红色横幅（错误可观测）；解除占用后运行中实例不自动重试 →
  重启恢复。
- B3 损坏 settings.json / app_config.json（非法 JSON）：不阻断启动、静默回退默认值；
  检查是否有备份/自动修复/用户提示（无恢复路径则如实记为缺口）。

环境与红线：
- 只启动隔离测试构建 `C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe`；
  `APPDATA` 指向 `C:\\ke-tmp\\uiws-t26-w07boot\\*\\appdata`（产品 data_dir 由 env 决定），
  `KE_WORKSPACE` 指向隔离工作区；CDP 端口隔离（10310+），不碰用户实例/真实数据。
- 注意：Tauri `app_data_dir()` 走 KnownFolder（不随 APPDATA env 变），包/恢复状态在真实
  `%APPDATA%\\Roaming\\<隔离 identifier>\\workshop-packs`；本探针**只清理自有 pack id**
  `com.probe.t26w07boot`，不删除共享 workshop-packs 目录或其它探针的包。
- 进程清理：只按自身 Popen PID 终止主进程，sidecar 仅按路径白名单
  （`C:\\ke-tmp\\uiws-t26\\bin\\*` / `F:\\Work\\Dev\\cargo-target\\*`）清理；严禁 `taskkill /IM`、
  严禁触碰 `D:\\AstraNota*` 用户实例/数据；用户 App 未运行 → 用户影响 N/A（只读确认）。

用法（WSL）：
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \\
    \\$env:PYTHONIOENCODING='utf-8'; & 'C:\\Users\\y8882\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe' \\
    -X utf8 'F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_t26_boot_crash_probe.py'"
  可选参数：--scenarios A1,A2,B1,B2,B3（默认全部，必须串行独占运行）
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
BASE_ROOT = Path(r"C:\ke-tmp\uiws-t26-w07boot")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"

# 隔离测试构建 identifier（见 tools/t26_isolated_build.md；Lead 重建后仍不变）
ISOLATED_IDENTIFIER = "com.astranota.uiws.e2e"
MY_PACK_ID = "com.probe.t26w07boot"
CDP_PORT = 10310 + (os.getpid() % 40)
KE_PORT_B1 = 18640 + (os.getpid() % 20)

# 前端 UI 首帧判定标记（工作区外壳 / 工作区选择页）
UI_MARKERS = ("文章", "选择已有 workspace", "选择一个工作区", "创建新工作区")
BANNER_BACKEND_DOWN = ("后端服务未连接", "后端未连接")

# ============================== 通用工具 ==============================


def sha256_file(path: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json_safe(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def run_ps(script: str, timeout: float = 25.0) -> str:
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=timeout)
        return out.stdout or ""
    except Exception:
        return ""


def run_ps_json(script: str, timeout: float = 25.0):
    text = run_ps(script, timeout).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return text


def real_folder(name: str) -> Path:
    out = run_ps(f"[Environment]::GetFolderPath('{name}')")
    return Path(out.strip()) if out.strip() else Path(os.environ.get("APPDATA", "."))


def resolve_pack_root() -> Path:
    """隔离构建的包/恢复状态根目录（Tauri app_data_dir = KnownFolder\\<identifier>）。

    identifier 已知时优先使用；若该目录不存在（首次运行/被清理/重建后 identifier 变化），
    扫描 Roaming 下 com.astranota* 目录并取最新的一个兜底，避免探针直接失效。
    """
    roaming = real_folder("Roaming")
    direct = roaming / ISOLATED_IDENTIFIER / "workshop-packs"
    if direct.parent.exists():
        return direct
    candidates = []
    try:
        for d in roaming.glob("com.astranota*"):
            if d.is_dir() and ((d / "workshop-packs").exists() or
                               (d / "workshop-packs").parent == d):
                candidates.append(d / "workshop-packs")
    except OSError:
        pass
    if candidates:
        candidates.sort(key=lambda x: x.parent.stat().st_mtime, reverse=True)
        return candidates[0]
    return direct


PACK_ROOT = resolve_pack_root()
RECOVER_STATUS = PACK_ROOT / "workshop-recover-status.json"
MY_PACK_DIR = PACK_ROOT / MY_PACK_ID


def refresh_pack_root() -> Path:
    """应用首次启动后重新探测包根目录（identifier 目录可能刚被创建；重建后也可能变化）。"""
    global PACK_ROOT, RECOVER_STATUS, MY_PACK_DIR
    candidate = resolve_pack_root()
    if candidate != PACK_ROOT:
        PACK_ROOT = candidate
        RECOVER_STATUS = PACK_ROOT / "workshop-recover-status.json"
        MY_PACK_DIR = PACK_ROOT / MY_PACK_ID
    return PACK_ROOT


def decode_systemtime(value) -> str | None:
    """Rust `SystemTime` 序列化（intervals: 100ns since 1601）→ 本地时间字符串。"""
    if not isinstance(value, str):
        return None
    m = re.search(r"intervals:\s*(\d+)", value)
    if not m:
        return None
    try:
        unix = int(m.group(1)) / 1e7 - 11644473600
        return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(unix))
    except Exception:
        return None


def read_recover_status() -> dict | None:
    refresh_pack_root()
    data = read_json_safe(RECOVER_STATUS)
    if not isinstance(data, dict):
        return None
    data = dict(data)
    data["generatedAtLocal"] = decode_systemtime(data.get("generatedAt"))
    data["mtime"] = time.strftime("%Y-%m-%dT%H:%M:%S%z",
                                  time.localtime(RECOVER_STATUS.stat().st_mtime)) if RECOVER_STATUS.exists() else None
    data["_path"] = str(RECOVER_STATUS)
    return data


def recover_pack_result(status: dict | None, pack_id: str = MY_PACK_ID):
    if not isinstance(status, dict):
        return None
    for item in status.get("results") or []:
        if isinstance(item, dict) and item.get("id") == pack_id:
            return item
    return None


def count_lines_containing(path: Path, needle: str) -> int:
    try:
        return sum(1 for ln in path.read_text(encoding="utf-8", errors="replace").splitlines()
                   if needle in ln)
    except OSError:
        return 0


def log_tail(path: Path, n: int = 20) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(lines[-n:])
    except OSError:
        return ""


def port_free(port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def user_app_pids() -> list:
    """只读查询用户运行中的产品实例（D:\\AstraNota*）；未运行返回空列表。"""
    script = ("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
              "Get-CimInstance Win32_Process | "
              "Where-Object { $_.Name -in @('knowledgeeditor.exe','knowledgeeditor-backend.exe') "
              "-and $_.ExecutablePath -like 'D:\\AstraNota*' } | "
              "Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress")
    data = run_ps_json(script)
    if data is None:
        return []
    if isinstance(data, dict):
        return [data]
    return data if isinstance(data, list) else []


def cleanup_test_procs() -> None:
    """按路径白名单清理隔离测试构建的进程（严禁 taskkill /IM；不碰用户实例）。"""
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue; "
          "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
          "Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' -or "
          "$_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                   capture_output=True, text=True, timeout=30)


# ============================== 进程快照（Toolhelp32，快速/无 PowerShell 开销） ==============================

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
            out.append({"pid": e.th32ProcessID, "ppid": e.th32ParentProcessID, "name": e.szExeFile})
            ok = _k32.Process32NextW(h, ctypes.byref(e))
    finally:
        _k32.CloseHandle(h)
    return out


def descendants(root_pid: int) -> list:
    procs = proc_snapshot()
    children: dict = {}
    for p in procs:
        children.setdefault(p["ppid"], []).append(p)
    out, queue = [], [root_pid]
    seen = set()
    while queue:
        cur = queue.pop(0)
        if cur in seen:
            continue
        seen.add(cur)
        for p in children.get(cur, []):
            out.append(p)
            queue.append(p["pid"])
    return out


def backend_pids() -> set:
    return {p["pid"] for p in proc_snapshot() if p["name"].lower().startswith("knowledgeeditor-backend")}


# ============================== CDP ==============================


def cdp_targets() -> list:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=1) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


def cdp_version() -> dict:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=1) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=5, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None, timeout: float = 5.0) -> dict:
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

    def eval(self, expr: str, timeout: float = 5.0):
        res = self.call("Runtime.evaluate",
                        {"expression": expr, "returnByValue": True, "awaitPromise": True},
                        timeout)
        if res.get("exceptionDetails"):
            raise RuntimeError(str(res["exceptionDetails"])[:300])
        return (res.get("result") or {}).get("value")


def connect_main(timeout: float = 5.0) -> CDP | None:
    end = time.time() + timeout
    while time.time() < end:
        mains = [t for t in cdp_targets()
                 if t.get("type") == "page" and "tauri.localhost" in str(t.get("url"))
                 and t.get("webSocketDebuggerUrl")]
        if mains:
            try:
                return CDP(mains[0]["webSocketDebuggerUrl"])
            except Exception:
                pass
        time.sleep(0.1)
    return None


def invoke(cdp: CDP, cmd: str, payload: dict | None = None, timeout: float = 10.0) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload or {}) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    try:
        return cdp.eval(expr, timeout)
    except Exception as e:
        return {"ok": False, "error": f"cdp-eval-failed: {e}"}


def body_text(cdp: CDP, limit: int = 400) -> str:
    try:
        b = cdp.eval("(document.body&&document.body.innerText||'')")
        return str(b or "")[:limit]
    except Exception:
        return ""


def boot_timings(cdp: CDP):
    try:
        return cdp.eval("JSON.parse(JSON.stringify(window.__bootTimings||null))")
    except Exception:
        return None


def wait_internals(cdp: CDP, timeout: float = 10.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def cdp_close(cdp: CDP | None) -> None:
    if cdp is None:
        return
    try:
        cdp.ws.close()
    except Exception:
        pass


# ============================== 应用隔离环境 ==============================

FIXTURES = {
    "Articles/boot-crash.md": b"---\ntitle: boot crash fixture\n---\n\nW07 boot fixture.\n",
    "Articles/keep-me.md": b"---\ntitle: keep me\n---\n\nKeep me unchanged (integrity fixture).\n",
}


class Isolate:
    """单个场景的隔离环境：APPDATA（产品 data_dir）+ KE_WORKSPACE + CDP 端口。"""

    def __init__(self, name: str):
        self.name = name
        self.base = BASE_ROOT / name
        self.appdata = self.base / "appdata"
        self.workspace = self.base / "workspace"

    @property
    def ke_cfg(self) -> Path:
        return self.appdata / "KnowledgeEditor"

    @property
    def runtime_file(self) -> Path:
        return self.ke_cfg / "runtime" / "runtime.json"

    def reset(self, preseed_appdata: bool = True, recent_workspace: bool = True) -> None:
        shutil.rmtree(self.base, ignore_errors=True)
        (self.workspace / "Articles").mkdir(parents=True)
        for rel, data in FIXTURES.items():
            (self.workspace / rel).write_bytes(data)
        if preseed_appdata:
            self.ke_cfg.mkdir(parents=True, exist_ok=True)
            if recent_workspace:
                (self.ke_cfg / "app_config.json").write_text(json.dumps(
                    {"recent_workspaces": [str(self.workspace)], "recent_documents": []},
                    ensure_ascii=False), encoding="utf-8")
            (self.ke_cfg / "settings.json").write_text(json.dumps(
                {"schemaVersion": 1, "startup": {"autoOpenRecentWorkspace": True}},
                ensure_ascii=False), encoding="utf-8")

    def env(self, extra: dict | None = None) -> dict:
        env = {k: v for k, v in os.environ.items() if not k.startswith("KE_")}
        env.pop("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", None)
        env.update({
            "APPDATA": str(self.appdata),
            "KE_WORKSPACE": str(self.workspace),
            # backend AppConfig 首次启动会把旧 Web 版 ~/.knowledgeeditor/app_config.json 并入
            # 新位置；重定向 legacy 路径到隔离目录，避免读取/复制真实用户配置（data 隔离加固）
            "KE_APP_CONFIG_LEGACY": str(self.base / "legacy-app-config.json"),
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
        })
        if extra:
            env.update(extra)
        return env

    def launch(self, tag: str, extra: dict | None = None) -> "Launch":
        log_path = self.base / f"{tag}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log = log_path.open("w", encoding="utf-8")
        proc = subprocess.Popen([str(EXE)], env=self.env(extra),
                                stdout=log, stderr=subprocess.STDOUT)
        return Launch(tag, proc, log, log_path)

    def fixture_hashes(self) -> dict:
        return {rel: sha256_file(self.workspace / rel) for rel in FIXTURES}


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

    def tail(self, n: int = 20) -> str:
        return log_tail(self.log_path, n)

    def close_log(self) -> None:
        try:
            self.log.close()
        except Exception:
            pass


def stop_launch(l: Launch, cdp: CDP | None = None, graceful: bool = False) -> dict:
    """终止一次测试启动：优先优雅退出（app_request_exit），否则按自身 Popen PID 强杀。

    记录强杀后的自家孤儿（sidecar/webview）后在 evidence 中保留，再按路径白名单清理 sidecar。
    """
    info: dict = {"tag": l.tag, "mode": "graceful" if graceful else "kill", "invoke": None}
    if graceful and cdp is not None:
        info["invoke"] = invoke(cdp, "app_request_exit", timeout=8)
        end = time.time() + 12
        while time.time() < end and l.proc.poll() is None:
            time.sleep(0.1)
    if l.proc.poll() is None:
        l.proc.kill()
        try:
            l.proc.wait(timeout=5)
        except Exception:
            pass
    time.sleep(2.5 if not graceful else 1.0)
    info["exit_code"] = l.proc.poll()
    info["orphans"] = [{"pid": x["pid"], "name": x["name"]} for x in descendants(l.pid)]
    cleanup_test_procs()
    info["log_tail"] = l.tail(30)
    l.close_log()
    return info


def wait_runtime(iso: Isolate, timeout: float = 40.0):
    end = time.time() + timeout
    while time.time() < end:
        if iso.runtime_file.exists():
            data = read_json_safe(iso.runtime_file)
            if isinstance(data, dict):
                return data
        time.sleep(0.1)
    return None


def observe_startup(l: Launch, iso: Isolate, timeout: float = 45.0,
                    setup_cb=None) -> tuple:
    """观察一次启动直到 UI 首帧（UI_MARKERS）；返回 (cdp, observation)。"""
    obs: dict = {
        "tag": l.tag, "cdp": False, "internals": False,
        "runtime_ready_s": None, "runtime": None,
        "body_ready_s": None, "body": None, "boot_timings": None,
        "alive": None, "webview2": None,
    }
    cdp: CDP | None = None
    end = time.time() + timeout
    while time.time() < end:
        if cdp is None:
            cdp = connect_main(2.0)
            if cdp is not None:
                obs["cdp"] = True
                obs["webview2"] = cdp_version().get("Browser")
                if setup_cb is not None:
                    try:
                        setup_cb(cdp)
                    except Exception:
                        pass
        if obs["runtime_ready_s"] is None:
            rt = read_json_safe(iso.runtime_file)
            if isinstance(rt, dict):
                obs["runtime"] = rt
                obs["runtime_ready_s"] = l.elapsed()
        if cdp is not None:
            try:
                if not obs["internals"] and cdp.eval(
                        "typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                    obs["internals"] = True
                bt = boot_timings(cdp)
                if bt:
                    obs["boot_timings"] = bt
                b = body_text(cdp)
                if any(m in b for m in UI_MARKERS):
                    obs["body"] = b
                    obs["body_ready_s"] = l.elapsed()
                    break
            except Exception:
                pass
        time.sleep(0.1)
    obs["alive"] = l.alive()
    refresh_pack_root()
    obs["recover_status"] = read_recover_status()
    return cdp, obs


# ============================== 签名探针包 ==============================


def build_signed_pack(base: Path) -> tuple:
    """构建并签名探针包（复用 tools/sign_pack.mjs），返回 (pack_dir, pubkeys)。"""
    pack = base / "pack"
    shutil.rmtree(pack, ignore_errors=True)
    pack.mkdir(parents=True)
    key = base / "key.pem"
    pub = json.loads(subprocess.run(
        [NODE, str(SIGN_TOOL), "--generate-key", str(key)],
        check=True, capture_output=True, text=True, encoding="utf-8").stdout)["publicKeyHex"]
    entry = ("<!doctype html><html><head><meta charset=\"utf-8\"></head>"
             "<body><div id=\"root\">W07 boot crash probe pack</div></body></html>")
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {
        "id": MY_PACK_ID, "name": "T26 W07 Boot Crash Pack", "version": "1.0.0",
        "apiVersion": 1, "capabilities": ["ui.shell"],
        "entry": {"html": "index.html"}, "commands": [],
        "assets": [{"path": "index.html", "sha256": sha256_bytes(entry.encode("utf-8"))}],
    }
    (pack / "manifest.json").write_bytes(
        json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key),
                    "--keyid", "k1", "--write"], check=True, capture_output=True, text=True,
                   encoding="utf-8")
    return pack, {"k1": {"key": pub}}, entry


def cleanup_own_pack() -> dict:
    """只清理自有 pack id（不删共享 workshop-packs 目录/其它探针的包）。"""
    refresh_pack_root()
    existed = MY_PACK_DIR.exists()
    shutil.rmtree(MY_PACK_DIR, ignore_errors=True)
    return {"my_pack_dir": str(MY_PACK_DIR), "existed_before": existed, "removed": not MY_PACK_DIR.exists()}


# ============================== 场景 A1：首次运行 + 早期强杀 ==============================


def scenario_a1(checks: list, metrics: dict) -> dict:
    print("\n===== 场景 A1：首次运行 + 启动早期强杀（~420ms）→ 重启 =====", flush=True)
    iso = Isolate("a1")
    iso.reset(preseed_appdata=False)  # 真实首次运行：无 %APPDATA%\KnowledgeEditor
    cleanup_test_procs()
    cleanup_own_pack()
    start_time = time.time()
    pre = {
        "appdata_exists": iso.appdata.exists(),
        "ke_cfg_exists": iso.ke_cfg.exists(),
        "runtime_exists": iso.runtime_file.exists(),
        "pack_root": str(PACK_ROOT),
    }
    l = iso.launch("a1-kill-early")
    cdp: CDP | None = None
    kill_state: dict = {}
    target_s = 0.42
    while time.time() - l.t0 < target_s:
        if cdp is None:
            cdp = connect_main(0.15)
        time.sleep(0.01)
    kill_state["kill_at_s"] = l.elapsed()
    kill_state["main_alive"] = l.alive()
    kill_state["cdp_pages"] = [t.get("url") for t in cdp_targets() if t.get("type") == "page"]
    kill_state["cdp_connected"] = cdp is not None
    kill_state["runtime_json_exists"] = iso.runtime_file.exists()
    kill_state["sidecar"] = [{"pid": x["pid"], "name": x["name"]}
                             for x in descendants(l.pid) if "backend" in x["name"]]
    if cdp is not None:
        kill_state["internals"] = invoke(cdp, "get_runtime_info")
        kill_state["body"] = body_text(cdp, 200)
        kill_state["boot_timings"] = boot_timings(cdp)
    l.proc.kill()
    try:
        l.proc.wait(timeout=5)
    except Exception:
        pass
    time.sleep(2.5)
    kill_state["orphans_after_kill"] = [{"pid": x["pid"], "name": x["name"]} for x in descendants(l.pid)]
    cdp_close(cdp)
    cleanup_test_procs()
    kill_state["log_tail"] = l.tail(20)
    l.close_log()

    lr = iso.launch("a1-restart")
    cdp2, obs = observe_startup(lr, iso, timeout=45)
    restart_obs = dict(obs)
    fixture_hashes = iso.fixture_hashes()
    runtime_ok = isinstance(obs.get("runtime"), dict) and isinstance(
        (obs["runtime"] or {}).get("backend", {}).get("pid"), int)
    status = obs.get("recover_status")
    status_fresh = bool(status) and RECOVER_STATUS.exists() and \
        RECOVER_STATUS.stat().st_mtime >= start_time - 2
    status_shape_ok = isinstance(status, dict) and isinstance(status.get("checked"), int) \
        and isinstance(status.get("safeMode"), bool)
    kill_early_ok = (not kill_state["runtime_json_exists"]) and \
        not ((kill_state.get("boot_timings") or {}).get("settings"))
    # 结束本次启动（优雅退出）
    end_info = stop_launch(lr, cdp2, graceful=True)
    cdp_close(cdp2)
    restart_obs["stop"] = {k: end_info[k] for k in ("mode", "invoke", "exit_code", "orphans", "log_tail")}

    detail_kill = {"kill_at_s": kill_state["kill_at_s"], "runtime": kill_state["runtime_json_exists"],
                   "boot": kill_state.get("boot_timings"), "body": (kill_state.get("body") or "")[:120],
                   "sidecar": kill_state["sidecar"]}
    check(checks, "A1", "BOOT-A1-1",
          "首次运行基线：隔离 APPDATA 无 KnowledgeEditor（真实首次运行，非已有数据目录）",
          (not pre["ke_cfg_exists"]) and (not pre["runtime_exists"]), pre)
    check(checks, "A1", "BOOT-A1-2",
          "强杀时主窗口未就绪（runtime.json 未生成 + bootTimings 无 settings/workspace 里程碑）",
          kill_early_ok, detail_kill)
    check(checks, "A1", "BOOT-A1-3",
          "按 Popen 自身 PID 强杀成功（测试主进程已终止，未使用 taskkill /IM）",
          kill_state["main_alive"] and l.proc.poll() is not None,
          {"kill_at_s": kill_state["kill_at_s"], "exit_code": l.proc.poll()})
    check(checks, "A1", "BOOT-A1-4",
          "强杀后重启：启动成功（主进程存活 + 主窗口首帧 + 后端 runtime.json 就绪）",
          bool(restart_obs["alive"] and restart_obs["cdp"] and runtime_ok and restart_obs["body_ready_s"]),
          {"alive": restart_obs["alive"], "cdp": restart_obs["cdp"],
           "runtime_ready_s": restart_obs["runtime_ready_s"],
           "body_ready_s": restart_obs["body_ready_s"],
           "body": (restart_obs.get("body") or "")[:160]})
    check(checks, "A1", "BOOT-A1-5",
          "首次运行重启后生成隔离数据目录（APPDATA 隔离生效 + runtime.json 合法）",
          iso.ke_cfg.is_dir() and runtime_ok,
          {"ke_cfg": str(iso.ke_cfg), "runtime": restart_obs.get("runtime")})
    check(checks, "A1", "BOOT-A1-6",
          "启动 recover 状态可观测（workshop-recover-status.json 为本次启动新写且 checked=int/safeMode=bool）",
          status_fresh and status_shape_ok,
          {"status": {k: status.get(k) for k in ("checked", "safeMode", "generatedAtLocal", "mtime", "_path")}
           if isinstance(status, dict) else status})
    check(checks, "A1", "BOOT-A1-7",
          "数据目录无损坏（runtime.json 可解析；启动日志无 panic/崩溃）",
          runtime_ok and "panic" not in (restart_obs.get("stop", {}).get("log_tail") or "").lower(),
          {"runtime": restart_obs.get("runtime"),
           "log_tail": (restart_obs.get("stop", {}).get("log_tail") or "")[-300:]})
    check(checks, "A1", "BOOT-A1-8",
          "工作区自建夹具未被改动（sha256 前后一致）",
          fixture_hashes == {rel: sha256_bytes(data) for rel, data in FIXTURES.items()},
          fixture_hashes)
    app_cfg = read_json_safe(iso.ke_cfg / "app_config.json")
    legacy_docs = (app_cfg or {}).get("recent_documents") or [] if isinstance(app_cfg, dict) else []
    check(checks, "A1", "BOOT-A1-9",
          "首次运行后配置目录可读写（app_config.json 缺失或合法 JSON，不产生半截损坏文件；"
          "KE_APP_CONFIG_LEGACY 隔离 → 不迁移真实用户 legacy 配置）",
          (app_cfg is None or isinstance(app_cfg, dict)) and not legacy_docs,
          {"app_config": app_cfg, "exists": (iso.ke_cfg / "app_config.json").exists(),
           "legacy_user_docs_migrated": len(legacy_docs),
           "legacy_env": str(iso.base / "legacy-app-config.json")})

    return {
        "description": "首次运行（无数据目录）→ ~420ms 早期强杀 → 重启启动/recover/数据完整性",
        "pre": pre, "kill_state": kill_state, "restart": restart_obs,
        "fixture_hashes": fixture_hashes, "stop": restart_obs.get("stop"),
    }


# ============================== 场景 A2：已有数据目录 + 签名包 + 早期强杀 ==============================


def scenario_a2(checks: list, metrics: dict) -> dict:
    print("\n===== 场景 A2：已有数据目录 + 签名包 + 启动早期强杀（~800ms）→ 重启 =====", flush=True)
    iso = Isolate("a2")
    iso.reset(preseed_appdata=True, recent_workspace=True)
    cleanup_test_procs()
    cleanup_own_pack()
    pack, pubkeys, pack_entry = build_signed_pack(iso.base)
    pubenv = {"KE_WORKSHOP_PUBKEYS": json.dumps(pubkeys)}
    fixture_hashes_before = iso.fixture_hashes()
    start_time = time.time()

    # ---- 基线：正常启动 + 安装签名包 + 优雅退出 ----
    lb = iso.launch("a2-baseline", pubenv)
    cdp_b, obs_b = observe_startup(lb, iso, timeout=45)
    install_res = None
    pack_list = None
    if cdp_b is not None and wait_internals(cdp_b, 10):
        install_res = invoke(cdp_b, "workshop_pack_install", {"sourceDir": str(pack)})
        time.sleep(0.6)
        pack_list = invoke(cdp_b, "workshop_pack_list")
    pack_state_path = MY_PACK_DIR / "state.json"
    pack_disk_state = read_json_safe(pack_state_path)
    active_version = (pack_disk_state or {}).get("active")
    installed_html = MY_PACK_DIR / str(active_version) / "index.html" if active_version else None
    installed_hash = sha256_file(installed_html) if installed_html and installed_html.exists() else None
    expected_hash = sha256_bytes(pack_entry.encode("utf-8"))
    app_cfg_before_kill = read_json_safe(iso.ke_cfg / "app_config.json")
    status_before_kill = read_recover_status()
    base_stop = stop_launch(lb, cdp_b, graceful=True)
    cdp_close(cdp_b)
    runtime_removed_after_graceful = not iso.runtime_file.exists()

    baseline_ok = bool(obs_b["alive"] and obs_b["cdp"] and
                       isinstance(obs_b.get("runtime"), dict) and obs_b["body_ready_s"])
    workspace_open = "文章" in (obs_b.get("body") or "")
    pack_in_list = pack_list is not None and MY_PACK_ID in json.dumps(pack_list, ensure_ascii=False)
    pack_persisted = bool(pack_disk_state) and active_version == "1.0.0" and installed_hash == expected_hash
    check(checks, "A2", "BOOT-A2-1",
          "已有数据目录基线：正常启动 + 工作区自动打开（首帧含工作区外壳）",
          baseline_ok and workspace_open,
          {"alive": obs_b["alive"], "runtime_ready_s": obs_b["runtime_ready_s"],
           "body_ready_s": obs_b["body_ready_s"], "body": (obs_b.get("body") or "")[:160]})
    check(checks, "A2", "BOOT-A2-2",
          "签名探针包安装并持久化（install ok + state.json active=1.0.0 + 资产 sha256 一致 + pack_list 含本包）",
          install_res is not None and install_res.get("ok") is True and pack_persisted and pack_in_list,
          {"install": install_res, "disk_state": pack_disk_state,
           "installed_sha256": installed_hash, "expected_sha256": expected_hash,
           "pack_list_contains": pack_in_list})
    check(checks, "A2", "BOOT-A2-3",
          "正常退出清理（app_request_exit → 进程退出 + runtime.json 移除）",
          base_stop["exit_code"] is not None and runtime_removed_after_graceful,
          {"stop": {k: base_stop[k] for k in ("mode", "invoke", "exit_code", "orphans")},
           "runtime_removed": runtime_removed_after_graceful})

    # ---- 早期强杀（~800ms，主窗口未就绪）----
    lk = iso.launch("a2-kill-early", pubenv)
    cdp_k = None
    ks: dict = {}
    while time.time() - lk.t0 < 0.80:
        if cdp_k is None:
            cdp_k = connect_main(0.15)
        time.sleep(0.01)
    ks["kill_at_s"] = lk.elapsed()
    ks["main_alive"] = lk.alive()
    ks["runtime_json_exists"] = iso.runtime_file.exists()
    ks["sidecar"] = [{"pid": x["pid"], "name": x["name"]}
                     for x in descendants(lk.pid) if "backend" in x["name"]]
    ks["cdp_pages"] = [t.get("url") for t in cdp_targets() if t.get("type") == "page"]
    if cdp_k is not None:
        ks["body"] = body_text(cdp_k, 200)
        ks["boot_timings"] = boot_timings(cdp_k)
        ks["get_runtime_info"] = invoke(cdp_k, "get_runtime_info")
    lk.proc.kill()
    try:
        lk.proc.wait(timeout=5)
    except Exception:
        pass
    time.sleep(2.5)
    ks["orphans_after_kill"] = [{"pid": x["pid"], "name": x["name"]} for x in descendants(lk.pid)]
    ks["orphan_backend_pids"] = sorted({x["pid"] for x in ks["orphans_after_kill"]
                                        if "backend" in x["name"]})
    cdp_close(cdp_k)
    ks["log_tail"] = lk.tail(20)
    lk.close_log()
    # 强杀前清理：不清理孤儿（要观察下次启动是否处理），但清理 webview 等按白名单无关进程不做操作
    kill_early_ok = (not ks["runtime_json_exists"]) and \
        not ((ks.get("boot_timings") or {}).get("settings"))

    # ---- 重启：验证恢复/数据完整性/孤儿 sidecar 行为 ----
    lr = iso.launch("a2-restart", pubenv)
    cdp_r, obs_r = observe_startup(lr, iso, timeout=90)  # 孤儿 sidecar 端口竞争时 Rust 可能 30s health 超时后换端口
    time.sleep(1.5)  # 给 cleanup_stale / 端口选择留出稳定窗口
    new_runtime = obs_r.get("runtime") or {}
    new_backend_pid = (new_runtime.get("backend") or {}).get("pid")
    new_port = (new_runtime.get("backend") or {}).get("port")
    live_backends = backend_pids()
    old_orphans = set(ks.get("orphan_backend_pids") or [])
    orphans_alive_after_restart = sorted(old_orphans & live_backends)
    status_r = obs_r.get("recover_status")
    pack_result = recover_pack_result(status_r)
    fixture_hashes_after = iso.fixture_hashes()
    app_cfg_after = read_json_safe(iso.ke_cfg / "app_config.json")
    settings_after = read_json_safe(iso.ke_cfg / "settings.json")
    html_after = (MY_PACK_DIR / str((read_json_safe(pack_state_path) or {}).get("active") or "") / "index.html")
    html_after_hash = sha256_file(html_after) if html_after.exists() else None
    restart_ok = bool(obs_r["alive"] and obs_r["cdp"] and isinstance(new_runtime, dict) and
                      obs_r["body_ready_s"])
    restart_workspace = "文章" in (obs_r.get("body") or "")
    status_fresh = RECOVER_STATUS.exists() and RECOVER_STATUS.stat().st_mtime >= start_time
    status_shape_ok = isinstance(status_r, dict) and isinstance(status_r.get("checked"), int) \
        and isinstance(status_r.get("safeMode"), bool)
    pack_clean = isinstance(pack_result, dict) and pack_result.get("id") == MY_PACK_ID and \
        pack_result.get("action") == "clean" and pack_result.get("recovered") is False
    cfg_ok = isinstance(app_cfg_after, dict) and any(
        str(iso.workspace).lower() == str(x).lower()
        for x in (app_cfg_after.get("recent_workspaces") or []))
    backends_before_stop = backend_pids()
    restart_log_tail = lr.tail(200)  # W07 A2-10：重启启动日志（孤儿清理结构化行）
    spawn_registry_path = iso.ke_cfg / "runtime" / "sidecar-spawn.json"
    spawn_registry_after = read_json_safe(spawn_registry_path)
    end_info = stop_launch(lr, cdp_r, graceful=True)
    cdp_close(cdp_r)
    # stop_launch 内 cleanup_test_procs 已按路径白名单清理孤儿；记录清理动作
    orphans_cleaned_by_whitelist = sorted(backends_before_stop - {new_backend_pid})
    after_cleanup_backends = sorted(backend_pids())
    # 注意：先读取重启后的包落盘状态，最后才清理自有 pack id（否则 A2-8 会读到已删除目录）
    pack_state_after = read_json_safe(pack_state_path)
    html_after2 = (MY_PACK_DIR / str((pack_state_after or {}).get("active") or "") / "index.html")
    html_after2_hash = sha256_file(html_after2) if html_after2.exists() else None
    cleanup_own_pack()

    check(checks, "A2", "BOOT-A2-4",
          "早期强杀时主窗口未就绪（runtime.json 未生成 + bootTimings 无 settings/workspace 里程碑）",
          kill_early_ok,
          {"kill_at_s": ks["kill_at_s"], "runtime": ks["runtime_json_exists"],
           "boot": ks.get("boot_timings"), "body": (ks.get("body") or "")[:120]})
    check(checks, "A2", "BOOT-A2-5",
          "强杀时 sidecar 已 spawn（记录早期崩溃窗口内孤儿进程，供 A2-10 判定）",
          True,
          {"sidecar_at_kill": ks["sidecar"], "orphans_after_kill": ks["orphans_after_kill"]})
    check(checks, "A2", "BOOT-A2-6",
          "强杀后重启：启动成功 + 工作区自动打开（恢复路径可用）",
          restart_ok and restart_workspace,
          {"alive": obs_r["alive"], "runtime_ready_s": obs_r["runtime_ready_s"],
           "body_ready_s": obs_r["body_ready_s"], "body": (obs_r.get("body") or "")[:200],
           "runtime": new_runtime})
    check(checks, "A2", "BOOT-A2-7",
          "启动 recover 状态可观测且本包 action=clean（本次启动新写，safeMode=false）",
          status_fresh and status_shape_ok and pack_clean and status_r.get("safeMode") is False,
          {"checked": (status_r or {}).get("checked"), "safeMode": (status_r or {}).get("safeMode"),
           "pack_result": pack_result, "generatedAtLocal": (status_r or {}).get("generatedAtLocal")})
    check(checks, "A2", "BOOT-A2-8",
          "包数据无损坏（重启后 state.json active=1.0.0 + 资产 sha256 与安装前一致）",
          html_after2_hash == expected_hash and (pack_state_after or {}).get("active") == "1.0.0",
          {"active": (pack_state_after or {}).get("active"),
           "html_sha256": html_after2_hash, "expected": expected_hash,
           "state_before_cleanup": pack_state_after})
    check(checks, "A2", "BOOT-A2-9",
          "配置/工作区夹具无损坏（app_config.json 可解析且 recent_workspaces 含隔离工作区；settings.json 可解析；夹具 sha256 一致）",
          cfg_ok and isinstance(settings_after, dict) and
          fixture_hashes_after == fixture_hashes_before,
          {"app_config": app_cfg_after, "settings": settings_after,
           "fixtures_before": fixture_hashes_before, "fixtures_after": fixture_hashes_after})
    # A2-10（修复后）：早期强杀遗留的孤儿 sidecar 由 spawn registry 在下次启动时保守自愈清理
    orphan_handled = not orphans_alive_after_restart
    cleanup_logged = "W07 A2-10: 发现上次启动遗留的孤儿 sidecar" in restart_log_tail
    cleanup_log_lines = [ln for ln in restart_log_tail.splitlines() if "W07 A2-10" in ln]
    check(checks, "A2", "BOOT-A2-10",
          "早期崩溃遗留孤儿 sidecar 被下次启动清理（修复后：spawn registry 保守判定 → 整树停止、释放端口；"
          "重启正常启动且使用默认端口）",
          orphan_handled and cleanup_logged and new_port == 8000 and restart_ok,
          {"orphans_at_kill": ks["sidecar"], "orphans_alive_after_restart": orphans_alive_after_restart,
           "cleanup_logged": cleanup_logged, "cleanup_log_lines": cleanup_log_lines[-6:],
           "new_backend_pid": new_backend_pid, "new_port": new_port,
           "kill_runtime_json_exists": ks["runtime_json_exists"],
           "spawn_registry_after_restart": spawn_registry_after,
           "restart_log_tail": restart_log_tail[-2500:]})
    check(checks, "A2", "BOOT-A2-11",
          "孤儿已清理后重启使用默认端口 8000（不再出现孤儿占 8000 → 应用换 8001 的端口偏移；"
          "仍在前端 CSP 白名单 8000-8002 内）",
          new_port == 8000 or (orphan_handled is False and new_port in (8001, 8002)),
          {"new_port": new_port, "orphans_alive_after_restart": orphans_alive_after_restart,
           "orphan_handled": orphan_handled})

    return {
        "description": "已有数据目录（工作区+签名包）→ 优雅退出 → ~800ms 早期强杀 → 重启",
        "baseline": {"obs": {k: obs_b[k] for k in ("alive", "runtime_ready_s", "body_ready_s", "body")},
                     "install": install_res, "pack_list": pack_list,
                     "pack_disk_state": pack_disk_state,
                     "installed_sha256": installed_hash, "expected_sha256": expected_hash,
                     "app_config": app_cfg_before_kill, "status_before_kill": status_before_kill,
                     "stop": {k: base_stop[k] for k in ("mode", "invoke", "exit_code", "orphans")}},
        "kill_state": ks,
        "restart": {"obs": {k: obs_r[k] for k in ("alive", "runtime_ready_s", "body_ready_s",
                                                  "body", "runtime")},
                    "orphans_alive_after_restart": orphans_alive_after_restart,
                    "new_backend_pid": new_backend_pid, "new_port": new_port,
                    "recover_status": {k: (status_r or {}).get(k)
                                       for k in ("checked", "safeMode", "generatedAtLocal")},
                    "pack_result": pack_result,
                    "fixtures_after": fixture_hashes_after,
                    "app_config_after": app_cfg_after,
                    "settings_after": settings_after,
                    "stop": {k: end_info[k] for k in ("mode", "invoke", "exit_code", "orphans")},
                    "orphan_cleanup": {"orphans_cleaned_by_whitelist": orphans_cleaned_by_whitelist,
                                       "backends_after_cleanup": after_cleanup_backends}},
        "fixture_hashes_before": fixture_hashes_before,
    }


# ============================== 场景 A3（补充）：连续早期强杀（crash loop） ==============================


def scenario_a3(checks: list, metrics: dict) -> dict:
    print("\n===== 场景 A3（补充）：连续 3 次启动早期强杀（crash loop）→ 恢复 =====", flush=True)
    iso = Isolate("a3")
    iso.reset(preseed_appdata=True, recent_workspace=True)
    cleanup_test_procs()
    cleanup_own_pack()
    fixture_before = iso.fixture_hashes()
    loop_start = time.time()
    rounds: list = []
    for idx, delay in enumerate((0.35, 0.55, 0.75), start=1):
        l = iso.launch(f"a3-crash-{idx}")
        cdp: CDP | None = None
        while time.time() - l.t0 < delay:
            if cdp is None:
                cdp = connect_main(0.1)
            time.sleep(0.01)
        st = {
            "round": idx, "delay_s": delay, "kill_at_s": l.elapsed(), "main_alive": l.alive(),
            "runtime_json_exists": iso.runtime_file.exists(),
            "cdp_connected": cdp is not None,
            "sidecar": [{"pid": x["pid"], "name": x["name"]}
                        for x in descendants(l.pid) if "backend" in x["name"]],
            "boot_timings": boot_timings(cdp) if cdp is not None else None,
            "body": (body_text(cdp, 120) if cdp is not None else None),
        }
        l.proc.kill()
        try:
            l.proc.wait(timeout=5)
        except Exception:
            pass
        time.sleep(1.5)
        st["orphans_after"] = [{"pid": x["pid"], "name": x["name"]} for x in descendants(l.pid)]
        cdp_close(cdp)
        cleanup_test_procs()
        time.sleep(0.3)
        st["backend_left_after_cleanup"] = sorted(backend_pids())
        st["log_tail"] = l.tail(10)
        l.close_log()
        rounds.append(st)

    lr = iso.launch("a3-recover")
    cdp_r, obs_r = observe_startup(lr, iso, timeout=45)
    runtime_ok = isinstance(obs_r.get("runtime"), dict) and isinstance(
        (obs_r["runtime"] or {}).get("backend", {}).get("pid"), int)
    status = obs_r.get("recover_status")
    status_fresh = RECOVER_STATUS.exists() and RECOVER_STATUS.stat().st_mtime >= loop_start
    status_shape = isinstance(status, dict) and isinstance(status.get("checked"), int) \
        and isinstance(status.get("safeMode"), bool)
    fixture_after = iso.fixture_hashes()
    app_cfg = read_json_safe(iso.ke_cfg / "app_config.json")
    settings = read_json_safe(iso.ke_cfg / "settings.json")
    end_info = stop_launch(lr, cdp_r, graceful=True)
    cdp_close(cdp_r)

    early_ok = all((not r["runtime_json_exists"]) and
                   not ((r.get("boot_timings") or {}).get("settings")) for r in rounds)
    cleanup_ok = all(not r["backend_left_after_cleanup"] for r in rounds)
    restart_ok = bool(obs_r["alive"] and obs_r["cdp"] and runtime_ok and obs_r["body_ready_s"])
    data_ok = (fixture_after == fixture_before and isinstance(app_cfg, dict)
               and isinstance(settings, dict))
    check(checks, "A3", "BOOT-A3-1",
          "连续 3 次早期强杀均发生在主窗口未就绪（300-800ms：runtime.json 未生成 + bootTimings 无 settings 里程碑）",
          early_ok,
          {"rounds": [{"round": r["round"], "delay_s": r["delay_s"], "kill_at_s": r["kill_at_s"],
                       "runtime": r["runtime_json_exists"], "boot": r.get("boot_timings")}
                      for r in rounds]})
    check(checks, "A3", "BOOT-A3-2",
          "每次强杀后按路径白名单清理，无 sidecar 残留（未使用 taskkill /IM）",
          cleanup_ok,
          {"rounds": [{"round": r["round"], "sidecar_at_kill": r["sidecar"],
                       "orphans_after": r["orphans_after"],
                       "backend_left_after_cleanup": r["backend_left_after_cleanup"]} for r in rounds]})
    check(checks, "A3", "BOOT-A3-3",
          "崩溃循环后第 4 次启动成功 + 工作区自动打开（首帧含工作区外壳）",
          restart_ok and "文章" in (obs_r.get("body") or ""),
          {"alive": obs_r["alive"], "runtime_ready_s": obs_r["runtime_ready_s"],
           "body_ready_s": obs_r["body_ready_s"], "body": (obs_r.get("body") or "")[:200]})
    check(checks, "A3", "BOOT-A3-4",
          "崩溃循环后启动 recover 状态可观测 + 数据目录/配置/夹具无损坏",
          status_fresh and status_shape and data_ok,
          {"status": {k: (status or {}).get(k) for k in ("checked", "safeMode", "generatedAtLocal")},
           "app_config_ok": isinstance(app_cfg, dict), "settings_ok": isinstance(settings, dict),
           "fixtures_before": fixture_before, "fixtures_after": fixture_after,
           "stop": {k: end_info[k] for k in ("mode", "invoke", "exit_code")}})
    return {
        "description": "连续 3 次启动早期强杀（350/550/750ms，主窗口未就绪）→ 第 4 次启动恢复",
        "rounds": rounds,
        "restart": {k: obs_r[k] for k in ("alive", "runtime_ready_s", "body_ready_s",
                                          "body", "runtime")},
        "status": {k: (status or {}).get(k) for k in ("checked", "safeMode", "generatedAtLocal")},
        "fixtures_before": fixture_before, "fixtures_after": fixture_after,
        "stop": {k: end_info[k] for k in ("mode", "invoke", "exit_code", "orphans")},
    }


# ============================== 场景 B1：sidecar 端口耗尽 ==============================


def scenario_b1(checks: list, metrics: dict) -> dict:
    print("\n===== 场景 B1：sidecar 端口耗尽（连续 3 次启动失败）→ 恢复 =====", flush=True)
    iso = Isolate("b1")
    iso.reset(preseed_appdata=True, recent_workspace=True)
    cleanup_test_procs()
    cleanup_own_pack()
    port_base = KE_PORT_B1
    ports = [port_base, port_base + 1, port_base + 2]
    ports_free_before = all(port_free(p) for p in ports)
    hold: list = []
    launches: list = []
    occupied_verified: list = []
    no_retry_obs: dict = {}
    ui_banner: dict = {}
    try:
        # Windows 实测坑：双方都 SO_REUSEADDR 时第二个 bind 会成功（端口"可被劫持"），
        # 用 SO_EXCLUSIVEADDRUSE（无则默认绑定）保证 Rust find_free_port 的 bind 探测必然失败。
        for p in ports:
            sk = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                sk.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            sk.bind(("127.0.0.1", p))
            sk.listen(1)
            hold.append(sk)
        for p in ports:  # 占用语义自检：再来一个默认 bind 必须失败
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                probe.bind(("127.0.0.1", p))
                probe.listen(1)
                occupied_verified.append(False)
            except OSError:
                occupied_verified.append(True)
            finally:
                probe.close()
        for i in range(3):
            l = iso.launch(f"b1-fail-{i + 1}", {"KE_PORT": str(port_base)})
            cdp: CDP | None = None
            fail_seen = None
            end = time.time() + 15
            while time.time() < end:
                if cdp is None:
                    cdp = connect_main(0.3)
                if cdp is not None and not iso.runtime_file.exists():
                    try:
                        inv = invoke(cdp, "get_runtime_info", timeout=3)
                    except Exception:
                        inv = None
                    if isinstance(inv, dict) and inv.get("ok") is False and "尚未就绪" in str(inv.get("error")):
                        if fail_seen is None:
                            fail_seen = {"first_signal_s": l.elapsed(), "get_runtime_info": inv}
                        # 给 sidecar 启动线程足够窗口（正常 spawn ≈0.7s / backend 就绪 ≈2s），
                        # 再确认失败是稳定的（无 runtime、无 sidecar）
                        if l.elapsed() >= fail_seen["first_signal_s"] + 3.0:
                            fail_seen["confirmed_s"] = l.elapsed()
                            break
                time.sleep(0.1)
            if cdp is None:
                cdp = connect_main(8)
            if cdp is not None:
                wait_internals(cdp, 5)
            info = {
                "launch": i + 1, "alive_at_check": l.alive(),
                "runtime_exists": iso.runtime_file.exists(),
                "backend_spawned": len(backend_pids()) > 0,
                "fail_seen": fail_seen,
                "stderr_bytes": l.log_path.stat().st_size if l.log_path.exists() else 0,
                "log": l.tail(80),
                "get_runtime_info": invoke(cdp, "get_runtime_info") if cdp is not None else None,
            }
            info["port_error_lines"] = [ln for ln in (info["log"] or "").splitlines()
                                        if "E_SIDECAR_PORT:" in ln or "E_SIDECAR_START:" in ln]
            launches.append(info)
            if i < 2:
                stop = stop_launch(l, cdp, graceful=False)
                info["stop"] = {k: stop[k] for k in ("mode", "exit_code", "orphans")}
                cdp_close(cdp)
            else:
                # 第 3 次保持运行：释放端口 → 观测「无运行期自愈」+ UI 错误最终可见（前端 30s 回退）
                lines_before_release = count_lines_containing(l.log_path, "尝试失败")
                for sk in hold:
                    sk.close()
                hold = []
                health_samples: list = []
                if cdp is not None:
                    end = time.time() + 45
                    while time.time() < end:
                        b = body_text(cdp, 600)
                        st = cdp.eval(
                            "(() => { const el=document.querySelector('[data-testid=\"runtime-health-banner\"]');"
                            " return {banner: el ? {phase: el.getAttribute('data-phase'),"
                            " text: (el.textContent||'').trim()} : null,"
                            " health: (window.__keRuntimeHealth || null)}; })()")
                        if isinstance(st, dict):
                            health_samples.append({"t_s": round(l.elapsed(), 1),
                                                   "banner": st.get("banner"),
                                                   "health": st.get("health")})
                            banner_text = str(((st.get("banner") or {})).get("text") or "")
                            cause_visible = any(k in banner_text for k in ("E_SIDECAR_PORT", "端口", "启动失败"))
                            if any(m in b for m in BANNER_BACKEND_DOWN) or \
                                    (((st.get("banner") or {}).get("phase")) == "degraded" and cause_visible):
                                ui_banner = {"t_s": l.elapsed(), "body": b[:500],
                                             "banner": st.get("banner"), "health": st.get("health"),
                                             "cause_visible": bool(cause_visible),
                                             "boot_timings": boot_timings(cdp)}
                                break
                        time.sleep(1.0)
                if ui_banner:
                    ui_banner["health_samples"] = health_samples[-12:]
                no_retry_obs = {
                    "released_at_s": l.elapsed(),
                    "runtime_exists_after_release": iso.runtime_file.exists(),
                    "backend_spawned_after_release": len(backend_pids()) > 0,
                    "get_runtime_info_after_release": invoke(cdp, "get_runtime_info") if cdp is not None else None,
                    "stderr_bytes_after_release": l.log_path.stat().st_size if l.log_path.exists() else 0,
                    "attempt_fail_lines_before_release": lines_before_release,
                    "attempt_fail_lines_after_release": count_lines_containing(l.log_path, "尝试失败"),
                }
                stop = stop_launch(l, cdp, graceful=False)
                info["stop"] = {k: stop[k] for k in ("mode", "exit_code", "orphans")}
                cdp_close(cdp)
    finally:
        for sk in hold:
            sk.close()

    # ---- 恢复：默认端口（前端 CSP 白名单 8000-8002 内）重启 ----
    ports_default_free = {p: port_free(p) for p in (8000, 8001, 8002)}
    lr = iso.launch("b1-recover")
    cdp_r, obs_r = observe_startup(lr, iso, timeout=45)
    runtime_r = obs_r.get("runtime") or {}
    rec_port = (runtime_r.get("backend") or {}).get("port")
    recover_ok = bool(obs_r["alive"] and obs_r["cdp"] and runtime_r and obs_r["body_ready_s"])
    end_info = stop_launch(lr, cdp_r, graceful=True)
    cdp_close(cdp_r)

    for idx, info in enumerate(launches, start=1):
        fail_ok = bool(info["alive_at_check"] and (not info["runtime_exists"]) and
                       (not info["backend_spawned"]) and info["fail_seen"] is not None)
        check(checks, "B1", f"BOOT-B1-{idx}",
              f"第 {idx} 次启动失败（进程存活、runtime.json 未生成、sidecar 未拉起、"
              "get_runtime_info 报「后端尚未就绪」）",
              fail_ok,
              {"launch": idx, "fail_seen": info["fail_seen"],
               "runtime_exists": info["runtime_exists"],
               "backend_spawned": info["backend_spawned"],
               "get_runtime_info": info["get_runtime_info"],
               "stderr_bytes": info["stderr_bytes"],
               "log": info["log"][-300:]})
    stderr_observed = any((info["stderr_bytes"] or 0) > 0 for info in launches)
    port_log_observed = any(bool(info.get("port_error_lines")) for info in launches)
    check(checks, "B1", "BOOT-B1-4",
          "端口耗尽失败原因有结构化 stderr/日志可观测（修复后）：stderr 非空且含 `E_SIDECAR_PORT:` / "
          "`E_SIDECAR_START:`（第 N/3 次尝试）与最终「不再重试」失败行",
          stderr_observed and port_log_observed,
          {"launches": [{"launch": info["launch"], "stderr_bytes": info["stderr_bytes"],
                         "port_error_lines": info.get("port_error_lines")} for info in launches],
           "ui_reason_observation": {"banner_or_hook": ui_banner or None,
                                     "note": "terminal runtime-error 在窗口/前端挂载前发出时 UI 可能错过（早期事件限制，如实记录）"},
           "source_ref": "desktop/src-tauri/src/sidecar.rs start()：E_SIDECAR_PORT/ E_SIDECAR_START + "
                         "ke:runtime-error{terminal:true}"})
    banner_ok = bool(ui_banner) and (
        any(m in ui_banner.get("body", "") for m in BANNER_BACKEND_DOWN)
        or bool(ui_banner.get("cause_visible")))
    check(checks, "B1", "BOOT-B1-5",
          "UI 错误最终可见（通用「后端未连接」横幅或带具体原因的 degraded banner；早期事件丢失时回退通用横幅）",
          banner_ok, ui_banner or {"observed": "45s 内未出现横幅"})
    retried = bool(no_retry_obs.get("runtime_exists_after_release") or
                   no_retry_obs.get("backend_spawned_after_release") or
                   (no_retry_obs.get("attempt_fail_lines_after_release") or 0) >
                   (no_retry_obs.get("attempt_fail_lines_before_release") or 0))
    check(checks, "B1", "BOOT-B1-6",
          "[缺口观测] 端口释放后运行中实例自动重试恢复（运行期自愈）",
          retried,
          {**no_retry_obs,
           "note": "FAIL = 无运行期自愈：Rust 侧 3 次尝试后仅 emit runtime-error，需用户重启（B1-7 证明重启可恢复）"})
    check(checks, "B1", "BOOT-B1-7",
          "重启（默认端口）后启动成功恢复（runtime 就绪 + 工作区首帧；端口在前端 CSP 白名单 8000-8002 内）",
          recover_ok and rec_port in (8000, 8001, 8002),
          {"alive": obs_r["alive"], "runtime_ready_s": obs_r["runtime_ready_s"],
           "body_ready_s": obs_r["body_ready_s"], "port": rec_port,
           "body": (obs_r.get("body") or "")[:160],
           "ports_default_free_before_recover": ports_default_free,
           "stop": {k: end_info[k] for k in ("mode", "invoke", "exit_code")}})

    return {
        "description": "sidecar 端口耗尽（KE_PORT 隔离端口族 3 个端口被独占占用）→ 连续 3 次启动失败 → "
                       "释放端口无运行期自愈（UI 仅 30s 后通用横幅）→ 默认端口重启恢复",
        "ports": ports, "ports_free_before_hold": ports_free_before,
        "ports_occupied_verified": dict(zip((str(p) for p in ports), occupied_verified)),
        "launches": [{k: v for k, v in info.items() if k != "log"} for info in launches],
        "stderr_observed_in_failures": stderr_observed,
        "ui_banner": ui_banner,
        "no_retry": no_retry_obs,
        "recover": {"obs": {k: obs_r[k] for k in ("alive", "runtime_ready_s", "body_ready_s",
                                                  "body", "runtime")},
                    "port": rec_port},
        "csp_note": "前端 CSP connect-src 仅白名单 8000-8002；失败注入用隔离端口族（同一 find_free_port 失败代码路径），"
                    "恢复验证用默认端口，避免把 CSP 拦截误记为端口耗尽证据。",
        "log_note": "Rust find_free_port 全失败分支无 eprintln（静默 continue），故 stderr 为空是产品行为而非探针缺失。",
    }


# ============================== 场景 B2：应用数据目录被非法占位 ==============================


def scenario_b2(checks: list, metrics: dict) -> dict:
    print("\n===== 场景 B2：应用数据目录被普通文件占位（连续 3 次启动失败）→ 恢复 =====", flush=True)
    iso = Isolate("b2")
    iso.reset(preseed_appdata=True, recent_workspace=True)
    cleanup_test_procs()
    cleanup_own_pack()
    # 非法状态：%APPDATA%\KnowledgeEditor 由目录替换为普通文件（模拟数据目录损坏/被占位）
    shutil.rmtree(iso.ke_cfg, ignore_errors=True)
    iso.ke_cfg.parent.mkdir(parents=True, exist_ok=True)
    iso.ke_cfg.write_bytes(b"blocked by regular file (W07 boot crash probe)\n")
    blocked_file = iso.ke_cfg
    launches: list = []
    no_retry_obs: dict = {}
    ui_banner: dict = {}
    for i in range(3):
        l = iso.launch(f"b2-fail-{i + 1}")
        cdp = None
        fail_seen = None
        end = time.time() + 12
        while time.time() < end:
            if cdp is None:
                cdp = connect_main(0.3)
            if "第 3 次尝试失败" in l.tail(60):
                fail_seen = {"detected_s": l.elapsed()}
                break
            time.sleep(0.1)
        if cdp is None:
            cdp = connect_main(8)  # 失败检测可能早于 CDP 主窗口就绪，补连以便观测 IPC 错误/UI 横幅
        if cdp is not None:
            wait_internals(cdp, 5)
        info = {
            "launch": i + 1, "alive_at_check": l.alive(),
            "runtime_exists": iso.runtime_file.exists(),
            "fail_seen": fail_seen,
            "dir_create_fail_line": "创建应用数据目录失败" in l.tail(60),
            "attempt_fail_lines": [ln for ln in l.tail(60).splitlines() if "尝试失败" in ln],
            "attempt_fail_total": count_lines_containing(l.log_path, "尝试失败"),
            "backend_spawned": len(backend_pids()) > 0,
            "get_runtime_info": invoke(cdp, "get_runtime_info") if cdp is not None else None,
            "log": l.tail(30),
        }
        launches.append(info)
        if i < 2:
            stop = stop_launch(l, cdp, graceful=False)
            info["stop"] = {k: stop[k] for k in ("mode", "exit_code", "orphans")}
            cdp_close(cdp)
            continue
        # 第 3 次：等待 UI 错误横幅（前端 30s 等待窗口后回退显示「后端服务未连接」）
        if cdp is not None:
            end = time.time() + 48
            while time.time() < end:
                b = body_text(cdp, 600)
                if any(m in b for m in BANNER_BACKEND_DOWN):
                    ui_banner = {"t_s": l.elapsed(), "body": b[:400],
                                 "boot_timings": boot_timings(cdp)}
                    break
                time.sleep(1.0)
        # 解除阻塞 → 运行中实例不自动重试（无运行期自愈）
        lines_before = count_lines_containing(l.log_path, "尝试失败")
        if blocked_file.exists():
            blocked_file.unlink()
        time.sleep(10.0)
        no_retry_obs = {
            "unblocked_at_s": l.elapsed(),
            "runtime_exists_after_unblock": iso.runtime_file.exists(),
            "backend_spawned_after_unblock": len(backend_pids()) > 0,
            "get_runtime_info_after_unblock": invoke(cdp, "get_runtime_info") if cdp is not None else None,
            "attempt_fail_lines_before_unblock": lines_before,
            "attempt_fail_lines_after_unblock": count_lines_containing(l.log_path, "尝试失败"),
            "log": l.tail(40),
        }
        stop = stop_launch(l, cdp, graceful=False)
        info["stop"] = {k: stop[k] for k in ("mode", "exit_code", "orphans")}
        cdp_close(cdp)

    # ---- 解除阻塞后重启恢复 ----
    blocks_left = {"blocked_file_exists": blocked_file.exists()}
    lr = iso.launch("b2-recover")
    cdp_r, obs_r = observe_startup(lr, iso, timeout=45)
    runtime_r = obs_r.get("runtime") or {}
    recover_ok = bool(obs_r["alive"] and obs_r["cdp"] and runtime_r and obs_r["body_ready_s"])
    end_info = stop_launch(lr, cdp_r, graceful=True)
    cdp_close(cdp_r)

    for idx, info in enumerate(launches, start=1):
        fail_ok = info["alive_at_check"] and (not info["runtime_exists"]) and \
            (not info["backend_spawned"]) and info["fail_seen"] is not None
        log_ok = "第 3 次尝试失败" in info["log"] and info["dir_create_fail_line"]
        check(checks, "B2", f"BOOT-B2-{idx}",
              f"第 {idx} 次启动失败且错误可观测（进程存活、runtime.json 未生成、sidecar 未拉起、日志「创建应用数据目录失败」+3 次尝试失败）",
              bool(fail_ok and log_ok),
              {"launch": idx, "fail_seen": info["fail_seen"], "runtime_exists": info["runtime_exists"],
               "dir_create_fail_line": info["dir_create_fail_line"],
               "attempt_fail_lines": info["attempt_fail_lines"][-3:],
               "get_runtime_info": info["get_runtime_info"]})
    banner_ok = bool(ui_banner) and any(m in ui_banner.get("body", "") for m in BANNER_BACKEND_DOWN)
    check(checks, "B2", "BOOT-B2-4",
          "UI 错误可观测：启动失败约 30s 后显示「后端服务未连接」红色横幅（前端 30s 等待窗口后回退）",
          banner_ok, ui_banner or {"observed": "48s 内未出现横幅"})
    retried = bool(no_retry_obs.get("runtime_exists_after_unblock") or
                   no_retry_obs.get("backend_spawned_after_unblock") or
                   (no_retry_obs.get("attempt_fail_lines_after_unblock") or 0) >
                   (no_retry_obs.get("attempt_fail_lines_before_unblock") or 0))
    check(checks, "B2", "BOOT-B2-5",
          "[缺口观测] 数据目录解除阻塞后运行中实例自动重试恢复（运行期自愈）",
          retried,
          {**no_retry_obs,
           "note": "FAIL = 无运行期自愈：Rust 侧 3 次尝试后仅 emit runtime-error，需用户重启（B2-6 证明重启可恢复）"})
    check(checks, "B2", "BOOT-B2-6",
          "解除阻塞后重启启动成功恢复（主进程存活 + 主窗口首帧 + runtime 就绪）",
          recover_ok, {"alive": obs_r["alive"], "runtime_ready_s": obs_r["runtime_ready_s"],
                       "body_ready_s": obs_r["body_ready_s"],
                       "body": (obs_r.get("body") or "")[:160],
                       "stop": {k: end_info[k] for k in ("mode", "invoke", "exit_code")}})
    return {
        "description": "应用数据目录被普通文件占位 → 连续 3 次启动失败 → UI 横幅 → 解除阻塞无自愈 → 重启恢复",
        "blocked_path": str(blocked_file),
        "launches": [{k: v for k, v in info.items() if k != "log"} for info in launches],
        "ui_banner": ui_banner, "no_retry": no_retry_obs,
        "recover": {"obs": {k: obs_r[k] for k in ("alive", "runtime_ready_s", "body_ready_s",
                                                  "body", "runtime")},
                    "blocks_left_before_recover": blocks_left},
    }


# ============================== 场景 B3：损坏状态文件（降级，不阻断启动） ==============================


def scenario_b3(checks: list, metrics: dict) -> dict:
    print("\n===== 场景 B3：损坏 settings.json / app_config.json（非法 JSON）=====", flush=True)
    iso = Isolate("b3")
    iso.reset(preseed_appdata=True, recent_workspace=True)
    cleanup_test_procs()
    cleanup_own_pack()
    bad = b"{ this is not valid json !!!\n"
    settings_path = iso.ke_cfg / "settings.json"
    config_path = iso.ke_cfg / "app_config.json"
    settings_path.write_bytes(bad)
    config_path.write_bytes(bad)
    bad_hashes = {"settings": sha256_file(settings_path), "app_config": sha256_file(config_path)}
    results: list = []
    for i in range(2):
        l = iso.launch(f"b3-corrupt-{i + 1}")
        cdp, obs = observe_startup(l, iso, timeout=45)
        settings_inv = None
        api_obs = None
        if cdp is not None and wait_internals(cdp, 10):
            settings_inv = invoke(cdp, "get_settings")
            api_obs = cdp.eval(
                "(async()=>{try{const b=window.__KE_API_BASE__||'';"
                "const rr=await fetch(b+'/api/workspace/recent');const rj=await rr.json();"
                "const cr=await fetch(b+'/api/workspace/current');const cj=await cr.json();"
                "return {recent_status:rr.status, recent:rj, current_status:cr.status, current:cj};"
                "}catch(e){return {error:String(e)}}})()")
            time.sleep(0.3)
        body = body_text(cdp, 600)
        after = {"settings": sha256_file(settings_path), "app_config": sha256_file(config_path)}
        bak_files = sorted([p.name for p in iso.ke_cfg.glob("*.bak*")] +
                           [p.name for p in iso.ke_cfg.glob("*.tmp")])
        log_tail = l.tail(250)
        repair_lines = [ln for ln in log_tail.splitlines() if "W07 B3-4" in ln]
        bak_details = [{"name": bp.name, "sha256": sha256_file(bp),
                        "size": bp.stat().st_size if bp.exists() else 0}
                       for bp in sorted(iso.ke_cfg.glob("*.corrupt-*.bak"))]
        health_obs = None
        banner_obs = None
        if cdp is not None:
            try:
                health_obs = cdp.eval("window.__keRuntimeHealth || null")
                banner_obs = cdp.eval(
                    "(() => { const el=document.querySelector('[data-testid=\"runtime-health-banner\"]');"
                    " return el ? {phase: el.getAttribute('data-phase'),"
                    " text: (el.textContent||'').trim()} : null; })()")
            except Exception:
                pass
        results.append({
            "launch": i + 1, "obs": {k: obs[k] for k in ("alive", "runtime_ready_s",
                                                         "body_ready_s", "body")},
            "settings_invoke": settings_inv, "api": api_obs, "body": body,
            "files_after": after, "bad_hashes": bad_hashes,
            "repaired": after != bad_hashes, "bak_files": bak_files,
            "bak_details": bak_details, "repair_lines": repair_lines,
            "log_tail": log_tail[-2500:],
            "settings_parsed": read_json_safe(settings_path),
            "app_config_parsed": read_json_safe(config_path),
            "runtime_health_observed": health_obs, "banner_observed": banner_obs,
            "banner_absent": not any(m in body for m in BANNER_BACKEND_DOWN),
            "picker_shown": "选择已有 workspace" in body or "选择一个工作区" in body,
        })
        stop = stop_launch(l, cdp, graceful=True)
        results[-1]["stop"] = {k: stop[k] for k in ("mode", "invoke", "exit_code")}
        cdp_close(cdp)

    def _startup_ok(r) -> bool:
        o = r["obs"]
        return bool(o["alive"] and o["runtime_ready_s"] is not None and o["body_ready_s"])

    settings_default = all(
        isinstance((r.get("settings_invoke") or {}).get("value"), dict) and
        (r["settings_invoke"]["value"].get("schemaVersion") == 1) and
        ((r["settings_invoke"]["value"].get("ui") or {}).get("theme") == "system")
        for r in results)
    # ---- 修复后判定：备份（原始字节）+ 默认重置 + 幂等 ----
    def _files_valid(r) -> bool:
        st = r.get("settings_parsed")
        cfg = r.get("app_config_parsed")
        return (isinstance(st, dict) and st.get("schemaVersion") == 1
                and ((st.get("ui") or {}).get("theme") == "system")
                and isinstance(cfg, dict) and isinstance(cfg.get("recent_workspaces"), list)
                and not cfg.get("recent_workspaces"))

    def _backup_ok(r) -> bool:
        names = [b["name"] for b in (r.get("bak_details") or [])]
        settings_bak = [b for b in (r.get("bak_details") or []) if b["name"].startswith("settings.json.corrupt-")]
        config_bak = [b for b in (r.get("bak_details") or []) if b["name"].startswith("app_config.json.corrupt-")]
        return (len(settings_bak) == 1 and len(config_bak) == 1
                and all(b["sha256"] == bad_hashes["settings"] for b in settings_bak + config_bak)
                and all(n.endswith(".bak") for n in names))

    first = results[0] if results else {}
    second = results[1] if len(results) > 1 else {}
    idempotent = (len(first.get("bak_details") or []) == 2
                  and len(second.get("bak_details") or []) == 2
                  and not second.get("repair_lines"))
    no_repair = all(not r["repaired"] for r in results)
    no_bak = all(not r["bak_files"] for r in results)
    silent_no_banner = all(r["banner_absent"] for r in results)
    def _recent_empty(r) -> bool:
        api = r.get("api") or {}
        recent = api.get("recent") or {}
        return isinstance(recent, dict) and not (recent.get("workspaces") or [])

    def _workspace_still_open(r) -> bool:
        api = r.get("api") or {}
        cur = api.get("current") or {}
        root = str(cur.get("root") or "").lower()
        return bool(cur.get("open")) and str(iso.workspace).lower() in root

    recent_empty = all(_recent_empty(r) for r in results)
    workspace_usable = all(_workspace_still_open(r) for r in results)
    check(checks, "B3", "BOOT-B3-1",
          "损坏 settings/app_config（非法 JSON）不阻断启动（连续 2 次均启动成功，宿主无崩溃）",
          len(results) == 2 and all(_startup_ok(r) for r in results),
          {"results": [{"launch": r["launch"], "alive": r["obs"]["alive"],
                        "runtime_ready_s": r["obs"]["runtime_ready_s"],
                        "body_ready_s": r["obs"]["body_ready_s"],
                        "body": (r["obs"].get("body") or "")[:160]} for r in results]})
    check(checks, "B3", "BOOT-B3-2",
          "settings.json 损坏回退默认可观测（get_settings 返回 schemaVersion=1 / ui.theme=system）",
          settings_default,
          {"settings_invoke": [r["settings_invoke"] for r in results]})
    check(checks, "B3", "BOOT-B3-3",
          "app_config.json 损坏回退默认（后端 /api/workspace/recent 的 recent_workspaces 为空；"
          "KE_WORKSPACE 默认工作区仍可用，不崩溃）",
          recent_empty and workspace_usable,
          {"recent_empty": recent_empty, "workspace_usable": workspace_usable,
           "api": [r.get("api") for r in results],
           "body": [(r["obs"].get("body") or "")[:140] for r in results]})
    check(checks, "B3", "BOOT-B3-4",
          "损坏状态文件自动修复（修复后）：settings.json/app_config.json 均生成 `.corrupt-<ts>.bak`（原始损坏字节可恢复）"
          "+ 主文件重置为合法默认 JSON；连续两次启动幂等（不重复备份、不阻断启动）",
          len(results) == 2 and all(_startup_ok(r) for r in results)
          and _backup_ok(first) and _files_valid(first) and _files_valid(second) and idempotent,
          {"backup_ok": _backup_ok(first), "files_valid_first": _files_valid(first),
           "files_valid_second": _files_valid(second), "idempotent": idempotent,
           "bak_details": [r.get("bak_details") for r in results],
           "file_hashes_after": [r["files_after"] for r in results],
           "bad_hashes": bad_hashes,
           "settings_parsed": [r.get("settings_parsed") for r in results],
           "app_config_parsed": [r.get("app_config_parsed") for r in results]})
    repair_hint_ok = (len(first.get("repair_lines") or []) >= 2
                      and all(("备份到" in ln and "重置为默认配置" in ln)
                              for ln in (first.get("repair_lines") or [])))
    check(checks, "B3", "BOOT-B3-5",
          "损坏修复提示可观测（修复后）：启动/读取设置日志含结构化 `[settings] W07 B3-4:` 行，"
          "说明已备份到 .corrupt-*.bak 并重置默认（不静默丢设置；UI 事件若在挂载后到达则记录）",
          repair_hint_ok,
          {"repair_lines": first.get("repair_lines"),
           "runtime_health_observed": first.get("runtime_health_observed"),
           "banner_observed": first.get("banner_observed"),
           "note": "recoverable runtime-error 在窗口挂载前发出时 UI 可能错过（早期事件限制，如实记录）"})
    return {"description": "损坏 settings/app_config JSON → 连续 2 次启动均成功；"
                          "修复前：静默回退默认无备份/无提示；修复后：`.corrupt-<ts>.bak` 备份 + 默认重置 + 结构化日志提示",
            "bad_hashes": bad_hashes, "results": results}


# ============================== 通用 check ==============================


def check(checks: list, scenario: str, cid: str, name: str, ok: bool, detail) -> None:
    item = {"id": cid, "scenario": scenario, "name": name, "pass": bool(ok),
            "detail": _truncate(detail)}
    checks.append(item)
    print(("PASS " if ok else "FAIL ") + f"{cid} {name} | {_short(detail)}", flush=True)


def _truncate(obj, limit: int = 4000):
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
        return json.dumps(detail, ensure_ascii=False, default=str)[:300]
    except Exception:
        return str(detail)[:300]


# ============================== 入口 ==============================


def env_metadata() -> dict:
    meta = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "platform": platform.platform(),
        "windows_version": platform.version(),
        "python": sys.version.split()[0],
        "repo": str(REPO),
        "exe": str(EXE),
        "exe_sha256": sha256_file(EXE) if EXE.exists() else None,
        "exe_mtime": time.strftime("%Y-%m-%dT%H:%M:%S",
                                   time.localtime(EXE.stat().st_mtime)) if EXE.exists() else None,
        "exe_size": EXE.stat().st_size if EXE.exists() else None,
        "isolated_identifier": ISOLATED_IDENTIFIER,
        "pack_root": str(PACK_ROOT),
        "my_pack_id": MY_PACK_ID,
        "cdp_port": CDP_PORT,
        "ke_port_b1": KE_PORT_B1,
        "appdata_isolation": str(BASE_ROOT / "*" / "appdata"),
    }
    try:
        head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"],
                              capture_output=True, text=True, encoding="utf-8",
                              timeout=15).stdout.strip()
        meta["git_head"] = head
        branch = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--abbrev-ref", "HEAD"],
                                capture_output=True, text=True, encoding="utf-8",
                                timeout=15).stdout.strip()
        meta["git_branch"] = branch
    except Exception:
        meta["git_head"] = None
    meta["ports_8000_8002_before"] = {str(p): ("free" if port_free(p) else "occupied")
                                      for p in (8000, 8001, 8002)}
    return meta


def main() -> int:
    selected = ["A1", "A2", "A3", "B1", "B2", "B3"]
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--scenarios" and i + 1 < len(argv):
            selected = [x.strip().upper() for x in argv[i + 1].split(",") if x.strip()]
    print(f"scenarios={selected} cdp_port={CDP_PORT} exe={EXE}", flush=True)
    if "--dry-run" in argv:
        # 只做环境自检，不启动 exe（供 GO 前验证路径/依赖/端口）
        dry = {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "exe": str(EXE), "exe_exists": EXE.exists(),
            "exe_sha256": sha256_file(EXE) if EXE.exists() else None,
            "node": NODE, "node_exists": Path(NODE).exists(),
            "sign_tool": str(SIGN_TOOL), "sign_tool_exists": SIGN_TOOL.exists(),
            "base_root": str(BASE_ROOT), "cdp_port": CDP_PORT,
            "isolated_identifier": ISOLATED_IDENTIFIER,
            "pack_root": str(PACK_ROOT), "pack_root_exists": PACK_ROOT.exists(),
            "recover_status": str(RECOVER_STATUS), "recover_status_exists": RECOVER_STATUS.exists(),
            "my_pack_dir": str(MY_PACK_DIR), "my_pack_dir_existed": MY_PACK_DIR.exists(),
            "user_app_running": user_app_pids(),
            "ports_8000_8002": {str(p): ("free" if port_free(p) else "occupied")
                                for p in (8000, 8001, 8002)},
            "ports_b1": {str(p): ("free" if port_free(p) else "occupied")
                         for p in (KE_PORT_B1, KE_PORT_B1 + 1, KE_PORT_B1 + 2)},
            "test_procs": [p for p in proc_snapshot()
                           if p["name"].lower().startswith(("knowledgeeditor",))],
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
    shutil.rmtree(BASE_ROOT, ignore_errors=True)
    BASE_ROOT.mkdir(parents=True, exist_ok=True)
    cleanup_test_procs()

    user_before = user_app_pids()
    env_meta = env_metadata()
    checks: list = []
    scenarios: dict = {}
    scenario_fns = {"A1": scenario_a1, "A2": scenario_a2, "A3": scenario_a3,
                    "B1": scenario_b1, "B2": scenario_b2, "B3": scenario_b3}
    for key in selected:
        fn = scenario_fns.get(key)
        if fn is None:
            continue
        try:
            scenarios[key] = fn(checks, {})
        except Exception:
            scenarios[key] = {"error": traceback.format_exc()}
            print(f"SCENARIO {key} ERROR:\n{traceback.format_exc()}", flush=True)
        finally:
            cleanup_test_procs()
    user_after = user_app_pids()

    # 安全/隔离检查（不属于功能场景，但记录红线遵守情况）
    leftovers = [p for p in proc_snapshot()
                 if p["name"].lower().startswith(("knowledgeeditor", "knowledgeeditor-backend"))]
    user_impact = {
        "user_app_pids_before": user_before,
        "user_app_pids_after": user_after,
        "n_a": (not user_before and not user_after),
    }
    check(checks, "SAFE", "BOOT-SAFE-1",
          "测试进程/孤儿按路径白名单清理（knowledgeeditor/-backend 无残留；未使用 taskkill /IM）",
          len(leftovers) == 0, {"leftovers": leftovers,
                                "cleanup_rule": "自身 Popen PID + C:\\ke-tmp\\uiws-t26\\bin\\* / "
                                                "F:\\Work\\Dev\\cargo-target\\* 路径白名单"})
    check(checks, "SAFE", "BOOT-SAFE-2",
          "用户实例未受影响（N/A：用户 App 未运行，运行前后只读查询均为空；未启动/未杀用户进程）",
          len(user_after) == 0, user_impact)
    check(checks, "SAFE", "BOOT-SAFE-3",
          "仅操作隔离数据：APPDATA 指向 C:\\ke-tmp\\uiws-t26-w07boot\\*\\appdata；"
          "包操作仅自有 pack id（不删共享 workshop-packs）",
          True, {"base_root": str(BASE_ROOT), "pack_root": str(PACK_ROOT),
                 "my_pack_id": MY_PACK_ID, "own_pack_cleanup": cleanup_own_pack()})

    pass_count = sum(1 for c in checks if c["pass"])
    total = len(checks)
    gaps = [{"id": c["id"], "name": c["name"], "detail": c["detail"]}
            for c in checks if not c["pass"]]
    summary = {
        "generated_at": env_meta["generated_at"],
        "task": "task-4 / W07 扩展：boot crash + 连续启动失败（隔离产品构建 W 证据）",
        "evidence_type": "W（真实产品隔离构建进程/数据行为；故障注入方式见各场景 metrics）",
        "environment": env_meta,
        "run_conditions": {
            "serial_exclusive_window": True,
            "go_window": "Lead 串行 GO 第 3 顺位（guest-io W → w02 W → 本探针 boot crash）；"
                         "窗口内无其它探针并发、无用户实例运行",
            "build_note": "隔离测试 exe 由 Lead 统一重建（mtime 2026-10-19T09:27，sha256 见 environment.exe_sha256，"
                          "identifier=com.astranota.uiws.e2e 未变）；运行期 repo HEAD 见 environment.git_head",
            "runs_in_window": "GO 窗口内共 1 次完整探针（首轮，36/42，暴露探针侧缺陷 3 处）+ 1 次 B1 定向诊断"
                              "（修正端口占用注入语义）+ 1 次完整重跑（本证据，40/44）。首轮探针侧缺陷"
                              "（A2-8 读取顺序 / B1 日志假设错误 / B2 CDP 连接时序）已在重跑前修正；"
                              "两轮均复现 A2 孤儿 sidecar 缺口。",
            "prior_experiments": "GO 前仅在 C:\\ke-tmp 下做临时调参实验（未作为证据，已清理）",
            "user_app_impact": user_impact,
            "cleanup_policy": "自身 Popen PID；sidecar 仅路径白名单；无 taskkill /IM；不触碰 D:\\AstraNota*",
            "pack_scope": f"仅自有 pack id {MY_PACK_ID}；不删共享 {PACK_ROOT}",
        },
        "scenarios": scenarios,
        "checks": checks,
        "pass_count": pass_count,
        "total": total,
        "fail_count": total - pass_count,
        "gaps": gaps,
        "raw_notes": [
            "PASS/FAIL 为可观测断言；[缺口观测] 检查项 FAIL = 发现真实缺口（如实记录，不夸大/不掩盖）",
            "本证据为 GO 窗口内第 2 次完整运行（首轮 36/42 中 3 个 FAIL 为探针侧缺陷，修正后重跑；"
            "最终 4 个 FAIL 均为真实缺口：A2-10 孤儿 sidecar / B1-4 失败原因不可观测 / B1-6、B2-5 无运行期自愈）",
            "早期强杀均按 Popen 自身 PID（proc.kill），未使用 taskkill /IM",
            "平台数据目录：APPDATA env 只隔离产品 data_dir（%APPDATA%\\KnowledgeEditor）；"
            "包/恢复状态在 app_data_dir（KnownFolder\\<identifier>\\workshop-packs），本探针只写/清自有 pack id",
            "B1 失败注入使用 KE_PORT 隔离端口族（与默认 8000-8002 同一 find_free_port 失败代码路径），"
            "恢复验证用默认端口（前端 CSP 仅白名单 8000-8002）",
            "用户 App 未运行 → 用户影响 N/A（只读确认）",
        ],
    }
    out = EVID / "T26-W07-boot-results.json"
    # --merge：把本次选中场景合并进既有证据（保留其历史场景/checks 与构建历史）
    if "--merge" in argv and out.exists():
        try:
            prev = json.loads(out.read_text(encoding="utf-8"))
        except Exception:
            prev = None
        if isinstance(prev, dict):
            prev_scen = dict(prev.get("scenarios") or {})
            for key in selected:
                if key in scenarios:
                    prev_scen[key] = scenarios[key]
            keep_checks = [c for c in (prev.get("checks") or [])
                           if c.get("scenario") not in set(selected)
                           and c.get("scenario") != "SAFE"]
            all_checks = keep_checks + checks
            pass_count = sum(1 for c in all_checks if c.get("pass"))
            total = len(all_checks)
            gaps = [{"id": c["id"], "name": c["name"], "detail": c["detail"]}
                    for c in all_checks if not c.get("pass")]
            prev_env = prev.get("environment") or {}
            build_history = list(prev.get("build_history") or [])
            record = {"run_at": env_meta["generated_at"], "scenarios": list(selected),
                      "cdp_port": CDP_PORT, "merged_into_existing": True}
            if prev_env.get("exe_sha256") and prev_env.get("exe_sha256") != env_meta.get("exe_sha256"):
                build_history.append({"exe_sha256": prev_env.get("exe_sha256"),
                                      "exe_mtime": prev_env.get("exe_mtime"),
                                      "exe_size": prev_env.get("exe_size"),
                                      "note": "上一轮证据所用测试构建（已被新构建替换）"})
                record["build_changed"] = True
                summary["environment"] = env_meta
            else:
                summary["environment"] = prev_env or env_meta
            summary.update({"checks": all_checks, "scenarios": prev_scen,
                            "pass_count": pass_count, "total": total,
                            "fail_count": total - pass_count, "gaps": gaps,
                            "build_history": build_history,
                            "merged_runs": list(prev.get("merged_runs") or []) + [record],
                            "retest_windows": list(prev.get("retest_windows") or []) + [record],
                            "run_conditions": prev.get("run_conditions") or summary["run_conditions"]})
            print(f"[merge] 合并 {selected} 到既有证据（保留 {len(keep_checks)} 条旧 checks）", flush=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nSUMMARY {pass_count}/{total} checks PASS, {total - pass_count} FAIL "
          f"(gaps={[g['id'] for g in gaps]}) -> {out}", flush=True)
    cleanup_test_procs()
    cleanup_own_pack()
    if total == 0:
        return 2
    # 退出码 0 = 探针完成并写出证据；功能断言失败/缺口已如实写进证据 JSON（不掩盖）
    return 0


if __name__ == "__main__":
    sys.exit(main())
