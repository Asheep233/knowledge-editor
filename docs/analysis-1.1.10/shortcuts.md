# v1.1.10 优化项①：自定义快捷键 — 可行性分析

- 任务：**task-25**（只读分析，不改任何源码/配置）
- 分析者：dev-attach-ui ｜ 日期：2026-09-15 ｜ 基线：v1.1.9（前端 38 files / 547 tests 全绿）
- 结论口径：**事实与文件行号均为本次实测**；凡任务描述与实测不符处，一律以实测为准并显式标注（见 §8）。

---

## 0. 结论先行

**可做，且不需要 Rust 侧功能改动**（只需为设置字段做「三处同步」）。推荐 **B 档：设置可配置 + 前端统一 keydown 分发器**；编辑器内动作由 EditorArea 的注册表直接调用 Tiptap 命令；仅当需要「抢占 ProseMirror 内置键位」时才叠加 C 档的 keymap 插件（增量小、可后置）。

本分析最要紧的三条约束：

1. **原生菜单已经有加速键**（Ctrl+N / Ctrl+O / Ctrl+, / Ctrl+Q / Ctrl+R，debug 下还有 F12，编辑菜单的撤销/剪切/复制/粘贴/全选由平台预定义项提供）——任务描述里「grep `accelerator` 无命中」是**误判**：Tauri v2 把加速键作为 `MenuItem::with_id` 的**第 5 个位置参数**，而不是命名参数。机制上（未实测）这些加速键在 WebView2 之前被窗口消息循环处理，**JS 很可能拦不住**，因此必须当作「保留键」处理。
2. **Ctrl+N 已经双重绑定**：原生菜单「新建文档」（`desktop/src-tauri/src/menu.rs:40`）与编辑器「插入行内公式」（`frontend/src/editor/index.ts:67-104`）。这是既有冲突，做自定义快捷键前必须先裁决归属。
3. **设置字段是三处同步 + Rust 深合并**：`Record<action,string>` 这类映射字段**可行**，但「删除某个绑定」必须用显式墓碑（沿用 `accentColor` 的「空串 = 清除」先例），否则 Rust `merge_value` 的深合并会把删掉的键合并回来（§1.3）。

估时：B 档 **2.5–4 人日**（含测试与独立验证）；A 档 0.5–1 人日；C 档在 B 之上 +1–1.5 人日；Tauri 全局快捷键档**不建议**本期做（§2 D）。

红线：**不触碰** ke-* 文件格式、B 层产品标识、发布流程、后端与 `editor/**` 源码（§7）。

---

## 1. 事实基线（实测）

### 1.1 可绑定动作清单

「需桥接」一列：`直接` = 组件内已有可调用的闭包；`事件` = 需要新增事件/注册表把动作从别的组件引出来；`新功能` = 该动作当前不存在，需要先定义行为。

#### A 组：编辑器格式/插入（`frontend/src/components/editor/EditorToolbar.tsx`，editor 来自 `useCurrentEditor()`，见 `:308-316`）

| 动作 ID（草案） | 现有入口（行号） | 调用方式 | 需桥接 |
|---|---|---|---|
| `editor.heading.paragraph` / `editor.heading.1` … `editor.heading.6` | 样式/标题 ▾ `:446-466` | `applyHeading(lvl)` → `editor.chain().focus().setParagraph()/toggleHeading({level:lvl})` | 直接 |
| `editor.bold` | 加粗 `:469` | `editor.chain().focus().toggleBold().run()` | 直接 |
| `editor.italic` | 斜体 `:472` | `toggleItalic()` | 直接 |
| `editor.underline` | 下划线 `:475` | `toggleUnderline()` | 直接 |
| `editor.strike` | 删除线 `:478` | `toggleStrike()` | 直接 |
| `editor.list.bullet` / `editor.list.ordered` / `editor.list.none` | 列表类型 ▾ `:491-505` | `applyList('bullet'\|'ordered'\|'none')` | 直接 |
| `editor.list.ordered.toggle` | 有序列表 `:507` | `toggleOrderedList()`（与上表 `list.ordered` 语义重叠，建议合成一个动作） | 直接 |
| `editor.blockquote` | 引用 `:510` | `toggleBlockquote()` | 直接 |
| `editor.code.inline` | 行内代码 `:513` | `toggleCode()` | 直接 |
| `editor.link.insert` | 插入链接 `:516-527` | `askPrompt('链接地址：')` → `extendMarkRange('link').setLink({href})` / 空串 `unsetLink()` | 直接（但会弹输入框，键位只能「打开入口」） |
| `editor.image.insert` | 插入图片 `:528-530` | `fileRef.current?.click()` 打开文件选择 | 直接（同上） |
| `editor.math.inline` | 插入公式 `:531-546` | `newId()` + `insertContent({type:'math'})` + `openMathEditorById()` | 直接 |
| `editor.math.block` | 插入块级公式 `:547-570` | 同上，`type:'mathBlock'` | 直接 |
| `editor.module.insert` | 模块 ▾ `:578-603` | `toggleModulePicker()` 懒加载模块列表后插入 | 直接（键位只能打开选择器） |
| `editor.codeBlock` | 代码块 `:606` | `toggleCodeBlock()` | 直接 |
| `editor.footnote.insert` | 注释（脚注）`:609-611` | `setFootnoteOpen(true)`（对话框） | 直接（键位只能打开对话框） |
| `editor.note.insert` | 信息块 `:612-614` | `editor.chain().focus().insertNote('', 'blue').run()` | 直接 |
| `editor.table.insert` | 表格… `:615-617` | `setTableOpen(true)`（1–8 × 1–8 尺寸选择器） | 直接 |
| `editor.undo` / `editor.redo` | 撤销 `:621` / 重做 `:624` | `editor.chain().focus().undo()/redo().run()` | 直接 |

