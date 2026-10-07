/**
 * 块级序列化连接（D-1 / ADD-3，规范 `docs/document-format.md` §2.6）。
 *
 * 背景：F-1 注册 `TaskList`/`TaskItem` 后，混排列表（`- [x] a` + `- b` + `- [ ] c`）
 * 在文档模型里是**三个不同类型的相邻块**（taskList / bulletList / taskList）；
 * `Document` 与 `Blockquote` 的默认 markdown 渲染在子块之间固定插 `\n\n` → 每项之间多一个空行
 * （tight → loose，与源文不一致）。
 *
 * 本模块在**序列化层**对「相邻且至少一侧是任务列表的列表块」改用单个 `\n` 连接：
 * - 混排列表因此保持紧凑；
 * - 段落分隔的两个列表仍是两个块（中间有段落，不满足相邻条件）→ 不受影响；
 * - 纯普通松散列表（`- a\n\n- b`）在解析期就已是一个 bulletList → 行为完全不变（ADD-3 控制项）；
 * - 文档模型不变、不碰 `ke-*`、不新增节点类型。
 */
import { Blockquote } from '@tiptap/extension-blockquote'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Document } from '@tiptap/extension-document'
import type { JSONContent } from '@tiptap/core'

type BlockNode = JSONContent | { type: { name: string } }

/** 列表块类型名（顺序无关） */
const LIST_BLOCK_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/** PM Node 与 JSONContent 两种形态下取节点类型名 */
function typeName(node: BlockNode | undefined): string {
  if (!node) return ''
  const t = (node as { type?: unknown }).type
  if (typeof t === 'string') return t
  if (t && typeof (t as { name?: unknown }).name === 'string') return (t as { name: string }).name
  return ''
}

/** 子块数组（PM Fragment 或 JSONContent[] 均可） */
function childNodes(node: { content?: unknown }): BlockNode[] {
  const content = node.content
  if (Array.isArray(content)) return content as BlockNode[]
  const out: BlockNode[] = []
  ;(content as { forEach?: (fn: (n: unknown) => void) => void } | undefined)?.forEach?.((n) => out.push(n as BlockNode))
  return out
}

/** 相邻列表块之间是否紧凑连接（单个 `\n`）：两侧都是列表块，且至少一侧是任务列表 */
function compactJoin(prev: BlockNode | undefined, next: BlockNode | undefined): boolean {
  const a = typeName(prev)
  const b = typeName(next)
  return LIST_BLOCK_TYPES.has(a) && LIST_BLOCK_TYPES.has(b) && (a === 'taskList' || b === 'taskList')
}

interface RenderHelpers {
  renderChildren?: (nodes: unknown, separator?: string) => string
  renderChild?: (node: unknown, index: number) => string
}

function renderOne(helpers: RenderHelpers, child: BlockNode, index: number): string {
  if (typeof helpers.renderChild === 'function') return helpers.renderChild(child, index)
  return helpers.renderChildren ? helpers.renderChildren([child], '') : ''
}

/** 以「相邻混排列表紧凑」规则渲染块级子节点 */
function renderBlockChildren(node: { content?: unknown }, helpers: RenderHelpers): string {
  const children = childNodes(node)
  return children
    .map((child, i) => {
      const rendered = renderOne(helpers, child, i)
      if (i === 0) return rendered
      return (compactJoin(children[i - 1], child) ? '\n' : '\n\n') + rendered
    })
    .join('')
}

/** 文档根：子块默认 `\n\n`，相邻混排列表之间用 `\n`（D-1） */
export const KeDocument = Document.extend({
  renderMarkdown(node, helpers) {
    if (!node.content) return ''
    return renderBlockChildren(node as { content?: unknown }, helpers as RenderHelpers)
  },
})

/** 引用块：默认每行 `>` 前缀、子块间 `\n>\n`；相邻混排列表之间收紧为单换行（ADD-3） */
export const KeBlockquote = Blockquote.extend({
  renderMarkdown(node, helpers) {
    if (!node.content) return ''
    const h = helpers as RenderHelpers
    const children = childNodes(node as { content?: unknown })
    return children
      .map((child, i) => {
        const prefixed = renderOne(h, child, i)
          .split('\n')
          .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
          .join('\n')
        if (i === 0) return prefixed
        return (compactJoin(children[i - 1], child) ? '\n' : '\n>\n') + prefixed
      })
      .join('')
  },
  addKeyboardShortcuts() {
      const deleteEmptyAfterAtom = (): boolean => {
        const { state, view } = this.editor
        const sel = state.selection
        if (!sel.empty) return false
        const $from = sel.$from
        const para = $from.parent
        if (para.type.name !== 'paragraph' || para.content.size !== 0) return false
        const depth = $from.depth

        // ① 容器内（如引用块）：空段落紧跟在 atom 之后
        if (depth >= 2) {
          const idx = $from.index(depth - 1)
          if (idx <= 0 || !isAtomNode($from.node(depth - 1).child(idx - 1))) return false
          const start = $from.before(depth)
          const tr = state.tr.delete(start, start + para.nodeSize)
          tr.setSelection(TextSelection.create(tr.doc, prevTextblockEnd(tr.doc, start)))
          view.dispatch(tr)
          return true
        }
        // 仅接管「容器内、atom 之后的空段落」这一条用户复现路径。
        // 文档级空段落（容器之后）不接管：那里 ProseMirror 默认 join 的方向相反，
        // 且 trailingNode 契约要求文末必有段落 —— 改动收益低、风险高（可能落到 atom 前
        // 导致下一次 Backspace 删掉公式），故交回默认行为。
        return false
      }

      return { Backspace: deleteEmptyAfterAtom }
    },
})

/**
 * task-59：容器内「atom 之后紧跟空段落」的 Backspace 横跳修复。
 *
 * 复现（用户实测，`数学分析习题 Week 3 Day 2.md`）：`blockquote[段落, mathBlock, 空段落]`，
 * 光标在空段落上反复按 Backspace：
 *   - 第 1 次：空段落被 **lift 出引用块**（1 个事务，steps=1）；
 *   - 第 2 次：ProseMirror `joinBackward` 把这个文档级空段落 **又 join 回引用块**
 *     （1 次按键 3 个事务，最后 1 个 docChanged=true）→ 结构与光标**回到原点**；
 *   - 第 3 次重复第 1 次 …… → 净变化 0，光标 8↔9 反复横跳。
 * 对照：前一块是**普通段落**时，第 2 次 Backspace 不会重新 join（PM 无块可并入），
 * 故只有「atom（如 mathBlock）+ 其后空段落」这一组合会振荡。
 *
 * 修法：该组合下 Backspace 直接**删除这个空段落**（一次按键 = 一次单调变化），
 * 光标落到删除点之前最近的文本位置；不再依赖 lift ↔ join 的往返。
 * 其余情形一律返回 false，交回 ProseMirror 默认行为（不改动既有语义）。
 */
function isAtomNode(node: { isAtom?: boolean } | null | undefined): boolean {
  return Boolean(node && node.isAtom)
}

/** 删除点 `pos` 之前**最近的文本块末尾**（光标落点；找不到则退回 pos）。
 *  目的：删掉空行后光标回到上一行文字末尾，而不是停在容器层级——
 *  否则下一次 Backspace 会直接删掉前面的 atom（如公式），属不可接受的副作用。 */
function prevTextblockEnd(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const container = $pos.node(d)
    const idx = $pos.index(d)
    for (let i = idx - 1; i >= 0; i--) {
      const child = container.child(i)
      if (child.isTextblock) return $pos.posAtIndex(i, d) + 1 + child.content.size
    }
  }
  return pos
}
