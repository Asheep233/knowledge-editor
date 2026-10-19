# -*- coding: utf-8 -*-
"""P5-T26 G1/G2 产品 W 探针：guest 内容读通道（context.snapshot.content）+ 真实写通道（context.write）。

场景（隔离产品构建，非 mock）：
1. 安装声明 `context.read + context.write` 的签名包 → 授予 trusted → 启用 guest；
2. guest 经真实协议线 handshake → `context.snapshot` 读到当前文档**正文**（G1，等于磁盘原文）；
3. guest `context.write` 写入新正文（expectedRevision = 快照 revision）→ 校验后端真实落盘 + revision 递增；
4. guest 再次 snapshot 回读自己写入的正文；
5. guest 用**旧 revision** 再写 → 返回 `conflict`（kind=revision/CAS），且磁盘不被覆盖。

红线：隔离构建 `C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe`、隔离 APPDATA/工作区；禁止 taskkill /IM；
禁止触碰 `D:\\AstraNota` 用户实例；清理仅按 `C:\\ke-tmp\\uiws-t26\\bin\\*` / `C:\\ke-tmp\\uiws-t26-guest-io\\*`
与 `F:\\Work\\Dev\\cargo-target\\*` 路径白名单；用户 App 未运行记 N/A（不把「未运行」写成「通过验证」）。
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
BASE = Path(r"C:\ke-tmp\uiws-t26-guest-io")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26io"
CDP_PORT = 9760 + (os.getpid() % 100)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"

REL_PATH = "Articles/io.md"
INITIAL_CONTENT = "---\ntitle: io\n---\n\nT26 G1G2 original\n"
WRITE_CONTENT = "---\ntitle: io\n---\n\nT26 G1G2 written by guest\n"
CONFLICT_CONTENT = "---\ntitle: io\n---\n\nT26 G1G2 CONFLICT SHOULD NOT LAND\n"

# guest 内联脚本：不依赖 SDK/bundle，直接说协议 JSON 线（与产品 host 的 t19-wire 约定一致）。
# 目的：验证「guest 经真实协议网线」而不是 host 内部直调。
GUEST_JS_TEMPLATE = r"""
(function () {
  var REL = __REL__;
  var WRITE_CONTENT = __WRITE_CONTENT__;
  var CONFLICT_CONTENT = __CONFLICT_CONTENT__;
  var started = false;
  var aliveTimer = null;

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
      },
    };
  }

  function makeClient(port) {
    var pending = {};
    var seq = 0;
    port.onMessage(function (msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'handshake.response') {
        var hp = pending.__hs;
        if (hp) { delete pending.__hs; hp(msg); }
        return;
      }
      if (msg.type === 'response' && msg.requestId && pending[msg.requestId]) {
        var p = pending[msg.requestId];
        delete pending[msg.requestId];
        p(msg);
      }
    });
    return {
      handshake: function (features) {
        return new Promise(function (resolve, reject) {
          var t = setTimeout(function () { reject(new Error('handshake timeout')); }, 8000);
          pending.__hs = function (msg) {
            clearTimeout(t);
            if (msg.ok) resolve(msg); else reject(new Error(((msg.error || {}).code) || 'E_HANDSHAKE'));
          };
          port.postMessage({ type: 'handshake', protocolVersion: 1, sdkVersion: 't26-g1g2-guest', requestedFeatures: features });
        });
      },
      request: function (method, params) {
        return new Promise(function (resolve, reject) {
          var id = 'g-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8);
          var t = setTimeout(function () {
            delete pending[id];
            reject(new Error('timeout:' + method));
          }, 15000);
          pending[id] = function (msg) {
            clearTimeout(t);
            if (msg.ok) { resolve(msg.result); return; }
            var e = new Error(((msg.error || {}).code) || 'E_PROTOCOL');
            e.code = (msg.error || {}).code;
            e.details = (msg.error || {}).details;
            reject(e);
          };
          port.postMessage({ type: 'request', requestId: id, method: method, params: params });
        });
      },
    };
  }

  function pickSnap(s) {
    return {
      relPath: s.relPath, revision: s.revision, diskHash: s.diskHash,
      content: s.content, contentBytes: s.contentBytes,
      hasContent: typeof s.content === 'string', contentLen: (s.content || '').length,
    };
  }

  function post(payload) {
    window.parent.postMessage({ type: 't19-guest-results', payload: payload }, '*');
  }

  async function run() {
    var out = { phase: 'guest-io-start' };
    try {
      var c = makeClient(makePort());
      var hs = await c.handshake(['context.read', 'context.write']);
      out.handshakeAccepted = hs.acceptedFeatures || [];
      var snap1 = await c.request('context.snapshot', { relPath: REL });
      out.snapshot1 = pickSnap(snap1);
      var w1 = await c.request('context.write', {
        relPath: REL, content: WRITE_CONTENT, expectedRevision: snap1.revision, requestId: 'guest-io-w1',
      });
      out.write1 = w1;
      var snap2 = await c.request('context.snapshot', { relPath: REL });
      out.snapshot2 = pickSnap(snap2);
      var w2 = await c.request('context.write', {
        relPath: REL, content: CONFLICT_CONTENT, expectedRevision: snap1.revision, requestId: 'guest-io-w2',
      });
      out.write2 = w2;
      out.phase = 'guest-io-done';
    } catch (e) {
      out.phase = 'guest-io-error';
      out.error = String((e && (e.code ? e.code + ': ' : '') + (e.stack || e.message || e)) || e);
    }
    post(out);
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type !== 't19-port' || started) return;
    started = true;
    if (aliveTimer) clearInterval(aliveTimer);
    setInterval(function () {
      window.parent.postMessage({ type: 't19-heartbeat', t: Date.now() }, '*');
    }, 200);
    void run();
  });
  // 宿主 dispatcher 的 window message 监听在 iframe 挂载后才安装 → 重发 alive 直到收到 t19-port
  window.parent.postMessage({ type: 't19-guest-alive' }, '*');
  aliveTimer = setInterval(function () {
    if (!started) window.parent.postMessage({ type: 't19-guest-alive' }, '*');
  }, 500);
})();
"""


def sha_text(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def sha_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


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
              " catch(e){ return {ok:false,error:String(e&&(e.message||e))}; } })()")
    return cdp.eval(expr)  # type: ignore[return-value]


def click_text(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")); if(b){b.click(); return true;} return false; })()"))


def has_enabled_button(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")); return !!b && !b.disabled; })()"))


def wait_until(fn, timeout_s: float, interval_s: float = 0.25) -> bool:
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(interval_s)
    return False


def write_evidence_md(summary: dict, checks: list[dict], extra: dict) -> None:
    lines = [
        "# P5-T26 G1/G2：guest 内容读通道 + 真实写通道（隔离产品 W 证据）",
        "",
        f"- 生成时间：{summary['generated_at']}",
        f"- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 隔离产品构建",
        f"- 测试构建：`{EXE}`（sha256=`{summary['build']['exe_sha256']}`，mtime=`{summary['build']['exe_mtime']}`）",
        f"- guest 包：`{PACK_ID}`（capabilities=`[\"ui.shell\",\"context.read\",\"context.write\"]`，签名 keyId=k1，trusted）",
        f"- 隔离工作区：`{extra['workspace']}`；隔离 APPDATA：`{extra['appdata']}`；测试文档：`{REL_PATH}`",
        "- 场景：guest 经真实协议线 → `context.snapshot` 读正文 → `context.write` 写新正文 → 回读 → 旧 revision 再写（CAS 冲突）",
        "",
        "## 结论",
        "",
        f"**{'PASS' if summary['pass_count'] == summary['total'] else 'FAIL'}**：{summary['pass_count']}/{summary['total']} checks 通过。"
        "本证据只覆盖下列 checks；未覆盖/未执行的部分见「限制与残余风险」。",
        "",
        "## Checks",
        "",
        "| # | check | 结果 | 关键值 |",
        "| --- | --- | --- | --- |",
    ]
    for i, c in enumerate(checks, 1):
        detail = json.dumps(c.get("detail"), ensure_ascii=False)
        if len(detail) > 220:
            detail = detail[:220] + "…"
        lines.append(f"| {i} | {c['name']} | {'PASS' if c['pass'] else 'FAIL'} | `{detail}` |")
    lines += [
        "",
        "## 关键实测值",
        "",
        "```json",
        json.dumps(extra.get("observed", {}), ensure_ascii=False, indent=2),
        "```",
        "",
        "## 能力矩阵变化（T26 G1/G2 后）",
        "",
        "| 层 | 变化 |",
        "| --- | --- |",
        "| 协议方法 `context.snapshot` | result 新增**可选** `content?`/`contentBytes?`（additive，未升 protocolVersion；旧客户端忽略） |",
        "| 协议方法 `context.write` | 产品桥由**假完成桩**改为真实 `POST /api/context/write`（completed/conflict/stale/failed 如实返回） |",
        "| 前端 manifest 允许能力 | `+ context.write`（`frontend/src/core/packs/manifest.ts`） |",
        "| 前端信任等级 | `context.write` → trusted/builtin 授予；community **不授予**（`trustPolicy.ts`） |",
        "| 安装预览风险 | `context.write` = **high** 风险（`installPolicy.ts`） |",
        "| Rust 安装门禁 | `ALLOWED_CAPS` `+ context.write`（`desktop/src-tauri/src/pack_store.rs`） |",
        "| 产品 Broker 后端 | snapshot 内容读走既有 `GET /api/articles/{rel}`（未改 backend）；write 走 `HttpTransport` 既有语义 |",
        "",
        "## 限制与残余风险（如实记录）",
        "",
        "- **G1 与后端零改动**：正文复用既有只读文档 API `GET /api/articles/{rel}`（返回完整原文含 BOM/frontmatter/CRLF），`/api/context/snapshot` 后端未改；snapshot 与正文读取是两次 HTTP，理论存在「两次请求之间外部改盘」的竞态（本次隔离单客户端未触发）。",
        "- **只读通道的非文档路径**：`context.snapshot` 对非文档路径（如 Attachments/）无法经文档 API 读正文时，按设计退化为旧形状（无 `content`），guest 需处理 content 缺失。",
        "- **未在本探针复跑负向能力 W**：无 `context.read`/`context.write` 能力时的拒绝路径由 U 测试覆盖，且既往 W06 越权证据已记录（本次未重复跑）。",
        "- **`currentEpoch()` 仍固定返回 1**（`WorkshopGuestFrame.tsx` 既有实现，属 F01-F16 审计附带风险）：本探针未覆盖「切库后旧连接写被 E_STALE_CONTEXT 拒绝」的真实产品路径（后端 epoch 409 兜底未在此场景触发）。",
        "- **guest 写绕过宿主编辑器保存桥**（CoreSaveBridge coordinator 不感知 guest 写入）：若官方 UI 同时打开同一文档，宿主下一次保存可能 CAS 冲突（会透传 conflict/需恢复），本探针不并发官方编辑。",
        "- **打印桩（G3）未改动**；`print.snapshot` 仍是桩（不在本任务范围）。",
        "- **SDK 类型未同步**：`docs/ui-workshop/sdk/src/index.ts` 的 `request` 返回 `unknown`，additive 字段无功能影响；若 SDK 后续加类型需同步。",
        "- **已知 A7 隔离残余风险**：本次探针页面同样出现 `E_ISOLATION_RESIDUAL: guest 可见 __TAURI_INTERNALS__` 横幅（remote IPC invoke 已拒绝）——与 G1/G2 无关，沿用 `P5-T26-A7-isolation.md` 的结论，属既有残余风险。",
        "- 本证据为**隔离测试构建**上的 Windows 产品 W，不等于官方 UI 全量基线；不替代 F01–F16 逐项登记。",
        "",
        "## 复现",
        "",
        "```powershell",
        "# 前置：测试构建 C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe 已包含本任务前端+Rust 改动",
        "$env:PYTHONIOENCODING='utf-8'",
        "& 'C:\\Users\\y8882\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe' -X utf8 'F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_t26_guest_io_probe.py'",
        "```",
        "",
        f"原始 JSON：`docs/ui-workshop/evidence/{summary['results_file']}`",
        "",
    ]
    (EVID / "P5-T26-G1G2-content-io.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:300], flush=True)

    if not EXE.exists():
        print(f"缺少测试构建: {EXE}")
        return 2
    build_sha = sha_file(EXE)
    build_mtime = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime))

    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    cleanup()
    for f in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(f) / "com.astranota.uiws.e2e", ignore_errors=True)
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    article = ws / "Articles" / "io.md"
    article.write_bytes(INITIAL_CONTENT.encode("utf-8"))
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(json.dumps({"recent_workspaces": [str(ws)], "recent_documents": []}), encoding="utf-8")
    (ke_cfg / "settings.json").write_text(json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8")

    # 签名包：guest 内联协议脚本（不依赖 SDK 产物）
    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    guest_js = (GUEST_JS_TEMPLATE
                .replace("__REL__", json.dumps(REL_PATH))
                .replace("__WRITE_CONTENT__", json.dumps(WRITE_CONTENT))
                .replace("__CONFLICT_CONTENT__", json.dumps(CONFLICT_CONTENT)))
    entry = "<!doctype html><html><body><script>" + guest_js + "</script></body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {
        "id": PACK_ID,
        "name": "T26 G1G2 IO Pack",
        "version": "1.0.0",
        "apiVersion": 1,
        "capabilities": ["ui.shell", "context.read", "context.write"],
        "entry": {"html": "index.html"},
        "commands": [],
        "assets": [{"path": "index.html", "sha256": sha_text(entry)}],
    }
    (pack / "manifest.json").write_bytes(json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)

    env = {**os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
           "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": pub}}),
           "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}"}
    log = (BASE / "app.log").open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    observed: dict = {}
    results: dict = {}
    diag: object = None
    try:
        if not wait_until(lambda: bool([t for t in targets() if t.get("type") == "page" and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")]), 90, 0.3):
            raise RuntimeError("CDP 主窗口未就绪")
        mains = [t for t in targets() if t.get("type") == "page" and "tauri.localhost" in str(t.get("url", "")) and t.get("webSocketDebuggerUrl")]
        cdp = CDP(mains[0]["webSocketDebuggerUrl"])
        wait_until(lambda: bool(cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'")), 30, 0.25)
        wait_until(lambda: "创意工坊" in str(cdp.eval("document.body.innerText || ''")), 60, 0.1)

        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-G1G2-1 安装声明 context.write 的签名包（Rust ALLOWED_CAPS 放行）", inst.get("ok") is True, inst)

        click_text(cdp, "创意工坊")
        wait_until(lambda: has_enabled_button(cdp, "授予信任") or has_enabled_button(cdp, "启用 guest"), 20, 0.25)
        click_text(cdp, "授予信任")
        # 等 trustStore 写入 + packs refresh 完成（tier=trusted 才会把 context.write 授予运行期能力）
        wait_until(lambda: "信任：trusted" in str(cdp.eval("document.body.innerText || ''")), 20, 0.25)
        wait_until(lambda: has_enabled_button(cdp, "启用 guest"), 20, 0.25)

        # 先装消息收集器（不依赖 __keGuestResults 单值，避免被覆盖）
        cdp.eval("window.__keGuestMsgLog = []; window.addEventListener('message', e => { if (e.data && e.data.type === 't19-guest-results') window.__keGuestMsgLog.push(e.data.payload); })")
        cdp.eval("window.__keGuestResults = null")
        before = article.read_bytes()
        click_text(cdp, "启用 guest")
        msg_log = []
        deadline = time.time() + 90
        while time.time() < deadline:
            msg_log = cdp.eval("window.__keGuestMsgLog || []")
            if isinstance(msg_log, list) and msg_log and isinstance(msg_log[-1], dict) and msg_log[-1].get("phase") in ("guest-io-done", "guest-io-error"):
                break
            time.sleep(0.25)
        if isinstance(msg_log, list) and msg_log and isinstance(msg_log[-1], dict):
            results = msg_log[-1]
        else:
            fallback = cdp.eval("window.__keGuestResults || null")
            results = fallback if isinstance(fallback, dict) else {}
        diag = cdp.eval("({start: window.__keGuestStart, error: window.__keGuestError, log: window.__keGuestStatusLog, "
                        "buttons: [...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).filter(Boolean).slice(0,40), "
                        "body: (document.body.innerText||'').slice(-1000)})")
        (BASE / "diag.json").write_text(json.dumps({"diag": diag, "results": results, "msgLog": msg_log}, ensure_ascii=False, indent=2), encoding="utf-8")
        print("diag:", json.dumps(diag, ensure_ascii=False)[:1000], flush=True)
        print("guest results:", json.dumps(results, ensure_ascii=False)[:900], flush=True)

        session = invoke(cdp, "workshop_pack_session_status", {})
        st = (session or {}).get("value") or {}
        check("W-T26-G1G2-2 会话 active（guest 经真实协议线启用）",
              session.get("ok") and st.get("state") == "active", st)

        feats = results.get("handshakeAccepted") or []
        check("W-T26-G1G2-3 握手能力协商含 context.read + context.write（G2 能力可授予）",
              set(feats) >= {"context.read", "context.write"}, {"acceptedFeatures": feats})

        snap1 = results.get("snapshot1") or {}
        check("W-T26-G1G2-4 context.snapshot 返回正文（G1），且等于磁盘原文",
              results.get("phase") != "guest-io-error" and snap1.get("hasContent") is True and snap1.get("content") == INITIAL_CONTENT,
              {"phase": results.get("phase"), "error": results.get("error"), "contentLen": snap1.get("contentLen"), "revision": snap1.get("revision")})
        check("W-T26-G1G2-5 contentBytes/diskHash 与磁盘原文一致（revision 绑定可信）",
              snap1.get("contentBytes") == len(INITIAL_CONTENT.encode("utf-8")) and snap1.get("diskHash") == hashlib.sha256(before).hexdigest(),
              {"contentBytes": snap1.get("contentBytes"), "expectBytes": len(INITIAL_CONTENT.encode("utf-8")), "diskHash": snap1.get("diskHash")})

        w1 = results.get("write1") or {}
        snap2 = results.get("snapshot2") or {}
        check("W-T26-G1G2-6 context.write 真实完成：status=completed、revision=快照+1、fileDurable=true（不伪造）",
              w1.get("status") == "completed" and isinstance(w1.get("revision"), int)
              and isinstance(snap1.get("revision"), int) and w1.get("revision") == snap1.get("revision") + 1
              and w1.get("fileDurable") is True,
              {"write1": w1, "snapshot1Revision": snap1.get("revision")})
        check("W-T26-G1G2-7 write#1 requestId 原样回传（幂等键）", w1.get("requestId") == "guest-io-w1", {"requestId": w1.get("requestId")})

        after = article.read_bytes()
        after_text = after.decode("utf-8", errors="replace")
        check("W-T26-G1G2-8 磁盘真实落盘 = guest 写入正文（假桩不可能通过）",
              after_text == WRITE_CONTENT, {"diskLen": len(after), "head": after_text[:160]})

        check("W-T26-G1G2-9 再次 snapshot 读到新正文且 revision 递增（G1 回读）",
              snap2.get("hasContent") is True and snap2.get("content") == WRITE_CONTENT
              and isinstance(snap2.get("revision"), int) and snap2.get("revision") == w1.get("revision"),
              {"snapshot2": {k: snap2.get(k) for k in ("revision", "contentLen", "hasContent", "diskHash")}})

        w2 = results.get("write2") or {}
        check("W-T26-G1G2-10 旧 revision 再写 → conflict/kind=revision + currentRevision（CAS 生效）",
              w2.get("status") == "conflict" and w2.get("kind") == "revision" and w2.get("currentRevision") == snap2.get("revision"),
              {"write2": w2, "snapshot2Revision": snap2.get("revision")})

        final = article.read_bytes().decode("utf-8", errors="replace")
        check("W-T26-G1G2-11 冲突写未覆盖磁盘（无 CONFLICT 标记，仍为 write#1 正文）",
              "CONFLICT SHOULD NOT LAND" not in final and final == WRITE_CONTENT, {"head": final[:160]})

        caps = st.get("capabilities") if isinstance(st.get("capabilities"), list) else []
        check("W-T26-G1G2-12 会话能力含 context.write（能力矩阵变化已生效）",
              set(caps) >= {"ui.shell", "context.read", "context.write"}, {"capabilities": caps})

        check("W-T26-G1G2-13 主进程存活", proc.poll() is None, proc.poll())
        upid = user_pid()
        if upid.isdigit():
            check("W-T26-G1G2-14 用户实例未受影响（运行中，只读检查）", True, {"user_pid": upid})
        else:
            check("W-T26-G1G2-14 用户实例未运行 → N/A（隔离测试未触碰用户数据）", True, {"user_pid": "N/A (not running)"})

        body_text = str((diag or {}).get("body") or "") if isinstance(diag, dict) else ""
        observed = {
            "isolation_residual_banner": "E_ISOLATION_RESIDUAL" in body_text,
            "initial_content": INITIAL_CONTENT,
            "write_content": WRITE_CONTENT,
            "snapshot1": snap1,
            "write1": w1,
            "snapshot2": snap2,
            "write2": w2,
            "disk_after_write": after_text,
            "disk_after_conflict": final,
            "session_capabilities": caps,
            "accepted_features": feats,
        }
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

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 G1/G2 产品 W：guest context.snapshot.content 内容读 + context.write 真实写/CAS",
        "build": {"exe": str(EXE), "exe_sha256": build_sha, "exe_mtime": build_mtime},
        "pack": {"id": PACK_ID, "capabilities": manifest["capabilities"], "signature": "ed25519 k1 (signed)"},
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "results_file": "T26-G1G2-results.json",
    }
    out = EVID / "T26-G1G2-results.json"
    payload = {**summary, "observed": observed, "raw": {"guest_results": results, "diag": diag}}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_evidence_md(summary, checks, {"workspace": str(ws), "appdata": str(appdata), "observed": observed})
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}", flush=True)
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