#### B 组：文档 / 应用级

| 动作 ID（草案） | 现有入口（行号） | 调用方式 | 需桥接 |
|---|---|---|---|
| `doc.save` | 工具栏保存按钮 `EditorToolbar.tsx:631`；快捷键 Ctrl+S `EditorArea.tsx:470-479` | `saveNow()` → `enqueueSave(doc.id, buildSaveFn(doc.id), 0)`（`EditorArea.tsx:461-467`） | 事件（EditorArea 内） |
| `doc.history.open` | 历史快照 `EditorToolbar.tsx:639`；`ke:open-history` 事件链 | App `App.tsx:777` 派发 CustomEvent → `EditorArea.tsx:525-538` 监听 | 已有事件范式 |
| `doc.attachment.open` | 附件图标 `EditorToolbar.tsx:643-647` | ⚠️ **未接线**：唯一调用点 `EditorArea.tsx:689-694` 没有传 `onOpenAttachments` → 该按钮当前**不渲染** | 死 UI（见 §8.4） |
| `doc.new` | 原生菜单 `menu.rs:40`（Ctrl+N）→ `ke-menu:new-document` | App `App.tsx:653` → `handleNewArticle()`（`App.tsx:485-505`） | 已有事件 |
| `app.workspace.open` | 原生菜单 `menu.rs:41`（Ctrl+O）→ `ke-menu:open-workspace` | App `App.tsx:654` → `handleOpenWorkspaceMenu()`（`:430`） | 已有事件 |
| `app.workspace.new` / `app.workspace.close` | 菜单（无加速键）→ `ke-menu:new-workspace` / `ke-menu:close-workspace` | App `App.tsx:655-656` → `handleCreateWorkspaceMenu()` / `handleCloseWorkspace()` | 已有事件 |
| `app.recent.refresh` | 菜单「最近工作区…」→ `ke-menu:refresh-recent` | App `App.tsx:667` | 已有事件 |
| `app.recovery.check` | 菜单「恢复检查…」→ `ke-menu:recovery-check` | App `App.tsx:657` → `runRecoveryCheck()`（`:577`） | 已有事件 |
| `app.settings.open` | 原生菜单 `menu.rs:49`（Ctrl+,）→ `ke-menu:settings` | App `App.tsx:658` → `setSettingsOpen(true)`（state 在 `:88`） | 已有事件 |
| `app.search.focus` | 左栏搜索框；快捷键 Ctrl+K `LeftSidebar.tsx:174-183` | `searchRef.current?.focus()`（ref 在 `:171`，DOM 在 `:615`） | 事件（ref 封在 LeftSidebar 内） |
| `app.right.toggle` | 右栏展开按钮 `App.tsx:782-791`；收起按钮 `RightPanel` 内 | `toggleRight(v)`（`App.tsx:363-367`，持久化 `ke.rightOpen`） | 事件（App state） |
| `app.left.toggle` | 无（左栏不可折叠） | — | 新功能（若要做） |
| `doc.next` / `doc.prev` | **不存在** | 需先定义「切换文档」的顺序来源（左栏树展开顺序 / 最近文档列表 / 打开历史）；现有唯一入口是点击左栏触发的 `App.tsx:271 openArticle` | **新功能 + 新桥接** |
| `view.lightbox.close` | Escape `ImageLightbox.tsx:19-24` | `onClose()` | 直接（局部） |
| `view.reload` / `view.devtools` | 原生菜单 `menu.rs:76`/`:87`（重载）、`:78`（F12，debug） | Rust 直接 `window.reload()` / `open_devtools()` | 不建议纳入 |

### 1.2 现有按键处理的分层

#### 1.2.1 Tiptap / ProseMirror 层

