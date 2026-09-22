/**
 * task-49（v1.2.1）：行内公式 ⇄ 行间公式互转。
 *
 * 口径（主理人已拍板，不得改）：
 *  1. 行内 → 行间：不自动打开公式编辑器；块插在原段落之后；**光标放在新块之后**
 *     （新块是文档末尾节点 → 先补一个空段落承载光标）；清理段内残留双空格。
 *  2. 行间 → 行内：**多行 LaTeX 直接拒绝**（文档零改动，只返回原因供上层提示）；
 *     否则删除块，追加到**上一段落末尾**（上一兄弟是列表项/引用块/标题 → 进其内部
 *     最后一个 textblock 末尾；无上一段落 → 在块原位置新建段落承载）；光标紧贴公式之后。
 *  3. 两者都是**单事务**（一次撤销回原状）；只读态 0 事务；定位失败 0 事务。
 *
 * ⚠️ 本模块由 **EditorArea** 调用（NodeView 是独立 React 根，事务必须在编辑器根发起 → 坑 1/#300）。
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { newId } from '../ke'
import { locateMathById } from './cursor'

export type ConvertTo = 'block' | 'inline'

/**
 * 事件常量定义在本模块（而不是 MathNodeView）：
 * 多处 verify 套件会 mock `MathNodeView` 模块（只提供 MATH_EDIT_EVENT），
 * 把新常量挂在那里会让那些 mock 缺导出而崩溃。这里 NodeView 与 EditorArea 都从本模块取。
 */
export const MATH_CONVERT_EVENT = 'ke:math-convert-request'

export interface ConvertRequest {
  /** 公式节点 id（主定位） */
  id: string
  /** 兜底位置（NodeView mount 期 getPos 快照可能过期） */
  pos: number
  to: ConvertTo
  isBlock?: boolean
}

export type ConvertResult =
  | { ok: true }
  | { ok: false; reason: 'readonly' | 'not-found' | 'multiline'; message?: string }

/** 多行 LaTeX（换行即拒绝转行内） */
const MULTILINE_RE = /\r?\n/

/** 光标放到某个块级节点之后；块后无后继节点时补一个空段落承载 */
function placeCursorAfterBlock(tr: Transaction, after: number): void {
  if (after >= tr.doc.content.size) {
    tr.insert(after, tr.doc.type.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1))
    return
  }
  try {
    // 后继是 textblock → 落在其行首；后继仍是原子块 → 由 near 向后找最近可落点
    tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1))
  } catch {
    tr.insert(after, tr.doc.type.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1))
  }
}

/** `before` 之前最后一个 textblock 的**内容末端**（可插入行内节点的位置）；无 → null */
function lastTextblockEndBefore(doc: PMNode, before: number): number | null {
  let end: number | null = null
  doc.nodesBetween(0, Math.max(0, Math.min(before, doc.content.size)), (node, pos) => {
    if (node.isTextblock) end = pos + 1 + node.content.size
  })
  return end
}

/** 行内 → 行间（单事务） */
export function convertInlineToBlock(editor: Editor, req: { id: string; pos: number }): ConvertResult {
  if (!editor.isEditable) return { ok: false, reason: 'readonly' }
  // 定位失败/目标不是行内公式 → **不进命令**（tiptap 的 command 在回调返回 false 时仍会派发空事务）
  const found = locateMathById(editor.state.doc, req.id, req.pos)
  const target0 = found >= 0 ? editor.state.doc.nodeAt(found) : null
  if (!target0 || target0.type.name !== 'math') return { ok: false, reason: 'not-found' }
  let result: ConvertResult = { ok: false, reason: 'not-found' }
  editor.commands.command(({ tr }) => {
    const target = locateMathById(tr.doc, req.id, req.pos)
    const node = target >= 0 ? tr.doc.nodeAt(target) : null
    if (!node || node.type.name !== 'math') return false
    const latex = (node.attrs.latex as string) ?? ''
    const $p = tr.doc.resolve(target)
    const paraStart = $p.before($p.depth)
    const paraEnd = $p.after($p.depth)

    let removed = node.nodeSize
    tr.delete(target, target + node.nodeSize)
    // 双空格清理：删除点两侧都是空格 → 再删一个（不留 `a  b`）
    const size = tr.doc.content.size
    if (
      target - 1 >= 0 &&
      target + 1 <= size &&
      tr.doc.textBetween(target - 1, target) === ' ' &&
      tr.doc.textBetween(target, target + 1) === ' '
    ) {
      tr.delete(target - 1, target)
      removed += 1
    }

    const mathBlock = tr.doc.type.schema.nodes.mathBlock.create({ latex, id: newId() })
    const paraEmpty = (tr.doc.nodeAt(paraStart)?.content.size ?? 1) === 0
    let blockPos: number
    if (paraEmpty) {
      // 段落被移除后为空 → 用块取代它（避免留下空行）
      tr.delete(paraStart, paraEnd - removed)
      blockPos = paraStart
      tr.insert(blockPos, mathBlock)
    } else {
      blockPos = paraEnd - removed
      tr.insert(blockPos, mathBlock)
    }
    placeCursorAfterBlock(tr, blockPos + mathBlock.nodeSize)
    result = { ok: true }
    return true
  })
  return result
}

/** 行间 → 行内（单事务；多行 → 拒绝且不动文档） */
export function convertBlockToInline(editor: Editor, req: { id: string; pos: number }): ConvertResult {
  if (!editor.isEditable) return { ok: false, reason: 'readonly' }
  const found = locateMathById(editor.state.doc, req.id, req.pos)
  const node = found >= 0 ? editor.state.doc.nodeAt(found) : null
  if (!node || node.type.name !== 'mathBlock') return { ok: false, reason: 'not-found' }
  const latex = (node.attrs.latex as string) ?? ''
  if (MULTILINE_RE.test(latex)) {
    return {
      ok: false,
      reason: 'multiline',
      message: '该公式为多行 LaTeX，无法转为行内公式（文档未改动）。',
    }
  }
  let ok = false
  editor.commands.command(({ tr }) => {
    const target = locateMathById(tr.doc, req.id, req.pos)
    const n = target >= 0 ? tr.doc.nodeAt(target) : null
    if (!n || n.type.name !== 'mathBlock') return false
    const raw = (n.attrs.latex as string) ?? ''
    if (MULTILINE_RE.test(raw)) return false
    const inline = tr.doc.type.schema.nodes.math.create({ latex: raw, id: newId() })
    tr.delete(target, target + n.nodeSize)
    const anchorEnd = lastTextblockEndBefore(tr.doc, target)
    if (anchorEnd !== null) {
      tr.insert(anchorEnd, inline)
      tr.setSelection(TextSelection.near(tr.doc.resolve(anchorEnd + inline.nodeSize), 1))
    } else {
      // 文档开头就是行间块（无上一段落）→ 新建段落承载，放在块原位置
      const para = tr.doc.type.schema.nodes.paragraph.create(null, inline)
      tr.insert(0, para)
      tr.setSelection(TextSelection.near(tr.doc.resolve(1 + inline.nodeSize), 1))
    }
    ok = true
    return true
  })
  return ok ? { ok: true } : { ok: false, reason: 'not-found' }
}
