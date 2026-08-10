/**
 * 通用兜底节点（Phase 3：未知扩展兼容）。
 * 当遇到未注册的 ke-* 标记（如未来版本新增扩展）时：
 * - 不报错、不删除
 * - 保留原始 Markdown 文本（attrs.raw）
 * - 保存时原样输出，保证旧版本编辑器不会破坏未来版本文档
 *
 * 块级（keFallback）：独占行的未知 ke-* 注释
 * 行内（keFallbackInline）：段落中出现的未知 ke-* 注释
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { keFallbackInlineTokenizer, keFallbackTokenizer } from '../tokenizers'

export interface FallbackAttrs {
  raw: string
}

/** 块级 fallback：独占行未知 ke-* 注释 */
export const GenericFallbackExtension = Node.create({
  name: 'keFallback',
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
        tag: 'div[data-ke-fallback]',
        getAttrs: (el) => ({
          raw: (el as HTMLElement).getAttribute('data-ke-fallback') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as FallbackAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-fallback': a.raw,
        class: 'ke-fallback rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-mono text-amber-800',
        title: '未知扩展标记（原样保留）',
      }),
      a.raw,
    ]
  },

  markdownTokenName: 'ke_fallback',
  markdownTokenizer: keFallbackTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'keFallback',
    attrs: { raw: (token.raw as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as FallbackAttrs) ?? { raw: '' }
    return a.raw
  },
})

/** 行内 fallback：段落内未知 ke-* 注释 */
export const GenericFallbackInlineExtension = Node.create({
  name: 'keFallbackInline',
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
        tag: 'span[data-ke-fallback]',
        getAttrs: (el) => ({
          raw: (el as HTMLElement).getAttribute('data-ke-fallback') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as FallbackAttrs
    return [
      'code',
      mergeAttributes(HTMLAttributes, {
        'data-ke-fallback': a.raw,
        class: 'ke-fallback-inline rounded bg-amber-100 px-1 text-[12px] font-mono text-amber-800',
      }),
      a.raw,
    ]
  },

  markdownTokenName: 'ke_fallback_inline',
  markdownTokenizer: keFallbackInlineTokenizer,
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'keFallbackInline',
    attrs: { raw: (token.raw as string) ?? '' },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as FallbackAttrs) ?? { raw: '' }
    return a.raw
  },
})