| 位置 | 绑定 | 摘录 |
|---|---|---|
| `frontend/src/editor/index.ts:67-104`（`MathShortcuts` 扩展，注释 `:67-68`、声明 `:69`、`addKeyboardShortcuts()` `:71`） | `Mod-n` = 插入行内公式；`Mod-m` = 插入块级公式 | 注释：*「Ctrl/⌘+N = 插入行内公式；Ctrl/⌘+M = 插入公式块。在编辑器层注册（任意焦点态可用）；与浏览器默认（新窗口/静音）不冲突的桌面场景优先。」* |
| `frontend/src/editor/extensions/ListExtension.ts:42-44` | `Enter`（列表项行为） | `addKeyboardShortcuts() { return { Enter: () => { … } } }` |
| `frontend/src/editor/extensions/NoteExtension.ts:123-133` | `Enter`（空信息块退出） | 同类写法 |
| StarterKit（`@tiptap/starter-kit` 3.29.2）内置 | Bold `Mod-b`、Italic `Mod-i`、Underline `Mod-u`、Strike `Mod-Shift-s`、Code `Mod-e`、CodeBlock `Mod-Alt-c`、Blockquote `Mod-Shift-b`、HardBreak `Mod-Enter` / `Shift-Enter`；UndoRedo `Mod-z` / `Shift-Mod-z` / `Mod-y` | 枚举自 `node_modules/@tiptap/extension-*/dist/index.js` 与 `@tiptap/extensions/dist/index.js`（`Mod-z`/`Shift-Mod-z`/`Mod-y`） |
| core 基础键位 | `Enter` / `Mod-Enter` / `Backspace` / `Mod-Backspace` / `Shift-Backspace` / `Delete` / `Mod-Delete` / `Mod-a`（Mac 另有 `Ctrl-h`/`Ctrl-d`/`Alt-Backspace`/`Alt-Delete`/`Alt-d`/`Ctrl-a`/`Ctrl-e`） | `@tiptap/core/dist/index.js:5721-5741` |
| 表格 / 列表 | `Tab` / `Shift-Tab`（表格单元格导航、列表缩进） | `@tiptap/extension-table`、`extension-list` 等 dist |

机制（对选型至关重要）：每个扩展的 `addKeyboardShortcuts()` 在**编辑器初始化时**被收集，拼成一个 ProseMirror keymap 插件：

```js
// node_modules/@tiptap/core/dist/index.js:5222-5238
const addKeyboardShortcuts = getExtensionField(extension, "addKeyboardShortcuts", context);
…
const bindings = Object.fromEntries(Object.entries(addKeyboardShortcuts()).map(([shortcut, method]) => {
  return [shortcut, () => method({ editor })];
}));
…
const keyMapPlugin = keymap(defaultBindings);
plugins.push(keyMapPlugin);
```

→ 运行时改绑的可行路径有两条：(a) 重新构造编辑器（代价：撤销历史/选区丢失，不可接受）；(b) `editor.registerPlugin()/unregisterPlugin()` 动态增删 keymap 插件——**3.29.2 已提供**（`@tiptap/core/dist/index.js:4369` / `:4376`）。
⚠️ 顺序注意：ProseMirror 按 `state.plugins` 顺序调用 `handleKeyDown`，**先注册者先命中**。用 `registerPlugin` 追加的自定义 keymap 会排在 StarterKit 的 keymap 之后 → 想「覆盖 Mod-b」这类内置键，单纯追加**无效**，需要插入到数组前部（`registerPlugin(plugin, handlePlugins)`）或在 DOM capture 阶段先拦（B 档做法）。

#### 1.2.2 `window.addEventListener('keydown')` 层（生产代码全部命中，共 3 处）

| 位置 | 绑定 | 行为 |
|---|---|---|
| `frontend/src/components/layout/EditorArea.tsx:470-479` | Ctrl/Cmd+S | `e.preventDefault(); void saveNow()` |
| `frontend/src/components/layout/LeftSidebar.tsx:174-183`（listener 在 `:180`） | Ctrl/Cmd+K | `e.preventDefault(); searchRef.current?.focus()`（注释：handoff §6） |
| `frontend/src/components/editor/nodeviews/ImageLightbox.tsx:19-24` | Escape | `onClose()` |

组件级 `onKeyDown`（非 window）：`PromptDialog.tsx:136/147/174`（Enter/Escape）、`MathEditorModal.tsx:165`、`WorkspacePicker.tsx:189`（Enter）、`FootnoteNodeView.tsx:61`、`FootnotesNodeView.tsx:64`、`SettingsPanel.tsx:286/596`、`LeftSidebar.tsx:615`（搜索框回车）。

→ 现状：**没有中央分发器**，每条快捷键各写各的 `useEffect`。自定义快捷键若不上统一注册表，就无法与这三处共存、也无法做冲突检测。

#### 1.2.3 原生菜单加速键（**与任务描述不符，以实测为准**）

任务描述：「我快速 grep `accelerator` 没命中」。实测结论：**加速键存在，只是不叫 `accelerator`**。Tauri v2 的 `MenuItem::with_id(app, id, text, enabled, accelerator: Option<&str>)` 是**位置参数**（`use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};`，`menu.rs:10`）。

`desktop/src-tauri/src/menu.rs` 实测清单：

