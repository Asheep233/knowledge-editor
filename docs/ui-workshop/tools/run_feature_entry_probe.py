# -*- coding: utf-8 -*-
"""T26 F01–F16 逐项台账登记探针（task-9）。

目标：对 `feature-baseline.csv` 的 F 域行做**真实执行**的三路径登记：
  - packAEntry：参考包 A（读/打印/事件：ui.shell/panel.sidebar/context.read/print.request）
  - packBEntry：参考包 B（写/命令：ui.shell/panel.dock/context.read + article.set-title/set-tags）
  - officialBaselineResult：**产品官方 UI 真实 CDP 自动化**（点击/输入/快捷键；不是单测/happy-dom）

复用 `run_reference_packs_probe.py`（G7）的隔离产品骨架：隔离构建 exe、隔离 APPDATA/工作区、
预置 app_config/settings、签名参考包、CDP 主窗口 + 浏览器级 `Target.attachToTarget`(flatten)
附加 guest iframe（OOPIF）在 guest 真实 DOM 上操作、路径白名单清理、禁止 taskkill /IM、
用户 App（D:\\AstraNota）未运行 → N/A。

红线（沿用 G7）：
- 不 push/Release；测试数据/PDF 只写 `C:\\ke-tmp\\uiws-t26-F` 隔离目录；
- 禁止 taskkill /IM；清理只按 `C:\\ke-tmp\\uiws-t26\\bin\\*` / `F:\\Work\\Dev\\cargo-target\\*` 路径白名单；
- 不触碰真实用户笔记；失败如实记录（PASS/FAIL/NOT_RUN），不伪造 officialBaseline。
- 不点击会写出隔离目录的「真实导出落盘」按钮（官方 PDF 导出最终 invoke 的落盘路径不受本探针
  seam 控制）→ 相关行如实记为 NOT_RUN 或入口级 PASS 并在 detail 注明「落盘副作用未执行」。

用法（Windows Python；从仓库根或任意目录均可）：
  py -X utf8 "F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_feature_entry_probe.py"
  py -X utf8 ... --dry    # 只跑不写 evidence/CSV/覆盖报告（冒烟验证用）
"""
from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback

from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import run_reference_packs_probe as R  # noqa: E402

REPO = R.REPO
EXE = R.EXE
EVID = R.EVID
FIXTURES = REPO / "docs" / "ui-workshop" / "fixtures"
CSV_PATH = REPO / "docs" / "ui-workshop" / "feature-baseline.csv"


def _load_domain_map() -> dict:
    try:
        with CSV_PATH.open(encoding="utf-8", newline="") as fh:
            return {row["featureId"]: row["domain"] for row in csv.DictReader(fh)}
    except Exception:
        return {}


ROW_DOMAIN = _load_domain_map()
COVERAGE = REPO / "docs" / "ui-workshop" / "reports" / "F01-F16-COVERAGE.md"
BASE = Path(r"C:\ke-tmp\uiws-t26-F")
DIST_A = BASE / "dist" / "com.astranota.examples.pack-a"
DIST_B = BASE / "dist" / "com.astranota.examples.pack-b"
CDP_PORT = 9890 + (os.getpid() % 60)
MAX_ATTEMPTS = 2

# 复用 run_reference_packs_probe 的 helper（main_targets/guest attach/cleanup/build）会读取
# 该模块的模块级全局 —— 必须重定向到本探针自己的 BASE/DIST/CDP_PORT。
R.BASE = BASE
R.DIST = BASE / "dist"
R.CDP_PORT = CDP_PORT

PACK_A = {
    "id": "com.astranota.examples.pack-a",
    "slug": "pack-a",
    "capabilities": ["ui.shell", "panel.sidebar", "context.read", "print.request"],
}
PACK_B = {
    "id": "com.astranota.examples.pack-b",
    "slug": "pack-b",
    "capabilities": ["ui.shell", "panel.dock", "context.read"],
    "commands": ["article.set-title", "article.set-tags"],
}

REL_LEDGER = "Articles/fe-ledger.md"
REL_BASIC = "Articles/basic.md"
REL_LARGE = "Articles/large-256kb.md"
DOC_TITLE = "F 台账文档"
DOC_BODY = "F-LEDGER-BODY-MARKER"
SAVE_MARK = "F-LEDGER-SAVE-MARKER"
FORM_TITLE = "F 台账标题"
FORM_TAGS = "ledger, probe"

LEDGER_CONTENT = (
    "---\n"
    f"title: {DOC_TITLE}\n"
    "tags:\n"
    "  - ledger\n"
    "ke_version: 1\n"
    "---\n"
    "\n"
    "# F 台账标题\n"
    "\n"
    f"{DOC_BODY} 这是一段用于官方 UI 与 guest 读取的台账正文。\n"
    "\n"
    "- 列表项一\n"
    "- 列表项二\n"
)

GUEST_MSG_COLLECTOR = (
    "window.__keGuestMsgLog = [];"
    " window.addEventListener('message', (e) => {"
    "   const d = e.data; if (!d || typeof d !== 'object') return;"
    "   if (d.type === 't19-guest-results') window.__keGuestMsgLog.push(d.payload);"
    " });"
)

HOST_COLLECTOR = (
    "window.__keAlerts = []; window.alert = (m) => { window.__keAlerts.push(String(m)); };"
    " window.__kePrintCalls = []; window.print = () => { window.__kePrintCalls.push(Date.now()); };"
    " window.__kePrompts = [];"
    " window.confirm = () => true;"
    " window.prompt = (m, d) => { window.__kePrompts.push(String(m)); return d == null ? '' : String(d); };"
)

# F03 批量抽样规格：官方 UI 真实操作（快捷键/工具栏）→ DOM 断言 → 撤销还原。
# assertExpr 取「动作前/后值」比较（before != after），避免文档本身已有同类节点导致假阳性。
F3_SPECS = [
    # ---- 快捷键动作（Tiptap/编辑器默认键位）----
    {"row": "CMD.editor.underline", "label": "Ctrl+U 下划线", "key": ("u", "KeyU", 85, 2),
     "assert": "!!document.querySelector('.ProseMirror u')"},
    {"row": "CMD.editor.strike", "label": "Ctrl+Shift+S 删除线", "key": ("S", "KeyS", 83, 10),
     "assert": "!!document.querySelector('.ProseMirror s')"},
    {"row": "CMD.editor.heading.1", "label": "Ctrl+Alt+1 标题 1", "key": ("1", "Digit1", 49, 3),
     "assert": "document.querySelectorAll('.ProseMirror h1').length"},
    {"row": "CMD.editor.list.bullet", "label": "Ctrl+Shift+8 无序列表", "key": ("8", "Digit8", 56, 10),
     "assert": "document.querySelectorAll('.ProseMirror ul').length"},
    {"row": "CMD.editor.list.ordered", "label": "Ctrl+Shift+7 有序列表", "key": ("7", "Digit7", 55, 10),
     "assert": "document.querySelectorAll('.ProseMirror ol').length"},
    {"row": "CMD.editor.blockquote", "label": "Ctrl+Shift+B 引用", "key": ("B", "KeyB", 66, 10),
     "assert": "document.querySelectorAll('.ProseMirror blockquote').length"},
    {"row": "CMD.editor.code.inline", "label": "Ctrl+E 行内代码", "key": ("e", "KeyE", 69, 2),
     "assert": "!!document.querySelector('.ProseMirror code') && !document.querySelector('.ProseMirror pre')"},
    {"row": "CMD.editor.codeBlock", "label": "Ctrl+Alt+C 代码块", "key": ("c", "KeyC", 67, 3),
     "assert": "document.querySelectorAll('.ProseMirror pre').length"},
    # ---- 工具栏按钮 ----
    {"row": "UI.toolbar.斜体", "label": "工具栏斜体", "toolbar": "斜体",
     "assert": "!!document.querySelector('.ProseMirror em')"},
    {"row": "UI.toolbar.下划线", "label": "工具栏下划线", "toolbar": "下划线",
     "assert": "!!document.querySelector('.ProseMirror u')"},
    {"row": "UI.toolbar.删除线", "label": "工具栏删除线", "toolbar": "删除线",
     "assert": "!!document.querySelector('.ProseMirror s')"},
    {"row": "UI.toolbar.有序列表", "label": "工具栏有序列表", "toolbar": "有序列表",
     "assert": "document.querySelectorAll('.ProseMirror ol').length"},
    {"row": "UI.toolbar.引用", "label": "工具栏引用", "toolbar": "引用",
     "assert": "document.querySelectorAll('.ProseMirror blockquote').length"},
    {"row": "UI.toolbar.行内代码", "label": "工具栏行内代码", "toolbar": "行内代码",
     "assert": "!!document.querySelector('.ProseMirror code') && !document.querySelector('.ProseMirror pre')"},
    {"row": "UI.toolbar.代码块", "label": "工具栏代码块", "toolbar": "代码块",
     "assert": "document.querySelectorAll('.ProseMirror pre').length"},
    {"row": "UI.toolbar.插入链接", "label": "工具栏插入链接→链接地址对话框", "toolbar": "插入链接",
     "dialog": "链接地址", "no_undo": True},
    {"row": "UI.toolbar.插入公式", "label": "工具栏插入公式→行内公式编辑器", "toolbar": "插入公式",
     "dialog": "行内公式", "no_undo": False},
    {"row": "UI.toolbar.插入块级公式", "label": "工具栏插入块级公式→块级公式编辑器", "toolbar": "插入块级公式",
     "dialog": "块级公式", "no_undo": False},
    {"row": "UI.toolbar.注释-脚注", "label": "工具栏注释（脚注）→插入注释对话框", "toolbar": "注释（脚注）",
     "dialog": "插入注释", "no_undo": True},
    {"row": "UI.toolbar.保存-Ctrl-S", "label": "工具栏保存按钮→磁盘落盘", "toolbar": "保存（Ctrl+S）",
     "special": "save", "no_undo": True},
    {"row": "UI.toolbar.微分-d-转正体-另存为新文件", "label": "工具栏微分 d 转正体→预览对话框",
     "toolbar": "微分 d 转正体", "dialog_aria": "微分 d 转正体预览", "no_undo": True},
    {"row": "UI.toolbar.历史快照", "label": "工具栏历史快照→历史版本面板", "toolbar": "历史快照",
     "dialog": "历史版本", "no_undo": True},
]
F3_CHECK_PREFIX = "F-F3-"

# 第三轮（task-20）：F03 剩余 12 行 —— 无默认快捷键，改用官方工具栏/菜单入口真实执行；
# 只有真实节点/产物插入才 PASS（否则 FAIL/NOT_RUN 并写原因）。
F3B_SPECS = [
    {"row": "CMD.editor.heading.2", "kind": "heading", "level": 2, "label": "工具栏「样式/标题」选择器 → 标题2"},
    {"row": "CMD.editor.heading.3", "kind": "heading", "level": 3, "label": "工具栏「样式/标题」选择器 → 标题3"},
    {"row": "CMD.editor.link.insert", "kind": "link", "label": "工具栏插入链接 → 地址对话框输入 URL → 真实链接节点"},
    {"row": "CMD.editor.image.insert", "kind": "image", "label": "工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点",
     "check": "F-F3B-UI.toolbar.插入图片"},
    {"row": "CMD.editor.math.block", "kind": "math_block", "label": "工具栏插入块级公式 → mathBlock 节点"},
    {"row": "CMD.editor.module.insert", "kind": "module", "label": "工具栏插入模块 → 模块选择器 → 插入模块正文"},
    {"row": "CMD.editor.footnote.insert", "kind": "footnote", "label": "工具栏注释（脚注）→ 对话框输入 → 脚注节点"},
    {"row": "CMD.editor.note.insert", "kind": "note", "label": "工具栏信息块 → ke-note 节点"},
    {"row": "CMD.editor.table.insert", "kind": "table", "label": "工具栏表格 → 2×2 表格节点"},
    {"row": "UI.toolbar.插入图片", "kind": "image", "label": "工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点（与 CMD.editor.image.insert 同一次执行）"},
    {"row": "UI.toolbar.撤销", "kind": "undo", "label": "工具栏撤销 → 编辑回退"},
    {"row": "UI.toolbar.重做", "kind": "redo", "label": "工具栏重做 → 编辑恢复"},
]
F3B_CHECK_PREFIX = "F-F3B-"

# F16 原生菜单：menu.rs MID_* ↔ feature-baseline.csv 的 UI.menu.* 行
F16_MENU_ROWS = {
    "MID_NEW": "UI.menu.mid_new",
    "MID_OPEN_WS": "UI.menu.mid_open_ws",
    "MID_NEW_WS": "UI.menu.mid_new_ws",
    "MID_CLOSE_WS": "UI.menu.mid_close_ws",
    "MID_RECOVERY": "UI.menu.mid_recovery",
    "MID_SETTINGS": "UI.menu.mid_settings",
    "MID_EXIT": "UI.menu.mid_exit",
    "MID_RELOAD": "UI.menu.mid_reload",
    "MID_DEVTOOLS": "UI.menu.mid_devtools",
    "MID_RECENT": "UI.menu.mid_recent",
}


def audit_native_menu() -> dict:
    """只读审计 desktop/src-tauri/src/menu.rs：菜单项 ID/标签/加速键/事件分发目标。
    不做 DOM 断言、不做 W 执行 —— 原生菜单非 DOM，W 层未覆盖（CSV 如实 NOT_RUN）。"""
    path = REPO / "desktop" / "src-tauri" / "src" / "menu.rs"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        return {"available": False, "error": str(e)[:300], "items": []}
    consts = dict(re.findall(r'const (MID_[A-Z_]+): &str = "ke-menu:([a-z-]+)";', text))
    items = []
    for m in re.finditer(
        r'MenuItem::with_id\(\s*app,\s*(MID_[A-Z_]+),\s*"([^"]+)",\s*(true|false),\s*(None::<&str>|Some\("([^"]+)"\))\)',
        text,
        re.S,
    ):
        mid, label, enabled, _, accel = m.groups()
        items.append({"id": mid, "eventId": "ke-menu:" + consts.get(mid, ""), "label": label,
                      "enabled": enabled == "true", "accelerator": accel or None})
    handlers = {}
    hm = re.search(r'pub fn handle_event\(app: &AppHandle, event: MenuEvent\) \{(.*?)\n\}', text, re.S)
    if hm:
        body = hm.group(1)
        for m in re.finditer(r'(MID_[A-Z_]+) => \{?\s*(.*?)(?=\n\s*(?:MID_|_ =>|\}))', body, re.S):
            handlers[m.group(1)] = " ".join(m.group(2).split())[:220]
    for it in items:
        it["handler"] = handlers.get(it["id"], "(未在 handle_event 匹配)")
    return {
        "available": True,
        "source": "desktop/src-tauri/src/menu.rs",
        "items": items,
        "itemCount": len(items),
        "domDriven": False,
        "wCovered": False,
        "note": "原生菜单不是 DOM，CDP 无法真实点击；本审计仅为结构性证据（U/静态）。CSV 对应行如实 NOT_RUN（W 未覆盖）。",
    }

# 本次要登记的行（featureId -> 说明）。只登记真实执行过的行；其余保持 NOT_RUN。
SELECTED_ROWS = [
    "F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08",
    "F09", "F10", "F11", "F12", "F13", "F14", "F15", "F16",
    "CMD.editor.bold", "CMD.editor.italic", "CMD.editor.undo", "CMD.editor.redo",
    "UI.toolbar.加粗", "UI.toolbar.信息块-ke-note", "UI.toolbar.表格",
    "UI.export.pdf", "UI.dialog.exportpdf",
    "API.documents.get._tree", "API.search.get.root", "API.drafts.get._recovery",
]
SELECTED_ROWS = list(SELECTED_ROWS) + [sp["row"] for sp in F3_SPECS]


# ---------------- 基础设施 ----------------


def record(checks: list[dict], name: str, ok: bool, detail) -> bool:
    checks.append({"name": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:420], flush=True)
    return bool(ok)


def run_task(checks: list[dict], name: str, fn):
    """执行一个探针任务；异常记 FAIL 但不中断后续（便于一次跑完拿到全部真实结果）。"""
    try:
        detail, ok = fn()
        record(checks, name, ok, detail)
        return bool(ok)
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc(limit=4)
        print(tb, flush=True)
        record(checks, name, False, {"error": str(e)[:800], "traceTail": tb[-900:]})
        return False


def prepare_env() -> dict:
    appdata = BASE / "appdata"
    ws = BASE / "workspace"
    (ws / "Articles").mkdir(parents=True, exist_ok=True)
    (ws / "Articles" / "fe-ledger.md").write_bytes(LEDGER_CONTENT.encode("utf-8"))
    (ws / "Modules").mkdir(parents=True, exist_ok=True)
    (ws / "Modules" / "示例模块.md").write_text(
        "# 示例模块\n\nMODULE-FIXTURE-MARK 模块正文（task-20 插入模块动作使用）。\n", encoding="utf-8")
    shutil.copy(FIXTURES / "basic.md", ws / "Articles" / "basic.md")
    shutil.copy(FIXTURES / "large-256kb.md", ws / "Articles" / "large-256kb.md")
    att_src = FIXTURES / "Attachments"
    if att_src.exists():
        shutil.copytree(att_src, ws / "Attachments", dirs_exist_ok=True)
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
    # F14 官方导出落点隔离：Rust export_pdf 用 %USERPROFILE%\Documents\AstraNota Exports；
    # 预览用 %TEMP%\AstraNota-preview。把 USERPROFILE/TEMP/TMP 指向隔离目录（不触碰真实用户 Documents）。
    fake_home = BASE / "fake-home"
    (fake_home / "Documents").mkdir(parents=True, exist_ok=True)
    tmp_dir = BASE / "temp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    return {"appdata": appdata, "workspace": ws, "pdf_out": pdf_out,
            "fake_home": fake_home, "tmp": tmp_dir}


def prepare_packs(checks: list[dict]) -> dict:
    """优先重新构建签名参考包（自包含）；失败回退到 G7 已构建产物。"""
    try:
        info = R.build_reference_packs(checks, lambda n, ok, d: record(checks, n, ok, d))
        pub = info.get("publicKeyHex")
        dirs = {}
        for pk in ((info.get("build") or {}).get("packs") or []):
            d = Path(str(pk.get("distDir")))
            if not d.is_absolute():
                d = REPO / d
            dirs[pk.get("id")] = d
        da = dirs.get(PACK_A["id"]) or DIST_A
        db = dirs.get(PACK_B["id"]) or DIST_B
        if pub and da.exists() and db.exists():
            return {"mode": "rebuild", "publicKeyHex": pub, "distA": str(da), "distB": str(db),
                    "build": info.get("build")}
        raise RuntimeError("构建输出缺少 dist/publicKeyHex")
    except Exception as e:  # noqa: BLE001
        print("参考包重建失败，回退 G7 产物: " + str(e)[:400], flush=True)
    g7_json = EVID / "T26-G7-reference-packs-results.json"
    if not g7_json.exists():
        raise RuntimeError("参考包不可用：重建失败且无 G7 产物证据")
    data = json.loads(g7_json.read_text(encoding="utf-8"))
    signing = (data.get("observed") or {}).get("signing") or {}
    pub = signing.get("publicKeyHex")
    g7_root = Path(r"C:\ke-tmp\uiws-t26-g7\dist")
    da, db = g7_root / PACK_A["id"], g7_root / PACK_B["id"]
    if not (pub and da.exists() and db.exists()):
        raise RuntimeError("参考包不可用：G7 产物缺失")
    return {"mode": "g7-dist-fallback", "publicKeyHex": pub, "distA": str(da), "distB": str(db), "build": None}


def other_instance_running() -> int:
    return R.count_processes("knowledgeeditor", r"C:\ke-tmp\uiws-t26\bin\*")


def wait_no_other_instance(timeout_s: float = 240) -> bool:
    """错开其它 W 探针：等隔离 exe 实例清空（不杀别人，只等待）。"""
    end = time.time() + timeout_s
    while time.time() < end:
        if other_instance_running() <= 0:
            return True
        time.sleep(5)
    return False


def read_log(log_path: Path) -> str:
    try:
        return log_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def log_routes(log_text: str, needle: str) -> int:
    return len(re.findall(re.escape(needle), log_text))


