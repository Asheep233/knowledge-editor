# Phase 3 报告：Markdown-first 文档系统完善

日期：2026-08-09

## 一、修改内容

### 1. Markdown 双向转换完善（基础语法 + KE 节点）

**新增表格支持**：新建 `src/editor/extensions/TableMarkdownExtension.ts`，为 `@tiptap/extension-table` 系列补齐 `markdownTokenName` / `parseMarkdown` / `renderMarkdown`，并新增 `tableTokenizer`（GFM 风格，校验表头 + 分隔行）。工具栏新增「▦ 表格」按钮，插入 3×3 带表头表格。

**新增图片支持**：新建 `src/editor/extensions/ImageMarkdownExtension.ts`，基于 `@tiptap/extension-image`（v3，已安装）补齐标准 `![alt](src)` 的双向转换。此前 @tiptap/markdown 无内置 image handler，图片往返会退化为纯文本。`editor/index.ts` 中 StarterKit v3 本身不含 image 扩展，无需额外禁用。

**零漂移修复（本阶段核心）**：所有块级 KE 节点的 `renderMarkdown` 去掉自带的首尾 `\n`，由 @tiptap/markdown 的 doc 级 `\n\n` 分隔符统一管理块间距。受影响节点：`attach`、`video`、`module`、`note`、`footnotes`、`keFallback`、`mathBlock`。

漂移根因：`renderMarkdown` 返回 `\n<!-- ke-xxx -->\n`，经 doc 分隔符拼接后块间出现 4 个换行；解析时 `extractAbsorbedBlankLines` 提取尾部空白为 space token，`createImplicitEmptyParagraphsFromSpace` 将其解析为**空段落节点**，再次序列化时每个空段落多输出 `\n\n`，每轮往返 +2 空行。修复后块间恰好 1 空行，解析产生 0 个空段落，任意次往返输出完全一致。

### 2. 未知扩展兼容（GenericFallbackNode）

新建 `src/editor/extensions/GenericFallbackExtension.ts`：

- `keFallback`（块级 atom）：遇到未知 `ke-*` 标记时保留原始 Markdown，不报错、不删除，保存时原样输出。
- `keFallbackInline`（行内）：段落中出现的未知 `ke-*` 注释原样保留。

配套 tokenizer（`src/editor/tokenizers.ts`）：`keFallbackTokenizer` / `keFallbackInlineTokenizer` 使用负向前瞻排除已知 kind（`note|module|attach|video|footnote`），kind 允许连字符与数字（如 `ke-future-block:`、`ke-x2:`），保证任意未来标记可保留。

**关键约束**：fallback 扩展必须放在扩展数组**最前面**。@tiptap/markdown 通过 `marked.use()` 注册 tokenizer，内部采用 unshift 语义（后注册的先执行），因此最先注册的 fallback 最后执行，具体 ke-* tokenizer 始终优先。

### 3. Footnote 系统优化

- 脚注列表成为 Document Model 中的独立块级节点 `footnotes`（`src/editor/extensions/FootnotesExtension.ts`），属性 `{ items: [{ id, n, text }] }`。
- Markdown 使用唯一标记区域：
  ```
  <!-- ke-footnotes:start -->
  <!-- ke-footnote-item: {"id":"f1","n":1,"text":"..."} -->
  <!-- ke-footnotes:end -->
  ```
- 新增 `footnotesBlockTokenizer`（tokenize 内做 start 前缀校验，防止误吞整篇文档）与 `src/components/editor/nodeviews/FootnotesNodeView.tsx`（可编辑条目、单条删除、删除整个区域）。
- `insertFootnote` 命令重写：不再扫描/生成 `## 参考` 标题，改为在文档末尾维护独立的 `footnotes` 节点；修复事务内位置偏移 bug（基于 `tr.doc` 重新定位，而非插入前的 `editor.state.doc`）。

### 4. InfoBlock 信息块优化

- 数据模型统一为通用 Callout：`{ id, created, updated, author, title, color, content }`，未引入 TheoremBlock/DefinitionBlock 等固定节点。
- `NoteExtension`：字段 `text` → `content`；`parseHTML` / `parseMarkdown` 兼容旧 `text` 字段（v0 文档自动迁移，保存后统一输出 `content`）。
- `NoteNodeView.tsx`：正文改为 `content` 字段，新增 5 色颜色选择器（blue / yellow / green / red / purple）。

### 5. 文档版本机制

- `src/editor/ke.ts` 新增：`KE_VERSION = 1`、`KE_FRONTMATTER_KEY = 'ke_version'`、`stripFrontmatter(md)`（解析 `---\nke_version: N\n---` 并剥离正文，无头时版本为 0）、`withFrontmatter(md, version)`（先剥离再包装，幂等）。
- `EditorArea.tsx`：加载时 `stripFrontmatter`，自动保存热路径 / Ctrl+S 保存时 `withFrontmatter(md, KE_VERSION)`。
- 版本号写入 Markdown YAML frontmatter，不依赖 SQLite / Document Model / 内存，文档移动后版本信息随正文保留。

