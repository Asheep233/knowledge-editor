/**
 * task-28 项②：公式编辑「保存 / Esc 退出 / 空删除」后的光标落点
 * （规范 `docs/design-v1.1.7-math-editor.md` §3.2，2026-09-18 主理人重拍）。
 *
 * A 组：纯函数（planMathCursorAfterSave / locateMathById）——无需 DOM，覆盖全部边界分支。
 * B 组：headless Editor 集成——复刻 `EditorArea.onSave/onDeleteEmpty` 的接线
 *      （同一事务内 applyMathSaveCursor + 只读闸门），断言事务语义 / 撤销 / 序列化红线。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { MathExtension } from '../extensions/MathExtension'
import { MathBlockExtension } from '../extensions/MathBlockExtension'
import {
  applyMathDeleteCursor,
  applyMathSaveCursor,
  locateMathById,
  planMathCursorAfterSave,
} from './cursor'

const EXTENSIONS = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  MathExtension,
  MathBlockExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function make(content: unknown, json = false): Editor {
  return new Editor({
    extensions: EXTENSIONS,
    content: content as never,
    contentType: json ? 'json' : 'markdown',
  })
}

interface FoundMath {
  pos: number
  nodeSize: number
  id: string
  latex: string
  isBlock: boolean
}

function findMath(ed: Editor): FoundMath | null {
  let out: FoundMath | null = null
  ed.state.doc.descendants((node, pos) => {
    if (out) return false
    if (node.type.name === 'math' || node.type.name === 'mathBlock') {
      out = {
        pos,
        nodeSize: node.nodeSize,
        id: (node.attrs.id as string) ?? '',
        latex: (node.attrs.latex as string) ?? '',
        isBlock: node.type.name === 'mathBlock',
      }
      return false
    }
    return true
  })
  return out
}

function sel(ed: Editor): { kind: string; from: number; to: number; empty: boolean } {
  const s = ed.state.selection
  return { kind: s.constructor.name, from: s.from, to: s.to, empty: s.empty }
}

/** 复刻 EditorArea.onSave：按 id 定位（pos 兜底）→ 同一事务内改 latex + 落光标 */
function saveFormula(ed: Editor, latex: string): boolean {
  const found = findMath(ed)
  if (!found) return false
  return ed.commands.command(({ tr }) =>
    applyMathSaveCursor(tr, locateMathById(tr.doc, found.id, found.pos), found.isBlock, latex),
  )
}

/** 复刻 EditorArea 的只读闸门（`ed.isEditable` 为假时不得派发任何事务） */
function saveFormulaGuarded(ed: Editor, latex: string): boolean {
  if (!ed.isEditable) return false
  return saveFormula(ed, latex)
}

/** 复刻 EditorArea.onDeleteEmpty */
function deleteFormula(ed: Editor): boolean {
  const found = findMath(ed)
  if (!found) return false
  return ed.commands.command(({ tr }) =>
    applyMathDeleteCursor(tr, locateMathById(tr.doc, found.id, found.pos)),
  )
}

/** 复刻 EditorArea.onDeleteEmpty 的只读闸门 */
function deleteFormulaGuarded(ed: Editor): boolean {
  if (!ed.isEditable) return false
  return deleteFormula(ed)
}

const childTypes = (ed: Editor): string => ed.state.doc.children.map((c) => c.type.name).join(',')

// ---------------------------------------------------------------- A 组：纯函数

