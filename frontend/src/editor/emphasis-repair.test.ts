/**
 * 2026-11-10：历史「非法强调」加载期自愈的回归测试（实现见 emphasis-repair.ts）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { repairInvalidEmphasis } from './emphasis-repair'
import { KeParagraph } from './extensions/KeParagraph'

const EXTENSIONS = [
  StarterKit.configure({ paragraph: false, trailingNode: { node: 'paragraph', notAfter: ['paragraph'] } }),
  KeParagraph,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function marksOf(md: string) {
  const ed = new Editor({ extensions: EXTENSIONS, content: md, contentType: 'markdown' })
  const json = ed.getJSON() as any
  const marks = new Set<string>()
  let text = ''
  const walk = (n: any) => {
    if (!n) return
    if (n.type === 'text') {
      text += n.text
      for (const m of n.marks ?? []) marks.add(m.type)
    }
    for (const c of n.content ?? []) walk(c)
  }
  walk(json)
  ed.destroy()
  return { marks, text, json }
}

describe('repairInvalidEmphasis', () => {
  it('粗体以句号结尾紧跟文字 → 改写为 <strong>，打开后仍是粗体', () => {
    const raw = '前 **正常字体。**继续\n'
    const fixed = repairInvalidEmphasis(raw)
    expect(fixed).toContain('<strong>正常字体。</strong>')
    const { marks, text } = marksOf(fixed)
    expect(marks.has('bold')).toBe(true)
    expect(text).toBe('前 正常字体。继续')
  })

  it('CJK 标点结尾 + 紧跟文字 → 修复', () => {
    const fixed = repairInvalidEmphasis('注意**，**继续\n')
    expect(fixed).toContain('<strong>，</strong>')
  })

  it('斜体 / 删除线同类边界 → 修复', () => {
    const fixedItalic = repairInvalidEmphasis('前 *注意。*继续\n')
    expect(fixedItalic).toContain('<em>注意。</em>')
    const fixedStrike = repairInvalidEmphasis('前 ~~删除。~~继续\n')
    expect(fixedStrike).toContain('<s>删除。</s>')
  })

  it('合法 Markdown 不变（幂等）', () => {
    for (const valid of ['**正常**文字\n', '前 **正常** 继续\n', '*斜体*文字\n', '~~删除~~文字\n', '`**代码**`\n']) {
      expect(repairInvalidEmphasis(valid)).toBe(valid)
    }
  })

  it('反斜杠转义与围栏/行内代码不改写', () => {
    const escaped = '字面 \\*\\*粗\\*\\* 文本\n'
    expect(repairInvalidEmphasis(escaped)).toBe(escaped)
    const fenced = '```md\n**a。**b\n```\n'
    expect(repairInvalidEmphasis(fenced)).toBe(fenced)
    const inline = '前 `**a。**b` 后\n'
    expect(repairInvalidEmphasis(inline)).toBe(inline)
  })

  it('修复结果幂等（第二次不再变化）', () => {
    const fixed = repairInvalidEmphasis('前 **正常字体。**继续\n')
    expect(repairInvalidEmphasis(fixed)).toBe(fixed)
  })
})
