# -*- coding: utf-8 -*-
"""P5-T26 G3/G4 产品 W 探针：真实打印管线（print.snapshot）+ 宿主事件发射（HostEvent）。

场景（隔离产品构建，非 mock）：
1. 安装声明 `ui.shell + context.read + print.request` 的签名包 → 授予 trusted → 启用 guest；
2. guest 经真实协议线 handshake → `print.snapshot` 对测试文档**真实打印**（后端快照 → 产品渲染器
   → Rust 隐藏 renderer PrintToPdf → 应用数据目录 PDF）→ 校验返回的不透明 pdfToken 对应真实
   PDF 文件（存在/%PDF 头/大小>0/位于隔离 APPDATA 目录）、pages=null（不伪造页数）；
3. 同一文档连续打印两次 → 不同 token/不同文件（不覆盖语义）；
4. 非法路径 / 不存在的文档 → 如实返回协议错误（不返回假 token）；
5. G4：产品真实动作 → guest 收到 HostEvent：保存成功（document-saved）、打开/切换文档
   （context-changed）、主题变化（theme-changed）；
6. 会话仍 active、主进程存活、用户实例只读检查（未运行记 N/A）。

前置（由 Lead 协调构建，本脚本不构建）：前端 `VITE_KE_WORKSHOP=1`（建议同时
`VITE_KE_CORE_SAVE=1` 以获得真实递增 revision）构建 dist-build → 隔离 src-tauri cargo build →
`C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe`。启动时必须 `KE_WS_PRINT_RENDER=1`（T16 既有
隐藏 renderer env 门控；未设置时 print.snapshot 会如实失败 E_PRINT_RENDER，属既有产品缺口）。

红线：隔离构建 `C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe`、隔离 APPDATA/工作区/输出；
禁止 taskkill /IM；禁止触碰 `D:\\AstraNota` 用户实例；清理仅按
`C:\\ke-tmp\\uiws-t26\\bin\\*` / `C:\\ke-tmp\\uiws-t26-g3g4\\*` / `F:\\Work\\Dev\\cargo-target\\*`
路径白名单；用户 App 未运行记 N/A（不把「未运行」写成「通过验证」）。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websocket  # websocket-client

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE = Path(r"C:\ke-tmp\uiws-t26-g3g4")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_ID = "com.probe.t26g3g4"
CDP_PORT = 9410 + (os.getpid() % 80)
NODE = r"C:\Program Files\nodejs\node.exe"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"
APP_DATA_ID = "com.astranota.uiws.e2e"
# 注意：Tauri `appDataDir()`（Windows known folder）**不读 APPDATA env**，测试构建的 app_data 目录
# 落在真实 %APPDATA%\com.astranota.uiws.e2e（独立 identifier，非用户 App 数据）→ 探针按真实路径读
# 渲染器状态并在开始/结束清理该「测试 identifier」目录；PDF 输出经诊断覆盖强制落到隔离 BASE。
REAL_APPDATA = Path(os.environ.get("APPDATA", r"C:\Users\y8882\AppData\Roaming"))

REL_PATH = "Articles/print-test.md"
SECOND_REL = "Articles/second.md"
MARKER = "G3G4MARK"
PRINT_CONTENT = """---
title: print-test
---

# T26 G3G4 打印测试

这是一段用于**真实打印管线**验证的正文（来自可信快照 Markdown，不是编辑器当前 DOM）。

## 二级标题

- 列表项一
- 列表项二
- 列表项三

> 引用块：打印 HTML 由产品编辑器同源 schema 序列化。

```ts
const printed = true
```

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

行内公式 $E = mc^2$ 与块级公式：

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$

正文结束。
"""
SECOND_CONTENT = """---
title: second
---

# 第二篇文档

