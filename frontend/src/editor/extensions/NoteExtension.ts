/**
 * 通用信息块节点（InfoBlock）。
 * 数据模型：{ title, color } + PM 可编辑内容（content: 'inline*'），
 * 块内文字是真实 PM 节点，可插入脚注上标等 inline 节点（v0.7.0）。
 * 兼容旧文档：v0~v3 的 content/text 属性在解析时迁移为文本子节点。
 * Markdown 往返（包裹格式）：
 *   <!-- ke-note: {json} -->
 *   块内内容（可含脚注上标等 inline 标记）
 *   <!-- /ke-note -->
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Fragment } from 'prosemirror-model'
import NoteNodeView from '../../components/editor/nodeviews/NoteNodeView'
import { KE_FIELD_ORDER, keJson, keStableId, newId } from '../ke'
import { keNoteTokenizer } from '../tokenizers'

export interface NoteAttrs {
  id: string
  /** 左上角徽章文字（Phase 7）：默认空串，NodeView 显示时兜底「信息」；可自定义 */
  label: string
  title: string
  color: string
  author?: string
  created?: string
  updated?: string
}

/** 默认信息块标题：「信息块 HH:mm」 */
export function defaultInfoTitle(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `信息块 ${hh}:${mm}`
}

/** 从 DOM 元素提取 note 属性（data-* 属性） */
function noteAttrsFrom(el: HTMLElement) {
  return {
    id: el.getAttribute('data-id') ?? '',
    label: el.getAttribute('data-label') ?? '',
    title: el.getAttribute('data-title') ?? '',
    color: el.getAttribute('data-color') ?? 'blue',
    author: el.getAttribute('data-author'),
    created: el.getAttribute('data-created'),
    updated: el.getAttribute('data-updated'),
  }
}

export const NoteExtension = Node.create({
  name: 'note',
  group: 'block',
  content: 'inline*',
  // 防止 Backspace/Delete 在块边界误删整个信息块
  defining: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: '' },
      label: { default: '' },
      title: { default: '' },
      color: { default: 'blue' },
      author: { default: null },
      created: { default: null },
      updated: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        // 旧格式（v0~v3）：内容存于 data-content/data-text 属性，迁移为文本子节点
        tag: 'div[data-ke-note]',
        priority: 200,
        getAttrs: (el) => {
          const elm = el as HTMLElement
          const legacy = elm.getAttribute('data-content') ?? elm.getAttribute('data-text')
          if (!legacy) return false // 无旧内容属性：不命中本规则，走新格式规则
          return noteAttrsFrom(elm)
        },
        getContent: (el, schema) => {
          const elm = el as HTMLElement
          const legacy = elm.getAttribute('data-content') ?? elm.getAttribute('data-text') ?? ''
          return Fragment.fromJSON(schema, [{ type: 'text', text: legacy }])
        },
      },
      {
        // 新格式（v0.7.0）：内容为 DOM 子节点，走默认解析（块内可含脚注上标等）
        tag: 'div[data-ke-note]',
        getAttrs: (el) => noteAttrsFrom(el as HTMLElement),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as NoteAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-note': '',
        'data-id': a.id,
        'data-label': a.label,
        'data-title': a.title,
        'data-color': a.color,
        'data-author': a.author ?? '',
        'data-created': a.created ?? '',
        'data-updated': a.updated ?? '',
      }),
      // 0 = 子内容挂载点：块内文字作为 PM 可编辑内容渲染
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteNodeView)
  },

  addCommands() {
    return {
      insertNote:
        (content = '', color = 'blue', title?: string) =>
        ({ commands }) => {
          const now = new Date().toISOString()
          const children: JSONContent[] = content
            ? [{ type: 'text', text: content }]
            : []
          return commands.insertContent({
            type: this.name,
            attrs: {
              id: newId(),
              title: title ?? defaultInfoTitle(),
              color,
              created: now,
              updated: now,
            },
            ...(children.length ? { content: children } : {}),
          })
        },
    }
  },

  markdownTokenName: 'ke_note',
  markdownTokenizer: keNoteTokenizer,
  parseMarkdown: (token: MarkdownToken, helpers) => {
    const a = (token.attrs as Record<string, unknown>) ?? {}
    const attrs = {
      id: (a.id as string) ?? '',
      label: (a.label as string) ?? '',
      title: (a.title as string) ?? '',
      color: (a.color as string) ?? 'blue',
      author: (a.author as string) ?? null,
      created: (a.created as string) ?? null,
      updated: (a.updated as string) ?? null,
    }
    const inner = (token.content as string) ?? ''
    if (inner) {
      // 包裹格式：块内内容解析为 inline 节点（可含脚注上标等）
      const inlineTokens = helpers.tokenizeInline?.(inner) ?? []
      const content = inlineTokens.length ? helpers.parseInline(inlineTokens) : []
      return { type: 'note', attrs, content }
    }
    // 旧格式（自闭合）：content/text 属性迁移为文本子节点
    const legacy = (a.content as string) ?? (a.text as string) ?? ''
    return {
      type: 'note',
      attrs,
      ...(legacy ? { content: [{ type: 'text', text: legacy }] } : {}),
    }
  },
  renderMarkdown: ({ attrs, content }: JSONContent, helpers) => {
    const a = (attrs as NoteAttrs) ?? ({} as NoteAttrs)
    // P4-1：无 id 时用关键字段 + 块内文本生成确定性 id
    const innerText = (content ?? []).map((n) => n.text ?? '').join('')
    const stableId = keStableId({ ...a, content: innerText } as Record<string, unknown>, ['title', 'color', 'content'])
    const payload: Record<string, unknown> = {
      id: a.id || stableId,
      label: a.label ?? '',
      title: a.title ?? '',
      color: a.color ?? 'blue',
      author: a.author ?? '',
      created: a.created ?? '',
      updated: a.updated ?? '',
    }
    const head = `<!-- ke-note: ${keJson(payload, 'note', KE_FIELD_ORDER.note)} -->`
    const inner = content && content.length ? helpers.renderChildren(content) : ''
    // R3：空内容也必须输出闭合标记 `<!-- /ke-note -->`——否则产出与旧自闭合
    // 格式不可区分，重开时 keNoteTokenizer 会在文档剩余全文寻找结束标记，
    // 把下一个信息块的头标记与内容吞进空信息块，破坏 ke-note 包裹格式不变量。
    return inner ? `${head}\n${inner}\n<!-- /ke-note -->` : `${head}\n<!-- /ke-note -->`
  },
})
