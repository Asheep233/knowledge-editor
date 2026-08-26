/**
 * HTML 保真节点（P1-2）：普通 HTML 注释 / HTML 块被 marked 归为 html token 后，
 * @tiptap/markdown 的 parseHTMLToken 会走 DOMParser + schema 解析——注释被整体丢弃、
 * 标准标签块只留内容。这里注册保真节点：解析时保留原始 raw，序列化时原样输出。
 *
 * 三个节点：
 * - keHtmlComment（块级）：独占行的普通 `<!-- 注释 -->`
 * - keHtmlBlock（块级）：完整 HTML 块 `<div>...</div>`
 * - keHtmlCommentInline（行内）：段落中的 `<!-- 注释 -->`
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import {
  htmlBlockTokenizer,
  htmlCommentBlockTokenizer,
  htmlCommentInlineTokenizer,
} from '../tokenizers'

export interface HtmlFidelityAttrs {
  raw: string
}

/** 块级：普通 HTML 注释（独占行） */
export const HtmlCommentExtension = Node.create({
  name: 'keHtmlComment',
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
        tag: 'div[data-ke-html-comment]',
        getAttrs: (el) => ({
          raw: (el as HTMLElement).getAttribute('data-ke-html-comment') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as HtmlFidelityAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-html-comment': a.raw,
        class: 'ke-html-fidelity rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] font-mono text-slate-500',
        title: 'HTML 注释（原样保留）',
      }),
      a.raw,
    ]
  },

  markdownTokenName: 'html_comment',
  markdownTokenizer: htmlCommentBlockTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'keHtmlComment',
    attrs: { raw: (token.raw as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => (attrs as HtmlFidelityAttrs)?.raw ?? '',
})

/** 块级：完整 HTML 块（行首开标签 + 同名闭标签） */
export const HtmlBlockExtension = Node.create({
  name: 'keHtmlBlock',
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
        tag: 'div[data-ke-html-block]',
        getAttrs: (el) => ({
          raw: (el as HTMLElement).getAttribute('data-ke-html-block') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as HtmlFidelityAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-html-block': a.raw,
        class: 'ke-html-fidelity rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] font-mono text-slate-600',
        title: 'HTML 块（原样保留）',
      }),
      a.raw,
    ]
  },

  markdownTokenName: 'html_block',
  markdownTokenizer: htmlBlockTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'keHtmlBlock',
    attrs: { raw: (token.raw as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => (attrs as HtmlFidelityAttrs)?.raw ?? '',
})

/** 行内：段落中的普通 HTML 注释 */
export const HtmlCommentInlineExtension = Node.create({
  name: 'keHtmlCommentInline',
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
        tag: 'span[data-ke-html-comment]',
        getAttrs: (el) => ({
          raw: (el as HTMLElement).getAttribute('data-ke-html-comment') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as HtmlFidelityAttrs
    return [
      'code',
      mergeAttributes(HTMLAttributes, {
        'data-ke-html-comment': a.raw,
        class: 'ke-html-fidelity-inline rounded bg-slate-100 px-1 text-[12px] font-mono text-slate-500',
      }),
      a.raw,
    ]
  },

  markdownTokenName: 'html_comment_inline',
  markdownTokenizer: htmlCommentInlineTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'keHtmlCommentInline',
    attrs: { raw: (token.raw as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => (attrs as HtmlFidelityAttrs)?.raw ?? '',
})
