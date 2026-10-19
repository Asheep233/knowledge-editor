# P5-T26 pack B 受控编辑器命令桥 W 验证（task-26）

- 生成时间：2026-10-19T17:57:43+0800
- 测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256=`89a4165aeb947c1d3c1b87653b68e9d25a1b1595e3901863f7bc8b2a1346209a`，mtime=`2026-10-19T17:52:40`）
- 探针：`docs/ui-workshop/tools/run_t26_pack_editor_cmd_probe.py`（隔离产品 + CDP；guest OOPIF 真实 DOM 点击 → 主窗口 `.ProseMirror` DOM 断言；仅 trusted + `editor.commands.readonly` 才可用）。

## 结果：22/22 PASS
- 链路：build/sign（W-T26-1）→ install/verify（W-T26-3）→ trusted（W-T26-4）→ guest 会话 active（W-T26-5） → 握手 acceptedFeatures 含 `editor.commands.readonly` + 11 条命令可见（W-T26-6）→ 命令 DOM 断言（W-T26-7..16） → 负向（W-T26-17）→ schema 缺口（W-T26-18）→ 会话仍 active（W-T26-19）。

## 正向：guest 按钮 → 命令 → 主窗口 DOM

| featureId | 命令 | guest 操作 | 主窗口 DOM 断言 | 结果 | W check |
| --- | --- | --- | --- | --- | --- |
| `CMD.editor.bold` | `editor.bold` | guest DOM 点「加粗」 | strong 0→4 | PASS | W-T26-7 |
| `CMD.editor.italic` | `editor.italic` | guest DOM 点「斜体」 | em 0→4 | PASS | W-T26-8 |
| `CMD.editor.underline` | `editor.underline` | guest DOM 点「下划线」 | u 0→4 | PASS | W-T26-9 |
| `CMD.editor.strike` | `editor.strike` | guest DOM 点「删除线」 | s 0→4 | PASS | W-T26-10 |
| `CMD.editor.code.inline` | `editor.code` | guest DOM 点「行内代码」 | code 0→4 | PASS | W-T26-11 |
| `CMD.editor.heading.1` | `editor.heading1` | guest DOM 点「标题1」 | h1 1→4 | PASS | W-T26-12 |
| `CMD.editor.heading.2` | `editor.heading2` | guest DOM 点「标题2」 | h2 0→4 | PASS | W-T26-13 |
| `CMD.editor.heading.3` | `editor.heading3` | guest DOM 点「标题3」 | h3 0→4 | PASS | W-T26-14 |
| `CMD.editor.blockquote` | `editor.blockquote` | guest DOM 点「引用」 | blockquote 0→1 | PASS | W-T26-15 |
| `CMD.editor.undo` | `editor.undo` | guest DOM 点「撤销」 | strong>0→0 | PASS | W-T26-16 |
| `CMD.editor.redo` | `editor.redo` | guest DOM 点「重做」 | strong 0→>0 | PASS | W-T26-16 |

## 负向（不假成功）

| 负向用例 | 请求命令 | 结果 | 宿主错误码 |
| --- | --- | --- | --- |
| 大写命令名 | `editor.Bold` | 拒绝（未假成功） | `E_FORBIDDEN: 命令未在 manifest 声明: editor.Bold` |
| 未知命令 | `editor.explode` | 拒绝（未假成功） | `E_FORBIDDEN: 命令未在 manifest 声明: editor.explode` |
| camelCase 白名单但 manifest 无法声明 | `editor.bulletList` | 拒绝（未假成功） | `E_FORBIDDEN: 命令未在 manifest 声明: editor.bulletList` |

- 说明：broker 的 `declaredCommands` 前置（manifest 声明）先于后端白名单/大写校验生效，故大写名/未知名在  pack 路径上统一返回 `E_FORBIDDEN: 命令未在 manifest 声明`（如实记录；未伪造成 E_COMMAND_NOT_ALLOWED）。

