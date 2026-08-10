# KnowledgeEditor 依赖兼容性手册

状态：以 `frontend/package.json` 实测为准（2026-08-09 记录）
用途：记录关键依赖版本、内部机制依赖与升级测试要求。升级任何关键依赖前必须阅读本文档。

## 1. 关键依赖版本

### 1.1 运行时依赖

| 包名 | 版本约束 | 说明 |
| --- | --- | --- |
| `@tiptap/starter-kit` | ^3.29.2 | 基础节点与标记（**不含 image**，见 2.4） |
| `@tiptap/markdown` | ^3.29.2 | Markdown ↔ ProseMirror 双向转换核心 |
| `marked` | ^17.0.1（约束），实测 17.0.6 | `@tiptap/markdown` 内部依赖，tokenizer 机制基石 |
| `@tiptap/react` | ^3.29.2 | 编辑器 React 绑定 |
| `@tiptap/pm` | ^3.29.2 | ProseMirror 运行时 |
| `@tiptap/extension-image` | ^3.29.2 | 标准 `![]()` 图片（Phase 3 新增） |
| `@tiptap/extension-placeholder` | ^3.29.2 | 占位提示 |
| `@tiptap/extension-table` | ^3.29.2 | 表格节点 |
| `@tiptap/extension-table-cell` | ^3.29.2 | 表格单元格 |
| `@tiptap/extension-table-header` | ^3.29.2 | 表头单元格 |
| `@tiptap/extension-table-row` | ^3.29.2 | 表格行 |
| `katex` | ^0.18.2 | 公式渲染 |
| `@types/katex` | ^0.16.8 | KaTeX 类型 |
| `mathlive` | ^0.110.0 | 公式编辑器 |
| `react` / `react-dom` | ^19.1.0 | UI 框架 |

### 1.2 开发时依赖

| 包名 | 版本约束 | 说明 |
| --- | --- | --- |
| `typescript` | ~5.8.0 | 类型检查（`tsc -b`） |
| `vite` | ^6.3.5 | 构建与开发服务器 |
| `vitest` | ^4.1.10 | 测试运行器 |
| `happy-dom` | ^20.11.2 | 测试 DOM 环境 |
| `tailwindcss` | ^4.1.0 | 样式 |
| `@tailwindcss/vite` | ^4.1.0 | Tailwind Vite 插件 |
| `@vitejs/plugin-react` | ^4.5.0 | React 插件 |
| `@types/react` / `@types/react-dom` | ^19.1.0 | React 类型 |

## 2. 内部机制依赖

以下行为由 @tiptap/markdown 与 marked 的内部实现决定，是扩展正确性的前提。升级相关依赖时必须逐项回归。

| # | 机制 | 影响 | 失效后果 |
| --- | --- | --- | --- |
| 1 | `marked.use()` 注册 tokenizer 采用 unshift 语义，后注册的先执行 | 扩展数组中 fallback 必须最先注册（最后执行），具体 ke-* tokenizer 优先 | fallback 抢占已知 kind，节点退化为纯文本 |
| 2 | marked block 级自定义 tokenizer 在每个 block 循环直接调用 `tokenize`，不先校验 `start` | 各 tokenizer 的 `tokenize` 内部必须自行校验前缀（如 `footnotesBlockTokenizer`） | tokenizer 误吞整篇文档或任意位置内容 |
| 3 | 解析器 `extractAbsorbedBlankLines` + `createImplicitEmptyParagraphsFromSpace` 将块间多余空行解析为空段落 | 块级节点 `renderMarkdown` 不得自带首尾 `\n`，块间距由 doc 级 `\n\n` 分隔符统一输出 | 每次往返 +2 空行，格式漂移 |
| 4 | StarterKit v3 选项表不含 `image` 键（无 image 扩展） | 图片能力完全由 `@tiptap/extension-image` 提供 | 标准 `![]()` 往返退化为纯文本 |
| 5 | @tiptap/markdown 无内置 image handler | `ImageMarkdownExtension` 必须保留注册 | 图片丢失 |
| 6 | React 19 + @tiptap/react 3.x 的 nodeView 同步渲染约定 | `FootnotesExtension` 等使用同步 `ReactNodeViewRenderer` | 异步 nodeView 初始化时序问题 |

## 3. 升级测试要求

### 3.1 必跑测试（升级后必须全绿）

```powershell
npx vitest run          # 29 个用例全绿（phase3-roundtrip 15 + markdown-roundtrip 12 + 其他 2）
npx tsc -b              # 类型检查通过
npm run build           # 生产构建成功
```

### 3.2 重点回归用例

升级 `@tiptap/markdown`、`marked`、`@tiptap/starter-kit`、`@tiptap/extension-*` 系列时，`phase3-roundtrip.test.ts` 中以下用例是机制正确性的直接验证：

| 用例 | 验证点 |
| --- | --- |
| 完整文档往返与零漂移（`back2 === back1`） | 机制 1/2/3：全部节点混合 + 任意次往返输出一致 |
| 相邻 ke-* 块标记（attach/video/module 连续） | 机制 3：块间距稳定，无空行累积 |
| 未知标记多次往返不漂移 | 机制 1：fallback 优先级 + 负向前瞻 |
| 脚注区域往返不重复生成 | 机制 2：tokenize 前缀校验 |
| 链接与图片往返 | 机制 4/5：image handler |

`markdown-roundtrip.test.ts` 保持历史行为回归（含 `insertFootnote` 节点维护）。

### 3.3 手动验证清单

升级后除自动化测试外，按以下顺序手动验证：

1. 用第 3 节示例文档（`docs/document-format.md`）导入编辑器，逐节点确认渲染
2. 保存 → 重新打开，确认内容一致、frontmatter 为 `ke_version: 1` 且不叠加
3. 工具栏插入表格 / 插入脚注引用，确认编号递增、脚注区域唯一
4. 编辑器内连续放置附件 / 视频 / 模块三个节点，保存再打开，确认块间空行为单个空行

### 3.4 升级流程

1. 在 `frontend/package.json` 调整版本约束并 `npm install`
2. 运行 3.1 全部命令
3. 通过后执行 3.3 手动清单
4. 全部通过后更新本文档第 1 节版本记录与日期
5. 任一用例失败：回滚依赖版本，并对照第 2 节机制表定位行为变化

### 3.5 已知版本风险

- `marked` 由 `@tiptap/markdown` 间接引入，锁定期限内建议跟随其约束范围（^17.x）；跨大版本（18.x）必须重新验证机制 1/2
- `@tiptap` 系列 8 个包必须保持同一大版本（3.x）同步升级，混用版本会导致 schema 冲突
- `react` 19 与 `@tiptap/react` 3.x 需同步；若升级 react 大版本，nodeView 渲染约定（机制 6）需重新验证
