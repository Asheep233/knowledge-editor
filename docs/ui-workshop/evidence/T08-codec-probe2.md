# T08 第二阶段证据：product 扩展的 DOM 依赖分层（纯 Node 无 DOM）

- 日期：2026-10-19 · 环境：WSL Node 24，**纯 Node（无 happy-dom/window）**
- 代码：`docs/ui-workshop/core/codec/probe2.ts` + `run_probe2.sh`（esbuild `--platform=node --jsx=automatic`，
  chunked dynamic import 逐个加载 product 扩展模块）
- 原始结果：`evidence/T08-codec-probe2.json`
- 目的：T08 的「可无 DOM 使用的 schema/转换边界」——对 product 扩展逐模块做 import/parse/serialize 分类

## 实测结果（10 类结构）

| 结构（product 扩展） | import | parse/serialize | 关键 token 保留 | 说明 |
| --- | --- | --- | --- | --- |
| KeDocument / KeBlockquote | ✅ | ✅ | `>`、正文 ✅ | 无 DOM 依赖 |
| ListExtension（括号有序列表/KeListItem） | ✅ | ✅ | 甲 ✅；`1)` ❌→规范化为 `1.` | 序列化按产品规范输出，括号形态不保留（需在 T08 声明为「规范化」而非字节稳定） |
| Math / MathBlock / MathIdUniqueness | ✅ | ✅ | `$E=mc^2$`、`$$` ✅ | **不需要 DOM/KaTeX 渲染**即可 parse/serialize（NodeView 只在 UI 层） |
| NoteExtension（ke-note） | ✅ | ✅ | `ke-note`、内容 ✅ | 无 DOM 依赖 |
| Footnote / Footnotes | ✅ | ✅ | `[^1]`、注释内容 ✅ | 无 DOM 依赖 |
| TableMarkdown / GfmTableFallback（+ @tiptap/extension-table 基础节点） | ✅ | ✅ | 表格结构保留；单元格对齐空格规范化（`| a   | b   |`）、输出前导 `\n` | 需显式提供 Table/TableRow/TableCell/TableHeader 基础节点；**无 window 依赖** |
| GenericFallback（未知 ke-*） | ✅ | ✅ | `ke-unknown` ✅ | 无 DOM 依赖 |
| HtmlPassthrough | ✅ | ✅ | `<div`、raw ✅ | 无 DOM 依赖 |
| Attachment / Video / Module | ✅ | ✅ | `ke-attach`、src ✅ | 无 DOM 依赖 |
| ImageMarkdown | ✅ | ✅ | `![示例]`、src ✅ | 无 DOM 依赖 |

## 结论（T08 边界）

1. **product 扩展在纯 Node 下可 import + parse + serialize**，前提：
   - esbuild/打包侧使用 **`--jsx=automatic`**（否则 JSX 转译引用全局 React 会报 `React is not defined`）；
   - 显式引入基础表格节点（`@tiptap/extension-table*`），否则 `tableRow` 节点缺失导致 parse 失败；
   - 关闭/忽略 UI 层 NodeView 渲染（headless Editor 不创建 view，NodeView 不执行）。
2. **DOM-free codec 的边界可行**：Math/Note/Footnote/HTML/未知/附件/图片等保真规则都在 extension 的
   markdownTokenizer/renderMarkdown 内，**不依赖 DOM**；UI 层（React NodeView/MathLive/KaTeX 渲染）与 codec 解耦。
3. **需要声明为「规范化」而非字节稳定**：括号有序列表 → `.` 列表、GFM 表格对齐空格/前导换行；
   T08 需以 **product 保存管线**为基准（frontmatter/BOM/CRLF 原字符串 traits + canonical Markdown）建立
   fixtures 字节台账，避免把 canonical 化误判为保真缺陷。
4. 下一步（T08 收尾）：对 `docs/ui-workshop/fixtures/*` 跑 product **保存管线**（`markdownForSave`/`withFrontmatter`/
   `applyDocTraits`）的 roundtrip 字节台账，并把 `frontmatter/BOM/CRLF/未知标记` 规则提取为无 DOM 纯函数边界。