| 菜单项 | 加速键 | 行号 |
|---|---|---|
| 文件 → 新建文档 `MID_NEW` | `Ctrl+N` | `:40` |
| 文件 → 打开 Workspace… `MID_OPEN_WS` | `Ctrl+O` | `:41` |
| 文件 → 新建工作区… `MID_NEW_WS` | 无 | `:42` |
| 文件 → 最近工作区… `MID_RECENT` | 无 | `:170`（子菜单构建 `:165-172`） |
| 文件 → 关闭工作区 `MID_CLOSE_WS` | 无 | `:46` |
| 文件 → 恢复检查… `MID_RECOVERY` | 无 | `:47` |
| 文件 → 设置… `MID_SETTINGS` | `Ctrl+,` | `:49` |
| 文件 → 退出 `MID_EXIT` | `Ctrl+Q` | `:51` |
| 编辑 → 撤销/重做/剪切/复制/粘贴/全选 | `PredefinedMenuItem` 平台默认加速键 | `:55-67`（undo 在 `:60`） |
| 视图 → 重新加载 `MID_RELOAD` | `Ctrl+R`（debug 分支 `:76`；release 分支 `:87`） | `:71-82` / `:83-88` |
| 视图 → 开发者工具 `MID_DEVTOOLS` | `F12`（仅 `#[cfg(debug_assertions)]`） | `:78` |
| 帮助 → 关于 | 无 | `:90-101` |

点击后经 `app.emit('ke-menu:*')` 广播，前端 `App.tsx:653-667` 监听复用既有 handler（`menu.rs:108-151` 的 `handle_event`；常量表 `:17-29`；`app.set_menu` 在 `:103`）。

优先级/冲突关系（**机制推断，未在 GUI 实测**）：Tauri v2 在 Windows 上由 muda 为窗口注册加速键表，窗口消息循环用 `TranslateAccelerator` 处理 → 命中时菜单命令优先，WebView2 可能**收不到**该按键。推论：
- 与原生加速键重叠的用户绑定 **无法靠 JS `preventDefault` 拦住**；
- 原生菜单也可能「抢走」我们想绑定给应用动作的组合键。
→ 建议把 `Ctrl+N / Ctrl+O / Ctrl+, / Ctrl+Q / Ctrl+R / F12` 列为**保留键**；若确实要求可改绑，需 Rust 侧同步重建菜单（本期不建议）。上线前建议用 CDP 探针实测一次 Ctrl+N（脚本见 §8.2）。

### 1.3 设置契约：三处同步 + 新字段（映射型）可行性

三处真实位置：

1. **前端 schema / 归一化 / 合并**：`frontend/src/settings.ts`
   - 类型：`:8-45`（`StartupSettings` / `EditorSettings` / `UiSettings` / `AppSettings`）
   - 补丁类型：`:47-58`（`SettingsPatch`）
   - 默认值：`:60-66`（`DEFAULT_SETTINGS`，`schemaVersion: 1`，`editor.autosaveIntervalMs: 3000` 等）
   - 合并：`:94-122`（`mergeSettings`；**F08 起 `display` / `displayPreference` / `maintenance` 走深合并**，注释明写「原先整体替换与 Rust merge_value 深合并语义分歧，启用即双端分裂」）
   - 兜底：`:144-189`（`normalizeSettings`，缺键补默认、非法值回退）
2. **Tauri IPC**：`frontend/src/settings.ts:192-205`（`invoke<unknown>('get_settings')`）、`:208-222`（`invoke<AppSettings>('update_settings', { patch })`）；非 Tauri 降级 localStorage `ke.settings.v1`（`:68`）。
3. **Rust 结构体 + lenient 白名单**：`desktop/src-tauri/src/settings.rs`
   - 结构体：`:29-125`（`#[serde(default, rename_all = "camelCase")]`；`editor.display` / `ui.displayPreference` / `maintenance` 用 `serde_json::Value`）
   - 读盘：`:134-149`（容忍 BOM）、`:151-208`（**`from_value_lenient` 逐字段白名单**）
   - 深合并：`:251-266`（`merge_value` 递归合并对象键）
   - 净化：`:268-296`（`sanitize` 目前只处理 theme / accentColor）
   - 命令：`:308-326`（`get_settings` / `update_settings`）
   - 落盘位置：`:128-132`（`%APPDATA%…\KnowledgeEditor\settings.json`）

**新增 `Record<action,string>`（键位映射）的结论：可行，但必须处理四件事：**

1. **三处都要加**。建议 Rust 侧字段与 `display` 同款用 `serde_json::Value`（而不是 `HashMap<String,String>`）：未知键、非字符串值不会让整份设置反序列化失败（`settings.rs:29-125` 的 `default` 能兜，但 `from_value_lenient` 里漏加白名单 = **IPC 返回 null，设置静默失效**，正是 handover 记录的历史坑：`docs/agent-handover-v1.1.8.md:189`「设置字段三处同步（§3.3），漏 `from_value_lenient` = 设置静默失效」）。
2. **删除语义 vs 深合并**：`merge_value`（`settings.rs:251-266`）会把对象深合并 → 前端「删掉某个动作」的补丁**删不掉**服务端已有的键。两种可选口径：
   - **(推荐) 墓碑式**：沿用 `accentColor` 先例（空串 = 清除，`settings.ts:108-118`）→ `{"editor.bold": ""}` 表示「恢复默认」；再加 `"none"` 表示「解绑」。TS 与 Rust 两端都无需特例。
   - 整表替换：必须同时在 TS `mergeSettings` 与 Rust `merge_value` 加特例——历史上 F08 就是两端语义分歧导致的静默 bug，**不建议**。
