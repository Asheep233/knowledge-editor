/**
 * task-49（v1.2.1）· 公式互转（行内 ⇄ 行间）测试。
 *
 * 口径：① 行内→行间不自动开编辑器、块插段后、光标在块后（文末先补空段落）；
 * ② 行间→行内多行 LaTeX 拒绝且文档零改动；③ NodeView 只发请求（EditorArea 执行）；
 * 单体事务（一次撤销回原状）；只读态 0 事务。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it, vi } from 'vitest'
import { MathExtension } from '../extensions/MathExtension'
import { MathBlockExtension } from '../extensions/MathBlockExtension'
import { KeBlockquote, KeDocument } from '../extensions/KeBlockJoin'
import { KeListItem, OrderedListParenExtension } from '../extensions/ListExtension'
import { convertBlockToInline, convertInlineToBlock } from './convert'

const EXTENSIONS = [
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    document: false,
    blockquote: false,
    link: { openOnClick: false, autolink: true },
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  KeBlockquote,
  OrderedListParenExtension,
  KeListItem,
  MathExtension,
  MathBlockExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function makeEditor(md: string): Editor {
  const ed = new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
  ed.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
  return ed
}

interface Found {
  pos: number
  id: string
  latex: string
  nodeSize: number
}

function findMath(ed: Editor, kind: 'math' | 'mathBlock'): Found {
  let out: Found | null = null
  ed.state.doc.descendants((node, pos) => {
    if (out) return false
    if (node.type.name === kind) {
      out = {
        pos,
        id: (node.attrs.id as string) ?? '',
        latex: (node.attrs.latex as string) ?? '',
        nodeSize: node.nodeSize,
      }
      return false
    }
    return true
  })
  if (!out) throw new Error(`未找到 ${kind}`)
  return out
}

const allMath = (ed: Editor): Array<{ kind: string; latex: string }> => {
  const out: Array<{ kind: string; latex: string }> = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'math' || n.type.name === 'mathBlock') {
      out.push({ kind: n.type.name, latex: (n.attrs.latex as string) ?? '' })
    }
    return true
  })
  return out
}

const sel = (ed: Editor) => ({ from: ed.state.selection.from, empty: ed.state.selection.empty })

/**
 * 把历史时钟推进 >500ms（prosemirror-history 的 newGroupDelay）：
 * 否则「setContent（载入）」与紧随其后的转换会被并入同一撤销组，
 * 一次 undo 会退到空文档——真实场景里用户打开文档与点转换相隔远大于 500ms。
 */
function newHistoryGroup(): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 1000)
}

describe('1. 行内 → 行间', () => {
  it('1-1 类型/latex/插在段落之后/双空格清理/光标在块后', () => {
    const ed = makeEditor('前文 $x$ 后文\n')
    const m = findMath(ed, 'math')
    const result = convertInlineToBlock(ed, { id: m.id, pos: m.pos })
    expect(result.ok).toBe(true)
    const nodes = allMath(ed)
    expect(nodes).toEqual([{ kind: 'mathBlock', latex: 'x' }])
    // 段落成为「前文 后文」（公式与两侧空格被移除，且不留双空格）
    expect(ed.state.doc.textContent).toBe('前文 后文')
    // 块在段落之后
    const block = findMath(ed, 'mathBlock')
    const json = ed.getJSON() as { content?: Array<{ type: string }> }
    expect(json.content?.map((n) => n.type)).toEqual(['paragraph', 'mathBlock', 'paragraph'])
    expect(block.pos).toBeGreaterThan(0)
    // 光标在新块之后
    const s = sel(ed)
    expect(s.empty).toBe(true)
    expect(s.from).toBeGreaterThanOrEqual(block.pos + block.nodeSize)
    ed.destroy()
  })

  it('1-2 独占段落：不留空段落（块取代空段） + 文末自动补空段落承载光标', () => {
    const ed = makeEditor('$x$\n')
    const m = findMath(ed, 'math')
    expect(convertInlineToBlock(ed, { id: m.id, pos: m.pos }).ok).toBe(true)
    const json = ed.getJSON() as { content?: Array<{ type: string }> }
    expect(json.content?.map((n) => n.type)).toEqual(['mathBlock', 'paragraph'])
    const s = sel(ed)
    const block = findMath(ed, 'mathBlock')
    expect(s.from).toBe(block.pos + block.nodeSize + 1) // 空段落内部
    ed.destroy()
  })

  it('1-3 一次撤销回到原状 + 往返稳定（$x$ → 块 → 重开一致）', () => {
    const ed = makeEditor('前文 $x$ 后文\n')
    const before = ed.getMarkdown()
    const m = findMath(ed, 'math')
    newHistoryGroup()
    convertInlineToBlock(ed, { id: m.id, pos: m.pos })
    expect(ed.getMarkdown()).not.toBe(before)
    ed.commands.undo()
    expect(ed.getMarkdown()).toBe(before)
    // 往返稳定：再转一次 → 取 markdown → 重开 → markdown 一致
    const m2 = findMath(ed, 'math')
    convertInlineToBlock(ed, { id: m2.id, pos: m2.pos })
    const md = ed.getMarkdown()
    expect(md).toContain('$$\nx\n$$')
    const reopened = makeEditor(md)
    expect(reopened.getMarkdown()).toBe(md)
    ed.destroy()
    reopened.destroy()
  })
})

