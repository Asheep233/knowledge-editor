/**
 * 视频节点（决策点 4：v1 仅本地视频引用与展示，不做复杂视频管理）。
 * src 为 workspace 相对路径（约束 4）。
 * Markdown 往返：<!-- ke-video: {json} -->
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import VideoNodeView from '../../components/editor/nodeviews/VideoNodeView'
import { KE_FIELD_ORDER, keJson, newId } from '../ke'
import { keCommentTokenizer } from '../tokenizers'

export interface VideoAttrs {
  id: string
  src: string
  title?: string
  poster?: string
  controls?: boolean
  autoplay?: boolean
  loop?: boolean
}

export const VideoExtension = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: '' },
      src: { default: '' },
      title: { default: null },
      poster: { default: null },
      controls: { default: true },
      autoplay: { default: false },
      loop: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-ke-video]',
        getAttrs: (el) => {
          const elm = el as HTMLElement
          return {
            id: elm.getAttribute('data-id') ?? '',
            src: elm.getAttribute('data-src') ?? '',
            title: elm.getAttribute('data-title'),
            poster: elm.getAttribute('data-poster'),
            controls: elm.getAttribute('data-controls') !== 'false',
            autoplay: elm.getAttribute('data-autoplay') === 'true',
            loop: elm.getAttribute('data-loop') === 'true',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as VideoAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-video': '',
        'data-id': a.id,
        'data-src': a.src,
        'data-title': a.title ?? '',
        'data-poster': a.poster ?? '',
        'data-controls': String(a.controls ?? true),
        'data-autoplay': String(a.autoplay ?? false),
        'data-loop': String(a.loop ?? false),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoNodeView)
  },

  markdownTokenName: 'ke_video',
  markdownTokenizer: keCommentTokenizer('video'),
  parseMarkdown: (token: MarkdownToken) => {
    const a = (token.attrs as Record<string, unknown>) ?? {}
    return {
      type: 'video',
      attrs: {
        id: (a.id as string) ?? '',
        src: (a.src as string) ?? '',
        title: (a.title as string) ?? null,
        poster: (a.poster as string) ?? null,
        controls: (a.controls as boolean) ?? true,
        autoplay: (a.autoplay as boolean) ?? false,
        loop: (a.loop as boolean) ?? false,
      },
    }
  },
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as VideoAttrs) ?? ({} as VideoAttrs)
    const payload: Record<string, unknown> = { ...a, id: a.id || newId() }
    return `<!-- ke-video: ${keJson(payload, 'video', KE_FIELD_ORDER.video)} -->`
  },
})
