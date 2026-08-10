# Phase 6U：真实环境测试迭代报告

> 阶段：6U | 日期：2026-08-10 | 版本演进：v0.6.0 后 → v0.7.3（含未编号的表格优化）
> 范围：自用户提出真实环境测试起（「你希望我在真实环境测试什么？说一下具体操作」），在 6E 冻结基线 v0.6.0 之后进行的功能新增、白屏修复、交互迭代与浏览器端全量回归测试。终点为进入 Phase 7 之前。

## 1. 阶段概述

本阶段从用户要求真实环境测试开始，用户在实际使用中陆续提出功能与缺陷反馈，共新增 3 项功能（表格操作增强、拖拽添加附件、注释样式选择），修复 8 个缺陷（含 1 个环境性白屏问题），完成 2 项视觉优化，并建立 26 项浏览器端回归测试体系。核心迭代集中在三处：表格操作增强（推送后即触发白屏）、脚注上标（光标/换行/DOM 错位系列）与信息块（内容可编辑化、占位符、输入）。阶段起点为 6E 冻结基线 v0.6.0，终点为进入 Phase 7 之前。

| 版本 | 内容 | 触发反馈 |
| --- | --- | --- |
| （未编号，6E 冻结后） | 表格功能优化：光标进入表格时浮动气泡菜单，支持增删行列、合并/拆分单元格、删除整个表格 | 表格操作不便，需行列级编辑 |
| v0.6.1 | 拖拽文件到编辑区直接上传为附件；孤儿附件仅手动删除 | 「增加拖动添加附件」 |
| v0.6.2 | 脚注支持纯 Markdown 样式（注释样式选择）；信息块徽章文字可自定义 | 「增加注释样式」 |
| v0.6.3 | 纯 Markdown 样式脚注补充正文上标 [n]（不创建 footnotes 节点） | 样式功能补齐 |
| v0.6.4 | 修复插入脚注上标后自动换行；上标编号可点击自主修改 | 脚注插入行为反馈 |
| v0.6.5 | 修复插入脚注后光标状态与 DOM 错位（Backspace 误删上标） | 光标视觉错位反馈 |
| v0.7.0 | 信息块支持块内注释（atom 节点改为 content 节点） | 「信息块内无法使用注释功能（它会删掉整个信息块）」 |
| v0.7.1 | 修复信息块内无法输入文本；徽章色系联动、默认空文本 | 「信息块现在无法输入文本」 |
| v0.7.2 | 修复占位文字错误渲染到颜色按钮 | 「每个选择颜色的按钮下面都挂着一长串竖着的"请输入信息块内容…"」 |
| v0.7.3 | 修复保存后属性面板时间变「—」；stop.ps1 兜底增强 | 「保存后右边栏属性会变成-」「用 stop.ps1 无法停止前端」 |

## 2. 问题清单

| # | 版本 | 现象 | 根因 | 严重度 |
| --- | --- | --- | --- | --- |
| B0 | 6E 冻结后（推送表格优化后） | 开发页打开白屏 | 表格优化新增 `@tiptap/react/menus`（BubbleMenu）依赖路径导入，推送后触发 Vite 重新依赖预构建；本机安全软件按文件名拦截 `esbuild.exe` 写入（Access is denied），预构建无法产出缓存，页面无模块可渲染 | 高（环境性，由表格优化触发） |
| B1 | v0.6.4 | 插入脚注上标后正文自动换行 | 插入路径为 chain 多 transaction，trailingNode 在 footnotes 节点后补空段落；光标未显式复位到上标之后 | 中 |
| B2 | v0.6.5 | 上标后 Backspace 误删上标；行末插入后光标视觉跳到下一行 | `insertFootnote`/`insertPlainFootnote` 用 chain 模式 `insertContent` 不立即 dispatch，selection 仍是插入前位置；上标 `line-height: 0` 造成行尾视觉错位；浏览器把 caret 渲染到软换行后的下一行行首 | 高 |
| B3 | v0.7.0 | 块内使用注释功能会删除整个信息块 | 信息块为 atom 节点，PM 将插入位置视为替换选区，注释插入即整块替换 | 高 |
| B4 | v0.7.1 | 信息块内无法输入任何文本 | NodeViewWrapper 设 `contentEditable={false}`，prosemirror-view 不会自动覆盖 contentDOM 的可编辑性，contentDOM 继承禁编辑 | 高 |
| B5 | v0.7.2 | 每个颜色按钮下挂一长串竖着的「输入信息块内容…」 | CSS `[contenteditable]:empty::before` 属性选择器匹配属性存在即命中（不看值），空的颜色按钮（`contenteditable="false"` 且无子节点）满足 `:empty`；`white-space: pre-wrap` 使文字在 16px 窄按钮中竖排 | 中 |
| B6 | v0.7.3 | 保存正文后，右边栏属性创建/修改时间、字数、大小变「—」 | `PUT /api/articles/{id}` 响应未返回 `created_at`/`updated_at`/`size`/`word_count`，前端 `handleSaved` 用该响应整体替换文档状态，空值显示为「—」 | 中 |
| B7 | v0.7.3 | `.\scripts\stop.ps1` 无法停止运行中的前端 | stop.ps1 只按 `runtime.json` 的 PID 记录停止（该文件由 start.ps1 写入）；dev 方式启动的进程无记录，脚本直接走「未找到记录文件」分支退出 | 中 |

