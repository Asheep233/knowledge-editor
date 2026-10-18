# -*- coding: utf-8 -*-
"""T01：从源码生成功能基线矩阵种子（feature-baseline.csv）。

扫描来源：
  1) frontend/src/state/shortcuts.ts —— 快捷键动作目录（稳定 action id）
  2) backend/app/routers/*.py —— API 路由（含前缀、方法、函数、行号）
  3) frontend/src/components/editor/EditorToolbar.tsx —— 工具栏 ToolIcon 入口
  4) frontend/src/components/settings/SettingsPanel.tsx —— 设置分组
  5) desktop/src-tauri/src/menu.rs —— 原生菜单项
  6) ACCEPTANCE.md —— F01–F16 / W01–W09 验收域（人工映射到 host 服务与工坊任务）
列定义见任务包 ACCEPTANCE.md B1：featureId,domain,userTask,officialEntry,sourceEvidence,
fixtureId,expectedOutcome,officialBaselineResult,packAEntry,packBEntry,requiredPlatforms,notes。
当前 officialBaselineResult 一律 NOT_RUN；T01 的完成标准是逐项在真实入口核对后填入结果，
本脚本只负责生成可维护的完整种子，避免手抄遗漏。
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "ui-workshop" / "feature-baseline.csv"
FIXTURE = "docs/ui-workshop/fixtures/basic.md"

COLUMNS = [
    "featureId",
    "domain",
    "userTask",
    "officialEntry",
    "sourceEvidence",
    "fixtureId",
    "expectedOutcome",
    "officialBaselineResult",
    "packAEntry",
    "packBEntry",
    "requiredPlatforms",
    "notes",
]


def rows() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []

    def add(**kw: str) -> None:
        row = {c: "" for c in COLUMNS}
        row.update(kw)
        if not row["officialBaselineResult"]:
            row["officialBaselineResult"] = "NOT_RUN"
        out.append(row)

    # ---------- 1) 快捷键动作 ----------
    sp = (ROOT / "frontend/src/state/shortcuts.ts").read_text(encoding="utf-8")
    sp_lines = sp.splitlines()
    for i, line in enumerate(sp_lines, 1):
        m = re.search(r"\{ id: '([^']+)', label: '([^']+)', group: '(editor|app)'", line)
        if not m:
            continue
        aid, label, group = m.groups()
        domain = "F03" if group == "editor" else "F15"
        add(
            featureId=f"CMD.{aid}",
            domain=domain,
            userTask=f"快捷键动作「{label}」",
            officialEntry="快捷键（自定义绑定）/编辑器动作目录",
            sourceEvidence=f"frontend/src/state/shortcuts.ts:{i}",
            fixtureId=FIXTURE,
            expectedOutcome=f"执行动作「{label}」并在官方 UI 上观察到与基线一致的行为",
            requiredPlatforms="U+B+W" if group == "editor" else "U+W",
        )

    # ---------- 2) 后端 API 路由 ----------
    domain_by_file = {
        "workspace": "F01",
        "documents": "F02",
        "fs": "F02",
        "search": "F10",
        "tags": "F10",
        "attachments": "F09",
        "import_export": "F13",
        "drafts": "F07",
        "history": "F08",
        "trash": "F11",
        "index": "F10",
        "modules": "F06",
        "health": "F01",
    }
    for f in sorted((ROOT / "backend/app/routers").glob("*.py")):
        text = f.read_text(encoding="utf-8")
        m = re.search(r'APIRouter\(prefix="([^"]*)"', text)
        if not m:
            continue
        prefix = m.group(1)
        domain = domain_by_file.get(f.stem, "F01")
        for i, line in enumerate(text.splitlines(), 1):
            r = re.search(r'@router\.(get|post|put|delete|patch)\("([^"]*)"\)', line)
            if not r:
                continue
            method, path = r.groups()
            rel = f.relative_to(ROOT).as_posix()
            add(
                featureId=f"API.{f.stem}.{method}.{path.replace('/', '_') or 'root'}",
                domain=domain,
                userTask=f"API {method.upper()} {prefix}{path}",
                officialEntry=f"来自官方 UI 或内部调用：{method.upper()} {prefix}{path}",
                sourceEvidence=f"{rel}:{i}",
                fixtureId="none",
                expectedOutcome="按当前行为返回；错误路径返回 4xx 而非 5xx",
                requiredPlatforms="A",
            )

    # ---------- 3) 工具栏入口 ----------
    tb = (ROOT / "frontend/src/components/editor/EditorToolbar.tsx").read_text(encoding="utf-8")
    for i, line in enumerate(tb.splitlines(), 1):
        m = re.search(r'<ToolIcon title="([^"]+)"', line)
        if not m:
            continue
        title = m.group(1)
        slug = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", title).strip("-")
        add(
            featureId=f"UI.toolbar.{slug}",
            domain="F03",
            userTask=f"工具栏「{title}」",
            officialEntry=f"编辑器工具栏按钮：{title}",
            sourceEvidence=f"frontend/src/components/editor/EditorToolbar.tsx:{i}",
            fixtureId=FIXTURE,
            expectedOutcome="点击后对选区/光标位置产生与基线一致的效果",
            requiredPlatforms="B+W",
        )

    # ---------- 4) 设置分组 / 外观 ----------
    for g, label in (("general", "常规"), ("appearance", "外观"), ("shortcuts", "快捷键"), ("maintenance", "维护")):
        add(
            featureId=f"UI.settings.{g}",
            domain="F15",
            userTask=f"设置分组「{label}」",
            officialEntry=f"设置面板 → {label}",
            sourceEvidence="frontend/src/components/settings/SettingsPanel.tsx:47",
            fixtureId="none",
            expectedOutcome="设置项可读写、持久化并在重启后恢复；未提交编辑有保护",
            requiredPlatforms="U+B+W",
        )

    # ---------- 5) 原生菜单 ----------
    menu = (ROOT / "desktop/src-tauri/src/menu.rs").read_text(encoding="utf-8")
    for i, line in enumerate(menu.splitlines(), 1):
        m = re.search(r'MenuItem::with_id\([^,]+,\s*(MID_\w+),\s*"([^"]+)"', line)
        if not m:
            continue
        mid, label = m.groups()
        add(
            featureId=f"UI.menu.{mid.lower()}",
            domain="F16",
            userTask=f"原生命令「{label}」",
            officialEntry=f"桌面原生菜单：{label}",
            sourceEvidence=f"desktop/src-tauri/src/menu.rs:{i}",
            fixtureId="none",
            expectedOutcome="菜单事件路由到对应动作并产生与基线一致的副作用（保存/关闭/恢复等）",
            requiredPlatforms="W",
        )

    # ---------- 6) 导出与对话框入口（人工映射，源码位置稳定） ----------
    for fid, task, entry in (
        ("UI.export.ke", "导出 Markdown（KE 格式）", "导出 ▾ → 导出 Markdown（KE 格式）"),
        ("UI.export.plain", "导出普通 Markdown", "导出 ▾ → 导出普通 Markdown (.md)"),
        ("UI.export.zip", "导出文档包 .zip", "导出 ▾ → 导出文档包 (.zip)"),
        ("UI.export.pdf", "导出 PDF（含预览）", "导出 ▾ → 导出 PDF（打印为 PDF）"),
        ("UI.dialog.history", "历史快照面板", "工具栏「历史快照」/原生菜单"),
        ("UI.dialog.uprightd", "微分 d 转正体（另存为）", "工具栏「微分 d 转正体」"),
        ("UI.dialog.math", "公式全屏编辑器", "公式节点进入编辑/工具栏公式菜单"),
        ("UI.dialog.footnote", "脚注输入对话框", "工具栏「插入注释（脚注）」"),
        ("UI.dialog.prompt", "应用内输入/确认弹窗", "PromptDialog（新建/重命名/删除确认）"),
        ("UI.dialog.exportpdf", "导出 PDF 对话框", "导出 PDF 入口"),
    ):
        add(
            featureId=fid,
            domain="F13" if "export" in fid else "F15",
            userTask=task,
            officialEntry=entry,
            sourceEvidence="frontend/src/components/layout/EditorArea.tsx / components/editor/*Dialog.tsx",
            fixtureId=FIXTURE,
            expectedOutcome="入口可用；副作用与基线一致；失败有可解释提示",
            requiredPlatforms="B+W",
        )

    # ---------- 7) 验收域（ACCEPTANCE.md F/W） ----------
    domains = [
        ("F01", "工作区创建/打开/最近/关闭、文档标签与导航", "U+A+B+W"),
        ("F02", "文档和目录新建/改名/移动/删除/元数据", "U+A+B+W"),
        ("F03", "全部文本格式、列表、链接、任务、撤销/重做、大纲定位", "U+B+W"),
        ("F04", "行内/块公式、MathLive 输入、公式转换、长公式", "U+B+W"),
        ("F05", "表格全部深层操作", "U+B+W"),
        ("F06", "KE 模块、信息块、脚注、视频、特殊节点与未知标记", "U+A+B+W"),
        ("F07", "手动/自动保存、恢复登记、持续输入恢复", "U+A+B+W"),
        ("F08", "草稿/历史恢复、外部修改、重载", "U+A+B+W"),
        ("F09", "附件选择/拖放/粘贴上传、引用、孤儿管理", "U+A+B+W"),
        ("F10", "搜索、高亮、tags、索引重建", "U+A+B+W"),
        ("F11", "回收站恢复/永久删除", "U+A+B+W"),
        ("F12", "源码模式、原字符串、frontmatter、BOM/CRLF、HTML", "U+A+B+W"),
        ("F13", "KE/普通 Markdown/ZIP 导入导出、附件映射", "U+A+B+W"),
        ("F14", "PDF 预览及真实导出", "U+B+W"),
        ("F15", "设置、主题、补全、快捷键、维护功能", "U+B+W"),
        ("F16", "桌面菜单、关闭/重载、单实例等桌面行为", "W+I"),
        ("W01", "包导入、详情、预览、应用、取消、回滚、删除", "U+A+W+I"),
        ("W02", "UI 激活与表单交接", "U+B+W"),
        ("W03", "包与私有状态回滚", "U+A+W+I"),
        ("W04", "SDK 外部独立开发", "U+B+W"),
        ("W05", "协议快照、订阅、命令结果", "U+A+B+W"),
        ("W06", "执行与网络边界", "U+B+W"),
        ("W07", "原生故障恢复", "W+I"),
        ("W08", "覆盖升级与兼容", "U+A+W+I"),
        ("W09", "性能与资源", "U+B+W"),
    ]
    for fid, task, platforms in domains:
        add(
            featureId=fid,
            domain=fid if fid.startswith("F") else "P3/P4",
            userTask=task,
            officialEntry="（验收域：由 T01 逐项映射到真实入口与 fixtures）",
            sourceEvidence="ACCEPTANCE.md §C",
            fixtureId=FIXTURE if fid.startswith("F") else "none",
            expectedOutcome="按 ACCEPTANCE.md 对应行的可执行通过标准执行",
            requiredPlatforms=platforms,
            notes="验收域行；子项在后续任务/Host 面板映射时展开",
        )

    return out


def main() -> None:
    rs = rows()
    # 去重（同 featureId 保留首条）
    seen: set[str] = set()
    uniq: list[dict[str, str]] = []
    for r in rs:
        if r["featureId"] in seen:
            continue
        seen.add(r["featureId"])
        uniq.append(r)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(uniq)
    by_domain: dict[str, int] = {}
    for r in uniq:
        by_domain[r["domain"]] = by_domain.get(r["domain"], 0) + 1
    print(f"feature-baseline.csv: {len(uniq)} rows -> {OUT}")
    print("rows by domain:", dict(sorted(by_domain.items())))


if __name__ == "__main__":
    main()
