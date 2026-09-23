/**
 * 公式编辑「保存 / Esc 退出 / 空删除」后的光标落点与事务助手。
 *
 * 规范：`docs/design-v1.1.7-math-editor.md` §3.2
 * （2026-09-18 主理人重拍，取代旧「保存后光标回到文档原型位置」）：
 * - 行内公式 → 光标落公式**之后一位**（`pos + node.nodeSize`）
 * - 块级公式 → 其后**已有段落**：光标落该段落**行首**（`nextPos + 1`，不插空行）；
 *   其后**没有**可用段落（文末 / 后接非段落块）→ **新起一行**插空段落，光标落行首
 * - 只读态（`editable === false`）不得触发任何事务——闸门在调用方（EditorArea）
 *
 * ⚠️ 事务必须由 **EditorArea（编辑器根组件）** 在既有 double-rAF 之后发起：
 * MathNodeView 是 tiptap 独立 React 根，在其中触发 PM 事务会 React #300
 * （见 docs/agent-handover-v1.1.8.md §8 坑 1）。本模块只提供纯规划与事务改写，
 * 自身不 dispatch、不持有 editor。
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

export interface MathCursorPlan {
  /** ≥0：在该位置插入一个空段落；-1：不插 */
  insertParagraphAt: number
  /** 事务结束后的光标位置 */
  selectionPos: number
}

/** 公式节点类型名（行内 math / 块级 mathBlock） */
export function isMathNode(node: PMNode | null | undefined): node is PMNode {
  return !!node && (node.type.name === 'math' || node.type.name === 'mathBlock')
}

/**
 * 按节点 id 定位公式。
 *
 * task-50 起为**「pos 优先 + 最近邻」**：
 *  ① `nodeAt(fallbackPos)` 就是该 id 的公式 → 直接返回（点哪个改哪个）；
 *  ② 否则按 id 遍历，**多命中取离 `fallbackPos` 最近的那个**（而非第一个）；
 *  ③ 都没有 → 返回 `fallbackPos`（无效 → -1，调用方据此保持「目标失效严格 0 事务」）。
 *
 * 背景：复制粘贴会保留 `id`，同 id 两节点时旧的「id 优先取首个」会让编辑落到第一行
 * （静默写错节点）。根治去重见 `extensions/MathIdUniqueness.ts`。
 *
 * @returns 公式节点起始位置；-1 = 未找到
 */
export function locateMathById(doc: PMNode, id: string | undefined, fallbackPos: number): number {
  const hasPos = Number.isFinite(fallbackPos) && fallbackPos >= 0
  // ① pos 优先：`nodeAt(fallbackPos)` 就是该 id 的公式 → 直接命中（**点哪个改哪个**）。
  //    task-50：复制粘贴会让两个公式共用同一 id，旧的「id 优先取首个」会把编辑落到第一行。
  if (hasPos && id && fallbackPos <= doc.content.size) {
    // 越界 fallbackPos 不能进 nodeAt（PM 会抛 RangeError）——见下方 ③ 的兜底语义
    const at = doc.nodeAt(fallbackPos)
    if (isMathNode(at) && at.attrs.id === id) return fallbackPos
  }
  // ② 按 id 遍历；多命中取**距离 fallbackPos 最近**的（无 pos 信息时退化为第一个）
  if (id) {
    let target = -1
    let bestDist = Number.POSITIVE_INFINITY
    doc.descendants((node, pos) => {
      if (isMathNode(node) && node.attrs.id && node.attrs.id === id) {
        const dist = hasPos ? Math.abs(pos - fallbackPos) : pos
        if (dist < bestDist) {
          bestDist = dist
          target = pos
        }
      }
      return true
    })
    if (target >= 0) return target
  }
  // ③ 都没有 → 保持既有契约：返回兜底位置（无效则 -1，调用方据此「严格 0 事务」）
  return hasPos ? fallbackPos : -1
}

