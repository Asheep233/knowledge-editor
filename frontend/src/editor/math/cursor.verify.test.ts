/**
 * 独立对抗验证套件 —— 项②「公式编辑后的光标落点」（task-28）
 * 本副本用于**第二段实测**（与仓库内骨架文件同源）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TextSelection } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from '../extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from '../extensions/HtmlPassthroughExtension'
import { MathExtension } from '../extensions/MathExtension'
import { MathBlockExtension } from '../extensions/MathBlockExtension'
import { OrderedListParenExtension, KeListItem } from '../extensions/ListExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from '../extensions/TableMarkdownExtension'
import { applyMathDeleteCursor, applyMathSaveCursor, isMathNode, locateMathById, planMathCursorAfterSave } from './cursor'

export const MATH_EXTENSIONS = [
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    link: { openOnClick: false, autolink: true },
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  MathExtension,
  MathBlockExtension,
  OrderedListParenExtension,
  KeListItem,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

const mInline = (id: string, latex = 'x'): JSONContent => ({ type: 'math', attrs: { latex, id } })
const mBlock = (id: string, latex = 'x'): JSONContent => ({ type: 'mathBlock', attrs: { latex, id } })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const t = (text: string): JSONContent => ({ type: 'text', text })
const h = (level: number, text: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
})
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

export function editorFromJson(json: JSONContent): Editor {
  const ed = new Editor({ extensions: MATH_EXTENSIONS })
  ed.commands.setContent(json, { emitUpdate: false })
  return ed
}

export function editorFromMarkdown(md: string): Editor {
  return new Editor({ extensions: MATH_EXTENSIONS, content: md, contentType: 'markdown' })
}

/**
 * 隔离 trailingNode 的编辑器（仅用于撤销原子性断言）：
 * 生产开着 trailingNode，它会在**任何事务之后**给非段落末块补一个空段落，
 * 使「撤销是否回退了事务内插入的段落」无法区分。此模式关闭该插件，断言才是无歧义的。
 */
export const MATH_EXTENSIONS_ISOLATED = [
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    trailingNode: false,
    link: { openOnClick: false, autolink: true },
  }),
  MathExtension,
  MathBlockExtension,
  OrderedListParenExtension,
  KeListItem,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

export function editorIsolated(md: string): Editor {
  return new Editor({ extensions: MATH_EXTENSIONS_ISOLATED, content: md, contentType: 'markdown' })
}

export function withTransactionCounter(ed: Editor): { count: () => number; stop: () => void } {
  let n = 0
  const onTr = (): void => {
    n++
  }
  ed.on('transaction', onTr)
  return {
    count: () => n,
    stop: () => ed.off('transaction', onTr),
  }
}

export function saveLikeProduction(ed: Editor, id: string, pos: number, isBlock: boolean, latex: string): boolean {
  // 复刻 EditorArea 生产序（task-34 后）：只读闸门 → 目标预判（严格 0 事务）→ chain 事务
  if (!ed.isEditable) return false
  const target = locateMathById(ed.state.doc, id, pos)
  if (!isMathNode(ed.state.doc.nodeAt(target))) return false
  let applied = false
  ed.chain()
    .command(({ tr }) => {
      applied = applyMathSaveCursor(tr, target, isBlock, latex)
      return applied
    })
    .focus()
    .run()
  return applied
}

export function deleteLikeProduction(ed: Editor, id: string, pos: number): boolean {
  if (!ed.isEditable) return false
  const target = locateMathById(ed.state.doc, id, pos)
  if (!isMathNode(ed.state.doc.nodeAt(target))) return false
  let applied = false
  ed.chain()
    .command(({ tr }) => {
      applied = applyMathDeleteCursor(tr, target)
      return applied
    })
    .focus()
    .run()
  return applied
}

export function blockTypes(json: JSONContent): string[] {
  return (json.content ?? []).map((n) => n.type ?? '?')
}

export function collect(json: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (n: JSONContent): void => {
    if (n.type === type) out.push(n)
    for (const c of n.content ?? []) walk(c)
  }
  walk(json)
  return out
}

export function readEditorAreaSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8')
}

export function textCaretAt(ed: Editor, pos: number): boolean {
  const sel = ed.state.selection
  return sel instanceof TextSelection && sel.from === pos && sel.empty
}