describe('2. 行间 → 行内', () => {
  it('2-1 附着到上一段落末尾 + 光标紧贴公式之后', () => {
    const ed = makeEditor('第一段\n\n$$\nb\n$$\n\n第二段\n')
    const m = findMath(ed, 'mathBlock')
    const result = convertBlockToInline(ed, { id: m.id, pos: m.pos })
    expect(result.ok).toBe(true)
    expect(allMath(ed)).toEqual([{ kind: 'math', latex: 'b' }])
    // 附着在上一段落末尾（第二段保持在后）
    const json = JSON.stringify(ed.getJSON())
    expect(json.indexOf('第一段')).toBeLessThan(json.indexOf('b'))
    expect(ed.getMarkdown().startsWith('第一段$b$')).toBe(true)
    const s = sel(ed)
    expect(s.empty).toBe(true)
    expect(s.from).toBeGreaterThan(1)
    ed.destroy()
  })

  it('2-2 相邻公式回归：上一段末尾已有行内公式 → `$a$$b$` 仍解析回两段（依赖 5155448）', () => {
    const ed = makeEditor('$a$\n\n$$\nb\n$$\n')
    const m = findMath(ed, 'mathBlock')
    expect(convertBlockToInline(ed, { id: m.id, pos: m.pos }).ok).toBe(true)
    const md = ed.getMarkdown()
    expect(md).toContain('$a$$b$')
    // 关键：重开必须解析回两个行内公式（不得粘连成一个）
    const reopened = makeEditor(md)
    expect(allMath(reopened)).toEqual([
      { kind: 'math', latex: 'a' },
      { kind: 'math', latex: 'b' },
    ])
    reopened.destroy()
    ed.destroy()
  })

  it('2-3 一次撤销回到原状（块恢复） + 往返稳定', () => {
    const ed = makeEditor('第一段\n\n$$\nb\n$$\n')
    const before = ed.getMarkdown()
    const m = findMath(ed, 'mathBlock')
    newHistoryGroup()
    convertBlockToInline(ed, { id: m.id, pos: m.pos })
    ed.commands.undo()
    expect(ed.getMarkdown()).toBe(before)
    ed.destroy()
  })
})

describe('3. 多行 LaTeX → 拒绝（文档零改动）', () => {
  const MULTILINE = '$$\n\\begin{aligned}\na &= b\\\\\nc &= d\n\\end{aligned}\n$$\n'

  it('3-1 返回 multiline + 提示文案 + 文档 markdown 完全不变', () => {
    const ed = makeEditor(`前段\n\n${MULTILINE}`)
    const m = findMath(ed, 'mathBlock')
    expect(m.latex).toContain('\n')
    const before = ed.getMarkdown()
    let transactions = 0
    ed.on('transaction', () => transactions++)
    const result = convertBlockToInline(ed, { id: m.id, pos: m.pos })
    expect(result).toMatchObject({ ok: false, reason: 'multiline' })
    expect(result.ok === false && result.message).toContain('多行 LaTeX')
    expect(ed.getMarkdown()).toBe(before) // 字节完全不变
    expect(transactions).toBe(0) // 严格 0 事务
    ed.destroy()
  })

  it('3-2 单行 latex 正常转换（对照组，证明断言非空）', () => {
    const ed = makeEditor('前段\n\n$$\nb\n$$\n')
    const m = findMath(ed, 'mathBlock')
    expect(convertBlockToInline(ed, { id: m.id, pos: m.pos }).ok).toBe(true)
    ed.destroy()
  })
})