3. **默认值 / 迁移 / 非法值**：默认 `{}`（全部走内置默认键位，行为零变化）；不需 `schemaVersion` 迁移（旧版本无此键 → lenient 白名单忽略 → `{}`；新版本读旧文件同理）。非法值处理建议：
   - TS `normalizeSettings`：只保留 `{[k]: string}`，键不在已知动作集则**保留但忽略**（便于降级不丢配置），值不合法（语法/保留键）则丢弃该条；
   - Rust `sanitize`：只做「值必须是字符串」的类型级净化（语义级白名单放前端，避免双端维护动作清单）；空串/`none` 原样保留。
4. **测试守门现状**：`frontend/src/settings.test.ts`（18 例：merge/normalize/深合并/accentColor/applyTheme 单例）与 `desktop/src-tauri/src/settings.rs:356-570`（10 例：merge/sanitize/roundtrip/corrupt file）都只覆盖**既有字段**；**没有任何测试能发现「三处不同步」**。建议补两条低成本守门：
   - 前端：`DEFAULT_SETTINGS` 的键集合快照断言（新增字段必须同步改快照）；
   - Rust：默认值序列化 → `from_value_lenient` 往返，断言「每个非默认字段都能读回」（把 handover 坑 12 变成可测）。

### 1.4 冲突面与避让策略

| 类别 | 具体键位 | JS 能否拦 | 建议策略 |
|---|---|---|---|
| 系统/窗口级 | `Alt+Tab`、`Win+*`、`Alt+F4`、`Ctrl+Alt+Del` | **否**（OS 优先，前端收不到） | 保留键黑名单（配置期拒绝） |
| 原生菜单加速键 | `Ctrl+N/O/,/Q/R`、（debug）`F12`、编辑菜单预定义项 | **基本否**（机制推断，需实测） | 保留键；真要开放需 Rust 侧同步改菜单 |
| WebView2/浏览器默认 | `Ctrl+C/V/X/A`（剪贴板）、`Ctrl+F`、`Ctrl+P`、`F5`/`Ctrl+R`、`F12` | 部分（`preventDefault` 对多数 DOM 默认有效；强快捷键不保证） | 保留键 + 命中时提示 |
| ProseMirror/Tiptap 内置 | `Mod-b/i/u`、`Mod-Shift-s`、`Mod-e`、`Mod-Alt-c`、`Mod-Shift-b`、`Mod-Enter`/`Shift-Enter`、`Mod-z`/`Shift-Mod-z`/`Mod-y`、`Enter`/`Backspace`/`Delete`/`Mod-a`、`Tab`/`Shift-Tab` | **可**（capture 阶段的 window 监听先于 PM 的 DOM 处理） | 允许覆盖 + UI 标注「覆盖内置键位」 |
| 输入法组合键 | 中文拼音候选/上屏键（`isComposing` / `keyCode === 229`） | 可 | 分发器**无条件跳过** composing 事件 |
| 应用内既有绑定 | `Ctrl+S`（`EditorArea.tsx:471`）、`Ctrl+K`（`LeftSidebar.tsx:175`）、`Escape`（`ImageLightbox.tsx:20`） | 可 | 收敛进统一注册表，启动时检测重复 |

**用户自定义后的冲突处置（推荐三步）**：
1. **配置期（纯函数，可单测）**：与保留键表冲突 → 直接拒绝并给出原因；与应用内其它动作重复 → 拒绝或「后者覆盖」（产品决策）；与 Tiptap 内置键位冲突 → 允许，但行内显示琥珀色徽章「将覆盖内置键位 Mod-b」。
2. **运行期兜底**：同一按键命中多个动作时按注册顺序取第一个并 `console.warn`（不静默）。
3. **提示形态**：设置页行内徽章 + tooltip，不用阻塞对话框（与现有 SettingsPanel 风格一致，`SettingsPanel.tsx:99-110` 的 `patchAndSave` 已带错误上报）。

---

## 2. 方案对比

