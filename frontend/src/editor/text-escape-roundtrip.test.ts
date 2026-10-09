/**
 * task-67（I2 违反：普通文本下划线被转义 → 打开即改字节）：**词内 `_` 不得被转义**。
 *
 * 现象（task-66 语料级发现的第二条「打开→保存改字节」路径）：
 *   `SOURCE_BASELINE_OLD` → `SOURCE\_BASELINE\_OLD`（每次打开都加反斜杠）
 *   数学笔记里的 `a_0`、`b_i`、`S_a` 同理 —— 用户内容被静默改写。
 *
 * 定位（`@tiptap/markdown` 的序列化器）：
 *   `MarkdownManager.encodeTextForMarkdown()`（非代码上下文）→
 *   `escapeMarkdownSyntax(text)` = `text.replace(/([\\`*_[\]~])/g, '\\$1')` —— **无差别**转义整组字符。
 *   该转义对 `*`（词内也可成强调）、反引号、`[`、`~` 是**有理由的防御**，但对 `_` 属于过度转义：
 *   CommonMark 里**词内 `_` 既不能开强调也不能闭强调**（左右两侧都是字母/数字 → 既非 left-flanking
 *   可开条件，也不满足 right-flanking 可闭条件），因此**无需转义**，转义只会改写用户字节。
 *
 * 本文件锁定：
 *   T1–T4 词内 `_`（ASCII / 多段 / CJK / 数学记号）→ 往返**逐字节一致**（当前红）
 *   T5–T8 契约守护：该转义的仍转义（`*`、反引号、`[`、`~`、`\`）、强调/代码语义不变
 *   T9 已知例外登记：`a\_b`（用户显式转义）→ 归一为 `a_b`（一次性，之后稳定）
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { Markdown } from '@tiptap/markdown'
// 导入本模块即接管转义策略（与生产同构：editor/index.ts 静态 import 它）
import { isKeTextEscapeInstalled, keEscapeMarkdownSyntax } from './markdown-escape'

const EXT = [StarterKit, Markdown.configure({ indentation: { style: 'space', size: 2 } })]

/** 生产等价往返：读入 → getMarkdown()（编辑器把首尾空行规范化，故比较 trim 后的正文） */
function roundtrip(md: string): string {
  const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
  const back = ed.getMarkdown()
  ed.destroy()
  return back
}

describe('task-67 T1–T4：词内下划线必须字节原样（I2）', () => {
  it('T0 转义策略已接管（防"补丁没生效却看着像通过"）', () => {
    expect(isKeTextEscapeInstalled()).toBe(true)
    const ed = new Editor({ extensions: EXT, content: 'a_b\n', contentType: 'markdown' })
    expect(keEscapeMarkdownSyntax('a_b')).toBe('a_b')
    ed.destroy()
  })

  it('T1 普通段落 `SOURCE_BASELINE_OLD`（审查最小复现）', () => {
    expect(roundtrip('SOURCE_BASELINE_OLD\n')).toBe('SOURCE_BASELINE_OLD')
  })

  it('T2 多段词内下划线 `a_b_c_d` 与 `my_var_name`', () => {
    expect(roundtrip('a_b_c_d\n')).toBe('a_b_c_d')
    expect(roundtrip('my_var_name 与 other_var\n')).toBe('my_var_name 与 other_var')
  })

  it('T3 CJK 词内下划线 `中_文`（CJK 属字母，同样惰性）', () => {
    expect(roundtrip('中_文\n')).toBe('中_文')
  })

  it('T4 数学记号 `a_0 + b_i = S_a`（数学笔记高频形态）', () => {
    const md = 'a_0 + b_i = S_a\n'
    expect(roundtrip(md)).toBe(md.trim())
  })

  it('T4b 长数学段落 + 行内公式相邻，逐字节一致', () => {
    const md = '设$a_0$与$a_1$，则$S_a$满足$a_n=b_i+c_j$，其中$d_k$为常数。\n'
    expect(roundtrip(md)).toBe(md.trim())
  })
})