/** getJSON() 的返回类型在 tiptap v3 下不便直接索引 → 统一转 JSONContent */
export function jsonOf(ed: Editor): JSONContent {
  return ed.getJSON() as unknown as JSONContent
}

/** 第一个指定类型公式节点的 pos（markdown 解析出来的节点 id 为空，不能按 id 定位） */
export function firstMathPos(ed: Editor, type: 'math' | 'mathBlock'): number {
  let pos = -1
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === type) {
      pos = p
      return false
    }
    return true
  })
  return pos
}

describe('A 规划层', () => {
  it('A1 行内（段中）→ 不插、selectionPos=pos+nodeSize', () => {
    const ed = editorFromJson(doc(p(t('前文 '), mInline('i1'), t(' 后文'))))
    const pos = locateMathById(ed.state.doc, 'i1', -1)
    const plan = planMathCursorAfterSave(ed.state.doc, pos, false)
    expect(plan.insertParagraphAt).toBe(-1)
    expect(plan.selectionPos).toBe(pos + 1)
  })

  it('A2 行内（段末/段首/标题内）→ selectionPos=pos+nodeSize 且不越界', () => {
    const ed1 = editorFromJson(doc(p(t('前文'), mInline('i1'))))
    const p1 = locateMathById(ed1.state.doc, 'i1', -1)
    expect(planMathCursorAfterSave(ed1.state.doc, p1, false).selectionPos).toBe(p1 + 1)
    const ed2 = editorFromJson(doc(p(mInline('i2'), t('后文'))))
    const p2 = locateMathById(ed2.state.doc, 'i2', -1)
    expect(planMathCursorAfterSave(ed2.state.doc, p2, false).selectionPos).toBe(p2 + 1)
    const ed3 = editorFromJson(
      doc({ type: 'heading', attrs: { level: 2 }, content: [t('标题'), mInline('i3')] }),
    )
    const p3 = locateMathById(ed3.state.doc, 'i3', -1)
    const plan3 = planMathCursorAfterSave(ed3.state.doc, p3, false)
    expect(plan3.insertParagraphAt).toBe(-1)
    expect(plan3.selectionPos).toBe(p3 + 1)
  })

  it('A3 块级 + 后继空段落 → 复用（不插）、selectionPos=after+1', () => {
    const ed = editorFromJson(doc(mBlock('b1'), p()))
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    const plan = planMathCursorAfterSave(ed.state.doc, pos, true)
    expect(plan.insertParagraphAt).toBe(-1)
    expect(plan.selectionPos).toBe(pos + 1 + 1)
  })

  it('A4 块级 + 后继非空段落 → 裁决：复用段落行首（不插空行）', () => {
    const ed = editorFromJson(doc(mBlock('b1'), p(t('后续文字'))))
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    const plan = planMathCursorAfterSave(ed.state.doc, pos, true)
    expect(plan.insertParagraphAt).toBe(-1)
    expect(plan.selectionPos).toBe(pos + 1 + 1)
  })

  it('A5 块级 + 后继非段落块（标题/代码块/另一公式）→ 新起一行', () => {
    for (const next of [h(1, '标题'), { type: 'codeBlock', content: [t('code')] }, mBlock('b2')]) {
      const ed = editorFromJson(doc(mBlock('b1'), next))
      const pos = locateMathById(ed.state.doc, 'b1', -1)
      const plan = planMathCursorAfterSave(ed.state.doc, pos, true)
      expect(plan.insertParagraphAt, `next=${String(next.type)}`).toBe(pos + 1)
      expect(plan.selectionPos, `next=${String(next.type)}`).toBe(pos + 2)
    }
  })

  it('A6 块级在文档末尾（无尾段落）→ 新起一行且不越界', () => {
    const ed = editorFromMarkdown('$$\nx\n$$\n')
    expect(ed.state.doc.childCount).toBe(1) // 真实文末场景（new Editor 初始不跑 trailingNode）
    const pos = 0
    const plan = planMathCursorAfterSave(ed.state.doc, pos, true)
    expect(plan.insertParagraphAt).toBe(pos + 1)
    expect(plan.selectionPos).toBe(pos + 2)
  })

  it('A7 listItem 内末尾块级 → 段落插 listItem 内部（不分裂列表项）', () => {
    const ed = editorFromJson(
      doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('项目')), mBlock('b1')] }] }),
    )
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    const plan = planMathCursorAfterSave(ed.state.doc, pos, true)
    expect(plan.insertParagraphAt).toBe(pos + 1)
    const $at = ed.state.doc.resolve(plan.insertParagraphAt)
    expect($at.parent.type.name).toBe('listItem')
    expect(collect(ed.getJSON(), 'listItem')).toHaveLength(1)
  })

  it('A8 blockquote 内末尾块级 → 段落插 blockquote 内部', () => {
    const ed = editorFromJson(doc({ type: 'blockquote', content: [p(t('引用')), mBlock('b1')] }))
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    const plan = planMathCursorAfterSave(ed.state.doc, pos, true)
    const $at = ed.state.doc.resolve(plan.insertParagraphAt)
    expect($at.parent.type.name).toBe('blockquote')
  })

  it('A9 表格单元格内块级公式 → 不抛错、文档仍合法', () => {
    const ed = editorFromJson(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [mBlock('b1')] },
            ],
          },
        ],
      }),
    )
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    expect(() => planMathCursorAfterSave(ed.state.doc, pos, true)).not.toThrow()
    expect(ed.state.doc.childCount).toBeGreaterThan(0)
  })

  it('A10 pos 越界 / 负值 / NaN → 不抛、安全位置', () => {
    const ed = editorFromJson(doc(p(t('正文'))))
    for (const bad of [-5, 9999, Number.NaN]) {
      const plan = planMathCursorAfterSave(ed.state.doc, bad, true)
      expect(plan.insertParagraphAt, `pos=${bad}`).toBe(-1)
      expect(plan.selectionPos, `pos=${bad}`).toBeGreaterThanOrEqual(0)
      expect(plan.selectionPos, `pos=${bad}`).toBeLessThanOrEqual(ed.state.doc.content.size + 2)
    }
  })

  it('A11 nodeAt(pos) 指向非 math 节点 → applyMath* 返回 false', () => {
    const ed = editorFromJson(doc(p(t('正文'))))
    let saveRet = true
    let delRet = true
    ed.commands.command(({ tr }) => {
      saveRet = applyMathSaveCursor(tr, 1, false, 'zzz')
      delRet = applyMathDeleteCursor(tr, 1)
      return false
    })
    expect(saveRet).toBe(false)
    expect(delRet).toBe(false)
  })

  it('A12 isBlock 与节点真实类型不一致 → 不抛、文档合法', () => {
    const ed = editorFromJson(doc(mBlock('b1')))
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    expect(() => planMathCursorAfterSave(ed.state.doc, pos, false)).not.toThrow()
    const ed2 = editorFromJson(doc(p(mInline('i1'))))
    const pos2 = locateMathById(ed2.state.doc, 'i1', -1)
    expect(() => planMathCursorAfterSave(ed2.state.doc, pos2, true)).not.toThrow()
  })

  it('A13/A14 locateMathById：id 优先、回退 pos、无效 -1', () => {
    const ed = editorFromJson(doc(mBlock('b1'), p(t('后续'))))
    const real = locateMathById(ed.state.doc, 'b1', -1)
    expect(locateMathById(ed.state.doc, 'b1', 999)).toBe(real)
    expect(locateMathById(ed.state.doc, 'nope', 4)).toBe(4)
    expect(locateMathById(ed.state.doc, 'nope', Number.NaN)).toBe(-1)
    expect(locateMathById(ed.state.doc, undefined, 4)).toBe(4)
  })

  it('A15 重复 id → 取文档序第一个（确定性）', () => {
    const ed = editorFromJson(doc(mBlock('dup'), p(t('中间')), mBlock('dup')))
    const first = locateMathById(ed.state.doc, 'dup', -1)
    const second = locateMathById(ed.state.doc, 'dup', first + 1)
    expect(second).toBe(first)
  })
})

