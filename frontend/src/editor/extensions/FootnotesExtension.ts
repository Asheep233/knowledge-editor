/**
 * 脚注列表节点（Phase 3：Footnote 系统优化）。
 * 参考栏不再是「## 参考」标题检测，而是 Document Model 中的独立块级节点：
 *
 * Document
 * ├── 正文节点（含 footnote 行内引用 [n]）
 * └── footnotes 节点（脚注列表，内容可编辑）
 *
 * Markdown 使用唯一标记区域：
 * <!-- ke-footnotes:start -->
 * <!-- ke-footnote-item: {"id":"..","n":1,"text":".."} -->
 * <!-- ke-footnotes:end -->
 *
 * 特点：
 * - 正文中出现「## 参考」标题不再影响脚注（无标题检测）
 * - 多次打开不会重复生成（区域是唯一表示，解析即恢复）
 * - 脚注内容在 NodeView 中就地编辑
 */
import { Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import FootnotesNodeView from '../../components/editor/nodeviews/FootnotesNodeView'
import { footnotesBlockTokenizer } from '../tokenizers'

export interface FootnoteItem {
  id: string
  n: number
  text: string
}

export interface FootnotesAttrs {
  items: FootnoteItem[]
}

export const FootnotesExtension = Node.create({
  name: 'footnotes',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      items: { default: [] as FootnoteItem[] },
    }
  },

  parseHTML() {
    return []
  },

  renderHTML() {
    return ['div', { 'data-ke-footnotes': 'true' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnotesNodeView)
  },

  markdownTokenName: 'ke_footnotes',
  markdownTokenizer: footnotesBlockTokenizer,
  parseMarkdown: (token: MarkdownToken) => {
    const items = (token.items as Array<Record<string, unknown>>) ?? []
    return {
      type: 'footnotes',
      attrs: {
        items: items
          .map((it) => ({
            id: String(it.id ?? ''),
            n: Number(it.n) || 0,
            text: String(it.text ?? ''),
          }))
          .filter((it) => it.id),
      },
    }
  },
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as FootnotesAttrs) ?? { items: [] as FootnoteItem[] }
    const items = Array.isArray(a.items) ? a.items : []
    const lines = items
      .map((it) => `<!-- ke-footnote-item: ${JSON.stringify({ id: it.id, n: it.n, text: it.text })} -->`)
      .join('\n')
    return `<!-- ke-footnotes:start -->\n${lines}\n<!-- ke-footnotes:end -->`
  },
})