describe('A 组 · planMathCursorAfterSave（纯函数）', () => {
  it('A1 行内公式 → 不插段落、光标在公式后一位', () => {
    const ed = make('前文 $x$ 后文')
    const m = findMath(ed)!
    const plan = planMathCursorAfterSave(ed.state.doc, m.pos, false)
    expect(plan).toEqual({ insertParagraphAt: -1, selectionPos: m.pos + m.nodeSize })
    ed.destroy()
  })

  it('A2 块级公式 + 后继有内容段落 → 复用段落（不插空行），光标落该段落行首', () => {
    const ed = make('$$\nx\n$$\n\n后续文字')
    const m = findMath(ed)!
    const plan = planMathCursorAfterSave(ed.state.doc, m.pos, true)
    const after = m.pos + m.nodeSize
    expect(plan).toEqual({ insertParagraphAt: -1, selectionPos: after + 1 })
    expect(ed.state.doc.childCount).toBe(2) // mathBlock, paragraph（不新增）
    ed.destroy()
  })

  it('A3 块级公式 + 后继空段落 → 复用（不插空行）', () => {
    const ed = make({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'x', id: 'b1' } },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '后续' }] },
      ],
    }, true)
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    expect(planMathCursorAfterSave(ed.state.doc, m.pos, true)).toEqual({
      insertParagraphAt: -1,
      selectionPos: after + 1,
    })
    ed.destroy()
  })

  it('A4 块级公式在文档末尾（无后继块）→ 新起一行：插入空段落，光标落其行首', () => {
    const ed = make('$$x$$')
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    expect(ed.state.doc.childCount).toBe(1) // 直接 new Editor 不跑 appendTransaction
    expect(planMathCursorAfterSave(ed.state.doc, m.pos, true)).toEqual({
      insertParagraphAt: after,
      selectionPos: after + 1,
    })
    ed.destroy()
  })

  it('A5 块级公式 + 后继非段落块（代码块）→ 新起一行', () => {
    const ed = make({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'x', id: 'b1' } },
        { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] },
      ],
    }, true)
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    expect(planMathCursorAfterSave(ed.state.doc, m.pos, true)).toEqual({
      insertParagraphAt: after,
      selectionPos: after + 1,
    })
    ed.destroy()
  })

  it('A6 位置失效（越界 / 负值 / 非数）→ 不抛错，返回安全位置', () => {
    const ed = make('前文 $x$ 后文')
    const size = ed.state.doc.content.size
    for (const bad of [-1, -999, size + 1, Number.NaN]) {
      const plan = planMathCursorAfterSave(ed.state.doc, bad, true)
      expect(plan.insertParagraphAt).toBe(-1)
      expect(plan.selectionPos).toBeGreaterThanOrEqual(0)
      expect(plan.selectionPos).toBeLessThanOrEqual(size)
    }
    // 合法但非节点起点（段落中间）→ 不抛错
    expect(planMathCursorAfterSave(ed.state.doc, 1, false).insertParagraphAt).toBe(-1)
    ed.destroy()
  })

  it('A8 locateMathById：id 命中优先；id 失配回退 pos；非法 fallback 返回 -1', () => {
    // 显式带 id 的行内公式（Markdown 导入的公式 id 为空 → 走 pos 兜底，见 B 组）
    const ed = make({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '前文 ' },
            { type: 'math', attrs: { latex: 'x', id: 'm-1' } },
            { type: 'text', text: ' 后文' },
          ],
        },
      ],
    }, true)
    const m = findMath(ed)!
    expect(m.id).toBe('m-1')
    expect(locateMathById(ed.state.doc, 'm-1', 0)).toBe(m.pos) // id 命中优先于 fallback
    expect(locateMathById(ed.state.doc, 'no-such-id', m.pos)).toBe(m.pos) // 失配 → pos
    expect(locateMathById(ed.state.doc, '', Number.NaN)).toBe(-1) // 无可用定位
    ed.destroy()

    // Markdown 解析出的公式 id 为空 → 直接走 pos 兜底
    const md = make('前文 $x$ 后文')
    const mm = findMath(md)!
    expect(mm.id).toBe('')
    expect(locateMathById(md.state.doc, mm.id, mm.pos)).toBe(mm.pos)
    md.destroy()
  })

  it('A7 列表项内末尾块级公式 → 段落插在 listItem 内部（不分裂列表项）', () => {
    const ed = make({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'item' }] },
                { type: 'mathBlock', attrs: { latex: 'y', id: 'b1' } },
              ],
            },
          ],
        },
      ],
    }, true)
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    const plan = planMathCursorAfterSave(ed.state.doc, m.pos, true)
    expect(plan).toEqual({ insertParagraphAt: after, selectionPos: after + 1 })
    // 插入点父节点 = listItem（在容器内部换行，不产生第二个列表项）
    const $after = ed.state.doc.resolve(after)
    expect($after.parent.type.name).toBe('listItem')
    ed.destroy()
  })
})

// ------------------------------------------------------- B 组：headless 集成

