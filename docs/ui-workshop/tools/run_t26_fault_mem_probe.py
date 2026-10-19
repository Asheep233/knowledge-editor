# -*- coding: utf-8 -*-
"""P5-T26 W07 扩展故障探针：guest 内存压力 / CPU 压力（宿主独立恢复验证）。

背景（既有证据，不重复造轮子）：
- `run_t26_fault_probe.py` 已证 guest 无限循环（60s busy loop）不阻塞宿主，心跳 →
  suspended → failed + safeMode → 停用 stopped 持久化（W 8/8 PASS）；
- guest 为跨域 sandbox iframe（`http://workshop.localhost`），WebView2 将其置于独立
  renderer 进程（OOPIF）；宿主 = `http://tauri.localhost` 渲染进程 + Rust 主进程；
- W06 已证包文档 CSP `default-src 'none'` 阻断 worker/fetch/WebSocket。

本探针新增两个故障类别（真实产品隔离构建 W 证据）：
- 场景 a 内存压力：guest 以 setTimeout 分片、每 tick 分配 64MB 大数组并逐页触碰提交，
  累计目标 2048MB（任务口径 1.5–2GB）；分片让心跳/消息仍可运行 → 观测
  「宿主 IPC 是否仍响应 / 会话是否被误判 / 独立 renderer 内存是否增长」；达到目标并保持后，
  用 CDP `Page.crash` 对 guest target 注入 renderer 崩溃（等效被 OOM kill 的崩溃路径；
  若自然 OOM 先发生则记录并跳过注入；注入无效则回退为 guest 心跳静默），观测
  heartbeat timeout → suspended → failed + safeMode → 停用 stopped 持久化。
- 场景 b CPU 压力：CSP 阻断 worker（W06），故用 setTimeout 链做密集计算：
  阶段 1 以 40ms 分片满载约 6s（心跳可运行 → 不应误判，但宿主须仍响应）；
  阶段 2 用 2500ms 长任务链（> 1200ms 心跳阈值）饥饿事件循环 → 自然心跳超时检测。

如实记录口径：
- 所有 checks 为「可观测断言」，detail 保留原始观测值；自然 OOM 未触发、注入方式等
  均写入 metrics，文档不得把注入崩溃写成自然 OOM。
- 用户 App 未运行 → 用户实例影响记 N/A（只读确认，不触碰）。
- 进程清理仅按路径白名单（`C:\\ke-tmp\\uiws-t26\\bin\\*` / `F:\\Work\\Dev\\cargo-target\\*`）
  或自身 Popen PID；严禁 taskkill /IM、严禁杀 D:\\AstraNota 用户实例。

用法（WSL）：
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
    \\$env:PYTHONIOENCODING='utf-8'; & 'C:\\Users\\y8882\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe' \
    -X utf8 'F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_t26_fault_mem_probe.py'"
  可选参数：--scenario mem|cpu|all（默认 all）、--target-mb 2048
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websocket  # websocket-client

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE_ROOT = Path(r"C:\ke-tmp\uiws-t26-w07mem")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"
CDP_PORT = 9880 + (os.getpid() % 100)

MEM_PACK_ID = "com.probe.t26w07mem"
CPU_PACK_ID = "com.probe.t26w07cpu"

# ============================== guest 包模板 ==============================

MEM_GUEST = r"""
<script>
(function(){
  var CFG = {chunkMB: __CHUNK_MB__, targetMB: __TARGET_MB__, tickMs: __TICK_MS__, deadlineMs: __DEADLINE_MS__};
  var S = {phase:'idle', allocCount:0, allocFails:0, allocErrors:[], totalMB:0, heartbeats:0, t0:Date.now()};
  function post(event, extra){
    var m = {type:'w07-report', scenario:'mem', event:event, phase:S.phase,
             totalMB:S.totalMB, allocCount:S.allocCount, allocFails:S.allocFails,
             heartbeats:S.heartbeats, elapsedMs:Date.now()-S.t0, t:Date.now()};
    if (extra) { for (var k in extra) m[k] = extra[k]; }
    try { window.parent.postMessage(m, '*'); } catch(e) {}
  }
  var hbTimer = setInterval(function(){
    S.heartbeats++;
    try { window.parent.postMessage({type:'guest-heartbeat'}, '*'); } catch(e) {}
  }, 400);
  function silence(reason){
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    S.phase = 'silent';
    post('silent', {reason: reason, heldMB: S.totalMB});
  }
  var chunks = [];
  function step(){
    try {
      var n = CFG.chunkMB * 1024 * 1024;
      var a = new Uint8Array(n);
      for (var i = 0; i < n; i += 4096) { a[i] = (i & 255); }  // 逐页触碰 → 真实提交物理页
      chunks.push(a);
      S.allocCount++; S.totalMB += CFG.chunkMB;
      post('alloc', {ok: true});
    } catch(err) {
      S.allocFails++; S.allocErrors.push(String((err && err.message) || err));
      post('alloc', {ok: false, error: String((err && err.message) || err)});
      if (S.allocFails >= 3) {
        S.phase = 'hold';
        post('alloc-fail-final', {heldMB: S.totalMB, errors: S.allocErrors});
        return;
      }
    }
    if (S.totalMB >= CFG.targetMB || (Date.now() - S.t0) > CFG.deadlineMs) {
      S.phase = 'hold';
      post('target-reached', {heldMB: S.totalMB, chunks: S.allocCount});
      return;  // 保持 chunks 引用 + 心跳，等待宿主注入故障/停用
    }
    setTimeout(step, CFG.tickMs);
  }
  function startAlloc(){
    if (S.phase !== 'idle') return;
    S.phase = 'alloc'; S.t0 = Date.now();
    post('alloc-start', {});
    setTimeout(step, 0);
  }
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'w07-cmd' && d.cmd === 'start') startAlloc();
    else if (d.type === 'w07-cmd' && d.cmd === 'silence') silence('host-fallback-command');
  });
  post('alive', {ua: navigator.userAgent, hb: true, awaiting: 'start'});
})();
</script>
"""

CPU_GUEST = r"""
<script>
(function(){
  var CFG = {loadMs: __LOAD_MS__, taskMs: __TASK_MS__, starveBlockMs: __STARVE_BLOCK_MS__, starveBlocks: __STARVE_BLOCKS__};
  var S = {phase:'idle', heartbeats:0, loadTicks:0, starveBlocks:0, t0:Date.now(), x:0};
  function post(event, extra){
    var m = {type:'w07-report', scenario:'cpu', event:event, phase:S.phase,
             loadTicks:S.loadTicks, starveBlocks:S.starveBlocks, heartbeats:S.heartbeats,
             elapsedMs:Date.now()-S.t0, t:Date.now()};
    if (extra) { for (var k in extra) m[k] = extra[k]; }
    try { window.parent.postMessage(m, '*'); } catch(e) {}
  }
  var hbTimer = setInterval(function(){
    S.heartbeats++;
    try { window.parent.postMessage({type:'guest-heartbeat'}, '*'); } catch(e) {}
  }, 400);
  function spin(ms){
    var end = Date.now() + ms;
    while (Date.now() < end) { for (var i = 0; i < 20000; i++) { S.x = (S.x + i) % 1000003; } }
  }
  // 阶段 1：setTimeout 分片密集计算（每片 ~40ms，单片 < 1200ms 心跳阈值；期望会话不被误判）
  var loadEnd = 0;
  function loadStep(){
    spin(CFG.taskMs);
    S.loadTicks++;
    if (S.loadTicks % 22 === 0) post('load-progress', {});
    if (Date.now() < loadEnd) { setTimeout(loadStep, 0); }
    else {
      post('load-end', {loadTicks: S.loadTicks});
      S.phase = 'starve-wait';
      setTimeout(starveStart, 300);
    }
  }
  // 阶段 2：2500ms 长任务链（> 1200ms 心跳阈值）→ 事件循环饥饿 → 宿主心跳超时检测
  function starveStart(){
    S.phase = 'starve';
    post('starve-start', {blockMs: CFG.starveBlockMs});
    function block(){
      spin(CFG.starveBlockMs);
      S.starveBlocks++;
      post('starve-block', {blocks: S.starveBlocks});
      if (S.starveBlocks < CFG.starveBlocks) { setTimeout(block, 0); }
      else { S.phase = 'after-starve'; post('starve-end', {}); }
    }
    block();
  }
  function startLoad(){
    if (S.phase !== 'idle') return;
    S.phase = 'load'; S.t0 = Date.now();
    loadEnd = Date.now() + CFG.loadMs;
    post('load-start', {loadMs: CFG.loadMs});
    setTimeout(loadStep, 0);
  }
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'w07-cmd' && d.cmd === 'start') startLoad();
  });
  post('alive', {ua: navigator.userAgent, hb: true, awaiting: 'start'});
})();
</script>
"""

# ============================== 通用工具 ==============================

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha_text(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def run_ps(script: str, timeout: float = 25.0) -> str:
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=timeout)
        return (out.stdout or "").strip()
    except Exception:
        return ""


def run_ps_json(script: str, timeout: float = 25.0):
    txt = run_ps(script, timeout)
    if not txt:
        return None
    for line in reversed(txt.splitlines()):
        line = line.strip()
        if line.startswith("{") or line.startswith("["):
            try:
                return json.loads(line)
            except Exception:
                continue
    try:
        return json.loads(txt)
    except Exception:
        return None


def real_folder(name: str) -> Path:
    out = run_ps(f"[Environment]::GetFolderPath('{name}')", timeout=15)
    return Path(out) if out else Path(os.environ.get("APPDATA", "."))


def user_pid() -> str:
    """真实用户实例（D:\\AstraNota*）：只读查询，不触碰。"""
    return run_ps("(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
                  "Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id", timeout=15)


def cleanup() -> None:
    """按路径白名单清理测试进程（禁止按镜像名/用户路径杀进程）。"""
    ps = ("Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "
          "'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue; "
          "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "
          "'F:\\Work\\Dev\\cargo-target\\*' -or $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | "
          "Stop-Process -Force -ErrorAction SilentlyContinue")
    run_ps(ps, timeout=25)


def targets(port: int) -> list:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


def version_info(port: int) -> dict:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"error": repr(e)}


class CDP:
    def __init__(self, url: str, timeout: float = 5.0):
        self.ws = websocket.create_connection(url, timeout=timeout, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None, timeout: float = 3.0) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            raw = self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr: str, timeout: float = 3.0):
        res = self.call("Runtime.evaluate",
                        {"expression": expr, "returnByValue": True, "awaitPromise": True}, timeout)
        return (res.get("result") or {}).get("value")

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass


def invoke(cdp: CDP, cmd: str, payload: dict, timeout: float = 3.0) -> dict:
    expr = ("(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
            + json.dumps(cmd) + ", " + json.dumps(payload) + "); return {ok:true,value:r}; }"
              " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()")
    return cdp.eval(expr, timeout)  # type: ignore[return-value]


def status_state(resp) -> str | None:
    if isinstance(resp, dict) and resp.get("ok") is True and isinstance(resp.get("value"), dict):
        return resp["value"].get("state")
    return None


def body_text(cdp: CDP) -> str:
    try:
        return str(cdp.eval("document.body.innerText || ''"))
    except Exception:
        return ""


def click_text(cdp: CDP, text: str) -> bool:
    try:
        return bool(cdp.eval(
            "(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'')"
            ".includes(" + json.dumps(text) + ")); if(b){b.click(); return true;} return false; })()"))
    except Exception:
        return False


def browser_target_infos(port: int) -> list:
    """浏览器级 CDP Target.getTargets：拿 page/iframe target 的 pid（用于精确采样独立 renderer）。"""
    vi = version_info(port)
    url = vi.get("webSocketDebuggerUrl")
    if not url:
        return []
    b = None
    try:
        b = CDP(url, timeout=8)
        res = b.call("Target.getTargets", {}, timeout=6)
        return list((res or {}).get("targetInfos") or [])
    except Exception:
        return []
    finally:
        if b:
            b.close()


_CIM_COLS = ("ProcessId,Name,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime")


def cim_procs(pids) -> dict:
    ids = sorted({int(p) for p in pids if p})
    if not ids:
        return {}
    script = ("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
              "$ids=@(" + ",".join(str(i) for i in ids) + "); "
              "Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ProcessId } | "
              "Select-Object " + _CIM_COLS + " | ConvertTo-Json -Compress")
    data = run_ps_json(script, timeout=20)
    if data is None:
        return {}
    if isinstance(data, dict):
        data = [data]
    return {int(d["ProcessId"]): d for d in data if isinstance(d, dict) and d.get("ProcessId") is not None}


def cim_all() -> list:
    script = ("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
              "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,"
              "WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime | ConvertTo-Json -Compress")
    data = run_ps_json(script, timeout=25)
    if data is None:
        return []
    if isinstance(data, dict):
        data = [data]
    return [d for d in data if isinstance(d, dict)]


def tree_summary(root_pid: int, all_procs: list) -> dict:
    """宿主进程树（应用 + sidecar + WebView2 子树）WorkingSet 合计 / CPU 累计。"""
    if not all_procs:
        return {}
    children: dict[int, list[int]] = {}
    by_pid: dict[int, dict] = {}
    for p in all_procs:
        try:
            pid = int(p.get("ProcessId"))
            ppid = int(p.get("ParentProcessId") or 0)
        except Exception:
            continue
        by_pid[pid] = p
        children.setdefault(ppid, []).append(pid)
    ids, stack = [], [root_pid]
    while stack:
        cur = stack.pop()
        if cur in ids:
            continue
        ids.append(cur)
        stack.extend(children.get(cur, []))
    ws = 0
    cpu = 0
    for i in ids:
        p = by_pid.get(i)
        if not p:
            continue
        try:
            ws += int(p.get("WorkingSetSize") or 0)
            cpu += int(p.get("KernelModeTime") or 0) + int(p.get("UserModeTime") or 0)
        except Exception:
            continue
    return {"pids": ids, "process_count": len(ids), "working_set_bytes": ws, "cpu_100ns": cpu}


def proc_snapshot(pids) -> dict:
    """快速进程快照（Get-Process，约 100ms；用于压力窗口内高频采样）。"""
    ids = sorted({int(p) for p in pids if p})
    if not ids:
        return {}
    script = ("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
              "$ids=@(" + ",".join(str(i) for i in ids) + "); "
              "Get-Process -Id $ids -ErrorAction SilentlyContinue | "
              "Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64,"
              "@{n='CpuSeconds';e={$_.TotalProcessorTime.TotalSeconds}} | ConvertTo-Json -Compress")
    data = run_ps_json(script, timeout=15)
    if data is None:
        return {}
    if isinstance(data, dict):
        data = [data]
    snap = {}
    for d in data:
        if not isinstance(d, dict) or d.get("Id") is None:
            continue
        try:
            snap[int(d["Id"])] = {"name": d.get("ProcessName"),
                                  "ws": int(d.get("WorkingSet64") or 0),
                                  "private": int(d.get("PrivateMemorySize64") or 0),
                                  "cpu": float(d.get("CpuSeconds") or 0.0)}
        except Exception:
            continue
    return snap


# ============================== 应用环境 ==============================

class AppEnv:
    def __init__(self, name: str):
        self.name = name
        self.base = BASE_ROOT / name
        self.appdata = self.base / "appdata"
        self.workspace = self.base / "workspace"
        self.pack = self.base / "pack"
        self.port = CDP_PORT
        self.proc: subprocess.Popen | None = None
        self.log = None

    def prepare(self, guest_html: str, pack_id: str, pack_name: str) -> None:
        shutil.rmtree(self.base, ignore_errors=True)
        self.base.mkdir(parents=True)
        cleanup()  # 清理上次运行可能遗留的测试进程（路径白名单）
        for f in ("Roaming", "LocalApplicationData"):
            shutil.rmtree(real_folder(f) / "com.astranota.uiws.e2e", ignore_errors=True)
        self.appdata.mkdir(parents=True, exist_ok=True)
        (self.workspace / "Articles").mkdir(parents=True)
        (self.workspace / "Articles" / "w07.md").write_bytes(
            b"---\ntitle: w07 mem/cpu probe\n---\n\nW07 fault probe fixture.\n")
        # 修复环境：预置 app_config（recent workspace）与 settings（启动自动打开），避免停在 WorkspacePicker
        ke_cfg = self.appdata / "KnowledgeEditor"
        ke_cfg.mkdir(parents=True, exist_ok=True)
        (ke_cfg / "app_config.json").write_text(json.dumps(
            {"recent_workspaces": [str(self.workspace)], "recent_documents": []},
            ensure_ascii=False), encoding="utf-8")
        (ke_cfg / "settings.json").write_text(json.dumps(
            {"schema_version": 1, "startup": {"auto_open_recent_workspace": True}},
            ensure_ascii=False), encoding="utf-8")

        key = self.base / "key.pem"
        pub = json.loads(subprocess.run(
            [NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
            capture_output=True, text=True, encoding="utf-8").stdout)["publicKeyHex"]
        self.pack.mkdir()
        entry = ("<!doctype html><html><head><meta charset=\"utf-8\"><title>W07 fault guest</title>"
                 "</head><body><div id=\"root\">W07 fault guest</div>" + guest_html + "</body></html>")
        (self.pack / "index.html").write_bytes(entry.encode("utf-8"))
        manifest = {"id": pack_id, "name": pack_name, "version": "1.0.0", "apiVersion": 1,
                    "capabilities": ["ui.shell"], "entry": {"html": "index.html"}, "commands": [],
                    "assets": [{"path": "index.html", "sha256": sha_text(entry)}]}
        (self.pack / "manifest.json").write_bytes(
            json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
        subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(self.pack), "--key", str(key),
                        "--keyid", "k1", "--write"], check=True, capture_output=True,
                       text=True, encoding="utf-8")
        self.pubkey = pub

    def start(self):
        env = {**os.environ, "APPDATA": str(self.appdata), "KE_WORKSPACE": str(self.workspace),
               "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": self.pubkey}}),
               "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={self.port}"}
        self.log = (self.base / "app.log").open("w", encoding="utf-8")
        self.proc = subprocess.Popen([str(EXE)], env=env, stdout=self.log, stderr=subprocess.STDOUT)

    def connect(self, timeout: float = 90.0) -> CDP:
        end = time.time() + timeout
        cdp = None
        while time.time() < end:
            mains = [t for t in targets(self.port)
                     if t.get("type") == "page" and "tauri.localhost" in str(t.get("url", ""))
                     and t.get("webSocketDebuggerUrl")]
            if mains:
                cdp = CDP(mains[0]["webSocketDebuggerUrl"])
                break
            time.sleep(0.3)
        if cdp is None:
            raise RuntimeError("CDP 主窗口未就绪")
        for _ in range(120):
            try:
                if cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        # 若仍停在 WorkspacePicker（后端已打开 workspace 但 UI 未刷新）→ 重载一次页面
        body = body_text(cdp)
        if "创意工坊" not in body and "选择一个工作区开始" in body:
            cdp.call("Page.reload", {}, timeout=10)
            time.sleep(3.0)
            for _ in range(40):
                if "创意工坊" in body_text(cdp):
                    break
                time.sleep(0.3)
        return cdp

    def close(self) -> None:
        if self.proc is not None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=8)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        cleanup()
        if self.log is not None:
            try:
                self.log.close()
            except Exception:
                pass


def install_and_enable(env: AppEnv, cdp: CDP, metrics: dict) -> dict:
    """安装签名包 → 授予信任 → 启用 guest，返回诊断（含 __keGuestStart / 心跳）。"""
    diag: dict = {}
    cdp.eval("window.__w07reports=[];"
             "window.addEventListener('message', function(e){"
             " if (e && e.data && e.data.type === 'w07-report') { window.__w07reports.push(e.data); }});")
    inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(env.pack)}, timeout=15)
    diag["install"] = inst
    for _ in range(120):
        if "创意工坊" in body_text(cdp):
            break
        time.sleep(0.25)
    click_text(cdp, "创意工坊")
    enable_btn = False
    for _ in range(80):
        try:
            enable_btn = bool(cdp.eval(
                "(() => [...document.querySelectorAll('button')].some(b => "
                "(b.textContent||'').includes('启用 guest')))()"))
        except Exception:
            enable_btn = False
        if enable_btn:
            break
        time.sleep(0.25)
    diag["enable_button"] = enable_btn
    click_text(cdp, "授予信任")
    time.sleep(1.5)
    diag["clicked_enable"] = click_text(cdp, "启用 guest")
    time.sleep(1.0)
    diag["start"] = None
    diag["heartbeats"] = 0
    diag["status"] = None
    for _ in range(160):
        try:
            diag["start"] = cdp.eval("window.__keGuestStart || null")
        except Exception:
            pass
        try:
            diag["heartbeats"] = int(cdp.eval("window.__keGuestHeartbeats || 0") or 0)
        except Exception:
            pass
        diag["status"] = invoke(cdp, "workshop_pack_session_status", {}, timeout=6)
        start_ok = isinstance(diag.get("start"), dict) and bool((diag.get("start") or {}).get("hasSession"))
        if start_ok and diag["heartbeats"] >= 2 and status_state(diag["status"]) == "active":
            break
        time.sleep(0.25)
    body = body_text(cdp)
    (env.base / "body-after-enable.txt").write_text(body, encoding="utf-8")
    diag["body_tail"] = body[-600:]
    metrics["guest_start"] = diag.get("start")
    metrics["status_after_enable"] = diag.get("status")
    diag["ok"] = (inst.get("ok") is True
                  and isinstance(diag.get("start"), dict) and bool((diag.get("start") or {}).get("hasSession"))
                  and status_state(diag.get("status")) == "active")
    return diag


def locate_guest(env: AppEnv, pack_id: str) -> dict:
    """定位 guest iframe target（OOPIF）：pid（Target.getTargets）+ webSocketDebuggerUrl（/json/list）。"""
    infos = browser_target_infos(env.port)
    listed = targets(env.port)
    out = {"target_infos": infos, "list_targets": listed, "guest": None, "host_page": None}
    guest: dict | None = None
    host: dict | None = None
    for t in infos:
        url = str(t.get("url", ""))
        if t.get("type") == "iframe" and pack_id in url:
            guest = dict(t)
        elif t.get("type") == "page" and "tauri.localhost" in url:
            host = dict(t)
    for t in listed:
        url = str(t.get("url", ""))
        if t.get("type") == "iframe" and pack_id in url:
            if guest is None:
                guest = dict(t)
            if t.get("webSocketDebuggerUrl"):
                guest["webSocketDebuggerUrl"] = t.get("webSocketDebuggerUrl")
        elif t.get("type") == "page" and "tauri.localhost" in url:
            if host is None:
                host = dict(t)
            if t.get("webSocketDebuggerUrl"):
                host["webSocketDebuggerUrl"] = t.get("webSocketDebuggerUrl")
    out["guest"] = guest
    out["host_page"] = host
    return out


def send_guest_cmd(cdp: CDP, cmd: str) -> bool:
    """宿主经 postMessage 向 guest 发控制命令（start / silence；跨域 postMessage 合法）。"""
    try:
        return bool(cdp.eval(
            "(() => { const f = document.querySelector('iframe');"
            " if (!f || !f.contentWindow) return false;"
            " f.contentWindow.postMessage({type:'w07-cmd', cmd:" + json.dumps(cmd) + "}, '*'); return true; })()"))
    except Exception:
        return False


def find_guest_report(reports: list, event: str):
    for r in reversed(reports):
        if isinstance(r, dict) and r.get("event") == event:
            return r
    return None


def wait_guest_report(cdp: CDP, event: str, timeout: float) -> dict | None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            reports = cdp.eval("(window.__w07reports || []).slice(-80)") or []
        except Exception:
            reports = []
        hit = find_guest_report(reports, event)
        if hit:
            return hit
        time.sleep(0.15)
    return None


def fire_page_crash(guest_target: dict) -> dict:
    """向 guest renderer target 发送 CDP Page.crash（send-only，返回发送耗时细节）。

    渲染进程崩溃会让该 target 的 devtools WS 断开，因此不等待响应；是否生效由
    「guest 心跳冻结 + 宿主状态迁移」二次确认，未生效则调用方回退心跳静默。
    """
    detail: dict = {"method": "Page.crash", "sent": False}
    url = (guest_target or {}).get("webSocketDebuggerUrl")
    if not url:
        detail["error"] = "no guest webSocketDebuggerUrl"
        return detail
    ws = None
    try:
        ws = websocket.create_connection(url, timeout=3, suppress_origin=True)
        ws.send(json.dumps({"id": 1, "method": "Page.crash", "params": {}}))
        detail["sent"] = True
        try:
            ws.settimeout(0.5)
            detail["first_response"] = json.loads(ws.recv())
        except Exception as e:
            detail["first_response_error"] = type(e).__name__
    except Exception as e:
        detail["error"] = repr(e)
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
    return detail


def force_guest_silence(cdp: CDP) -> bool:
    """回退路径：宿主经 postMessage 命 guest 心跳静默（仅当 CDP 崩溃注入不可用）。"""
    try:
        return bool(cdp.eval(
            "(() => { const f = document.querySelector('iframe');"
            " if (!f || !f.contentWindow) return false;"
            " f.contentWindow.postMessage({type:'w07-cmd', cmd:'silence'}, '*'); return true; })()"))
    except Exception:
        return False


def safe_mode_and_stop(cdp: CDP, proc: subprocess.Popen, checks: list, metrics: dict,
                       scenario: str) -> None:
    """检查 failed + safeMode UI、停用 guest → stopped 持久化、宿主存活。"""
    try:
        st_resp = invoke(cdp, "workshop_pack_session_status", {}, timeout=3)
    except Exception as e:
        st_resp = {"error": repr(e)}
    state = status_state(st_resp)
    body = ""
    safe_ui = False
    end = time.time() + 6.0
    while time.time() < end:  # 等 React 渲染 safeMode 横幅（状态落盘与 UI 渲染存在毫秒级竞态）
        body = body_text(cdp)
        if "safeMode" in body:
            safe_ui = True
            break
        time.sleep(0.12)
    check(checks, scenario, "连续故障超限 → failed + safeMode（宿主侧恢复策略生效）",
          state == "failed" and safe_ui,
          {"state": state, "safeMode_in_ui": safe_ui, "body_tail": body[-400:]})
    click_text(cdp, "停用 guest")
    stopped = False
    st_final = None
    for _ in range(60):
        try:
            st_final = invoke(cdp, "workshop_pack_session_status", {}, timeout=3)
        except Exception:
            st_final = None
        if status_state(st_final) == "stopped":
            stopped = True
            break
        time.sleep(0.2)
    check(checks, scenario, "停用 guest → stopped 持久化（恢复操作可用）", stopped, st_final)
    metrics["status_after_stop"] = st_final
    alive = proc.poll() is None
    check(checks, scenario, "宿主进程存活（未被 guest 故障拖垮）", alive,
          {"alive": alive, "exit_code": proc.poll()})


def user_instance_check(user_pid_before: str, checks: list, scenario: str) -> None:
    after = user_pid()
    if not user_pid_before and not after:
        check(checks, scenario, "用户实例未被触碰（用户 App 未运行 → N/A）", True,
              {"user_pid_before": "", "user_pid_after": "", "result": "N/A: 用户 App 未运行（只读确认）"})
    else:
        check(checks, scenario, "用户实例未受影响", bool(after) and after == user_pid_before,
              {"user_pid_before": user_pid_before, "user_pid_after": after})


def check(checks: list, scenario: str, name: str, ok: bool, detail) -> None:
    checks.append({"scenario": scenario, "name": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:360], flush=True)


# ============================== 场景 a：内存压力 ==============================

def scenario_mem(checks: list, target_mb: int) -> dict:
    scenario = "mem"
    print("\n=== 场景 a：guest 内存压力 ===", flush=True)
    m: dict = {"scenario": "mem", "target_mb": target_mb}
    env = AppEnv("mem")
    cdp = None
    up_before = user_pid()
    try:
        guest_html = (MEM_GUEST.replace("__CHUNK_MB__", "64")
                                .replace("__TARGET_MB__", str(target_mb))
                                .replace("__TICK_MS__", "80")
                                .replace("__DEADLINE_MS__", "60000"))
        env.prepare(guest_html, MEM_PACK_ID, "T26 W07 Mem Fault Pack")
        mem_total, mem_free = system_memory_mb()
        m["system_memory_mb"] = {"total": mem_total, "free_before": mem_free}
        env.start()
        cdp = env.connect()
        vi = version_info(env.port)
        m["webview2"] = {k: vi.get(k) for k in ("Browser", "Protocol-Version", "User-Agent")}
        diag = install_and_enable(env, cdp, m)
        m["enable_diag"] = {k: diag.get(k) for k in ("install", "enable_button", "clicked_enable",
                                                     "start", "heartbeats", "status", "body_tail")}
        check(checks, scenario, "W07M-1 安装签名包（内存压力故障包）",
              diag.get("install", {}).get("ok") is True, diag.get("install"))
        check(checks, scenario, "W07M-2 guest 启用并心跳流动（active）", diag.get("ok") is True,
              {k: diag.get(k) for k in ("start", "heartbeats", "status")})
        if not diag.get("ok"):
            return m
        loc = locate_guest(env, MEM_PACK_ID)
        guest = loc.get("guest") or {}
        host = loc.get("host_page") or {}
        guest_pid = int(guest.get("pid") or 0) or None
        host_pid = int(host.get("pid") or 0) or None
        m["guest_target"] = {k: guest.get(k) for k in ("targetId", "type", "url", "pid")}
        m["host_page_target"] = {k: host.get(k) for k in ("targetId", "type", "url", "pid")}
        base_procs = proc_snapshot([env.proc.pid, host_pid, guest_pid])
        all_base = cim_all()
        base_tree = tree_summary(env.proc.pid, all_base) if all_base else {}
        m["baseline"] = {"procs": base_procs, "tree": base_tree}
        print("guest_pid:", guest_pid, "host_pid:", host_pid,
              "guest_ws_mb:", round(((base_procs.get(guest_pid) or {}).get("ws") or 0) / 1048576, 1),
              "tree_ws_mb:", round((base_tree.get("working_set_bytes") or 0) / 1048576, 1), flush=True)
        # guest 已加载但等待 start 命令 → 干净基线后再开始分配
        t_enable = time.time()
        m["start_cmd_posted"] = send_guest_cmd(cdp, "start")
        m["alloc_start_report"] = wait_guest_report(cdp, "alloc-start", timeout=10)
        lat_series: list = []
        state_timeline: list = []
        hb_series: list = []
        procs_samples: list = []
        last_state = None

        def sample_latency() -> str | None:
            t = time.time()
            try:
                resp = invoke(cdp, "workshop_pack_session_status", {}, timeout=2.5)
                lat_series.append({"t": round(t - t_enable, 3), "ms": round((time.time() - t) * 1000, 1)})
                return status_state(resp)
            except Exception:
                lat_series.append({"t": round(t - t_enable, 3), "ms": None})
                return None

        def record_state(st) -> None:
            nonlocal last_state
            if st != last_state:
                state_timeline.append({"t": round(time.time() - t_enable, 3), "state": st})
                last_state = st

        def refresh_reports() -> list:
            try:
                return cdp.eval("(window.__w07reports || []).slice(-120)") or []
            except Exception:
                return []

        # ---- 阶段 A：持续分片分配（心跳可运行），观测宿主响应/会话状态/renderer 内存 ----
        target_reached = None
        alloc_fail_final = None
        natural_crash = False
        hb_prev, hb_prev_t = 0, time.time()
        last_sample = 0.0
        deadline = t_enable + 90
        while time.time() < deadline:
            st = sample_latency()
            record_state(st)
            if time.time() - last_sample > 1.5:  # 高频采样宿主 IPC，进程快照低频（PowerShell 启动开销 ~0.5s）
                last_sample = time.time()
                procs_samples.append({"t": round(time.time() - t_enable, 2),
                                      "procs": proc_snapshot([env.proc.pid, host_pid, guest_pid])})
            reports = refresh_reports()
            try:
                hb = int(cdp.eval("window.__keGuestHeartbeats || 0") or 0)
            except Exception:
                hb = 0
            hb_series.append({"t": round(time.time() - t_enable, 2), "hb": hb})
            tr = find_guest_report(reports, "target-reached")
            if tr is not None:
                target_reached = tr
                m["target_reached_report"] = tr
                m["target_reached_at_s"] = round(time.time() - t_enable, 3)
                break
            ff = find_guest_report(reports, "alloc-fail-final")
            if ff is not None:
                alloc_fail_final = ff
                m["alloc_fail_final"] = ff
                m["alloc_fail_at_s"] = round(time.time() - t_enable, 3)
                break
            if hb == hb_prev and (time.time() - hb_prev_t) > 2.5 and st in ("suspended", "failed"):
                natural_crash = True
                m["natural_crash"] = True
                m["natural_crash_at_s"] = round(time.time() - t_enable, 3)
                break
            if hb > hb_prev:
                hb_prev, hb_prev_t = hb, time.time()
            time.sleep(0.15)
        n_lat_alloc = len(lat_series)
        st_after_alloc = last_state
        alloc_reports = [r for r in refresh_reports() if isinstance(r, dict)]
        alloc_ok = [r for r in alloc_reports if r.get("event") == "alloc" and r.get("ok") is True]
        alloc_fail = [r for r in alloc_reports if r.get("event") == "alloc" and r.get("ok") is False]
        m["alloc"] = {"ok_ticks": len(alloc_ok), "failed_ticks": len(alloc_fail),
                      "failed_errors": [r.get("error") for r in alloc_fail][:5],
                      "guest_reported_total_mb": (target_reached or {}).get("heldMB"),
                      "elapsed_ms": (target_reached or {}).get("elapsedMs"),
                      "natural_crash": natural_crash}
        held_mb = int((target_reached or {}).get("heldMB") or 0)
        check(checks, scenario, "W07M-3 guest 持续分配达目标（≥1.5GB 且无 allocation 失败）",
              bool(target_reached) and held_mb >= 1536 and len(alloc_fail) == 0,
              {"heldMB": held_mb, "ok_ticks": len(alloc_ok), "failed_ticks": len(alloc_fail),
               "elapsed_ms": (target_reached or {}).get("elapsedMs")})
        # 阶段 A 内的宿主 IPC 延迟
        alloc_lat = [x["ms"] for x in lat_series[:n_lat_alloc] if x["ms"] is not None]
        timeouts = sum(1 for x in lat_series[:n_lat_alloc] if x["ms"] is None)
        alloc_lat.sort()
        lat_summary = {"samples": len(alloc_lat), "timeouts": timeouts,
                       "max_ms": max(alloc_lat) if alloc_lat else None,
                       "p95_ms": alloc_lat[min(len(alloc_lat) - 1, int(len(alloc_lat) * 0.95))] if alloc_lat else None}
        m["host_ipc_latency_during_alloc"] = lat_summary
        check(checks, scenario, "W07M-4 内存压力期间宿主 IPC 仍可响应（无超时，最大延迟 < 2000ms）",
              lat_summary["timeouts"] == 0 and lat_summary["max_ms"] is not None and lat_summary["max_ms"] < 2000,
              lat_summary)
        hb_first = hb_series[0]["hb"] if hb_series else 0
        hb_last = hb_series[-1]["hb"] if hb_series else 0
        check(checks, scenario, "W07M-5 内存压力期间会话保持 active（心跳持续，无误判）",
              st_after_alloc == "active" and hb_last > hb_first and not natural_crash,
              {"state": st_after_alloc, "heartbeats": hb_last, "hb_delta": hb_last - hb_first})
        m["heartbeats"] = {"first": hb_first, "last": hb_last, "series": hb_series[-20:]}
        # 独立 renderer 内存增长（guest target pid 精确采样 + 分配完成后峰值快照）
        peak_guest_proc = proc_snapshot([guest_pid]).get(guest_pid, {}) if guest_pid else {}
        ws_values, dep_base = [], None
        if guest_pid:
            for s in procs_samples:
                p = s["procs"].get(guest_pid)
                if p:
                    ws_values.append(p["ws"])
            if peak_guest_proc.get("ws"):
                ws_values.append(peak_guest_proc["ws"])
            dep_base = (base_procs.get(guest_pid) or {}).get("ws")
        ws_peak = max(ws_values) if ws_values else None
        ws_base = dep_base if dep_base else (ws_values[0] if ws_values else None)
        delta_mb = round((ws_peak - ws_base) / 1048576, 1) if ws_base and ws_peak else None
        m["renderer_memory"] = {"guest_pid": guest_pid,
                                "baseline_ws_mb": round(ws_base / 1048576, 1) if ws_base else None,
                                "peak_ws_mb": round(ws_peak / 1048576, 1) if ws_peak else None,
                                "delta_mb": delta_mb, "peak_proc": peak_guest_proc}
        check(checks, scenario, "W07M-6 独立 renderer 可观测内存增长（guest renderer WS 增量 ≥ 1200MB）",
              delta_mb is not None and delta_mb >= 1200,
              {"guest_pid": guest_pid, "baseline_ws_mb": m["renderer_memory"]["baseline_ws_mb"],
               "peak_ws_mb": m["renderer_memory"]["peak_ws_mb"], "delta_mb": delta_mb})

        # ---- 阶段 B：保持内存压力 ~1.5s（确认仍 active）后注入 renderer 崩溃 ----
        if not natural_crash:
            hold_end = time.time() + 1.5
            while time.time() < hold_end:
                record_state(sample_latency())
                time.sleep(0.12)
        # ---- 阶段 C：故障注入 + suspended/failed 状态迁移观测 ----
        t_inject = time.time()
        injection: dict = {"natural_crash": natural_crash}
        try:
            hb_before = int(cdp.eval("window.__keGuestHeartbeats || 0") or 0)
        except Exception:
            hb_before = 0
        if not natural_crash and guest:
            injection.update(fire_page_crash(guest))
        det = {"suspended_at_s": None, "failed_at_s": None}
        frozen_hb = hb_before
        fallback_used = False
        deadline = time.time() + 30
        while time.time() < deadline:
            st = sample_latency()
            record_state(st)
            try:
                hb_now = int(cdp.eval("window.__keGuestHeartbeats || 0") or 0)
            except Exception:
                hb_now = frozen_hb
            if hb_now != frozen_hb:
                frozen_hb = hb_now
            if st == "suspended" and det["suspended_at_s"] is None:
                det["suspended_at_s"] = round(time.time() - t_enable, 3)
            if st == "failed":
                det["failed_at_s"] = round(time.time() - t_enable, 3)
                break
            # CDP 崩溃注入未生效 → 6s 后回退为 guest 心跳静默（一次性），再观测检测
            if (not natural_crash and not fallback_used and det["suspended_at_s"] is None
                    and (time.time() - t_inject) > 6.0):
                injection["fallback"] = "guest-heartbeat-silence"
                injection["fallback_posted"] = force_guest_silence(cdp)
                fallback_used = True
            time.sleep(0.12)
        effective = bool(natural_crash or det["suspended_at_s"] is not None or det["failed_at_s"] is not None)
        injection["effective"] = effective
        if fallback_used:
            injection["method"] = "guest-heartbeat-silence(fallback)"
        elif not natural_crash:
            injection["method"] = "cdp-page-crash"
        else:
            injection["method"] = "natural"
        m["crash_injection"] = injection
        m["injected_at_s"] = round(t_inject - t_enable, 3)
        m["fault_observation"] = det
        m["state_timeline"] = state_timeline
        body = body_text(cdp)
        (env.base / "body-after-fault.txt").write_text(body, encoding="utf-8")
        check(checks, scenario, "W07M-7 renderer 崩溃后心跳中断被检测（suspended/failed 可观测）",
              det["suspended_at_s"] is not None or det["failed_at_s"] is not None,
              {"injection": injection.get("method"), "effective": effective,
               "suspended_at_s": det["suspended_at_s"], "failed_at_s": det["failed_at_s"],
               "injected_at_s": m["injected_at_s"]})
        after_crash = proc_snapshot([guest_pid]).get(guest_pid, {}) if guest_pid else {}
        m["guest_renderer_after_crash"] = {"pid": guest_pid, "alive": bool(after_crash)}
        safe_mode_and_stop(cdp, env.proc, checks, m, scenario)
        all_after = cim_all()
        m["tree_after_stop"] = tree_summary(env.proc.pid, all_after) if all_after else {}
        m["host_alive"] = env.proc.poll() is None
        (env.base / "state-timeline.json").write_text(
            json.dumps({"state_timeline": state_timeline, "latency": lat_series}, ensure_ascii=False, indent=2),
            encoding="utf-8")
        user_instance_check(up_before, checks, scenario)
        return m
    except Exception as e:
        import traceback
        m["error"] = traceback.format_exc()
        print("SCENARIO mem ERROR:", repr(e), flush=True)
        check(checks, scenario, "W07M-0 场景执行未异常", False, {"error": repr(e)})
        return m
    finally:
        if cdp:
            cdp.close()
        env.close()


# ============================== 场景 b：CPU 压力 ==============================

def scenario_cpu(checks: list) -> dict:
    scenario = "cpu"
    print("\n=== 场景 b：guest CPU 压力 ===", flush=True)
    m: dict = {"scenario": "cpu"}
    env = AppEnv("cpu")
    cdp = None
    up_before = user_pid()
    try:
        guest_html = (CPU_GUEST.replace("__LOAD_MS__", "6000")
                                .replace("__TASK_MS__", "40")
                                .replace("__STARVE_BLOCK_MS__", "2500")
                                .replace("__STARVE_BLOCKS__", "4"))
        env.prepare(guest_html, CPU_PACK_ID, "T26 W07 CPU Fault Pack")
        mem_total, mem_free = system_memory_mb()
        m["system_memory_mb"] = {"total": mem_total, "free_before": mem_free}
        env.start()
        cdp = env.connect()
        vi = version_info(env.port)
        m["webview2"] = {k: vi.get(k) for k in ("Browser", "Protocol-Version", "User-Agent")}
        diag = install_and_enable(env, cdp, m)
        m["enable_diag"] = {k: diag.get(k) for k in ("install", "enable_button", "clicked_enable",
                                                     "start", "heartbeats", "status", "body_tail")}
        check(checks, scenario, "W07C-1 安装签名包（CPU 压力故障包）",
              diag.get("install", {}).get("ok") is True, diag.get("install"))
        check(checks, scenario, "W07C-2 guest 启用并心跳流动（active）", diag.get("ok") is True,
              {k: diag.get(k) for k in ("start", "heartbeats", "status")})
        if not diag.get("ok"):
            return m
        loc = locate_guest(env, CPU_PACK_ID)
        guest = loc.get("guest") or {}
        host = loc.get("host_page") or {}
        guest_pid = int(guest.get("pid") or 0) or None
        host_pid = int(host.get("pid") or 0) or None
        m["guest_target"] = {k: guest.get(k) for k in ("targetId", "type", "url", "pid")}
        m["host_page_target"] = {k: host.get(k) for k in ("targetId", "type", "url", "pid")}
        m["baseline_procs"] = proc_snapshot([env.proc.pid, host_pid, guest_pid])
        print("guest_pid:", guest_pid, "host_pid:", host_pid,
              "guest_ws_mb:", round(((m["baseline_procs"].get(guest_pid) or {}).get("ws") or 0) / 1048576, 1),
              flush=True)
        # guest 已加载但等待 start 命令 → 干净基线后再开始 CPU 压力
        t_enable = time.time()
        m["start_cmd_posted"] = send_guest_cmd(cdp, "start")
        m["load_start_report"] = wait_guest_report(cdp, "load-start", timeout=10)
        lat_series: list = []
        state_timeline: list = []
        hb_series: list = []
        procs_samples: list = []
        last_state = None
        load_start_at = load_end_at = starve_start_at = None
        load_cpu = {"base": None, "end": None}
        state_at_load_end = None
        hb_at_load_start = 0
        hb_at_load_end = 0
        first_suspended = first_failed = None

        def sample_latency() -> str | None:
            t = time.time()
            try:
                resp = invoke(cdp, "workshop_pack_session_status", {}, timeout=2.5)
                lat_series.append({"t": round(t - t_enable, 3), "ms": round((time.time() - t) * 1000, 1)})
                return status_state(resp)
            except Exception:
                lat_series.append({"t": round(t - t_enable, 3), "ms": None})
                return None

        def record_state(st) -> None:
            nonlocal last_state
            if st != last_state:
                state_timeline.append({"t": round(time.time() - t_enable, 3), "state": st})
                last_state = st

        last_sample = 0.0
        deadline = t_enable + 90
        # guest 报告自带 epoch t；以「load-start 首次被观测时刻」为锚点，用 t 差值还原事件精确时间
        # （消除主循环 ~0.7s 轮询粒度对时间轴的失真）
        anchor = {"load_obs": None, "load_t": None}

        def event_rel(r: dict, observed_now: float | None = None) -> float:
            obs = observed_now if observed_now is not None else (time.time() - t_enable)
            gt = r.get("t")
            if anchor["load_t"] is not None and isinstance(gt, (int, float)) and anchor["load_obs"] is not None:
                return round(anchor["load_obs"] + (gt - anchor["load_t"]) / 1000.0, 3)
            return round(obs, 3)

        while time.time() < deadline:
            now = time.time()
            st = sample_latency()
            record_state(st)
            if now - last_sample > 0.5:
                last_sample = now
                procs_samples.append({"t": round(now - t_enable, 2),
                                      "procs": proc_snapshot([env.proc.pid, host_pid, guest_pid])})
            try:
                reports = cdp.eval("(window.__w07reports || []).slice(-160)") or []
            except Exception:
                reports = []
            try:
                hb = int(cdp.eval("window.__keGuestHeartbeats || 0") or 0)
            except Exception:
                hb = 0
            hb_series.append({"t": round(now - t_enable, 2), "hb": hb})
            for r in reports:
                if not isinstance(r, dict):
                    continue
                ev = r.get("event")
                if ev == "load-start" and load_start_at is None:
                    load_start_at = round(now - t_enable, 3)
                    anchor["load_obs"] = load_start_at
                    anchor["load_t"] = r.get("t")
                    load_cpu["base"] = (proc_snapshot([guest_pid]).get(guest_pid) or {}).get("cpu")
                    load_cpu["base_wall"] = time.time()
                    hb_at_load_start = hb
                elif ev == "load-end" and load_end_at is None:
                    load_end_at = event_rel(r)
                    load_cpu["end"] = (proc_snapshot([guest_pid]).get(guest_pid) or {}).get("cpu")
                    load_cpu["end_wall"] = time.time()
                    state_at_load_end = st
                    hb_at_load_end = hb
                elif ev == "starve-start" and starve_start_at is None:
                    starve_start_at = event_rel(r)
                    m["starve_start_guest"] = {"t": r.get("t"), "elapsedMs": r.get("elapsedMs")}
            if st == "suspended" and first_suspended is None:
                first_suspended = round(now - t_enable, 3)
            if st == "failed":
                first_failed = round(now - t_enable, 3)
                break
            if starve_start_at is not None and (now - t_enable) - starve_start_at > 30:
                break
            if load_start_at is None and (now - t_enable) > 20:
                break
            time.sleep(0.12)
        m["state_timeline"] = state_timeline
        m["heartbeats_series"] = hb_series[-40:]
        m["load_start_at_s"], m["load_end_at_s"], m["starve_started_at_s"] = load_start_at, load_end_at, starve_start_at
        m["first_suspended_at_s"] = first_suspended
        m["first_failed_at_s"] = first_failed
        (env.base / "reports.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")

        if load_start_at is not None and load_end_at is not None:
            load_lat = sorted(x["ms"] for x in lat_series
                              if x["ms"] is not None and load_start_at <= x["t"] <= load_end_at)
            load_timeouts = sum(1 for x in lat_series
                                if x["ms"] is None and load_start_at <= x["t"] <= load_end_at)
            load_max = max(load_lat) if load_lat else None
            m["host_ipc_latency_during_load"] = {"samples": len(load_lat), "max_ms": load_max,
                                                 "timeouts": load_timeouts}
            check(checks, scenario, "W07C-3 CPU 密集负载期间宿主 IPC 仍可响应（无超时，最大延迟 < 2000ms）",
                  load_timeouts == 0 and load_max is not None and load_max < 2000,
                  m["host_ipc_latency_during_load"])
            hb_delta_load = hb_at_load_end - hb_at_load_start
            check(checks, scenario, "W07C-4 CPU 密集负载期间心跳正常、会话保持 active（无误判）",
                  state_at_load_end == "active" and hb_delta_load >= 8 and (load_end_at - load_start_at) >= 5.0,
                  {"state_at_load_end": state_at_load_end, "heartbeats_at_end": hb_at_load_end,
                   "hb_delta_during_load": hb_delta_load,
                   "load_window_guest_s": round(load_end_at - load_start_at, 2)})
            cpu_base = load_cpu.get("base") or 0
            cpu_end = load_cpu.get("end") or 0
            wall = max(0.001, (load_cpu.get("end_wall") or 0) - (load_cpu.get("base_wall") or 0))
            cpu_s = max(0.0, (cpu_end - cpu_base))
            ratio = cpu_s / wall
            m["guest_cpu"] = {"cpu_seconds": round(cpu_s, 3), "wall_seconds": round(wall, 3),
                              "core_ratio": round(ratio, 3), "guest_pid": guest_pid,
                              "load_window_guest_s": round((load_end_at or 0) - (load_start_at or 0), 3),
                              "hb_delta_during_load": hb_at_load_end - hb_at_load_start}
            check(checks, scenario, "W07C-5 guest CPU 压力可观测（独立 renderer 负载 ≥ 0.5 core）",
                  ratio >= 0.5, m["guest_cpu"])
        else:
            check(checks, scenario, "W07C-3 CPU 密集负载期间宿主 IPC 仍可响应（无超时，最大延迟 < 2000ms）",
                  False, {"error": "未观测到 load-start/load-end 报告"})
            check(checks, scenario, "W07C-4 CPU 密集负载期间心跳正常、会话保持 active（无误判）",
                  False, {"error": "未观测到 load-start/load-end 报告"})
            check(checks, scenario, "W07C-5 guest CPU 压力可观测（独立 renderer 负载 ≥ 0.5 core）",
                  False, {"error": "未观测到 load-start/load-end 报告"})
        detection_after_starve = None
        if starve_start_at is not None and first_suspended is not None:
            detection_after_starve = round(first_suspended - starve_start_at, 3)
        m["detection_after_starve_s"] = detection_after_starve
        check(checks, scenario, "W07C-6 长任务 CPU 饥饿 → 心跳超时被检测（suspended/failed 可观测）",
              first_suspended is not None or first_failed is not None,
              {"starve_started_at_s": starve_start_at,
               "first_suspended_at_s": first_suspended,
               "detection_after_starve_s": detection_after_starve,
               "first_failed_at_s": first_failed})
        (env.base / "body-after-fault.txt").write_text(body_text(cdp), encoding="utf-8")
        safe_mode_and_stop(cdp, env.proc, checks, m, scenario)
        user_instance_check(up_before, checks, scenario)
        m["host_alive"] = env.proc.poll() is None
        return m
    except Exception as e:
        import traceback
        m["error"] = traceback.format_exc()
        print("SCENARIO cpu ERROR:", repr(e), flush=True)
        check(checks, scenario, "W07C-0 场景执行未异常", False, {"error": repr(e)})
        return m
    finally:
        if cdp:
            cdp.close()
        env.close()


def system_memory_mb() -> tuple:
    data = run_ps_json("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
                       "$cs=Get-CimInstance Win32_ComputerSystem; $os=Get-CimInstance Win32_OperatingSystem; "
                       "ConvertTo-Json -Compress -InputObject @{total=[math]::Round($cs.TotalPhysicalMemory/1MB);"
                       " free=[math]::Round($os.FreePhysicalMemory/1024)}", timeout=20)
    if isinstance(data, dict):
        return (data.get("total"), data.get("free"))
    return (None, None)


# ============================== 入口 ==============================

def env_metadata() -> dict:
    meta = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "repo": str(REPO),
        "exe": str(EXE),
        "exe_sha256": sha256_file(EXE) if EXE.exists() else None,
        "exe_mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime)) if EXE.exists() else None,
        "cdp_port": CDP_PORT,
        "mem_pack_id": MEM_PACK_ID,
        "cpu_pack_id": CPU_PACK_ID,
    }
    try:
        head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"],
                              capture_output=True, text=True, encoding="utf-8", timeout=15).stdout.strip()
        meta["git_head"] = head
    except Exception:
        meta["git_head"] = None
    vi = None
    try:
        v = version_info(CDP_PORT)  # 运行前无实例，通常不可用；运行时另记
        if v.get("Browser"):
            vi = v.get("Browser")
    except Exception:
        pass
    meta["webview2_version"] = vi
    total_free = system_memory_mb()
    meta["system_memory_mb"] = {"total": total_free[0], "free": total_free[1]}
    return meta


def main() -> int:
    scenario = "all"
    target_mb = 2048
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--scenario" and i + 1 < len(argv):
            scenario = argv[i + 1]
        if a == "--target-mb" and i + 1 < len(argv):
            try:
                target_mb = int(argv[i + 1])
            except Exception:
                pass
    print(f"scenario={scenario} target_mb={target_mb} cdp_port={CDP_PORT}", flush=True)
    if not EXE.exists():
        print(f"缺少测试构建: {EXE}")
        return 2
    checks: list = []
    metrics: dict = {"mem": None, "cpu": None}
    env_meta = env_metadata()
    try:
        if scenario in ("mem", "all"):
            metrics["mem"] = scenario_mem(checks, target_mb)
        if scenario in ("cpu", "all"):
            metrics["cpu"] = scenario_cpu(checks)
    except Exception:
        import traceback
        metrics["fatal_error"] = traceback.format_exc()
    # 运行时 WebView2 版本（从场景 metrics 回填；进程已退出时不再探测）
    for key in ("mem", "cpu"):
        sc = metrics.get(key) or {}
        wv = (sc.get("webview2") or {}).get("Browser") if isinstance(sc, dict) else None
        if wv:
            env_meta["webview2_version"] = wv
            break
    mem_checks = [c for c in checks if c.get("scenario") == "mem"]
    cpu_checks = [c for c in checks if c.get("scenario") == "cpu"]
    summary = {
        "generated_at": env_meta.get("generated_at"),
        "scenario": "T26 W07 扩展故障类别：guest 内存压力 + guest CPU 压力（隔离产品 W 证据）",
        "environment": env_meta,
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "scenarios": {
            "mem": {"checks": mem_checks, "pass_count": sum(1 for c in mem_checks if c["pass"]),
                    "total": len(mem_checks), "metrics": metrics.get("mem")},
            "cpu": {"checks": cpu_checks, "pass_count": sum(1 for c in cpu_checks if c["pass"]),
                    "total": len(cpu_checks), "metrics": metrics.get("cpu")},
        },
        "metrics": metrics,
        "raw_notes": [
            "PASS/FAIL 为可观测断言；自然 OOM 是否发生、崩溃注入方式见 metrics.crash_injection",
            "用户 App 未运行 → 用户实例影响 N/A（只读确认，不触碰用户数据/进程）",
            "进程清理仅按路径白名单或自身 Popen PID；无 taskkill /IM",
        ],
    }
    EVID.mkdir(parents=True, exist_ok=True)
    out = EVID / "T26-W07-mem-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} checks -> {out}", flush=True)
    if summary["total"] == 0:
        return 2
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
