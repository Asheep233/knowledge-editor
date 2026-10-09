/**
 * task-67：Markdown **文本转义策略**的在仓收口（I2「往返必须字节等价」）。
 *
 * 背景（task-66 语料级发现）：`@tiptap/markdown` 的序列化器对非代码文本做**无差别**转义：
 *   `MarkdownManager.encodeTextForMarkdown()` → `escapeMarkdownSyntax(text)`
 *   = `text.replace(/([\\`*_[\]~])/g, '\\$1')`
 * 于是普通段落里的下划线被改写成 `\_`：
 *   `SOURCE_BASELINE_OLD` → `SOURCE\_BASELINE\_OLD`；`a_0 + b_i` → `a\_0 + b\_i`
 * → **打开一次就改写用户 Markdown 字节**（数学笔记里 `_` 极常见）。
 *
 * 判定（为什么只有 `_` 可以放行）：
 * - `*`：CommonMark 里**词内也可成强调**（`a*b*c` → 强调）→ 必须转义；
 * - `` ` ``：可开代码段 → 必须转义；`[`：可开链接/引用 → 转义（保守）；
 * - `~`：GFM 里 `~~` 成删除线 → 转义（保守）；`\`：反斜杠本身是转义引导符 → 必须转义；
 * - **`_`**：CommonMark 的 `_` 强调要求分隔符「left-flanking 且非 right-flanking（或前为标点）」，
 *   而**词内 `_`（左右都是字母/数字）两条都不满足** → 既不能开也不能闭强调 → **纯粹字面量，
 *   无需转义**。转义它只会改写用户字节。
 *   实测：`a_b`→文本 `a_b`→旧回退 `a\_b`（字节变化）；`_x_` 则被解析为**强调节点**（不是文本节点，
 *   走的是 mark 的渲染路径，不受本策略影响）。
 *
 * 已知例外（登记，不静默）：源码里**用户自己写的转义** `a\_b` 解析后文本为 `a_b`（转义信息在
 * 解析期丢失），因此本策略会把它**一次性归一**为 `a_b`；两形态渲染语义等价，且归一后稳定
 * （不会反复改写）。用例 `text-escape-roundtrip.test.ts::T9` 锁定。
 *
 * 实现方式：`@tiptap/markdown` 导出 `MarkdownManager`，我们在 `Markdown` 扩展的 `onCreate`
 * 里**只替换实例的 `escapeMarkdownSyntax`**（最小侵入；其余解析/序列化行为完全不变）。
 * 上游若修复，删掉本文件的 patcher 即可。
 */
import { MarkdownManager } from '@tiptap/markdown'

/** 需要反斜杠转义的 Markdown 行内语法字符（与上游同一集合） */
const ESCAPE_CHARS = /([\\`*_[\]~])/g

/** 是否为「词字符」（字母/数字，含 CJK）——用于判定 `_` 是否处于词内 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

/** `text[offset]` 位置的 `_` 是否**词内**（左右都是字母/数字）→ 惰性、无需转义 */
function isIntraWordUnderscore(text: string, offset: number): boolean {
  return isWordChar(text[offset - 1]) && isWordChar(text[offset + 1])
}

/**
 * 文本节点 → Markdown（转义策略）。
 * 除「词内 `_`」外与上游 `escapeMarkdownSyntax` 完全一致（其余字符照旧转义）。
 */
export function keEscapeMarkdownSyntax(text: string): string {
  return text.replace(ESCAPE_CHARS, (match, ch: string, offset: number) => {
    if (ch === '_' && isIntraWordUnderscore(text, offset)) return match
    return `\\${ch}`
  })
}

interface EscapePatchTarget {
  escapeMarkdownSyntax?: (text: string) => string
}

/**
 * 接管文本转义策略（幂等）。
 *
 * 为什么是原型补丁：`@tiptap/markdown` 只导出 `MarkdownManager` 类，没有暴露「转义策略」配置项；
 * 而 tiptap v3 对 `Extension` 只调用 `onBeforeCreate`（实测 `onCreate` 不触发），
 * 用 `extend({ onBeforeCreate })` 又会**顶掉**上游给 manager 接线的那个 onBeforeCreate。
 * 故这里直接替换 `MarkdownManager.prototype.escapeMarkdownSyntax`（全局一次、幂等、
 * 只改这一个方法；解析/序列化其余行为完全不变）。
 */
export function installKeTextEscape(): boolean {
  const proto = MarkdownManager.prototype as unknown as EscapePatchTarget
  if (typeof proto.escapeMarkdownSyntax !== 'function') return false
  proto.escapeMarkdownSyntax = keEscapeMarkdownSyntax
  return true
}

/** 是否已接管（供测试/诊断） */
export function isKeTextEscapeInstalled(): boolean {
  const proto = MarkdownManager.prototype as unknown as EscapePatchTarget
  return proto.escapeMarkdownSyntax === keEscapeMarkdownSyntax
}

// 模块加载即接管：`editor/index.ts` 静态 import 本模块 → 生产路径必然生效；
// 测试只要 import 本模块（哪怕只为拿 keEscapeMarkdownSyntax）也与生产同构。
if (!installKeTextEscape()) {
  // 不静默降级：上游结构变化时给出显式告警（会退回上游行为，I2 问题重现）
  console.error('[ke-markdown] 未能接管文本转义策略（@tiptap/markdown 的 MarkdownManager 结构变化？）')
}