| 维度 | **A 只读展示型** | **B 可配置 + 全局 keydown 分发（推荐）** | **C 可配置 + Tiptap keymap 动态注册** | ~~D Tauri 全局快捷键~~（否决） |
|---|---|---|---|---|
| 用户体验 | 设置页看到键位表，不可改 | 可在设置页录制/改绑/重置；立即生效 | 同 B，且键位与 PM 处于同一层 | 应用未聚焦也触发（对编辑器动作语义错误） |
| 改动文件 | `SettingsPanel.tsx` + 一个只读描述表 | `settings.ts`（字段）+ `SettingsPanel.tsx`（UI）+ 新 `state/shortcuts.ts`（解析/冲突/分发）+ `EditorArea.tsx`（编辑器动作注册表）+ `App.tsx`（应用动作桥）+ 三处设置同步中的前端两处 + Rust 一处 | B 的全部 + `editor/index.ts`（注册 keymap 插件） | B 的全部 + `Cargo.toml`（新依赖）+ `lib.rs`/`menu.rs` |
| Rust 侧 | 无 | **仅设置字段**（结构体 + lenient 白名单 + sanitize，`settings.rs`） | 同 B | 需新增 `tauri-plugin-global-shortcut`（当前 `Cargo.toml:17-21` 只有 shell/dialog/single-instance） |
| 冲突检测能力 | 可展示内置冲突（静态表） | 强（配置期 + 运行期，全部可单测） | 强，但「覆盖内置键」需插到 PM 插件数组前部（见 §1.2.1） | 弱：全局键与窗口内键互相抢占，且系统级抢占更难排查 |
| 生效方式 | 出厂即定 | 设置保存后立即生效（分发器每次读 `getCachedSettings()`，同 `getAutosaveIntervalMs()` 范式 `settings.ts:229-232`） | 同 B（需重注册 keymap 插件） | 需注册/注销 OS 级热键 |
| 可测性（vitest） | 高（纯渲染） | **高**：解析/冲突/决策是纯函数；组件级可仿 `LeftSidebar.test.tsx`（createRoot+act）与 verifier 的 EditorArea 门面 mock 范式（`docSwitch.verify.test.tsx:44-72`） | 中：happy-dom 跑真 Tiptap 代价高，需门面 mock 才能测「键位→命令」 | 低：OS 行为无法在 vitest 覆盖，只能靠 GUI 冒烟 |
| 风险 | 不满足诉求 | 低–中（核心风险在原生加速键与 IME） | 中（PM 插件顺序、覆盖语义） | **高**（单实例/焦点/系统级抢占，且引入新依赖） |
| 估时 | 0.5–1 人日 | **2.5–4 人日** | 在 B 上 +1–1.5 人日 | +2–3 人日（不建议本期） |

**推荐：B 档**，理由：
1. 用户可见的诉求（工具栏按钮 / 保存 / 切换文档）**大部分不在 ProseMirror 层**，用 DOM 级分发器一次覆盖最省事；
2. capture 阶段的 window 监听天然先于 PM 的 DOM handler，**既能覆盖内置键，又能拦住浏览器默认**（`preventDefault`）；
3. 不需要重建编辑器 → 不丢撤销历史/选区，热更新零成本；
4. 全部决策逻辑可抽成纯函数 → 与 `docSwitch.ts` 同款「可测缝」范式（本仓库已有先例与对照物）；
5. C 档的能力（与 PM 同层）在本场景**收益有限但成本明确**（插件顺序坑 + 门面 mock 成本），可后置为增强项。

---

## 3. 推荐方案（B）设计草案

1. **数据模型**：`editor.shortcuts?: Record<ActionId, string>`，默认 `{}`（空 = 全部用内置默认，行为零变化）。`ActionId` 用 TS 联合类型集中定义（如 `frontend/src/state/actions.ts`），运行期对 `shortcuts` 的键做「已知则用、未知则忽略」处理。
2. **键位规范**：`"Ctrl+Shift+K"` / `"Mod+S"` / `"F2"` / `"Escape"`；`Mod` 展开为 Windows/Linux 的 Ctrl 或 macOS 的 ⌘（与 Tiptap 的 `Mod-` 语义对齐，`@tiptap/core/dist/index.js:5721`）；解析、归一化、`matches(event, spec)`、冲突检测写进 `frontend/src/state/shortcuts.ts`（纯函数、零 React）。
3. **分发器**：单一 `window.addEventListener('keydown', handler, true)`（capture）+ 注册表 `Map<string, ActionId>`；命中后：
   - 编辑器动作 → 调用 EditorArea 注册的 `Record<ActionId, () => void>`；
   - 应用动作 → 走既有事件桥（见下）；
   - 命中即 `preventDefault()`（可选 `stopPropagation()`，需评估对 PM 的影响）；composing 事件直接 return。
4. **桥接复用既有两种范式**（不必发明新机制）：
   - CustomEvent：`ke:open-history`（`App.tsx:777` 派发 → `EditorArea.tsx:536` 监听）、`ke:open-workspace-dialog`（`App.tsx:445`）；
   - Tauri 事件：`ke-menu:*`（`menu.rs:108-151` → `App.tsx:653-667`）。
   新增一个 `ke:action`（detail = `{ id }`）或直接把注册表做在模块层（推荐后者：类型安全 + 可测 + 无需事件穿透）。
5. **动作表收敛**：把 `EditorToolbar.tsx` 的 20+ 个 `ToolIcon onClick` 与快捷键**指向同一张动作表**，顺带消除「按钮行为与快捷键行为漂移」的隐患。
6. **需要新桥接/新功能的动作**：
   - `doc.next` / `doc.prev`：**当前不存在**「切换文档」动作（无 Tab 栏；只有左栏树/最近列表点击 → `App.tsx:271 openArticle`）。需先定顺序来源（§4.5）。
   - `app.search.focus`：`searchRef` 封在 `LeftSidebar` 内 → 走事件桥。
   - `editor.image.insert` / `editor.table.insert` / `editor.footnote.insert` / `editor.module.insert`：只能「打开入口」（文件选择/对话框/下拉），不能一键完成 —— 设置页文案要说明。