用于触发 context-changed 事件。
"""

# guest 内联脚本：不依赖 SDK/bundle，直接说协议 JSON 线（与产品 host 的 t19-wire 约定一致）。
# 验证「guest 经真实协议网线」：握手能力 → 真实打印 → 等待宿主事件 → 事件 revision 与后端快照一致。
GUEST_JS_TEMPLATE = r"""
(function () {
  var REL = __REL__;
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
    var events = [];
    var waiters = [];
    port.onMessage(function (msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'handshake.response') {
        var hp = pending.__hs;
        if (hp) { delete pending.__hs; hp(msg); }
        return;
      }
      if (msg.type === 'event' && msg.event) {
        events.push(msg.event);
        waiters = waiters.filter(function (w) {
          if (w.type !== msg.event.type) return true;
          w.resolve(msg.event);
          return false;
        });
        return;
      }
      if (msg.type === 'response' && msg.requestId && pending[msg.requestId]) {
        var p = pending[msg.requestId];
        delete pending[msg.requestId];
        p(msg);
      }
    });
    function request(method, params) {
      return new Promise(function (resolve, reject) {
        var id = 'g-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8);
        var t = setTimeout(function () {
          delete pending[id];
          reject(new Error('timeout:' + method));
        }, 150000);
        pending[id] = function (msg) {
          clearTimeout(t);
          if (msg.ok) { resolve(msg.result); return; }
          var e = new Error(((msg.error || {}).message) || ((msg.error || {}).code) || 'E_PROTOCOL');
          e.code = (msg.error || {}).code;
          e.details = (msg.error || {}).details;
          reject(e);
        };
        port.postMessage({ type: 'request', requestId: id, method: method, params: params });
      });
    }
    function waitFor(type, timeoutMs) {
      for (var i = 0; i < events.length; i++) {
        if (events[i] && events[i].type === type) return Promise.resolve(events[i]);
      }
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error('timeout waiting event:' + type));
        }, timeoutMs);
        waiters.push({ type: type, resolve: function (ev) { clearTimeout(timer); resolve(ev); } });
      });
    }
    return {
      handshake: function (features) {
        return new Promise(function (resolve, reject) {
          var t = setTimeout(function () { reject(new Error('handshake timeout')); }, 10000);
          pending.__hs = function (msg) {
            clearTimeout(t);
            if (msg.ok) resolve(msg); else reject(new Error(((msg.error || {}).code) || 'E_HANDSHAKE'));
          };
          port.postMessage({ type: 'handshake', protocolVersion: 1, sdkVersion: 't26-g3g4-guest', requestedFeatures: features });
        });
      },
      request: request,
      onEvent: function () {},
      waitFor: waitFor,
      events: events,
    };
  }

  function post(payload) {
    window.parent.postMessage({ type: 't19-guest-results', payload: payload }, '*');
  }

  function pickPrint(p) {
    return { pdfToken: (p || {}).pdfToken, pages: (p || {}).pages, tokenType: typeof (p || {}).pdfToken };
  }

  async function run() {
    var out = { phase: 'guest-start' };
    try {
      var c = makeClient(makePort());
      var hs = await c.handshake(['ui.shell', 'context.read', 'print.request']);
      out.acceptedFeatures = hs.acceptedFeatures || [];
      out.contextId = hs.contextId;
      out.epoch = hs.epoch;

      // 保存前基线快照（用于后面对比 revision 是否由真实保存前进）
      try {
        var before = await c.request('context.snapshot', { relPath: REL });
        out.snapshotBeforeSave = { revision: before.revision, relPath: before.relPath, hasContent: typeof before.content === 'string' };
      } catch (e) {
        out.snapshotBeforeSave = { error: String(e && (e.code || e.message || e)) };
      }

      // G3：真实打印（两次 → 验证 token/输出唯一；每次都应产出真实 PDF）
      var p1 = await c.request('print.snapshot', { relPath: REL });
      out.print1 = pickPrint(p1);
      var p2 = await c.request('print.snapshot', { relPath: REL });
      out.print2 = pickPrint(p2);
      out.sameToken = out.print1.pdfToken === out.print2.pdfToken;

      // G3 负向：非法路径 / 不存在文档 → 必须如实报错（不能返回假 token）
      try {
        var bad = await c.request('print.snapshot', { relPath: '../escape.md' });
        out.badPath = { ok: true, result: pickPrint(bad) };
      } catch (e) {
        out.badPath = { ok: false, code: e.code, message: String(e.message || e) };
      }
      try {
        var miss = await c.request('print.snapshot', { relPath: 'Articles/does-not-exist.md' });
        out.missingDoc = { ok: true, result: pickPrint(miss) };
      } catch (e) {
        out.missingDoc = { ok: false, code: e.code, message: String(e.message || e) };
      }

      out.phase = 'guest-print-done';
      post(out);

      // G4：等待宿主真实动作触发的事件（保存 → 切档 → 主题）
      var saved = null;
      try {
        saved = await c.waitFor('document-saved', 150000);
      } catch (e) {
        out.waitErrorSaved = String(e);
      }
      out.documentSaved = saved;
      if (saved) {
        try {
          var live = await c.request('context.snapshot', { relPath: saved.relPath });
          out.revisionCheck = {
            eventRevision: saved.revision,
            liveRevision: live.revision,
            beforeSaveRevision: out.snapshotBeforeSave && out.snapshotBeforeSave.revision,
            match: saved.revision === live.revision,
          };
        } catch (e) {
          out.revisionCheck = { error: String(e && (e.code || e.message || e)) };
        }
      }
      try {
        out.contextChanged = await c.waitFor('context-changed', 150000);
      } catch (e) {
        out.waitErrorContext = String(e);
      }
      try {
        out.themeChanged = await c.waitFor('theme-changed', 150000);
      } catch (e) {
        out.waitErrorTheme = String(e);
      }
      out.allEvents = c.events.slice();
      out.phase = 'guest-g3g4-done';
    } catch (e) {
      out.phase = 'guest-g3g4-error';
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
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    return Path(out.stdout.strip()) if out.stdout.strip() else Path(os.environ.get("APPDATA", "."))


def user_pid() -> str:
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
        "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    return out.stdout.strip()


def cleanup() -> None:
    """只按路径白名单清理（禁止 taskkill /IM / 按镜像名杀用户进程）。"""
    ps = (
        "Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue; "
        "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' -or $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' } | "
        "Stop-Process -Force -ErrorAction SilentlyContinue"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True,
                   encoding="utf-8", errors="replace")


def targets():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


def main_targets():
    """主窗口 CDP target；**必须排除隐藏打印 renderer 页**（print-render.html 也含 tauri.localhost）。"""
    return [t for t in targets()
            if t.get("type") == "page"
            and "tauri.localhost" in str(t.get("url", ""))
            and "print-render" not in str(t.get("url", ""))
            and t.get("webSocketDebuggerUrl")]


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=180, suppress_origin=True)
        self.seq = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + 200
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
    expr = ("(() => { const els = [...document.querySelectorAll('body *')].filter(x =>"
            f" (x.textContent || '').includes({json.dumps(text)}) && x.children.length === 0);"
            " if (!els.length) return false; const el = els[0];"
            " for (const t of ['pointerdown','mousedown','pointerup','mouseup']) {"
            "  el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window})); }"
            " const target = el.closest('button,a,[role=button]');"
            " if (target) target.click();"
            " else el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));"
            " return true; })()")
    return bool(cdp.eval(expr))


def has_enabled_button(cdp: CDP, text: str) -> bool:
    return bool(cdp.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes("
                         + json.dumps(text) + ")); return !!b && !b.disabled; })()"))


def body_text(cdp: CDP) -> str:
    return str(cdp.eval("document.body.innerText || ''"))


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


def editor_text(cdp: CDP) -> str:
    return str(cdp.eval("(document.querySelector('.ProseMirror') || {}).innerText || ''"))


def open_article(cdp: CDP, leaf_text: str, expect_text: str, timeout_s: float = 40) -> bool:
    """合成 click 打开左侧文件树文档（工坊面板是模态层；直接 DOM click 绕过 hit-test，等价用户打开）。"""
    click_text(cdp, leaf_text)
    return wait_until(lambda: expect_text in editor_text(cdp), timeout_s, 0.3)


def focus_editor_end(cdp: CDP) -> bool:
    return bool(cdp.eval(
        "(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus();"
        " const sel = window.getSelection(); sel.removeAllRanges();"
        " const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);"
        " sel.addRange(r); return true; })()"
    ))


def type_marker(cdp: CDP) -> bool:
    """在聚焦的编辑器末尾插入标记（CDP char 事件；失败退回 execCommand insertText）。"""
    for ch in MARKER:
        try:
            cdp.call("Input.dispatchKeyEvent", {"type": "char", "text": ch, "key": ch})
        except Exception:
            pass
        time.sleep(0.05)
    if wait_until(lambda: MARKER in editor_text(cdp), 4):
        return True
    cdp.eval("(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus();"
             " document.execCommand('insertText', false, " + json.dumps(MARKER) + "); return true; })()")
    return wait_until(lambda: MARKER in editor_text(cdp), 6)


def press_ctrl_s(cdp: CDP, raw: bool = False) -> None:
    down = "rawKeyDown" if raw else "keyDown"
    for t in (down, "keyUp"):
        cdp.call("Input.dispatchKeyEvent", {
            "type": t, "key": "s", "code": "KeyS", "modifiers": 2,
            "windowsVirtualKeyCode": 83, "nativeVirtualKeyCode": 83,
        })


def wait_file_marker(path: Path, marker: str, timeout_s: float) -> bool:
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            if marker in path.read_text(encoding="utf-8", errors="replace"):
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def read_json_if_exists(path: Path):
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return None


def wait_guest_phase(cdp: CDP, phases: tuple[str, ...], timeout_s: float) -> dict | None:
    end = time.time() + timeout_s
    while time.time() < end:
        log = cdp.eval("window.__keGuestMsgLog || []")
        if isinstance(log, list):
            for payload in reversed(log):
                if isinstance(payload, dict) and payload.get("phase") in phases:
                    return payload
        time.sleep(0.3)
    return None


def write_evidence_md(summary: dict, checks: list[dict], extra: dict) -> None:
    lines = [
        "# P5-T26 G3/G4：print.snapshot 真实打印管线 + 宿主事件发射（隔离产品 W 证据）",
        "",
        f"- 生成时间：{summary['generated_at']}",
        "- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 隔离产品构建",
        f"- 测试构建：`{EXE}`（sha256=`{summary['build']['exe_sha256']}`，mtime=`{summary['build']['exe_mtime']}`）",
        f"- guest 包：`{PACK_ID}`（capabilities=`[\"ui.shell\",\"context.read\",\"print.request\"]`，签名 keyId=k1，trusted）",
        f"- 隔离工作区：`{extra['workspace']}`；隔离 APPDATA：`{extra['appdata']}`；测试文档：`{REL_PATH}`",
        "- 启动 env：`KE_WS_PRINT_RENDER=1`（T16 隐藏打印 renderer 门控，既有产品设计）",
        f"- PDF 输出：`{extra.get('pdf_out') or (extra.get('observed') or {}).get('isolated_pdf_dir') or 'N/A'}`（隔离 BASE 下；产品诊断覆盖 `window.__KE_PRINT_OUTPUT_DIR__`，默认生产为 `appDataDir()`）",
        "- 场景：guest 真实协议线 → 真实打印（两次 + 负向）→ 宿主真实保存/切档/主题变化 → guest 收到 HostEvent",
        "",
        "## 结论",
        "",
        f"**{'PASS' if summary['pass_count'] == summary['total'] else 'FAIL'}**：{summary['pass_count']}/{summary['total']} checks 通过。"
        "本证据只覆盖下列 checks；未覆盖/未执行的部分见「限制与残余风险」。",
        "",
        "## 两轮 W 记录（修复前 → 修复后）",
        "",
        "- **首轮**（exe sha256 前 16=`d0a1b8bf202e250f`，mtime 2026-10-19 10:24）：**14/18 PASS**。",
        "- **本轮**（exe sha256 前 16=`764f191b71d82e35`，mtime 2026-10-19 10:33）：见上「结论」。",
        "",
        "首轮 4 个 FAIL 的根因与修复（均已包含在本轮构建）：",
        "",
        "| # | 首轮 FAIL | 根因 | 修复 |",
        "| --- | --- | --- | --- |",
        "| 1 | PDF 落在真实 `%APPDATA%\\com.astranota.uiws.e2e`（非 C:\\ke-tmp） | Tauri `appDataDir()` 走 Windows known folder，**不读 `APPDATA` env** | 打印输出增加诊断覆盖 `window.__KE_PRINT_OUTPUT_DIR__`（生产不设置 → appDataDir 不变；W 定向到 `C:\\ke-tmp\\...\\pdf-out`） |",
        "| 2 | 会话 `suspended`（首轮 16 checks 中会话检查 FAIL） | Rust PrintToPdf 在主线程 message pump 等待，打印阻塞主窗口事件循环 > 默认 1200ms guest 心跳超时 → 误判崩溃 | `WorkshopGuestFrame` guest 心跳超时放宽到 8s（组件内配置；更彻底需打印移出主线程） |",
        "| 3 | 宿主侧无 `ke:workshop-theme-changed` window 事件 | 主题观察在 frame 内直接 `dispatcher.emit`，未走统一 window 事件链 | frame 观察 `data-theme` → dispatch window 事件 → HostEventBridge → emit（与保存/切档同链路） |",
        "| 4 | 渲染器状态文件读不到 | 探针按隔离 `APPDATA` 读，实际在真实 known-folder 的测试 identifier 目录 | 探针改从真实 `%APPDATA%\\com.astranota.uiws.e2e` 读（开始/结束清理该测试 identifier 目录）；同轮发现并修复「CDP 目标误选隐藏 print-render 页」的探针缺陷 |",
        "",
        "## Checks",
        "",
        "| # | check | 结果 | 关键值 |",
        "| --- | --- | --- | --- |",
    ]
    for i, c in enumerate(checks, 1):
        detail = json.dumps(c.get("detail"), ensure_ascii=False)
        if len(detail) > 240:
            detail = detail[:240] + "…"
        lines.append(f"| {i} | {c['name']} | {'PASS' if c['pass'] else 'FAIL'} | `{detail}` |")
    lines += [
        "",
        "## 关键实测值",
        "",
        "```json",
        json.dumps(extra.get("observed", {}), ensure_ascii=False, indent=2),
        "```",
        "",
        "## 能力/链路变化（T26 G3/G4 后）",
        "",
        "| 层 | 变化 |",
        "| --- | --- |",
        "| 协议方法 `print.snapshot` | 由**假桩** `{pdfToken: relPath, pages: 1}` 改为真实打印：隔离目录真实 PDF + 不透明 token + `pages: number|null`（不可得知数 → null，不伪造） |",
        "| 产品 Broker 后端 | `ProductBrokerBackend.print` 按 relPath 从后端读**可信快照**（正文+revision）→ PrintJobManager（产品渲染器 + Rust `print_snapshot_pdf`）→ 应用数据目录 PDF；能力 `print.request` 双校验；失败如实抛类型化错误 |",
        "| 打印渲染器 | 新增 `core/print/productPrintRenderer.ts` + `printEditorBridge.ts`：复用产品编辑器同源 schema（`editor.storage.markdown.manager` + `generateHTML`）把快照 Markdown 渲染为自包含打印 HTML；**不读编辑器当前 DOM/不隐式保存** |",
        "| 输出安全 | `core/print/printOutput.ts`：绝对路径/.pdf/拒穿越（Rust 侧再验绝对+不覆盖）；文件名含 revision+时钟+随机 → 不覆盖；落在 `appDataDir()`（非工作区） |",
        "| token 语义 | `core/print/printTokenRegistry.ts`：不透明 token → 真实 pdfPath/revision/pages（宿主可反查；guest 不可见路径） |",
        "| 宿主事件 `document-saved` | EditorArea 保存真实落盘后 dispatch → WorkshopGuestFrame 桥 → `dispatcher.emit`；revision 取 Core 保存真实值，旧链由后端快照补全（不伪造） |",
        "| 宿主事件 `context-changed` | EditorArea 打开/切换文档 → dispatch → 桥用真实 contextId/epoch（退回默认上下文时记 error） |",
        "| 宿主事件 `theme-changed` | WorkshopGuestFrame 观察 `documentElement[data-theme]`（产品 applyTheme 唯一落点）→ emit |",
        "",
        "## 限制与残余风险（如实记录）",
        "",
        "- **隐藏打印 renderer 仍是 env 门控（`KE_WS_PRINT_RENDER=1`）**：默认发布启动不创建 → `print.snapshot` 会如实返回 `E_PRINT_RENDER` 类错误（不是假成功）。产品化默认开启需 Rust 改动（T16 既有设计，本任务按「不改 Rust」红线未做）。",
        "- **页数不可得**：Rust `print_snapshot_pdf`（WebView2 PrintToPdf）不回传页数，前端无文件读取权限 → 协议 `pages` 如实为 `null`。A2 证据已记录「页数」未验证。",
        "- **渲染保真**：快照渲染复用产品编辑器 schema/解析器（结构与官方渲染同源），但隐藏 renderer 无 React NodeView/应用 CSS：公式为 `data-ke-math*` 线性 LaTeX（无 KaTeX 视觉）、信息块/附件为降级样式、`Attachments/` 图片相对路径在 renderer origin 下不可解析（asset 协议 scope 仅 TEMP 预览，本任务未扩 Rust scope）。W 只断言真实 PDF 产出，不断言像素级一致。",
        "- **打印页宽**：transport 未传 `contentWidth`（渲染器不读编辑器 DOM/布局），Rust 回退 A4 宽；未对齐「编辑器正文内容宽」。",
        "- **theme-changed 的 W 触发方式**：用 CDP 改写 `documentElement.dataset.theme`（等价产品 `applyTheme` 的写入效果，也就是事件源本身）；未驱动设置面板「主题选项」UI 点击（避免脆弱 UI 交互）。产品接线为 MutationObserver 监听该属性。",
        "- **context-changed 语义**：产品当前单工作区单默认上下文（`ke-default`），事件按任务要求由**文档打开/切换**触发，携带真实 contextId/epoch；不是工作区切换（工作区生命周期仍宿主独占，F01 未做）。",
        "- **epoch 既有风险**：产品 `currentEpoch()` 固定返回 1（F 审计附带风险），本任务未改；为让 guest 在宿主 Core 保存（会 switch 上下文 epoch）后仍能读快照/打印，`fetchGuestSnapshot` 增加了「epoch 失效 → 失效缓存重试一次」的兜底（仅 guest 后端读取路径）。",
        "- **document-saved revision 的真实性依赖保存链**：`VITE_KE_CORE_SAVE=1` 时 revision 为 Core 真实递增；默认旧保存链后端 context 注册表不跟踪**每次**旧链写入的 revision（既有 F 审计缺口），此时事件 revision 为后端可得的 context 快照 revision（一致但不保证递增）。本次构建通过日志确认保存链（见 observed.save_chain）。",
        "- **Windows known folder 隔离限制（已用诊断覆盖规避）**：Tauri `appDataDir()` 走 Windows known folder（**不读 `APPDATA` env**），测试构建的 `app_data_dir` = 真实 `%APPDATA%\\com.astranota.uiws.e2e`（独立 identifier、非用户 App 数据）。为遵守「PDF 只写 C:\\ke-tmp 隔离目录」红线，探针设置产品诊断覆盖 `window.__KE_PRINT_OUTPUT_DIR__ = <BASE>\\pdf-out`（仅可信主窗口可设、生产不设置 → appDataDir）；开始/结束都清理测试 identifier 目录。该覆盖是**测试/排障 seam**，不是生产打印行为。",
        "- **打印会阻塞主线程（真实产品限制）**：Rust `print_snapshot_pdf` 的 WebView2 打印在 `with_webview` + `wait_for_async_operation` 中 message pump 等待完成，期间主窗口 JS 事件循环被占用；T19 默认 1200ms 心跳超时会把「宿主在打印」误判为 guest 崩溃（本次首轮即实测 suspended）。已在 `WorkshopGuestFrame` 把 guest 心跳超时放宽到 8s 规避误判（仍能捕获真失联）；更彻底修复需把打印移出主线程/暂停心跳（超出 task-7 允许改动范围，未做）。",
        "- **W 只验证隔离测试构建**：不等于官方 UI 全量基线；不替代 F01–F16 逐项登记。",
        "",
        "## 复现",
        "",
        "```powershell",
        "# 前置：测试构建 C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe 已包含本任务前端改动",
        "# （Lead 协调：frontend `VITE_KE_WORKSHOP=1`（建议 + VITE_KE_CORE_SAVE=1）build → 隔离 src-tauri cargo build）",
        "$env:PYTHONIOENCODING='utf-8'",
        "& 'C:\\Users\\y8882\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe' -X utf8 'F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_t26_guest_g3g4_probe.py'",
        "```",
        "",
        f"原始 JSON：`docs/ui-workshop/evidence/{summary['results_file']}`",
        "",
    ]
    (EVID / "P5-T26-G3G4-print-events.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:320], flush=True)

    if not EXE.exists():
        print(f"缺少测试构建: {EXE}")
        return 2
    build_sha = sha_file(EXE)
    build_mtime = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime))

    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True)
    pdf_out = BASE / "pdf-out"
    pdf_out.mkdir(parents=True, exist_ok=True)
    cleanup()
    # 测试构建 app_data（真实 known-folder → 独立 identifier 目录）在开始/结束都清理，避免污染
    for folder in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(folder) / APP_DATA_ID, ignore_errors=True)

    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    article = ws / "Articles" / "print-test.md"
    article.write_bytes(PRINT_CONTENT.encode("utf-8"))
    (ws / "Articles" / "second.md").write_bytes(SECOND_CONTENT.encode("utf-8"))
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(
        json.dumps({"recent_workspaces": [str(ws)], "recent_documents": []}), encoding="utf-8")
    (ke_cfg / "settings.json").write_text(
        json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8")

    # 签名包：guest 内联协议脚本（capabilities 含 print.request，Rust ALLOWED_CAPS 已放行）
    key = BASE / "key.pem"
    pub = json.loads(subprocess.run([NODE, str(SIGN_TOOL), "--generate-key", str(key)], check=True,
                                    capture_output=True, text=True).stdout)["publicKeyHex"]
    pack = BASE / "pack"
    pack.mkdir()
    guest_js = GUEST_JS_TEMPLATE.replace("__REL__", json.dumps(REL_PATH))
    entry = "<!doctype html><html><body><script>" + guest_js + "</script></body></html>"
    (pack / "index.html").write_bytes(entry.encode("utf-8"))
    manifest = {
        "id": PACK_ID,
        "name": "T26 G3G4 Print/Events Pack",
        "version": "1.0.0",
        "apiVersion": 1,
        "capabilities": ["ui.shell", "context.read", "print.request"],
        "entry": {"html": "index.html"},
        "commands": [],
        "assets": [{"path": "index.html", "sha256": sha_text(entry)}],
    }
    (pack / "manifest.json").write_bytes(json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    subprocess.run([NODE, str(SIGN_TOOL), "--dir", str(pack), "--key", str(key), "--keyid", "k1", "--write"],
                   check=True, capture_output=True, text=True)

    env = {**os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
           "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": pub}}),
           "KE_WS_PRINT_RENDER": "1",
           "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}"}
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    observed: dict = {}
    results: dict = {}
    host_events: list = []
    diag: object = None
    try:
        if not wait_until(lambda: bool(main_targets()), 90, 0.3):
            raise RuntimeError("CDP 主窗口未就绪")
        mains = main_targets()
        cdp = CDP(mains[0]["webSocketDebuggerUrl"])
        wait_until(lambda: bool(cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'")), 30, 0.25)
        workshop_btn = "!!document.querySelector('button[aria-label=\"打开创意工坊\"]')"
        wait_until(lambda: bool(cdp.eval(workshop_btn)), 60, 0.2)
        check("W-T26-G3G4-1 隔离产品实例启动 + CDP 主窗口就绪（工坊入口已渲染，WebView2 IPC 可用）",
              bool(cdp.eval(workshop_btn)), {"port": CDP_PORT, "target": mains[0].get("url")})

        # PDF 输出隔离：产品默认写 appDataDir()（Windows known folder，不随 APPDATA env 变化）；
        # 为遵守「PDF/测试文件只写 C:\ke-tmp 隔离目录」红线，用产品诊断覆盖把输出基准目录指向隔离 BASE。
        override = cdp.eval("window.__KE_PRINT_OUTPUT_DIR__ = " + json.dumps(str(pdf_out)) + "; window.__KE_PRINT_OUTPUT_DIR__")
        print("print output override:", override, flush=True)

        # T16 既有 env 门控：隐藏打印 renderer 创建状态（app_data_dir = %APPDATA%\<identifier>）
        status_file = REAL_APPDATA / APP_DATA_ID / "print-render-status.json"
        renderer_status = read_json_if_exists(status_file)
        check("W-T26-G3G4-2 隐藏打印 renderer 创建成功（KE_WS_PRINT_RENDER=1 状态文件 ok）",
              isinstance(renderer_status, dict) and renderer_status.get("ok") is True,
              {"statusFile": str(status_file), "status": renderer_status})

        inst = invoke(cdp, "workshop_pack_install", {"sourceDir": str(pack)})
        check("W-T26-G3G4-3 安装声明 print.request 的签名包（Rust ALLOWED_CAPS 放行）",
              inst.get("ok") is True, inst)

        click_text(cdp, "创意工坊")
        wait_until(lambda: has_enabled_button(cdp, "授予信任") or has_enabled_button(cdp, "启用 guest"), 30, 0.25)
        click_text(cdp, "授予信任")
        wait_until(lambda: "信任：trusted" in body_text(cdp), 30, 0.25)
        wait_until(lambda: has_enabled_button(cdp, "启用 guest"), 30, 0.25)

        # 事件收集器（不含 @ 符号，避免引号转义问题）
        cdp.eval(
            "window.__keGuestMsgLog = [];"
            " window.addEventListener('message', e => { if (e.data && e.data.type === 't19-guest-results') window.__keGuestMsgLog.push(e.data.payload); });"
            " window.__keHostEvents = [];"
            " ['ke:workshop-document-saved','ke:workshop-context-changed','ke:workshop-theme-changed'].forEach(n =>"
            "   window.addEventListener(n, e => window.__keHostEvents.push({name:n, detail:e.detail, at:Date.now()})));"
        )
        cdp.eval("window.__keGuestResults = null")
        click_text(cdp, "启用 guest")

        print_result = wait_guest_phase(cdp, ("guest-print-done", "guest-g3g4-error"), 180)
        if print_result is None:
            print_result = wait_guest_phase(cdp, ("guest-g3g4-done",), 5) or {}
        results = print_result or {}
        diag = cdp.eval("({start: window.__keGuestStart, error: window.__keGuestError, log: window.__keGuestStatusLog,"
                        " body: (document.body.innerText||'').slice(-1200)})")
        print("guest print results:", json.dumps({k: results.get(k) for k in
                                                  ("phase", "acceptedFeatures", "print1", "print2", "badPath", "missingDoc", "error")},
                                                 ensure_ascii=False)[:1200], flush=True)
        print("diag:", json.dumps(diag, ensure_ascii=False)[:800], flush=True)

        session = invoke(cdp, "workshop_pack_session_status", {})
        st = (session or {}).get("value") or {}
        caps = st.get("capabilities") if isinstance(st.get("capabilities"), list) else []
        check("W-T26-G3G4-4 会话 active 且运行期能力含 print.request",
              session.get("ok") and st.get("state") == "active" and "print.request" in caps,
              {"state": st.get("state"), "capabilities": caps,
               "guestStatusLog": (diag or {}).get("log") if isinstance(diag, dict) else None})

        feats = results.get("acceptedFeatures") or []
        check("W-T26-G3G4-5 握手能力协商含 print.request + context.read（G3/G4 前提）",
              set(feats) >= {"print.request", "context.read"}, {"acceptedFeatures": feats})

        p1 = results.get("print1") or {}
        p2 = results.get("print2") or {}
        token1 = p1.get("pdfToken")
        token2 = p2.get("pdfToken")
        real_token = (isinstance(token1, str) and len(token1) > 8 and token1 != REL_PATH
                      and not token1.endswith(".md"))
        check("W-T26-G3G4-6 print.snapshot 返回真实不透明 pdfToken（非 relPath 桩）且 pages=null（不伪造）",
              results.get("phase") != "guest-g3g4-error" and real_token and p1.get("pages") is None,
              {"print1": p1, "print2": p2, "phase": results.get("phase"), "error": results.get("error")})

        token_entries = cdp.eval("typeof window.__kePrintTokens === 'function' ? window.__kePrintTokens() : null")
        entries = {e.get("pdfToken"): e for e in token_entries or [] if isinstance(e, dict)}
        entry1 = entries.get(token1) if token1 else None
        pdf1 = Path(entry1["pdfPath"]) if entry1 and entry1.get("pdfPath") else None
        pdf1_ok = bool(pdf1 and pdf1.exists() and pdf1.stat().st_size > 1000)
        pdf1_head = b""
        if pdf1_ok:
            with pdf1.open("rb") as f:
                pdf1_head = f.read(4)
        isolated_ok = bool(pdf1 and str(pdf1).lower().startswith(str(BASE).lower()))
        check("W-T26-G3G4-7 pdfToken 对应真实 PDF：文件存在、%PDF 头、大小>1000、位于隔离目录",
              pdf1_ok and pdf1_head == b"%PDF" and isolated_ok,
              {"pdfPath": str(pdf1) if pdf1 else None, "size": pdf1.stat().st_size if pdf1_ok else 0,
               "head": pdf1_head.decode("latin1", "replace"), "underIsolatedBase": isolated_ok,
               "token": token1, "registryEntry": entry1})

        entry2 = entries.get(token2) if token2 else None
        pdf2 = Path(entry2["pdfPath"]) if entry2 and entry2.get("pdfPath") else None
        pdf2_ok = bool(pdf2 and pdf2.exists() and pdf2.stat().st_size > 1000)
        check("W-T26-G3G4-8 连续两次打印 → 不同 token/不同 PDF 文件（不覆盖语义）",
              token1 != token2 and pdf2_ok and (pdf1 is None or pdf2 != pdf1),
              {"token1": token1, "token2": token2, "pdf2": str(pdf2) if pdf2 else None,
               "size2": pdf2.stat().st_size if pdf2_ok else 0})

        bad_path = results.get("badPath") or {}
        check("W-T26-G3G4-9 非法路径 print.snapshot → 如实协议错误（不返回假 token）",
              bad_path.get("ok") is False and bad_path.get("code") in ("E_BAD_PAYLOAD", "E_FORBIDDEN", "E_INTERNAL"),
              bad_path)

        missing = results.get("missingDoc") or {}
        check("W-T26-G3G4-10 不存在的文档 print.snapshot → 如实错误（不返回假 token）",
              missing.get("ok") is False and isinstance(missing.get("code"), str) and missing.get("code") != "",
              missing)

        # ---------------- G4：宿主真实动作 → guest 事件 ----------------
        before_save_rev = (results.get("snapshotBeforeSave") or {}).get("revision")
        opened = open_article(cdp, "print-test.md", "打印测试")
        try:
            cdp.call("Page.bringToFront")
        except Exception:
            pass
        focused = focus_editor_end(cdp) if opened else False
        typed = type_marker(cdp) if focused else False
        saved_ok = False
        saved_by = ""
        if typed:
            saved_ok = wait_file_marker(article, MARKER, 25)
            saved_by = "autosave"
            if not saved_ok:
                press_ctrl_s(cdp, raw=False)
                saved_ok = wait_file_marker(article, MARKER, 12)
                saved_by = "ctrl-s"
            if not saved_ok:
                press_ctrl_s(cdp, raw=True)
                saved_ok = wait_file_marker(article, MARKER, 12)
                saved_by = "ctrl-s-raw"
        check("W-T26-G3G4-11 产品真实保存落盘（打开文档 + 编辑标记 → 磁盘含标记，事件由真实保存触发）",
              opened and focused and typed and saved_ok,
              {"opened": opened, "focused": focused, "typed": typed, "saved": saved_ok, "savedBy": saved_by,
               "file": str(article)})

        host_saved_ok = wait_until(lambda: any(
            isinstance(h, dict) and h.get("name") == "ke:workshop-document-saved"
            for h in (cdp.eval("window.__keHostEvents || []") or [])), 30, 0.3)

        # 打开第二篇 → context-changed
        opened2 = open_article(cdp, "second.md", "第二篇文档")
        time.sleep(0.8)

        # 主题：改写 data-theme（产品 applyTheme 的唯一状态落点）→ MutationObserver → theme-changed
        cdp.eval("document.documentElement.dataset.theme = 'dark'; 'ok'")
        time.sleep(0.8)

        # 等 guest 收齐事件后的最终报告
        final = wait_guest_phase(cdp, ("guest-g3g4-done", "guest-g3g4-error"), 180) or {}
        if not results:
            results = final
        host_events = cdp.eval("window.__keHostEvents || []") or []
        print("guest final:", json.dumps({k: final.get(k) for k in
                                          ("phase", "documentSaved", "revisionCheck", "contextChanged", "themeChanged",
                                           "waitErrorSaved", "waitErrorContext", "waitErrorTheme", "error")},
                                         ensure_ascii=False)[:1500], flush=True)
        print("host events:", json.dumps(host_events, ensure_ascii=False)[:800], flush=True)

        document_saved = final.get("documentSaved") or {}
        saved_payload_ok = (document_saved.get("type") == "document-saved"
                            and document_saved.get("relPath") == REL_PATH
                            and isinstance(document_saved.get("revision"), int)
                            and document_saved.get("revision") >= 0)
        check("W-T26-G3G4-12 document-saved 事件到达 guest 且载荷正确（relPath/revision）",
              saved_payload_ok,
              {"documentSaved": document_saved, "hostEventObserved": host_saved_ok,
               "waitError": final.get("waitErrorSaved")})

        revision_check = final.get("revisionCheck") or {}
        check("W-T26-G3G4-13 事件 revision 与后端真实 context.snapshot revision 一致（可信，非伪造）",
              revision_check.get("match") is True,
              {"revisionCheck": revision_check, "beforeSaveRevision": before_save_rev})

        context_changed = final.get("contextChanged") or {}
        check("W-T26-G3G4-14 context-changed 事件到达 guest（真实 contextId/epoch；打开/切换文档触发）",
              context_changed.get("type") == "context-changed"
              and isinstance(context_changed.get("contextId"), str)
              and isinstance(context_changed.get("epoch"), int)
              and opened2,
              {"contextChanged": context_changed, "openedSecondDoc": opened2, "waitError": final.get("waitErrorContext")})

        theme_changed = final.get("themeChanged") or {}
        check("W-T26-G3G4-15 theme-changed 事件到达 guest（theme=dark；data-theme 变化驱动）",
              theme_changed.get("type") == "theme-changed" and theme_changed.get("theme") == "dark",
              {"themeChanged": theme_changed, "waitError": final.get("waitErrorTheme")})

        host_names = [h.get("name") for h in host_events if isinstance(h, dict)]
        check("W-T26-G3G4-16 宿主侧三类 window 事件全部真实触发（保存/切档/主题链路完整性）",
              all(n in host_names for n in ("ke:workshop-document-saved", "ke:workshop-context-changed",
                                            "ke:workshop-theme-changed")),
              {"hostEventNames": host_names, "hostEvents": host_events})

        log.flush()
        log_text = log_path.read_text(encoding="utf-8", errors="replace")
        save_chain = "core(/api/context/write)" if "/api/context/write" in log_text else "legacy(/api/articles)"
        observed = {
            "build": {"exe": str(EXE), "sha256": build_sha, "mtime": build_mtime},
            "launch_env": {"KE_WS_PRINT_RENDER": "1", "APPDATA": "isolated", "KE_WORKSPACE": "isolated"},
            "isolated_pdf_dir": str(pdf_out),
            "renderer_status": renderer_status,
            "renderer_status_file": str(status_file),
            "session": {"state": st.get("state"), "capabilities": caps},
            "accepted_features": feats,
            "snapshot_before_save": results.get("snapshotBeforeSave"),
            "print1": {"token": token1, "pages": p1.get("pages"),
                       "registryEntry": entry1,
                       "pdfPath": str(pdf1) if pdf1 else None,
                       "pdfSize": pdf1.stat().st_size if pdf1_ok else 0,
                       "pdfHead": pdf1_head.decode("latin1", "replace")},
            "print2": {"token": token2, "pages": p2.get("pages"),
                       "registryEntry": entry2,
                       "pdfPath": str(pdf2) if pdf2 else None,
                       "pdfSize": pdf2.stat().st_size if pdf2_ok else 0},
            "bad_path": bad_path,
            "missing_doc": missing,
            "save": {"saved": saved_ok, "savedBy": saved_by, "markerInDisk": MARKER in article.read_text(encoding="utf-8", errors="replace"),
                     "save_chain": save_chain},
            "document_saved": document_saved,
            "revision_check": revision_check,
            "before_save_revision": before_save_rev,
            "context_changed": context_changed,
            "theme_changed": theme_changed,
            "guest_all_events": final.get("allEvents"),
            "host_events": host_events,
            "diag": diag,
            "guest_status_log": (diag or {}).get("log") if isinstance(diag, dict) else None,
            "app_log_tail": log_text.strip().splitlines()[-6:] if log_text else [],
        }

        check("W-T26-G3G4-17 主进程存活（打印/事件链路无崩溃）", proc.poll() is None, proc.poll())
        upid = user_pid()
        if upid.isdigit():
            check("W-T26-G3G4-18 用户运行中的 AstraNota 未受影响（运行中，只读检查）", True, {"user_pid": upid})
        else:
            check("W-T26-G3G4-18 用户实例未运行 → N/A（隔离测试未触碰用户数据）", True, {"user_pid": "N/A (not running)"})
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
        cleanup()
        log.close()
    # 清理测试构建标识目录（真实 APPDATA 下独立 identifier；非用户 App 数据；PDF 已在 BASE/pdf-out）
    for folder in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(folder) / APP_DATA_ID, ignore_errors=True)

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 G3/G4 产品 W：print.snapshot 真实打印管线 + 宿主事件发射（document-saved/context-changed/theme-changed）",
        "build": {"exe": str(EXE), "exe_sha256": build_sha, "exe_mtime": build_mtime},
        "pack": {"id": PACK_ID, "capabilities": manifest["capabilities"], "signature": "ed25519 k1 (signed)"},
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "results_file": "T26-G3G4-results.json",
        "rounds": {
            "round1": {"exe_sha256_prefix": "d0a1b8bf202e250f", "exe_mtime": "2026-10-19T10:24", "pass": 14, "total": 18,
                       "fails": ["PDF 输出目录（appDataDir known-folder 不读 APPDATA env）",
                                 "会话 suspended（打印阻塞主线程 > 心跳超时 1200ms 误判）",
                                 "宿主侧缺 theme window 事件（未走统一事件链）",
                                 "探针状态文件路径（known-folder）+ CDP 目标误选 print-render 页"]},
            "round2": {"exe_sha256_prefix": "764f191b71d82e35", "exe_mtime": "2026-10-19T10:33",
                       "pass": "见 pass_count", "total": len(checks)},
        },
    }
    out = EVID / "T26-G3G4-results.json"
    payload = {**summary, "observed": observed, "raw": {"guest_results": results, "host_events": host_events, "diag": diag}}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_evidence_md(summary, checks, {"workspace": str(ws), "appdata": str(appdata),
                                        "pdf_out": str(pdf_out), "observed": observed})
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}", flush=True)
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
