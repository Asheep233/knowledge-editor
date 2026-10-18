# T08 探针证据：headless（无 DOM）Markdown codec 边界

- 日期：2026-10-19 · 环境：WSL Node 24（**纯 Node，无 happy-dom/window**）
- 代码：`docs/ui-workshop/core/codec/probe.ts` + `run_probe.sh`（esbuild 打包 @tiptap/core +
  StarterKit + @tiptap/markdown，headless `new Editor({contentType:'markdown'})` 无 element）
- 原始结果：`evidence/T08-codec-probe.json`

## 实测结果

| 用例 | 无 DOM 可解析/序列化 | 字节一致 | 说明 |
| --- | --- | --- | --- |
| basic（含 frontmatter） | ✅ | ❌ | frontmatter 未识别（`---` 被当分隔线/标题）；需要 product frontmatter codec |
| list | ✅ | ❌ | 尾部换行差异（canonical 输出无末尾换行） |
| table | ❌ | — | `there is no window object available`（StarterKit/表格链在无 DOM 下抛错） |
| CRLF | ✅ | ❌ | 换行归一为 LF（符合产品 codec 行为，BOM/CRLF 需在保存边界保留，见 docTraits） |
| unknown ke-* comment | ✅ | ❌ | HTML 被转义（`&lt;!--`），需 product GenericFallback/HtmlPassthrough 扩展 |
| raw HTML | ✅ | ❌ | 同上被转义 |

## 边界结论（供 T08 任务实施）

1. **可无 DOM 使用的部分**：`@tiptap/markdown` 的 parse/serialize 主链在纯 Node 下可运行（basic/list/CRLF/未知 HTML 等）；
   这是提取 DOM-free codec 核心的可行起点。
2. **必须处理 DOM 依赖**：表格链在无 `window` 时抛错（`there is no window object available`）→
   T08 需定位具体依赖（extension 初始化/NodeView/DOM 解析器）并做成可注入的 shim 或按需惰性加载；
   不允许用「假装无 DOM」通过。
3. **必须引入产品扩展**：frontmatter、未知 `ke-*` 注释、原始 HTML、公式/脚注等保真规则在 product 扩展里
   （本探针仅 StarterKit，因此这些结构被规范化/转义）→ T08 的下一步是把 product 扩展按 DOM 依赖分层，
   提取 codec 需要的 markdownTokenizer/renderMarkdown 部分（不含 React NodeView）。
4. **BOM/CRLF 属于保存边界规则**（product docTraits），codec 内部归一是既有行为；
   DOM-free codec 需把 `BOM/CRLF/frontmatter 原字符串` 作为显式输入/输出 traits，保持 roundtrip 字节稳定。

## 下一步（T08 继续）

- 用 product 扩展集（GenericFallback/HtmlPassthrough/Math/Footnote/TableMarkdown…）构建第二版 headless harness，
  记录每个扩展的 DOM 依赖分类（可直接无 DOM / 需 shim / 必须 UI）；
- 对 `docs/ui-workshop/fixtures/*` 建立 roundtrip 用例（含 BOM/CRLF/未知标记），输出字节 diff 台账；
- 提取 `frontmatter/BOM/CRLF/未知标记` 的纯函数边界（可无 DOM 引用），并给出与现有 `docTraits` 的差异。
