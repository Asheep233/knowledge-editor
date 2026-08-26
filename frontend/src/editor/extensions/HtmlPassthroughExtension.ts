/**
 * 普通 HTML 保真节点（P1-2）。
 * 对不被任何扩展消费的「HTML 注释」`<!-- ... -->`（非 ke-* 命名空间）与
 * 「HTML 块」`<div ...>内容</div>` 原样保留（raw 存原始文本，保存时原样输出）。
 * 默认行为：这些被 marked 归为 html token，随后被 DOMParser 丢弃（注释整体丢失、
 * 块仅保留文本）。这里注册块级 + 行内 tokenizer 与节点，保证 round-trip 原文不丢。
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { htmlPassthroughBlockTokenizer, htmlPassthroughInlineTokenizer } from '../tokenizers'

export interface HtmlPassthroughAttrs {
  raw: string
}

/** 块级 HTML：独占行的普通 HTML 注释 / HTML 块。 */
export const HtmlPassthroughExtension = Node.create({
  name: 'htmlPassthrough',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      raw: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-ke-html]',
        getAttrs: (el) => ({
          raw: (el as HTMLElement).getAttribute('data-ke-html') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as HtmlPassthroughAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-html': a.raw,
        class:
          'ke-html rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] font-mono text-slate-600',
      }),
      a.raw,
    ]
  },

  markdownTokenName: 'html_passthrough',
  markdownTokenizer: htmlPassthroughBlockTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'htmlPassthrough',
    attrs: { raw: (token.raw as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as HtmlPassthroughAttrs) ?? { raw: '' }
    return a.raw
  },
})

/** 行内 HTML：段落中出现的普通 HTML 注释。 */
export const HtmlPassthroughInlineExtension = Node.create({
  name: 'htmlPassthroughInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ke-html]',
        getAttrs: (el) => ({
          raw: (el as HTMLElement).getAttribute('data-ke-html') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as HtmlPassthroughAttrs
    return [
      'code',
      mergeAttributes(HTMLAttributes, {
        'data-ke-html': a.raw,
        class: 'ke-html-inline rounded bg-slate-100 px-1 text-[12px] font-mono text-slate-600',
      }),
      a.raw,
    ]
  },

  markdownTokenName: 'html_passthrough_inline',
  markdownTokenizer: htmlPassthroughInlineTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'htmlPassthroughInline',
    attrs: { raw: (token.raw as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as HtmlPassthroughAttrs) ?? { raw: '' }
    return a.raw
  },
})
