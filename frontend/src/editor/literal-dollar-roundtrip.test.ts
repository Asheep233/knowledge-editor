/**
 * task-69 M04（外部复审 2026-10-10，P2，真实 UI 确认）：**显式字面 `$` 在保存/KE 往返后被重新激活为公式**。
 *
 * 现象（case-math-38/39）：
 *   输入 `前 \$x\$ 后` → 首次解析 math=**0**（正确：文本 `前 $x$ 后`）
 *   → 保存（`getMarkdown()`）输出 `前 $x$ 后`（**转义丢失**）
 *   → KE 导出再导入 → math=**1**（字面美元被当成公式激活）→ **用户语义被改写**
 *
 * 根因：`@tiptap/markdown` 的文本转义集合 `([\\`*_[\]~])` **不含 `$`**；而本仓的行内公式
 * tokenizer 把 `$…$` 当公式 → 文本节点里的字面 `$` 必须转义，否则往返后语义变化。
 * （与「行内 `\tag` 属上游 KaTeX 限制」「货币歧义属观察项」区分：本条是**已确认的语义改变**。）
 *
 * 修法：在 `keEscapeMarkdownSyntax`（task-67 已收口的转义策略）里**把 `$` 纳入转义集合**
 * —— 公式**节点**的 `$…$` 由 MathExtension.renderMarkdown 产出，不经过文本转义，故不受影响；
 * 只有文本节点里的字面 `$` 被转义（这正是必需的保护）。
 *
 * 已知一次性归一（登记）：孤立的 `$`（如 `价格 $5`）在文本里也会被转义 → `价格 \$5`；
 * 渲染语义不变、之后稳定（不累积），且**杜绝了「日后与别的 `$` 配对成公式」的激活风险**。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { keEscapeMarkdownSyntax } from './markdown-escape'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'

const EXT = [
  StarterKit,
  MathExtension,
  MathBlockExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

interface Parsed {
  math: number
  texts: string[]
  back: string
}
function parse(md: string): Parsed {
  const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
  let math = 0
  const texts: string[] = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'math' || n.type.name === 'mathBlock') math++
    if (n.isText) texts.push(n.text ?? '')
    return true
  })
  const back = ed.getMarkdown()
  ed.destroy()
  return { math, texts, back }
}

describe('task-69 M04：字面 `$` 不得在往返后被激活为公式', () => {
  it('T1 首次解析：`前 \\$x\\$ 后` → math=0，文本保留 `$x$`（既有行为，守护）', () => {
    const r = parse('前 \\$x\\$ 后\n')
    expect(r.math, '显式转义的字面美元不得成为公式').toBe(0)
    expect(r.texts.join('')).toContain('$x$')
  })

  it('T2 保存后字节不变：`前 \\$x\\$ 后`（当前红：输出丢转义）', () => {
    expect(parse('前 \\$x\\$ 后\n').back).toBe('前 \\$x\\$ 后')
  })

  it('T3 再导入不得激活：保存产物重新解析仍 math=0（当前红：激活成 1）', () => {
    const once = parse('前 \\$x\\$ 后\n').back
    const twice = parse(`${once}\n`)
    expect(twice.math, `保存产物重解析被激活成公式：${JSON.stringify(once)}`).toBe(0)
    expect(twice.back, '二次往返必须稳定').toBe(once)
  })

  it('T4 多个字面 `$`（case-math-39）同样不激活、字节稳定', () => {
    const src = '前 \\$x\\$ 和 \\$y\\$ 后\n'
    const once = parse(src).back
    expect(once).toBe('前 \\$x\\$ 和 \\$y\\$ 后')
    expect(parse(`${once}\n`).math).toBe(0)
  })

  it('T5 契约守护：真公式仍是公式（节点产出 `$…$`，不受文本转义影响）', () => {
    const r = parse('前 $x^2$ 后\n')
    expect(r.math).toBe(1)
    expect(r.back, '真公式往返字节一致').toBe('前 $x^2$ 后')
    expect(parse(`${r.back}\n`).math).toBe(1)
  })

  it('T6 契约守护：行内公式与字面美元混排各自保持', () => {
    const src = '真 $a+b$ 与字面 \\$c\\$ 混排\n'
    const once = parse(src).back
    expect(once, `混排往返：${JSON.stringify(once)}`).toBe('真 $a+b$ 与字面 \\$c\\$ 混排')
    const twice = parse(`${once}\n`)
    expect(twice.math, '只有一个真公式').toBe(1)
  })

  it('T7 转义函数级：**只有能激活公式的 `$`** 才转义（精确判定，非无差别）', () => {
    // 能激活 → 必须转义（否则往返后被当成公式）
    expect(keEscapeMarkdownSyntax('$x$')).toBe('\\$x\\$')
    expect(keEscapeMarkdownSyntax('$ x$')).toBe('\\$ x\\$')
    expect(keEscapeMarkdownSyntax('前 $a+b$ 后')).toBe('前 \\$a+b\\$ 后')
    // 不能激活 → 保持原样（改写字节才是缺陷；task-61 的 `$$` 契约也在这里）
    expect(keEscapeMarkdownSyntax('$$')).toBe('$$')
    expect(keEscapeMarkdownSyntax('价格 $5')).toBe('价格 $5')
    expect(keEscapeMarkdownSyntax('$x $')).toBe('$x $')
    expect(keEscapeMarkdownSyntax('a$$b')).toBe('a$$b')
    // 已有契约不变：`_` 词内仍放行、`*`/反引号等仍转义
    expect(keEscapeMarkdownSyntax('a_b')).toBe('a_b')
    expect(keEscapeMarkdownSyntax('a*b*c')).toBe('a\\*b\\*c')
  })

  it('T8 契约守护（task-61）：字面空 `$$` 块读入→保存字节不变（无差别转义会打红本条）', () => {
    const md = '正文\n\n$$\n\n$$\n\n结尾\n'
    expect(parse(md).back, '字面 `$$` 不得被转义').toBe('正文\n\n$$\n\n$$\n\n结尾')
  })
})
