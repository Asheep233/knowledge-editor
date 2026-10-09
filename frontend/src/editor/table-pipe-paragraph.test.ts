/**
 * task-66（v1.2.10 回归 · 用户实测「文档逐字一行」）：**含 `|` 的普通段落被拆成一字一行**。
 *
 * 症状（用户截图）：`由/于/满/足/题/意/的` 一列竖排；LaTeX 片段 `\aleph_0`、`$`、`[1]` 一字一行。
 *
 * 根因（本文件锁定的机制）：marked 的块级词法分析器用各**块级扩展 tokenizer 的 `start()`**
 * 作为「下一个块可能从哪里开始」的**截断提示**：
 *   ```js
 *   let i = e
 *   if (this.options.extensions?.startBlock) {
 *     let s = Infinity, a = e.slice(1)          // ← 注意 slice(1)
 *     this.options.extensions.startBlock.forEach(l => { const o = l(a); if (o >= 0) s = Math.min(s, o) })
 *     if (s < Infinity && s >= 0) i = e.substring(0, s + 1)   // ← 段落被截到 s+1 个字符
 *   }
 *   ```
 * 而 `tableTokenizer.start = (src) => (/^[^\n]*\|/.test(src) ? 0 : -1)`：只要**首行含 `|`** 就返回 0
 * → 段落被截成 **1 个字符**；marked 循环推进后再次命中 → 逐字符拆成多个 paragraph token，
 * `@tiptap/markdown` 把它们并成**一个含 `\n` 的文本节点**；编辑器正文 `white-space: break-spaces`
 * 把每个 `\n` 当换行 → **一字一行**。
 * 更糟：`getMarkdown()` 会把这种逐字形态**写回磁盘**（并追加转义），即"打开一次就被改坏"。
 *
 * 已核对的对照事实（防止误判）：
 *  - 与 **A10 的公式回退渲染无关**：真实文档里 `[data-ke-math-fallback]` 数量为 0，被拆的是**普通段落**；
 *  - 与「表格单元格塌陷」无关：这些段落里根本没有表格（`table` 元素数 0）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'

/** 与 App 相同的关键顺序：Markdown 最后注册（@tiptap/markdown 走 marked.use + unshift） */
const EXT = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  MathExtension,
  MathBlockExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function parse(md: string) {
  const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
  const texts: string[] = []
  ed.state.doc.descendants((n) => {
    if (n.isText) texts.push(n.text ?? '')
    return true
  })
  const tables = ed.state.doc.children.filter((c) => c.type.name === 'table').length
  const back = ed.getMarkdown()
  ed.destroy()
  return { texts, joined: texts.join(''), tables, back }
}
const hasHardNewline = (t: string) => t.includes('\n')

describe('task-66：含 `|` 的普通段落不得被拆成一字一行', () => {
  it('T1 最小复现：`abc|def` 必须是一个段落、文本不含硬换行', () => {
    const r = parse('abc|def\n')
    expect(r.tables, '不是表格（无表头+分隔行）').toBe(0)
    expect(r.texts, '不得被拆成 a / b / c / |def 多段').toEqual(['abc|def'])
    expect(hasHardNewline(r.joined), '文本里不得出现硬换行（它会被 break-spaces 渲染成逐字一行）').toBe(false)
  })

  it('T2 用户实测形态：`由于$|ω^ω|=\\aleph_0$，故` 整段保持一行文本', () => {
    const md = '由于$|ω^ω|=\\aleph_0$，故\n'
    const r = parse(md)
    expect(hasHardNewline(r.joined), `实测：${JSON.stringify(r.texts)}`).toBe(false)
    // 「由于」不得被拆开
    expect(r.texts.some((t) => t.includes('由于')), '前两字必须同属一个文本节点').toBe(true)
  })

  it('T3 长段落 + 行内 | 公式：段落不得逐字拆（用户截图 `因此，对于满足题意的…`）', () => {
    const md = '因此，对于满足题意的$a_i$组成的序列组成的集合$S_a$，显然$|S_a|≥\\aleph_0$，故$|S_a|≤\\aleph_0$。\n'
    const r = parse(md)
    expect(hasHardNewline(r.joined), `实测：${JSON.stringify(r.texts.slice(0, 6))}…`).toBe(false)
    expect(r.texts.length, '文本节点数应为个位数，而非逐字几十个').toBeLessThan(8)
  })

  it('T4 读入→立即保存不得把逐字形态写回磁盘（数据安全：打开一次不能改坏文件）', () => {
    const md = '由于$|ω^ω|=\\aleph_0$，故\n'
    const r = parse(md)
    expect(r.back.includes('\n由\n') || r.back.includes('由\n于'), `保存结果被拆行：${JSON.stringify(r.back)}`).toBe(false)
    // 关键内容仍完整（允许规范化，但不允许逐字拆行/加反斜杠转义）
    expect(r.back).toContain('由于')
    expect(r.back).toContain('|ω^ω|=\\aleph_0')
  })

  it('T5 契约守护：合法 GFM 表格仍正常成表且往返稳定', () => {
    const r = parse('| a | b |\n| --- | --- |\n| c | d |\n')
    expect(r.tables).toBe(1)
    expect(r.back).toContain('| a | b |')
    expect(r.back).toContain('| --- | --- |')
    expect(r.back).toContain('| c | d |')
  })

  it('T6 契约守护：段落中的行内公式（含 `|`）仍解析为 math 节点', () => {
    const ed = new Editor({ extensions: EXT, content: '由于$|ω^ω|=\\aleph_0$，故\n', contentType: 'markdown' })
    let math = 0
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'math') math++
      return true
    })
    ed.destroy()
    expect(math).toBe(1)
  })

  it('T7 契约守护：`$$` 块内以 `|` 开头的行仍是 mathBlock（不是表格/段落）', () => {
    const ed = new Editor({ extensions: EXT, content: '$$\n|ω^2|=\\aleph_0\n$$\n', contentType: 'markdown' })
    const blocks: string[] = []
    ed.state.doc.descendants((n) => {
      if (n.isBlock) blocks.push(n.type.name)
      return true
    })
    ed.destroy()
    expect(blocks).toContain('mathBlock')
    expect(blocks).not.toContain('table')
  })
})
