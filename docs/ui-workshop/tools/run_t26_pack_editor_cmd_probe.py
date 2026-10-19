# -*- coding: utf-8 -*-
"""T26 F03：pack B / pack A 受控编辑器命令桥 + 产品 W 探针（task-26/30/31）。

用法：默认验证 pack B；`--pack a` 验证 pack A（task-31，同一套 W 断言/负向）。

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
# 运行期包选择：默认 pack B；`--pack a` 切换 pack A（task-31）
PACK = {"id": PACK_B_ID, "slug": PACK_B_SLUG, "label": "pack B", "hook": "__packB", "prefix": "W-T26"}
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
# W07 task-33：4 条参数化无头命令（link/math/table；严格 args 校验）
PARAM_NAMES = ["editor.link.insert", "editor.math.inline", "editor.math.block", "editor.table.insert"]
# W07 task-29/33：3 条无参产品动作（table.insert 已升级为参数化命令，不在此列）
ACTION_NAMES = ["editor.footnote.insert", "editor.note.insert", "doc.save"]
ALL_DECLARED = PROTOCOL_NAMES + PARAM_NAMES + ACTION_NAMES  # 21 条 = 14 切换 + 4 参数化 + 3 无参动作


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

    argv = sys.argv[1:]
    if "--pack" in argv:
        idx = argv.index("--pack")
        if idx + 1 < len(argv) and argv[idx + 1].lower() == "a":
            PACK.update({"id": "com.astranota.examples.pack-a", "slug": "pack-a",
                         "label": "pack A", "hook": "__packA", "prefix": "W-T31"})
    print("PACK MODE:", PACK["label"], "| id:", PACK["id"], flush=True)
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
    packb_info = (build_info.get("packs") or {}).get(PACK["id"]) or {}
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
        "W-T26-1 pack B 构建/签名：manifest 声明 21 条协议名（14 切换 + 4 参数化 link/math/table + 3 无参动作）+ editor.commands.readonly；签名 ed25519/k1；构建期 manifest 校验通过",
        sorted(n for n in declared_names if n.startswith(("editor.", "doc."))) == sorted(ALL_DECLARED)
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
        verify = R.invoke(cdp, "workshop_pack_verify", {"id": PACK["id"], "version": "1.0.0"})
        check("W-T26-3 安装 pack B（Rust 安装 + 产品签名校验 valid）",
              inst.get("ok") is True and verify.get("ok") is True and verify.get("value") is True,
              {"install": inst, "verify": verify})
        if not R.click_dom(cdp, btn_sel):
            raise RuntimeError("无法点击工坊入口")
        R.wait_until(lambda: R.has_text(cdp, "授予信任") or R.has_text(cdp, "启用 guest"), 20, 0.25)
        body = R.body_text(cdp)
        sig_visible = "签名：valid" in body
        trust_clicked = R.click_card_button(cdp, PACK["id"], "授予信任")
        trusted = R.wait_until(lambda: R.card_has_text(cdp, PACK["id"], "信任：trusted"), 20, 0.25)
        check("W-T26-4 授予 pack B trusted（签名 valid + 信任 trusted；trusted 才授予 editor.commands.readonly）",
              bool(trust_clicked and trusted and sig_visible),
              {"trustClicked": trust_clicked, "trustedVisible": trusted, "signatureValidVisible": sig_visible})
        if not R.click_card_button(cdp, PACK["id"], "启用 guest"):
            raise RuntimeError("未找到 pack B「启用 guest」按钮: " + R.body_text(cdp)[:800])
        sid = R.wait_guest_session(cdp, PACK["slug"], 60)
        session = (R.invoke(cdp, "workshop_pack_session_status", {}) or {}).get("value") or {}
        check("W-T26-5 启用 pack B guest 会话 active（握手完成）",
              bool(sid) and session.get("state") == "active", {"sid": bool(sid), "session": session})
        R.wait_until(lambda: bool(R.guest_eval(cdp, PACK["slug"], "!!window." + PACK["hook"] + "InvokeCommand")), 30, 0.3)
        gs_expr = ("JSON.stringify({accepted: (window." + PACK["hook"] + "State||{}).acceptedFeatures||[],"
                   " cmds: window." + PACK["hook"] + "EditorCommands||[],"
                   " result: (document.getElementById('editor-command-result')||{}).textContent||''})")
        guest_state = R.guest_eval(cdp, PACK["slug"], gs_expr)
        try:
            gs = json.loads(guest_state or "{}")
        except Exception:
            gs = {}
        accepted = gs.get("accepted") or []
        check("W-T26-6 guest 握手：acceptedFeatures 含 editor.commands.readonly，pack B 声明 21 条协议名可见（14 切换 + 4 参数化 + 3 无参动作）",
              "editor.commands.readonly" in accepted and len(gs.get("cmds") or []) == 21,
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

        def place_host_caret() -> bool:
            """主窗口编辑器内放置折叠光标（段落内），供插入类动作使用。"""
            return bool(
                R.host_eval(
                    cdp,
                    "(() => { const el=document.querySelector('.ProseMirror'); if(!el) return false; el.focus();"
                    " const p=el.querySelector('p') || el; const s=window.getSelection(); const r=document.createRange();"
                    " const node=p.firstChild || p; try { r.setStart(node, 0); } catch (e) { r.selectNodeContents(el); }"
                    " r.collapse(true); s.removeAllRanges(); s.addRange(r); return true; })()",
                )
            )

        def host_undo() -> None:
            R.click_dom(cdp, "document.querySelector('button[title*=\"撤销\"]')")
            time.sleep(0.3)

        def guest_click(selector: str) -> bool:
            return bool(R.guest_click(cdp, PACK["slug"], selector))

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
                    cdp, PACK["slug"],
                    "(() => { const st=window." + PACK["hook"] + "State; const r=(st.commandResults||[]).slice().reverse().find(x=>x.name==='editor.bullet-list');"
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

        # ---- W07 task-29：4 条可无头产品动作（table / footnote / note / doc.save） ----
        # 24) editor.table.insert → 主窗口 table（3 行，含表头 th）+ 撤销还原
        place_host_caret()
        time.sleep(0.2)
        t_before = host_counts()
        clicked = guest_click("#btn-cmd-table-insert")
        grew = R.wait_until(lambda: (host_counts().get("tables") or 0) > (t_before.get("tables") or 0), 20, 0.25)
        table_info = R.host_eval(
            cdp,
            "(() => { const t=document.querySelector('.ProseMirror table'); if(!t) return null;"
            " return {rows:t.querySelectorAll('tr').length, th:t.querySelectorAll('th').length,"
            " cols:(t.querySelector('tr')||{children:{length:0}}).children.length, html:t.outerHTML.slice(0,220)}; })()",
        ) or {}
        host_undo()
        t_restored = R.wait_until(lambda: (host_counts().get("tables") or 0) == (t_before.get("tables") or 0), 20, 0.25)
        check("W-T26-24 guest 点击「插入表格 3×3」→ command.invoke(editor.table.insert) → 主窗口 DOM table 3行/3表头(th) 且撤销还原",
              bool(clicked and grew and table_info.get("rows", 0) >= 3 and table_info.get("th", 0) == 3 and t_restored),
              {"guestClick": clicked, "tableBefore": t_before.get("tables"), "tableInfo": table_info, "undoRestored": t_restored})
        time.sleep(0.2)

        # 25) editor.footnote.insert → 脚注引用/sup + 脚注区 DOM + 撤销还原
        place_host_caret()
        time.sleep(0.2)
        fn_before = R.host_eval(cdp, "(() => { const pm=document.querySelector('.ProseMirror');"
                                     " return {ref:pm.querySelectorAll('.ke-footnote-ref').length,"
                                     " section:pm.querySelectorAll('[data-ke-footnotes]').length,"
                                     " sup:pm.querySelectorAll('sup').length}; })()") or {}
        clicked = guest_click("#btn-cmd-footnote-insert")
        grew = R.wait_until(
            lambda: bool(R.host_eval(cdp, "(() => { const pm=document.querySelector('.ProseMirror');"
                                          " return pm.querySelectorAll('.ke-footnote-ref,[data-ke-footnotes],sup').length; })()"))
            and (R.host_eval(cdp, "document.querySelectorAll('.ProseMirror .ke-footnote-ref, .ProseMirror [data-ke-footnotes], .ProseMirror sup').length") or 0) > (fn_before.get("ref", 0) + fn_before.get("section", 0) + fn_before.get("sup", 0)),
            20, 0.25,
        )
        fn_after = R.host_eval(cdp, "(() => { const pm=document.querySelector('.ProseMirror');"
                                   " return {ref:pm.querySelectorAll('.ke-footnote-ref').length,"
                                   " section:pm.querySelectorAll('[data-ke-footnotes]').length,"
                                   " sup:pm.querySelectorAll('sup').length,"
                                   " html:pm.innerHTML.slice(0,240)}; })()") or {}
        host_undo()
        fn_restored = R.wait_until(lambda: (R.host_eval(cdp, "document.querySelectorAll('.ProseMirror .ke-footnote-ref, .ProseMirror [data-ke-footnotes], .ProseMirror sup').length") or 0) == (fn_before.get("ref", 0) + fn_before.get("section", 0) + fn_before.get("sup", 0)), 20, 0.25)
        fn_total_after = (fn_after.get("ref", 0) + fn_after.get("section", 0) + fn_after.get("sup", 0))
        check("W-T26-25 guest 点击「插入脚注」→ command.invoke(editor.footnote.insert) → 主窗口脚注 DOM（ke-footnote-ref/脚注区/sup）+ 撤销还原",
              bool(clicked and grew and fn_total_after > (fn_before.get("ref", 0) + fn_before.get("section", 0) + fn_before.get("sup", 0)) and fn_restored),
              {"guestClick": clicked, "before": fn_before, "after": fn_after, "undoRestored": fn_restored})
        time.sleep(0.2)

        # 26) editor.note.insert → ke-note（[data-ke-note]）+ 撤销还原
        place_host_caret()
        time.sleep(0.2)
        note_before = R.host_eval(cdp, "document.querySelectorAll('.ProseMirror [data-ke-note]').length")
        clicked = guest_click("#btn-cmd-note-insert")
        grew = R.wait_until(lambda: (R.host_eval(cdp, "document.querySelectorAll('.ProseMirror [data-ke-note]').length") or 0) > (note_before or 0), 20, 0.25)
        note_after = R.host_eval(cdp, "document.querySelectorAll('.ProseMirror [data-ke-note]').length")
        note_html = R.host_eval(cdp, "(() => { const n=document.querySelector('.ProseMirror [data-ke-note]'); return n?n.outerHTML.slice(0,200):null; })()")
        host_undo()
        note_restored = R.wait_until(lambda: (R.host_eval(cdp, "document.querySelectorAll('.ProseMirror [data-ke-note]').length") or 0) == (note_before or 0), 20, 0.25)
        check("W-T26-26 guest 点击「插入信息块」→ command.invoke(editor.note.insert) → 主窗口 [data-ke-note] + 撤销还原",
              bool(clicked and grew and note_restored and (note_after or 0) > (note_before or 0)),
              {"guestClick": clicked, "before": note_before, "after": note_after, "html": note_html, "undoRestored": note_restored})
        time.sleep(0.2)

        # 27) doc.save → 真实落盘（编辑 marker → guest 点击保存 → 等磁盘内容变化；不得只看返回值）
        doc_path = ws / "Articles" / REL_LEAF
        disk_before = doc_path.read_text(encoding="utf-8", errors="replace")
        mtime_before = doc_path.stat().st_mtime
        marker = "T30-DOC-SAVE-MARK"
        R.host_eval(cdp, "(() => { const el=document.querySelector('.ProseMirror'); if(!el) return false; el.focus();"
                         " const s=window.getSelection(); const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);"
                         " s.removeAllRanges(); s.addRange(r); return true; })()")
        cdp.call("Input.insertText", {"text": marker})
        time.sleep(0.6)
        marker_in_editor = marker in R.editor_text(cdp)
        marker_on_disk_before = marker in disk_before
        status_before = R.body_text(cdp)[-120:]
        save_clicked = guest_click("#btn-cmd-doc-save")
        saved_to_disk = R.wait_until(lambda: marker in doc_path.read_text(encoding="utf-8", errors="replace"), 30, 0.4)
        disk_after = doc_path.read_text(encoding="utf-8", errors="replace")
        mtime_after = doc_path.stat().st_mtime
        status_after = R.body_text(cdp)[-140:]
        save_echo = R.guest_eval(cdp, PACK["slug"], "(() => { const st=window." + PACK["hook"] + "State;"
                                                  " const r=(st.commandResults||[]).slice().reverse().find(x=>x.name==='doc.save');"
                                                  " return JSON.stringify(r||null); })()")
        check("W-T26-27 guest 点击「保存文档」→ command.invoke(doc.save) → 产品真实保存落盘（编辑 marker 后磁盘内容出现 marker、mtime 变化；不只看返回值）",
              bool(save_clicked and marker_in_editor and not marker_on_disk_before and saved_to_disk
                   and (mtime_after != mtime_before)),
              {"guestClick": save_clicked, "markerInEditor": marker_in_editor, "markerOnDiskBefore": marker_on_disk_before,
               "savedToDisk": saved_to_disk, "mtimeBefore": mtime_before, "mtimeAfter": mtime_after,
               "statusBefore": status_before, "statusAfter": status_after, "saveEcho": save_echo})
        # 清理：撤销 marker 并再次保存到磁盘（保持隔离工作区一致；失败不影响本轮结论）
        host_undo()
        time.sleep(0.4)
        guest_click("#btn-cmd-doc-save")
        R.wait_until(lambda: marker not in doc_path.read_text(encoding="utf-8", errors="replace"), 20, 0.4)

        # ---- W07 task-33：参数化命令（link / math / table）W 验证（真实 UI 输入 → guest 点击 → 主窗口 DOM） ----
        def guest_set(elem_id: str, value: str) -> bool:
            try:
                R.guest_set_input(cdp, PACK["slug"], "#" + elem_id, str(value))
                return True
            except Exception:
                return False

        def host_math_counts() -> dict:
            """ES5 实现（避免正则/箭头/展开等潜在 CDP eval 差异）：数学节点/链接/表格/宿主模态计数。"""
            q = ("(function(){var pm=document.querySelector('.ProseMirror'); if(!pm) return {err:'no-pm'};"
                 "function c(s){return pm.querySelectorAll(s).length;}"
                 "var links=pm.getElementsByTagName('a'); var w=0,w2=0;"
                 "for (var i=0;i<links.length;i++){var h=links[i].getAttribute('href')||'';"
                 " if(h==='https://example.com/w') w++; if(h==='https://example.com/w2') w2++;}"
                 "var modals=0; var ovs=document.querySelectorAll('.fixed.inset-0');"
                 "for (var j=0;j<ovs.length;j++){var t=ovs[j].innerText||'';"
                 " if(t.indexOf('行内公式')>=0||t.indexOf('块级公式')>=0) modals++;}"
                 "return {inlineMath:c('.ke-math--inline'), blockMath:c('.ke-math--block'), anyMath:c('.ke-math'),"
                 " hostModal:modals, linkW:w, linkW2:w2, tables:c('table')};})()")
            try:
                return R.host_eval(cdp, q) or {}
            except Exception as e:  # noqa: BLE001
                return {"err": str(e)[:200]}

        def find_link(href: str):
            q = ("(function(){var as=document.querySelectorAll('.ProseMirror a');"
                 "for (var i=0;i<as.length;i++){var a=as[i]; if((a.getAttribute('href')||'')===" + json.dumps(href) + "){"
                 "return {href:a.getAttribute('href'), text:(a.textContent||'').slice(0,40), html:a.outerHTML.slice(0,160)};}}"
                 "return null;})()")
            try:
                return R.host_eval(cdp, q)
            except Exception:
                return None

        # 28) link.insert（无选区，args via UI：href + text）
        place_host_caret()
        time.sleep(0.2)
        m_before = host_math_counts()
        set_ok = guest_set("link-href", "https://example.com/w") and guest_set("link-text", "W-LINK")
        clicked = guest_click("#btn-cmd-link-insert")
        link_ok = R.wait_until(lambda: int(host_math_counts().get("linkW") or 0) > 0, 20, 0.25)
        link_html = find_link("https://example.com/w") or {}
        host_undo()
        link_restored = R.wait_until(lambda: int(host_math_counts().get("linkW") or 0) == int(m_before.get("linkW") or 0), 20, 0.25)
        check("W-T26-28 guest 真实 UI 输入 URL/文本 → 点击「插入链接」→ command.invoke(editor.link.insert,{href,text}) → 主窗口 a[href=https://example.com/w] 且文本=W-LINK；撤销还原",
              bool(set_ok and clicked and link_ok and link_html.get("text") == "W-LINK" and link_restored),
              {"inputSet": set_ok, "guestClick": clicked, "link": link_html, "undoRestored": link_restored})
        time.sleep(0.2)

        # 29) link.insert（有选区路径：对选区 setLink）
        select_all_host()
        time.sleep(0.2)
        guest_set("link-href", "https://example.com/w2")
        clicked = guest_click("#btn-cmd-link-insert")
        link2_ok = R.wait_until(lambda: int(host_math_counts().get("linkW2") or 0) > 0, 20, 0.25)
        link2_cnt = int(host_math_counts().get("linkW2") or 0)
        host_undo()
        link2_restored = R.wait_until(lambda: int(host_math_counts().get("linkW2") or 0) == 0, 20, 0.25)
        check("W-T26-29 guest「插入链接」有选区路径 → 对选区 setLink → 主窗口 a[href=https://example.com/w2] 出现；撤销还原",
              bool(clicked and link2_ok and link2_cnt >= 1 and link2_restored),
              {"guestClick": clicked, "linkCount": link2_cnt, "undoRestored": link2_restored})
        time.sleep(0.2)

        # 30) math.inline（args via UI：latex）
        place_host_caret()
        time.sleep(0.2)
        m_before = host_math_counts()
        set_ok = guest_set("math-latex", "x^2+y^2")
        clicked = guest_click("#btn-cmd-math-inline")
        inline_ok = R.wait_until(lambda: int(host_math_counts().get("inlineMath") or 0) > int(m_before.get("inlineMath") or 0), 20, 0.25)
        m_after = host_math_counts()
        math_html = R.host_eval(cdp, "(() => { const n=document.querySelector('.ProseMirror .ke-math--inline'); return n?n.outerHTML.slice(0,220):null; })()")
        host_undo()
        inline_restored = R.wait_until(lambda: int(host_math_counts().get("inlineMath") or 0) == int(m_before.get("inlineMath") or 0), 20, 0.25)
        check("W-T26-30 guest 输入 LaTeX → 点击「插入行内公式」→ command.invoke(editor.math.inline,{latex}) → 主窗口 .ke-math--inline 出现且无 MathLive 弹窗；撤销还原",
              bool(set_ok and clicked and inline_ok and m_after.get("hostModal") == 0 and inline_restored),
              {"inputSet": set_ok, "guestClick": clicked, "inlineMath": m_after.get("inlineMath"), "hostModal": m_after.get("hostModal"),
               "nodeHtml": math_html, "undoRestored": inline_restored})
        time.sleep(0.2)

        # 31) math.block
        place_host_caret()
        time.sleep(0.2)
        m_before = host_math_counts()
        set_ok = guest_set("math-latex", "x^2+y^2")
        clicked = guest_click("#btn-cmd-math-block")
        block_ok = R.wait_until(lambda: int(host_math_counts().get("blockMath") or 0) > int(m_before.get("blockMath") or 0), 20, 0.25)
        m_after = host_math_counts()
        block_html = R.host_eval(cdp, "(() => { const n=document.querySelector('.ProseMirror .ke-math--block'); return n?n.outerHTML.slice(0,220):null; })()")
        host_undo()
        block_restored = R.wait_until(lambda: int(host_math_counts().get("blockMath") or 0) == int(m_before.get("blockMath") or 0), 20, 0.25)
        check("W-T26-31 guest 输入 LaTeX → 点击「插入块公式」→ command.invoke(editor.math.block,{latex}) → 主窗口 .ke-math--block 出现且无 MathLive 弹窗；撤销还原",
              bool(set_ok and clicked and block_ok and m_after.get("hostModal") == 0 and block_restored),
              {"inputSet": set_ok, "guestClick": clicked, "blockMath": m_after.get("blockMath"), "hostModal": m_after.get("hostModal"),
               "nodeHtml": block_html, "undoRestored": block_restored})
        time.sleep(0.2)

        # 32) table.insert（args rows=2, cols=4 → 真实尺寸）
        place_host_caret()
        time.sleep(0.2)
        t_before = host_math_counts()
        set_ok = guest_set("table-rows", "2") and guest_set("table-cols", "4")
        clicked = guest_click("#btn-cmd-table-insert")
        table_ok = R.wait_until(lambda: int(host_math_counts().get("tables") or 0) > int(t_before.get("tables") or 0), 20, 0.25)
        size = R.host_eval(cdp, "(() => { const ts=document.querySelectorAll('.ProseMirror table'); if(!ts.length) return null;"
                                " const t=ts[ts.length-1]; const rows=t.querySelectorAll('tr').length;"
                                " const cols=(t.querySelector('tr')||{children:{length:0}}).children.length;"
                                " return {rows:rows, cols:cols, html:t.outerHTML.slice(0,180)}; })()") or {}
        host_undo()
        table_restored = R.wait_until(lambda: int(host_math_counts().get("tables") or 0) == int(t_before.get("tables") or 0), 20, 0.25)
        check("W-T26-32 guest 输入 rows=2/cols=4 → 点击「插入表格」→ command.invoke(editor.table.insert,{rows,cols}) → 主窗口 table 真实尺寸 rows=2/cols=4；撤销还原",
              bool(set_ok and clicked and table_ok and size.get("rows") == 2 and size.get("cols") == 4 and table_restored),
              {"inputSet": set_ok, "guestClick": clicked, "size": size, "undoRestored": table_restored})
        time.sleep(0.2)

        # 33) 参数校验负向（E_BAD_PAYLOAD）+ DOM 不变
        def guest_invoke_capture(name: str, args) -> dict:
            expr = (
                "(async () => { const st = window." + PACK["hook"] + "State;"
                " const before = (st.commandResults || []).length;"
                " await window." + PACK["hook"] + "InvokeCommand(%s, %s);"
                " const r = (st.commandResults || [])[st.commandResults.length - 1] || {};"
                " return JSON.stringify({name: %s, ok: r.ok === true, error: r.error || null,"
                " added: (st.commandResults || []).length - before}); })()"
                % (json.dumps(name), json.dumps(args), json.dumps(name))
            )
            raw = R.guest_eval(cdp, PACK["slug"], expr)
            try:
                return json.loads(raw or "{}")
            except Exception:
                return {"raw": raw}

        dom_before_param_neg = host_math_counts()
        param_neg_cases = [
            ("link 危险 scheme", "editor.link.insert", {"href": "javascript:alert(1)", "text": "x"}),
            ("link 超长 href", "editor.link.insert", {"href": "https://example.com/" + "a" * 3000}),
            ("math 缺 latex", "editor.math.inline", {}),
            ("math 超长 latex", "editor.math.inline", {"latex": "x" * 2500}),
            ("table rows=99", "editor.table.insert", {"rows": 99, "cols": 3}),
            ("无参命令带 args（editor.bold）", "editor.bold", {"x": 1}),
        ]
        param_neg_results = []
        for label, name, args in param_neg_cases:
            r = guest_invoke_capture(name, args)
            param_neg_results.append({"label": label, "name": name, "args": args, **r})
        dom_after_param_neg = host_math_counts()
        param_neg_ok = all(
            (not n.get("ok")) and ("E_BAD_PAYLOAD" in str(n.get("error") or "")) for n in param_neg_results
        )
        param_dom_unchanged = (json.dumps(dom_before_param_neg, sort_keys=True) == json.dumps(dom_after_param_neg, sort_keys=True))
        check("W-T26-33 参数化负向：javascript scheme/超长 href/缺 latex/超长 latex/rows=99/无参命令带 args → 全部 E_BAD_PAYLOAD 且主窗口 DOM 不变（不执行）",
              param_neg_ok and param_dom_unchanged,
              {"cases": param_neg_results, "domUnchanged": param_dom_unchanged})

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
                "(async () => { const st = window." + PACK["hook"] + "State;"
                " const before = (st.commandResults || []).length;"
                " await window." + PACK["hook"] + "InvokeCommand(%s, {});"
                " const r = (st.commandResults || [])[st.commandResults.length - 1] || {};"
                " const le = st.lastError || null;"
                " return JSON.stringify({name: %s, ok: r.ok === true, error: r.error || null,"
                " lastErrorCode: le && (le.code || null), added: (st.commandResults || []).length - before}); })()"
                % (json.dumps(name), json.dumps(name))
            )
            raw = R.guest_eval(cdp, PACK["slug"], expr)
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
            ("未接对话框类（image.insert，未声明）", "editor.image.insert"),
            ("未接对话框类（module.insert，未声明）", "editor.module.insert"),
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
        declared_protocol = [n for n in declared_names if n.startswith(("editor.", "doc."))]
        legacy_rejected = all(
            any(n.get("name") == legacy and not n.get("ok") for n in neg_results)
            for legacy in ["editor.bulletList"]
        )
        check(
            "W-T26-18 协议名修复：21 条协议名全部可在 manifest 声明（14 切换含 3 kebab + 4 参数化 + 3 无参动作）；"
            "旧 camelCase 仍不可声明、guest 直调被 E_FORBIDDEN 拒绝（schema 限制，非缺陷）",
            sorted(declared_protocol) == sorted(ALL_DECLARED) and legacy_rejected and len(declared_protocol) == 21,
            {"declaredProtocol": declared_protocol, "legacyCamel": LEGACY_CAMEL, "legacyRejected": legacy_rejected},
        )

        # ---- 会话仍 active / 命令计数 ----
        session_final = (R.invoke(cdp, "workshop_pack_session_status", {}) or {}).get("value") or {}
        check("W-T26-19 探针结束：pack B 会话仍 active（命令桥未破坏会话）",
              session_final.get("state") == "active", {"session": session_final})
        if PACK["prefix"] == "W-T31":
            for c in checks:
                c["name"] = c["name"].replace("W-T26", "W-T31").replace("pack B", "pack A").replace("packB", "packA")
        result["pack"] = "a" if PACK["prefix"] == "W-T31" else "b"
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
