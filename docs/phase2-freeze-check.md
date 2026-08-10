# Phase 2 架构冻结检查报告

- 检查时间：2026-08-09
- 检查范围：`KnowledgeEditor` 前端编辑器（`frontend/src/editor`、`frontend/src/components/editor`、`docs/`）
- 检查结论：**通过（附 4 项修复）**，可以进入 Phase 3

## 1. 检查结论摘要

| 检查项 | 结论 |
| --- | --- |
| 1. Document Model 稳定性 | 通过：10 类节点定义稳定，Phase 3 无历史包袱 |
| 2. Markdown 唯一事实源 | 通过：编辑器读写均为 Markdown，无 HTML 持久化路径 |
| 3. 节点链路（Editor Node → Document Model → Serializer/Parser） | 通过：全部扩展走 Markdown tokenizer/parser，无 HTML 主存储 |
| 4. 10 类节点支持 | 通过：10/10 均有 Markdown 往返支持，新增 2 个代码块测试后测试覆盖齐 |
| 验证 | 14/14 测试通过、`tsc -b` 通过、`vite build` 通过 |

## 2. 逐项检查结果

### 2.1 Document Model 稳定性

编辑器 Schema 由 `StarterKit` + 7 个 KE 扩展构成，节点定义与 `docs/markdown-extension-spec.md` v1.0 契约一致：

| 节点 | 扩展 | 说明 |
| --- | --- | --- |
| heading / paragraph / text / codeBlock / 列表等 | StarterKit | 未自定义，保持默认定义 |
| math | `MathExtension` | 行内公式，`$...$` |
| mathBlock | `MathBlockExtension` | 块级公式，`$$...$$` |
| note | `NoteExtension` | 信息块，可自定义标题 |
| module | `ModuleExtension` | 模块卡片 |
| attach | `AttachmentExtension` | 图片 / 文件附件 |
| video | `VideoExtension` | 视频 |
| footnote | `FootnoteExtension` | 行内注释（Phase 2 新增） |

稳定性核对：Phase 2 期间对 `note` 的改造仅为**新增可选属性 `title`**（默认空串），未改动既有属性；`footnote` 为纯新增节点，未触碰任何已有节点定义，符合"未知属性不得丢弃、向前兼容"约定。

### 2.2 Markdown 唯一事实源

- 编辑器初始化与回填均使用 Markdown：`contentType: 'markdown'`、`editor.getMarkdown()`、`setKeContent` 按 Markdown 加载。
- 无任何 HTML 作为持久化/传输格式；`parseHTML`/`renderHTML` 仅用于编辑器内部 DOM 表示（NodeView 渲染、复制粘贴），不进入存储链路。
- 所有 KE 节点序列化为 `<!-- ke-*: {json} -->` 注释或公式标记，可逆解析。

### 2.3 节点链路一致性

每个 KE 扩展均完整实现四件套：`addAttributes`（Document Model）、`markdownTokenizer`（Parser）、`parseMarkdown`（token → node）、`renderMarkdown`（node → markdown）。未发现跳过 Document Model 直接操作 HTML 的路径。

### 2.4 10 类节点 Markdown 往返支持

| 节点 | Markdown 形态 | 往返测试 |
| --- | --- | --- |
| 标题 | `# ~ ####` | 有（混合文档用例） |
| 普通文本 | 段落 + 行内文本 | 有（各用例基线） |
| 代码块 | ```` ```lang ```` | **本次新增 2 条** |
| 公式（行内/块级） | `$...$` / `$$...$$` | 有 |
| 图片 | `ke-attach` type=image | 有 |
| 附件 | `ke-attach` type=file | 有 |
| 视频 | `ke-video` | 有 |
| Module | `ke-module` | 有 |
| Note / Knowledge Block | `ke-note` | 有 |
| Footnote | `ke-footnote`（行内） | 有 |

## 3. 发现的问题与修复

### 3.1 视频语义双表示（架构级，已修复）

- **现象**：同一"视频"语义存在两种节点表示——工具栏上传视频插入 `attach`（type=`video`），而 `video` 节点仅作兼容解析。Document Model 职责不清晰，Phase 3 扩展视频能力时无法确定目标节点。
- **修复**：`EditorToolbar.onPickFile` 中视频统一插入 `video` 节点（与 spec 3.4 `ke-video` 标准一致）；`attach` 仅承载 image/file。`attach` type=`video` 的**解析兼容保留**（既有文档不破坏）。
- **影响文件**：`frontend/src/components/editor/EditorToolbar.tsx`

### 3.2 Module 复制路径 params 丢失（实现缺陷，已修复）

- **现象**：`ModuleExtension.parseHTML` 将 `data-params` 读为字符串而非对象，且 `renderHTML` 不输出 `data-params`，复制粘贴场景下模块参数丢失/类型错误。
- **修复**：`parseHTML` 对 `data-params` 做 `JSON.parse`（非法 JSON 容错为 null）；`renderHTML` 补输出 `data-params`。
- **影响文件**：`frontend/src/editor/extensions/ModuleExtension.ts`

### 3.3 代码块无往返测试（测试缺口，已修复）

- 新增 2 条用例：带语言代码块 ` ```ts ` 解析/往返、无语言代码块往返保留空语言。
- **影响文件**：`frontend/src/editor/markdown-roundtrip.test.ts`

### 3.4 spec 文档节点命名不一致（文档，已修复）

- spec 第 201 行映射表将 `ke-attach` 映射为 `attachment`，实际节点名为 `attach`。
- **影响文件**：`docs/markdown-extension-spec.md`

## 4. 验证结果

- 测试：`npx vitest run` → **14/14 通过**（原 12 + 新增 2）
- 类型检查：`npx tsc -b` → 退出码 0
- 构建：`npm run build` → 成功（`dist/assets/index-*.js`，仅既有 chunk 体积警告）

## 5. 遗留备注（非阻塞，Phase 3 可选项）

| 项 | 说明 |
| --- | --- |
| 参考栏误判边界 | Footnote 参考栏检测依据 `## 参考` 标题，若正文恰有同名标题会被误判；低概率，Phase 3 可加唯一性校验 |
| note 文本渲染 | `note.text` 按纯文本展示，spec 允许 Markdown 渲染；属显示层增强，不影响 Document Model |
| 视频节点能力 | `video` 节点 v1 仅本地引用与展示，无参数编辑 UI；Phase 3 若扩展视频参数，直接作用于 `video` 节点（已统一） |