## 已知 schema 缺口（如实记录，不伪造）

- 白名单 `bulletList` / `orderedList` / `codeBlock` 为 camelCase，而 packs `manifest.commands[].name` 校验 仅允许 `^[a-z][a-z0-9.-]{1,80}$` → **无法声明**，guest 调用被 `E_FORBIDDEN` 拒绝（W-T26-18）。属产品 schema 与白名单命名不一致的缺口，需产品决策；pack B 不绕过，相关 F03 行保持 NOT_RUN。

## 证据 JSON

- `docs/ui-workshop/evidence/T26-pack-editor-cmd-results.json`（完整 checks/manifest/negatives）。

---

## v8 增量：kebab 三命令（task-28，2026-10-19）

- 测试构建：`ad1ffa18a12aaa2b169c0fe386a8dae7b9e9ea0468702a4cb229df3fac144d70`（sha256=`ad1ffa18a12aaa2b169c0fe386a8dae7b9e9ea0468702a4cb229df3fac144d70`，mtime=`2026-10-19T18:10:34`，含 8a57a3f kebab 映射）。
- pack B：manifest 新增 3 条 kebab 命令 `editor.bullet-list` / `editor.ordered-list` / `editor.code-block`（共 14 条 editor.* 协议名），UI 增加 3 按钮；签名包已重建。
- W 复测：**26/26 PASS**（含原 11 单命令回归与 2 条既有负向/会话检查）。

### kebab 三命令 → 主窗口 DOM

| featureId | 命令（kebab） | guest 操作 | 主窗口 DOM 断言 | 结果 | W check |
| --- | --- | --- | --- | --- | --- |
| `CMD.editor.list.bullet` | `editor.bullet-list` | guest DOM 点「无序列表」 | ul 0→1 + 撤销还原 | PASS | W-T26-20 |
| `CMD.editor.list.ordered` | `editor.ordered-list` | guest DOM 点「有序列表」 | ol 0→1 + 撤销还原 | PASS | W-T26-21 |
| `CMD.editor.codeBlock` | `editor.code-block` | guest DOM 点「代码块」 | pre 0→4 + 撤销还原 | PASS | W-T26-22 |

### 结果回显（契约形状）

- guest 收到：`{"name": "editor.bullet-list", "ok": true, "value": {"ok": true, "value": {"name": "editor.bullet-list", "executed": true}}}`

### legacy camelCase（schema 限制，非缺陷）

- `editor.bulletList` / `editor.orderedList` / `editor.codeBlock` 仅宿主后端 legacy 兼容直调；manifest 命令名 schema（`^[a-z][a-z0-9.-]{1,80}$`）不允许大写 → 无法声明；guest 直接请求被 broker `declaredCommands` 前置拒绝（`E_FORBIDDEN`，W-T26-18 验证）。

---

## v9 增量：4 条可无头产品动作（task-30，2026-10-19）

- 测试构建：`e5a0891de9b18b5f1996470aee13927e14ffd3898244de8e37c3db26fd9223ce`（sha256=`e5a0891de9b18b5f1996470aee13927e14ffd3898244de8e37c3db26fd9223ce`，mtime=`2026-10-19T18:37:46`；含 38748a2 动作桥扩展，协议名共 18 条 = 14 切换 + 4 动作）。
- pack B：manifest 追加 4 条 `editor.table.insert` / `editor.footnote.insert` / `editor.note.insert` / `doc.save`；UI 追加 4 按钮；签名包重建。
- W 复测：**30/30 PASS**（原 26 项回归 + 4 动作新增）。

### 动作 → 主窗口 DOM / 磁盘断言