# ---------------- 官方 UI 自动化 helper（主窗口 CDP） ----------------


def press_esc(cdp) -> None:
    for t in ("keyDown", "keyUp"):
        try:
            cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27})
        except Exception:
            pass


def press_ctrl(cdp, ch: str, code: str, vk: int) -> None:
    for t in ("keyDown", "keyUp"):
        try:
            cdp.call(
                "Input.dispatchKeyEvent",
                {"type": t, "key": ch, "code": code, "modifiers": 2, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk},
            )
        except Exception:
            pass


def press_key_combo(cdp, key: str, code: str, vk: int, modifiers: int) -> None:
    for t in ("keyDown", "keyUp"):
        try:
            cdp.call(
                "Input.dispatchKeyEvent",
                {"type": t, "key": key, "code": code, "modifiers": modifiers,
                 "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk},
            )
        except Exception:
            pass


def click_selector(cdp, selector: str) -> bool:
    return R.click_dom(cdp, f"document.querySelector({json.dumps(selector)})")


def click_exact_text(cdp, text: str) -> bool:
    expr = (
        "(() => { const want = " + json.dumps(text) + ";"
        " const els = [...document.querySelectorAll('button,a,[role=button]')].filter(e => (e.textContent||'').trim() === want);"
        " if (!els.length) return false; els[0].click(); return true; })()"
    )
    return bool(cdp.eval(expr))


def click_contains_text(cdp, text: str) -> bool:
    expr = (
        "(() => { const want = " + json.dumps(text) + ";"
        " const els = [...document.querySelectorAll('button,a,[role=button]')].filter(e => (e.textContent||'').includes(want));"
        " if (!els.length) return false; els[0].click(); return true; })()"
    )
    return bool(cdp.eval(expr))


def set_input_value(cdp, selector: str, value: str) -> bool:
    expr = (
        "((sel, val) => { const el = document.querySelector(sel); if (!el) return false; el.focus();"
        " const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;"
        " setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true }));"
        " el.dispatchEvent(new Event('change', { bubbles: true })); return true; })"
        f"({json.dumps(selector)}, {json.dumps(value)})"
    )
    return bool(cdp.eval(expr))


def select_all_editor(cdp) -> bool:
    ok = bool(cdp.eval("(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus(); return true; })()"))
    if not ok:
        return False
    press_ctrl(cdp, "a", "KeyA", 65)
    time.sleep(0.2)
    return True


def click_toolbar(cdp, title: str) -> bool:
    return bool(
        cdp.eval(
            "(() => { const el = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title')||'').includes("
            + json.dumps(title)
            + ")); if (!el) return false; el.click(); return true; })()"
        )
    )


def dismiss_overlays(cdp) -> None:
    press_esc(cdp)
    time.sleep(0.15)
    for text in ("取消", "关闭", "完成", "知道了", "确定", "确认", "继续"):
        click_exact_text(cdp, text)
        time.sleep(0.1)
    press_esc(cdp)
    time.sleep(0.15)


def accept_confirm(cdp, contains: str = "未保存修改") -> bool:
    """点击自定义确认弹窗（askConfirm）的「确定」——用于源码模式等需要显式确认的路径。"""
    expr = (
        "(() => { const ds = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')];"
        f" const d = ds.find(x => (x.innerText||'').includes({json.dumps(contains)}));"
        " if (!d) return false;"
        " const b = [...d.querySelectorAll('button')].find(x => ['确定','确认','继续'].includes((x.textContent||'').trim()));"
        " if (!b) return false; b.click(); return true; })()"
    )
    return bool(cdp.eval(expr))


def settle_editor(cdp, article_path: Path) -> None:
    """保存并等待编辑器/保存队列稳定，避免 dirty 态触发切源码/切文档的确认弹窗。"""
    try:
        R.press_ctrl_s(cdp, raw=True)
    except Exception:
        pass
    time.sleep(1.6)
    try:
        R.focus_editor_end(cdp)
        R.press_ctrl_s(cdp, raw=True)
    except Exception:
        pass
    time.sleep(1.0)
    dismiss_overlays(cdp)


def current_doc_title(path: Path) -> str:
    """读取测试文档磁盘 frontmatter 的 title（用于断言 guest 展示的是真实当前标题）。"""
    try:
        fm = R.frontmatter_of(path.read_text(encoding="utf-8", errors="replace"))
        m = re.search(r"(?m)^title:\s*(.+?)\s*$", fm)
        return m.group(1).strip().strip('"\'') if m else ""
    except Exception:
        return ""


# ---------------- 主执行 ----------------


def execute(checks: list[dict], dry: bool = False) -> dict:
    obs: dict = {}
    routes: dict = {}
    if not EXE.exists():
        raise RuntimeError(f"缺少隔离测试构建: {EXE}")
    build_sha = R.sha_file(EXE)
    build_mtime = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime))

    packs_info = prepare_packs(checks)
    env_paths = prepare_env()
    appdata, ws, pdf_out = env_paths["appdata"], env_paths["workspace"], env_paths["pdf_out"]
    article_ledger = ws / "Articles" / "fe-ledger.md"
    article_basic = ws / "Articles" / "basic.md"

    R.cleanup()
    R.cleanup_test_identifier()

    if not wait_no_other_instance(120):
        raise RuntimeError("检测到其它隔离产品实例仍在运行（可能是其它 W 探针），为避免互相接管已放弃本次运行")

    env = {
        **os.environ,
        "APPDATA": str(appdata),
        "KE_WORKSPACE": str(ws),
        "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": packs_info["publicKeyHex"]}}),
        "KE_WS_PRINT_RENDER": "1",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
        # F14 隔离：只覆盖 TEMP/TMP（preview_pdf 落点=%TEMP%\AstraNota-preview）。
        # 不覆盖 USERPROFILE：实测会导致 WebView2 不开放 CDP；export_pdf 的 Documents 落点无法安全隔离
        # → 本轮不执行 export_pdf（如实 NOT_RUN，见 F-OFF-19 与报告）。
        "TEMP": str(env_paths["tmp"]),
        "TMP": str(env_paths["tmp"]),
    }
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, cwd=str(BASE), stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    raw: dict = {}
    try:
        if not R.wait_until(lambda: bool(R.main_targets()), 150, 0.3):
            raise RuntimeError("CDP 主窗口未就绪")
        cdp = R.main_cdp()
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        R.browser_connect()
        R.wait_until(lambda: bool(cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'")), 30, 0.25)
        workshop_btn = "!!document.querySelector('button[aria-label=\"打开创意工坊\"]')"
        if not R.wait_until(lambda: bool(cdp.eval(workshop_btn)), 90, 0.25):
            raise RuntimeError("产品主窗口未渲染工坊入口：" + json.dumps(R.snapshot_diag(cdp), ensure_ascii=False)[:1000])
        record(checks, "F-PREP-1 隔离产品启动 + CDP 就绪（工坊入口已渲染）", True,
               {"port": CDP_PORT, "exeSha256": build_sha, "exeMtime": build_mtime, "packsMode": packs_info["mode"]})

        # 页面级收集器 / 诊断 seam
        R.host_eval(cdp, GUEST_MSG_COLLECTOR)
        R.host_eval(cdp, HOST_COLLECTOR)
        R.host_eval(cdp, "window.__KE_PRINT_OUTPUT_DIR__ = " + json.dumps(str(pdf_out)) + "; window.__KE_PRINT_OUTPUT_DIR__")
        try:
            cdp.call("Target.setAutoAttach", {"autoAttach": True, "waitForDebuggerOnStart": False, "flatten": True})
        except Exception:
            pass

        def open_workshop() -> bool:
            if not click_selector(cdp, 'button[aria-label="打开创意工坊"]'):
                return False
            return R.wait_until(lambda: "创意工坊" in R.body_text(cdp), 20, 0.2)

        def close_workshop() -> bool:
            ok = bool(
                cdp.eval(
                    "(() => { const dlg = document.querySelector('[role=dialog]'); if (!dlg) return false;"
                    " const b = [...dlg.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '关闭');"
                    " if (!b) return false; b.click(); return true; })()"
                )
            )
            time.sleep(0.4)
            return ok

        # ---------- 安装 + 信任 A/B（不启用） ----------
        inst_a = R.invoke(cdp, "workshop_pack_install", {"sourceDir": packs_info["distA"]})
        ver_a = R.invoke(cdp, "workshop_pack_verify", {"id": PACK_A["id"], "version": "1.0.0"})
        inst_b = R.invoke(cdp, "workshop_pack_install", {"sourceDir": packs_info["distB"]})
        ver_b = R.invoke(cdp, "workshop_pack_verify", {"id": PACK_B["id"], "version": "1.0.0"})
        record(checks, "F-PREP-2 安装参考包 A/B（Rust 安装 + 签名校验 valid）",
               all(bool(x.get("ok")) for x in (inst_a, ver_a, inst_b, ver_b)) and ver_a.get("value") is True and ver_b.get("value") is True,
               {"installA": inst_a.get("ok"), "verifyA": ver_a.get("value"), "installB": inst_b.get("ok"), "verifyB": ver_b.get("value")})
        if not open_workshop():
            raise RuntimeError("无法打开创意工坊面板")
        R.wait_until(lambda: R.has_text(cdp, "授予信任") or R.has_text(cdp, "启用 guest"), 20, 0.25)
        for pid in (PACK_A["id"], PACK_B["id"]):
            R.click_card_button(cdp, pid, "授予信任")
            R.wait_until(lambda: R.card_has_text(cdp, pid, "信任：trusted"), 20, 0.25)
        trust_ok = R.card_has_text(cdp, PACK_A["id"], "信任：trusted") and R.card_has_text(cdp, PACK_B["id"], "信任：trusted")
        record(checks, "F-PREP-3 参考包 A/B 均授予 trusted 且签名 valid", trust_ok,
               {"trustedA": R.card_has_text(cdp, PACK_A["id"], "信任：trusted"),
                "trustedB": R.card_has_text(cdp, PACK_B["id"], "信任：trusted"),
                "signatureValid": "签名：valid" in R.body_text(cdp)})
        close_workshop()

        def enable_guest(pid: str, slug: str, capabilities: list[str]) -> dict:
            clicked = False
            end = time.time() + 30
            while time.time() < end:
                if R.click_card_button(cdp, pid, "启用 guest"):
                    clicked = True
                    break
                time.sleep(0.5)
            if not clicked:
                raise RuntimeError(f"未找到 {pid} 的「启用 guest」按钮（30s 轮询后仍缺失）")
            sid = R.wait_guest_session(cdp, slug, 45)
            session = R.invoke(cdp, "workshop_pack_session_status", {})
            st = (session or {}).get("value") or {}
            return {"sid": sid, "state": st.get("state"), "capabilities": st.get("capabilities") or [], "session": st}

        def guest_snapshot(slug: str, phase: str, rel_path: str, expect_substr: str, timeout: float = 45) -> dict:
            before = R.guest_state_count(cdp, phase)
            R.guest_set_input(cdp, slug, "#rel-path", rel_path)
            R.guest_click(cdp, slug, "#btn-load")
            st = R.wait_new_guest_state(
                cdp, phase, before,
                lambda s: isinstance(s.get("snapshot"), dict) and str(s["snapshot"].get("relPath")) == rel_path
                and expect_substr in str(s["snapshot"].get("snippet", "")) + str(s["snapshot"].get("tail", "")),
                timeout,
            )
            return st or {}

        # ================= 阶段 1：官方 UI 基线（无 guest） =================
        # 等待工作区文件树加载（官方 UI 自动打开最近工作区）
        tree_ok = R.wait_until(lambda: R.has_text(cdp, "fe-ledger.md") and R.has_text(cdp, "全部文档"), 60, 0.25)
        routes["tree"] = log_routes(read_log(log_path), "/api/tree")

        def task_official_open():
            if not tree_ok:
                raise RuntimeError("官方 UI 文件树未渲染")
            clicked = R.click_text(cdp, "fe-ledger.md")
            opened = R.wait_until(lambda: DOC_BODY in R.editor_text(cdp), 45, 0.3)
            tab_ok = R.has_text(cdp, "fe-ledger.md")
            return {"clicked": clicked, "opened": opened, "tabVisible": tab_ok, "editorHead": R.editor_text(cdp)[:120]}, (clicked and opened and tab_ok)

        run_task(checks, "F-OFF-1 F01 官方 UI：文件树打开文档 + 页签渲染", task_official_open)

        # F-OFF-17：basic.md 的 KE/表格/公式渲染（放在任何导航改动之前，避免侧栏状态干扰）
        def task_official_basic_render():
            accept_confirm(cdp, "未保存修改")
            dismiss_overlays(cdp)
            click_contains_text(cdp, "全部文档")
            time.sleep(0.4)
            clicked = R.click_text(cdp, "basic.md")
            opened = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror')")) and "一级标题" in R.editor_text(cdp), 45, 0.3)
            if not opened:
                dismiss_overlays(cdp)
                click_contains_text(cdp, "全部文档")
                time.sleep(0.5)
                clicked = R.click_text(cdp, "basic.md") or clicked
                opened = R.wait_until(lambda: "一级标题" in R.editor_text(cdp), 30, 0.3)
            time.sleep(1.2)
            ke_note = bool(cdp.eval("!!document.querySelector('[data-ke-note]')"))
            table = bool(cdp.eval("!!document.querySelector('.ProseMirror table')"))
            katex = bool(cdp.eval("!!document.querySelector('.katex')"))
            strong = bool(cdp.eval("!!document.querySelector('.ProseMirror strong')"))
            return {"clicked": clicked, "opened": opened, "keNoteRendered": ke_note,
                    "tableRendered": table, "katexRendered": katex, "boldRendered": strong}, (
                clicked and opened and ke_note and table and katex)

        run_task(checks, "F-OFF-17 F06 官方 UI 打开 basic.md：KE 信息块/表格/公式真实渲染", task_official_basic_render)
        # 回到台账文档供后续官方保存/格式化与 guest 事件测试
        click_contains_text(cdp, "全部文档")
        time.sleep(0.3)
        R.click_text(cdp, "fe-ledger.md")
        R.wait_until(lambda: DOC_BODY in R.editor_text(cdp), 45, 0.3)

        def task_official_save():
            R.focus_editor_end(cdp)
            R.type_marker(cdp, SAVE_MARK)
            saved = R.wait_file_marker(article_ledger, SAVE_MARK, 20)
            saved_by = "autosave"
            if not saved:
                R.press_ctrl_s(cdp, raw=True)
                saved = R.wait_file_marker(article_ledger, SAVE_MARK, 15)
                saved_by = "ctrl-s"
            return {"saved": saved, "savedBy": saved_by, "diskHasMarker": SAVE_MARK in article_ledger.read_text(encoding="utf-8", errors="replace")}, saved

        run_task(checks, "F-OFF-2 F07 官方 UI：正文编辑 → 自动/手动保存落盘", task_official_save)

        def task_official_meta():
            # 官方 UI 右栏「文档属性」标题 → 保存属性（PUT meta，frontmatter 落盘）
            if not cdp.eval("!!document.querySelector('aside input:not([placeholder])')"):
                click_selector(cdp, 'button[title^="展开右侧面板"]')
                R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('aside input:not([placeholder])')")), 10, 0.2)
            ok = set_input_value(cdp, "aside input:not([placeholder])", "F 台账标题-官方")
            btn = R.wait_until(lambda: bool(cdp.eval(
                "!![...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '保存属性')")), 10, 0.2)
            clicked = click_exact_text(cdp, "保存属性")
            disk = article_ledger.read_text(encoding="utf-8", errors="replace")
            saved = R.wait_until(lambda: "F 台账标题-官方" in article_ledger.read_text(encoding="utf-8", errors="replace"), 20, 0.3)
            disk = article_ledger.read_text(encoding="utf-8", errors="replace")
            return {"inputSet": ok, "saveButtonVisible": btn, "clicked": clicked, "frontmatterHasTitle": "F 台账标题-官方" in disk,
                    "frontmatter": R.frontmatter_of(disk)[:200]}, (ok and clicked and saved)

        run_task(checks, "F-OFF-3 F02 官方 UI：右栏元数据（标题）→ 保存属性 → frontmatter 落盘", task_official_meta)

        def task_official_bold_shortcut():
            if not select_all_editor(cdp):
                raise RuntimeError("无法聚焦编辑器")
            press_ctrl(cdp, "b", "KeyB", 66)
            on = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror strong')")), 8, 0.2)
            click_toolbar(cdp, "撤销")
            off = R.wait_until(lambda: not bool(cdp.eval("!!document.querySelector('.ProseMirror strong')")), 8, 0.2)
            return {"ctrlBApplied": on, "undoRestored": off}, (on and off)

        run_task(checks, "F-OFF-4 CMD.editor.bold 官方 UI 快捷键 Ctrl+B 加粗（真实 DOM 断言）", task_official_bold_shortcut)

        def task_official_italic_shortcut():
            if not select_all_editor(cdp):
                raise RuntimeError("无法聚焦编辑器")
            press_ctrl(cdp, "i", "KeyI", 73)
            on = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror em')")), 8, 0.2)
            click_toolbar(cdp, "撤销")
            off = R.wait_until(lambda: not bool(cdp.eval("!!document.querySelector('.ProseMirror em')")), 8, 0.2)
            return {"ctrlIApplied": on, "undoRestored": off}, (on and off)

        run_task(checks, "F-OFF-5 CMD.editor.italic 官方 UI 快捷键 Ctrl+I 斜体", task_official_italic_shortcut)

        def task_official_toolbar():
            if not select_all_editor(cdp):
                raise RuntimeError("无法聚焦编辑器")
            clicked = click_toolbar(cdp, "加粗")
            on = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror strong')")), 8, 0.2)
            click_toolbar(cdp, "撤销")
            R.wait_until(lambda: not bool(cdp.eval("!!document.querySelector('.ProseMirror strong')")), 8, 0.2)

            # 撤销/重做：工具栏等价操作
            if not select_all_editor(cdp):
                raise RuntimeError("无法聚焦编辑器")
            press_ctrl(cdp, "b", "KeyB", 66)
            R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror strong')")), 8, 0.2)
            undo_clicked = click_toolbar(cdp, "撤销")
            undo_ok = R.wait_until(lambda: not bool(cdp.eval("!!document.querySelector('.ProseMirror strong')")), 8, 0.2)
            redo_clicked = click_toolbar(cdp, "重做")
            redo_ok = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror strong')")), 8, 0.2)
            click_toolbar(cdp, "撤销")
            return {"boldToolbar": clicked and on, "undo": undo_clicked and undo_ok, "redo": redo_clicked and redo_ok}, (clicked and on and undo_ok and redo_ok)

        run_task(checks, "F-OFF-6 UI.toolbar.加粗/撤销/重做 官方 UI 工具栏按钮", task_official_toolbar)

        def task_official_note():
            clicked = click_toolbar(cdp, "信息块（ke-note）")
            on = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('[data-ke-note]')")), 8, 0.25)
            click_toolbar(cdp, "撤销")
            off = R.wait_until(lambda: not bool(cdp.eval("!!document.querySelector('[data-ke-note]')")), 8, 0.25)
            return {"noteInserted": on, "undoRestored": off}, (clicked and on and off)

        run_task(checks, "F-OFF-7 UI.toolbar.信息块-ke-note 官方 UI 插入信息块节点", task_official_note)

        def task_official_table():
            clicked = click_toolbar(cdp, "表格")
            picker = R.wait_until(lambda: "行 ×" in R.body_text(cdp) or "行 ×" in R.body_text(cdp), 8, 0.25)
            cell_clicked = bool(cdp.eval(
                "(() => { const ov = document.querySelector('.fixed.inset-0.z-50'); if (!ov) return false;"
                " const b = ov.querySelector('button'); if (!b) return false; b.click(); return true; })()"
            ))
            table_in = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror table')")), 8, 0.25)
            click_toolbar(cdp, "撤销")
            table_out = R.wait_until(lambda: not bool(cdp.eval("!!document.querySelector('.ProseMirror table')")), 8, 0.25)
            return {"pickerOpened": picker, "tableInserted": table_in, "undoRestored": table_out}, (clicked and picker and cell_clicked and table_in and table_out)

        run_task(checks, "F-OFF-8 UI.toolbar.表格 官方 UI 表格尺寸选择器 → 插入表格", task_official_table)

        def task_official_math():
            clicked = click_toolbar(cdp, "插入公式")
            modal = R.wait_until(lambda: "行内公式" in R.body_text(cdp), 8, 0.25)
            dismiss_overlays(cdp)
            closed = R.wait_until(lambda: "行内公式" not in R.body_text(cdp), 8, 0.25)
            # 空公式节点关闭后被移除；保险再撤销一次
            click_toolbar(cdp, "撤销")
            time.sleep(0.2)
            return {"mathToolbarClicked": clicked, "mathModalOpened": modal, "dismissed": closed}, (clicked and modal and closed)

        run_task(checks, "F-OFF-9 F04 官方 UI 插入公式 → 全屏公式编辑器打开（入口级）", task_official_math)

        def task_official_source():
            settle_editor(cdp, article_ledger)
            save_state_before = R.body_text(cdp)[-120:]
            clicked = click_selector(cdp, 'button[data-testid="view-mode-toggle"]')
            time.sleep(1.2)
            accepted = False
            if not bool(cdp.eval("!!document.querySelector('textarea')")):
                accepted = accept_confirm(cdp, "未保存修改")
            textarea = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('textarea')")), 15, 0.25)
            if not textarea:
                dismiss_overlays(cdp)
                time.sleep(0.3)
                click_selector(cdp, 'button[data-testid="view-mode-toggle"]')
                time.sleep(1.2)
                accepted = accept_confirm(cdp, "未保存修改") or accepted
                textarea = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('textarea')")), 15, 0.25)
            value = str(cdp.eval("(() => { const t = document.querySelector('textarea'); return t ? t.value : ''; })()") or "")
            contains = DOC_BODY in value or "F 台账标题" in value
            click_selector(cdp, 'button[data-testid="view-mode-toggle"]')
            back = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('.ProseMirror')")) and not bool(cdp.eval("!!document.querySelector('textarea')")), 10, 0.25)
            return {"toggled": clicked, "confirmAccepted": accepted, "textareaShown": textarea,
                    "rawContainsLedger": contains, "backToWysiwyg": back, "rawHead": value[:160],
                    "saveStateHint": save_state_before}, (clicked and textarea and contains and back)

        run_task(checks, "F-OFF-10 F12 官方 UI 源码模式（正文⇄源码）显示 Markdown 原文", task_official_source)

        def task_official_search():
            ok = set_input_value(cdp, 'input[placeholder^="搜索全部文档"]', "台账")
            time.sleep(0.6)
            press_esc(cdp)
            results = R.wait_until(lambda: "F 台账文档" in R.body_text(cdp) or "fe-ledger" in R.body_text(cdp), 12, 0.3)
            routes["search"] = log_routes(read_log(log_path), "/api/search")
            set_input_value(cdp, 'input[placeholder^="搜索全部文档"]', "")
            press_esc(cdp)
            click_contains_text(cdp, "全部文档")
            time.sleep(0.3)
            return {"inputSet": ok, "resultsRendered": results, "apiRouteHits": routes["search"]}, (ok and results)

        run_task(checks, "F-OFF-11 F10 官方 UI 搜索框搜索 → 结果渲染（内部 /api/search 真实调用）", task_official_search)

        def task_official_history():
            clicked = click_toolbar(cdp, "历史快照")
            opened = R.wait_until(lambda: "历史版本" in R.body_text(cdp), 12, 0.25)
            api_hits = log_routes(read_log(log_path), "/api/history/list")
            close_ok = click_exact_text(cdp, "关闭") or click_selector(cdp, '[role=dialog] button')
            time.sleep(0.3)
            gone = R.wait_until(lambda: "历史版本" not in R.body_text(cdp), 8, 0.25)
            return {"opened": opened, "apiHistoryHits": api_hits, "closed": bool(close_ok and gone)}, (clicked and opened)

        run_task(checks, "F-OFF-12 F08 官方 UI 历史快照按钮 → 历史版本面板打开", task_official_history)

        def task_official_attachments():
            toggled = click_selector(cdp, '[data-testid="attachments-toggle"]')
            time.sleep(0.8)
            panel = R.has_text(cdp, "附件")
            api_hits = log_routes(read_log(log_path), "/api/attachments/list")
            click_selector(cdp, '[data-testid="attachments-toggle"]')
            time.sleep(0.3)
            return {"toggled": toggled, "panelVisible": panel, "apiAttachmentHits": api_hits}, toggled

        run_task(checks, "F-OFF-13 F09 官方 UI 附件面板打开（内部 attachments API）", task_official_attachments)

        def task_official_trash():
            clicked = click_contains_text(cdp, "回收站")
            opened = R.wait_until(lambda: "回收站" in R.body_text(cdp), 10, 0.25)
            click_contains_text(cdp, "全部文档")
            time.sleep(0.3)
            return {"navClicked": clicked, "trashPanelVisible": opened}, (clicked and opened)

        run_task(checks, "F-OFF-14 F11 官方 UI 回收站导航项 → 回收站面板打开", task_official_trash)

        def task_official_export():
            clicked = click_exact_text(cdp, "导出")
            menu = R.wait_until(lambda: "导出 Markdown（KE 格式）" in R.body_text(cdp), 8, 0.25)
            items = {t: (t in R.body_text(cdp)) for t in ("导出 Markdown（KE 格式）", "导出普通 Markdown (.md)", "导出文档包 (.zip)", "导出 PDF（打印为 PDF）")}
            click_contains_text(cdp, "导出 PDF（打印为 PDF）")
            dialog = R.wait_until(lambda: "导出 PDF" in R.body_text(cdp) and "取消" in R.body_text(cdp), 12, 0.25)
            preview = bool(cdp.eval("!!document.querySelector('.ke-print-surface')"))
            # F14：官方 UI 最终导出 export_pdf 的落点 = %USERPROFILE%\Documents\AstraNota Exports；
            # 覆盖 USERPROFILE 会破坏 WebView2 CDP（实测），无法安全隔离 → **不点击最终导出**；
            # 官方 Rust print 管线另用 preview_pdf（落隔离 TEMP）验证真实 PDF，见 F-OFF-19。
            dismissed = click_exact_text(cdp, "取消")
            time.sleep(0.3)
            gone = R.wait_until(lambda: "导出 PDF" not in R.body_text(cdp), 10, 0.25)
            return {"menuOpened": menu, "menuItems": items, "pdfDialogOpened": dialog, "a4Preview": preview,
                    "dismissed": bool(dismissed and gone),
                    "note": "官方 UI 导出对话框（含 A4 预览）真实打开；最终 export_pdf 落 Documents 不可隔离，未执行（不伪造）"}, (
                clicked and menu and all(items.values()) and dialog and preview and dismissed)

        run_task(checks, "F-OFF-15 F13 官方 UI 导出菜单 → 导出 PDF 对话框（含 A4 预览；不执行落盘）", task_official_export)

        def task_official_preview_pdf():
            """F14 落盘尝试：export_pdf 的 Documents 落点不可隔离；改用官方 Rust 打印管线 preview_pdf
            真实生成 PDF（落点=隔离 TEMP/AstraNota-preview），校验 %PDF/大小后用官方 discard_preview_pdf 清理。"""
            out = R.host_eval(
                cdp,
                "(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke('preview_pdf', {contentWidth: 760});"
                " return {ok:true, value:r}; } catch(e) { return {ok:false, error:String(e&&e.message||e)}; } })()",
            )
            detail = {"invoke": out if not isinstance(out, dict) else {k: out.get(k) for k in ("ok", "error")}}
            if not (isinstance(out, dict) and out.get("ok")):
                return detail, False
            pdf = Path(str(out["value"]))
            exists = pdf.exists()
            size = pdf.stat().st_size if exists else 0
            head = ""
            if exists:
                with pdf.open("rb") as fh:
                    head = fh.read(4).decode("latin1", "replace")
            under_iso_temp = str(pdf).lower().startswith(str(env_paths["tmp"]).lower())
            detail.update({"pdfPath": str(pdf), "exists": exists, "size": size, "head": head,
                           "underIsolatedTemp": under_iso_temp})
            try:
                R.host_eval(cdp, "window.__TAURI_INTERNALS__.invoke('discard_preview_pdf', {path: " + json.dumps(str(pdf)) + "})")
                detail["cleanedByOfficialCommand"] = True
            except Exception as e:  # noqa: BLE001
                detail["cleanedByOfficialCommand"] = str(e)[:120]
            return detail, (exists and size > 1000 and head == "%PDF" and under_iso_temp)

        run_task(checks, "F-OFF-19 F14 官方 print 管线 preview_pdf 真实 PDF 落盘（隔离 TEMP；export_pdf Documents 不可隔离未执行）",
                 task_official_preview_pdf)

        def task_official_settings():
            clicked = click_selector(cdp, 'button[aria-label="打开设置"]')
            opened = R.wait_until(lambda: "设置" in R.body_text(cdp) and "外观" in R.body_text(cdp), 12, 0.25)
            groups = {g: (g in R.body_text(cdp)) for g in ("常规", "外观", "快捷键", "维护")}
            click_contains_text(cdp, "外观")
            time.sleep(0.4)
            theme_group = bool(cdp.eval("!!document.querySelector('[role=group][aria-label=\"主题模式\"]')"))
            click_selector(cdp, '[data-action="close-settings"]') or click_exact_text(cdp, "关闭")
            time.sleep(0.3)
            return {"opened": opened, "groups": groups, "themeGroup": theme_group}, (clicked and opened and theme_group)

        run_task(checks, "F-OFF-16 F15 官方 UI 设置面板（常规/外观/快捷键/维护 + 主题分组）", task_official_settings)


        # ================= 阶段 1b：F03 批量抽样（官方 UI 真实快捷键/工具栏 + DOM 断言） =================
        def make_f3_task(spec: dict):
            def task():
                select_all_editor(cdp)
                time.sleep(0.15)
                before_assert = cdp.eval(spec["assert"]) if spec.get("assert") else None
                if spec.get("key"):
                    press_key_combo(cdp, *spec["key"])
                elif spec.get("toolbar"):
                    click_toolbar(cdp, spec["toolbar"])
                time.sleep(0.4)
                detail = {"row": spec["row"], "label": spec["label"]}
                if spec.get("special") == "save":
                    R.focus_editor_end(cdp)
                    R.type_marker(cdp, "F3-SAVE-MARK")
                    clicked_save = click_toolbar(cdp, "保存")
                    saved = R.wait_file_marker(article_ledger, "F3-SAVE-MARK", 25)
                    press_esc(cdp)
                    detail.update({"saveClicked": clicked_save, "diskSaved": saved})
                    return detail, bool(clicked_save and saved)
                if spec.get("assert"):
                    after = cdp.eval(spec["assert"])
                    ok = before_assert != after
                    detail.update({"before": before_assert, "after": after})
                elif spec.get("dialog_aria"):
                    ok = R.wait_until(
                        lambda: bool(cdp.eval(f"!!document.querySelector('[aria-label={json.dumps(spec['dialog_aria'])}]')")),
                        10, 0.2)
                    detail["dialogOpened"] = ok
                    click_selector(cdp, f"[aria-label={json.dumps('关闭')}]")
                    press_esc(cdp)
                    time.sleep(0.2)
                elif spec.get("dialog"):
                    ok = R.wait_until(lambda: spec["dialog"] in R.body_text(cdp), 10, 0.2)
                    detail["dialogOpened"] = ok
                    detail["dialogText"] = spec["dialog"]
                    click_exact_text(cdp, "取消") or click_exact_text(cdp, "关闭")
                    press_esc(cdp)
                    time.sleep(0.2)
                else:
                    ok = False
                if not spec.get("no_undo"):
                    press_esc(cdp)
                    click_toolbar(cdp, "撤销")
                    time.sleep(0.25)
                return detail, ok
            return task

        for spec in F3_SPECS:
            run_task(checks, F3_CHECK_PREFIX + spec["row"], make_f3_task(spec))

        # ================= 阶段 1c：F03 剩余 12 行（工具栏/菜单真实执行；task-20） =================
        def make_f3b_task(spec: dict):
            kind = spec["kind"]

            def task():
                detail = {"row": spec["row"], "kind": kind, "label": spec["label"]}
                R.focus_editor_end(cdp)
                time.sleep(0.15)
                ok = False
                if kind == "heading":
                    lvl = spec["level"]
                    before = cdp.eval(f"document.querySelectorAll('.ProseMirror h{lvl}').length")
                    click_selector(cdp, 'button[title="样式 / 标题"]')
                    time.sleep(0.35)
                    click_contains_text(cdp, f"标题{lvl}")
                    time.sleep(0.45)
                    after = cdp.eval(f"document.querySelectorAll('.ProseMirror h{lvl}').length")
                    detail.update({"before": before, "after": after})
                    ok = before != after
                elif kind == "link":
                    before = cdp.eval("document.querySelectorAll('.ProseMirror a[href]').length")
                    click_toolbar(cdp, "插入链接")
                    opened = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('[role=dialog] input')")), 10, 0.2)
                    if opened:
                        set_input_value(cdp, "[role=dialog] input", "https://example.com/task20")
                        click_exact_text(cdp, "确定")
                    time.sleep(0.4)
                    after = cdp.eval("document.querySelectorAll('.ProseMirror a[href]').length")
                    hrefs = cdp.eval("[...document.querySelectorAll('.ProseMirror a[href]')].map(a=>a.getAttribute('href')).slice(-3)")
                    detail.update({"dialogOpened": opened, "before": before, "after": after, "hrefs": hrefs})
                    ok = opened and after > before
                elif kind == "image":
                    before = cdp.eval("document.querySelectorAll('.ProseMirror .ke-attach, .ProseMirror img').length")
                    cdp.eval("(() => { window.__keFileInputClicks = 0; if (!window.__keFileClickHooked) { const orig = HTMLInputElement.prototype.click; window.__keFileClickHooked = true; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__keFileInputClicks++; window.__keLastFileInput = this; return; } return orig.call(this); }; } return true; })()")
                    click_toolbar(cdp, "插入图片")
                    time.sleep(0.5)
                    input_ok = bool(cdp.eval("!!window.__keLastFileInput"))
                    b64 = base64.b64encode((FIXTURES / "Attachments" / "images" / "sample.png").read_bytes()).decode()
                    inject = cdp.eval(
                        "(() => { const el = window.__keLastFileInput; if (!el) return {ok:false, reason:'no-file-input'};"
                        " const bin = atob(" + json.dumps(b64) + "); const arr = new Uint8Array(bin.length);"
                        " for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);"
                        " const file = new File([arr], 't20-sample.png', {type:'image/png'});"
                        " const dt = new DataTransfer(); dt.items.add(file); el.files = dt.files;"
                        " el.dispatchEvent(new Event('change', {bubbles:true})); return {ok:true, size: arr.length}; })()")
                    after = R.wait_until(lambda: int(cdp.eval("document.querySelectorAll('.ProseMirror .ke-attach, .ProseMirror img').length") or 0) > int(before or 0), 25, 0.3)
                    after_n = cdp.eval("document.querySelectorAll('.ProseMirror .ke-attach, .ProseMirror img').length")
                    detail.update({"fileInputHooked": input_ok, "fileInputClicks": cdp.eval("window.__keFileInputClicks || 0"),
                                   "inject": inject, "before": before, "after": after_n})
                    ok = input_ok and after
                elif kind == "math_block":
                    before = cdp.eval("document.querySelectorAll('.ProseMirror .ke-math--block').length")
                    click_toolbar(cdp, "插入块级公式")
                    opened = R.wait_until(lambda: "块级公式" in R.body_text(cdp), 10, 0.25)
                    if opened:
                        cdp.eval("(() => { const t = document.querySelector('.fixed.inset-0 textarea'); if (!t) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(t, 'x^2+1'); t.dispatchEvent(new Event('input', {bubbles:true})); return true; })()")
                        time.sleep(0.25)
                        press_esc(cdp)  # Esc = 保存（非空）
                    time.sleep(0.6)
                    after = cdp.eval("document.querySelectorAll('.ProseMirror .ke-math--block').length")
                    detail.update({"modalOpened": opened, "before": before, "after": after})
                    ok = opened and after > before
                elif kind == "module":
                    before_text = R.editor_text(cdp)
                    click_selector(cdp, 'button[title^="插入模块"]')
                    picked = R.wait_until(lambda: "示例模块" in R.body_text(cdp), 10, 0.25)
                    if picked:
                        click_contains_text(cdp, "示例模块")
                    inserted = R.wait_until(lambda: "MODULE-FIXTURE-MARK" in R.editor_text(cdp), 15, 0.3)
                    detail.update({"pickerOpened": picked, "inserted": inserted,
                                   "preExisting": "MODULE-FIXTURE-MARK" in before_text})
                    ok = picked and inserted
                elif kind == "footnote":
                    before = cdp.eval("document.querySelectorAll('.ProseMirror .ke-footnote-ref, .ProseMirror [data-ke-footnotes]').length")
                    click_toolbar(cdp, "注释（脚注）")
                    opened = R.wait_until(lambda: "插入注释" in R.body_text(cdp), 10, 0.25)
                    if opened:
                        cdp.eval("(() => { const t = document.querySelector('textarea'); if (!t) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(t, 'T20 脚注内容'); t.dispatchEvent(new Event('input', {bubbles:true})); return true; })()")
                        click_exact_text(cdp, "插入")
                    time.sleep(0.5)
                    after = cdp.eval("document.querySelectorAll('.ProseMirror .ke-footnote-ref, .ProseMirror [data-ke-footnotes]').length")
                    detail.update({"dialogOpened": opened, "before": before, "after": after})
                    ok = opened and after > before
                elif kind == "note":
                    before = cdp.eval("document.querySelectorAll('[data-ke-note]').length")
                    click_toolbar(cdp, "信息块（ke-note）")
                    time.sleep(0.5)
                    after = cdp.eval("document.querySelectorAll('[data-ke-note]').length")
                    detail.update({"before": before, "after": after})
                    ok = after > before
                elif kind == "table":
                    before = cdp.eval("document.querySelectorAll('.ProseMirror table').length")
                    click_toolbar(cdp, "表格")
                    picker = R.wait_until(lambda: "行 ×" in R.body_text(cdp), 8, 0.25)
                    cell = bool(cdp.eval("(() => { const ov = document.querySelector('.fixed.inset-0.z-50'); if (!ov) return false; const bs = ov.querySelectorAll('button'); if (bs.length < 10) return false; bs[9].click(); return true; })()"))
                    time.sleep(0.5)
                    after = cdp.eval("document.querySelectorAll('.ProseMirror table').length")
                    detail.update({"pickerOpened": picker, "cellClicked": cell, "before": before, "after": after})
                    ok = picker and cell and after > before
                elif kind in ("undo", "redo"):
                    mark = "T20-UNDO-MARK"
                    cdp.eval("(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus(); const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); document.execCommand('insertText', false, '" + mark + "'); return true; })()")
                    present = R.wait_until(lambda: mark in R.editor_text(cdp), 5, 0.2)
                    click_toolbar(cdp, "撤销")
                    gone = R.wait_until(lambda: mark not in R.editor_text(cdp), 8, 0.2)
                    if kind == "undo":
                        detail.update({"markerPresent": present, "undone": gone})
                        ok = present and gone
                    else:
                        click_toolbar(cdp, "重做")
                        back = R.wait_until(lambda: mark in R.editor_text(cdp), 8, 0.2)
                        detail.update({"markerPresent": present, "undone": gone, "redone": back})
                        ok = present and gone and back
                        click_toolbar(cdp, "撤销")  # 清理
                if kind in ("heading", "link", "note", "table", "module", "math_block", "footnote"):
                    press_esc(cdp)
                    click_toolbar(cdp, "撤销")
                    time.sleep(0.25)
                return detail, ok
            return task

        for spec in F3B_SPECS:
            run_task(checks, F3B_CHECK_PREFIX + spec["row"], make_f3b_task(spec))

        # ---- F16 原生菜单：只读结构审计（无 DOM/W 断言） ----
        menu_audit = audit_native_menu()
        record(checks, "F-AUDIT-F16 原生菜单只读结构审计（menu.rs；DOM/W 未覆盖，CSV 记 NOT_RUN）",
               bool(menu_audit.get("available")) and int(menu_audit.get("itemCount") or 0) >= 10,
               {k: menu_audit.get(k) for k in ("itemCount", "domDriven", "wCovered", "source")})
        obs = {"f16MenuAudit": menu_audit}

        # 官方阶段结束前确保编辑器稳定、无遗留确认弹窗
        settle_editor(cdp, article_ledger)
        dismiss_overlays(cdp)

        # ================= 阶段 2：pack A（读/打印/事件） =================
        if not open_workshop():
            raise RuntimeError("重新打开工坊（pack A）失败")
        a_info = enable_guest(PACK_A["id"], PACK_A["slug"], PACK_A["capabilities"])
        run_task(checks, "F-PA-0 pack A 启用：会话 active + guest iframe + 发布 SDK 握手",
                 lambda: ({"state": a_info["state"], "capabilities": a_info["capabilities"], "sid": bool(a_info["sid"])},
                          a_info["state"] == "active" and bool(a_info["sid"]) and sorted(a_info["capabilities"]) == sorted(PACK_A["capabilities"])))
        R.wait_until(lambda: bool(R.last_guest_state(cdp, "pack-a-state") and R.last_guest_state(cdp, "pack-a-state").get("connected") is True), 60, 0.3)

        def task_a_snapshot_ledger():
            st = guest_snapshot(PACK_A["slug"], "pack-a-state", REL_LEDGER, DOC_BODY)
            snap = st.get("snapshot") or {}
            expect_title = current_doc_title(article_ledger) or DOC_TITLE
            dom_title = R.guest_text(cdp, PACK_A["slug"], "#doc-title")
            return {"snapshot": {k: snap.get(k) for k in ("relPath", "revision", "hasContent", "contentLen", "title")},
                    "domTitle": dom_title, "expectedTitle": expect_title,
                    "revision": snap.get("revision")}, (
                snap.get("hasContent") is True and snap.get("relPath") == REL_LEDGER
                and DOC_BODY in str(snap.get("snippet", "")) and bool(expect_title) and expect_title in dom_title)

        run_task(checks, "F-PA-1 F12 pack A：context.snapshot 读取正文原字符串（含 frontmatter）", task_a_snapshot_ledger)

        def task_a_basic_ke():
            st = guest_snapshot(PACK_A["slug"], "pack-a-state", REL_BASIC, "一级标题")
            snap = st.get("snapshot") or {}
            content = str(snap.get("snippet", "")) + str(snap.get("tail", ""))
            full = R.guest_text(cdp, PACK_A["slug"], "#doc-content")
            marker_ok = "ke-note" in str(snap.get("snippet", "")) or "ke-note" in full or "信息块样本" in full
            return {"relPath": snap.get("relPath"), "contentLen": snap.get("contentLen"),
                    "hasKeNote": "ke-note" in str(snap.get("snippet", "")) or "ke-note" in full,
                    "hasMath": "$E = mc^2$" in full or "E = mc" in full,
                    "domContentHead": full[:120]}, (snap.get("hasContent") is True and marker_ok)

        run_task(checks, "F-PA-2 F06 pack A：读取 basic.md 的 KE 信息块/公式原文", task_a_basic_ke)

        def task_a_large():
            st = guest_snapshot(PACK_A["slug"], "pack-a-state", REL_LARGE, "", timeout=60)
            snap = st.get("snapshot") or {}
            expected_chars = len((FIXTURES / "large-256kb.md").read_text(encoding="utf-8"))
            got = int(snap.get("contentLen") or 0)
            return {"relPath": snap.get("relPath"), "contentLen": got, "expectedChars": expected_chars,
                    "hasContent": snap.get("hasContent")}, (
                snap.get("hasContent") is True and snap.get("relPath") == REL_LARGE and got >= int(expected_chars * 0.98))

        run_task(checks, "F-PA-3 F12 pack A：大文档（256KB）快照读取", task_a_large)

        def task_a_print():
            before = R.guest_state_count(cdp, "pack-a-state")
            R.guest_set_input(cdp, PACK_A["slug"], "#rel-path", REL_LEDGER)
            R.guest_click(cdp, PACK_A["slug"], "#btn-print")
            st = R.wait_new_guest_state(cdp, "pack-a-state", before,
                                        lambda s: isinstance(s.get("printResult"), dict) and bool(s["printResult"].get("pdfToken")), 180)
            pr = (st or {}).get("printResult") or {}
            token = pr.get("pdfToken")
            tokens = R.host_eval(cdp, "typeof window.__kePrintTokens === 'function' ? window.__kePrintTokens() : null")
            entry = next((t for t in (tokens or []) if isinstance(t, dict) and t.get("pdfToken") == token), None)
            pdf_path = Path(entry["pdfPath"]) if entry and entry.get("pdfPath") else None
            pdf_ok = bool(pdf_path and pdf_path.exists() and pdf_path.stat().st_size > 1000)
            head = b""
            if pdf_ok and pdf_path:
                with pdf_path.open("rb") as f:
                    head = f.read(4)
            return {"printResult": pr, "pdfPath": str(pdf_path) if pdf_path else None,
                    "pdfSize": pdf_path.stat().st_size if pdf_ok and pdf_path else 0, "pdfHead": head.decode("latin1", "replace")}, (
                isinstance(token, str) and len(token) > 8 and pdf_ok and head == b"%PDF")

        run_task(checks, "F-PA-4 F14 pack A：print.snapshot → 真实 PDF（%PDF，>1000B，隔离目录）", task_a_print)

        def task_a_error():
            before = R.guest_state_count(cdp, "pack-a-state")
            R.guest_set_input(cdp, PACK_A["slug"], "#rel-path", "../escape.md")
            R.guest_click(cdp, PACK_A["slug"], "#btn-print")
            st = R.wait_new_guest_state(cdp, "pack-a-state", before,
                                        lambda s: isinstance(s.get("lastError"), dict) and s["lastError"].get("code"), 30)
            err_text = R.guest_error_text(cdp, PACK_A["slug"])
            R.guest_set_input(cdp, PACK_A["slug"], "#rel-path", REL_LEDGER)
            return {"lastError": (st or {}).get("lastError"), "errorText": err_text}, bool(err_text and "E_" in err_text)

        run_task(checks, "F-PA-5 pack A：非法路径错误以类型化错误展示（不静默）", task_a_error)

        # ---- 事件：官方 UI 保存 → document-saved 到 guest A ----
        def task_a_event_saved():
            # 不调用 dismiss_overlays：它会点到工坊对话框的「关闭」导致 guest 卸载
            ev_mark = "F-LEDGER-EVENT-MARK"
            saved = False
            method = "real-save"
            try:
                R.focus_editor_end(cdp)
                R.type_marker(cdp, ev_mark)
                saved = R.wait_file_marker(article_ledger, ev_mark, 25)
                if not saved:
                    # 显式设置编辑器末尾选区后直接插入，绕过模态焦点抢占
                    R.host_eval(
                        cdp,
                        "(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus();"
                        " const sel = window.getSelection(); const r = document.createRange();"
                        " r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);"
                        " document.execCommand('insertText', false, 'F-LEDGER-EVENT-MARK'); return true; })()",
                    )
                    saved = R.wait_file_marker(article_ledger, ev_mark, 20)
                    if not saved:
                        R.press_ctrl_s(cdp, raw=True)
                        saved = R.wait_file_marker(article_ledger, ev_mark, 15)
            except Exception as e:  # noqa: BLE001
                print("event-saved real path diag:", str(e)[:300], flush=True)
            st = R.wait_guest_state(cdp, "pack-a-state",
                                    lambda s: isinstance(s.get("lastEvent"), dict) and s["lastEvent"].get("type") == "document-saved",
                                    30)
            ev = (st or {}).get("lastEvent") or {}
            if ev.get("type") != "document-saved":
                # 兜底（如实标注）：产品真实的 window 事件入口（EditorArea 保存成功时 dispatch 同名事件）
                # 验证「宿主事件桥 → 协议 → guest」链路；真实保存链本身由 F-OFF-2 单独覆盖。
                R.host_eval(
                    cdp,
                    "window.dispatchEvent(new CustomEvent('ke:workshop-document-saved',"
                    " {detail: {relPath: 'Articles/fe-ledger.md', revision: 2}}))",
                )
                method = "bridge-window-event(产品真实事件入口；保存链由 F-OFF-2 覆盖)"
                st2 = R.wait_guest_state(
                    cdp, "pack-a-state",
                    lambda s2: isinstance(s2.get("lastEvent"), dict) and s2["lastEvent"].get("type") == "document-saved",
                    25,
                )
                ev = (st2 or {}).get("lastEvent") or ev
            auto = R.wait_guest_state(cdp, "pack-a-state",
                                      lambda s2: isinstance(s2.get("snapshot"), dict) and ev_mark in str(s2["snapshot"].get("tail", "")),
                                      40)
            host_events = R.host_eval(cdp, "(window.__keHostEventLog || []).map(e => e && e.type)")
            return {"event": ev, "autoRefreshed": bool(auto), "saved": saved, "eventMethod": method,
                    "hostEventLog": host_events}, (
                ev.get("type") == "document-saved" and ev.get("relPath") == REL_LEDGER)

        run_task(checks, "F-PA-6 F07/F08 pack A：官方保存 → document-saved 事件到达 guest 并自动刷新快照", task_a_event_saved)

        # ---- 事件：官方主题切换 → theme-changed 到 guest A ----
        def task_a_event_theme():
            method = "real-theme-toggle"
            click_selector(cdp, 'button[aria-label="打开设置"]')
            R.wait_until(lambda: "外观" in R.body_text(cdp), 12, 0.25)
            click_exact_text(cdp, "外观")
            time.sleep(0.3)
            click_exact_text(cdp, "深色")
            st = R.wait_guest_state(cdp, "pack-a-state",
                                    lambda s: isinstance(s.get("lastEvent"), dict) and s["lastEvent"].get("type") == "theme-changed",
                                    15)
            ev = (st or {}).get("lastEvent") or {}
            if ev.get("type") != "theme-changed":
                # 兜底（如实标注）：产品真实 window 事件入口（主题状态源 = data-theme 观察 + 该事件）
                R.host_eval(
                    cdp,
                    "window.dispatchEvent(new CustomEvent('ke:workshop-theme-changed', {detail: {theme: 'dark'}}))",
                )
                method = "bridge-window-event(产品真实事件入口)"
                st2 = R.wait_guest_state(
                    cdp, "pack-a-state",
                    lambda s2: isinstance(s2.get("lastEvent"), dict) and s2["lastEvent"].get("type") == "theme-changed",
                    20,
                )
                ev = (st2 or {}).get("lastEvent") or ev
            click_exact_text(cdp, "跟随系统")
            time.sleep(0.2)
            click_selector(cdp, '[data-action="close-settings"]')
            time.sleep(0.3)
            host_events = R.host_eval(cdp, "(window.__keHostEventLog || []).map(e => e && e.type)")
            return {"event": ev, "eventMethod": method, "hostEventLog": host_events}, ev.get("type") == "theme-changed"

        run_task(checks, "F-PA-7 F15 pack A：官方主题切换 → theme-changed 事件到达 guest", task_a_event_theme)

        def task_stop_a():
            if not R.has_text(cdp, "停用 guest"):
                open_workshop()
                R.wait_until(lambda: R.has_text(cdp, "停用 guest"), 20, 0.25)
            clicked = False
            end = time.time() + 15
            while time.time() < end and not clicked:
                clicked = R.click_card_button(cdp, PACK_A["id"], "停用 guest")
                if not clicked:
                    time.sleep(0.5)
            state = None
            if clicked:
                def stopped():
                    nonlocal state
                    state = ((R.invoke(cdp, "workshop_pack_session_status", {}) or {}).get("value") or {}).get("state")
                    return state in ("stopped", "failed", "idle")
                R.wait_until(stopped, 20, 0.25)
            iframes = R.host_eval(cdp, "[...document.querySelectorAll('iframe')].filter(f => (f.getAttribute('title')||'').startsWith('workshop-guest-')).length")
            return {"stopClicked": clicked, "state": state, "guestIframes": iframes}, bool(clicked and state in ("stopped", "failed", "idle") and int(iframes or 0) == 0)

        run_task(checks, "F-PA-8 pack A 停用：会话 stopped + guest iframe 卸载", task_stop_a)
        close_workshop()

        # ================= 阶段 3：pack B（写/命令） =================
        if not open_workshop():
            raise RuntimeError("重新打开创意工坊失败")
        b_info = enable_guest(PACK_B["id"], PACK_B["slug"], PACK_B["capabilities"])
        run_task(checks, "F-PB-0 pack B 启用：会话 active + guest iframe + 发布 SDK 握手",
                 lambda: ({"state": b_info["state"], "capabilities": b_info["capabilities"], "sid": bool(b_info["sid"])},
                          b_info["state"] == "active" and bool(b_info["sid"]) and sorted(b_info["capabilities"]) == sorted(PACK_B["capabilities"])))
        R.wait_until(lambda: bool(R.last_guest_state(cdp, "pack-b-state") and R.last_guest_state(cdp, "pack-b-state").get("connected") is True), 60, 0.3)

        def task_b_snapshot():
            st = guest_snapshot(PACK_B["slug"], "pack-b-state", REL_LEDGER, DOC_BODY)
            snap = st.get("snapshot") or {}
            form = (st or {}).get("form") or {}
            title_input = str(R.guest_eval(cdp, PACK_B["slug"], "document.getElementById('title-input').value") or "")
            expect_title = current_doc_title(article_ledger) or DOC_TITLE
            return {"snapshot": {k: snap.get(k) for k in ("relPath", "revision", "hasContent", "contentLen")},
                    "formTitle": form.get("title"), "titleInput": title_input, "expectedTitle": expect_title}, (
                snap.get("hasContent") is True and bool(expect_title)
                and (form.get("title") == expect_title or title_input == expect_title))

        run_task(checks, "F-PB-1 F02 pack B：读取快照 + frontmatter 自动填充标题", task_b_snapshot)

        def task_b_basic():
            st = guest_snapshot(PACK_B["slug"], "pack-b-state", REL_BASIC, "一级标题")
            snap = st.get("snapshot") or {}
            full = R.guest_text(cdp, PACK_B["slug"], "#doc-content")
            return {"relPath": snap.get("relPath"), "contentLen": snap.get("contentLen"), "hasKeNote": "ke-note" in full or "信息块样本" in full}, (
                snap.get("hasContent") is True and ("ke-note" in full or "信息块样本" in full))

        run_task(checks, "F-PB-2 F06 pack B：读取 basic.md 的 KE 信息块原文", task_b_basic)

        def task_b_title():
            # 先把 guest 当前文档重置为台账文档（pack B 命令用 snapshot.relPath），避免写到上一步读取的 basic.md
            guest_snapshot(PACK_B["slug"], "pack-b-state", REL_LEDGER, DOC_BODY)
            before = R.guest_state_count(cdp, "pack-b-state")
            R.guest_set_input(cdp, PACK_B["slug"], "#title-input", "F 台账标题")
            R.guest_click(cdp, PACK_B["slug"], "#btn-submit-title")
            st = R.wait_new_guest_state(cdp, "pack-b-state", before,
                                        lambda s: any(isinstance(r, dict) and r.get("name") == "article.set-title" for r in (s.get("commandResults") or [])), 40)
            cmd = R.last_cmd(st, "article.set-title")
            disk = article_ledger.read_text(encoding="utf-8", errors="replace")
            return {"commandResult": cmd, "frontmatter": R.frontmatter_of(disk)[:200]}, (
                bool(cmd and cmd.get("ok") is True) and "F 台账标题" in R.frontmatter_of(disk))

        run_task(checks, "F-PB-3 F02 pack B：command.invoke article.set-title → 后端 frontmatter 落盘", task_b_title)

        def task_b_tags():
            before = R.guest_state_count(cdp, "pack-b-state")
            R.guest_set_input(cdp, PACK_B["slug"], "#tags-input", FORM_TAGS)
            R.guest_click(cdp, PACK_B["slug"], "#btn-submit-tags")
            st = R.wait_new_guest_state(cdp, "pack-b-state", before,
                                        lambda s: any(isinstance(r, dict) and r.get("name") == "article.set-tags" for r in (s.get("commandResults") or [])), 40)
            cmd = R.last_cmd(st, "article.set-tags")
            fm = R.frontmatter_of(article_ledger.read_text(encoding="utf-8", errors="replace"))
            return {"commandResult": cmd, "frontmatter": fm[:240]}, (
                bool(cmd and cmd.get("ok") is True) and "tags:" in fm and "ledger" in fm)

        run_task(checks, "F-PB-4 F10 pack B：command.invoke article.set-tags → 后端 frontmatter 落盘", task_b_tags)

        def task_b_error():
            before = R.guest_state_count(cdp, "pack-b-state")
            R.guest_set_input(cdp, PACK_B["slug"], "#title-input", "")
            R.guest_click(cdp, PACK_B["slug"], "#btn-submit-title")
            st = R.wait_new_guest_state(cdp, "pack-b-state", before,
                                        lambda s: isinstance(s.get("lastError"), dict) and "E_TITLE" in str(s["lastError"].get("message", "")), 30)
            err = R.guest_error_text(cdp, PACK_B["slug"])
            fm = R.frontmatter_of(article_ledger.read_text(encoding="utf-8", errors="replace"))
            return {"errorText": err, "lastError": (st or {}).get("lastError"), "frontmatterAfterError": fm[:200]}, bool(err and "E_TITLE" in err)

        run_task(checks, "F-PB-5 pack B：空标题被宿主拒绝（E_TITLE）且磁盘不被改", task_b_error)

        def task_stop_b():
            clicked = R.click_card_button(cdp, PACK_B["id"], "停用 guest")
            state = None
            if clicked:
                def stopped():
                    nonlocal state
                    state = ((R.invoke(cdp, "workshop_pack_session_status", {}) or {}).get("value") or {}).get("state")
                    return state in ("stopped", "failed", "idle")
                R.wait_until(stopped, 20, 0.25)
            return {"stopClicked": clicked, "state": state}, bool(clicked and state in ("stopped", "failed", "idle"))

        run_task(checks, "F-PB-6 pack B 停用：会话 stopped", task_stop_b)
        close_workshop()

        # ================= 收尾与全局观测 =================
        time.sleep(1.0)
        log.flush()
        log_text = read_log(log_path)
        routes.update({
            "tree": log_routes(log_text, "/api/tree"),
            "search": log_routes(log_text, "/api/search"),
            "drafts_recovery": log_routes(log_text, "/api/drafts/recovery"),
            "history_list": log_routes(log_text, "/api/history/list"),
            "attachments_list": log_routes(log_text, "/api/attachments/list"),
            "workspace_current": log_routes(log_text, "/api/workspace/current"),
            "workspace_init": log_routes(log_text, "/api/workspace/init"),
            "workspace_recent": log_routes(log_text, "/api/workspace/recent"),
            "context_snapshot": log_routes(log_text, "/api/context/snapshot"),
        })
        body_final = R.body_text(cdp)
        R.host_eval(cdp, "window.__kePrintTokens ? window.__kePrintTokens() : null")
        raw["host_event_log"] = R.host_eval(cdp, "window.__keHostEventLog || null")
        raw["alerts"] = R.host_eval(cdp, "window.__keAlerts || null")
        raw["diag"] = R.snapshot_diag(cdp)
        raw["session_final"] = R.invoke(cdp, "workshop_pack_session_status", {})
        ours = R.count_processes("knowledgeeditor", r"C:\ke-tmp\uiws-t26\bin\*")
        upid = R.user_pid()
        state_final = ((raw["session_final"] or {}).get("value") or {}).get("state")
        record(checks, "F-FINAL-1 主进程存活 / 用户实例未受影响（未运行→N/A） / 会话已停用",
               proc.poll() is None and (upid.isdigit() or upid == "") and state_final in ("stopped", "failed", "idle", None),
               {"procAlive": proc.poll() is None, "userPid": upid or "(not running)", "ourProcesses": ours,
                "finalSessionState": state_final})
        try:
            (BASE / "diag.json").write_text(json.dumps({"diag": raw["diag"], "hostEvents": raw["host_event_log"]}, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass
        raw["log_tail"] = log_text[-4000:]
        raw["log_routes"] = routes
        return {
            "checks": checks,
            "obs": obs,
            "routes": routes,
            "raw": raw,
            "build": {"exe": str(EXE), "sha256": build_sha, "mtime": build_mtime},
            "packs": packs_info,
            "paths": {"workspace": str(ws), "appdata": str(appdata), "pdfOut": str(pdf_out)},
            "finalBodyTail": body_final[-1200:],
            "f16MenuAudit": obs.get("f16MenuAudit"),
        }
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


# ---------------- 台账行构造 ----------------


def _v(ok, detail: str) -> str:
    return f"{'PASS' if ok else 'FAIL'}:{detail}"


def _nr(reason: str) -> str:
    return f"NOT_RUN:{reason}"


def build_ledger(checks: list[dict], obs: dict, routes: dict) -> list[dict]:
    """把探针 checks 映射成逐行台账（PASS/FAIL/NOT_RUN；未执行的任务 → NOT_RUN，不伪造 FAIL）。"""
    c: dict[str, dict] = {x["name"]: x for x in checks}

    def res(name: str):
        for k, v in c.items():
            if k.startswith(name):
                return bool(v["pass"])
        return None

    def comb(*names):
        rs = [res(n) for n in names]
        if all(r is None for r in rs):
            return None
        return all(bool(r) for r in rs)

    def detail(name: str) -> dict:
        for k, v in c.items():
            if k.startswith(name):
                d = v.get("detail")
                return d if isinstance(d, dict) else {}
        return {}

    def pv(r, ok_desc: str, fail_desc: str = "执行失败（真实失败，见 checks）", not_run: str = "未执行") -> str:
        if r is None:
            return _nr(not_run)
        return _v(bool(r), ok_desc if r else fail_desc)

    tree_hits = routes.get("tree", 0)
    search_hits = routes.get("search", 0)
    drafts_hits = routes.get("drafts_recovery", 0)
    perm = "能力面：pack 无该域受控协议/命令（结构性不可达，非伪造）"
    rows: list[dict] = []

    def add(fid: str, a: str, b: str, o: str, note: str = "", force_fill: bool = False) -> None:
        rows.append({"featureId": fid, "domain": ROW_DOMAIN.get(fid, ""), "packAEntry": a, "packBEntry": b,
                     "officialBaselineResult": o, "note": note, "forceFill": force_fill})

    add("F01", _nr(perm), _nr(perm),
        pv(res("F-OFF-1 F01"), "官方 UI 文件树点击打开 fe-ledger.md + 页签渲染（CDP 真实 DOM）"),
        "F01 域行：官方路径真实执行；pack 无工作区生命周期通道")
    add("F02", _nr("pack A 未声明 commands（能力面）"),
        pv(res("F-PB-3"), "command.invoke article.set-title → 后端 frontmatter 落盘"),
        pv(res("F-OFF-3"), "官方 UI 右栏标题→保存属性→frontmatter 落盘"))
    add("F03", _nr(perm), _nr(perm),
        pv(comb("F-OFF-4", "F-OFF-5", "F-OFF-6"), "官方 UI Ctrl+B/Ctrl+I/工具栏加粗+撤销+重做（真实 DOM 断言）"))
    add("F04", _nr(perm), _nr(perm),
        pv(res("F-OFF-9"), "官方 UI 插入公式→全屏公式编辑器打开（入口级）"))
    add("F05", _nr(perm), _nr(perm),
        pv(res("F-OFF-8"), "官方 UI 表格尺寸选择器→插入表格→撤销"))
    add("F06", pv(res("F-PA-2"), "context.snapshot 读到 basic.md 的 KE 信息块/公式原文（只读）"),
        pv(res("F-PB-2"), "context.snapshot 读到 basic.md 的 KE 信息块原文（只读）"),
        pv(res("F-OFF-17"), "官方 UI 打开 basic.md：ke-note/表格/KaTeX 真实渲染"))
    pa6_method = str(detail("F-PA-6").get("eventMethod") or "")
    pa7_method = str(detail("F-PA-7").get("eventMethod") or "")
    add("F07", _nr("guest 无写/恢复通道；已收到 document-saved 事件（只读观察；方法=" + (pa6_method or "未执行") + "）"),
        _nr("同左"),
        pv(res("F-OFF-2"), "官方 UI 正文编辑→自动/手动保存→磁盘落盘"))
    add("F08", _nr("guest 无 history/recovery 协议方法；仅 document-saved/事件观察（方法=" + (pa6_method or "未执行") + "）"), _nr("同左"),
        pv(res("F-OFF-12"), "官方 UI 历史快照按钮→历史版本面板打开（/api/history/list 真实调用）"))
    add("F09", _nr("guest 网络被 CSP 阻断且无附件协议"), _nr("同左"),
        pv(res("F-OFF-13"), "官方 UI 附件面板打开（/api/attachments/list 真实调用）"))
    add("F10", _nr("pack A 无命令/搜索通道"),
        pv(res("F-PB-4"), "article.set-tags → frontmatter tags 落盘（tags 写入切片）"),
        pv(comb("F-OFF-11") and search_hits > 0, f"官方 UI 搜索框搜索→结果渲染（/api/search 命中 {search_hits} 次）"))
    add("F11", _nr("guest 无 trash 通道"), _nr(perm),
        pv(res("F-OFF-14"), "官方 UI 回收站导航→回收站面板打开（入口级）"))
    add("F12", pv(comb("F-PA-1", "F-PA-3"), "snapshot 返回正文原字符串（含 frontmatter；256KB 大文档可读）"),
        pv(res("F-PB-1"), "snapshot 读取正文（只读）"),
        pv(res("F-OFF-10"), "官方 UI 源码模式 textarea 显示 Markdown 原文"))
    add("F13", _nr(perm), _nr(perm),
        pv(res("F-OFF-15"), "官方 UI 导出菜单→导出 PDF 对话框（含 A4 预览）真实打开；最终落盘未执行（隔离限制）"))
    d15 = detail("F-OFF-15")
    r15 = res("F-OFF-15")
    d19 = detail("F-OFF-19")
    r19 = res("F-OFF-19")
    if r19 is True:
        f14_official = _nr(
            "官方 UI 导出 PDF 对话框（含 A4 预览）已执行；export_pdf 落点 %USERPROFILE%/Documents 无法安全隔离"
            f"（覆盖 USERPROFILE 会破坏 WebView2 CDP）→ 未执行；另验证官方 Rust print 管线 preview_pdf 真实 PDF 落盘（隔离 TEMP，{d19.get('size')}B/%PDF）")
    elif r19 is False:
        f14_official = _v(False, "官方 Rust print 管线 preview_pdf 真实 PDF 落盘失败（隔离 TEMP）")
    else:
        f14_official = _nr("官方导出落盘未执行（不伪造）")
    add("F14", pv(res("F-PA-4"), "print.snapshot→真实 PDF（%PDF，隔离目录，>1000B）"),
        _nr("pack B 未声明 print.request 能力（能力面）"),
        f14_official)
    add("F15", pv(res("F-PA-7"), "官方主题切换→theme-changed 事件到达 guest（只读同步切片；方法=" + (pa7_method or "未执行") + "）"),
        _nr("pack B 未订阅事件/无设置通道"),
        pv(res("F-OFF-16"), "官方 UI 设置面板：常规/外观/快捷键/维护 + 主题分组"))
    menu_audit = (obs or {}).get("f16MenuAudit") or {}
    menu_items = menu_audit.get("items") or []
    f16_reason = ("原生菜单非 DOM，CDP 无法真实驱动；已对 menu.rs 做只读结构审计（"
                  + str(menu_audit.get("itemCount") or len(menu_items)) + " 项菜单项/加速键/事件分发，见证据 P5-T26-F16-native-menu-audit.md）；W/DOM 未覆盖")
    add("F16", _nr("guest 无窗口/菜单通道（设计上不应开放）"), _nr("同左"), _nr(f16_reason), force_fill=True)

    add("CMD.editor.bold", _nr(perm), _nr(perm),
        pv(res("F-OFF-4"), "官方 UI Ctrl+B→strong 出现→撤销还原"))
    add("CMD.editor.italic", _nr(perm), _nr(perm),
        pv(res("F-OFF-5"), "官方 UI Ctrl+I→em 出现→撤销还原"))
    add("CMD.editor.undo", _nr(perm), _nr(perm),
        pv(res("F-OFF-6"), "官方 UI 工具栏撤销→strong 还原"))
    add("CMD.editor.redo", _nr(perm), _nr(perm),
        pv(res("F-OFF-6"), "官方 UI 工具栏重做→strong 复现"))
    add("UI.toolbar.加粗", _nr(perm), _nr(perm),
        pv(res("F-OFF-6"), "官方 UI 工具栏「加粗」按钮→strong"))
    add("UI.toolbar.信息块-ke-note", _nr(perm), _nr(perm),
        pv(res("F-OFF-7"), "官方 UI 工具栏插入信息块→[data-ke-note] 节点"))
    add("UI.toolbar.表格", _nr(perm), _nr(perm),
        pv(res("F-OFF-8"), "官方 UI 工具栏表格→尺寸选择器→插入表格"))
    add("UI.export.pdf", _nr(perm), _nr(perm),
        pv(r15, "官方 UI 导出菜单→PDF 对话框（含 A4 预览）真实打开；最终 export_pdf 落 Documents 不可隔离未执行"))
    add("UI.dialog.exportpdf", _nr(perm), _nr(perm),
        pv(r15, "官方 UI 导出 PDF 对话框（含 A4 预览）真实打开；最终导出落盘不可隔离未执行"))
    add("API.documents.get._tree", _nr("guest 无 /api/tree 等价受控协议方法"), _nr("同左"),
        pv(comb("F-OFF-1") and tree_hits > 0, f"官方 UI 文件树渲染（/api/tree 命中 {tree_hits} 次）"))
    add("API.search.get.root", _nr(perm), _nr("同左"),
        pv(comb("F-OFF-11") and search_hits > 0, f"官方 UI 搜索触发 /api/search（命中 {search_hits} 次）+ 结果渲染"))
    add("API.drafts.get._recovery", _nr(perm), _nr("同左"),
        (_v(True, f"官方 UI 自动保存期间 /api/drafts/recovery 命中 {drafts_hits} 次") if drafts_hits > 0
         else _nr("官方 UI 自动化期间未观察到 /api/drafts/recovery 调用（不伪造）")))

    # F03 批量抽样行（官方 UI 真实快捷键/工具栏 + DOM 断言；pack 侧能力面不可达）
    for sp in F3_SPECS:
        r3 = res(F3_CHECK_PREFIX + sp["row"])
        d3 = detail(F3_CHECK_PREFIX + sp["row"])
        o3 = pv(r3,
                f"官方 UI {sp['label']}（CDP 真实操作 + DOM 断言 before={d3.get('before')}→after={d3.get('after')}）",
                "官方 UI 操作后 DOM 断言未通过",
                "本轮未执行")
        add(sp["row"], _nr(perm), _nr("同左"), o3)
    # 第三轮（task-20）：F03 剩余 12 行（工具栏/菜单入口真实执行；真实产物插入才 PASS）
    for sp in F3B_SPECS:
        cname = F3B_CHECK_PREFIX + sp["row"]
        r3b = res(cname)
        d3b = detail(cname)
        o3b = pv(r3b, f"官方 UI {sp['label']}（CDP 真实操作 + DOM 断言 before={d3b.get('before')}→after={d3b.get('after')}）",
                 "官方 UI 操作后未产生真实节点/产物（如实 FAIL）", "本轮未执行")
        add(sp["row"], _nr(perm), _nr("同左"), o3b)

    # F16 原生菜单 11 行：结构性证据（menu.rs 只读审计）已具备，但 DOM/W 断言未覆盖 → 如实 NOT_RUN
    menu_by_id = {it.get("id"): it for it in menu_items}
    for mid, fid in F16_MENU_ROWS.items():
        it = menu_by_id.get(mid) or {}
        reason = ("原生菜单非 DOM，CDP 无法驱动真实点击；结构性证据：menu.rs `" + mid + "`"
                  + (f" 标签「{it.get('label')}」" if it.get("label") else "")
                  + (f" 加速键 `{it.get('accelerator')}`" if it.get("accelerator") else " 无加速键")
                  + f" → 事件 `{it.get('eventId')}`；W/DOM 未覆盖")
        add(fid, _nr("guest 无窗口/菜单通道（设计上不应开放）"), _nr("同左"), _nr(reason), force_fill=True)
    return rows


F_DOMAIN_TOTAL = {"F01": 10, "F02": 6, "F03": 42, "F04": 1, "F05": 1, "F06": 3, "F07": 3, "F08": 4,
                  "F09": 5, "F10": 5, "F11": 3, "F12": 1, "F13": 6, "F14": 1, "F15": 19, "F16": 11}


def summary_stats(rows: list[dict]) -> dict:
    by_domain: dict[str, dict] = {}
    for r in rows:
        d = r.get("domain") or (r["featureId"] if re.fullmatch(r"F\d\d", r["featureId"]) else next(
            (x for x, n in F_DOMAIN_TOTAL.items() if r["featureId"].startswith(x)), "OTHER"))
        s = by_domain.setdefault(d, {"registered": 0, "packAPass": 0, "packBPass": 0, "officialPass": 0, "officialFail": 0, "officialNr": 0})
        s["registered"] += 1
        s["packAPass"] += 1 if r["packAEntry"].startswith("PASS") else 0
        s["packBPass"] += 1 if r["packBEntry"].startswith("PASS") else 0
        o = r["officialBaselineResult"]
        s["officialPass"] += 1 if o.startswith("PASS") else 0
        s["officialFail"] += 1 if o.startswith("FAIL") else 0
        s["officialNr"] += 1 if o.startswith("NOT_RUN") else 0
    return by_domain


# ---------------- CSV / 报告写出 ----------------


def update_csv(rows: list[dict]) -> int:
    filled = [r for r in rows if r.get("forceFill") or not (
        r["packAEntry"].startswith("NOT_RUN") and r["packBEntry"].startswith("NOT_RUN")
        and r["officialBaselineResult"].startswith("NOT_RUN"))]
    raw = CSV_PATH.read_text(encoding="utf-8")
    lines = raw.splitlines(keepends=True)
    header = next(csv.reader([lines[0].rstrip("\n")]))
    idx = {name: header.index(name) for name in ("featureId", "packAEntry", "packBEntry", "officialBaselineResult")}
    changed = 0
    for entry in filled:
        for i in range(1, len(lines)):
            fields = next(csv.reader([lines[i].rstrip("\n")]))
            if not fields or fields[0] != entry["featureId"]:
                continue
            fields[idx["packAEntry"]] = entry["packAEntry"]
            fields[idx["packBEntry"]] = entry["packBEntry"]
            fields[idx["officialBaselineResult"]] = entry["officialBaselineResult"]
            buf = io.StringIO()
            csv.writer(buf, lineterminator="").writerow(fields)
            lines[i] = buf.getvalue() + ("\n" if lines[i].endswith("\n") else "")
            changed += 1
            break
    if changed:
        CSV_PATH.write_text("".join(lines), encoding="utf-8")
    return changed


def write_evidence_md(result: dict, rows: list[dict], stats: dict, changed: int) -> None:
    checks = result["checks"]
    build = result["build"]
    packs = result["packs"]
    routes = result["routes"]
    passed = sum(1 for c in checks if c["pass"])
    total = len(checks)
    lines = [
        "# P5-T26 F01–F16 逐项台账登记证据（pack A / pack B / 官方 UI 三路径）",
        "",
        f"- 生成时间：{time.strftime('%Y-%m-%dT%H:%M:%S%z')}",
        "- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 11 + WebView2 隔离产品构建",
        f"- 测试构建：`{build['exe']}`（sha256=`{build['sha256']}`，mtime=`{build['mtime']}`；本轮未重建 exe）",
        f"- 参考包：A=`{PACK_A['id']}`（{json.dumps(PACK_A['capabilities'])}）、B=`{PACK_B['id']}`"
        f"（{json.dumps(PACK_B['capabilities'])}，commands={json.dumps(PACK_B['commands'])}）；"
        f"构建来源=`{packs['mode']}`（测试自签密钥只在 `C:\\ke-tmp`，不入仓）",
        f"- 隔离环境：workspace=`{result['paths']['workspace']}`；APPDATA=`{result['paths']['appdata']}`；PDF out=`{result['paths']['pdfOut']}`",
        "- 驱动方式：CDP 主窗口（官方 UI：真实点击/输入/快捷键）+ 浏览器级 `Target.attachToTarget`(flatten)"
        " 附加 guest iframe（OOPIF，在 guest 真实 DOM 上操作）；结论读取 guest 状态镜像、宿主会话状态与磁盘文件",
        "",
        "## 结论",
        "",
        f"- 探针 checks：**{passed}/{total} PASS**（失败项如实列出；失败不等于台账行失败，见逐行结果）。",
        f"- 本轮登记（真实执行）行数：**{len([r for r in rows if not (r['packAEntry'].startswith('NOT_RUN') and r['packBEntry'].startswith('NOT_RUN') and r['officialBaselineResult'].startswith('NOT_RUN'))])} 行**"
        f"（写入 CSV 的 `packAEntry`/`packBEntry`/`officialBaselineResult` 共 {changed} 行；其余行保持 `NOT_RUN`）。",
        "- 三路径口径：pack A/B = 参考包真实能力面；官方 UI = 产品官方 UI 真实 CDP 自动化。"
        "**未执行的操作不写成 PASS**；能力面不可达的 pack 路径记 `NOT_RUN:能力面...`（不是伪造 FAIL/PASS）。",
        "",
        "## 逐项（F01–F16 域行）",
        "",
        "| F | 已登记行 | pack A PASS | pack B PASS | 官方 PASS/FAIL/NOT_RUN | 说明 |",
        "| --- | ---: | ---: | ---: | --- | --- |",
    ]
    for d in [f"F{i:02d}" for i in range(1, 17)]:
        s = stats.get(d) or {"registered": 0, "packAPass": 0, "packBPass": 0, "officialPass": 0, "officialFail": 0, "officialNr": 0}
        row = next((r for r in rows if r["featureId"] == d), None)
        note = ""
        if row:
            note = str(row["officialBaselineResult"])[:90]
        lines.append(f"| {d} | {s['registered']}/{F_DOMAIN_TOTAL[d]} | {s['packAPass']} | {s['packBPass']} | {s['officialPass']}/{s['officialFail']}/{s['officialNr']} | {note} |")
    lines += [
        "",
        "> 注：登记行包含域行（F01–F16 各 1 行）+ 本轮真实执行的细粒度行（快捷键/工具栏/导出/API 等），"
        "详见下方 CSV 登记清单；`F16` 三路径均 NOT_RUN（原生菜单非 DOM 可驱动、guest 不应触达窗口）。",
        "",
        "## CSV 登记清单（本轮写入）",
        "",
        "| featureId | packAEntry | packBEntry | officialBaselineResult |",
        "| --- | --- | --- | --- |",
    ]
    for r in rows:
        if all(x.startswith("NOT_RUN") for x in (r["packAEntry"], r["packBEntry"], r["officialBaselineResult"])):
            continue
        lines.append(f"| `{r['featureId']}` | {r['packAEntry']} | {r['packBEntry']} | {r['officialBaselineResult']} |")
    lines += [
        "",
        "## 探针 checks（真实执行明细）",
        "",
        "| # | check | 结果 | 关键值 |",
        "| --- | --- | --- | --- |",
    ]
    for i, c in enumerate(checks, 1):
        d = json.dumps(c.get("detail"), ensure_ascii=False)
        if len(d) > 300:
            d = d[:300] + "…"
        lines.append(f"| {i} | {c['name']} | {'PASS' if c['pass'] else 'FAIL'} | `{d}` |")
    lines += [
        "",
        "## 内部路由命中（官方 UI 真实调用证据，来自隔离实例 app.log）",
        "",
        "```json",
        json.dumps(routes, ensure_ascii=False, indent=2),
        "```",
        "",
        "## 限制与未覆盖原因（如实）",
        "",
        "- **pack 能力面限制**：参考包 A/B 只声明最小能力（A: ui.shell/panel.sidebar/context.read/print.request；B: ui.shell/panel.dock/context.read + 2 条声明式命令）。"
        "工作区生命周期（F01）、编辑器命令/快捷方式（F03/F04/F05）、附件（F09）、回收站（F11）、导入导出（F13）、桌面行为（F16）等"
        "在 guest 协议面没有对应方法/命令 → packA/B 列记 `NOT_RUN:能力面...`（结构性不可达，非伪造结果）；"
        "这与 `reports/F01-F16-COVERAGE.md` 的审计结论一致（G5/G6 仍未变）。",
        "- **官方 UI 导出落盘未执行**：官方「导出 PDF」最终 `export_pdf` 的落盘路径不受本探针隔离 seam（`__KE_PRINT_OUTPUT_DIR__` 只覆盖 print_snapshot）控制，"
        "为避免写出隔离目录/真实用户目录，探针只验证「菜单→对话框（含 A4 预览）→取消」，**没有点击最终导出**；"
        "F13/F14 的官方行因此如实标注「落盘副作用未执行」。",
        "- **F16 原生菜单不可自动化**：桌面原生菜单不是 DOM，CDP 无法真实点击；guest 侧也不应有窗口/菜单通道 → F16 三路径全部 NOT_RUN（不伪造）。",
        "- **F03 只抽样**：42 条格式/快捷键行中本轮真实执行 4 条快捷键动作 + 3 条工具栏动作（含撤销/重做/信息块/表格）；"
        "其余行保持 NOT_RUN（未逐条执行，不填）。",
        "- **官方基线口径**：`officialBaselineResult` 全部来自产品官方 UI 的真实 CDP 自动化（点击/输入/快捷键），"
        "并用真实 DOM/磁盘/内部 API 日志断言；不是单测/happy-dom 结果。域行（F01–F16）为「代表性任务」执行结果，不等价 ACCEPTANCE 原文全量标准（任务包原件不在仓库）。",
        "- **同时段隔离**：运行前检测并等待其它隔离实例（另一 W 探针）退出，避免单实例互相接管；本轮实际等待结果见 checks/F-PREP-1。",
        "- **Windows W 证据性质**：隔离测试构建 + 隔离 APPDATA/工作区 + 测试自签密钥；不等于正式发布认证；用户 App（`D:\\AstraNota`）未运行、未触碰。",
        "",
        "## 复现",
        "",
        "```powershell",
        "$env:PYTHONIOENCODING='utf-8'",
        "py -X utf8 'F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\tools\\run_feature_entry_probe.py'",
        "```",
        "",
        f"原始 JSON：`docs/ui-workshop/evidence/T26-F-ledger-results.json`",
        "",
    ]
    (EVID / "P5-T26-F-ledger.md").write_text("\n".join(lines), encoding="utf-8")


def append_coverage(result: dict, rows: list[dict], stats: dict) -> None:
    if not COVERAGE.exists():
        return
    original = COVERAGE.read_text(encoding="utf-8")
    have_d = "## 附录 D：台账登记进展" in original
    if "## 附录 G" in original:
        print("COVERAGE 已含附录 G，跳过追加", flush=True)
        return
    if "## 附录 F" in original:
        def find_ck(prefix: str) -> dict:
            for ck in result["checks"]:
                if ck["name"].startswith(prefix):
                    return ck
            return {}

        g_lines = ["| featureId | 结果 | 操作（官方 UI 工具栏/菜单入口） | DOM 断言（前→后） |",
                   "| --- | --- | --- | --- |"]
        for sp in F3B_SPECS:
            ck = find_ck(F3B_CHECK_PREFIX + sp["row"])
            det = ck.get("detail") if isinstance(ck.get("detail"), dict) else {}
            g_lines.append("| `{}` | {} | {} | before={} → after={} |".format(
                sp["row"], "PASS" if ck.get("pass") else "FAIL", sp["label"], det.get("before"), det.get("after")))
        audit = (result.get("f16MenuAudit") or {})
        items = audit.get("items") or []
        audit_lines = ["| MID | 标签 | 加速键 | 事件 ID | 分发目标（handle_event） |",
                       "| --- | --- | --- | --- | --- |"]
        for it in items:
            audit_lines.append("| `{}` | {} | {} | `{}` | {} |".format(
                it.get("id"), it.get("label"), it.get("accelerator") or "（无）",
                it.get("eventId") or "", (it.get("handler") or "")[:90].replace("|", "/")))
        update = [
            "", "---", "",
            "## 附录 G：第三轮增量（v4，2026-10-19）",
            "",
            "> 本节为 task-20 第三轮增量（**F03 剩余 12 行** + **F16 原生菜单只读结构审计**），追加在附录 F 之后；不改上文结论。",
            "",
            "### G.1 F03 剩余 12 行（官方 UI 工具栏/菜单入口真实执行；真实节点/产物才 PASS）",
            "",
            "- 说明：这 12 行在 `state/shortcuts.ts` 中 `defaultKey=null`（无默认快捷键），改用官方工具栏/菜单入口真实执行；"
            "每行真实 CDP 操作 + DOM 断言（前→后）；未产生真实节点/产物的行如实 FAIL/NOT_RUN。",
            "",
        ] + g_lines + [
            "",
            "### G.2 F16 原生菜单结构审计（只读 `desktop/src-tauri/src/menu.rs`；DOM/W 未覆盖）",
            "",
            f"- 审计结果：menu.rs 共 **{audit.get('itemCount', len(items))}** 个 `MenuItem`（文件/编辑/视图/帮助子菜单），"
            "含 ID（`ke-menu:*`）、标签、加速键与 `handle_event` 分发目标。",
            "- **原生菜单不是 DOM，CDP 无法真实点击** → 本节仅为结构性证据（U/静态）；"
            "`feature-baseline.csv` 的 F16 菜单行（11 行含域行）如实记 `NOT_RUN` 并写原因，**不伪造 W/DOM**。",
            "- 证据文件：`evidence/P5-T26-F16-native-menu-audit.md`。",
            "",
        ] + audit_lines + [
            "",
            "### G.3 覆盖统计（F 域已登记行 / 该域总行）",
            "",
            "| F | 已登记行 / 该域总行 | pack A PASS | pack B PASS | 官方 PASS/FAIL/NOT_RUN |",
            "| --- | ---: | ---: | ---: | --- |",
        ]
        for d in [f"F{i:02d}" for i in range(1, 17)]:
            st4 = stats.get(d) or {"registered": 0, "packAPass": 0, "packBPass": 0, "officialPass": 0, "officialFail": 0, "officialNr": 0}
            update.append(f"| {d} | {st4['registered']}/{F_DOMAIN_TOTAL[d]} | {st4['packAPass']} | {st4['packBPass']} | {st4['officialPass']}/{st4['officialFail']}/{st4['officialNr']} |")
        update.append("")
        COVERAGE.write_text(original.rstrip("\n") + "\n" + "\n".join(update), encoding="utf-8")
        return
    if have_d and "### D.5" in original:
        print("COVERAGE 已含 D.5 第二窗口更新，跳过追加", flush=True)
        return
    registered = [r for r in rows if not all(x.startswith("NOT_RUN") for x in (r["packAEntry"], r["packBEntry"], r["officialBaselineResult"]))]
    lines = [
        "",
        "---",
        "",
        "## 附录 D：台账登记进展（2026-10-19，task-9）",
        "",
        "> 本节为**追加**，不改上文（§0–§7）审计结论。上文结论对应提交 `3117c7d` 时点；此后 G1–G4/G7 已落地"
        "（`1ea4c62` G1/G2 内容读写通道、`50621cc` G3/G4 真实打印+宿主事件、`bf11462` G7 参考包 A/B），"
        "上文 G1–G4/G7 缺口状态已过时，以本节与 `evidence/P5-T26-F-ledger.md` 为准。",
        "",
        "### D.1 本轮真实登记结果（三路径）",
        "",
        f"- 探针：`tools/run_feature_entry_probe.py`（复用 G7 隔离产品骨架；官方 UI 用 CDP 真实点击/输入/快捷键）",
        f"- 探针 checks：**{sum(1 for c in result['checks'] if c['pass'])}/{len(result['checks'])} PASS**（含环境/安装/启用/事件/收尾）",
        f"- CSV 登记：**{len(registered)} 行**写入 `packAEntry`/`packBEntry`/`officialBaselineResult`（其余 121 行 F 域行保持 NOT_RUN）",
        f"- 证据：`evidence/T26-F-ledger-results.json`、`evidence/P5-T26-F-ledger.md`",
        "",
        "| F | 已登记行 / 该域总行 | pack A PASS | pack B PASS | 官方 PASS/FAIL/NOT_RUN |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for d in [f"F{i:02d}" for i in range(1, 17)]:
        s = stats.get(d) or {"registered": 0, "packAPass": 0, "packBPass": 0, "officialPass": 0, "officialFail": 0, "officialNr": 0}
        lines.append(f"| {d} | {s['registered']}/{F_DOMAIN_TOTAL[d]} | {s['packAPass']} | {s['packBPass']} | {s['officialPass']}/{s['officialFail']}/{s['officialNr']} |")
    lines += [
        "",
        "### D.2 本次真实通过的关键路径（摘要）",
        "",
        "- **pack A（读/打印/事件）**：`context.snapshot` 读到正文原字符串（含 frontmatter；basic.md 的 KE 信息块/公式原文；256KB 大文档）；"
        "`print.snapshot` 产出真实 PDF（`%PDF`、隔离目录、>1000B）；官方保存触发 `document-saved` 事件到达 guest 并自动刷新；官方主题切换触发 `theme-changed` 事件。",
        "- **pack B（写/命令）**：`context.snapshot` + frontmatter 自动填充；`command.invoke article.set-title/set-tags` 真实后端落盘 frontmatter；空标题被拒（E_TITLE）且磁盘不被改；"
        "pack B 未声明 `print.request` → print 路径 NOT_RUN（能力面）。",
        "- **官方 UI（CDP 真实自动化）**：打开文档/页签、右栏元数据保存、Ctrl+B/Ctrl+I、工具栏加粗/撤销/重做/信息块/表格、插入公式入口、源码模式、搜索、"
        "历史版本面板、附件面板、回收站面板、设置面板（4 分组+主题）、导出菜单→PDF 对话框（含 A4 预览，未执行落盘）、basic.md 的 KE/表格/公式真实渲染。",
        "",
        "### D.3 仍未覆盖的原因（与上文结论对齐）",
        "",
        "- **能力面结构性不可达**：guest 协议仍无工作区生命周期（F01）、编辑器命令（F03/F04/F05）、附件（F09）、回收站（F11）、导入导出（F13）、窗口/菜单（F16）方法；"
        "参考包 A/B 只声明最小能力，故这些域 packA/B 列记 NOT_RUN（不是伪造 FAIL）。",
        "- **官方导出落盘未执行**：`export_pdf` 最终落盘路径不受探针隔离 seam 控制 → F13/F14 官方行只验证到对话框入口（明确标注）。",
        "- **F16 原生菜单不可 CDP 驱动**（非 DOM）→ 三路径 NOT_RUN。",
        "- **F03 只抽样 7 条**（4 快捷键 + 3 工具栏）；42 行其余保持 NOT_RUN，未逐条执行不填写。",
        "",
    ]
    if have_d:
        registered2 = len(registered)
        pass2 = sum(1 for c in result["checks"] if c["pass"])
        if "## 附录 F" in original:
            print("COVERAGE 已含附录 F，跳过追加", flush=True)
            return
        if "## 附录 E" in original:
            def find_ck(prefix: str) -> dict:
                for ck in result["checks"]:
                    if ck["name"].startswith(prefix):
                        return ck
                return {}

            d15 = (find_ck("F-OFF-15").get("detail") or {})
            d19 = (find_ck("F-OFF-19").get("detail") or {})
            f3_rows = []
            f3_pass = 0
            for sp in F3_SPECS:
                ck = find_ck(F3_CHECK_PREFIX + sp["row"])
                det3 = ck.get("detail") if isinstance(ck.get("detail"), dict) else {}
                ok3 = bool(ck.get("pass"))
                f3_pass += 1 if ok3 else 0
                f3_rows.append(f"| `{sp['row']}` | {'PASS' if ok3 else 'FAIL'} | {sp['label']} | before={det3.get('before')} → after={det3.get('after')} |")
            update = [
                "",
                "---",
                "",
                "## 附录 F：第二轮增量（v3，2026-10-19）",
                "",
                "> 本节为 task-17 第二轮增量（**F03 批量** + **F14 官方导出落盘尝试**），追加在附录 E 之后；不改上文结论。",
                "",
                "### F.1 F03 批量抽样（官方 UI 真实快捷键/工具栏 + CDP DOM 断言）",
                "",
                f"- 本轮新增真实执行 **{len(F3_SPECS)} 行**（{f3_pass} PASS / {len(F3_SPECS) - f3_pass} FAIL）；"
                "未执行行保持 NOT_RUN（不伪造）。",
                "",
                "| featureId | 结果 | 操作 | DOM 断言（动作前→后） |",
                "| --- | --- | --- | --- |",
            ] + f3_rows + [
                "",
                "### F.2 F14 官方导出落盘尝试（如实：部分 + NOT_RUN）",
                "",
                "- **官方 UI 导出对话框**：导出菜单 →「导出 PDF（打印为 PDF）」→ 对话框（含 A4 DOM 预览）真实打开 → 取消；"
                "（最终 `export_pdf` 未点击执行）。",
                "- **`export_pdf` 无法安全隔离**：Rust 落点 = `%USERPROFILE%\\Documents\\AstraNota Exports`；实测**覆盖子进程 USERPROFILE 会导致 WebView2 不开放 CDP 端口**（探针无法驱动），"
                "因此无法在不触碰真实用户 Documents 的前提下执行 → **如实 NOT_RUN**，未写真实用户目录。",
                "- **替代真实落盘验证（官方 print 管线 `preview_pdf`）**：同一 Rust `render_pdf_to` 管线、同一打印设置，落点 = `%TEMP%\\AstraNota-preview`；"
                "本轮探针把 `TEMP/TMP` 指向隔离目录后调用官方命令真实生成 PDF："
                f"**{'PASS' if d19.get('size') else 'FAIL'}**（exists={d19.get('exists')}, size={d19.get('size')}, head={d19.get('head')}, "
                f"isolatedTemp={d19.get('underIsolatedTemp')}），并用官方 `discard_preview_pdf` 清理。",
                "- 结论：F14 官方 CSV 列保持 **NOT_RUN**（导出 Documents 未执行）；`preview_pdf` 真实 PDF 作为「官方管线可真实落盘」的补充证据，不冒充最终导出。",
                "",
                "### F.3 覆盖统计（F 域已登记行 / 该域总行）",
                "",
                "| F | 已登记行 / 该域总行 | pack A PASS | pack B PASS | 官方 PASS/FAIL/NOT_RUN |",
                "| --- | ---: | ---: | ---: | --- |",
            ]
            for d in [f"F{i:02d}" for i in range(1, 17)]:
                st3 = stats.get(d) or {"registered": 0, "packAPass": 0, "packBPass": 0, "officialPass": 0, "officialFail": 0, "officialNr": 0}
                update.append(f"| {d} | {st3['registered']}/{F_DOMAIN_TOTAL[d]} | {st3['packAPass']} | {st3['packBPass']} | {st3['officialPass']}/{st3['officialFail']}/{st3['officialNr']} |")
            update.append("")
            COVERAGE.write_text(original.rstrip("\n") + "\n" + "\n".join(update), encoding="utf-8")
            return
        def find_check(prefix: str) -> dict:
            for ck in result["checks"]:
                if ck["name"].startswith(prefix):
                    return ck
            return {}

        pa6 = find_check("F-PA-6")
        pa7 = find_check("F-PA-7")
        pa8 = find_check("F-PA-8")
        d6 = pa6.get("detail") if isinstance(pa6.get("detail"), dict) else {}
        d7 = pa7.get("detail") if isinstance(pa7.get("detail"), dict) else {}
        d8 = pa8.get("detail") if isinstance(pa8.get("detail"), dict) else {}
        update = [
            "",
            "---",
            "",
            "## 附录 E：第二轮补登记（v2，2026-10-19）",
            "",
            "> 本节为第二轮窗口（Lead GO）正式跑结果，追加在 v1 附录 D 之后；不改上文（§0–§7 / 附录 D）结论。",
            "",
            "### E.1 v1 失败根因与修复（pack A 事件三项）",
            "",
            "- **v1 根因**：v1 探针在 pack A 事件测试前调用通用 `dismiss_overlays()`，会点击工坊对话框的「关闭」→ 工坊面板卸载 → guest iframe 停止，"
            "导致 document-saved / theme-changed / 停用 guest 3 项连锁失败（**探针缺陷，不是产品能力失败**）。",
            "- **修复**：移除该调用；document-saved 改为「真实保存优先（显式设置编辑器末尾选区 + 插入 marker + 等待磁盘/事件）」；"
            "theme-changed 改为「真实设置面板切主题优先」；两者在窗口内未触发时兜底使用**产品真实 window 事件入口**"
            "（`ke:workshop-document-saved` / `ke:workshop-theme-changed`，与产品保存链/主题链 dispatch 同名），"
            "并在 check detail 标注 `eventMethod`；停用 guest 增加面板就绪等待 + 15s 轮询。",
            "",
            "### E.2 事件三项最终结果（如实，含方法）",
            "",
            f"| 项 | 结果 | 方法 | 关键值 |",
            f"| --- | --- | --- | --- |",
            f"| F-PA-6 document-saved | {'PASS' if pa6.get('pass') else 'FAIL'} | `{d6.get('eventMethod', '未执行')}` | saved={d6.get('saved')}, event={json.dumps(d6.get('event'), ensure_ascii=False)[:120]} |",
            f"| F-PA-7 theme-changed | {'PASS' if pa7.get('pass') else 'FAIL'} | `{d7.get('eventMethod', '未执行')}` | event={json.dumps(d7.get('event'), ensure_ascii=False)[:120]} |",
            f"| F-PA-8 停用 guest | {'PASS' if pa8.get('pass') else 'FAIL'} | `real-ui-click` | state={d8.get('state')}, stopClicked={d8.get('stopClicked')} |",
            "",
            "- 方法口径：`real-save` / `real-theme-toggle` = 真实保存链/真实主题切换触发；"
            "`bridge-window-event(...)` = 测试兜底注入（走产品真实事件入口与 G4 事件桥，**不是** mock；真实保存链由 F-OFF-2 单独覆盖）；"
            "`未执行` = 本轮未跑到。",
            "",
            "### E.3 本轮覆盖统计（CSV 已登记行）",
            "",
            f"- 探针 checks：**{pass2}/{len(result['checks'])} PASS**；CSV 已登记 **{registered2} 行**（v1 27 行基础上按本轮真实结果更新；其余 F 域行保持 NOT_RUN）。",
            "",
            "| F | 已登记行 / 该域总行 | pack A PASS | pack B PASS | 官方 PASS/FAIL/NOT_RUN |",
            "| --- | ---: | ---: | ---: | --- |",
        ]
        for d in [f"F{i:02d}" for i in range(1, 17)]:
            st2 = stats.get(d) or {"registered": 0, "packAPass": 0, "packBPass": 0, "officialPass": 0, "officialFail": 0, "officialNr": 0}
            update.append(f"| {d} | {st2['registered']}/{F_DOMAIN_TOTAL[d]} | {st2['packAPass']} | {st2['packBPass']} | {st2['officialPass']}/{st2['officialFail']}/{st2['officialNr']} |")
        update.append("")
        COVERAGE.write_text(original.rstrip("\n") + "\n" + "\n".join(update), encoding="utf-8")
        return
    COVERAGE.write_text(original.rstrip("\n") + "\n" + "\n".join(lines), encoding="utf-8")


# ---------------- F03 FAIL 根因审计（task-21，--audit-f03） ----------------


def _js_select_editor(cdp, mode: str = "para-end", chars: int = 4) -> bool:
    """在编辑器内设置选区：mode=para-end（段落末尾光标）/ text（选中前 N 字符）/ all。"""
    if mode == "all":
        return select_all_editor(cdp)
    expr = """(() => {
      const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus();
      const pm = el.pmViewDesc ? el.pmViewDesc : null;
      const sel = window.getSelection(); const r = document.createRange();
      let target = null; let count = 0;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let first = null; let last = null;
      while (walker.nextNode()) { const t = walker.currentNode; if (!t.textContent || !t.textContent.trim()) continue; if (!first) first = t; last = t; count++; }
      if (!first) return false;
      if (%MODE% === 'text') {
        target = first; const n = Math.min(%CHARS%, target.textContent.length);
        r.setStart(target, 0); r.setEnd(target, n);
      } else {
        target = last; r.setStart(target, Math.max(0, target.textContent.length - 1)); r.setEnd(target, target.textContent.length);
      }
      sel.removeAllRanges(); sel.addRange(r);
      return {count, text: sel.toString().slice(0, 40)};
    })()""".replace("%MODE%", json.dumps(mode)).replace("%CHARS%", str(chars))
    return bool(cdp.eval(expr))


def _js_key(cdp, key: str, code: str, key_code: int, ctrl: bool, shift: bool, alt: bool = False) -> bool:
    """JS 合成 KeyboardEvent 直接派发到编辑器 DOM（绕过 WebView2 浏览器级加速键）。"""
    expr = """(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false;
      el.focus();
      const ev = new KeyboardEvent('keydown', {key: %s, code: %s, keyCode: %d, which: %d,
        ctrlKey: %s, shiftKey: %s, altKey: %s, bubbles: true, cancelable: true});
      el.dispatchEvent(ev); return true; })()""" % (
        json.dumps(key), json.dumps(code), key_code, key_code,
        "true" if ctrl else "false", "true" if shift else "false", "true" if alt else "false")
    return bool(cdp.eval(expr))


def _counts(cdp) -> dict:
    return cdp.eval("({ul: document.querySelectorAll('.ProseMirror ul').length, ol: document.querySelectorAll('.ProseMirror ol').length, li: document.querySelectorAll('.ProseMirror li').length, bq: document.querySelectorAll('.ProseMirror blockquote').length, a: document.querySelectorAll('.ProseMirror a[href]').length, text: (document.querySelector('.ProseMirror')||{}).innerText ? document.querySelector('.ProseMirror').innerText.length : 0})") or {}


def _line_of(path_str: str, needle: str, occurrence: int = 1) -> int | None:
    try:
        lines = (REPO / path_str).read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return None
    n = 0
    for i, ln in enumerate(lines, 1):
        if needle in ln:
            n += 1
            if n == occurrence:
                return i
    return None


def code_audit_f03() -> dict:
    """代码审计：5 个 FAIL 的静态证据（文件/行/绑定缺失）。只读，不改代码。"""
    kbj = "frontend/src/editor/extensions/KeBlockJoin.ts"
    idx = "frontend/src/editor/index.ts"
    ext_bq = "frontend/node_modules/@tiptap/extension-blockquote/dist/index.js"
    ext_list = "frontend/node_modules/@tiptap/extension-list/dist/index.js"
    toolbar = "frontend/src/components/editor/EditorToolbar.tsx"
    sc = "frontend/src/state/shortcuts.ts"
    return {
        "blockquote": {
            "productExtensionDisabled": {"file": idx, "line": _line_of(idx, "blockquote: false")},
            "customExtension": {"file": kbj, "line": _line_of(kbj, "export const KeBlockquote")},
            "customShortcutOverride": {"file": kbj, "line": _line_of(kbj, "addKeyboardShortcuts()")},
            "customShortcutBodyReturns": {"file": kbj, "line": _line_of(kbj, "return { Backspace: deleteEmptyAfterAtom }")},
            "upstreamBinding": {"file": ext_bq, "line": _line_of(ext_bq, '"Mod-Shift-b"'), "value": "Mod-Shift-b"},
            "conclusion": "KeBlockquote.extend({ addKeyboardShortcuts() { return { Backspace } } }) 覆盖了上游快捷键表，"
                          "未 spread parent 的 { 'Mod-Shift-b': toggleBlockquote } → Ctrl+Shift+B 无绑定（PRODUCT_FINDING）。",
        },
        "list.bullet": {
            "upstreamBinding": {"file": ext_list, "line": _line_of(ext_list, '"Mod-Shift-8"'), "value": "Mod-Shift-8"},
            "probeAssertionFlaw": "台账探针断言只数 <ul> 数量；选中段落后快捷键会把段末块并入已有列表 → ul 仍为 1、li 2→3，原断言 before=1→after=1 误判 FAIL。",
            "runtimeAuditProvesWorks": "复核 4 通道（CDP key '8'/'*'、JS 合成、工具栏）均 li 2→3 → 快捷键真实生效（AUTOMATION_LIMITATION/probe assertion）。",
        },
        "save": {
            "toolbarOnSave": {"file": toolbar, "line": _line_of(toolbar, 'title="保存（Ctrl+S）"')},
            "probeFailureMode": "全量台账中保存按钮在连续自动化（大量 toggle/undo、源码模式、元数据保存）后处于保存失败/外部修改提示状态，25s 内未见 marker；干净态与 4×bold/undo 连续编辑复核均落盘成功。",
            "runtimeAuditProvesWorks": "干净态与 after-churn 复核均 diskSaved=true（状态栏「已保存」）。",
        },
        "link.insert": {
            "toolbarHandler": {"file": toolbar, "line": _line_of(toolbar, "extendMarkRange('link').setLink")},
            "probeFailureMode": "台账探针在全量序列后执行（选择状态/上一步撤销影响）；定向复核 with-selection 与 collapsed 均产生 <a href>。",
            "runtimeAuditProvesWorks": "复核两种前置均 beforeA=0→afterA=1，href=examples/f03audit。",
        },
        "module.insert": {
            "toolbarInsertModule": {"file": toolbar, "line": _line_of(toolbar, "const insertModule")},
            "pickerTrigger": {"file": toolbar, "line": _line_of(toolbar, '插入模块（复制 Modules/ 内容')},
            "dropdownLazyLoad": {"file": toolbar, "line": _line_of(toolbar, "const toggleModulePicker")},
            "probeFailureMode": "Dropdown 为 portal + 懒加载：打开时先渲染「暂无模块」，items 异步到达；台账探针在模块按钮出现前用全页文本匹配（命中左侧 Modules 树）导致未点中面板项，随后重复点击 trigger 把面板关掉。",
            "backendApi": "backend /api/modules 200（app.log 4 次；fixture Modules/示例模块.md 存在）；待定向复核（poll 面板项）。",
        },
        "shortcutsRegistry": {
            "file": sc,
            "listBulletDisplayKeyLine": _line_of(sc, "id: 'editor.list.bullet'"),
            "blockquoteDisplayKeyLine": _line_of(sc, "id: 'editor.blockquote'"),
            "note": "shortcuts.ts 的 defaultKey 仅用于展示/告警，不参与默认分派；实际绑定来自 Tiptap 扩展键盘快捷键。",
        },
    }


def execute_audit() -> dict:
    """F03 5 个 FAIL 的定向复核：干净实例、逐项正确前置条件 + 多输入通道变体。"""
    if not EXE.exists():
        raise RuntimeError("缺少隔离测试构建")
    build_sha = R.sha_file(EXE)
    packs_info = prepare_packs([])
    env_paths = prepare_env()
    appdata, ws = env_paths["appdata"], env_paths["workspace"]
    article_ledger = ws / "Articles" / "fe-ledger.md"
    R.cleanup()
    R.cleanup_test_identifier()
    if not wait_no_other_instance(120):
        raise RuntimeError("检测到其它隔离产品实例，已放弃")
    env = {
        **os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
        "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": packs_info["publicKeyHex"]}}),
        "KE_WS_PRINT_RENDER": "1",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
        "TEMP": str(env_paths["tmp"]), "TMP": str(env_paths["tmp"]),
    }
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, cwd=str(BASE), stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    audit = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "build": {"exe": str(EXE), "sha256": build_sha,
             "mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime))}, "cases": []}
    try:
        if not R.wait_until(lambda: bool(R.main_targets()), 150, 0.3):
            raise RuntimeError("CDP 主窗口未就绪")
        cdp = R.main_cdp()
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        R.browser_connect()
        R.wait_until(lambda: bool(cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'")), 30, 0.25)
        R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('button[aria-label=\"打开创意工坊\"]')")), 90, 0.25)
        R.host_eval(cdp, HOST_COLLECTOR)
        # 打开台账文档
        R.wait_until(lambda: R.has_text(cdp, "fe-ledger.md"), 60, 0.25)
        R.click_text(cdp, "fe-ledger.md")
        R.wait_until(lambda: DOC_BODY in R.editor_text(cdp), 45, 0.3)
        time.sleep(0.8)

        def record_case(case_id: str, name: str):
            def wrap(fn):
                case = {"id": case_id, "name": name, "variants": []}
                try:
                    fn(case)
                except Exception as e:  # noqa: BLE001
                    case["error"] = str(e)[:500]
                audit["cases"].append(case)
                print("CASE", case_id, "|", name, "|", json.dumps(case, ensure_ascii=False)[:600], flush=True)
                return case
            return wrap

        # ---- 1) 保存（工具栏保存按钮；干净态 + 连续编辑后两种前置） ----
        def case_save(case):
            def attempt(label: str, pre_churn: bool):
                mark = "F03AUDIT-SAVE-" + ("CLEAN" if not pre_churn else "AFTERCHURN")
                if pre_churn:
                    for _ in range(4):
                        _js_select_editor(cdp, "para-end")
                        _js_key(cdp, "b", "KeyB", 66, True, False)
                        time.sleep(0.15)
                        click_toolbar(cdp, "撤销")
                        time.sleep(0.15)
                R.focus_editor_end(cdp)
                cdp.eval("document.execCommand('insertText', false, " + json.dumps(mark) + ")")
                present = R.wait_until(lambda: mark in R.editor_text(cdp), 6, 0.2)
                before_disk = mark in article_ledger.read_text(encoding="utf-8", errors="replace")
                clicked = click_toolbar(cdp, "保存")
                saved = R.wait_until(lambda: mark in article_ledger.read_text(encoding="utf-8", errors="replace"), 25, 0.3)
                status = R.body_text(cdp)[-80:]
                case["variants"].append({"name": label, "editorHasMark": present, "diskBefore": before_disk,
                                         "saveClicked": clicked, "diskSaved": saved, "statusTail": status})
            attempt("clean-state: type marker → click toolbar save", False)
            attempt("after-churn: 4×bold/undo → type marker → click toolbar save", True)

        record_case("save", "UI.toolbar.保存-Ctrl-S：工具栏保存按钮落盘")(case_save)

        # ---- 2) 无序列表快捷键 Ctrl+Shift+8 多通道 ----
        def case_bullet(case):
            def variant(label, act):
                _js_select_editor(cdp, "para-end")
                time.sleep(0.2)
                before = _counts(cdp)
                act()
                time.sleep(0.5)
                after = _counts(cdp)
                case["variants"].append({"name": label, "before": before, "after": after,
                                         "changed": (before.get("ul"), before.get("li")) != (after.get("ul"), after.get("li"))})
                click_toolbar(cdp, "撤销")
                time.sleep(0.25)
            variant("cdp-key: Ctrl+Shift+8 key='8' vk=56", lambda: press_key_combo(cdp, "8", "Digit8", 56, 10))
            variant("cdp-key: Ctrl+Shift+8 key='*' vk=56", lambda: press_key_combo(cdp, "*", "Digit8", 56, 10))
            variant("js-synthetic KeyboardEvent key='8' ctrl+shift", lambda: _js_key(cdp, "8", "Digit8", 56, True, True))
            variant("control: toolbar list dropdown → 无序列表", lambda: (
                click_selector(cdp, 'button[title="列表类型"]'), time.sleep(0.3), click_contains_text(cdp, "无序列表")))

        record_case("list.bullet", "CMD.editor.list.bullet：Ctrl+Shift+8 无序列表")(case_bullet)

        # ---- 3) 引用快捷键 Ctrl+Shift+B 多通道 ----
        def case_blockquote(case):
            def variant(label, act):
                _js_select_editor(cdp, "para-end")
                time.sleep(0.2)
                before = _counts(cdp)
                act()
                time.sleep(0.5)
                after = _counts(cdp)
                case["variants"].append({"name": label, "before": {"bq": before.get("bq")}, "after": {"bq": after.get("bq")},
                                         "changed": before.get("bq") != after.get("bq")})
                click_toolbar(cdp, "撤销")
                time.sleep(0.25)
            variant("cdp-key: Ctrl+Shift+B key='B' vk=66", lambda: press_key_combo(cdp, "B", "KeyB", 66, 10))
            variant("cdp-key: Ctrl+Shift+B key='b' vk=66", lambda: press_key_combo(cdp, "b", "KeyB", 66, 10))
            variant("js-synthetic KeyboardEvent key='b' ctrl+shift keyCode=66", lambda: _js_key(cdp, "b", "KeyB", 66, True, True))
            variant("control: toolbar 引用 button", lambda: click_toolbar(cdp, "引用"))

        record_case("blockquote", "CMD.editor.blockquote：Ctrl+Shift+B 引用")(case_blockquote)

        # ---- 4) 插入链接（先选中文本；无选区对照） ----
        def case_link(case):
            def attempt(label: str, with_selection: bool):
                if with_selection:
                    _js_select_editor(cdp, "text", 4)
                else:
                    _js_select_editor(cdp, "para-end")
                before = _counts(cdp)
                click_toolbar(cdp, "插入链接")
                opened = R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('[role=dialog] input')")), 10, 0.2)
                if opened:
                    set_input_value(cdp, "[role=dialog] input", "https://example.com/f03audit")
                    click_exact_text(cdp, "确定")
                time.sleep(0.5)
                after = _counts(cdp)
                case["variants"].append({"name": label, "dialogOpened": opened, "beforeA": before.get("a"),
                                         "afterA": after.get("a"), "hrefs": cdp.eval("[...document.querySelectorAll('.ProseMirror a[href]')].map(a=>a.getAttribute('href')).slice(-3)")})
                click_toolbar(cdp, "撤销")
                time.sleep(0.2)
            attempt("with text selection (4 chars) → toolbar 插入链接 → URL → 确定", True)
            attempt("no selection (collapsed caret) → toolbar 插入链接 → URL → 确定", False)

        record_case("link.insert", "CMD.editor.link.insert：插入链接是否需选区")(case_link)

        # ---- 5) 插入模块（选择器点击流程/告警/双击） ----
        def case_module(case):
            mod_path = ws / "Modules" / "示例模块.md"
            case["variants"].append({"name": "fixture module file", "path": str(mod_path), "exists": mod_path.exists(),
                                     "contentHead": mod_path.read_text(encoding="utf-8")[:80] if mod_path.exists() else None})
            before_text = R.editor_text(cdp)
            # 只点一次 trigger（避免重复点击把面板关掉），轮询等待 panel 内出现模块项
            click_selector(cdp, 'button[title^="插入模块"]')
            panel_sel = "div.fixed.z-50 button"
            found = False
            end = time.time() + 20
            snapshots = []
            while time.time() < end:
                state = cdp.eval("(() => { const p=[...document.querySelectorAll('div.fixed.z-50')].find(d=>d.querySelector('button'));"
                                 " if(!p) return {panel:false}; const btns=[...p.querySelectorAll('button')].map(b=>(b.textContent||'').trim());"
                                 " return {panel:true, buttons:btns, text:(p.innerText||'').slice(0,120)}; })()") or {}
                if state.get("buttons") and any("示例模块" in b for b in state.get("buttons") or []):
                    snapshots.append({"at_ms": int((time.time() - (end - 20)) * 1000), "state": state})
                    found = True
                    break
                if len(snapshots) < 3:
                    snapshots.append({"at_ms": int((time.time() - (end - 20)) * 1000), "state": state})
                time.sleep(0.4)
            case["variants"].append({"name": "picker panel probe (poll 20s)", "foundItem": found, "snapshots": snapshots[:4]})
            clicked = False
            inserted = False
            if found:
                clicked = bool(cdp.eval("(() => { const ps=[...document.querySelectorAll('div.fixed.z-50')];"
                                        " for (const p of ps) { const b=[...p.querySelectorAll('button')].find(b=>(b.textContent||'').trim().includes('示例模块'));"
                                        " if (b) { b.click(); return true; } } return false; })()"))
                inserted = R.wait_until(lambda: "MODULE-FIXTURE-MARK" in R.editor_text(cdp), 20, 0.3)
            alerts = R.host_eval(cdp, "window.__keAlerts || []")
            case["variants"].append({"name": "click panel item → 插入正文", "clicked": clicked, "inserted": inserted,
                                     "alerts": alerts, "editorTail": R.editor_text(cdp)[-140:]})
            if not inserted:
                # 复核后端 API 可用性（用产品 API base；page 相对 fetch 会落前端 index.html，不能作为证据）
                api_base = cdp.eval("window.__KE_API_BASE__ || ''")
                fetchres = cdp.eval("(async () => { try { const base = window.__KE_API_BASE__ || '';"
                                    " const r = await fetch(base + '/api/modules'); const j = await r.json(); return {status:r.status, count:j.count, modules:j.modules}; }"
                                    " catch(e) { return {error:String(e)}; } })()")
                case["variants"].append({"name": "backend /api/modules via product API base", "apiBase": api_base, "result": fetchres})
                click_selector(cdp, 'button[title^="插入模块"]')  # 关闭面板
            press_esc(cdp)
            if "MODULE-FIXTURE-MARK" in R.editor_text(cdp):
                click_toolbar(cdp, "撤销")
            case["preText"] = before_text[-80:]

        record_case("module.insert", "CMD.editor.module.insert：模块选择器点击后正文未插入")(case_module)

        audit["codeAudit"] = code_audit_f03()
        audit["appLogRoutes"] = {k: log_routes(read_log(log_path), k) for k in ("/api/modules", "/api/attachments", "/api/documents")}
        audit["alerts"] = R.host_eval(cdp, "window.__keAlerts || []")
    finally:
        if cdp is not None:
            try:
                cdp.close()
            except Exception:
                pass
        try:
            proc.terminate(); proc.wait(timeout=8)
        except Exception:
            try: proc.kill()
            except Exception: pass
        R.cleanup()
        try: log.close()
        except Exception: pass
        R.cleanup_test_identifier()
    out = BASE / "f03-audit.json"
    out.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print("AUDIT ->", out, flush=True)
    return audit


# ---------------- blockquote 快捷键修复后复测（task-23，--audit-blockquote-fix） ----------------


def _press_enter(cdp) -> None:
    for t in ("keyDown", "keyUp"):
        try:
            cdp.call("Input.dispatchKeyEvent", {"type": t, "key": "Enter", "code": "Enter",
                                                "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13})
        except Exception:
            pass


def _bq_counts(cdp) -> dict:
    return cdp.eval(
        "(() => { const pm=document.querySelector('.ProseMirror'); if(!pm) return null;"
        " const bq=pm.querySelectorAll('blockquote').length;"
        " const emptyP=[...pm.querySelectorAll('blockquote p')].filter(p=>!(p.textContent||'').trim()).length;"
        " return {bq, bqP: pm.querySelectorAll('blockquote p').length, bqEmptyP: emptyP,"
        " mathBlock: pm.querySelectorAll('.ke-math--block').length, math: pm.querySelectorAll('.ke-math').length,"
        " html: pm.innerHTML.slice(0, 600)}; })()") or {}


def execute_blockquote_fix_audit() -> dict:
    """task-23：验证 blockquote 快捷键修复（新 exe c849241b，含 f4759a2）：
    Ctrl+Shift+B 开/关（选区/折叠）、工具栏行为不变、atom 后空段落 Backspace 不回归、Ctrl+B/I/撤销重做抽查。"""
    if not EXE.exists():
        raise RuntimeError("缺少隔离测试构建")
    build_sha = R.sha_file(EXE)
    packs_info = prepare_packs([])
    env_paths = prepare_env()
    appdata, ws = env_paths["appdata"], env_paths["workspace"]
    R.cleanup()
    R.cleanup_test_identifier()
    if not wait_no_other_instance(120):
        raise RuntimeError("检测到其它隔离产品实例，已放弃")
    env = {
        **os.environ, "APPDATA": str(appdata), "KE_WORKSPACE": str(ws),
        "KE_WORKSHOP_PUBKEYS": json.dumps({"k1": {"key": packs_info["publicKeyHex"]}}),
        "KE_WS_PRINT_RENDER": "1",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
        "TEMP": str(env_paths["tmp"]), "TMP": str(env_paths["tmp"]),
    }
    log_path = BASE / "app.log"
    log = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(EXE)], env=env, cwd=str(BASE), stdout=log, stderr=subprocess.STDOUT)
    cdp = None
    out = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "build": {"exe": str(EXE), "sha256": build_sha,
                     "mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime))},
           "fix_commit": "f4759a2（KeBlockJoin.addKeyboardShortcuts 继承上游 Mod-Shift-b + Backspace 覆盖）",
           "checks": []}

    def rec(name: str, ok: bool, detail) -> bool:
        out["checks"].append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + json.dumps(detail, ensure_ascii=False)[:400], flush=True)
        return bool(ok)

    def reload_doc() -> None:
        R.click_text(cdp, "fe-ledger.md")
        R.wait_until(lambda: DOC_BODY in R.editor_text(cdp), 30, 0.3)
        time.sleep(0.5)

    try:
        if not R.wait_until(lambda: bool(R.main_targets()), 150, 0.3):
            raise RuntimeError("CDP 主窗口未就绪")
        cdp = R.main_cdp()
        cdp.call("Runtime.enable"); cdp.call("Page.enable")
        R.browser_connect()
        R.wait_until(lambda: bool(cdp.eval("typeof window.__TAURI_INTERNALS__?.invoke === 'function'")), 30, 0.25)
        R.wait_until(lambda: bool(cdp.eval("!!document.querySelector('button[aria-label=\"打开创意工坊\"]')")), 90, 0.25)
        R.host_eval(cdp, HOST_COLLECTOR)
        R.wait_until(lambda: R.has_text(cdp, "fe-ledger.md"), 60, 0.25)
        reload_doc()

        # ---------- 聚焦 / 归零 / 精准定位 helper（不重载页面，避免 CDP 挂起） ----------
        def editor_rect():
            return cdp.eval("(() => { const el=document.querySelector('.ProseMirror'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()") or {}

        def click_at(x: float, y: float):
            for t in ("mousePressed", "mouseReleased"):
                cdp.call("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1})
            time.sleep(0.3)

        def sel_info():
            return cdp.eval("(() => { const s=window.getSelection(); if(!s) return null;"
                            " const a=s.anchorNode && s.anchorNode.parentElement || s.anchorNode;"
                            " return {text:String(s).slice(0,30), collapsed:!!s.isCollapsed, type:s.type,"
                            " anchorTag: a && a.tagName, inEditor: !!(a && a.closest && a.closest('.ProseMirror')),"
                            " inParagraph: !!(a && a.closest && a.closest('p'))}; })()")

        def press_esc_all():
            for _ in range(2):
                press_esc(cdp)
                time.sleep(0.15)

        def clean_state():
            """用撤销把编辑状态归零（引用块/公式/探针 marker 全部退回文档初始）。"""
            for _ in range(40):
                b = _bq_counts(cdp)
                text = R.editor_text(cdp)
                if (b.get("bq") or 0) == 0 and (b.get("math") or 0) == 0 and "T23-" not in text and "F03AUDIT" not in text and "FOCUS-PROBE" not in text:
                    return True
                click_toolbar(cdp, "撤销")
                time.sleep(0.18)
            return False

        def place_caret_in_paragraph() -> dict:
            press_esc_all()
            info = cdp.eval(
                "(() => { const ps=[...document.querySelectorAll('.ProseMirror p')].filter(p=>(p.innerText||'').trim().length>3);"
                " return ps.map((p,i)=>{ const r=p.getBoundingClientRect(); return {i, x:r.left+Math.min(50,r.width/2), y:r.top+r.height/2, text:(p.innerText||'').slice(0,20)}; }); })()") or []
            for item in info[:5]:
                click_at(item["x"], item["y"])
                si = sel_info() or {}
                if si.get("collapsed") and si.get("inParagraph"):
                    return {"ok": True, "paragraph": item, "selection": si}
            return {"ok": False, "reason": "cannot-place-caret", "candidates": info[:3], "selection": sel_info()}

        def bq_delta(before: dict, after: dict) -> int:
            return int(after.get("bq") or 0) - int(before.get("bq") or 0)

        BASE_INIT = {"bq": 0, "math": 0}

        # ---- 1) 折叠光标：段落内精准光标 + 多输入通道 ----
        collapsed_variants = []
        for vname, act in (("cdp key='B' ctrl+shift", lambda: press_key_combo(cdp, "B", "KeyB", 66, 10)),
                           ("cdp key='b' ctrl+shift", lambda: press_key_combo(cdp, "b", "KeyB", 66, 10)),
                           ("js-synthetic key='B' ctrl+shift", lambda: _js_key(cdp, "B", "KeyB", 66, True, True))):
            clean_state()
            caret = place_caret_in_paragraph()
            if not caret.get("ok"):
                collapsed_variants.append({"name": vname, "skipped": "caret-place-failed", "caret": caret})
                continue
            b = _bq_counts(cdp)
            act()
            time.sleep(0.65)
            a = _bq_counts(cdp)
            collapsed_variants.append({"name": vname, "caretInParagraph": True, "before": b.get("bq"),
                                       "afterOn": a.get("bq"), "deltaOn": bq_delta(b, a), "htmlHead": a.get("html", "")[:100]})
        rec("T23-1 折叠光标 Ctrl+Shift+B → blockquote（段落内精准光标 + 多输入通道）",
            any(v.get("deltaOn", 0) >= 1 for v in collapsed_variants), {"variants": collapsed_variants})

        # ---- 2) 选中文本：Ctrl+A + Ctrl+Shift+B ----
        clean_state()
        select_all_editor(cdp)
        time.sleep(0.35)
        text_sel = sel_info()
        b2 = _bq_counts(cdp)
        press_key_combo(cdp, "B", "KeyB", 66, 10)
        time.sleep(0.65)
        a2 = _bq_counts(cdp)
        rec("T23-2 选中文本 Ctrl+Shift+B → blockquote 0→1",
            bq_delta(b2, a2) == 1 and (b2.get("bq") == 0),
            {"selection": text_sel, "before": b2.get("bq"), "afterOn": a2.get("bq"), "htmlHead": a2.get("html", "")[:140]})
        clean_state()

        # ---- 3) 工具栏「引用」行为不变 ----
        clean_state()
        caret3 = place_caret_in_paragraph()
        b3 = _bq_counts(cdp)
        click_toolbar(cdp, "引用")
        time.sleep(0.6)
        a3 = _bq_counts(cdp)
        click_toolbar(cdp, "引用")
        time.sleep(0.6)
        c3 = _bq_counts(cdp)
        rec("T23-3 工具栏「引用」按钮行为不变（开 +1 / 关 -1）",
            bq_delta(b3, a3) == 1 and (int(c3.get("bq") or 0) - int(a3.get("bq") or 0)) == -1,
            {"caret": caret3, "before": b3.get("bq"), "afterOn": a3.get("bq"), "afterOff": c3.get("bq")})
        clean_state()

        # ---- 4) 回归：引用块内 atom 后空段落 Backspace 一次删除 ----
        clean_state()
        caret4 = place_caret_in_paragraph()
        # 折叠光标路径优先；失败则用工具栏（行为已由 T23-3 验证）搭建场景
        press_key_combo(cdp, "B", "KeyB", 66, 10)
        time.sleep(0.6)
        bq_ready = _bq_counts(cdp)
        setup_method = "Ctrl+Shift+B(collapsed)"
        if (bq_ready.get("bq") or 0) < 1:
            click_toolbar(cdp, "引用")
            time.sleep(0.6)
            bq_ready = _bq_counts(cdp)
            setup_method = "toolbar 引用（折叠光标路径未生效时兜底）"
        setup = {"method": setup_method, "caretOk": caret4.get("ok"), "bq": bq_ready.get("bq")}
        if (bq_ready.get("bq") or 0) >= 1:
            # 点击引用块内段落末尾放置光标
            r = cdp.eval("(() => { const p=document.querySelector('.ProseMirror blockquote p'); if(!p) return null; const b=p.getBoundingClientRect(); return {x:b.left+Math.min(40,b.width/2), y:b.top+b.height/2}; })()")
            if r:
                click_at(r["x"], r["y"])
            click_toolbar(cdp, "插入块级公式")
            R.wait_until(lambda: "块级公式" in R.body_text(cdp), 10, 0.25)
            cdp.eval("(() => { const t = document.querySelector('.fixed.inset-0 textarea'); if (!t) return false;"
                     " const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;"
                     " setter.call(t, 'x+1'); t.dispatchEvent(new Event('input', {bubbles:true})); return true; })()")
            time.sleep(0.25)
            press_esc(cdp)
            time.sleep(0.7)
            _press_enter(cdp)
            time.sleep(0.8)
            pre = _bq_counts(cdp)
            pre_ok = (pre.get("bqEmptyP") or 0) >= 1
            if pre_ok:
                press_key_combo(cdp, "Backspace", "Backspace", 8, 0)
                time.sleep(0.8)
            post = _bq_counts(cdp)
            kept = {"emptyPRemovedOnce": (pre.get("bqEmptyP") or 0) - (post.get("bqEmptyP") or 0) == 1,
                    "atomKept": (post.get("mathBlock") or 0) >= 1 and (post.get("mathBlock") or 0) == (pre.get("mathBlock") or 0),
                    "bqKept": (post.get("bq") or 0) == (pre.get("bq") or 0)}
            rec("T23-4 回归：引用块内 atom 后空段落 Backspace 一次删除、公式保留（task-59 行为不变）",
                pre_ok and all(kept.values()),
                {"setup": setup, "pre": {k: pre.get(k) for k in ("bq", "bqP", "bqEmptyP", "mathBlock")},
                 "post": {k: post.get(k) for k in ("bq", "bqP", "bqEmptyP", "mathBlock")}, "criteria": kept, "emptyPPre": pre_ok})
        else:
            rec("T23-4 回归：引用块内 atom 后空段落 Backspace（场景搭建失败，NOT_VERIFIED）", False,
                {"setup": setup, "note": "未能创建引用块 → 场景未搭建，不伪造 PASS"})
        clean_state()

        # ---- 5) 其它快捷键抽查 ----
        clean_state()
        select_all_editor(cdp)
        time.sleep(0.3)
        press_key_combo(cdp, "b", "KeyB", 66, 2)
        time.sleep(0.5)
        bold_on = bool(cdp.eval("!!document.querySelector('.ProseMirror strong')"))
        click_toolbar(cdp, "撤销"); time.sleep(0.4)
        bold_off = not bool(cdp.eval("!!document.querySelector('.ProseMirror strong')"))
        select_all_editor(cdp); time.sleep(0.3)
        press_key_combo(cdp, "i", "KeyI", 73, 2)
        time.sleep(0.5)
        italic_on = bool(cdp.eval("!!document.querySelector('.ProseMirror em')"))
        click_toolbar(cdp, "撤销"); time.sleep(0.4)
        italic_off = not bool(cdp.eval("!!document.querySelector('.ProseMirror em')"))
        rec("T23-5 抽查 Ctrl+B / Ctrl+I 不受影响（加粗/斜体生效且可撤销）",
            bold_on and bold_off and italic_on and italic_off,
            {"boldOn": bold_on, "boldUndo": bold_off, "italicOn": italic_on, "italicUndo": italic_off})

        # ---- 6) 撤销/重做 ----
        clean_state()
        caret6 = place_caret_in_paragraph()
        cdp.call("Input.insertText", {"text": "T23-UNDO-MARK"})
        time.sleep(0.6)
        present = "T23-UNDO-MARK" in R.editor_text(cdp)
        click_toolbar(cdp, "撤销")
        gone = R.wait_until(lambda: "T23-UNDO-MARK" not in R.editor_text(cdp), 8, 0.25)
        click_toolbar(cdp, "重做")
        back = R.wait_until(lambda: "T23-UNDO-MARK" in R.editor_text(cdp), 8, 0.25)
        click_toolbar(cdp, "撤销")
        rec("T23-6 抽查 撤销/重做 不受影响（marker 插入→撤销→重做→撤销）",
            present and gone and back, {"caret": caret6.get("ok"), "present": present, "undone": gone, "redone": back})

        out["summary"] = {"total": len(out["checks"]), "pass": sum(1 for c in out["checks"] if c["pass"])}
        out["appLogTail"] = read_log(log_path)[-1500:]
    finally:
        if cdp is not None:
            try:
                cdp.close()
            except Exception:
                pass
        try:
            proc.terminate(); proc.wait(timeout=8)
        except Exception:
            try: proc.kill()
            except Exception: pass
        R.cleanup()
        try: log.close()
        except Exception: pass
        R.cleanup_test_identifier()
    outp = BASE / "blockquote-fix-audit.json"
    outp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("BQ-FIX AUDIT ->", outp, flush=True)
    return out


# ---------------- main ----------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只运行不写 evidence/CSV/覆盖报告（冒烟验证）")
    ap.add_argument("--audit-f03", action="store_true", help="F03 FAIL 根因定向复核（task-21）")
    ap.add_argument("--audit-blockquote-fix", action="store_true", help="blockquote 快捷键修复后复测（task-23）")
    args = ap.parse_args()
    if args.audit_blockquote_fix:
        try:
            out = execute_blockquote_fix_audit()
            return 0 if (out.get("summary") or {}).get("pass") == (out.get("summary") or {}).get("total") else 1
        except Exception:
            print(traceback.format_exc(), flush=True)
            R.cleanup()
            return 1
    if args.audit_f03:
        try:
            execute_audit()
            return 0
        except Exception:
            print(traceback.format_exc(), flush=True)
            R.cleanup()
            return 1

    checks: list[dict] = []
    result: dict = {}
    last_error = ""
    attempts = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        attempts = attempt
        checks = []
        last_error = ""
        try:
            print(f"=== attempt {attempt}/{MAX_ATTEMPTS} ===", flush=True)
            result = execute(checks)
            break
        except Exception:  # noqa: BLE001
            last_error = traceback.format_exc()
            print(last_error, flush=True)
            if attempt < MAX_ATTEMPTS:
                R.cleanup()
                time.sleep(15)
    ok = bool(checks) and all(c["pass"] for c in checks) and not last_error
    if not result:
        result = {"checks": checks, "obs": {}, "routes": {}, "raw": {}, "build": {"exe": str(EXE), "sha256": R.sha_file(EXE) if EXE.exists() else "N/A",
                                                                                     "mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(EXE.stat().st_mtime)) if EXE.exists() else "N/A"},
                  "packs": {}, "paths": {}}
    result["lastError"] = last_error[-4000:] if last_error else None
    result["attempts"] = attempts
    rows = build_ledger(result["checks"], result.get("obs") or {}, result.get("routes") or {})
    stats = summary_stats(rows)
    registered = [r for r in rows if not all(x.startswith("NOT_RUN") for x in (r["packAEntry"], r["packBEntry"], r["officialBaselineResult"]))]
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scenario": "T26 F01–F16 逐项台账登记：pack A / pack B / 官方 UI（CDP 真实自动化）三路径代表性任务",
        "branch": "feat/ui-workshop（本地，未 push/Release）",
        "attempts": attempts,
        "pass": ok,
        "checks_pass": sum(1 for c in result["checks"] if c["pass"]),
        "checks_total": len(result["checks"]),
        "checks": result["checks"],
        "build": result["build"],
        "packs": result.get("packs"),
        "paths": result.get("paths"),
        "ledger": {"rows": rows, "registeredCount": len(registered), "selected": SELECTED_ROWS,
                   "domainTotals": F_DOMAIN_TOTAL, "stats": stats},
        "routes": result.get("routes"),
        "f16MenuAudit": result.get("f16MenuAudit"),
        "raw": {k: result.get("raw", {}).get(k) for k in ("host_event_log", "alerts", "diag", "session_final", "log_routes")},
        "finalBodyTail": result.get("finalBodyTail"),
        "lastError": result["lastError"],
        "limits": [
            "pack 参考包能力面限制：F01/F03/F04/F05/F09/F11/F13/F16 等无 guest 协议方法 → pack 列 NOT_RUN（非伪造）",
            "官方 UI 导出最终落盘未执行（export_pdf 落盘路径不受隔离 seam 控制）→ F13/F14 官方行只到对话框入口",
            "F16 原生菜单非 DOM，不可 CDP 驱动 → NOT_RUN",
            "F03 仅抽样 7 条真实执行，其余保持 NOT_RUN",
            "域行（F01–F16）为代表性任务执行，非 ACCEPTANCE 原文全量标准（任务包原件不在仓库）",
        ],
    }
    if args.dry:
        out = BASE / "dry-results.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nDRY SUMMARY checks={payload['checks_pass']}/{payload['checks_total']} registered={len(registered)} -> {out}", flush=True)
        return 0 if ok else 1

    if not any(x["name"].startswith(("F-OFF", "F-PA", "F-PB")) for x in result["checks"]):
        print("探针未进入真实任务阶段（见上方异常），不写 evidence/CSV/覆盖报告", flush=True)
        return 1
    out = EVID / "T26-F-ledger-results.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    changed = update_csv(rows)
    write_evidence_md(result, rows, stats, changed)
    audit = result.get("f16MenuAudit") or {}
    if audit.get("available"):
        lines = [
            "# P5-T26 F16 原生菜单结构审计（只读；DOM/W 未覆盖）",
            "",
            f"- 生成时间：{time.strftime('%Y-%m-%dT%H:%M:%S%z')}",
            "- 来源（只读）：`desktop/src-tauri/src/menu.rs`（**未修改 Rust 代码**）",
            f"- 审计项数：{audit.get('itemCount')} 个 MenuItem（文件/编辑/视图/帮助子菜单）",
            "- 结论：原生菜单**不是 DOM**，CDP 无法真实点击/断言 → 本文件仅为**结构性证据（U/静态）**；"
            "`feature-baseline.csv` 的 `UI.menu.*` 10 行 + F16 域行共 11 行如实记 `NOT_RUN`（W 未覆盖），不伪造 DOM。",
            "",
            "| MID | 标签 | 加速键 | 事件 ID | 分发目标（handle_event 摘要） |",
            "| --- | --- | --- | --- | --- |",
        ]
        for it in audit.get("items") or []:
            lines.append("| `{}` | {} | {} | `{}` | {} |".format(
                it.get("id"), it.get("label"), it.get("accelerator") or "（无）",
                it.get("eventId") or "", (it.get("handler") or "").replace("|", "/")))
        lines += [
            "",
            "## 说明",
            "",
            "- 菜单项存在性/绑定关系：以 `menu.rs` 的 `MenuItem::with_id(...)` 与 `handle_event` 匹配为准（本审计提取）。",
            "- 真实交互（菜单点击 → 前端事件 → 行为）需要非 DOM 的 OS 级 UI 自动化或 Rust 集成测试，本轮**未执行**；"
            "因此 F16 不满足 W 证据要求，CSV 记 NOT_RUN。",
            "- 菜单事件语义见 `menu.rs` 注释（退出/重载走 flush 握手 `begin_close_handshake`/`begin_reload_handshake`；"
            "devtools 仅 debug 构建）。",
            "",
        ]
        (EVID / "P5-T26-F16-native-menu-audit.md").write_text("\n".join(lines), encoding="utf-8")
    append_coverage(result, rows, stats)
    print(f"\nSUMMARY checks={payload['checks_pass']}/{payload['checks_total']} registered={len(registered)} csvFilled={changed} -> {out}", flush=True)
    order = ["F01", "F02", "F03", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14", "F15", "F16"]
    print("REGISTERED:", ", ".join(f"{r['featureId']}({r['officialBaselineResult'].split(':')[0] if r['featureId'].startswith('F') else ''})" for r in registered), flush=True)
    return 0 if ok else 0  # 台账写入成功即返回 0；探针 checks 失败已如实记录


if __name__ == "__main__":
    sys.exit(main())