/**
 * 规划保存后的光标位置（纯函数，可无 DOM 穷举测试）。
 *
 * 计算要点：
 * - 行内：`pos + nodeSize` 恒为所属 textblock 内的合法位置（段末也合法）。
 * - 块级：`doc.nodeAt(after)` 只在「同一父级里的后继兄弟」或「文档级后继块」时返回节点；
 *   若公式是容器（listItem / blockquote / 单元格）内最后一个子块，`after` 落在容器
 *   结束边界之前 → `nodeAt(after) === null` → 走「新起一行」，段落插在**容器内部**，
 *   不会把公式踢出列表/引用块。
 * - 文末块级：不能直接 `after + 1`（= `doc.content.size + 1` 越界，`setSelection` 抛
 *   RangeError）→ 必须显式插段落。
 */
export function planMathCursorAfterSave(doc: PMNode, pos: number, isBlock: boolean): MathCursorPlan {
  // 越界位置：`doc.nodeAt(负)` 会抛错，也不能让 selectionPos 越界 → 先夹到安全区间
  if (!Number.isFinite(pos) || pos < 0 || pos > doc.content.size) {
    const safe = Math.min(Math.max(Number.isFinite(pos) ? pos : 0, 0), doc.content.size)
    return { insertParagraphAt: -1, selectionPos: safe }
  }
  const node = doc.nodeAt(pos)
  if (!node) {
    // 位置合法但落在节点边界之间（文档被外部改写等）：只给一个安全位置，绝不抛错
    return { insertParagraphAt: -1, selectionPos: pos }
  }

  const after = pos + node.nodeSize
  if (!isBlock) return { insertParagraphAt: -1, selectionPos: after }

  // 块级：后继已是段落 → 复用，光标落该段落行首（主理人拍板：不插空行）
  const next = after < doc.content.size ? doc.nodeAt(after) : null
  if (next && next.type.name === 'paragraph') {
    return { insertParagraphAt: -1, selectionPos: after + 1 }
  }

  // 文末 / 后接非段落块 → 新起一行；仅当父节点允许插段落时才插（否则退回公式后一位）
  // 注：`canReplace` 第三参只接受 Fragment（TS2345），此处用等价的 `canReplaceWith(type)`。
  const $after = doc.resolve(Math.min(after, doc.content.size))
  const paragraphType = doc.type.schema.nodes.paragraph
  const canInsert =
    !!paragraphType && $after.parent.canReplaceWith($after.indexAfter(), $after.indexAfter(), paragraphType)
  if (!canInsert) return { insertParagraphAt: -1, selectionPos: after }
  return { insertParagraphAt: after, selectionPos: after + 1 }
}

/** 落光标：`TextSelection.near` 容错（非法位置取最近合法位置，绝不抛 RangeError） */
export function placeCursorNear(tr: Transaction, pos: number): void {
  const safe = Math.min(Math.max(pos, 0), tr.doc.content.size)
  tr.setSelection(TextSelection.near(tr.doc.resolve(safe), 1))
}

/**
 * 事务内执行「改 latex +（块级必要时）新起一行 + 落光标」。
 * 与改动同处**一个事务** → 一次 Ctrl+Z 即回到编辑前（撤销语义：一次编辑 = 一步）。
 * @returns false = 目标位置不是公式节点（调用方不派发）
 */
export function applyMathSaveCursor(tr: Transaction, pos: number, isBlock: boolean, latex: string): boolean {
  const node = tr.doc.nodeAt(pos)
  if (!isMathNode(node)) return false
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex })
  const plan = planMathCursorAfterSave(tr.doc, pos, isBlock)
  if (plan.insertParagraphAt >= 0) {
    tr.insert(plan.insertParagraphAt, tr.doc.type.schema.nodes.paragraph.create())
  }
  placeCursorNear(tr, plan.selectionPos)
  return true
}

/**
 * 事务内删除空公式（Esc / 完成 且内容为空）并落光标。
 * 光标停在原位置；块级在文末时自然落进 trailingNode 补出的段落。
 * @returns false = 目标位置不是公式节点（调用方不派发）
 */
export function applyMathDeleteCursor(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos)
  if (!isMathNode(node)) return false
  tr.delete(pos, pos + node.nodeSize)
  // 删掉文档里最后一个块会让 doc 成为非法空文档（且 TextSelection 无处可落）→ 补一个空段落
  if (tr.doc.childCount === 0) {
    const paragraphType = tr.doc.type.schema.nodes.paragraph
    if (paragraphType) tr.insert(0, paragraphType.create())
  }
  placeCursorNear(tr, pos)
  return true
}
