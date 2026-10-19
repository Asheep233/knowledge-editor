# -*- coding: utf-8 -*-
"""P5-T26 G7 产品 W 探针：参考包 A/B（发布 SDK 形态）安装 → trusted → 启用 guest → 真实 UI 行为验证。

覆盖：
1. 用 `tools/build_reference_packs.mjs` 从仓库源构建/签名 pack A/B（临时自签密钥只在 C:\\ke-tmp）；
   独立复核 assets sha256/大小、zip 结构、`--check` 幂等；
2. 隔离产品构建（`C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe`）安装 pack A → 授予 trusted →
   启用 guest → 校验：会话 active、运行期能力 = 声明最小集、发布 SDK `autoConnect` 握手、心跳；
   经 CDP 驱动 **guest iframe 内真实 DOM**（OOPIF session）：「读取快照」展现真实正文/标题/revision、
   错误展示（不存在文档）、「打印快照」触发真实打印管线（真实 PDF）、宿主真实保存 → `document-saved`
   事件到达并自动刷新快照；停用 guest 后会话停止/iframe 卸载；
3. 同法验证 pack B：读取快照 + frontmatter 表单自动填充 + `command.invoke` 提交 title/tags
   （校验磁盘 frontmatter 真实落盘）+ 空标题错误展示；
4. 真实/如实：任何未通过项记 FAIL 并给 diag；限制（打印 renderer env 门控、SDK 无事件 API、
   guest 无当前 relPath 发现通道、测试自签密钥、隔离残余风险等）写入证据。

红线：隔离构建/APPDATA/工作区；PDF 只写 `C:\\ke-tmp` 隔离目录（产品诊断覆盖 window.__KE_PRINT_OUTPUT_DIR__）；
禁止 taskkill /IM；禁止触碰 `D:\\AstraNota` 用户实例；用户 App 未运行记 N/A；清理按路径白名单
（`C:\\ke-tmp\\uiws-t26\\bin\\*` / `F:\\Work\\Dev\\cargo-target\\*`）+ 测试构建独立 identifier
`%APPDATA%\\com.astranota.uiws.e2e`（非用户数据，既有探针惯例）。
"""
from __future__ import annotations

import hashlib
import json
import re
import os
import shutil
import subprocess
import sys
import time
import traceback
import urllib.request
import zipfile
from pathlib import Path

import websocket  # websocket-client

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE = Path(r"C:\ke-tmp\uiws-t26-g7")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACKS_SRC = REPO / "docs" / "ui-workshop" / "packs"
DIST = BASE / "dist"
BUILD_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "build_reference_packs.mjs"
SIGN_TOOL = REPO / "docs" / "ui-workshop" / "tools" / "sign_pack.mjs"
NODE = r"C:\Program Files\nodejs\node.exe"
CDP_PORT = 9790 + (os.getpid() % 80)
APP_DATA_ID = "com.astranota.uiws.e2e"
MAX_ATTEMPTS = 2

PACK_A = {
    "id": "com.astranota.examples.pack-a",
    "slug": "pack-a",
    "capabilities": ["ui.shell", "panel.sidebar", "context.read", "print.request"],
    "commands": [],
}
PACK_B = {
    "id": "com.astranota.examples.pack-b",
    "slug": "pack-b",
    "capabilities": ["ui.shell", "panel.dock", "context.read"],
    "commands": ["article.set-title", "article.set-tags"],
}
ALL_PACK_IDS = [PACK_A["id"], PACK_B["id"]]

REL_PATH = "Articles/g7-demo.md"
DOC_TITLE = "G7 参考文档"
DOC_BODY_MARK = "参考包正文：读场景与写场景。"
DOC_CONTENT = (
    "---\n"
    f"title: {DOC_TITLE}\n"
    "---\n"
    "\n"
    f"{DOC_BODY_MARK}\n"
    "\n"
    "- 侧栏阅读器展示标题与内容片段\n"
    "- Dock 表单提交 title/tags\n"
)
SAVE_MARKER = "G7-SAVE-MARKER"
FORM_TITLE = "G7 表单标题"
FORM_TAGS = "g7, probe"

GUEST_MSG_COLLECTOR = (
    "window.__keGuestMsgLog = [];"
    " window.__keHostEvents = [];"
    " window.addEventListener('message', (e) => {"
    "   const d = e.data; if (!d || typeof d !== 'object') return;"
    "   if (d.type === 't19-guest-results') window.__keGuestMsgLog.push(d.payload);"
    " });"
    " ['ke:workshop-document-saved','ke:workshop-context-changed','ke:workshop-theme-changed'].forEach((n) => {"
    "   window.addEventListener(n, (e) => window.__keHostEvents.push({ name: n, detail: e.detail, at: Date.now() }));"
    " });"
)


# ---------------- 基础工具 ----------------


def sha_text(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def sha_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def real_folder(name: str) -> Path:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", f"[Environment]::GetFolderPath('{name}')"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return Path(out.stdout.strip()) if out.stdout.strip() else Path(os.environ.get("APPDATA", "."))


def user_pid() -> str:
    out = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "(Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\AstraNota*' } | Select-Object -First 1).Id",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return out.stdout.strip()


def count_processes(image: str, path_like: str) -> int:
    ps = "@(Get-Process " + image + " -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '" + path_like + "' }).Count"
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        return int((out.stdout or "0").strip() or 0)
    except ValueError:
        return -1


def cleanup() -> None:
    """按路径白名单收尾（禁止 taskkill /IM）。"""
    ps = (
        "Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue; "
        "Get-Process knowledgeeditor-backend -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'F:\\Work\\Dev\\cargo-target\\*' -or $_.Path -like 'C:\\ke-tmp\\uiws-t26\\bin\\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def cleanup_test_identifier() -> None:
    """清理测试构建**独立 identifier** 目录（非用户 App 数据；既有探针惯例）。"""
    for folder in ("Roaming", "LocalApplicationData"):
        shutil.rmtree(real_folder(folder) / APP_DATA_ID, ignore_errors=True)


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


# ---------------- CDP（含 OOPIF guest iframe 会话） ----------------


def targets():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


def main_targets():
    """主窗口 CDP target；必须排除隐藏打印 renderer 页（print-render 页也含 tauri.localhost）。"""
    return [
        t
        for t in targets()
        if t.get("type") == "page"
        and "tauri.localhost" in str(t.get("url", "")).lower()
        and "print-render" not in str(t.get("url", "")).lower()
        and t.get("webSocketDebuggerUrl")
    ]


class CDP:
    """最小 CDP 客户端：同步 call + 后台事件收集（用于 Target.attachedToTarget 发现 OOPIF iframe）。"""

    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=120, suppress_origin=True)
        self.ws.settimeout(180)
        self.seq = 0
        self.events: list[dict] = []

    def send(self, method: str, params: dict | None = None, session_id: str | None = None) -> int:
        self.seq += 1
        msg = {"id": self.seq, "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id
        self.ws.send(json.dumps(msg))
        return self.seq

    def wait(self, mid: int, timeout: float = 180) -> dict:
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                return msg
            self.events.append(msg)
        raise TimeoutError(f"CDP timeout #{mid}")

    def call(self, method: str, params: dict | None = None, session_id: str | None = None, timeout: float = 180):
        r = self.wait(self.send(method, params, session_id), timeout)
        if "error" in r:
            raise RuntimeError(method + " -> " + json.dumps(r["error"], ensure_ascii=False))
        return r.get("result", {})

    def eval(self, expr: str, session_id: str | None = None):
        r = self.call(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True},
            session_id,
        )
        return (r.get("result") or {}).get("value")

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass


def http_json(path: str):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}{path}", timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


# 浏览器级 CDP（Target.getTargets/attachToTarget：WebView2 的 guest iframe 是独立 OOPIF target）
BROWSER: "CDP | None" = None
GUEST_ATTACHED: dict[str, dict] = {}


def browser_connect() -> "CDP | None":
    global BROWSER
    if BROWSER is not None:
        return BROWSER
    version = http_json("/json/version") or {}
    url = version.get("webSocketDebuggerUrl")
    if not url:
        return None
    BROWSER = CDP(url)
    BROWSER.call("Target.setDiscoverTargets", {"discover": True})
    return BROWSER


def main_cdp() -> CDP:
    main = main_targets()
    return CDP(main[0]["webSocketDebuggerUrl"])


def invoke(cdp: CDP, cmd: str, payload: dict) -> dict:
    expr = (
        "(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke("
        + json.dumps(cmd)
        + ", "
        + json.dumps(payload)
        + "); return {ok:true,value:r}; }"
        " catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()"
    )
    return cdp.eval(expr)  # type: ignore[return-value]


def host_eval(cdp: CDP, expr: str):
    return cdp.eval(expr)


