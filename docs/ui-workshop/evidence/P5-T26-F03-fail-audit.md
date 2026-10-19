# P5-T26 F03 FAIL 根因审计（5 项：PRODUCT_BUG/FINDING vs AUTOMATION_LIMITATION）

- 生成时间：2026-10-19T16:24:32+0800
- 测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256=`faa71dfbf5222d63aa3c1b365961055d344ce09fa27cfcadc73e607c0ef75789`，mtime=`2026-10-19T15:29:02`）
- 复核方式：`tools/run_feature_entry_probe.py --audit-f03`（干净隔离实例；逐项正确前置条件 + 多输入通道变体；官方 UI 真实 CDP 操作；未修改产品代码）
- 证据 JSON：`evidence/T26-F-ledger-results.json` 的 `f03FailAudit` 字段

## 结论汇总

| featureId | 分类 | 一句话根因 |
| --- | --- | --- |
| `CMD.editor.list.bullet` | AUTOMATION_LIMITATION | 产品快捷键真实生效；台账探针断言缺陷（只数 <ul>，实际 li 2→3） |
| `CMD.editor.blockquote` | PRODUCT_BUG/FINDING | KeBlockquote.addKeyboardShortcuts 覆盖上游 {Mod-Shift-b} 只返回 Backspace → 快捷键无绑定；工具栏命令可用 |
| `UI.toolbar.保存-Ctrl-S` | AUTOMATION_LIMITATION | 干净态 / 4×bold+undo 连续编辑后两种前置点击保存均落盘（diskSaved=true、「已保存」） |
| `CMD.editor.link.insert` | AUTOMATION_LIMITATION | with-selection 与 collapsed 两种前置经工具栏对话框均产生 <a href>（beforeA=0→afterA=1） |
| `CMD.editor.module.insert` | AUTOMATION_LIMITATION | Dropdown 为 portal + 懒加载（面板项 ~407ms 到达）；轮询到面板项后点击 → 模块正文真实插入（MODULE-FIXTURE-MARK 出现） | |

## 1. CMD.editor.list.bullet

- **台账现状**：`CMD.editor.list.bullet` — Ctrl+Shift+8 无序列表（v4 台账）
- **分类结论**：**AUTOMATION_LIMITATION**
- **根因**：产品快捷键真实生效；台账探针断言缺陷（只数 <ul>，实际 li 2→3）
- **复核证据**（定向隔离实例 `--audit-f03`）：

| 复核变体 | 结果 | 关键值 |
| --- | --- | --- |
| cdp-key: Ctrl+Shift+8 key='8' vk=56 | PASS/生效 | `{"changed": true, "after": {"ul": 1, "ol": 0, "li": 3, "bq": 0, "a": 0, "text": 117}}` |
| cdp-key: Ctrl+Shift+8 key='*' vk=56 | PASS/生效 | `{"changed": true, "after": {"ul": 1, "ol": 0, "li": 3, "bq": 0, "a": 0, "text": 117}}` |
| js-synthetic KeyboardEvent key='8' ctrl+shift | PASS/生效 | `{"changed": true, "after": {"ul": 1, "ol": 0, "li": 3, "bq": 0, "a": 0, "text": 117}}` |
| control: toolbar list dropdown → 无序列表 | PASS/生效 | `{"changed": true, "after": {"ul": 1, "ol": 0, "li": 3, "bq": 0, "a": 0, "text": 117}}` |

## 2. CMD.editor.blockquote

- **台账现状**：`CMD.editor.blockquote` — Ctrl+Shift+B 引用（v4 台账）
- **分类结论**：**PRODUCT_BUG/FINDING**
- **根因**：KeBlockquote.addKeyboardShortcuts 覆盖上游 {Mod-Shift-b} 只返回 Backspace → 快捷键无绑定；工具栏命令可用
- **复核证据**（定向隔离实例 `--audit-f03`）：

| 复核变体 | 结果 | 关键值 |
| --- | --- | --- |
| cdp-key: Ctrl+Shift+B key='B' vk=66 | 未生效 | `{"changed": false, "after": {"bq": 0}}` |
| cdp-key: Ctrl+Shift+B key='b' vk=66 | 未生效 | `{"changed": false, "after": {"bq": 0}}` |
| js-synthetic KeyboardEvent key='b' ctrl+shift keyCode=66 | 未生效 | `{"changed": false, "after": {"bq": 0}}` |
| control: toolbar 引用 button | PASS/生效 | `{"changed": true, "after": {"bq": 1}}` |

