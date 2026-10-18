# T08 证据：product 保存管线 roundtrip 字节台账（headless / 纯 Node）

- 日期：2026-10-19 · 环境：WSL Node 24（无 DOM）
- 代码：`docs/ui-workshop/core/codec/probe3.ts` + `run_probe3.sh`
- 原始数据：`evidence/T08-roundtrip-ledger.json`
- 被测链路（镜像产品 WYSIWYG 保存）：`frontmatterBlockOf(raw)` + headless `getMarkdown()` →
  `withFrontmatter(…, KE_VERSION)` → `applyDocTraits(captureDocTraits(raw))`

## 台账（8 样本）

| 样本 | 输入字节 | 首次保存 | inputEqual | fixpoint1 | **fixpoint2** | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| basic.md（全特性 fixtures） | 890 | 1076 | ❌ | ❌（未知 HTML 邻接空行一次性归并） | **✅** | R1/R2/R3/R6 |
| large-256kb.md | 262,260 | 262,196 | ❌ | ✅ | **✅** | R1/R2/R3 |
| large-512kb.md | 524,342 | 524,214 | ❌ | ✅ | **✅** | R1/R2/R3 |
| frontmatter-custom | 75 | 74 | ❌ | ✅ | **✅** | R1（ke_version 首键）/R2 |
| crlf | 45 | 58 | ❌ | ✅ | **✅** | R1 + R4（CRLF 还原） |
| bom | 40 | 53 | ❌ | ✅ | **✅** | R1 + R4（BOM 还原） |
| unknown-ke | 55 | 68 | ❌ | ✅ | **✅** | R1 + R5（未知标记保留） |
| math-sqrt | 96 | 109 | ❌ | ✅ | **✅** | R1/R2 |

- `fixpoint2 = save(save(x)) === save(save(save(x)))`：**8/8 为 true** → 保存不动点稳定。
- 首次保存差异全部可由 `CANONICAL-RULES.md` R1–R6 解释；不属于保真缺陷。
- 未知 token 保留：basic.md `ke-note/ke-unknown` ✅；unknown-ke `ke-unknown` ✅。

## 结论

T08 的「字节或声明规范往返」成立：规范见 `core/codec/CANONICAL-RULES.md`；同时产出无 DOM codec 的 API 边界
（构造函数/MarkdownManager vs 需 DOM 的 setContent；空块清理归 session；ke.ts traits 纯函数可提取）。
