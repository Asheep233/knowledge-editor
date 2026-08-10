/**
 * 块级公式节点：$$...$$（独占行）。
 * 独立节点（block, atom），与行内 math 区分，保证 Markdown 往返干净。
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import MathNodeView from '../../components/editor/nodeviews/MathNodeView'
import { newId } from '../ke'
import { mathBlockTokenizer } from '../tokenizers'

export interface MathBlockAttrs {
  latex: string
  id: string
}

export const MathBlockExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: { default: '' },
      id: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-ke-math-block]',
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute('data-latex') ?? '',
          id: (el as HTMLElement).getAttribute('data-id') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as MathBlockAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-math-block': '',
        'data-latex': a.latex,
        'data-id': a.id,
      }),
      `$${a.latex}$`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex, id: newId() } }),
    }
  },

  markdownTokenName: 'math_block',
  markdownTokenizer: mathBlockTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'mathBlock',
    attrs: { latex: (token.latex as string) ?? '', id: (token.id as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => `$$\n${((attrs as MathBlockAttrs)?.latex) ?? ''}\n$$`,
})