### 6. 测试

新增 `src/editor/phase3-roundtrip.test.ts`（15 个用例），同步更新 `src/editor/markdown-roundtrip.test.ts` 至新架构（12 个用例）。详见「测试结果」。

## 二、数据结构变化

| 项目 | 变化 | 兼容性 |
| --- | --- | --- |
| `note` 节点 | 字段 `text` → `content` | 解析层兼容 v0 `text`，旧文档一次性迁移 |
| `footnotes` 节点（新） | `{ items: [{ id, n, text }] }`，独立块级 | 新节点；旧版「## 参考」栏不再生成 |
| `keFallback` / `keFallbackInline`（新） | `{ raw }` 保留原始标记 | 新节点；未知标记安全降级 |
| `table`（新） | 标准 GFM 表格（tableRow/tableCell/tableHeader） | 新节点 |
| 文档头部 | YAML frontmatter `ke_version: 1` | 编辑器加载时剥离，不进入 Document Model |
| Markdown 序列化 | 块级节点间由 doc 分隔符统一空行 | 手写文档中 2+ 空行会规范为 1 空行（与标准 Markdown 行为一致，首次保存后稳定） |

## 三、测试结果

| 验证项 | 结果 |
| --- | --- |
| `vitest run` 全套（7 个测试文件） | 38/38 通过 |
| 清理调试文件后 `vitest run` | 29/29 通过 |
| `phase3-roundtrip.test.ts`（含完整文档零漂移） | 15/15 通过 |
| `markdown-roundtrip.test.ts`（更新至新架构） | 12/12 通过 |
| `tsc -b` 类型检查 | 通过 |
| `npm run build` 生产构建 | 成功（5.55s） |

`phase3-roundtrip.test.ts` 覆盖：多级标题、粗体/斜体/删除线、无序/有序列表、引用、行内/块级公式、GFM 表格、图片、链接、附件、视频、Module、Footnote + footnotes 区域、InfoBlock、未知 ke-* 标记（块级 + 行内）、frontmatter strip/wrap 幂等、`insertFootnote` 节点维护，以及「全部节点混合文档」的三次往返零漂移断言（`back2 === back1 === back3`）。

调试中发现并修复的 5 个关键问题：

1. footnotes 区域 tokenizer 会吞掉整篇文档（block tokenizer 无 start 校验）→ tokenize 内增加前缀防御检查。
2. fallback 抢占已知 kind（unshift 语义 + 正则过宽）→ `KE_KNOWN_KINDS` 负向前瞻 + fallback 移到扩展数组最前。
3. `insertFootnote` 的 `setNodeMarkup(fPos)` 在引用插入后位置偏移 → 基于 `tr.doc` 重新定位。
4. 标准图片 `![]()` 序列化后退化为纯文本 → 新增 `ImageMarkdownExtension` 并安装 `@tiptap/extension-image`。
5. 相邻 ke-* 标记被贪婪正则 `[\s\S]*\}` 吞掉 → `matchBalancedJson`（带状态机的括号平衡匹配，正确处理字符串内 `{}` 与转义）。

## 四、当前风险

1. **空行规范化**：手写文档中块级节点之间 2 个以上空行，首次保存会被规范为 1 个空行；之后任意次往返输出一致，不再漂移。此行为与标准 Markdown 的空白折叠一致，但若用户依赖多空行排版，需注意首次保存的格式变化。
2. **表格限制**：GFM 表格不支持合并单元格，`colspan` / `rowspan` 在往返中不保留，单元格按纯文本处理（已在 `markdown-extension-spec.md` 声明）。
3. **对 @tiptap/markdown 内部机制的强依赖**：marked tokenizer 的 unshift 注册顺序、block tokenizer 逐循环调用语义是当前正确性的前提。升级 @tiptap 或 marked 大版本时必须重新回归「相邻 ke-* 标记」「fallback 优先级」「零漂移」三组测试。
4. **`KE_KNOWN_KINDS` 维护成本**：未来新增 ke-* 节点类型时，必须同步更新 `tokenizers.ts` 中的 `KE_KNOWN_KINDS` 负向前瞻，否则新节点会被 fallback 以纯文本形式保留（安全降级，不丢数据，但失去结构化解析）。
5. **StarterKit 差异**：当前安装的 StarterKit v3 不含 image 扩展（选项表无 `image` 键），图片能力完全依赖固定版本的 `@tiptap/extension-image`，需保证 package.json 锁版本。
6. **frontmatter 约定**：`ke_version` 目前仅有约定，尚无写入 SQLite 索引或迁移逻辑；未来版本升级（v2 及以后）需建立「frontmatter 版本 → 迁移函数」映射。