describe('task-67 T5–T8：契约守护 —— 该转义的仍然转义、语义不变', () => {
  it('T5 `*` 的强调语义仍正确（`a*b*c` = a<em>b</em>c，往返字节一致）', () => {
    // 实测：marked 解析 `a*b*c` 为 `a<em>b</em>c` → 文档里 `b` 带 italic 标记 →
    // 序列化输出 `a*b*c`（强调定界符，不是转义形态）→ 字节一致且语义不变。
    const ed = new Editor({ extensions: EXT, content: 'a*b*c\n', contentType: 'markdown' })
    const italic: string[] = []
    ed.state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'italic')) italic.push(n.text ?? '')
      return true
    })
    const back = ed.getMarkdown()
    ed.destroy()
    expect(italic, '`*` 仍必须成强调（不得被当成字面量）').toEqual(['b'])
    expect(back).toBe('a*b*c')
  })

  it('T6 反引号 / `[` `]` / `~` 仍转义（防代码段、链接、删除线歧义）', () => {
    expect(keEscapeMarkdownSyntax('`x`')).toBe('\\`x\\`')
    expect(keEscapeMarkdownSyntax('[x]')).toBe('\\[x\\]')
    expect(keEscapeMarkdownSyntax('a~b')).toBe('a\\~b')
    expect(keEscapeMarkdownSyntax('a\\b')).toBe('a\\\\b')
  })

  it('T7 强调语义不变：`_x_` 仍解析为强调（不是字面文本），代码段内容不被转义', () => {
    const ed = new Editor({ extensions: EXT, content: '_x_ 与 `a_b`\n', contentType: 'markdown' })
    const marks: string[] = []
    let code = ''
    ed.state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'italic')) marks.push(n.text ?? '')
      if (n.type.name === 'codeBlock' || n.marks.some((m) => m.type.name === 'code')) code += n.text ?? ''
      return true
    })
    ed.destroy()
    expect(marks).toContain('x')
    expect(code).toBe('a_b')
  })

  it('T8 只有「左右都是词字符」的 `_` 放行；两侧任一非词字符仍转义（保守）', () => {
    expect(keEscapeMarkdownSyntax('_x')).toBe('\\_x') // 行首：可能开强调
    expect(keEscapeMarkdownSyntax('x_')).toBe('x\\_') // 行尾：可能闭强调
    expect(keEscapeMarkdownSyntax('a _ b')).toBe('a \\_ b') // 两侧空白
    expect(keEscapeMarkdownSyntax('中文_中文')).toBe('中文_中文') // 词内（CJK）
    expect(keEscapeMarkdownSyntax('(a_b)')).toBe('(a_b)') // 词内 → 惰性（实测重解析一致）
    expect(roundtrip('(a_b)\n')).toBe('(a_b)')
  })
})

describe('task-67 T8b：**已知例外**登记（其它字符的转义仍生效；I2 偏差已登记，未静默放宽）', () => {
  it('T8b-1 这些字符的“必需转义”保持不变（与上游同集合）', () => {
    // 反预期说明：以下转义**保留**，因为它们各自有真实的歧义风险；
    // 去除它们需要 CommonMark flanking 分析（`*`）或另有风险（`[`/反引号/`~`），
    // 故按 task-67 要求**登记为已知例外**（附最小样本），不在本单放宽。
    expect(keEscapeMarkdownSyntax('`x`')).toBe('\\`x\\`')
    expect(keEscapeMarkdownSyntax('[x]')).toBe('\\[x\\]')
    expect(keEscapeMarkdownSyntax('a~b')).toBe('a\\~b')
    expect(keEscapeMarkdownSyntax('a\\b')).toBe('a\\\\b')
  })

  it('T8b-2 已登记例外的最小样本（**实测值**；变化即需重新评估：修复 or 回归）', () => {
    // 下列形态**仍会改写字节**（I2 已知偏差，已登记）。它们不是本次要修的对象：
    // 字面 `*` 需要 CommonMark flanking 分析；`[`/反引号/`~`/`\`/`&` 的松绑各有歧义风险，
    // 需各自的最小复现 + 语料回归，按 task-67 要求**登记**而非默默放宽。
    expect(roundtrip('2 * 3\n')).toBe('2 \\* 3') // 字面 `*`（非强调位置）
    expect(roundtrip('a`b\n')).toBe('a\\`b') // 字面反引号（单只、不成代码段）
    expect(roundtrip('[x]\n')).toBe('\\[x\\]') // 方括号
    expect(roundtrip('a~b\n')).toBe('a\\~b') // 单个 `~`
    expect(roundtrip('a&b\n')).toBe('a&amp;b') // 实体编码（重解析后等价）
    expect(roundtrip('a\\b\n')).toBe('a\\\\b') // 反斜杠
    // 对照：**不需要**转义、且已字节一致的形态（防把正常路径也当例外）
    expect(roundtrip('`x`\n')).toBe('`x`') // 真代码段
    expect(roundtrip('~~x~~\n')).toBe('~~x~~') // 真删除线
    expect(roundtrip('a|b\n')).toBe('a|b') // 管道符（task-66 修复后）
  })

  it('T8b-3 另登记一条 I2 偏差：`_` 强调定界符被归一为 `*`（不同路径：mark 渲染，不在本单范围）', () => {
    // `_x_` 解析为 italic 标记 → 序列化时定界符统一用 `*`（不是文本转义路径）。
    // 语义不变、一次归一后稳定；松绑需改 mark 渲染口径，另有独立风险，故**登记**不修。
    expect(roundtrip('_x_\n')).toBe('*x*')
    expect(roundtrip('__x__\n')).toBe('**x**')
    expect(roundtrip('a _b_ c\n')).toBe('a *b* c')
    // 稳定性：归一后不再变化
    expect(roundtrip('*x*\n')).toBe('*x*')
    expect(roundtrip('**x**\n')).toBe('**x**')
  })
})

describe('task-67 T9：已知例外登记（用户显式转义的一次性归一）', () => {
  it('T9 `a\\_b`（源码里带转义）→ 归一为 `a_b`；归一后稳定（第二次往返不再变化）', () => {
    const once = roundtrip('a\\_b\n')
    expect(once, '显式转义被归一（一次性；渲染语义不变，两形态等价）').toBe('a_b')
    expect(roundtrip(`${once}\n`), '归一后必须稳定（不得反复改写）').toBe(once)
  })
})
