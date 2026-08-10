/**
 * 行内公式节点（约束 2：真正所见即所得）。
 * 编辑：MathLive <math-field> 可视化编辑；存储：LaTeX。
 * Markdown 往返：$...$（行内）/ $$...$$（块级，见 MathBlockExtension）。
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import MathNodeView from '../../components/editor/nodeviews/MathNodeView'
import { newId } from '../ke'
import { mathInlineTokenizer } from '../tokenizers'

export interface MathAttrs {
  latex: string
  id: string
}

export const MathExtension = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: { default: '' },
      id: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ke-math]',
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute('data-latex') ?? '',
          id: (el as HTMLElement).getAttribute('data-id') ?? '',
        }),
      },
      {
        tag: 'math-field',
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute('value') ?? '',
          id: (el as HTMLElement).getAttribute('data-id') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as MathAttrs
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-ke-math': '',
        'data-latex': a.latex,
        'data-id': a.id,
      }),
      a.latex,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },

  addCommands() {
    return {
      insertMath:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex, id: newId() } }),
    }
  },

  markdownTokenName: 'math_inline',
  markdownTokenizer: mathInlineTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'math',
    attrs: { latex: (token.latex as string) ?? '', id: (token.id as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => `$${((attrs as MathAttrs)?.latex) ?? ''}$`,
})
