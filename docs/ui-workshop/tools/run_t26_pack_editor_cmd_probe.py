# -*- coding: utf-8 -*-
"""T26 F03：pack B 受控编辑器命令桥 + 产品 W 探针（task-26）。

验证链路：
  1) pack B（manifest.commands 逐条声明 11 条 editor.* + capability editor.commands.readonly）
     → build_reference_packs 构建/签名（复用 run_reference_packs_probe 的构建器）；
  2) 隔离产品实例（测试构建 exe、独立 APPDATA/工作区、KE_WORKSHOP_PUBKEYS）
     → workshop_pack_install → verify → 工坊面板「授予信任」→「启用 guest」；
  3) guest OOPIF 真实 DOM 点击「加粗/斜体/下划线/删除线/行内代码/标题1/2/3/引用/撤销/重做」
     → **主窗口 `.ProseMirror` DOM 真实断言**（strong/em/u/s/code/h1/h2/h3/blockquote；
     撤销/重做往返）；
  4) 负向：未声明/未知/大写命令名 → 宿主必须拒绝（E_FORBIDDEN 等），且不假成功、宿主编辑器不被改；
  5) 已知 schema 缺口：bulletList/orderedList/codeBlock（camelCase）无法在 manifest 声明 → 如实记录。

红线：不 push/Release、不伪造 W/PASS、用户 App N/A（只运行隔离测试构建）、不 taskkill /IM。
输出：C:\\ke-tmp\\uiws-t26-T26\\pack-editor-cmd-probe.json（含 checks/build/manifest/gaps）。
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

import websocket  # noqa: F401  （run_reference_packs_probe 依赖）

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import run_reference_packs_probe as R  # noqa: E402

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe")
BASE = Path(r"C:\ke-tmp\uiws-t26-T26")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
PACK_B_ID = "com.astranota.examples.pack-b"
PACK_B_SLUG = "pack-b"
REL_LEAF = "fe-ledger.md"
DOC_BODY_MARK = "F-LEDGER-BODY-MARKER"
DOC_CONTENT = (
    "# F 台账标题\n\n"
    "F-LEDGER-BODY-MARKER 这是一段用于官方 UI 与 guest 读取的台账正文。\n\n"
    "列表项一\n\n列表项二\n"
)

# 白名单（与 frontend productBrokerBackend.ts WORKSHOP_EDITOR_COMMAND_WHITELIST 逐字一致）
WHITELIST = [
    "bold", "italic", "underline", "strike", "code",
    "heading1", "heading2", "heading3", "bulletList", "orderedList",
    "blockquote", "codeBlock", "undo", "redo",
]
# W07 task-27：可写入 manifest 的**规范协议名**（多词命令 kebab-case；单命令词同内部键）
PROTOCOL_TO_COMMAND = {
    "editor.bold": "bold", "editor.italic": "italic", "editor.underline": "underline",
    "editor.strike": "strike", "editor.code": "code",
    "editor.heading1": "heading1", "editor.heading2": "heading2", "editor.heading3": "heading3",
    "editor.bullet-list": "bulletList", "editor.ordered-list": "orderedList",
    "editor.blockquote": "blockquote", "editor.code-block": "codeBlock",
    "editor.undo": "undo", "editor.redo": "redo",
}
PROTOCOL_NAMES = list(PROTOCOL_TO_COMMAND.keys())
# pack B manifest 声明（14 条规范协议名）
DECLARED = PROTOCOL_NAMES
# 旧 camelCase 协议名（仅后端 legacy 兼容直调；manifest schema 不允许大写 → 无法声明）
LEGACY_CAMEL = ["editor." + c for c in WHITELIST if "editor." + c not in PROTOCOL_TO_COMMAND]


def sha_file(p: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + json.dumps(detail, ensure_ascii=False)[:420], flush=True)

    if not EXE.exists():
        print("缺少测试构建:", EXE, flush=True)
        return 2
    R.BASE = BASE
    R.DIST = BASE / "dist"
    build_sha = sha_file(EXE)
    build_mtime = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime))
    result: dict = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "build": {"exe": str(EXE), "sha256": build_sha, "mtime": build_mtime},
        "whitelist": WHITELIST,
        "declared": DECLARED,
        "protocolNames": PROTOCOL_NAMES,
        "legacyCamel": LEGACY_CAMEL,
        "checks": checks,
    }
    # ---- 1) 构建/签名参考包（含 pack B manifest 校验） ----
    build_info = R.build_reference_packs(checks, check)
    packb_info = (build_info.get("packs") or {}).get(PACK_B_ID) or {}
    dist_b = Path(packb_info.get("distDir") or "")
    if not dist_b.is_absolute():
        dist_b = REPO / dist_b
    manifest = json.loads((dist_b / "manifest.json").read_text(encoding="utf-8"))
    declared_names = [c["name"] for c in manifest.get("commands", [])]
    result["manifest"] = {
        "distDir": str(dist_b),
        "capabilities": manifest.get("capabilities"),
        "commands": declared_names,
        "editorCommands": [n for n in declared_names if n.startswith("editor.")],
        "signatureKeyId": (manifest.get("signature") or {}).get("keyId"),
    }
    check(
        "W-T26-1 pack B 构建/签名：manifest 声明 14 条 editor.* 协议名（含 3 条 kebab）+ editor.commands.readonly；签名 ed25519/k1；构建期 manifest 校验通过",
        sorted(n for n in declared_names if n.startswith("editor.")) == sorted(DECLARED)
        and "editor.commands.readonly" in (manifest.get("capabilities") or [])
        and (manifest.get("signature") or {}).get("keyId") == "k1",
        {"editorCommands": [n for n in declared_names if n.startswith("editor.")],
         "capabilities": manifest.get("capabilities"), "legacyCamel": LEGACY_CAMEL},
    )

    # ---- 2) 隔离环境 ----
    R.cleanup()
    R.cleanup_test_identifier()
    appdata = BASE / "appdata"
    appdata.mkdir(parents=True, exist_ok=True)
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True, exist_ok=True)
    (ws / "Articles" / REL_LEAF).write_bytes(DOC_CONTENT.encode("utf-8"))
    ke_cfg = appdata / "KnowledgeEditor"
    ke_cfg.mkdir(parents=True, exist_ok=True)
    (ke_cfg / "app_config.json").write_text(
        json.dumps({"recent_workspaces": [str(ws)], "recent_documents": []}), encoding="utf-8"
    )
    (ke_cfg / "settings.json").write_text(
        json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}), encoding="utf-8"
    )
    env = {
        **os.environ,
        "APPDATA": str(appdata),
        "KE_WORKSPACE": str(ws),
        "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": build_info["publicKeyHex"]}}),
        "KE_WS_PRINT_RENDER": "1",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={R.CDP_PORT}",
        "TEMP": str(BASE / "temp"), "TMP": str(BASE / "temp"),
    }
    (BASE / "temp").mkdir(parents=True, exist_ok=True)
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, cwd=str(BASE), stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    try:
        if not R.wait_until(lambda: bool(R.main_targets()), 150, 0.3):
            raise RuntimeError("CDP 主窗口未就绪")
        cdp = R.main_cdp()
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        R.browser_connect()
        R.wait_until(lambda: bool(R.host_eval(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'")), 30, 0.25)
        btn_sel = "document.querySelector('button[aria-label=\"打开创意工坊\"]')"
        btn_bool = "!!document.querySelector('button[aria-label=\"打开创意工坊\"]')"
        R.wait_until(lambda: bool(R.host_eval(cdp, btn_bool)), 90, 0.25)
        check("W-T26-2 隔离产品实例启动 + CDP 就绪（工坊入口渲染）", bool(R.host_eval(cdp, btn_bool)),
              {"port": R.CDP_PORT, "exeSha256": build_sha, "exeMtime": build_mtime})
        # 打开台账文档（编辑器命令作用对象）
        R.wait_until(lambda: R.has_text(cdp, REL_LEAF), 60, 0.25)
        R.click_text(cdp, REL_LEAF)
        R.wait_until(lambda: DOC_BODY_MARK in R.editor_text(cdp), 45, 0.3)

        # ---- 3) 安装 → trusted → 启用 guest ----
        inst = R.invoke(cdp, "workshop_pack_install", {"sourceDir": str(dist_b)})
        verify = R.invoke(cdp, "workshop_pack_verify", {"id": PACK_B_ID, "version": "1.0.0"})
        check("W-T26-3 安装 pack B（Rust 安装 + 产品签名校验 valid）",
              inst.get("ok") is True and verify.get("ok") is True and verify.get("value") is True,
              {"install": inst, "verify": verify})
        if not R.click_dom(cdp, btn_sel):
            raise RuntimeError("无法点击工坊入口")
        R.wait_until(lambda: R.has_text(cdp, "授予信任") or R.has_text(cdp, "启用 guest"), 20, 0.25)
        body = R.body_text(cdp)
        sig_visible = "签名：valid" in body
        trust_clicked = R.click_card_button(cdp, PACK_B_ID, "授予信任")
        trusted = R.wait_until(lambda: R.card_has_text(cdp, PACK_B_ID, "信任：trusted"), 20, 0.25)
        check("W-T26-4 授予 pack B trusted（签名 valid + 信任 trusted；trusted 才授予 editor.commands.readonly）",
              bool(trust_clicked and trusted and sig_visible),
              {"trustClicked": trust_clicked, "trustedVisible": trusted, "signatureValidVisible": sig_visible})
        if not R.click_card_button(cdp, PACK_B_ID, "启用 guest"):
            raise RuntimeError("未找到 pack B「启用 guest」按钮: " + R.body_text(cdp)[:800])
        sid = R.wait_guest_session(cdp, PACK_B_SLUG, 60)
        session = (R.invoke(cdp, "workshop_pack_session_status", {}) or {}).get("value") or {}
        check("W-T26-5 启用 pack B guest 会话 active（握手完成）",
              bool(sid) and session.get("state") == "active", {"sid": bool(sid), "session": session})
        R.wait_until(lambda: bool(R.guest_eval(cdp, PACK_B_SLUG, "!!window.__packBInvokeCommand")), 30, 0.3)
        guest_state = R.guest_eval(
            cdp, PACK_B_SLUG,
            "JSON.stringify({accepted: (window.__packBState||{}).acceptedFeatures||[], cmds: window.__packBEditorCommands||[], result: (document.getElementById('editor-command-result')||{}).textContent||''})",
        )
        try:
            gs = json.loads(guest_state or "{}")
        except Exception:
            gs = {}
        accepted = gs.get("accepted") or []
        check("W-T26-6 guest 握手：acceptedFeatures 含 editor.commands.readonly，pack B 声明 14 条 editor.* 协议名可见",
              "editor.commands.readonly" in accepted and len(gs.get("cmds") or []) == 14,
              {"acceptedFeatures": accepted, "editorCommands": gs.get("cmds"), "handshake": session.get("handshake")})

        # ---- host 编辑器 DOM 断言工具 ----
        def host_counts() -> dict:
            return R.host_eval(
                cdp,
                "(() => { const pm=document.querySelector('.ProseMirror'); if(!pm) return {editor:false};"
                " const q=(s)=>pm.querySelectorAll(s).length;"
                " return {editor:true, strong:q('strong'), em:q('em'), u:q('u'), s:q('s,del,strike'),"
                " code:q('code'), ul:q('ul'), ol:q('ol'), pre:q('pre'),"
                " h1:q('h1'), h2:q('h2'), h3:q('h3'), blockquote:q('blockquote'),"
                " tables:q('table'), html:pm.innerHTML.slice(0,500)}; })()",
            ) or {}

        def select_all_host() -> bool:
            return bool(
                R.host_eval(
                    cdp,
                    "(() => { const el=document.querySelector('.ProseMirror'); if(!el) return false; el.focus();"
                    " const s=window.getSelection(); const r=document.createRange(); r.selectNodeContents(el);"
                    " s.removeAllRanges(); s.addRange(r); return String(s); })()",
                )
            )

        def host_undo() -> None:
            R.click_dom(cdp, "document.querySelector('button[title*=\"撤销\"]')")
            time.sleep(0.3)

        def guest_click(selector: str) -> bool:
            return bool(R.guest_click(cdp, PACK_B_SLUG, selector))

        # 11 条命令：guest 真实 DOM 点按钮 → 主窗口 DOM 断言（before/after）
        CASES = [
            ("editor.bold", "#btn-cmd-bold", "strong", "加粗"),
            ("editor.italic", "#btn-cmd-italic", "em", "斜体"),
            ("editor.underline", "#btn-cmd-underline", "u", "下划线"),
            ("editor.strike", "#btn-cmd-strike", "s", "删除线"),
            ("editor.code", "#btn-cmd-code", "code", "行内代码"),
            ("editor.heading1", "#btn-cmd-heading1", "h1", "标题1"),
            ("editor.heading2", "#btn-cmd-heading2", "h2", "标题2"),
            ("editor.heading3", "#btn-cmd-heading3", "h3", "标题3"),
            ("editor.blockquote", "#btn-cmd-blockquote", "blockquote", "引用"),
        ]
        positive_before = host_counts()
        for idx, (name, selector, key, label) in enumerate(CASES, start=7):
            select_all_host()
            time.sleep(0.15)
            before = host_counts()
            clicked = guest_click(selector)
            ok_wait = R.wait_until(lambda: (host_counts().get(key) or 0) > (before.get(key) or 0), 20, 0.25)
            after = host_counts()
            check(
                "W-T26-%d guest 点击「%s」→ command.invoke(%s) → 主窗口 DOM %s %d→%d"
                % (idx, label, name, key, before.get(key), after.get(key)),
                bool(clicked and ok_wait and (after.get(key) or 0) > (before.get(key) or 0)),
                {"command": name, "guestClick": clicked, "before": {key: before.get(key)}, "after": {key: after.get(key)},
                 "editorTouched": after.get("editor")},
            )
            host_undo()
            time.sleep(0.15)
        # ---- W07 task-27：3 条 kebab 多词命令（guest 真实 DOM 点击 → 主窗口 DOM 结构 + 撤销还原） ----
        KEBAB_CASES = [
            ("editor.bullet-list", "#btn-cmd-bullet-list", "ul", "无序列表", 20),
            ("editor.ordered-list", "#btn-cmd-ordered-list", "ol", "有序列表", 21),
            ("editor.code-block", "#btn-cmd-code-block", "pre", "代码块", 22),
        ]
        kebab_echo = None
        for name, selector, key, label, wid in KEBAB_CASES:
            select_all_host()
            time.sleep(0.15)
            before = host_counts()
            clicked = guest_click(selector)
            grew = R.wait_until(lambda: (host_counts().get(key) or 0) > (before.get(key) or 0), 20, 0.25)
            after = host_counts()
            host_undo()
            restored = R.wait_until(lambda: (host_counts().get(key) or 0) == (before.get(key) or 0), 20, 0.25)
            if name == "editor.bullet-list":
                kebab_echo = R.guest_eval(
                    cdp, PACK_B_SLUG,
                    "(() => { const st=window.__packBState; const r=(st.commandResults||[]).slice().reverse().find(x=>x.name==='editor.bullet-list');"
                    " return JSON.stringify(r ? {name:r.name, ok:r.ok, value:r.value} : null); })()",
                )
            check(
                "W-T26-%d guest 点击「%s」→ command.invoke(%s) → 主窗口 DOM %s %s→%s 且撤销还原"
                % (wid, label, name, key, before.get(key), after.get(key)),
                bool(clicked and grew and after.get(key) > before.get(key) and restored),
                {"command": name, "guestClick": clicked, "before": {key: before.get(key)}, "after": {key: after.get(key)},
                 "undoRestored": restored, "domHead": (after.get("html") or "")[:160]},
            )
            time.sleep(0.15)
        # 结果回显：value.name 为 guest 请求的 kebab 协议名、executed=true
        try:
            echo = json.loads(kebab_echo or "{}")
        except Exception:
            echo = {}
        # 协议响应形状 {ok:true, value:{name:'editor.bullet-list', executed:true}}；
        # SDK conn.request 返回该结果整体 → commandResults[].value = {ok, value:{name, executed}}
        inner = {}
        if isinstance(echo.get("value"), dict):
            v = echo["value"]
            inner = v.get("value") if isinstance(v.get("value"), dict) else v
        check("W-T26-23 guest 收到的 command.invoke 结果回显 {ok:true, value:{name: editor.bullet-list, executed:true}}（kebab 协议名原样回显）",
              bool(echo) and echo.get("ok") is True
              and inner.get("name") == "editor.bullet-list" and inner.get("executed") is True,
              {"ephemeralEcho": echo})

        # ---- 撤销 / 重做（往返） ----
        select_all_host()
        before_ur = host_counts()
        g_bold = guest_click("#btn-cmd-bold")
        bold_on = R.wait_until(lambda: (host_counts().get("strong") or 0) > 0, 20, 0.25)
        g_undo = guest_click("#btn-cmd-undo")
        undone = R.wait_until(lambda: (host_counts().get("strong") or 0) == 0, 20, 0.25)
        g_redo = guest_click("#btn-cmd-redo")
        redone = R.wait_until(lambda: (host_counts().get("strong") or 0) > 0, 20, 0.25)
        after_ur = host_counts()
        check("W-T26-16 guest 点「撤销/重做」→ 主窗口 DOM 往返（bold 生效→撤销消失→重做恢复）",
              bool(g_bold and bold_on and g_undo and undone and g_redo and redone),
              {"bold": g_bold, "boldOn": bold_on, "undoClicked": g_undo, "undone": undone,
               "redoClicked": g_redo, "redone": redone, "before": before_ur.get("strong"), "after": after_ur.get("strong")})
        host_undo()

        # ---- 负向：未声明 / 未知 / 大写名 → 宿主拒绝且不假成功、编辑器不被改 ----
        def guest_invoke_expect_error(name: str) -> dict:
            expr = (
                "(async () => { const st = window.__packBState;"
                " const before = (st.commandResults || []).length;"
                " await window.__packBInvokeCommand(%s, {});"
                " const r = (st.commandResults || [])[st.commandResults.length - 1] || {};"
                " const le = st.lastError || null;"
                " return JSON.stringify({name: %s, ok: r.ok === true, error: r.error || null,"
                " lastErrorCode: le && (le.code || null), added: (st.commandResults || []).length - before}); })()"
                % (json.dumps(name), json.dumps(name))
            )
            raw = R.guest_eval(cdp, PACK_B_SLUG, expr)
            try:
                return json.loads(raw or "{}")
            except Exception:
                return {"raw": raw}

        sel_host = select_all_host()
        dom_before_neg = host_counts()
        neg_cases = [
            ("大写命令名", "editor.Bold"),
            ("未知命令", "editor.explode"),
            ("camelCase 白名单但 manifest 无法声明", "editor.bulletList"),
        ]
        neg_results = []
        for label, name in neg_cases:
            r = guest_invoke_expect_error(name)
            neg_results.append({"label": label, "name": name, **r})
        dom_after_neg = host_counts()
        neg_ok = all((not n.get("ok")) and bool(n.get("error") or n.get("lastErrorCode")) for n in neg_results)
        unchanged = dom_before_neg.get("html") == dom_after_neg.get("html")
        check("W-T26-17 负向：大写/未知/未声明命令被宿主拒绝（E_FORBIDDEN 等，不假成功）且主窗口 DOM 不被修改",
              neg_ok and unchanged,
              {"selectionAll": sel_host, "negatives": neg_results, "domUnchanged": unchanged,
               "codes": [n.get("error") or n.get("lastErrorCode") for n in neg_results]})

        # ---- W07 task-27：kebab 修复验证（14 条规范协议名均可声明；legacy camelCase 仍被 broker 拒绝） ----
        declared_editor = [n for n in declared_names if n.startswith("editor.")]
        legacy_rejected = all(
            any(n.get("name") == legacy and not n.get("ok") for n in neg_results)
            for legacy in ["editor.bulletList"]
        )
        check(
            "W-T26-18 kebab 修复：14 条规范协议名全部可在 manifest 声明（含 editor.bullet-list/ordered-list/code-block）；"
            "旧 camelCase 仍不可声明、guest 直调被 E_FORBIDDEN 拒绝（schema 限制，非缺陷）",
            sorted(declared_editor) == sorted(DECLARED) and legacy_rejected and len(declared_editor) == 14,
            {"declaredEditor": declared_editor, "legacyCamel": LEGACY_CAMEL, "legacyRejected": legacy_rejected},
        )

        # ---- 会话仍 active / 命令计数 ----
        session_final = (R.invoke(cdp, "workshop_pack_session_status", {}) or {}).get("value") or {}
        check("W-T26-19 探针结束：pack B 会话仍 active（命令桥未破坏会话）",
              session_final.get("state") == "active", {"session": session_final})
        result["positiveCount"] = sum(1 for c in checks if c["pass"])
        result["summary"] = {"total": len(checks), "pass": sum(1 for c in checks if c["pass"])}
        result["guestStateTail"] = gs
        result["negativeResults"] = neg_results
        result["appLogTail"] = R.read_log(log_path)[-1200:] if hasattr(R, "read_log") else ""
    finally:
        if cdp is not None:
            try:
                cdp.close()
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
        R.cleanup()
        try:
            log.close()
        except Exception:
            pass
        R.cleanup_test_identifier()

    out = BASE / "pack-editor-cmd-probe.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY checks=%d/%d -> %s" % (
        (result.get("summary") or {}).get("pass", 0), (result.get("summary") or {}).get("total", 0), out), flush=True)
    return 0 if (result.get("summary") or {}).get("pass") == (result.get("summary") or {}).get("total") else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        R.cleanup()
        sys.exit(1)