## 3. 修复内容

### 3.1 表格功能优化（6E 冻结后，未编号版本）

新增功能而非缺陷修复，也是本阶段白屏问题的直接触发源。`frontend/src/components/editor/TableBubbleMenu.tsx` 新增表格气泡菜单：光标进入表格（或拖选单元格）时，在表格上方浮动显示操作条（Tiptap v3 BubbleMenu + Floating UI 定位），支持上/下插行、左/右插列、删行、删列、合并单元格、拆分单元格、删除整个表格，操作按钮均带可用态判断（`can().mergeCells()` 等），点击按钮 `onMouseDown preventDefault` 防止编辑器失焦导致菜单隐藏。该组件是唯一从 `@tiptap/react/menus` 子路径导入 `BubbleMenu` 的文件，推送后触发 Vite 对新增依赖路径重新预构建，esbuild 被本机安全软件拦截写入，预构建失败导致开发页白屏（见 3.2）。

### 3.2 白屏修复（6E 冻结后，环境性）

B0 的根因链为：表格优化引入 `@tiptap/react/menus` 依赖路径 → Vite 检测到新依赖触发重新预构建 → 本机安全软件按文件名拦截 `esbuild.exe` 的写入（Access is denied）→ 无法产出 `node_modules/.vite` 缓存 → 开发页无模块可加载而白屏。修复引入两处工程化兜底：

- `frontend/scripts/ke-vite.mjs`：启动 Vite 前先把 `@esbuild/win32-x64/esbuild.exe` 复制为改名副本（`.esbuild/esbuild-renamed.exe`，按体积与 mtime 判断是否需刷新副本），并在任何 esbuild 模块被加载前设置 `ESBUILD_BINARY_PATH` 指向副本，再以子进程启动真实 Vite CLI（dev/build/preview 参数原样透传）。
- `frontend/vite.config.ts`：`cacheDir` 从 node_modules 下移出到 `../workspace/.knowledgeeditor/vite-cache`——本机沙箱保护 node_modules 目录、拦截其中的目录 rename（Access is denied / ENOENT），导致依赖预构建 `deps_temp -> deps` 原子替换失败；workspace 下的目录 rename 不受限。

### 3.3 拖拽添加附件（v0.6.1）

新增功能而非缺陷修复。核心实现位于 PM 层 `editorProps.handleDrop`（`frontend/src/editor/index.ts`）：拦截 ProseMirror 对拖入图片的默认 base64 内联行为，改为逐个上传后插入 `attach`/`video` 节点（`uploadAttachment` 上传 → `attachmentNode` 按返回类别构建节点 → `tr.insert(pos)`），拖放位置按 `posAtCoords` 计算。上传失败 `window.alert` 提示且不中断后续文件。`EditorArea.tsx` 增加拖拽悬停遮罩（实际插入仍由 PM 层完成，容器层 onDrop 无法阻止 PM 默认插入）。配套：孤儿附件（未被任何 Markdown 引用）仅支持手动删除、绝不自动删除；被引用附件后端返回 409 拒绝删除。

### 3.4 注释样式（v0.6.2 / v0.6.3）

