/**
 * task-50：复制公式后「编辑第二行却改到第一行」——id 重复 + 定位按 id 取首个。
 *
 * 根因：
 *  1. 复制粘贴保留 `id`（renderHTML data-id ↔ parseHTML）→ 两行公式共用同一 id；
 *  2. `locateMathById` 是「id 优先、取第一个命中」→ 保存时定位到第一行。
 *
 * 修复（两层）：A. `MathIdUniqueness` 扩展在 appendTransaction 里去重（保留第一个，其余 newId）；
 *             B. `locateMathById` 改为「pos 优先（同 id 校验）+ 多命中取最近邻」。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MathExtension } from '../extensions/MathExtension'
import { MathBlockExtension } from '../extensions/MathBlockExtension'
import { MathIdUniqueness } from '../extensions/MathIdUniqueness'
import { KeDocument } from '../extensions/KeBlockJoin'
import { KeListItem, OrderedListParenExtension } from '../extensions/ListExtension'
import { FootnoteExtension } from '../extensions/FootnoteExtension'
import { applyMathSaveCursor, locateMathById } from './cursor'

const BASE_EXTENSIONS = [
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    document: false,
    blockquote: false,
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  OrderedListParenExtension,
  KeListItem,
  MathExtension,
  MathBlockExtension,
  FootnoteExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]
/** A 层（去重扩展）挂载后的生产栈 */
const EXTENSIONS = [...BASE_EXTENSIONS, MathIdUniqueness]

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((ed) => ed.destroy())
})

function makeEditor(json: unknown, withDedupe = true): Editor {
  const ed = new Editor({ extensions: withDedupe ? EXTENSIONS : BASE_EXTENSIONS, content: '', contentType: 'json' })
  ed.commands.setContent(json as never, { contentType: 'json', emitUpdate: false })
  editors.push(ed)
  return ed
}

/** 两段，各含一个**同 id** 的行内公式（复现「复制第一行得到第二行」） */
const dupDoc = (latex1 = '\\prec', latex2 = '\\prec') => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'math', attrs: { latex: latex1, id: 'dup' } }] },
    { type: 'paragraph', content: [{ type: 'math', attrs: { latex: latex2, id: 'dup' } }] },
  ],
})

function mathPositions(ed: Editor, kind = 'math'): number[] {
  const out: number[] = []
  ed.state.doc.descendants((n, pos) => {
    if (n.type.name === kind) out.push(pos)
    return true
  })
  return out
}

function newHistoryGroup(): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 1000)
}

const latexAt = (ed: Editor, pos: number): string =>
  (ed.state.doc.nodeAt(pos)?.attrs.latex as string) ?? ''

describe('1. 复现用例（先红）：同 id 两节点 + fallbackPos=第二个 → 必须返回第二个', () => {
  it('1-1 locateMathById 以 pos 为准（不能被第一个同 id 抢走）', () => {
    // 关闭去重扩展：模拟「用户当前那篇已有重复 id 的文档」（A 层修的是未来编辑，B 层兜住存量）
    const ed = makeEditor(dupDoc(), false)
    const [p1, p2] = mathPositions(ed)
    expect(p1).toBeLessThan(p2)
    // 修复前：返回 p1（→ 用户改第二行、动的是第一行）
    expect(locateMathById(ed.state.doc, 'dup', p2)).toBe(p2)
  })
})

describe('2. 保存路径：点第二个节点改 latex → 只有第二个变化', () => {
  it('2-1 第一个逐字节不变，第二个更新', () => {
    const ed = makeEditor(dupDoc('\\prec', '\\prec'), false)
    const [p1, p2] = mathPositions(ed)
    const target = locateMathById(ed.state.doc, 'dup', p2)
    expect(target).toBe(p2)
    const ok = ed.commands.command(({ tr }) => applyMathSaveCursor(tr, target, false, '\\succ'))
    expect(ok).toBe(true)
    expect(latexAt(ed, p1)).toBe('\\prec')
    expect(latexAt(ed, p2)).toBe('\\succ')
  })
})

