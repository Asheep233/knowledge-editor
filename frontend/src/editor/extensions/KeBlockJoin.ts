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
})
