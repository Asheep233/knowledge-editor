/**
 * task-69 M07（外部复审 2026-10-10，P2）：**同名标准标签嵌套时，外层尾文失去 mark**。
 *
 * 最小样本（`case-drift-04`，48 字节）：
 *   `前 <em>A <em><span>KEEP</span></em> B</em> 后`
 * 实测（真实 Chromium + 真实编辑器栈，`ke-e2e` 夹具，2026-10-10）：
 *   PM : `前 `[] | `A `[italic] | `<span>`[] | `KEEP`[italic] | `</span>`[] | **` B 后`[]**  ← 尾文丢了 italic
 *   DOM: 同上（` B 后` computed font-style = normal）
 *   MD : `前 *A* <span>*KEEP*</span> B 后`      ← 外层 `</em>` 成了孤儿
 * 对照（**非**同名嵌套，无此问题）：`前 <em>A <span>KEEP</span> B</em> 后` →
 *   PM ` B`[italic] / MD `前 *A* <span>*KEEP*</span> *B* 后` ✓
 *
 * 根因：`claimStandardWrapper`（`src/editor/tokenizers.ts:607-642`）用
 * `new RegExp(`</${rawName}\\s*>`, 'i').exec(rest)` 找**第一个**同名结束标签 ——
 * 遇到同名嵌套时命中的是**内层**的 `</em>`，于是 `whole` 在外层真正结束前就被截断，
 * 剩下的 ` B</em> 后` 里尾文不再带 italic。需要**按深度配平**地找匹配结束标签。
 *
 * 修法边界：只改**解析侧**的标签配平；**不动序列化口径**（task 明确要求先回报再改序列化）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'

const EXT = [
  StarterKit,
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

interface Span {
  text: string
  italic: boolean
}
function italicSpans(md: string): { spans: Span[]; back: string } {
  const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
  const spans: Span[] = []
  ed.state.doc.descendants((n) => {
    if (n.isText) spans.push({ text: n.text ?? '', italic: n.marks.some((m) => m.type.name === 'italic') })
    return true
  })
  const back = ed.getMarkdown()
  ed.destroy()
  return { spans, back }
}
const italicText = (spans: Span[]) => spans.filter((s) => s.italic).map((s) => s.text).join('')

describe('task-69 M07：同名标签嵌套时外层尾文必须保持 mark', () => {
  it('T1 外层尾文 ` B` 必须仍是 italic（当前红：丢失）', () => {
    const { spans } = italicSpans('前 <em>A <em><span>KEEP</span></em> B</em> 后\n')
    const italic = italicText(spans)
    expect(italic, `带 italic 的文本：${JSON.stringify(spans)}`).toContain(' B')
  })

  it('T2 内容不丢：KEEP / A / 后 都还在', () => {
    const { spans } = italicSpans('前 <em>A <em><span>KEEP</span></em> B</em> 后\n')
    const all = spans.map((s) => s.text).join('')
    expect(all).toContain('KEEP')
    expect(all).toContain('前')
    expect(all).toContain('后')
  })

  it('T3 序列化产物再解析仍保持 italic（往返语义稳定）', () => {
    const once = italicSpans('前 <em>A <em><span>KEEP</span></em> B</em> 后\n')
    const twice = italicSpans(`${once.back}\n`)
    // 二次往返：`*B*` 的 italic 文本是 `B`（前导空格归非 italic 文本），语义等价即可
    const italic = italicText(twice.spans)
    expect(italic, `二次往返：${JSON.stringify(once.back)}`).toContain('B')
    expect(italic, '尾文整体仍带 italic').toContain('A')
  })

  it('T4 契约守护：非嵌套的 `<em>` + `<span>` 尾文 italic 保持（既有行为）', () => {
    const { spans, back } = italicSpans('前 <em>A <span>KEEP</span> B</em> 后\n')
    expect(italicText(spans)).toContain(' B')
    expect(back).toContain('*B*')
  })

  it('T5 契约守护：**不同名**嵌套（`<strong>` 内 `<em>`）两侧 mark 各自保持', () => {
    const { spans } = italicSpans('前 <strong>S <em>E</em> T</strong> 后\n')
    const italic = spans.filter((s) => s.italic).map((s) => s.text).join('')
    expect(italic).toContain('E')
  })
})