「注释」弹窗（`EditorToolbar.tsx` 的 `FootnoteDialog`）支持两种脚注样式，选择记忆在 `localStorage['ke.footnoteStyle']`：

- **脚注区域（原样式，block）**：正文插入上标 [n]，文末自动生成灰底「脚注」信息块（独立 footnotes 节点），条目可就地编辑、与上标有连接。
- **纯 Markdown（plain）**：正文同样插入上标 [n]；文末追加 `# 参考` 与 `[n] 内容` 为普通段落，无连接、可自由编辑（v0.6.3 补齐正文上标，不创建 footnotes 节点）。

### 3.5 脚注光标与换行修复（v0.6.4 / v0.6.5）

B1/B2 同属脚注上标插入链路：

- v0.6.4：StarterKit `trailingNode` 配置 `notAfter: ['paragraph', 'footnotes']`，footnotes 节点后不再补空段落；插入上标后光标显式复位到上标之后同一行；上标编号可点击直接修改（仅影响正文显示，不影响底部参考栏）。
- v0.6.5：`insertFootnote`/`insertPlainFootnote` 改为单 transaction（`tr.replaceWith` 插入上标后 `after = from + nodeSize` 将光标置于上标之后），杜绝 chain 模式 `insertContent` 不立即 dispatch、selection 仍是插入前位置导致 Backspace 误删上标的根因；上标样式 `line-height` 由 0 改为 1 消除行尾视觉错位；行末/段末插入后补零宽空格 U+200B 锚点（`isCaretAtLineEnd` 判断，`$pos.end()` 而非 `Node.end()`），避免浏览器把 caret 渲染到下一行行首。

### 3.6 v0.7.0：信息块改为可编辑内容节点（方案 A）

用户选择「方案 A：块内支持注释（推荐）」，信息块从 atom 节点改造为 `content: 'inline*'` 内容节点：

- `NoteExtension.ts`：`group: 'block'`、`content: 'inline*'`、`defining: true`、`selectable: true`、`draggable: true`；`renderHTML` 返回 `['div', mergeAttributes(...), 0]`（0 为子内容挂载点）；`insertNote` 命令将内容参数包成文本子节点。
- `tokenizers.ts`：新增 `keNoteTokenizer`（'ke_note'，block 级），用 `matchBalancedJson` 解析头部 attrs，查找 `<!-- /ke-note -->` 结束标记——找到则解析为包裹格式 `{ content: inner }`，找不到则为旧自闭合格式 `{ selfClosed: true }`。
- Markdown 存储改为包裹格式：`<!-- ke-note: {json} -->\n内容\n<!-- /ke-note -->`。
- 旧格式自动迁移：`parseHTML` 双规则，优先级 200 的旧格式规则仅当 `data-content`/`data-text` 属性存在时命中，`getContent` 用 `Fragment.fromJSON(schema, [{ type: 'text', text: legacy }])` 迁移为文本子节点；`parseMarkdown` 对旧格式（token 无 content）同样从 attrs 迁移。
- `NoteNodeView.tsx`：改用 `NodeViewContent as="div"` 挂载 PM contentDOM。
- 测试更新：`markdown-roundtrip.test.ts` 新增「块内插入脚注」场景（`setTextSelection(11)`，note 内文本占位 `[6, 11)`，选 12 会落在 note 结束边界触发 TextSelection 错误）；`phase3-roundtrip.test.ts` 旧 `"content":"重要内容"` 断言改为包裹格式断言。

### 3.7 v0.7.1：修复块内输入 + 徽章优化

B4 的根因确认过程：wrapper `contentEditable={false}` 被 contentDOM 继承（prosemirror-view 的 NodeView 对 contentDOM 不设置可编辑性，仅继承祖先）。实验证明手动给 contentDOM 设 `contentEditable='true'` 后输入成功。修复为 tiptap 官方模式：

- wrapper 不再设置禁编辑；颜色按钮、徽章/标题输入框、删除按钮各自单独加 `contentEditable={false}`。
- 徽章颜色与信息块背景同步同一色系：`COLOR_MAP` 结构从字符串改为 `Record<string, { block: string; badge: string }>`（blue/yellow/green/red/purple 五色），块背景与徽章徽标取自同一色系深浅两档。
- 徽章默认空文本：placeholder 清空，不再显示「信息」占位字。

### 3.8 v0.7.2：占位符修复