def body_text(cdp: CDP) -> str:
    return str(cdp.eval("document.body.innerText || ''") or "")


def click_dom(cdp: CDP, selector_js: str) -> bool:
    return bool(cdp.eval(f"(() => {{ const el = {selector_js}; if (!el) return false; el.click(); return true; }})()"))


def click_text(cdp: CDP, text: str) -> bool:
    expr = (
        "(() => { const els = [...document.querySelectorAll('body *')].filter(x =>"
        f" (x.textContent || '').includes({json.dumps(text)}) && x.children.length === 0);"
        " if (!els.length) return false; const el = els[0];"
        " for (const t of ['pointerdown','mousedown','pointerup','mouseup']) {"
        "  el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window})); }"
        " const target = el.closest('button,a,[role=button]');"
        " if (target) target.click();"
        " else el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));"
        " return true; })()"
    )
    return bool(cdp.eval(expr))


def click_card_button(cdp: CDP, pack_id: str, text: str) -> bool:
    """在「含目标包 id 且不含其它参考包 id」的最近祖先卡片内点击按钮（多包同时安装时避免点错）。"""
    others = [pid for pid in ALL_PACK_IDS if pid != pack_id]
    expr = (
        "(() => {"
        f" const want = {json.dumps(text)}; const pid = {json.dumps(pack_id)}; const others = {json.dumps(others)};"
        " const btns = [...document.querySelectorAll('button')].filter(b => (b.textContent||'').includes(want) && !b.disabled);"
        " for (const b of btns) {"
        "  let el = b; let hops = 0;"
        "  while (el && hops < 15) {"
        "   const t = el.textContent || '';"
        "   const hasMe = t.includes(pid); const hasOther = others.some(o => t.includes(o));"
        "   if (hasMe && !hasOther) { b.click(); return true; }"
        "   if (hasOther && !hasMe) break;"
        "   el = el.parentElement; hops += 1;"
        "  }"
        " }"
        " if (btns.length === 1) { btns[0].click(); return 'fallback-single'; }"
        " return false;"
        "})()"
    )
    return cdp.eval(expr) not in (False, None)


def has_text(cdp: CDP, text: str) -> bool:
    return text in body_text(cdp)


def card_has_text(cdp: CDP, pack_id: str, text: str) -> bool:
    """在「最近包含目标包 id 的卡片（li）」内判断文本，避免多包同时安装时读到别的包的信任状态。"""
    others = [pid for pid in ALL_PACK_IDS if pid != pack_id]
    return bool(
        cdp.eval(
            "(() => {"
            f" const pid = {json.dumps(pack_id)}; const want = {json.dumps(text)}; const others = {json.dumps(others)};"
            " const lis = [...document.querySelectorAll('li')].filter(li => (li.textContent||'').includes(pid) && !others.some(o => (li.textContent||'').includes(o)));"
            " const card = lis.length ? lis[lis.length - 1] : null;"
            " return !!card && (card.textContent||'').includes(want);"
            "})()"
        )
    )


def editor_text(cdp: CDP) -> str:
    return str(cdp.eval("(document.querySelector('.ProseMirror') || {}).innerText || ''"))


# ---------------- guest iframe（OOPIF）驱动 ----------------


def iframe_targets(slug: str) -> list[dict]:
    """浏览器级 Target.getTargets → 命中 guest 的 iframe target（type=iframe，url 含包 slug）。"""
    if BROWSER is None:
        return []
    try:
        infos = BROWSER.call("Target.getTargets", timeout=60).get("targetInfos") or []
    except Exception:
        return []
    out = []
    for info in infos:
        url = str(info.get("url") or "")
        if info.get("type") == "iframe" and slug in url:
            out.append(info)
    return out


def guest_session(cdp: CDP, slug: str) -> str | None:
    # 1) 浏览器级显式 attach（flatten → 在同一连接上按 sessionId 发命令）
    targets_list = iframe_targets(slug)
    if targets_list:
        target = targets_list[-1]
        tid = str(target.get("targetId"))
        cached = GUEST_ATTACHED.get(tid)
        if cached and cached.get("sessionId"):
            return str(cached["sessionId"])
        if BROWSER is not None:
            try:
                res = BROWSER.call("Target.attachToTarget", {"targetId": tid, "flatten": True}, timeout=60)
                sid = res.get("sessionId")
                if sid:
                    GUEST_ATTACHED[tid] = {"sessionId": sid, "url": str(target.get("url"))}
                    return str(sid)
            except Exception as e:
                GUEST_ATTACHED[tid] = {"sessionId": None, "error": str(e), "url": str(target.get("url"))}
    # 2) 回退：页面级 auto-attach 事件（Target.setAutoAttach flatten）
    for e in reversed(list(cdp.events)):
        if e.get("method") != "Target.attachedToTarget":
            continue
        params = e.get("params") or {}
        info = params.get("targetInfo") or {}
        url = str(info.get("url") or "")
        if info.get("type") == "iframe" and slug in url:
            return str(params.get("sessionId"))
    return None


def wait_guest_session(cdp: CDP, slug: str, timeout: float = 45) -> str | None:
    """轮询等待 guest iframe target 出现并 attach；每轮走一次浏览器级 getTargets 泵事件。"""
    end = time.time() + timeout
    while time.time() < end:
        try:
            cdp.eval("1")  # 泵页面事件
        except Exception:
            pass
        sid = guest_session(cdp, slug)
        if sid:
            return sid
        time.sleep(0.2)
    return None


def guest_eval(cdp: CDP, slug: str, expr: str):
    sid = guest_session(cdp, slug)
    if not sid:
        raise RuntimeError(f"guest iframe 会话不存在（{slug}）")
    if BROWSER is None:
        raise RuntimeError("浏览器级 CDP 未连接")
    return BROWSER.eval(expr, sid)


def guest_set_input(cdp: CDP, slug: str, selector: str, value: str) -> str:
    expr = (
        "((sel, val) => { const el = document.querySelector(sel); if (!el) return 'MISSING:' + sel;"
        " el.focus(); el.value = val;"
        " el.dispatchEvent(new Event('input', { bubbles: true }));"
        " el.dispatchEvent(new Event('change', { bubbles: true }));"
        " return el.value; })"
        f"({json.dumps(selector)}, {json.dumps(value)})"
    )
    return guest_eval(cdp, slug, expr)


def guest_click(cdp: CDP, slug: str, selector: str) -> bool:
    return bool(
        guest_eval(
            cdp,
            slug,
            f"(() => {{ const el = document.querySelector({json.dumps(selector)}); if (!el) return false; el.click(); return true; }})()",
        )
    )


def guest_text(cdp: CDP, slug: str, selector: str) -> str:
    return str(
        guest_eval(
            cdp,
            slug,
            f"(() => {{ const el = document.querySelector({json.dumps(selector)}); return el ? el.textContent : null; }})()",
        )
        or ""
    )


def guest_error_text(cdp: CDP, slug: str) -> str:
    return guest_text(cdp, slug, "#error-text")


def guest_error_visible(cdp: CDP, slug: str) -> bool:
    return bool(
        guest_eval(
            cdp,
            slug,
            "(() => { const box = document.getElementById('error-box'); return !!box && !box.hidden; })()",
        )
    )


def guest_hidden_by_id(cdp: CDP, slug: str, element_id: str) -> bool:
    return bool(
        guest_eval(
            cdp,
            slug,
            f"(() => {{ const el = document.getElementById({json.dumps(element_id)}); return !!el && !!el.hidden; }})()",
        )
    )


# ---------------- guest 状态镜像（判定用主通道） ----------------


def guest_states(cdp: CDP, phase: str) -> list[dict]:
    log = cdp.eval("window.__keGuestMsgLog || []")
    if not isinstance(log, list):
        return []
    return [p for p in log if isinstance(p, dict) and p.get("phase") == phase]


def last_guest_state(cdp: CDP, phase: str) -> dict | None:
    states = guest_states(cdp, phase)
    return states[-1] if states else None


def wait_guest_state(cdp: CDP, phase: str, predicate, timeout: float) -> dict | None:
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            st = last_guest_state(cdp, phase)
        except Exception:
            st = None
        if isinstance(st, dict):
            last = st
            try:
                if predicate(st):
                    return st
            except Exception:
                pass
        time.sleep(0.3)
    return last


def guest_state_count(cdp: CDP, phase: str) -> int:
    return len(guest_states(cdp, phase))


def wait_new_guest_state(cdp: CDP, phase: str, after_count: int, predicate, timeout: float) -> dict | None:
    """等待「点按钮之后新增」的 guest 状态（避免匹配到上一次操作遗留的旧状态）。"""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            states = guest_states(cdp, phase)
        except Exception:
            states = []
        if isinstance(states, list) and len(states) > after_count:
            for st in states[after_count:]:
                if not isinstance(st, dict):
                    continue
                last = st
                try:
                    if predicate(st):
                        return st
                except Exception:
                    pass
        elif states:
            last = states[-1]
        time.sleep(0.3)
    return last