7. **生效与持久化**：设置保存（`saveSettings`，`settings.ts:208`）后**立即生效**（分发器每次从 `getCachedSettings()` 读）；三处同步改动清单见 §1.3。
8. **可测性**：
   - 纯函数：全部 vitest（解析/匹配/冲突/保留键/墓碑语义）；
   - 组件级：仿 `LeftSidebar.test.tsx`（createRoot+act+`IS_REACT_ACT_ENVIRONMENT`）与 `docSwitch.verify.test.tsx:44-72` 的 EditorArea 门面 mock（`useKeEditor`/`setKeContent` 替身）；
   - 建议独立验证（verifier）覆盖：保留键拒绝、重复绑定、IME 跳过、capture 覆盖内置 `Mod-b`、设置往返（三处同步）。

---

## 4. 必须先定的产品问题（6 条）

1. **作用域**：快捷键是「全局（任意焦点）」还是「编辑器内」？建议：编辑器动作 = 编辑器聚焦时；应用动作 = 全局。
2. **是否允许覆盖内置键位**（如把 `Ctrl+B` 让给别的动作、或改绑 `Ctrl+B` 到别的功能）？建议允许 + 明确提示。
3. **是否允许解绑**（某动作设为无快捷键）？影响数据模型（需要 `"none"` 哨兵；默认值恢复用空串墓碑）。
4. **是否允许单键**（`F2`、`/` 这类无修饰键）？建议只允许非字母数字 + 非输入态生效。
5. **「切换文档」的定义**：按哪份顺序（左栏树展开顺序 / 最近文档列表 / 打开历史）？是「上一篇/下一篇」还是「最近两篇互切」？当前无 Tab 栏（`AppShell.tsx:1-40`），需要新状态/新桥接。
6. **配置随谁走**：现设置是应用级单文件（`settings.rs:128-132`），工作区可切换 → 建议保持应用级（跨工作区共享），需主理人确认。

---

## 5. 分档估时（含测试与独立验证）

| 档 | 内容 | 估时 |
|---|---|---|
| A 只读展示 | SettingsPanel 加一节静态键位表；无设置字段、无 Rust 改动；1 份测试 | 0.5–1 人日 |
| **B（推荐）** | ① `state/shortcuts.ts` 纯函数 + 单测 0.5；② 设置字段三处同步（TS 接口/DEFAULT/normalize + Rust 结构体/lenient/sanitize）+ 前后端测试 0.5；③ 动作表收敛 + `ke:action` 桥 + EditorArea/App 接线 1–1.5；④ 设置页录制/冲突提示/重置 UI 0.5–1；⑤ 独立验证与回归 0.25–0.5 | **2.5–4 人日** |
| C（B 之上增量） | keymap 插件动态注册/替换（含插件顺序处理）+ 门面 mock 用例 | +1–1.5 人日 |
| D（不建议本期） | Tauri 全局快捷键（新依赖 + 菜单加速键同步 + 单实例/焦点交互 + GUI 冒烟） | +2–3 人日 |

---

## 6. 风险清单

1. **三处不同步 → 字段静默失效**（handover 明确列为坑：`docs/agent-handover-v1.1.8.md:189`）。缓解：字段集合快照测试 + Rust 往返测试（§1.3.4）。
2. **TS 与 Rust 合并语义分歧**（F08 前车之鉴，`settings.ts:91-93`）。缓解：不引入「整表替换」，用墓碑语义；两端都不加特例。
3. **原生菜单加速键无法被 JS 抑制**（机制推断）：保留键策略 + 上线前 CDP 实测 Ctrl+N。
4. **既有 Ctrl+N 双重绑定**（新建文档 vs 插入公式）：**必须先行裁决**，否则自定义快捷键会把用户带到未定义行为。
5. **capture 分发器与输入法/PM 冲突**：必须跳过 `isComposing`；回归中文输入、`Tab` 列表缩进/表格导航、`Enter`（`ListExtension`/`NoteExtension` 都绑了 `Enter`）。
6. **配置面板写盘频率**：录制键位时防抖保存；失败要可见（`SettingsPanel.tsx:99-110` 现有错误处理可复用）。
7. **冲突表漂移**：保留键表（menu.rs）与内置键位表（Tiptap 版本）会过时 → 表项注明来源 + 一条「枚举默认键位」的守门测试（可从 node_modules 断言，成本低）。
8. **降级/回退**：旧版本读到带 `shortcuts` 的设置文件，应被 `from_value_lenient` 白名单忽略且不影响其它字段（需实测一次往返）。
9. **未做 GUI 实测**：本分析基于源码与依赖实测，原生加速键优先级、IME 行为需在真机用 CDP 探针确认（§8.2）。

---

## 7. 红线检查

| 红线 | 是否触碰 | 依据 |
|---|---|---|
| ke-* 文件格式（D 层） | **不触碰** | 只改应用设置与前端交互；不写文档内容、不动 `editor/**` 的序列化 |
| Markdown 单源语义 | 不触碰 | 同上 |
| B 层产品标识（`com.knowledgeeditor.desktop` / `%APPDATA%\KnowledgeEditor` / exe 名） | **不触碰** | 新字段放进既有 `settings.json`（`settings.rs:128-132`），不改路径/目录/文件名 |
| 发布流程（9 处版本源） | 不触碰 | 功能本身无版本源改动；随 v1.1.10 正常走 `handover §6` 流程 |
| 后端 / Python | **无需改动** | 设置由 Rust 持久化（IPC），不经后端 |
| `editor/**` 其它文件 | B 档不改；C 档才需要在 `editor/index.ts` 追加一个 keymap 插件（不改既有扩展逻辑） | §2 |

