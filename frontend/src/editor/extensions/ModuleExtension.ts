/**
 * 模块节点（约束 3：v1 采用「插入后复制内容」方案，不做动态引用）。
 * 该节点用于解析/兼容既有 ke-module 标记；编辑器主交互为 insertModule
 * （从 Modules/ 拉取内容并复制为普通文档内容）。
 * Markdown 往返：<!-- ke-module: {json} -->
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ModuleNodeView from '../../components/editor/nodeviews/ModuleNodeView'
import { newId } from '../ke'
import { keCommentTokenizer } from '../tokenizers'

export interface ModuleAttrs {
  id: string
  name: string
  version?: number
  mode?: string
  params?: Record<string, unknown>
  /** Phase 5：模块来源（Modules/*.md 相对路径）。仅记录来源，不参与动态同步。 */
  source?: string
}

export const ModuleExtension = Node.create({
  name: 'module',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: '' },
      name: { default: '' },
      version: { default: null },
      mode: { default: 'card' },
      params: { default: null },
      source: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-ke-module]',
        getAttrs: (el) => {
          const elm = el as HTMLElement
          const raw = elm.getAttribute('data-params')
          let params: Record<string, unknown> | null = null
          if (raw) {
            try {
              params = JSON.parse(raw)
            } catch {
              params = null // 非法 JSON 时按缺失处理，不阻断解析
            }
          }
          return {
            id: elm.getAttribute('data-id') ?? '',
            name: elm.getAttribute('data-name') ?? '',
            version: elm.getAttribute('data-version') ? Number(elm.getAttribute('data-version')) : null,
            mode: elm.getAttribute('data-mode') ?? 'card',
            params,
            source: elm.getAttribute('data-source') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as ModuleAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ke-module': '',
        'data-id': a.id,
        'data-name': a.name,
        'data-version': a.version ?? '',
        'data-mode': a.mode ?? 'card',
        'data-params': a.params ? JSON.stringify(a.params) : '',
        'data-source': a.source ?? '',
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ModuleNodeView)
  },

  markdownTokenName: 'ke_module',
  markdownTokenizer: keCommentTokenizer('module'),
  parseMarkdown: (token: MarkdownToken) => {
    const a = (token.attrs as Record<string, unknown>) ?? {}
    return {
      type: 'module',
      attrs: {
        id: (a.id as string) ?? '',
        name: (a.name as string) ?? '',
        version: (a.version as number) ?? null,
        mode: (a.mode as string) ?? 'card',
        params: (a.params as Record<string, unknown>) ?? null,
        source: (a.source as string) ?? '',
      },
    }
  },
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as ModuleAttrs) ?? ({} as ModuleAttrs)
    // Phase 5 来源记录模式：插入模块生成的标记仅含 source（规范示例格式）。
    // 旧文档标记（含 id/name/version 等）走下方兼容路径，不受影响。
    if (a.source) {
      return `<!-- ke-module: ${JSON.stringify({ source: a.source })} -->`
    }
    const obj: Record<string, unknown> = { kind: 'module', id: a.id || newId() }
    if (a.name) obj.name = a.name
    if (a.version) obj.version = a.version
    if (a.mode && a.mode !== 'card') obj.mode = a.mode
    if (a.params) obj.params = a.params
    return `<!-- ke-module: ${JSON.stringify(obj)} -->`
  },
})