def host_heartbeats(cdp: CDP) -> int:
    v = cdp.eval("window.__keGuestHeartbeats || 0")
    return int(v or 0)


# ---------------- 宿主侧真实保存（触发 document-saved 事件） ----------------


def open_article(cdp: CDP, leaf_text: str, expect_text: str, timeout_s: float = 45) -> bool:
    click_text(cdp, leaf_text)
    return wait_until(lambda: expect_text in editor_text(cdp), timeout_s, 0.3)


def focus_editor_end(cdp: CDP) -> bool:
    return bool(
        cdp.eval(
            "(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus();"
            " const sel = window.getSelection(); sel.removeAllRanges();"
            " const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);"
            " sel.addRange(r); return true; })()"
        )
    )


def type_marker(cdp: CDP, marker: str) -> bool:
    for ch in marker:
        try:
            cdp.call("Input.dispatchKeyEvent", {"type": "char", "text": ch, "key": ch})
        except Exception:
            pass
        time.sleep(0.04)
    if wait_until(lambda: marker in editor_text(cdp), 4):
        return True
    cdp.eval(
        "(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus();"
        f" document.execCommand('insertText', false, {json.dumps(marker)}); return true; }})()"
    )
    return wait_until(lambda: marker in editor_text(cdp), 6)


def press_ctrl_s(cdp: CDP, raw: bool = False) -> None:
    down = "rawKeyDown" if raw else "keyDown"
    for t in (down, "keyUp"):
        try:
            cdp.call(
                "Input.dispatchKeyEvent",
                {
                    "type": t,
                    "key": "s",
                    "code": "KeyS",
                    "modifiers": 2,
                    "windowsVirtualKeyCode": 83,
                    "nativeVirtualKeyCode": 83,
                },
            )
        except Exception:
            pass


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


# ---------------- 构建参考包（独立复核） ----------------