| 动作（协议名） | guest 操作 | 主窗口断言 | 撤销 | W check |
| --- | --- | --- | --- | --- |
| `editor.table.insert` | 点「插入表格 3×3」 | `table` DOM：rows=3、表头 th=3、cols=3 | PASS | W-T26-24 |
| `editor.footnote.insert` | 点「插入脚注」 | `ke-footnote-ref` 0→1、`sup` 0→1（脚注节点真实插入） | PASS | W-T26-25 |
| `editor.note.insert` | 点「插入信息块」 | `[data-ke-note]` 0→1（含 data-id/title/color） | PASS | W-T26-26 |
| `doc.save` | 点「保存文档」 | **真实落盘**：编辑 marker 后磁盘内容出现 marker（保存前无）、mtime 变化 1792406353.5096283→1792406367.172301 | 不适用（保存动作） | W-T26-27 |

### doc.save 真实落盘证据（不只查返回值）

- 编辑 marker `T30-DOC-SAVE-MARK` → 编辑器内存在；点击前磁盘**无**该 marker；guest 点击「保存文档」后磁盘出现该 marker；
- `mtime`：`1792406353.5096283` → `1792406367.172301`（变化）；返回值回显 `{"name":"doc.save","ok":true,"value":{"ok":true,"value":{"name":"doc.save","executed":true}},"at":1792406367130}`；
- 结论：`doc.save` 触发产品真实保存链（与工具栏保存/Ctrl+S 同一 `saveNow`），非假成功。

### 负向（含不接的对话框类动作）

- 未声明/大写/未知命令、以及 **不接的对话框类动作**（`editor.link.insert`/`image.insert`/`math.block`/`module.insert`）全部被宿主拒绝（`E_FORBIDDEN`），主窗口 DOM 不变（W-T26-17，共 7 个负向用例）。

---

## v10 增量：pack A 接入编辑命令桥（task-31，2026-10-19）

- 测试构建：`e5a0891de9b18b5f1996470aee13927e14ffd3898244de8e37c3db26fd9223ce`（sha256=`e5a0891de9b18b5f1996470aee13927e14ffd3898244de8e37c3db26fd9223ce`，mtime=`2026-10-19T18:37:46`；无需重建，已含 18 条协议名）。
- pack A：manifest 声明 **18 条协议名**（14 切换 + 4 动作）+ capabilities 增 `editor.commands.readonly`；UI 新增「编辑器命令」18 按钮；保留原读/打印/事件；签名包已重建。
- 产品 W（`--pack a`）：**30/30 PASS**。

### 关键断言（guest 真实 DOM 点击 → command.invoke → 主窗口 DOM）

| 协议名 | 主窗口 `.ProseMirror` DOM | 撤销还原 | W check |
| --- | --- | --- | --- |
| `editor.bold` | strong 0→4 | PASS | W-T31-7 |
| `editor.italic` | em 0→4 | PASS | W-T31-8 |
| `editor.heading1` | h1 1→4 | PASS | W-T31-12 |
| `editor.bullet-list` | ul 0→1 | PASS | W-T31-20 |
| `editor.table.insert` | table rows=3 / th=3 / cols=3 | PASS | W-T31-24 |
| `editor.footnote.insert` | ke-footnote-ref→1、sup→1 | PASS | W-T31-25 |
| `editor.note.insert` | [data-ke-note] 0→1 | PASS | W-T31-26 |
| 撤销/重做（W-T31-16） | strong 往返：undone=True / redone=True | — | W-T31-16 |

### doc.save 真实落盘（不只查返回值）

- 编辑 marker 后 guest 点击「保存文档」→ 磁盘出现 marker、mtime 变化；saveEcho=`{"name":"doc.save","ok":true,"value":{"ok":true,"value":{"name":"doc.save","executed":true}},"at":1792406997646}`（W-T31-27）。

### 负向（含未接的对话框类动作）

- 未声明/大写/未知 + `editor.link.insert`/`image.insert`/`math.block`/`module.insert` 全部 `E_FORBIDDEN`，主窗口 DOM 不变（W-T31-17，共 7 用例）。