describe('B 集成', () => {
  it('B1 行内保存：TextSelection.from===pos+nodeSize', () => {
    const ed = editorFromJson(doc(p(t('前文 '), mInline('i1'), t(' 后文'))))
    const pos = locateMathById(ed.state.doc, 'i1', -1)
    expect(saveLikeProduction(ed, 'i1', pos, false, 'x+1')).toBe(true)
    expect(ed.state.selection).toBeInstanceOf(TextSelection)
    expect(textCaretAt(ed, pos + 1)).toBe(true)
    expect((jsonOf(ed).content?.[0]?.content?.[1]?.attrs as { latex?: string } | undefined)?.latex).toBe('x+1')
  })

  it('B2 块级 + 既有段落：caret 落段落行首且块数不变', () => {
    const ed = editorFromJson(doc(mBlock('b1'), p(t('后续文字'))))
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    const before = blockTypes(ed.getJSON())
    expect(saveLikeProduction(ed, 'b1', pos, true, 'y')).toBe(true)
    expect(blockTypes(ed.getJSON())).toEqual(before)
    expect(textCaretAt(ed, pos + 2)).toBe(true)
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('B3 块级 + 真文末（无尾段落）：新起一行、caret 行首、不抛 RangeError', () => {
    const ed = editorFromMarkdown('$$\nx\n$$\n')
    expect(ed.state.doc.childCount).toBe(1)
    const pos = 0
    expect(() => saveLikeProduction(ed, '', pos, true, 'z')).not.toThrow()
    expect(blockTypes(ed.getJSON())).toEqual(['mathBlock', 'paragraph'])
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(ed.state.selection.empty).toBe(true)
  })

  it('B4 块级后接非段落块：caret 在新段落行首，后继块不变', () => {
    const ed = editorFromMarkdown('$$\nx\n$$\n\n# 标题\n')
    const pos = firstMathPos(ed, 'mathBlock')
    saveLikeProduction(ed, '', pos, true, 'q')
    // 末块为 heading → trailingNode 会再补一个尾段落，故只断言前 3 块
    expect(blockTypes(ed.getJSON()).slice(0, 3)).toEqual(['mathBlock', 'paragraph', 'heading'])
    expect(jsonOf(ed).content?.[2]?.content?.[0]?.text).toBe('标题')
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('B5 列表项内块级：列表项数不变、结构不分裂', () => {
    const ed = editorFromJson(
      doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('项目')), mBlock('b1')] }] }),
    )
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    saveLikeProduction(ed, 'b1', pos, true, 'l')
    expect(collect(ed.getJSON(), 'bulletList')).toHaveLength(1)
    expect(collect(ed.getJSON(), 'listItem')).toHaveLength(1)
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('B6 引用块内块级：blockquote 结构不变', () => {
    const ed = editorFromJson(doc({ type: 'blockquote', content: [p(t('引用')), mBlock('b1')] }))
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    saveLikeProduction(ed, 'b1', pos, true, 'bq')
    expect(collect(ed.getJSON(), 'blockquote')).toHaveLength(1)
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('B7 表格单元格内块级：不崩、表格结构不变', () => {
    const ed = editorFromJson(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [mBlock('b1')] },
            ],
          },
        ],
      }),
    )
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    expect(() => saveLikeProduction(ed, 'b1', pos, true, 'c')).not.toThrow()
    expect(collect(ed.getJSON(), 'table')).toHaveLength(1)
  })

  it('B8 连续两次编辑同一块级公式 → 不累积空段落、caret 稳定', () => {
    const ed = editorFromJson(doc(mBlock('b1')))
    const pos1 = locateMathById(ed.state.doc, 'b1', -1)
    saveLikeProduction(ed, 'b1', pos1, true, 'v1')
    const types1 = blockTypes(ed.getJSON())
    const sel1 = ed.state.selection.from
    const pos2 = locateMathById(ed.state.doc, 'b1', -1)
    saveLikeProduction(ed, 'b1', pos2, true, 'v2')
    expect(blockTypes(ed.getJSON())).toEqual(types1)
    expect(ed.state.selection.from).toBe(sel1)
  })

  it('B9 连续两次编辑同一行内公式 → caret 恒为公式后一位', () => {
    const ed = editorFromJson(doc(p(t('前'), mInline('i1'), t('后'))))
    let pos = locateMathById(ed.state.doc, 'i1', -1)
    saveLikeProduction(ed, 'i1', pos, false, 'a')
    expect(textCaretAt(ed, pos + 1)).toBe(true)
    pos = locateMathById(ed.state.doc, 'i1', -1)
    saveLikeProduction(ed, 'i1', pos, false, 'b')
    expect(textCaretAt(ed, pos + 1)).toBe(true)
  })

  it('B10 只读态 save 路径：零事务，doc/selection 不变', () => {
    const ed = editorFromJson(doc(p(t('前'), mInline('i1'), t('后'))))
    ed.setEditable(false)
    const pos = locateMathById(ed.state.doc, 'i1', -1)
    const before = JSON.stringify(ed.getJSON())
    const selBefore = ed.state.selection.from
    const c = withTransactionCounter(ed)
    const applied = saveLikeProduction(ed, 'i1', pos, false, 'HACK')
    c.stop()
    expect(applied).toBe(false)
    expect(c.count()).toBe(0)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
    expect(ed.state.selection.from).toBe(selBefore)
  })

  it('B11 只读态 delete 路径：零事务', () => {
    const ed = editorFromJson(doc(p(t('前'), mInline('i1')), p(t('后'))))
    ed.setEditable(false)
    const pos = locateMathById(ed.state.doc, 'i1', -1)
    const before = JSON.stringify(ed.getJSON())
    const c = withTransactionCounter(ed)
    const applied = deleteLikeProduction(ed, 'i1', pos)
    c.stop()
    expect(applied).toBe(false)
    expect(c.count()).toBe(0)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  it('B12 源码级：只读闸门 + 目标预判都在 chain 之前（两处回调）', () => {
    const src = readEditorAreaSource()
    const saveAt = src.indexOf('onSave={(v) =>')
    const delAt = src.indexOf('onDeleteEmpty={() =>')
    expect(saveAt).toBeGreaterThan(0)
    expect(delAt).toBeGreaterThan(saveAt)
    const saveBlock = src.slice(saveAt, delAt)
    const delBlock = src.slice(delAt, delAt + 1200)
    for (const [name, blk] of [['onSave', saveBlock], ['onDeleteEmpty', delBlock]] as Array<[string, string]>) {
      expect(blk, `${name} 缺 isEditable 闸门`).toContain('isEditable')
      expect(blk, `${name} 缺 isMathNode 预判`).toContain('isMathNode')
      // 预判必须出现在 chain() 之前
      const preIdx = blk.indexOf('isMathNode')
      const chainIdx = blk.indexOf('.chain()')
      expect(chainIdx, `${name} 未使用 chain`).toBeGreaterThan(0)
      expect(preIdx, `${name} 预判应在 chain 之前`).toBeLessThan(chainIdx)
    }
  })

  it('B13 一次保存 = 恰好 1 个事务', () => {
    const ed = editorFromJson(doc(mBlock('b1'), p(t('后续'))))
    const pos = locateMathById(ed.state.doc, 'b1', -1)
    const c = withTransactionCounter(ed)
    saveLikeProduction(ed, 'b1', pos, true, 'one')
    c.stop()
    expect(c.count()).toBe(1)
  })

  it('B14 撤销一次 → doc JSON 深度等于编辑前（行内）', () => {
    const ed = editorFromMarkdown('前文 $x$ 后文\n')
    const before = JSON.stringify(ed.getJSON())
    const pos = firstMathPos(ed, 'math')
    saveLikeProduction(ed, '', pos, false, 'CHANGED')
    expect(JSON.stringify(ed.getJSON())).not.toBe(before)
    ed.commands.undo()
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  it('B14b 块级撤销（隔离 trailingNode）：新增段落与 latex 一起回退', () => {
    const ed = editorIsolated('$$\nx\n$$\n')
    const before = JSON.stringify(ed.getJSON())
    const pos = firstMathPos(ed, 'mathBlock')
    saveLikeProduction(ed, '', pos, true, 'NEW')
    expect(blockTypes(ed.getJSON())).toEqual(['mathBlock', 'paragraph'])
    ed.commands.undo()
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  it('B15 删除空公式：caret 安全、无 NodeSelection 残留', () => {
    const ed = editorFromJson(doc(p(t('前')), mInline('i1'), p(t('后'))))
    const pos = locateMathById(ed.state.doc, 'i1', -1)
    expect(deleteLikeProduction(ed, 'i1', pos)).toBe(true)
    expect(ed.state.selection).toBeInstanceOf(TextSelection)
    expect(collect(ed.getJSON(), 'math')).toHaveLength(0)
  })

  it('B16 删除文档唯一块（块级公式独占文档）→ doc 仍合法', () => {
    const ed = editorFromJson(doc(mBlock('only')))
    const pos = locateMathById(ed.state.doc, 'only', -1)
    expect(() => deleteLikeProduction(ed, 'only', pos)).not.toThrow()
    expect(ed.state.doc.childCount).toBeGreaterThanOrEqual(1)
    expect(ed.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(ed.state.selection.empty).toBe(true)
  })

  it('B17 目标失效 → 严格 0 事务（生产预判已落地）、doc 不变', () => {
    const ed = editorFromJson(doc(p(t('只有正文'))))
    const before = JSON.stringify(ed.getJSON())
    const c = withTransactionCounter(ed)
    const applied = saveLikeProduction(ed, 'ghost', 1, false, 'X')
    c.stop()
    expect(applied).toBe(false)
    expect(c.count()).toBe(0)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  it('B17b 目标失效（delete 路径）→ 严格 0 事务', () => {
    const ed = editorFromJson(doc(p(t('只有正文'))))
    const before = JSON.stringify(ed.getJSON())
    const c = withTransactionCounter(ed)
    const applied = deleteLikeProduction(ed, 'ghost', 1)
    c.stop()
    expect(applied).toBe(false)
    expect(c.count()).toBe(0)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  it('B18 序列化红线：$x$ / $$\\nx\\n$$ 形式不变、无 id 泄漏、无新增 ke-*', () => {
    const ed = editorFromMarkdown('前文 $x$ 后文\n\n$$\ny\n$$\n')
    const iPos = firstMathPos(ed, 'math')
    const bPos = firstMathPos(ed, 'mathBlock')
    expect(iPos).toBeGreaterThanOrEqual(0)
    expect(bPos).toBeGreaterThanOrEqual(0)
    saveLikeProduction(ed, '', iPos, false, 'x+1')
    saveLikeProduction(ed, '', bPos, true, 'y+1')
    const after = ed.getMarkdown()
    expect(after).toContain('$x+1$')
    expect(after).toContain('$$\ny+1\n$$')
    expect(after).not.toContain('"id"')
    expect(after).not.toMatch(/ke-[a-z]+:/)
  })

  it('B19 latex 含反斜杠时序列化仍可再解析', () => {
    const ed = editorFromJson(doc(p(mInline('i1', 'a\\b')), mBlock('b1', 'c\\nd')))
    const posI = locateMathById(ed.state.doc, 'i1', -1)
    const posB = locateMathById(ed.state.doc, 'b1', -1)
    expect(() => saveLikeProduction(ed, 'i1', posI, false, 'x\\y')).not.toThrow()
    expect(() => saveLikeProduction(ed, 'b1', posB, true, 'p\\nq')).not.toThrow()
    const md = ed.getMarkdown()
    const ed2 = editorFromMarkdown(md)
    expect(collect(ed2.getJSON(), 'math').length).toBeGreaterThanOrEqual(1)
  })

  it('B20 空 latex 保存：不崩、markdown 可再解析', () => {
    const ed = editorFromJson(doc(p(t('前'), mInline('i1', 'x'), t('后'))))
    const pos = locateMathById(ed.state.doc, 'i1', -1)
    saveLikeProduction(ed, 'i1', pos, false, '')
    const md = ed.getMarkdown()
    expect(() => editorFromMarkdown(md)).not.toThrow()
  })

  it('B21 focus 归还后 selection 不被重置到文首', () => {
    const ed = editorFromJson(doc(p(t('前文 '), mInline('i1'), t(' 后文'))))
    const pos = locateMathById(ed.state.doc, 'i1', -1)
    saveLikeProduction(ed, 'i1', pos, false, 'f')
    expect(ed.state.selection.from).toBe(pos + 1)
    console.log('FOCUS-OBS isFocused=' + String(ed.isFocused) + ' hasFocus=' + String(ed.view.hasFocus()))
  })

  it('B22 文末块级连续保存两次：不重复补段落', () => {
    const ed = editorFromJson(doc(p(t('前')), mBlock('b1')))
    const pos1 = locateMathById(ed.state.doc, 'b1', -1)
    saveLikeProduction(ed, 'b1', pos1, true, 'v1')
    const types1 = blockTypes(ed.getJSON())
    const pos2 = locateMathById(ed.state.doc, 'b1', -1)
    saveLikeProduction(ed, 'b1', pos2, true, 'v2')
    expect(blockTypes(ed.getJSON())).toEqual(types1)
  })
})