describe('4. 只读态：0 事务', () => {
  it('4-1 read-only 两条命令均拒绝且不产生事务', () => {
    const ed = makeEditor('前文 $x$ 后文\n\n$$\nb\n$$\n')
    ed.setEditable(false)
    const inline = findMath(ed, 'math')
    const before = ed.getMarkdown()
    let transactions = 0
    ed.on('transaction', () => transactions++)
    expect(convertInlineToBlock(ed, { id: inline.id, pos: inline.pos })).toMatchObject({
      ok: false,
      reason: 'readonly',
    })
    const block = findMath(ed, 'mathBlock')
    expect(convertBlockToInline(ed, { id: block.id, pos: block.pos })).toMatchObject({
      ok: false,
      reason: 'readonly',
    })
    expect(transactions).toBe(0)
    expect(ed.getMarkdown()).toBe(before)
    ed.destroy()
  })

  it('4-2 定位失败（id 不存在 + pos 非公式）→ 严格 0 事务', () => {
    const ed = makeEditor('正文\n')
    let transactions = 0
    ed.on('transaction', () => transactions++)
    expect(convertInlineToBlock(ed, { id: 'nope', pos: 2 }).ok).toBe(false)
    expect(convertBlockToInline(ed, { id: 'nope', pos: 2 }).ok).toBe(false)
    expect(transactions).toBe(0)
    ed.destroy()
  })
})

describe('5. 边界', () => {
  it('5-1 文档开头就是行间块（无上一段落）→ 新建段落承载', () => {
    const ed = makeEditor('$$\nx\n$$\n\n后文\n')
    const m = findMath(ed, 'mathBlock')
    expect(convertBlockToInline(ed, { id: m.id, pos: m.pos }).ok).toBe(true)
    const json = ed.getJSON() as { content?: Array<{ type: string }> }
    expect(json.content?.[0]?.type).toBe('paragraph')
    expect(ed.getMarkdown().startsWith('$x$')).toBe(true)
    expect(ed.getMarkdown()).toContain('后文')
    ed.destroy()
  })

  it('5-2 引用块内的行间块 → 进其内部最后一个 textblock 末尾', () => {
    const ed = makeEditor('> 引用\n>\n> $$\n> q\n> $$\n')
    const m = findMath(ed, 'mathBlock')
    expect(convertBlockToInline(ed, { id: m.id, pos: m.pos }).ok).toBe(true)
    const md = ed.getMarkdown()
    expect(md).toContain('> 引用$q$')
    expect(md).not.toContain('$$')
    ed.destroy()
  })

  it('5-3 列表项内的行间块 → 附着到该 listItem 的段落末尾', () => {
    const ed = new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
    ed.commands.setContent(
      {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: '项' }] },
                  { type: 'mathBlock', attrs: { latex: 'z', id: 'b1' } },
                ],
              },
            ],
          },
        ],
      },
      { contentType: 'json', emitUpdate: false },
    )
    const m = findMath(ed, 'mathBlock')
    expect(convertBlockToInline(ed, { id: 'b1', pos: m.pos }).ok).toBe(true)
    expect(ed.getMarkdown()).toContain('- 项$z$')
    ed.destroy()
  })

  it('5-4 空 latex：不崩、类型正确转换', () => {
    const ed = new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
    ed.commands.setContent(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '前' }] },
          { type: 'mathBlock', attrs: { latex: '', id: 'b-empty' } },
        ],
      },
      { contentType: 'json', emitUpdate: false },
    )
    const m = findMath(ed, 'mathBlock')
    expect(convertBlockToInline(ed, { id: 'b-empty', pos: m.pos }).ok).toBe(true)
    expect(allMath(ed)).toEqual([{ kind: 'math', latex: '' }])
    ed.destroy()
  })
})

describe('6. 接线守卫（NodeView 发请求 / EditorArea 执行）', () => {
  const view = readFileSync(join(__dirname, '../../components/editor/nodeviews/MathNodeView.tsx'), 'utf8')
  const area = readFileSync(join(__dirname, '../../components/layout/EditorArea.tsx'), 'utf8')

  it('6-1 NodeView 只发转换请求，不直接执行 PM 命令（避免 #300）', () => {
    expect(view).toContain('MATH_CONVERT_EVENT')
    expect(view).toContain("data-testid=\"math-more-btn\"")
    expect(view).toContain("data-testid=\"math-convert-block\"")
    expect(view).toContain("data-testid=\"math-convert-inline\"")
    expect(view).not.toContain('convertInlineToBlock(')
    expect(view).not.toContain('convertBlockToInline(')
  })

  it('6-2 EditorArea 监听转换事件并执行命令（多行 → 非破坏性提示）', () => {
    expect(area).toContain('MATH_CONVERT_EVENT')
    expect(area).toContain('convertInlineToBlock')
    expect(area).toContain('convertBlockToInline')
    expect(area).toContain("reason === 'multiline'")
  })
})