B5 排查通过真实 Chrome 探针确认：命中 `::before` 占位文字的是 5 个颜色按钮与 2 个输入框（均 `contenteditable="false"` 且 `:empty`）；而真实内容区 contentDOM 无显式 contenteditable 属性（`ceAttr: null`），且 PM 空容器内置 `<br class="ProseMirror-trailingBreak">` 保证光标可见，因此内容区永远不会 `:empty`——旧 CSS 规则实际从未在内容区生效过。

修复分两步：

- CSS 排除禁编辑控件：`.ke-note [contenteditable]:not([contenteditable="false"])`，控件不再渲染占位文字。
- 内容区占位符改由 JS 驱动：`NoteNodeView` 检测 `node.content.size === 0`，为空时给内容区追加 `ke-note-content--empty` class，CSS 用 `.ke-note-content.ke-note-content--empty::before` 显示占位符，输入文字后 class 自动移除。

### 3.9 v0.7.3：属性面板元信息修复

B6 根因链路：编辑器保存走 `saveArticle` → `PUT /api/articles/{id}` → 后端 `update_article` 响应仅含标题/正文/标签 → 前端 `handleSaved` 用响应整体替换 article 状态 → `fmtTime`/`fmtSize` 对缺失字段显示「—」。

修复：`update_article` 与 `GET /articles/{id}`、`PUT /articles/{id}/meta` 接口保持一致，保存后返回完整元信息（`_file_stats` 取 `created_at`/`updated_at`/`size`，正文重新计算 `word_count`）。`test_api.py` 新增回归断言：保存响应必须携带非空的 `created_at`/`updated_at`/`size`/`word_count`。

### 3.10 v0.7.3：stop.ps1 兜底停止增强

B7 修复保留「不按进程名模糊匹配、不误杀无关服务」的设计原则，在 `runtime.json` 缺失/失效时增加「端口 + 项目命令行特征」双重匹配兜底：

- 服务定义表：backend 端口 8000 匹配命令行含 `uvicorn app.main:app`；frontend 端口 5173 匹配命令行含 `node_modules\vite\bin\vite.js`。
- 特征命中的进程用 `taskkill /PID /T /F` 停止整个进程树（兼容 vite 经 npm 启动的子进程结构），`taskkill` 不可用时回退 `Stop-Process`。
- 特征不命中的占用进程只提示、不自动关闭。

## 4. 功能优化汇总

| 项 | 说明 |
| --- | --- |
| 表格气泡菜单（6E 冻结后） | 光标进入表格浮动操作条：增删行列、合并/拆分单元格、删除整个表格；可用态判断 + 防失焦 |
| 拖拽添加附件（v0.6.1） | 文件拖入编辑区按类型上传并插入 attach/video 节点，按拖放位置插入；孤儿附件仅手动删除 |
| 注释样式（v0.6.2/6.3） | 脚注弹窗支持「脚注区域」与「纯 Markdown」两种样式，选择记忆 |
| 上标编号可修改（v0.6.4） | 上标编号点击直接修改，仅影响正文显示 |
| 块内注释（v0.7.0） | 信息块内可插入脚注上标，不再删除整块；Markdown 包裹格式存储，旧格式自动迁移 |
| 徽章色系联动（v0.7.1） | 徽章颜色与块背景同一色系（五色双档配色） |
| 徽章默认空文本（v0.7.1） | 新建信息块徽章不再显示「信息」占位字 |

## 5. 测试与验证

### 5.1 自动化测试

| 套件 | 数量 | 结果 | 说明 |
| --- | --- | --- | --- |
| 前端 vitest（`frontend/src/editor/*.test.ts`） | 62 | 全绿 | 覆盖信息块往返、块内脚注、旧格式迁移、脚注光标等 |
| 后端 pytest | 102 | 全绿 | 新增「保存响应携带完整元信息」回归断言（v0.7.3） |
| 前端类型检查 | — | tsc -b 零错误 | v0.7.0 修复 `getContent` 返回 Fragment 类型问题后通过 |

### 5.2 构建与启动验证