describe('3. 根治（A 层）：复制粘贴后 id 自动去重', () => {
  it('3-1 粘贴同 id 公式 → 两节点 id 不相等（保留第一个），一次撤销回到粘贴前', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'math', attrs: { latex: '\\prec', id: 'dup' } }] }],
    })
    const before = ed.getMarkdown()
    const m = mathPositions(ed)[0]
    const original = ed.state.doc.nodeAt(m)!
    const copy = ed.state.schema.nodes.paragraph.create(null, original) // 模拟「复制第一行」
    newHistoryGroup()
    ed.commands.command(({ tr }) => {
      tr.insert(tr.doc.content.size, copy)
      return true
    })
    const ids = mathPositions(ed).map((p) => ed.state.doc.nodeAt(p)!.attrs.id as string)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('dup') // 保留第一个
    expect(ids[1]).not.toBe('dup') // 其余 newId()
    expect(ids[1]).not.toBe('')
    // 一次撤销回到粘贴前（粘贴 + 去重同属一步）
    ed.commands.undo()
    expect(mathPositions(ed)).toHaveLength(1)
    expect(ed.getMarkdown()).toBe(before)
  })

  it('3-2 粘贴后编辑第二行：只有第二行变化（用户场景端到端）', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'math', attrs: { latex: '\\prec', id: 'dup' } }] }],
    })
    const m = mathPositions(ed)[0]
    const original = ed.state.doc.nodeAt(m)!
    const copy = ed.state.schema.nodes.paragraph.create(null, original)
    ed.commands.command(({ tr }) => {
      tr.insert(tr.doc.content.size, copy)
      return true
    })
    const [p1, p2] = mathPositions(ed)
    const id2 = ed.state.doc.nodeAt(p2)!.attrs.id as string
    const target = locateMathById(ed.state.doc, id2, p2)
    expect(target).toBe(p2)
    ed.commands.command(({ tr }) => applyMathSaveCursor(tr, target, false, '\\succ'))
    expect(latexAt(ed, p1)).toBe('\\prec')
    expect(latexAt(ed, p2)).toBe('\\succ')
  })

  it('3-3 纯选区事务不产生额外（空）事务', () => {
    const ed = makeEditor(dupDoc('x', 'y'))
    let events = 0
    ed.on('transaction', () => events++)
    ed.commands.setTextSelection(1)
    expect(events).toBe(1) // 只有我们自己那次；appendTransaction 返回 null
  })
})

describe('4. 不误伤：引用语义 id 不被改写', () => {
  it('4-1 同 id 的两个脚注节点保持原 id（去重只做 math/mathBlock）', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'footnote', attrs: { id: 'f1', n: 1 } }] },
        { type: 'paragraph', content: [{ type: 'footnote', attrs: { id: 'f1', n: 1 } }] },
      ],
    })
    // 触发一次 docChanged 事务（插入段落）→ 去重扩展运行，但只扫 math/mathBlock
    ed.commands.command(({ tr }) => {
      tr.insert(tr.doc.content.size, tr.doc.type.schema.nodes.paragraph.create())
      return true
    })
    const ids: string[] = []
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'footnote') ids.push(n.attrs.id as string)
      return true
    })
    expect(ids).toEqual(['f1', 'f1']) // 引用类 id 逐字保留
  })
})

describe('5. 零回归 / 序列化不变', () => {
  it('5-1 id 不进 Markdown：往返后公式文本仍为 $x$ / $$…$$', () => {
    const ed = makeEditor(dupDoc('x', 'y'))
    const md = ed.getMarkdown()
    expect(md).toContain('$x$')
    expect(md).toContain('$y$')
    expect(md).not.toContain('dup')
  })

  it('5-2 去重后 id 唯一且公式内容不变', () => {
    const ed = makeEditor(dupDoc('\\prec', '\\prec'))
    const ids = mathPositions(ed).map((p) => ed.state.doc.nodeAt(p)!.attrs.id as string)
    expect(new Set(ids).size).toBe(2)
    expect(latexAt(ed, mathPositions(ed)[0])).toBe('\\prec')
    expect(latexAt(ed, mathPositions(ed)[1])).toBe('\\prec')
  })
})
