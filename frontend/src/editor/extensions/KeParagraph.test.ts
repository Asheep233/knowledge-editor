/**
 * 2026-11-10 回归：连续空段落（上游用 `&nbsp;` 标记）不得再被显示成字面 `&nbsp;`。
 * 根因见 KeParagraph.ts 头注释。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { HtmlPassthroughInlineExtension } from './HtmlPassthroughExtension'
import { KeParagraph } from './KeParagraph'

const EXTENSIONS = [
  StarterKit.configure({ paragraph: false, trailingNode: { node: 'paragraph', notAfter: ['paragraph'] } }),
  KeParagraph,
  HtmlPassthroughInlineExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function make(md: string) {
  const ed = new Editor({ extensions: EXTENSIONS, content: md, contentType: 'markdown' })
  const json = ed.getJSON()
  const out = ed.getMarkdown()
  ed.destroy()
  return { json, out }
}

function textNodes(json: unknown): Array<{ type: string; text?: string; attrs?: { raw?: string } }> {
  const out: Array<{ type: string; text?: string; attrs?: { raw?: string } }> = []
  const walk = (n: any) => {
    if (!n) return
    if (n.type === 'text' || n.type === 'htmlPassthroughInline') out.push(n)
    for (const c of n.content ?? []) walk(c)
  }
  walk(json)
  return out
}

describe('KeParagraph：&nbsp; 空行解析回归', () => {
  it('单独的 &nbsp; 行 → 空段落（不是字面 HTML 实体芯片）', () => {
    const { json } = make('甲\n\n&nbsp;\n\n乙')
    const doc = json as any
    expect(doc.content.length, '三段：甲 / 空 / 乙').toBe(3)
    expect(doc.content[1].type).toBe('paragraph')
    expect(doc.content[1].content ?? [], '中间段落必须为空').toEqual([])
    const nodes = textNodes(json)
    expect(nodes.some((n) => n.type === 'htmlPassthroughInline'), '不得出现 &nbsp; 原子').toBe(false)
    expect(JSON.stringify(json)).not.toContain('&nbsp;')
  })

  it('连续多空行：解析后保留为空段落且序列化幂等', () => {
    const { json, out } = make('甲\n\n&nbsp;\n\n&nbsp;\n\n乙')
    const doc = json as any
    expect(doc.content.filter((n: any) => n.type === 'paragraph').length).toBeGreaterThanOrEqual(4)
    // 序列化仍保留空行标记，但再解析必须稳定
    const again = make(out)
    expect(JSON.stringify(again.json)).toBe(JSON.stringify(json))
    expect(out).toContain('&nbsp;')
  })

  it('混合行中的实体保持原字节（F3-8 不回归）', () => {
    const { out } = make('版权 &copy; &#169; &amp; &lt; &gt; &quot; &nbsp;\n')
    expect(out).toContain('&copy;')
    expect(out).toContain('&nbsp;')
  })

  it('普通空行（无 &nbsp;）不受影响：Markdown 折叠多余空行，不产生字面实体', () => {
    const { json } = make('甲\n\n\n乙\n')
    const doc = json as any
    // CommonMark：连续空行折叠，解析为两段（不产生 &nbsp; 原子）
    expect(doc.content.length).toBe(2)
    expect(JSON.stringify(json)).not.toContain('nbsp')
  })
})
