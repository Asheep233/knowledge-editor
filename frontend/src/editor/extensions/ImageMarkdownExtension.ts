/**
 * 标准 Markdown 图片节点（Phase 3：基础 Markdown 双向转换补全）。
 * @tiptap/markdown 对 ![](url) 没有内置 handler（图片 token 会被降级为 alt 文本），
 * 这里为 StarterKit 的 image 节点补上 markdownTokenName + parse/render。
 * 往返：![alt](src "title")
 */
import Image from '@tiptap/extension-image'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ImageNodeView from '../../components/editor/nodeviews/ImageNodeView'

/**
 * A03：标准图片语法的**上下文转义**（原来直接拼接 → 特殊字符往返 4→1 节点）。
 * CommonMark 口径：
 *  - alt 在 `![…]` 内：`\`、`[`、`]` 需转义（否则提前闭合方括号）；
 *  - 目标含空白/圆括号/尖括号 → 用 `<…>` 包裹，内部只需转义 `\`、`<`、`>`；
 *    普通目标则转义 `\` 与圆括号；
 *  - title 用双引号包裹：内部的 `"` 与 `\` 需转义。
 */
export function escapeAlt(alt: string): string {
  return alt.replace(/([\\[\]])/g, '\\$1')
}

export function escapeTitle(title: string): string {
  return title.replace(/([\\"])/g, '\\$1')
}

export function formatTarget(src: string): string {
  if (/[\s()]/.test(src) || /[<>]/.test(src)) {
    return `<${src.replace(/([\\<>])/g, '\\$1')}>`
  }
  return src.replace(/([\\()])/g, '\\$1')
}

export const ImageMarkdownExtension = Image.extend({
  markdownTokenName: 'image',
  // handoff §5：标准 Markdown 图片同样以内容大图展示 + 点击放大
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
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
    const title = a.title ? ` "${escapeTitle(a.title)}"` : ''
    return `![${escapeAlt(a.alt ?? '')}](${formatTarget(a.src ?? '')}${title})`
  },
})

export default ImageMarkdownExtension
