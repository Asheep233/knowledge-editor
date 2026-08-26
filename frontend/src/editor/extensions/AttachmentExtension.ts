/**
 * 附件节点（决策点 4：附件卡片入 v1；决策点 5：按类型分类存储）。
 * src 为 workspace 相对路径（约束 4：移动知识库后仍然有效）。
 * Markdown 往返：<!-- ke-attach: {json} -->
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import AttachmentNodeView from '../../components/editor/nodeviews/AttachmentNodeView'
import { KE_FIELD_ORDER, keJson, keStableId } from '../ke'
import { keCommentTokenizer } from '../tokenizers'

export interface AttachmentAttrs {
  id: string
  type: 'image' | 'file' | 'video'
  src: string
  title?: string
  caption?: string
  width?: string
}

export const AttachmentExtension = Node.create({
  name: 'attach',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: '' },
      type: { default: 'file' },
      src: { default: '' },
      title: { default: null },
      caption: { default: null },
      width: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-ke-attach]',
        getAttrs: (el) => {
          const elm = el as HTMLElement
          return {
            id: elm.getAttribute('data-id') ?? '',
            type: elm.getAttribute('data-type') ?? 'file',
            src: elm.getAttribute('data-src') ?? '',
            title: elm.getAttribute('data-title'),
            caption: elm.getAttribute('data-caption'),
            width: elm.getAttribute('data-width'),
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as AttachmentAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-attach': '',
        'data-id': a.id,
        'data-type': a.type,
        'data-src': a.src,
        'data-title': a.title ?? '',
        'data-caption': a.caption ?? '',
        'data-width': a.width ?? '',
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentNodeView)
  },

  markdownTokenName: 'ke_attach',
  markdownTokenizer: keCommentTokenizer('attach'),
  parseMarkdown: (token: MarkdownToken) => {
    const a = (token.attrs as Record<string, unknown>) ?? {}
    return {
      type: 'attach',
      attrs: {
        id: (a.id as string) ?? '',
        type: (a.type as AttachmentAttrs['type']) ?? 'file',
        src: (a.src as string) ?? '',
        title: (a.title as string) ?? null,
        caption: (a.caption as string) ?? null,
        width: (a.width as string) ?? null,
      },
    }
  },
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as AttachmentAttrs) ?? ({} as AttachmentAttrs)
    // P4-1：无 id 时用关键字段生成确定性 id（同内容多次序列化一致）
    const payload: Record<string, unknown> = { ...a, id: a.id || keStableId(a as unknown as Record<string, unknown>, ['src', 'type', 'title']) }
    return `<!-- ke-attach: ${keJson(payload, 'attach', KE_FIELD_ORDER.attach)} -->`
  },
})