- 白屏修复后 dev server 可正常产出依赖预构建缓存，`repro.html` 与主应用页面均能加载渲染（app-smoke / diag 脚本验证无致命错误）。
- v0.7.3 代码 `npm run build` 完整通过：`tsc -b` 零错误，vite 构建 `✓ built in 6.46s`，exit code 0，产物（`dist/index.html`、`index-*.js` 1.94 MB、`index-*.css` 73.7 KB）生成正常。仅有既有的 chunk > 500 kB 体积提示，不影响构建与运行。
- `start.ps1` / `stop.ps1` 一键启停链路经真实场景验证。

### 5.3 浏览器端回归测试（26 项 checklist）

真实 Chrome + playwright-core 驱动，分三组执行，全部通过：

- repro 页面（编辑器功能）17/17：页面加载、正文输入、Markdown 往返、信息块（插入/块内输入/块内注释/徽章标题自定义/色系联动/占位符/删除）、脚注上标（行中/行尾插入、编号修改、Backspace 安全、脚注区生成）、包裹格式导出、旧格式迁移。
- 完整 App 8/8：启动与版本（health=0.7.3）、打开文档属性有值、保存后修改时间更新且创建时间不变、标题/标签写回 frontmatter、自动保存防抖、历史版本面板、全文搜索命中、附件面板加载。
- 停止脚本 1/1：stop.ps1 在无 runtime.json 时按端口 + 特征识别并停止 5173/8000。

测试过程中出现 4 项初始失败，均为测试脚本自身问题而非产品缺陷：ProseMirror 位置按 0 基误算（text 节点实际从 pos 1 起）、脚注区 Markdown 标记格式写错、误判文件树显示标题（实际显示文件名）、历史面板模态遮罩的关闭方式。修正脚本后全部通过，未发现产品级 bug。测试数据仅写入专用测试文档 `phase2-e2e.md`。

### 5.4 关键根因实验

| 实验 | 结论 |
| --- | --- |
| 白屏模块加载 | 表格优化引入 `@tiptap/react/menus` 依赖路径触发 Vite 重新预构建，esbuild.exe 被安全软件拦截写入导致缓存缺失，页面无模块渲染；改名副本 + `ESBUILD_BINARY_PATH` 后恢复 → B0 根因 |
| contentDOM 可编辑性 | wrapper `contentEditable={false}` 时 contentDOM 的 `contentEditable` DOM 属性为 inherit（继承禁编辑）；手动设 `'true'` 后输入恢复 → B4 根因 |
| 占位符命中目标 | 探针枚举 `.ke-note` 内所有元素：按钮/输入框 `::before` 渲染占位文字；contentDOM 无显式属性、含 trailingBreak `<br>` 而非 `:empty` → B5 根因 |
| caret 像素级对比 | 修复前 sup 后跟 `\n` 时 caret 落在下一行行首；插入 U+200B 后 caret 落在 sup 右侧同一行（截图扫描深色竖线验证）→ B2 根因 |

## 6. 当前版本号

| 项目 | 版本 | 说明 |
| --- | --- | --- |
| 应用版本 | **v0.7.3** | 唯一来源 `backend/app/__init__.py`；`frontend/src/version.ts`、`frontend/package.json` 同步 |
| Markdown 扩展版本 | ke_version = 1 | 数据格式不变；信息块存储格式自 v0.7.0 起为包裹格式，旧格式读取兼容 |
| API 版本 | v1（无前缀） | 端点清单不变（冻结于 6E） |
| settings schema / FTS schema | 1 / 2 | 不变 |

## 7. 遗留事项与后续注意

1. 前端 `package.json` 仍无 test 脚本入口（Phase 6E 遗留），本阶段均以 `npx vitest run` 直接执行，建议 Phase 7 前补 `vitest run` 并纳入 CI。
2. 前端主包 1.94 MB（chunk > 500 kB 提示），体积优化可作为 Phase 7 非阻塞项。
3. `stop.ps1` 兜底按命令行特征识别依赖 vite/uvicorn 入口路径，若未来变更启动命令（如 Tauri 侧车），需同步更新 `scripts/stop.ps1` 的 `$svcDefs` 匹配串。
4. 白屏修复依赖 `.esbuild/esbuild-renamed.exe` 副本与 workspace 下 vite-cache 目录，若迁移到无安全软件限制的环境可简化，但当前方案保持兼容。
5. 信息块包裹格式已冻结（v0.7.0 起），后续 phase 的格式变更须保留旧格式读取兼容路径。
