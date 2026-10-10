/**
 * task-69 M06（外部复审 2026-10-10，P2，真实 UI 确认）：**大写 `KE-` 前缀的未知注释首解析被丢弃**。
 *
 * 最小样本（`case-drift-07`，43 字节）：`<!-- KE-future: {"text":"KEEP"} -->\n\nAFTER\n`
 * 实测「修复前」：文档里只剩两个空段落 + `AFTER` —— 注释里的 `KEEP` **整块消失**（内容丢失）。
 * 对照：小写 `<!-- ke-future: … -->` 能原样保留（走 GenericFallback）。
 *
 * 根因：`KE_BLOCK_CATCH_PATTERN`/`KE_INLINE_CATCH_PATTERN`（`src/editor/tokenizers.ts`）无 `i` 标志
 * → 大写 `KE-` 既不被 keFallback 认领；而 html 保真路径的 `isPlainHtmlComment` 已用 `/i`
 * 把它**排除**在「普通注释」之外 → 两条路都不接 → 落到 marked 默认 html token → DOMParser 丢弃。
 *
 * 修法（验收口径）：**未知** `ke-*` 前缀大小写不敏感地由 GenericFallback 原样保留；
 * **已知**标记的语义不放宽（`KE-FOOTNOTE:`/`KE-NOTE:` 等大写变体不得被当作已知类型解析，
 * 仍按「未知 → 原文保留」处理，与原 F03 口径一致）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'

const EXT = [
  StarterKit,
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  MathExtension,
  MathBlockExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

interface Snap {
  structure: string[]
  text: string
  back: string
}
function snap(md: string): Snap {
  const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
  const structure: string[] = []
  ed.state.doc.descendants((n) => {
    if (n.isBlock) {
      structure.push(n.type.name + (n.type.name === 'keFallback' ? `(${JSON.stringify(String(n.attrs.raw ?? '').slice(0, 24))})` : ''))
    }
    return true
  })
  // 注意：keFallback / htmlPassthrough 是 **atom 节点**，内容在 attrs.raw 里，
  // `doc.textContent` 看不到它们 → 断言必须看「保真原文/字节」而不是 textContent。
  const text = ed.state.doc.textContent
  const back = ed.getMarkdown()
  ed.destroy()
  return { structure, text, back }
}

describe('task-69 M06：大写 KE- 未知注释必须原样保留（不得丢内容）', () => {
  it('T1 KEEP 内容必须保留在文档里（当前红：整块消失）', () => {
    const s = snap('<!-- KE-future: {"text":"KEEP"} -->\n\nAFTER\n')
    expect(s.back, `保存产物丢了 KEEP：${JSON.stringify(s.back)}`).toContain('KEEP')
    expect(s.text).toContain('AFTER')
  })

  it('T2 节点结构：应作为 keFallback 原样保留（对照小写行为）', () => {
    const upper = snap('<!-- KE-future: {"text":"KEEP"} -->\n\nAFTER\n')
    const lower = snap('<!-- ke-future: {"text":"KEEP"} -->\n\nAFTER\n')
    // 只比节点**类型**（keFallback 的 raw 属性里本就含原大小写，不参与对比）
    const kinds = (s: Snap) => s.structure.map((x) => x.split('(')[0])
    expect(kinds(upper), `大写未被任何 fallback 认领：${JSON.stringify(upper.structure)}`).toEqual(kinds(lower))
  })

  it('T3 字节：大写注释往返原样（当前红）', () => {
    const md = '<!-- KE-future: {"text":"KEEP"} -->\n\nAFTER'
    expect(snap(`${md}\n`).back).toBe(md)
  })

  it('T4 契约守护：大写**已知**标记不得被当已知类型解析（语义不放宽，仍原文保留）', () => {
    // `KE-NOTE:` / `KE-FOOTNOTE:` 大写变体 → 未知 → 原样保留（不得变成 note / footnote 节点）
    const s = snap('<!-- KE-NOTE: {"title":"T","body":"B"} -->\n')
    expect(s.structure.join(','), `大写已知标记被误解析：${JSON.stringify(s.structure)}`).not.toContain('note')
    expect(s.back, `大写已知标记内容丢失：${JSON.stringify(s.back)}`).toContain('T')
  })

  it('T5 契约守护：小写未知前缀（既有行为）仍原样保留', () => {
    const md = '<!-- ke-future: {"text":"KEEP"} -->\n\nAFTER'
    const s = snap(`${md}\n`)
    expect(s.back, '小写未知前缀既有行为：原样保留').toBe(md)
  })

  it('T6 契约守护：普通 HTML 注释（非 ke- 命名空间）仍走 html 保真路径', () => {
    const s = snap('<!-- 普通注释 -->\n')
    expect(s.structure.join(','), '应走 htmlPassthrough').toContain('htmlPassthrough')
    expect(s.back.trim()).toBe('<!-- 普通注释 -->')
  })

  it('T7 契约守护：行内大写 KE- 注释也不得丢内容', () => {
    const s = snap('前 <!-- KE-inline: {"v":"INLINE_KEEP"} --> 后\n')
    expect(s.back, `行内大写注释内容丢失：${JSON.stringify(s.back)}`).toContain('INLINE_KEEP')
    expect(s.text).toContain('前')
    expect(s.text).toContain('后')
  })
})
