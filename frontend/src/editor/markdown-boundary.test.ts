/**
 * 2026-11-10 回归：粗体/斜体以标点结尾并紧邻文字时，不得序列化成非法 Markdown
 * （否则重开被解析成字面 `**`）。实现见 markdown-boundary.ts。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { normalizeEmphasisBoundaries } from './markdown-boundary'
import { KeParagraph } from './extensions/KeParagraph'

const EXTENSIONS = [
  StarterKit.configure({ paragraph: false, trailingNode: { node: 'paragraph', notAfter: ['paragraph'] } }),
  KeParagraph,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

type N = any
const txt = (text: string, marks: string[] = []): N => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) })
const doc = (...content: N[]): N => ({ type: 'doc', content: [{ type: 'paragraph', content }] })

function roundtrip(json: N) {
  const ed = new Editor({ extensions: EXTENSIONS, content: json })
  const md = ed.getMarkdown()
  ed.destroy()
  const ed2 = new Editor({ extensions: EXTENSIONS, content: md, contentType: 'markdown' })
  const json2 = ed2.getJSON()
  const md2 = ed2.getMarkdown()
  ed2.destroy()
  return { md, md2, json2 }
}

function boldTexts(json: N): string {
  let out = ''
  const walk = (n: N) => {
    if (!n) return
    if (n.type === 'text' && (n.marks ?? []).some((m: N) => m.type === 'bold')) out += n.text
    for (const c of n.content ?? []) walk(c)
  }
  walk(json)
  return out
}

describe('markdown-boundary：强调边界规范化', () => {
  it('粗体以句号结尾、紧跟文字 → 往返仍是粗体（不出现字面 **）', () => {
    const { md, json2 } = roundtrip(doc(txt('正常字体。', ['bold']), txt('继续')))
    expect(md).not.toContain('\\*\\*')
    expect(md).toContain('**正常字体**')
    expect(boldTexts(json2)).toContain('正常字体')
    expect(JSON.stringify(json2)).not.toContain('**')
  })

  it('粗体以 CJK 标点结尾、紧跟文字 → 往返仍是粗体', () => {
    const { md, json2 } = roundtrip(doc(txt('注意，', ['bold']), txt('继续')))
    expect(md).not.toMatch(/\\\*\\\*/)
    expect(boldTexts(json2)).toContain('注意')
  })

  it('粗体以标点结尾、紧跟斜体 → 不降级为字面 `**`', () => {
    const { json2 } = roundtrip(doc(txt('a.', ['bold']), txt('b', ['italic'])))
    expect(boldTexts(json2)).toContain('a')
  })

  it('粗体以标点开头、紧跟在前文词后 → 不降级为字面 `**`', () => {
    const { json2 } = roundtrip(doc(txt('前文'), txt('（粗体', ['bold'])))
    // 标点可移出标记，但粗体文字必须保留为 bold
    expect(boldTexts(json2)).toContain('粗体')
  })

  it('正常粗体（无边界问题）序列化不变', () => {
    const { md, json2 } = roundtrip(doc(txt('正常', ['bold']), txt('文字')))
    expect(md).toContain('**正常**')
    expect(boldTexts(json2)).toBe('正常')
  })

  it('normalizeEmphasisBoundaries 是纯函数：不修改输入 JSON', () => {
    const input = doc(txt('a.', ['bold']), txt('b'))
    const snapshot = JSON.stringify(input)
    const out = normalizeEmphasisBoundaries(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(out).not.toBe(input)
  })

  it('合法 Markdown 文本不被规范化改写（无 mark 的纯文本保持不变）', () => {
    const input = doc(txt('a.b 正常文本。'))
    const out = normalizeEmphasisBoundaries(input)
    expect(JSON.stringify(out)).toBe(JSON.stringify(input))
  })
})