---

## 8. 附带发现（与任务描述不符 / 顺带发现）

1. **原生菜单确实有加速键**（§1.2.3）：`Ctrl+N`、`Ctrl+O`、`Ctrl+,`、`Ctrl+Q`、`Ctrl+R`、debug `F12` + 编辑菜单预定义项。任务描述「grep accelerator 无命中」应改为「加速键以第 5 位置参数传入，grep 关键词换成 `Some("Ctrl` 或直接读 `MenuItem::with_id` 调用」。
2. **扩展文件真实路径**：`frontend/src/editor/extensions/ListExtension.ts` 与 `…/NoteExtension.ts`（任务描述写作 `src/editor/ListExtension.ts:42` / `src/editor/NoteExtension.ts:123`，实际在同级 `extensions/` 目录下）。
3. **Ctrl+N 双重绑定**（既有隐患）：`menu.rs:40`（新建文档）vs `frontend/src/editor/index.ts:67-104`（插入行内公式）；`editor/index.ts:67-68` 的注释只考虑了浏览器默认，未考虑原生菜单。
4. **工具栏「附件」按钮是死 UI**：`EditorToolbar.tsx:643-647` 仅在传入 `onOpenAttachments` 时渲染，而唯一调用点 `EditorArea.tsx:689-694` 没传 → 当前**不渲染**（附件已在 task-12 迁到左栏、task-22 默认收起）。
5. **文案残留**：`App.tsx:784` 右侧面板展开按钮 title 仍为「展开右侧面板（大纲 / 属性 / 附件）」，而右栏（task-12）已无附件区。
6. `Ctrl+S` 目前只 `preventDefault` DOM 默认（`EditorArea.tsx:471`）；`Ctrl+R`/`F12` 由原生菜单接管 → 自定义键位表要把这两类一起考虑。

---

## 9. 附录：证据索引（文件:行号）

| 主题 | 位置 |
|---|---|
| 工具栏动作全清单 | `frontend/src/components/editor/EditorToolbar.tsx:446,469,472,475,478,491,507,510,513,516,528,531,547,580,606,609,612,615,621,624,631,639,644` |
| 工具栏 props（含未接线的 `onOpenAttachments`） | `EditorToolbar.tsx:293-306`、`:643-647`；`EditorArea.tsx:689-694` |
| Tiptap 快捷键注册 | `frontend/src/editor/index.ts:67-104`；`extensions/ListExtension.ts:42-44`；`extensions/NoteExtension.ts:123-133` |
| Tiptap keymap 机制 | `node_modules/@tiptap/core/dist/index.js:5222-5238`（初始化收集）、`:5686-5745`（core 基础键位）、`:4369/:4376`（`registerPlugin`/`unregisterPlugin`） |
| Tiptap 内置键位枚举 | `node_modules/@tiptap/extension-*/dist/index.js`、`@tiptap/extensions/dist/index.js`（`Mod-z`/`Shift-Mod-z`/`Mod-y`） |
| window keydown | `EditorArea.tsx:470-479`、`LeftSidebar.tsx:174-183`、`ImageLightbox.tsx:19-24` |
| 原生菜单加速键 | `desktop/src-tauri/src/menu.rs:10`（`use`）、`:17-29`（MID 常量）、`:35-53`（文件菜单，加速键在 `:40,41,49,51`）、`:55-67`（编辑预定义项）、`:71-88`（视图，`Ctrl+R` 在 `:76/:87`、`F12` 在 `:78`）、`:90-101`（帮助）、`:103`（`set_menu`）|
| 前端监听菜单事件 | `frontend/src/App.tsx:653-667` |
| 事件桥先例 | `App.tsx:445,777`；`EditorArea.tsx:536` |
| 设置三处 | `frontend/src/settings.ts:8-66,94-122,144-189,192-222`；`desktop/src-tauri/src/settings.rs:29-125,128-132,151-208,251-266,268-296,308-326` |
| 设置测试 | `frontend/src/settings.test.ts`（18 例）；`desktop/src-tauri/src/settings.rs:356-570`（10 例） |
| 三处同步坑 | `docs/agent-handover-v1.1.8.md:82`（§3.3 原文）、`:189`（坑 12）、`:85-95`（§4 冻结项） |
| App 动作 handler | `App.tsx:271,305,363,430,450,463,473,485,577,653-667,782-791` |
| 布局/无 Tab 栏 | `frontend/src/components/shell/AppShell.tsx:1-40` |
| 测试范式参考 | `frontend/src/components/layout/LeftSidebar.test.tsx`、`frontend/src/state/docSwitch.test.ts`、`frontend/src/state/docSwitch.verify.test.tsx:44-72` |
| Tauri 依赖现状（无 global-shortcut） | `desktop/src-tauri/Cargo.toml:17-21` |