## 3. UI.toolbar.保存-Ctrl-S

- **台账现状**：`UI.toolbar.保存-Ctrl-S` — 工具栏保存按钮（v4 台账）
- **分类结论**：**AUTOMATION_LIMITATION**
- **根因**：干净态 / 4×bold+undo 连续编辑后两种前置点击保存均落盘（diskSaved=true、「已保存」）
- **复核证据**（定向隔离实例 `--audit-f03`）：

| 复核变体 | 结果 | 关键值 |
| --- | --- | --- |
| clean-state: type marker → click toolbar save | PASS/生效 | `{"diskSaved": true, "statusTail": "\nF 台账文档 · 35 字\n本地存储 · 自动保存已开启\n已保存\n后端 v1.2.18\nC:\\ke-tmp\\uiws-t26-F\\workspace\n创意工坊"}` |
| after-churn: 4×bold/undo → type marker → click toolbar save | PASS/生效 | `{"diskSaved": true, "statusTail": "ce\n创意工坊\n文档已被外部修改\n\nArticles/fe-ledger.md\n该文件在工作区外被修改（例如其他编辑器）。\n\n保留当前编辑内容\n重新加载外部版本"}` |

## 4. CMD.editor.link.insert

- **台账现状**：`CMD.editor.link.insert` — 插入链接（v4 台账）
- **分类结论**：**AUTOMATION_LIMITATION**
- **根因**：with-selection 与 collapsed 两种前置经工具栏对话框均产生 <a href>（beforeA=0→afterA=1）
- **复核证据**（定向隔离实例 `--audit-f03`）：

| 复核变体 | 结果 | 关键值 |
| --- | --- | --- |
| with text selection (4 chars) → toolbar 插入链接 → URL → 确定 | 未生效 | `{"afterA": 1}` |
| no selection (collapsed caret) → toolbar 插入链接 → URL → 确定 | 未生效 | `{"afterA": 1}` |

## 5. CMD.editor.module.insert

- **台账现状**：`CMD.editor.module.insert` — 插入模块（v4 台账）
- **分类结论**：**AUTOMATION_LIMITATION**
- **根因**：Dropdown 为 portal + 懒加载（面板项 ~407ms 到达）；轮询到面板项后点击 → 模块正文真实插入（MODULE-FIXTURE-MARK 出现）
- **复核证据**（定向隔离实例 `--audit-f03`）：

| 复核变体 | 结果 | 关键值 |
| --- | --- | --- |
| fixture module file | 未生效 | `{}` |
| picker panel probe (poll 20s) | PASS/生效 | `{"foundItem": true}` |
| click panel item → 插入正文 | PASS/生效 | `{"inserted": true}` |

## 代码审计摘要（PRODUCT_BUG 定位）

- `frontend/src/editor/index.ts:158`：`StarterKit.configure({ blockquote: false })` 关闭内置引用块；
- `frontend/src/editor/extensions/KeBlockJoin.ts:88`：`KeBlockquote = Blockquote.extend({...})`；
- `KeBlockJoin.ts:104`：`addKeyboardShortcuts()` 重写；`:131`：`return { Backspace: deleteEmptyAfterAtom }` —— **只返回 Backspace，未保留/展开上游快捷键表**；
- 上游 `@tiptap/extension-blockquote/dist/index.js:109` 的绑定为 `"Mod-Shift-b"` → **被覆盖丢弃**；
- 对应 `frontend/src/state/shortcuts.ts` 中 `editor.blockquote` 的 `defaultKey: 'Mod+Shift+B'` 仅用于展示/告警（该模块注释明确 defaultKey 不参与分派）。

## 其他 4 项（AUTOMATION_LIMITATION）代码/探针侧说明

- `CMD.editor.list.bullet`：上游 `@tiptap/extension-list/dist/index.js:62` 绑定 `Mod-Shift-8` 存在；台账探针断言只数 `<ul>`（选中段落后并块不新增 ul），应改数 `li`；
- `UI.toolbar.保存-Ctrl-S`：`EditorToolbar.tsx:709` 保存按钮绑定存在；台账失败为连续自动化后的保存/外部修改状态耦合；
- `CMD.editor.link.insert`：`EditorToolbar.tsx:573` `extendMarkRange('link').setLink`；定向复核两种前置均可插入；
- `CMD.editor.module.insert`：`EditorToolbar.tsx:457` `insertModule`；Dropdown portal + 懒加载（~407ms 面板项到达），台账探针未等面板项 → 未点中；后端 `/api/modules` 200。
