# T08 声明：codec canonical 化规则与 roundtrip 稳定性

> 依据：`docs/ui-workshop/evidence/T08-roundtrip-ledger.json`（纯 Node / headless 镜像产品 WYSIWYG 保存链，
> 产品链见 `frontend/src/components/layout/EditorArea.tsx` 保存段：`frontmatterBlockOf` + `getMarkdown` +
> `withFrontmatter` + `applyDocTraits`）。
>
> 验收口径（T08）：「真实样本按**字节**或**本文件声明的规范**往返」。下列 canonical 化规则即「已声明规范」。

## 声明规则

| # | 规则 | 说明/来源 |
| --- | --- | --- |
| R1 | **frontmatter `ke_version` 作为首键写入/更新** | `ke.ts::withFrontmatter` 既有行为；字段集合与顺序（除 ke_version 外）保持 |
| R2 | **文件末尾换行规范化** | serializer 不保留尾部多余换行；保存后为单一结尾 |
| R3 | **列表/表格 canonical 格式** | 括号有序列表 `1)` → `1.`；GFM 表格单元格补对齐空格、表格块前导换行 |
| R4 | **BOM/CRLF 由 DocTraits 还原** | 保存边界 `applyDocTraits(captureDocTraits(raw))`；CRLF 文档不写回 LF |
| R5 | **未知 `ke-*` 标记原样保留** | GenericFallback/HtmlPassthrough；ledger 中 `keTokens.kept=true` |
| R6 | **一次性空行规范（未知 HTML 相邻场景）** | 首次保存可能在 `ke-unknown` 注释与未知 HTML 块之间归并空行；**第二次保存起字节稳定**（ledger `fixedPoint2=true`） |

## 稳定性结论（ledger 实测）

- 8 个样本（fixtures basic/256KB/512KB + frontmatter-custom/CRLF/BOM/unknown-ke/math-sqrt）：
  - 首次保存与原始输入的差异均可由 R1–R6 解释（frontmatter 键序、尾部换行、列表/表格 canonical、空行规范）；
  - **第二次保存与第三次保存字节一致（fixedPoint2 = true，8/8）** → 达到保存不动点；
  - CRLF/BOM 样本经 traits 还原后换行/BOM 保持；未知 token（ke-note/ke-unknown/ke-attach 等）保留。
- 因此 codec 的「稳定往返」定义为：**首存按 R1–R6 canonical 化，此后 save→save 字节稳定**；与产品既有行为一致。

## 边界结论（无 DOM codec API 约束）

| 约束 | 证据 | 处理 |
| --- | --- | --- |
| `editor.commands.setContent(md, {contentType:'markdown'})` 在纯 Node 下走 `elementFromString`（需要 DOM） | probe3 首次实现报 `there is no window object available` | DOM-free 调用方使用 **构造函数 content** 或 `MarkdownManager.parse/serialize`；Core 的 setContent 只在 EditorSession（有 DOM）内 |
| product 扩展可无 DOM import/parse/serialize（需 esbuild `--jsx=automatic` + 显式 table 基础节点） | `T08-codec-probe2.md` 10/10 结构 | 提取 codec 时代码组织保持 extension 的 markdownTokenizer/renderMarkdown 分层，不引入 React NodeView |
| `markdownForSave` 的「空 mathBlock 清理」需要 EditorView.dispatch（session 层） | `editor/math/emptyBlocks.ts` 实现 | 空块清理归 EditorSession/SaveCoordinator；DOM-free codec 只负责 serializer + frontmatter/traits |
| `frontmatter/BOM/CRLF` 规则在 `editor/ke.ts`，纯函数、无 DOM | ke.ts 无运行时 imports；probe3 直接调用 | 已可提取为 DOM-free 共享模块（T10 Core 直接引用） |

## 验证命令

```bash
bash docs/ui-workshop/core/codec/run_probe3.sh     # 生成 ledger
bash docs/ui-workshop/core/codec/run_probe2.sh     # product 扩展分层
bash docs/ui-workshop/core/codec/run_probe.sh      # 基础 headless 可行性
```
