/**
 * 标准 Markdown 图片节点（Phase 3：基础 Markdown 双向转换补全）。
 * @tiptap/markdown 对 ![](url) 没有内置 handler（图片 token 会被降级为 alt 文本），
 * 这里为 StarterKit 的 image 节点补上 markdownTokenName + parse/render。
 * 往返：![alt](src "title")
 */
import Image from '@tiptap/extension-image'
import type { JSONContent, MarkdownToken } from '@tiptap/core'

export const ImageMarkdownExtension = Image.extend({
  markdownTokenName: 'image',
  parseMarkdown: (token: MarkdownToken) => ({
    type: 'image',
    attrs: {
      src: token.href ?? '',
      alt: token.text ?? '',
      title: token.title ?? null,
    },
  }),
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs ?? {}) as { src?: string; alt?: string; title?: string | null }
    const title = a.title ? ` "${a.title}"` : ''
    return `![${a.alt ?? ''}](${a.src ?? ''}${title})`
  },
})

export default ImageMarkdownExtension