def run_node(args: list[str], cwd: Path, timeout: float = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        [NODE, *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def build_reference_packs(checks: list[dict], check) -> dict:
    shutil.rmtree(BASE, ignore_errors=True)
    BASE.mkdir(parents=True, exist_ok=True)
    DIST.mkdir(parents=True, exist_ok=True)
    key = BASE / "keys" / "test-signing-key.pem"
    key.parent.mkdir(parents=True, exist_ok=True)
    gen = run_node([str(SIGN_TOOL), "--generate-key", str(key)], cwd=BASE)
    if gen.returncode != 0:
        raise RuntimeError(f"生成测试签名密钥失败: {gen.stderr[:800]}")
    try:
        key_info = json.loads(gen.stdout)  # sign_pack --generate-key 输出=仅一段 pretty JSON
    except Exception:
        m = re.search(r'"publicKeyHex"\s*:\s*"([0-9a-f]{64})"', gen.stdout or "")
        if not m:
            raise RuntimeError(f"无法解析签名密钥生成输出: {gen.stdout!r} / {gen.stderr[:500]!r}")
        key_info = {"publicKeyHex": m.group(1)}
    pub_hex = key_info["publicKeyHex"]
    build_json = BASE / "build.json"
    built = run_node(
        [
            str(BUILD_TOOL),
            "--packs",
            str(PACKS_SRC),
            "--out",
            str(DIST),
            "--key",
            str(key),
            "--keyid",
            "k1",
            "--json-out",
            str(build_json),
        ],
        cwd=REPO,
    )
    if built.returncode != 0:
        raise RuntimeError(f"构建参考包失败: {built.stderr[:1500]}")
    summary = json.loads(build_json.read_text(encoding="utf-8"))
    packs = {p["id"]: p for p in summary.get("packs", [])}

    # 独立复核 1：dist manifest 的 assets sha256/大小 = 实际文件；签名结构合法
    assets_ok = True
    assets_detail = {}
    for pid, pack in packs.items():
        dist_dir = Path(str(REPO / pack["distDir"])) if not Path(pack["distDir"]).is_absolute() else Path(pack["distDir"])
        manifest = json.loads((dist_dir / "manifest.json").read_text(encoding="utf-8"))
        sig = manifest.get("signature") or {}
        sig_ok = sig.get("alg") == "ed25519" and sig.get("keyId") == "k1" and bool(
            re.fullmatch(r"[0-9a-f]{128}", str(sig.get("signature", "")))
        )
        per_asset = []
        for asset in manifest.get("assets", []):
            full = dist_dir / asset["path"]
            actual = sha_file(full) if full.exists() else None
            per_asset.append(
                {
                    "path": asset["path"],
                    "declaredSha256": asset["sha256"],
                    "actualSha256": actual,
                    "match": actual == asset["sha256"],
                    "size": full.stat().st_size if full.exists() else None,
                    "declaredSize": asset.get("size"),
                }
            )
        assets_ok = assets_ok and sig_ok and all(a["match"] and a["size"] == a["declaredSize"] for a in per_asset)
        assets_detail[pid] = {"distDir": str(dist_dir), "signature": {"alg": sig.get("alg"), "keyId": sig.get("keyId"), "signatureLen": len(str(sig.get("signature", "")))}, "assets": per_asset}

    # 独立复核 2：zip 结构（根含 manifest.json + 全部资产），zip 内 manifest assets 与 dist 一致
    zips_ok = True
    zips_detail = {}
    for z in summary.get("zips", []):
        zip_path = Path(str(REPO / z["path"])) if not Path(z["path"]).is_absolute() else Path(z["path"])
        ok = zip_path.exists()
        names = []
        zip_manifest = {}
        if ok:
            with zipfile.ZipFile(zip_path) as zf:
                names = sorted(zf.namelist())
                zip_manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        dist_manifest = json.loads((Path(assets_detail[z["packId"]]["distDir"]) / "manifest.json").read_text(encoding="utf-8"))
        zip_assets_match = [a["path"] for a in zip_manifest.get("assets", [])] == [a["path"] for a in dist_manifest.get("assets", [])]
        root_ok = "manifest.json" in names and all(a["path"] in names for a in dist_manifest.get("assets", []))
        ok = ok and root_ok and zip_assets_match
        zips_ok = zips_ok and ok
        zips_detail[z["packId"]] = {"zipPath": str(zip_path), "sha256": sha_file(zip_path) if zip_path.exists() else None, "names": names, "rootOk": root_ok, "assetsMatch": zip_assets_match, "size": zip_path.stat().st_size if zip_path.exists() else None}

    check(
        "W-G7-1 构建工具产出两个签名参考包（A/B）：dist manifest assets sha256/size 与实际文件一致、签名为 ed25519/k1 128hex、zip 根含 manifest+资产",
        assets_ok and zips_ok,
        {"packs": assets_detail, "zips": zips_detail, "publicKeyHex": pub_hex, "buildKeySource": summary.get("signing", {}).get("keySource")},
    )

    # 独立复核 3：--check 幂等（源 manifest 哈希/vendored SDK 均已同步，不需重建）
    check_res = run_node(
        [str(BUILD_TOOL), "--packs", str(PACKS_SRC), "--out", str(DIST), "--key", str(key), "--keyid", "k1", "--check"],
        cwd=REPO,
    )
    check(
        "W-G7-2 构建幂等：`--check` 通过（源 manifest assets 哈希已回写、vendored SDK 已同步）",
        check_res.returncode == 0,
        {"exit": check_res.returncode, "stderrTail": (check_res.stderr or "")[-600:]},
    )

    # 源 manifest（入库）与 dist manifest 对齐（除 signature 外字段一致）
    source_synced = True
    source_detail = {}
    for pid, pack in packs.items():
        src_path = Path(pack["sourceDir"])
        if not src_path.is_absolute():
            src_path = REPO / src_path
        src_path = src_path / "manifest.json"
        dist_path = Path(assets_detail[pid]["distDir"]) / "manifest.json"
        src_m = json.loads(src_path.read_text(encoding="utf-8"))
        dist_m = json.loads(dist_path.read_text(encoding="utf-8"))
        dist_m.pop("signature", None)
        same = json.dumps(src_m, sort_keys=True) == json.dumps(dist_m, sort_keys=True)
        source_synced = source_synced and same and "signature" not in src_m
        source_detail[pid] = {"sourceManifest": str(src_path), "signedInSource": "signature" in src_m, "alignedWithDist": same}
    check(
        "W-G7-3 源 manifest（入库）只含哈希/大小、不含签名，且与 dist 签名清单字段一致",
        bool(source_synced),
        source_detail,
    )
    return {"build": summary, "packs": packs, "publicKeyHex": pub_hex, "keyPath": str(key), "zips": summary.get("zips", [])}


# ---------------- 单次运行 ----------------


def execute(checks: list[dict]) -> dict:
    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:400], flush=True)

    if not EXE.exists():
        raise RuntimeError(f"缺少测试构建: {EXE}")
    # 每次尝试重置 CDP 全局状态（上一轮 app 的 target/session 不可复用）
    global BROWSER
    BROWSER = None
    GUEST_ATTACHED.clear()
    build_sha = sha_file(EXE)
    build_mtime = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime))

    # ---- 1. 构建/签名/flagship 独立复核 ----
    build_info = build_reference_packs(checks, check)

    # ---- 2. 隔离环境 ----
    cleanup()
    cleanup_test_identifier()
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True)
    article = ws / "Articles" / "g7-demo.md"
    article.write_bytes(DOC_CONTENT.encode("utf-8"))
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(
        json.dumps({"recent_workspaces": [str(ws)], "recent_documents": []}), encoding="utf-8"
    )
    (ke_cfg / "settings.json").write_text(
        json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8"
    )
    pdf_out = BASE / "pdf-out"
    pdf_out.mkdir(parents=True, exist_ok=True)

    dist_a = Path(next(p["distDir"] for p in build_info["packs"].values() if p["id"] == PACK_A["id"]))
    dist_b = Path(next(p["distDir"] for p in build_info["packs"].values() if p["id"] == PACK_B["id"]))
    if not dist_a.is_absolute():
        dist_a = REPO / dist_a
    if not dist_b.is_absolute():
        dist_b = REPO / dist_b

    env = {
        **os.environ,
        "APPDATA": str(appdata),
        "KE_WORKSPACE": str(ws),
        "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": build_info["publicKeyHex"]}}),
        "KE_WS_PRINT_RENDER": "1",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
    }
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, cwd=str(BASE), stdout=log, stderr=subprocess.STDOUT)
    cdp: CDP | None = None
    observed: dict = {}
    results: dict = {}
    diag: object = None
    try:
        if not wait_until(lambda: bool(main_targets()), 120, 0.3):
            raise RuntimeError("CDP 主窗口未就绪")
        cdp = main_cdp()
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        browser_connect()  # 浏览器级 target 发现/attach（guest iframe 是 OOPIF 独立 target）
        wait_until(lambda: bool(host_eval(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'")), 30, 0.25)
        workshop_btn = "!!document.querySelector('button[aria-label=\"打开创意工坊\"]')"
        wait_until(lambda: bool(host_eval(cdp, workshop_btn)), 60, 0.2)
        check(
            "W-G7-4 隔离产品实例启动 + CDP 主窗口就绪（工坊入口已渲染，WebView2 IPC 可用）",
            bool(host_eval(cdp, workshop_btn)),
            {"port": CDP_PORT, "exeSha256": build_sha, "exeMtime": build_mtime},
        )
        # PDF 输出隔离（测试/排障 seam：生产不设置 → appDataDir）
        host_eval(cdp, "window.__KE_PRINT_OUTPUT_DIR__ = " + json.dumps(str(pdf_out)) + "; window.__KE_PRINT_OUTPUT_DIR__")
        host_eval(cdp, GUEST_MSG_COLLECTOR)

        def open_workshop() -> bool:
            if not click_dom(cdp, "document.querySelector('button[aria-label=\"打开创意工坊\"]')"):  # type: ignore[union-attr]
                return False
            return wait_until(lambda: bool(cdp and "创意工坊" in body_text(cdp)), 20, 0.2)

        def close_workshop() -> bool:
            ok = bool(
                host_eval(
                    cdp,
                    "(() => { const dlg = document.querySelector('[role=dialog]'); if (!dlg) return false;"
                    " const b = [...dlg.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '关闭');"
                    " if (!b) return false; b.click(); return true; })()",
                )
            )
            time.sleep(0.4)
            return ok

        # 页面级 auto-attach 作为显式 attach 的回退（flatten 事件在 wait 循环内收集）
        try:
            cdp.call("Target.setAutoAttach", {"autoAttach": True, "waitForDebuggerOnStart": False, "flatten": True})
        except Exception:
            pass

        # ================= pack A：安装 → trusted → 启用 =================
        inst_a = invoke(cdp, "workshop_pack_install", {"sourceDir": str(dist_a)})
        verify_a = invoke(cdp, "workshop_pack_verify", {"id": PACK_A["id"], "version": "1.0.0"})
        check(
            "W-G7-5 安装参考包 A（Rust 安装成功；产品侧签名校验 valid）",
            inst_a.get("ok") is True and verify_a.get("ok") is True and verify_a.get("value") is True,
            {"install": inst_a, "verify": verify_a, "sourceDir": str(dist_a)},
        )
        if not open_workshop():
            raise RuntimeError("无法打开创意工坊面板")
        wait_until(lambda: has_text(cdp, "授予信任") or has_text(cdp, "启用 guest"), 20, 0.25) if cdp else None
        body_a_install = body_text(cdp) if cdp else ""
        signature_visible_a = "签名：valid" in body_a_install
        trust_clicked_a = click_card_button(cdp, PACK_A["id"], "授予信任")
        trust_ok_a = wait_until(lambda: bool(cdp and card_has_text(cdp, PACK_A["id"], "信任：trusted")), 20, 0.25)
        check(
            "W-G7-6 授予参考包 A trusted（面板显示签名 valid + 信任 trusted）",
            bool(trust_clicked_a and trust_ok_a and signature_visible_a),
            {"clicked": trust_clicked_a, "trustedVisible": trust_ok_a, "signatureValidVisible": signature_visible_a},
        )
        if not click_card_button(cdp, PACK_A["id"], "启用 guest"):
            raise RuntimeError("未找到 pack A 的「启用 guest」按钮: " + json.dumps(snapshot_diag(cdp), ensure_ascii=False)[:1200])
        sid_a = wait_guest_session(cdp, PACK_A["slug"], 45)
        session_a = invoke(cdp, "workshop_pack_session_status", {})
        st_a = (session_a or {}).get("value") or {}
        caps_a = st_a.get("capabilities") if isinstance(st_a.get("capabilities"), list) else []
        state_a = wait_guest_state(cdp, "pack-a-state", lambda s: s.get("connected") is True, 60)
        check(
            "W-G7-7 pack A 会话 active 且 guest iframe 已挂载；运行期能力 = 声明最小集（无多余能力）",
            session_a.get("ok") is True
            and st_a.get("state") == "active"
            and sid_a is not None
            and sorted(caps_a) == sorted(PACK_A["capabilities"]),
            {"state": st_a.get("state"), "capabilities": caps_a, "guestSessionFound": sid_a is not None,
             "guestStatusLog": (host_eval(cdp, "window.__keGuestStatusLog || null")),
             "isolationResidual": "E_ISOLATION_RESIDUAL" in body_text(cdp),
             "iframeTargets": iframe_targets(PACK_A["slug"]),
             "attached": {k: {"url": v.get("url"), "hasSession": bool(v.get("sessionId")), "error": v.get("error")} for k, v in GUEST_ATTACHED.items()}},
        )
        hs_a = (state_a or {}).get("handshake") or {}
        accepted_a = (state_a or {}).get("acceptedFeatures") or []
        check(
            "W-G7-8 pack A 内发布 SDK `autoConnect` 握手成功（acceptedFeatures/contextId/epoch/hostVersion）",
            (state_a or {}).get("connected") is True
            and set(accepted_a) >= set(PACK_A["capabilities"])
            and bool(hs_a.get("contextId"))
            and isinstance(hs_a.get("epoch"), int)
            and bool(hs_a.get("hostVersion")),
            {"handshake": hs_a, "acceptedFeatures": accepted_a, "sdkVersion": (state_a or {}).get("sdkVersion")},
        )
        hb0 = host_heartbeats(cdp)
        hb_count0 = int((state_a or {}).get("heartbeatCount") or 0)
        hb_ok = wait_until(lambda: host_heartbeats(cdp) >= hb0 + 2, 8, 0.2)
        time.sleep(0.6)
        hb_count1 = int((last_guest_state(cdp, "pack-a-state") or {}).get("heartbeatCount") or 0)
        check(
            "W-G7-9 pack A 心跳：宿主收到 t19-heartbeat 计数增长；guest UI 心跳计数增长",
            hb_ok and hb_count1 > hb_count0,
            {"hostHeartbeatsBefore": hb0, "hostHeartbeatsAfter": host_heartbeats(cdp),
             "guestHeartbeatBefore": hb_count0, "guestHeartbeatAfter": hb_count1},
        )

        # ---- W-G7-10：驱动真实 UI「读取快照」→ 展现真实正文 ----
        guest_set_input(cdp, PACK_A["slug"], "#rel-path", REL_PATH)
        guest_click(cdp, PACK_A["slug"], "#btn-load")
        st_snap = wait_guest_state(
            cdp, "pack-a-state", lambda s: isinstance(s.get("snapshot"), dict) and s["snapshot"].get("revision") is not None, 30
        )
        snap = (st_snap or {}).get("snapshot") or {}
        dom_title = guest_text(cdp, PACK_A["slug"], "#doc-title")
        dom_content = guest_text(cdp, PACK_A["slug"], "#doc-content")
        disk_sha = sha_text(DOC_CONTENT)
        check(
            "W-G7-10 pack A 经真实 UI「读取快照」→ 展示 frontmatter 标题 + 真实正文（=磁盘原文语义）+ revision/diskHash",
            snap.get("hasContent") is True
            and snap.get("relPath") == REL_PATH
            and snap.get("revision") == 0
            and snap.get("diskHash") == disk_sha
            and DOC_TITLE in dom_title
            and DOC_BODY_MARK in dom_content
            and DOC_BODY_MARK in str(snap.get("snippet")),
            {"snapshot": {k: snap.get(k) for k in ("relPath", "revision", "diskHash", "hasContent", "contentLen")},
             "domTitle": dom_title, "domContentHead": dom_content[:120], "diskSha256": disk_sha},
        )

        # ---- W-G7-11：错误展示（宿主返回的类型化错误；用非法打印路径触发 E_BAD_PAYLOAD） ----
        guest_set_input(cdp, PACK_A["slug"], "#rel-path", "../escape.md")
        guest_click(cdp, PACK_A["slug"], "#btn-print")
        err_visible = wait_until(lambda: guest_error_visible(cdp, PACK_A["slug"]), 20, 0.3)
        err_text = guest_error_text(cdp, PACK_A["slug"])
        print_dom = guest_text(cdp, PACK_A["slug"], "#print-result")
        guest_set_input(cdp, PACK_A["slug"], "#rel-path", REL_PATH)
        check(
            "W-G7-11 pack A 错误展示：宿主返回类型化错误（非法打印路径 → E_BAD_PAYLOAD）时 UI 明文展示，不静默",
            err_visible and ("E_" in err_text or "E_" in print_dom),
            {"errorVisible": err_visible, "errorText": err_text, "printResultDom": print_dom, "probe": "print.snapshot relPath=../escape.md"},
        )

        # ---- W-G7-12：真实打印管线（用「新状态」等待，避免匹配到上一步错误展示的旧状态） ----
        print_baseline = guest_state_count(cdp, "pack-a-state")
        guest_click(cdp, PACK_A["slug"], "#btn-print")
        st_print = wait_new_guest_state(
            cdp,
            "pack-a-state",
            print_baseline,
            lambda s: isinstance(s.get("printResult"), dict) and bool(s["printResult"].get("pdfToken")),
            150,
        )
        print_result = (st_print or {}).get("printResult") or {}
        token = print_result.get("pdfToken")
        tokens = host_eval(cdp, "typeof window.__kePrintTokens === 'function' ? window.__kePrintTokens() : null")
        token_entry = None
        for entry in tokens or []:
            if isinstance(entry, dict) and entry.get("pdfToken") == token:
                token_entry = entry
                break
        pdf_path = Path(token_entry["pdfPath"]) if token_entry and token_entry.get("pdfPath") else None
        pdf_ok = bool(pdf_path and pdf_path.exists() and pdf_path.stat().st_size > 1000)
        pdf_head = b""
        if pdf_ok and pdf_path:
            with pdf_path.open("rb") as f:
                pdf_head = f.read(4)
        isolated_pdf = bool(pdf_path and str(pdf_path).lower().startswith(str(BASE).lower()))
        print_err = (st_print or {}).get("lastError") if st_print else None
        check(
            "W-G7-12 pack A「打印快照」→ print.snapshot 返回真实不透明 pdfToken，对应隔离目录真实 PDF（%PDF、大小>1000）",
            isinstance(token, str) and len(token) > 8 and pdf_ok and pdf_head == b"%PDF" and isolated_pdf,
            {"printResult": print_result, "tokenEntry": token_entry, "pdfPath": str(pdf_path) if pdf_path else None,
             "pdfSize": pdf_path.stat().st_size if pdf_ok and pdf_path else 0,
             "pdfHead": pdf_head.decode("latin1", "replace"), "underIsolatedBase": isolated_pdf,
             "printError": print_err,
             "pagesNull": print_result.get("pages") is None},
        )
        session_after_print = invoke(cdp, "workshop_pack_session_status", {})
        st_after_print = (session_after_print or {}).get("value") or {}
        check(
            "W-G7-13 打印期间/之后 guest 会话未被心跳误判（state 仍 active；G3 心跳超时放宽回归）",
            st_after_print.get("state") == "active",
            {"stateAfterPrint": st_after_print.get("state")},
        )

        # ---- W-G7-14/15：宿主真实保存 → document-saved 事件到达 pack A 并自动刷新 ----
        if not open_article(cdp, "g7-demo.md", DOC_BODY_MARK):
            raise RuntimeError("无法在编辑器打开测试文档: " + json.dumps(snapshot_diag(cdp), ensure_ascii=False)[:1200])
        focused = focus_editor_end(cdp)
        typed = type_marker(cdp, SAVE_MARKER)
        saved = wait_file_marker(article, SAVE_MARKER, 15)
        saved_by = "autosave"
        if not saved:
            press_ctrl_s(cdp, raw=True)
            saved = wait_file_marker(article, SAVE_MARKER, 12)
            saved_by = "ctrl-s-raw"
        st_event = wait_guest_state(
            cdp, "pack-a-state",
            lambda s: isinstance(s.get("lastEvent"), dict) and s["lastEvent"].get("type") == "document-saved",
            40,
        )
        last_event = (st_event or {}).get("lastEvent") or {}
        dom_last_event = guest_text(cdp, PACK_A["slug"], "#last-event")
        check(
            "W-G7-14 pack A 收到宿主真实保存触发的 document-saved 事件（relPath/revision）并在 UI 展示",
            saved and last_event.get("type") == "document-saved" and last_event.get("relPath") == REL_PATH and isinstance(last_event.get("revision"), int) and "document-saved" in dom_last_event,
            {"saved": saved, "savedBy": saved_by, "lastEvent": last_event, "domLastEvent": dom_last_event},
        )
        # 自动刷新：事件后 pack A 自动重读快照；快照 revision = 事件 revision 且正文含 SAVE_MARKER
        auto = wait_guest_state(
            cdp,
            "pack-a-state",
            lambda s: isinstance(s.get("snapshot"), dict)
            and isinstance(s["snapshot"].get("revision"), int)
            and isinstance(last_event.get("revision"), int)
            and s["snapshot"]["revision"] == last_event.get("revision")
            and SAVE_MARKER in str(s["snapshot"].get("tail"))
            and s["snapshot"].get("reason") == "document-saved",
            40,
        )
        auto_snap = (auto or {}).get("snapshot") or {}
        dom_content_after = guest_text(cdp, PACK_A["slug"], "#doc-content")
        disk_after_save = article.read_bytes().decode("utf-8", errors="replace")
        check(
            "W-G7-15 pack A 事件后自动刷新快照：revision 与事件一致、正文含真实保存标记（读到的不是旧内容）",
            isinstance(auto_snap.get("revision"), int)
            and auto_snap.get("revision") == last_event.get("revision")
            and SAVE_MARKER in str(auto_snap.get("tail"))
            and SAVE_MARKER in dom_content_after
            and SAVE_MARKER in disk_after_save,
            {"autoSnapshot": {k: auto_snap.get(k) for k in ("revision", "reason", "tail")},
             "eventRevision": last_event.get("revision"), "diskHasMarker": SAVE_MARKER in disk_after_save},
        )

        # ---- W-G7-16：停用 guest（旧连接卸载） ----
        stop_clicked = click_card_button(cdp, PACK_A["id"], "停用 guest")
        stop_state = None
        if stop_clicked:
            def stopped() -> bool:
                info = invoke(cdp, "workshop_pack_session_status", {})
                nonlocal stop_state
                stop_state = ((info or {}).get("value") or {}).get("state")
                return stop_state in ("stopped", "failed", "idle")

            wait_until(stopped, 20, 0.25)

        iframes_left = host_eval(cdp, "[...document.querySelectorAll('iframe')].filter(f => (f.getAttribute('title')||'').startsWith('workshop-guest-')).length")
        check(
            "W-G7-16 停用 pack A guest 生效：会话 stopped/failed/idle + guest iframe 卸载（旧连接载体关闭）",
            bool(stop_clicked) and stop_state in ("stopped", "failed", "idle") and int(iframes_left or 0) == 0,
            {"stopClicked": stop_clicked, "state": stop_state, "guestIframes": iframes_left},
        )

        # ================= pack B：安装 → trusted → 启用 =================
        close_workshop()
        inst_b = invoke(cdp, "workshop_pack_install", {"sourceDir": str(dist_b)})
        verify_b = invoke(cdp, "workshop_pack_verify", {"id": PACK_B["id"], "version": "1.0.0"})
        check(
            "W-G7-17 安装参考包 B（Rust 安装成功；产品侧签名校验 valid）",
            inst_b.get("ok") is True and verify_b.get("ok") is True and verify_b.get("value") is True,
            {"install": inst_b, "verify": verify_b, "sourceDir": str(dist_b)},
        )
        if not open_workshop():
            raise RuntimeError("重新打开创意工坊面板失败")
        wait_until(lambda: has_text(cdp, PACK_B["id"]), 20, 0.25)
        body_b_install = body_text(cdp)
        signature_visible_b = "签名：valid" in body_b_install
        trust_clicked_b = click_card_button(cdp, PACK_B["id"], "授予信任")
        trust_ok_b = wait_until(lambda: bool(cdp and card_has_text(cdp, PACK_B["id"], "信任：trusted")), 20, 0.25)
        if not click_card_button(cdp, PACK_B["id"], "启用 guest"):
            raise RuntimeError("未找到 pack B 的「启用 guest」按钮: " + json.dumps(snapshot_diag(cdp), ensure_ascii=False)[:1200])
        sid_b = wait_guest_session(cdp, PACK_B["slug"], 45)
        session_b = invoke(cdp, "workshop_pack_session_status", {})
        st_b = (session_b or {}).get("value") or {}
        caps_b = st_b.get("capabilities") if isinstance(st_b.get("capabilities"), list) else []
        state_b = wait_guest_state(cdp, "pack-b-state", lambda s: s.get("connected") is True, 60)
        check(
            "W-G7-18 pack B 会话 active；运行期能力 = 声明最小集（ui.shell/panel.dock/context.read）",
            session_b.get("ok") is True
            and st_b.get("state") == "active"
            and sid_b is not None
            and sorted(caps_b) == sorted(PACK_B["capabilities"]),
            {"state": st_b.get("state"), "capabilities": caps_b,
             "sessionFull": st_b,
             "guestStart": host_eval(cdp, "window.__keGuestStart || null"),
             "guestError": host_eval(cdp, "window.__keGuestError || null"),
             "guestStatusLog": host_eval(cdp, "window.__keGuestStatusLog || null"),
             "trust": {"clicked": trust_clicked_b, "trustedVisible": trust_ok_b, "signatureValidVisible": signature_visible_b}},
        )
        hs_b = (state_b or {}).get("handshake") or {}
        accepted_b = (state_b or {}).get("acceptedFeatures") or []
        hb0b = host_heartbeats(cdp)
        hb_count_b0 = int((state_b or {}).get("heartbeatCount") or 0)
        hb_ok_b = wait_until(lambda: host_heartbeats(cdp) >= hb0b + 2, 8, 0.2)
        time.sleep(0.5)
        hb_count_b1 = int((last_guest_state(cdp, "pack-b-state") or {}).get("heartbeatCount") or 0)
        check(
            "W-G7-19 pack B guest 内发布 SDK 握手成功 + 心跳计数增长",
            (state_b or {}).get("connected") is True
            and set(accepted_b) >= set(PACK_B["capabilities"])
            and bool(hs_b.get("contextId"))
            and hb_ok_b
            and hb_count_b1 > hb_count_b0,
            {"handshake": hs_b, "acceptedFeatures": accepted_b,
             "hostHeartbeats": [hb0b, host_heartbeats(cdp)], "guestHeartbeats": [hb_count_b0, hb_count_b1],
             "declaredCommands": (state_b or {}).get("declaredCommands")},
        )

        # ---- W-G7-20：读取快照 + 表单自动填充（frontmatter 解析） ----
        guest_set_input(cdp, PACK_B["slug"], "#rel-path", REL_PATH)
        guest_click(cdp, PACK_B["slug"], "#btn-load")
        st_snap_b = wait_guest_state(
            cdp, "pack-b-state", lambda s: isinstance(s.get("snapshot"), dict) and s["snapshot"].get("revision") is not None, 30
        )
        snap_b = (st_snap_b or {}).get("snapshot") or {}
        form_b = (st_snap_b or {}).get("form") or {}
        dom_content_b = guest_text(cdp, PACK_B["slug"], "#doc-content")
        title_input_b = str(guest_eval(cdp, PACK_B["slug"], "document.getElementById('title-input').value") or "")
        tags_input_b = str(guest_eval(cdp, PACK_B["slug"], "document.getElementById('tags-input').value") or "")
        check(
            "W-G7-20 pack B 经真实 UI 读取快照：展示正文 + 从 frontmatter 自动填充 title（tags 为空可接受）",
            snap_b.get("hasContent") is True
            and DOC_BODY_MARK in dom_content_b
            and SAVE_MARKER in dom_content_b
            and title_input_b == DOC_TITLE
            and form_b.get("title") == DOC_TITLE,
            {"snapshot": {k: snap_b.get(k) for k in ("relPath", "revision", "hasContent", "contentLen")},
             "titleInput": title_input_b, "tagsInput": tags_input_b,
             "domContentHead": dom_content_b[:120]},
        )

        # ---- W-G7-21：表单提交 title → command.invoke → 磁盘落盘 ----
        guest_set_input(cdp, PACK_B["slug"], "#title-input", FORM_TITLE)
        guest_click(cdp, PACK_B["slug"], "#btn-submit-title")
        st_cmd_title = wait_guest_state(
            cdp,
            "pack-b-state",
            lambda s: any(isinstance(r, dict) and r.get("name") == "article.set-title" for r in (s.get("commandResults") or [])),
            30,
        )
        title_cmd = last_cmd(st_cmd_title, "article.set-title")
        disk_after_title = article.read_text(encoding="utf-8", errors="replace")
        frontmatter_after_title = frontmatter_of(disk_after_title)
        dom_cmd_b = guest_text(cdp, PACK_B["slug"], "#command-result")
        check(
            "W-G7-21 pack B「提交标题」经 command.invoke（article.set-title）成功，后端真实落盘 frontmatter title",
            bool(title_cmd and title_cmd.get("ok") is True)
            and FORM_TITLE in frontmatter_after_title
            and "ok" in dom_cmd_b,
            {"commandResult": title_cmd, "frontmatter": frontmatter_after_title[:200], "domCommandResult": dom_cmd_b},
        )

        # ---- W-G7-22：表单提交 tags → 磁盘落盘 ----
        guest_set_input(cdp, PACK_B["slug"], "#tags-input", FORM_TAGS)
        guest_click(cdp, PACK_B["slug"], "#btn-submit-tags")
        st_cmd_tags = wait_guest_state(
            cdp,
            "pack-b-state",
            lambda s: any(isinstance(r, dict) and r.get("name") == "article.set-tags" for r in (s.get("commandResults") or [])),
            30,
        )
        tags_cmd = last_cmd(st_cmd_tags, "article.set-tags")
        disk_after_tags = article.read_text(encoding="utf-8", errors="replace")
        frontmatter_after_tags = frontmatter_of(disk_after_tags)
        check(
            "W-G7-22 pack B「提交标签」经 command.invoke（article.set-tags）成功，后端真实落盘 frontmatter tags",
            bool(tags_cmd and tags_cmd.get("ok") is True)
            and "tags:" in frontmatter_after_tags
            and "g7" in frontmatter_after_tags
            and "probe" in frontmatter_after_tags,
            {"commandResult": tags_cmd, "frontmatter": frontmatter_after_tags[:240]},
        )

        # ---- W-G7-23：错误展示（空标题 → 宿主拒绝 E_TITLE，UI 显示错误且磁盘不被改） ----
        title_before_err = FORM_TITLE if FORM_TITLE in frontmatter_after_tags else None
        guest_set_input(cdp, PACK_B["slug"], "#title-input", "")
        guest_click(cdp, PACK_B["slug"], "#btn-submit-title")
        st_err = wait_guest_state(
            cdp,
            "pack-b-state",
            lambda s: isinstance(s.get("lastError"), dict) and "E_TITLE" in str(s["lastError"].get("message", "")),
            30,
        )
        err_b_visible = wait_until(lambda: guest_error_visible(cdp, PACK_B["slug"]), 10, 0.3)
        err_b_text = guest_error_text(cdp, PACK_B["slug"])
        disk_after_err = frontmatter_of(article.read_text(encoding="utf-8", errors="replace"))
        check(
            "W-G7-23 pack B 错误展示：空标题被宿主命令白名单拒绝（E_TITLE），UI 明文显示错误，磁盘 title 未被改",
            err_b_visible and "E_TITLE" in err_b_text and (title_before_err is None or FORM_TITLE in disk_after_err) and "E_TITLE" in json.dumps(st_err or {}, ensure_ascii=False),
            {"errorVisible": err_b_visible, "errorText": err_b_text, "lastError": (st_err or {}).get("lastError"),
             "frontmatterAfterError": disk_after_err[:200]},
        )

        # ---- W-G7-24：主进程/隔离/清理 ----
        stop_b_clicked = click_card_button(cdp, PACK_B["id"], "停用 guest")
        if stop_b_clicked:
            wait_until(lambda: ((invoke(cdp, "workshop_pack_session_status", {}) or {}).get("value") or {}).get("state") in ("stopped", "failed", "idle"), 15, 0.25)
        log.flush()
        log_tail = log_path.read_text(encoding="utf-8", errors="replace")[-4000:]
        ours = count_processes("knowledgeeditor", r"C:\ke-tmp\uiws-t26\bin\*")
        upid = user_pid()
        session_final = invoke(cdp, "workshop_pack_session_status", {})
        state_final = ((session_final or {}).get("value") or {}).get("state")
        check(
            "W-G7-24 主进程存活 / 用户实例未受影响（未运行 → N/A）/ guest 已停用（无残留会话）",
            proc.poll() is None and (upid.isdigit() or upid == "") and state_final in ("stopped", "failed", "idle"),
            {"procAlive": proc.poll() is None, "userPid": upid or "(not running)",
             "ourProcesses": ours, "finalSessionState": state_final,
             "workshopAppLogTail": log_tail[-800:]},
        )

        diag = snapshot_diag(cdp)
        (BASE / "diag.json").write_text(json.dumps({"diag": diag}, ensure_ascii=False, indent=2), encoding="utf-8")
        results = {
            "packA": {
                "install": inst_a,
                "verify": verify_a,
                "session": {k: st_a.get(k) for k in ("state", "capabilities", "lastError")},
                "handshake": hs_a,
                "snapshot": {k: snap.get(k) for k in ("relPath", "revision", "diskHash", "hasContent", "contentLen", "title", "snippet", "reason")},
                "printResult": print_result,
                "lastEvent": last_event,
                "autoSnapshotRevision": auto_snap.get("revision"),
                "stopState": stop_state,
                "dom": {"docTitle": dom_title, "docContentHead": str(dom_content)[:160], "lastEvent": dom_last_event,
                        "errorText": err_text},
            },
            "packB": {
                "install": inst_b,
                "verify": verify_b,
                "session": {k: st_b.get(k) for k in ("state", "capabilities", "lastError")},
                "handshake": hs_b,
                "snapshot": {k: snap_b.get(k) for k in ("relPath", "revision", "hasContent", "contentLen", "title", "tags")},
                "titleCommand": title_cmd,
                "tagsCommand": tags_cmd,
                "errorCommand": (st_err or {}).get("lastError"),
                "disk": {"frontmatterAfterTitle": frontmatter_after_title, "frontmatterAfterTags": frontmatter_after_tags},
            },
        }
        observed = {
            "build": {"exe": str(EXE), "sha256": build_sha, "mtime": build_mtime},
            "packs": {
                "packA": {"id": PACK_A["id"], "capabilities": PACK_A["capabilities"], "sourceDir": str(dist_a)},
                "packB": {"id": PACK_B["id"], "capabilities": PACK_B["capabilities"],
                          "commands": PACK_B["commands"], "sourceDir": str(dist_b)},
            },
            "signing": build_info["build"].get("signing"),
            "buildZips": build_info["build"].get("zips"),
            "isolatedPdfDir": str(pdf_out),
            "results": results,
            "isolationResidualBanner": "E_ISOLATION_RESIDUAL" in body_text(cdp),
        }
    finally:
        if cdp is not None:
            try:
                failed_checks = [c for c in checks if not c.get("pass")]
                if failed_checks:
                    (BASE / "diag-fail.json").write_text(
                        json.dumps(
                            {
                                "failed": [c["name"] for c in failed_checks],
                                "diag": snapshot_diag(cdp),
                                "session": invoke(cdp, "workshop_pack_session_status", {}),
                                "appLogTail": log_path.read_text(encoding="utf-8", errors="replace")[-6000:] if log_path.exists() else None,
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                        encoding="utf-8",
                    )
            except Exception:
                pass
            cdp.close()
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
        cleanup_test_identifier()

    return {
        "observed": observed,
        "results": results,
        "diag": diag,
        "build": {"exe": str(EXE), "exe_sha256": build_sha, "exe_mtime": build_mtime},
    }


# ---------------- 证据写出 ----------------


def frontmatter_of(text: str) -> str:
    m = text.lstrip("\ufeff")
    parts = m.split("---")
    return parts[1] if len(parts) >= 3 else ""


def last_cmd(state: dict | None, name: str) -> dict | None:
    if not isinstance(state, dict):
        return None
    results = state.get("commandResults") or []
    for r in reversed(results):
        if isinstance(r, dict) and r.get("name") == name:
            return r
    return None


def snapshot_diag(cdp: CDP | None) -> dict:
    if cdp is None:
        return {"error": "cdp 未建立"}
    try:
        return cdp.eval(
            "({"
            " start: window.__keGuestStart || null,"
            " error: window.__keGuestError || null,"
            " statusLog: window.__keGuestStatusLog || null,"
            " dispatcherReady: window.__keDispatcherReady === true,"
            " heartbeats: window.__keGuestHeartbeats || 0,"
            " guestMsgs: (window.__keGuestMsgLog || []).slice(-8).map(p => ({phase: (p||{}).phase, connected: (p||{}).connected, lastError: (p||{}).lastError, statusText: (p||{}).statusText})),"
            " iframes: [...document.querySelectorAll('iframe')].map(f => ({ title: f.getAttribute('title'), src: f.getAttribute('src') })),"
            " buttons: [...document.querySelectorAll('button')].map(b => ({ text: (b.textContent||'').trim(), disabled: !!b.disabled })).filter(b => b.text).slice(0, 80),"
            " body: (document.body.innerText || '').slice(-2000)"
            "})"
        )
    except Exception as e:
        return {"error": str(e)}


def write_evidence_md(summary: dict, checks: list[dict], extra: dict) -> None:
    observed = extra.get("observed") or {}
    signing = observed.get("signing") or {}
    lines = [
        "# P5-T26 G7：pack A/B 参考 UI（SDK 发布形态）+ 产品 W 安装启用证据",
        "",
        f"- 生成时间：{summary['generated_at']}",
        "- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 11 + WebView2 隔离产品构建",
        f"- 测试构建：`{summary['build']['exe']}`（sha256=`{summary['build']['exe_sha256']}`，mtime=`{summary['build']['exe_mtime']}`）",
        f"- 参考包（源码）：`docs/ui-workshop/packs/pack-a/`、`docs/ui-workshop/packs/pack-b/`；构建工具 `docs/ui-workshop/tools/build_reference_packs.mjs`",
        f"- 签名：ed25519 keyId=`{signing.get('keyId')}`，公钥=`{signing.get('publicKeyHex')}`（**测试自签**；密钥只在 `C:\\ke-tmp` 隔离目录，不入仓）",
        f"- 被测包：A=`{PACK_A['id']}`（capabilities=`{json.dumps(PACK_A['capabilities'], ensure_ascii=False)}`）；"
        f"B=`{PACK_B['id']}`（capabilities=`{json.dumps(PACK_B['capabilities'], ensure_ascii=False)}`，commands=`{json.dumps(PACK_B['commands'])}`）",
        f"- 隔离工作区：`{summary.get('workspace')}`；隔离 APPDATA：`{summary.get('appdata')}`；测试文档：`{REL_PATH}`；PDF 输出：`{observed.get('isolatedPdfDir')}`",
        "- 启动 env：`KE_WS_PRINT_RENDER=1`（T16 隐藏打印 renderer 门控）+ `KE_WORKSHOP_PUBKEYS`（测试公钥）",
        "- 驱动方式：CDP 主窗口 + 浏览器级 `Target.attachToTarget`（flatten）附加 guest iframe（OOPIF）→ 在 **guest 真实 DOM** 上"
        "执行输入/按钮点击；结论同时读取 guest 状态镜像（`t19-guest-results`）与宿主侧会话/注册表/磁盘",
        "",
        "## 结论",
        "",
        f"**{'PASS' if summary['pass_count'] == summary['total'] else 'FAIL'}**：{summary['pass_count']}/{summary['total']} checks 通过。"
        "本证据只覆盖下列 checks；未覆盖/未执行的部分见「限制与残余风险」。",
        "",
        "## 被测参考包",
        "",
        "| 包 | 用例 | 能力（manifest 声明 / 运行期授予） | 构建产物 |",
        "| --- | --- | --- | --- |",
        f"| A | 侧栏读场景：快照正文/标题、document-saved 自动刷新、真实打印、错误展示 | "
        f"`{json.dumps(PACK_A['capabilities'], ensure_ascii=False)}` | `packs/dist/{PACK_A['id']}/` + `{PACK_A['id']}-1.0.0.zip` |",
        f"| B | Dock 写场景：快照/表单自动填充、command.invoke title/tags 落盘、错误展示 | "
        f"`{json.dumps(PACK_B['capabilities'], ensure_ascii=False)}`（写走声明式命令，不声明 context.write） | `packs/dist/{PACK_B['id']}/` + `{PACK_B['id']}-1.0.0.zip` |",
        "",
        "## Checks",
        "",
        "| # | check | 结果 | 关键值 |",
        "| --- | --- | --- | --- |",
    ]
    for i, c in enumerate(checks, 1):
        detail = json.dumps(c.get("detail"), ensure_ascii=False)
        if len(detail) > 260:
            detail = detail[:260] + "…"
        lines.append(f"| {i} | {c['name']} | {'PASS' if c['pass'] else 'FAIL'} | `{detail}` |")
    lines += [
        "",
        "## 关键实测值",
        "",
        "```json",
        json.dumps(observed.get("results") or {}, ensure_ascii=False, indent=2)[:12000],
        "```",
        "",
        "## 参考包实现要点（可复用）",
        "",
        "| 层 | 实现 |",
        "| --- | --- |",
        "| 包结构 | `manifest.json` + 入口 `index.html` + 相对引用 `pack.css` / `pack.js` / `vendor/guest-sdk.js`；构建工具回写 assets sha256/size、签名只进 dist、zip 根含 manifest+资产 |",
        "| SDK 形态 | 包内 vendored `docs/ui-workshop/sdk/dist/guest-sdk.js`（iife，全局 `KeWorkshopSDK`）；`autoConnect({requestedFeatures})` → 握手 → `request(method, params)` + 200ms `heartbeat()` |",
        "| pack A | 读 `context.snapshot`（content/contentBytes）展示标题/正文/revision/diskHash；按 wire 监听 `event`（document-saved → 自动重读）；「打印快照」→ `print.snapshot`（真实 PDF token，pages=null 不伪造）；错误框展示类型化错误 |",
        "| pack B | 读快照展示正文 + frontmatter 解析填充表单；`command.invoke` 提交 `article.set-title`/`article.set-tags`（宿主白名单 → 后端原子写 meta）；空标题 → 显示宿主拒绝错误 |",
        "| 能力最小化 | A 只声明 ui.shell/panel.sidebar/context.read/print.request；B 只声明 ui.shell/panel.dock/context.read（不声明 context.write，写走命令）；运行期能力与声明**逐项一致** |",
        "| 可观测性 | 状态镜像经既有 `t19-guest-results` 消息（宿主组件本就收集）→ 探针可读；UI 内同时有人类可读状态/错误 |",
        "",
        "## 限制与残余风险（如实记录）",
        "",
        "- **签名密钥为测试自签**：本证据用每次运行临时生成的 ed25519 密钥（`C:\\ke-tmp\\uiws-t26-g7\\keys\\`，不入仓；产物 dist 已 gitignore）；产品通过 `KE_WORKSHOP_PUBKEYS` 注入公钥。正式分发仍需密钥管理/信任根（W04 未完成项）。",
        "- **打印 renderer 仍是 env 门控（`KE_WS_PRINT_RENDER=1`）**：默认发布启动不创建隐藏 renderer，`print.snapshot` 会如实返回错误（不伪造成功）；参考包 A 的打印按钮在默认发布环境会显示该错误。产品化默认开启需 Rust 改动（T16 既有设计）。",
        "- **PDF 输出目录隔离用产品诊断覆盖**：Tauri `appDataDir()` 走 Windows known folder（不读 `APPDATA` env），探针设置 `window.__KE_PRINT_OUTPUT_DIR__=<C:\\ke-tmp>\\pdf-out`（生产不设置 → appDataDir）。该覆盖是测试/排障 seam。",
        "- **发布 SDK 0.1.0 没有事件订阅 API**：参考包按协议 wire 直接监听 `{type:'event', event}`；这是 SDK 发布形态的已知缺口（建议后续 `onEvent()`），未在本任务扩 SDK（超出允许改动范围）。",
        "- **guest 无「当前打开文档 relPath」发现通道**：协议握手与 `context-changed` 均不带当前文档路径；参考包 A 需用户输入路径或等 `document-saved` 事件（事件带 relPath）；B 同。属产品协议缺口（F 审计相关），参考包按现状实现。",
        "- **驱动方式说明**：探针通过 CDP 附加 guest iframe（OOPIF）后在 guest 真实 DOM 上点击/输入（等价用户操作），结论仍以 guest 状态镜像 + 宿主侧数据为准；这不是 mock，宿主/后端/SDK/协议全为真实链路。",
        "- **隔离残余风险（既有）**：guest 页面出现 `E_ISOLATION_RESIDUAL: guest 可见 __TAURI_INTERNALS__` 横幅（remote IPC 已拒绝），沿用 `evidence/P5-T26-A7-isolation.md` 结论，与参考包无关。",
        "- **frontmatter 解析为 demo 级**：参考包用简单正则解析 title/tags（覆盖行内/YAML 列表/逗号写法），不是完整 YAML 解析器；生产包应按需引入解析库（注意 CSP 禁网络，需内置）。",
        "- **打印页数不可得**：`pages: null`（Rust PrintToPdf 不回传页数，不伪造）。",
        "- **测试构建独立 identifier 目录清理**：`%APPDATA%\\com.astranota.uiws.e2e`（测试构建 identifier，非用户 App 数据）在开始/结束清理；用户 App（`D:\\AstraNota`）未运行，未触碰。",
        "- 本证据为**隔离测试构建**上的 Windows 产品 W，不等于官方 UI 全量基线；不替代 F01–F16 逐项登记。",
        "",
        "## 复现",
        "",
        "```powershell",
        "# 前置：sdk/dist/guest-sdk.js 已存在（node docs/ui-workshop/sdk/build.mjs）；",
        "#      隔离测试构建 C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe 已含 G1/G2/G3/G4（本任务未重建 exe）",
        "$env:PYTHONIOENCODING='utf-8'",
        "& 'C:\\Users\\y8882\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe' -X utf8 'F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_reference_packs_probe.py'",
        "```",
        "",
        f"原始 JSON：`docs/ui-workshop/evidence/{summary['results_file']}`",
        "",
    ]
    (EVID / "P5-T26-G7-reference-packs.md").write_text("\n".join(lines), encoding="utf-8")


# ---------------- main ----------------


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
    if not ok and last_error and not checks:
        checks = [{"name": "W-G7-0 探针执行", "pass": False, "detail": last_error[:2500]}]
    elif last_error:
        checks.append({"name": "W-G7-99 探针执行（最后尝试异常）", "pass": False, "detail": last_error[:2500]})

    build_info = (extra or {}).get("build") or {}
    if not build_info.get("exe") and EXE.exists():
        try:
            build_info = {
                "exe": str(EXE),
                "exe_sha256": sha_file(EXE),
                "exe_mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime)),
            }
        except Exception:
            build_info = {"exe": str(EXE), "exe_sha256": "N/A", "exe_mtime": "N/A"}
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 G7 参考包 A/B（发布 SDK 形态）产品 W：构建签名 → 安装 → trusted → 启用 guest → 真实 UI 读/写/打印/事件/错误",
        "branch": "feat/ui-workshop（本地，未 push/Release）",
        "evidence_note": (
            "被测对象是 docs/ui-workshop/packs 下的参考包 A/B；驱动方式为 CDP 附加 guest iframe（OOPIF）"
            "在 guest 真实 DOM 上输入/点击（等价用户操作），结论同时读取 guest 状态镜像、宿主会话/打印注册表与磁盘。"
        ),
        "attempts": attempts,
        "build": build_info,
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "pass": bool(checks) and all(c["pass"] for c in checks) and not last_error,
        "results_file": "T26-G7-reference-packs-results.json",
        "workspace": str(BASE / "workspace"),
        "appdata": str(BASE / "appdata"),
        "diag_file": str(BASE / "diag.json"),
    }
    payload = {
        **summary,
        "observed": (extra or {}).get("observed") or {},
        "raw": {
            "results": (extra or {}).get("results") or {},
            "diag": (extra or {}).get("diag"),
            "lastError": last_error[-4000:] if last_error else None,
        },
    }
    out = EVID / "T26-G7-reference-packs-results.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_evidence_md(summary, checks, extra or {})
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}", flush=True)
    return 0 if summary["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