describe('B 组 · 保存/删除事务集成（headless Editor）', () => {
  it('B1 行内公式 → 光标在公式后一位，latex 已更新', () => {
    const ed = make('前文 $x$ 后文')
    const m = findMath(ed)!
    expect(saveFormula(ed, 'x+1')).toBe(true)
    expect(sel(ed)).toMatchObject({ kind: 'TextSelection', empty: true, from: m.pos + m.nodeSize })
    expect(findMath(ed)!.pos).toBe(m.pos) // 节点位置不变
    expect(ed.getMarkdown()).toBe('前文 $x+1$ 后文')
    ed.destroy()
  })

  it('B2 块级公式 + 既有段落 → 光标落既有段落行首，且不新增段落', () => {
    const ed = make('$$\nx\n$$\n\n后续文字')
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    expect(childTypes(ed)).toBe('mathBlock,paragraph')
    expect(saveFormula(ed, 'x+1')).toBe(true)
    expect(childTypes(ed)).toBe('mathBlock,paragraph') // 不插空行
    expect(sel(ed).from).toBe(after + 1) // 既有段落行首
    expect(ed.getMarkdown()).toBe('$$\nx+1\n$$\n\n后续文字')
    ed.destroy()
  })

  it('B3 块级公式在文档末尾 → 新起一行（新增段落）且光标在行首', () => {
    const ed = make('$$x$$')
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    expect(saveFormula(ed, 'x+1')).toBe(true)
    expect(childTypes(ed)).toBe('mathBlock,paragraph')
    expect(sel(ed).from).toBe(after + 1)
    expect(sel(ed).empty).toBe(true)
    // 序列化红线：块级仍是 $$\n…\n$$
    expect(ed.getMarkdown()).toBe('$$\nx+1\n$$\n\n')
    ed.destroy()
  })

  it('B4 列表项内块级公式 → 段落插在 listItem 内部，列表项数不变', () => {
    const ed = make({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'item' }] },
                { type: 'mathBlock', attrs: { latex: 'y', id: 'b1' } },
              ],
            },
          ],
        },
      ],
    }, true)
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    expect(saveFormula(ed, 'y+1')).toBe(true)
    const bullet = ed.state.doc.child(0)
    expect(bullet.type.name).toBe('bulletList')
    expect(bullet.childCount).toBe(1) // 不分裂成两个列表项
    expect(bullet.child(0).childCount).toBe(3) // paragraph, mathBlock, paragraph
    expect(sel(ed).from).toBe(after + 1)
    ed.destroy()
  })

  it('B5 引用块内块级公式 → 段落插在 blockquote 内部', () => {
    const ed = make({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'q' }] },
            { type: 'mathBlock', attrs: { latex: 'z', id: 'b2' } },
          ],
        },
      ],
    }, true)
    const m = findMath(ed)!
    const after = m.pos + m.nodeSize
    expect(saveFormula(ed, 'z+1')).toBe(true)
    expect(ed.state.doc.child(0).type.name).toBe('blockquote')
    expect(ed.state.doc.child(0).childCount).toBe(3)
    expect(sel(ed).from).toBe(after + 1)
    ed.destroy()
  })

  it('B6 连续两次编辑同一块级公式 → 幂等（不累积空段落、光标落点稳定）', () => {
    const ed = make('$$x$$')
    const after = findMath(ed)!.pos + findMath(ed)!.nodeSize
    expect(saveFormula(ed, 'a')).toBe(true)
    const first = { children: childTypes(ed), from: sel(ed).from }
    expect(saveFormula(ed, 'b')).toBe(true)
    const second = { children: childTypes(ed), from: sel(ed).from }
    expect(second).toEqual(first)
    expect(first.from).toBe(after + 1)
    expect(ed.getMarkdown()).toBe('$$\nb\n$$\n\n')
    ed.destroy()
  })

  it('B7 只读闸门：editable=false 时不派发事务（latex/选区均不变）', () => {
    const ed = make('前文 $x$ 后文')
    ed.setEditable(false)
    const before = sel(ed)
    expect(ed.isEditable).toBe(false)
    expect(saveFormulaGuarded(ed, 'x+9')).toBe(false) // EditorArea 同款闸门
    expect(findMath(ed)!.latex).toBe('x') // latex 未被改写
    expect(sel(ed)).toEqual(before)
    ed.destroy()
  })

  it('B8 撤销一次即回到编辑前（内容 + 新增段落一起回退）', () => {
    // 行内
    const ed1 = make('前文 $x$ 后文')
    saveFormula(ed1, 'x+1')
    expect(ed1.getMarkdown()).toBe('前文 $x+1$ 后文')
    ed1.commands.undo()
    expect(ed1.getMarkdown()).toBe('前文 $x$ 后文')
    ed1.destroy()
    // 块级文末：一次撤销复原 latex；新增的空段落同样被这一撤销回退
    // （undo 后 trailingNode 会再补一个空段落——这是插件既有行为，非本次引入）
    const ed2 = make('$$x$$')
    saveFormula(ed2, 'x+1')
    expect(childTypes(ed2)).toBe('mathBlock,paragraph')
    expect(ed2.can().undo()).toBe(true)
    ed2.commands.undo()
    expect(findMath(ed2)!.latex).toBe('x') // 内容回退
    expect(ed2.state.doc.children.filter((c) => c.type.name === 'paragraph')).toHaveLength(1) // 无重复空行
    expect(ed2.getMarkdown()).toBe('$$\nx\n$$\n\n')
    expect(ed2.can().undo()).toBe(false) // 只需一次撤销
    ed2.destroy()
  })

  it('B9 空删除（Esc 清空）→ 删除节点且光标落点安全（含「文档唯一块」场景）', () => {
    const ed1 = make('前文 $x$ 后文')
    const m1 = findMath(ed1)!
    expect(deleteFormula(ed1)).toBe(true)
    expect(findMath(ed1)).toBeNull()
    expect(sel(ed1).from).toBe(m1.pos)
    expect(ed1.getMarkdown()).toBe('前文  后文')
    ed1.destroy()

    // 文档里唯一的块被删掉 → 必须补空段落（否则 doc 非法、TextSelection 无处可落）
    const ed2 = make('$$x$$')
    expect(deleteFormula(ed2)).toBe(true)
    expect(ed2.state.doc.childCount).toBeGreaterThan(0)
    expect(ed2.state.doc.child(0).type.name).toBe('paragraph')
    expect(sel(ed2).empty).toBe(true)
    ed2.destroy()
  })

  it('B10 序列化红线：$…$ 与 $$\\n…\\n$$ 输出不变（无 id/attrs 泄漏）', () => {
    const inline = make('前文 $E=mc^2$ 后文')
    saveFormula(inline, 'E=mc^3')
    expect(inline.getMarkdown()).toBe('前文 $E=mc^3$ 后文')
    inline.destroy()

    const block = make('$$\nE = mc^2\n$$')
    saveFormula(block, 'E = mc^3')
    const md = block.getMarkdown()
    expect(md).toContain('$$\nE = mc^3\n$$')
    expect(md).not.toContain('id')
    expect(md).not.toContain('data-')
    block.destroy()
  })

  it('B11 真实载入基线（trailingNode 已补空段落、载入已清历史）：保存 + 一次撤销后 doc JSON 深度相等', () => {
    // app 路径：setKeContent 事务载入 → trailingNode 补出尾段落；随后 clearUndoRedoHistory 清空历史
    // （editor/index.ts:320-339）。故模态打开时的基线 = [mathBlock, paragraph]，且历史为空。
    const ed = make({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'x', id: '' } },
        { type: 'paragraph' },
      ],
    }, true)
    expect(childTypes(ed)).toBe('mathBlock,paragraph')
    const before = JSON.stringify(ed.getJSON())
    expect(saveFormula(ed, 'x+1')).toBe(true)
    expect(JSON.stringify(ed.getJSON())).not.toBe(before)
    ed.commands.undo()
    expect(JSON.stringify(ed.getJSON())).toBe(before) // 一次撤销 → doc JSON 深度相等
    expect(ed.can().undo()).toBe(false) // 保存只产生 1 个撤销步
    ed.destroy()
  })

  it('B12 原子性与只读零事务：一次保存 = 恰好 1 个事务；只读态 save/delete 均 0 事务', () => {
    const ed = make('前文 $x$ 后文')
    let count = 0
    const onTr = (): void => {
      count++
    }
    ed.on('transaction', onTr)

    expect(saveFormula(ed, 'x+1')).toBe(true)
    expect(count).toBe(1) // 一次保存 = 恰好 1 个事务（.focus() 不派发）

    ed.setEditable(false)
    const docBefore = JSON.stringify(ed.getJSON())
    const selBefore = sel(ed)
    expect(saveFormulaGuarded(ed, 'x+2')).toBe(false)
    expect(deleteFormulaGuarded(ed)).toBe(false)
    expect(count).toBe(1) // 只读态：save/delete 两条路径都是零事务
    expect(JSON.stringify(ed.getJSON())).toBe(docBefore)
    expect(sel(ed)).toEqual(selBefore)

    ed.off('transaction', onTr)
    ed.destroy()
  })
})
