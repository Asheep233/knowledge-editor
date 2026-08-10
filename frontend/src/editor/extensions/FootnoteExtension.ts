/**
 * 脚注引用节点（Phase 3：Footnote 系统优化）。
 * - 点击「注释」按钮 -> 输入内容 -> 在光标处插入上标 [n]（n = 已有脚注最大编号 + 1）
 * - 脚注列表是 Document Model 中的独立块级节点（footnotes），
 *   不再通过正文「## 参考」标题检测定位参考栏。
 * - Markdown 往返：<!-- ke-footnote: {"kind":"footnote","id":"...","n":1} -->
 *   （对第三方 Markdown 编辑器友好，未知标记不破坏文档）
 */
import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { KE_FIELD_ORDER, keJson, newId } from '../ke'
import { footnoteTokenizer } from '../tokenizers'
import FootnoteNodeView from '../../components/editor/nodeviews/FootnoteNodeView'
import type { FootnoteItem } from './FootnotesExtension'

export interface FootnoteAttrs {
  id: string
  n: number
}

/**
 * 全文最大脚注编号：统计 footnote 节点 n 与普通段落 `[n]` 前缀行
 * （纯 Markdown 样式脚注在正文中即普通段落，无独立节点）。
 */
function maxFootnoteN(doc: import('@tiptap/pm/model').Node): number {
  let n = 0
  doc.descendants((node) => {
    if (node.type.name === 'footnote') {
      n = Math.max(n, (node.attrs.n as number) || 0)
    } else if (node.type.name === 'paragraph') {
      const m = /^\[(\d+)\]/.exec(node.textContent)
      if (m) n = Math.max(n, Number(m[1]))
    }
  })
  return n
}

/**
 * 判断光标落在「行末/段末」：上标之后紧跟换行文本（软换行 `\n` 开头）或段落边界。
 * 此时 caret 的 DOM 锚点落在换行文本起点，浏览器会把光标渲染到下一行行首
 * （用户视角像是"插入后自动换行/光标跑到了下一行"，实际输入位置仍是上标后）。
 * 处理方式：在 sup 后补一个零宽空格 U+200B 文本节点，让 caret 锚点落在
 * 非换行字符之前，光标视觉停在 sup 右侧（同一行）。
 */
function isCaretAtLineEnd(tr: Transaction, pos: number): boolean {
  const $pos = tr.doc.resolve(pos)
  const parent = $pos.parent
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') return false
  // 软换行行末：上标后紧跟以 \n 开头的文本
  const next = tr.doc.nodeAt(pos)
  if (next && next.isText && (next.text ?? '').startsWith('\n')) return true
  // 真段落末：pos 之后没有内容节点（nodeAt 为 null）且紧邻块内容末尾。
  // 用 $pos.end()（父块内容的绝对结束位置）而非 parent.end——Node 没有 end 属性。
  if (!next && pos >= $pos.end() - 1) return true
  return false
}

export const FootnoteExtension = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: '' },
      n: { default: 0 },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'sup[data-ke-footnote]',
        getAttrs: (el) => {
          const elm = el as HTMLElement
          return {
            id: elm.getAttribute('data-ke-footnote') ?? '',
            n: Number(elm.getAttribute('data-n')) || 0,
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as FootnoteAttrs
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-ke-footnote': a.id,
        'data-n': String(a.n),
        class: 'ke-footnote-ref',
        title: `注释 [${a.n}]`,
      }),
      `[${a.n}]`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteNodeView)
  },

  addCommands() {
    return {
      /**
       * 插入脚注引用，并维护文末独立 footnotes 节点：
       * - 有 footnotes 节点：追加条目
       * - 无 footnotes 节点：在文档末尾创建
       * 不再依赖「## 参考」标题检测。
       */
      insertFootnote:
        (text: string) =>
        ({ tr, state, dispatch }) => {
          // 编号 = 已有脚注引用（含纯 Markdown 样式段落）的最大编号 + 1
          const schema = state.schema
          const next = maxFootnoteN(state.doc) + 1
          const id = newId()
          const textTrim = text.trim()
          const item: FootnoteItem = { id, n: next, text: textTrim }

          // 1) 在光标处插入上标引用（单 transaction：插入 + 维护参考区 + 光标复位）
          //    不能用 commands.insertContent —— 在 chain 模式下它不会立即 dispatch，
          //    之后 tr.selection.from 仍是插入前位置，光标会被复位到上标之前，
          //    造成 state 与 DOM 光标错位（Backspace 会误删上标）。
          const { from, to } = tr.selection
          const supNode = schema.nodes.footnote.create({ id, n: next })
          tr.replaceWith(from, to, supNode)
          // 上标之后的光标位置（同一行）
          const after = from + supNode.nodeSize

          // 2) 维护独立 footnotes 节点（追加条目；无则文末创建）。
          //    trailingNode 插件会在 footnotes（非 textblock block）成为文末节点时
          //    追加空段落，若光标恰在文末，selection 会映射到该空段落——必须显式复位。
          if (textTrim) {
            let fPos = -1
            tr.doc.descendants((node, pos) => {
              if (node.type.name === 'footnotes') {
                fPos = pos
                return false
              }
            })
            if (fPos >= 0) {
              const existing: FootnoteItem[] =
                (tr.doc.nodeAt(fPos)?.attrs.items as FootnoteItem[] | undefined) ?? []
              tr.setNodeMarkup(fPos, undefined, { items: [...existing, item] })
            } else {
              tr.insert(tr.doc.content.size, schema.nodes.footnotes.create({ items: [item] }))
            }
          }
          // 3) 行末/段末光标锚点：上标后紧跟换行文本或段落边界时补零宽空格，
          //    避免浏览器把光标渲染到下一行行首（用户视角"光标跑到下一行"）。
          if (isCaretAtLineEnd(tr, after)) {
            tr.insert(after, schema.text('\u200b'))
          }
          tr.setSelection(TextSelection.near(tr.doc.resolve(after)))
          dispatch?.(tr)
          return true
        },

      /**
       * 纯 Markdown 样式脚注（Phase 7 / v0.6.3）：
       * 与 insertFootnote 相同，在正文光标处插入上标 [n]；
       * 但不创建 footnotes 块级节点，只在文末添加 `# 参考` 一级标题
       * 与 `[n]内容` 普通段落（正文字体），无上标↔文末连接。
       * 参考标题规则：仅当文末最后一行不是 `[n]` 开头段落时才新建，
       * 否则直接追加段落（不全文搜索「参考」标题位置）。
       * 文末内容与普通文本无异，可自由编辑，序列化为标准 Markdown。
       */
      insertPlainFootnote:
        (text: string) =>
        ({ tr, state, dispatch }) => {
          const schema = state.schema
          const textTrim = text.trim()
          const next = maxFootnoteN(state.doc) + 1
          const id = newId()

          // 1) 在光标处插入上标引用（单 transaction，与 insertFootnote 一致；
          //    不维护 footnotes 节点，只在文末添加参考行）
          const { from, to } = tr.selection
          const supNode = schema.nodes.footnote.create({ id, n: next })
          tr.replaceWith(from, to, supNode)
          const after = from + supNode.nodeSize

          // 2) 文末添加 `# 参考`（仅当末尾非 [n] 开头段落）与 `[n]内容` 普通段落，
          //    并把光标移回上标之后（同一行）。
          if (textTrim) {
            const last = tr.doc.lastChild
            const hasRefRow =
              !!last && last.type.name === 'paragraph' && /^\[\d+\]/.test(last.textContent)
            const blocks: Array<import('@tiptap/pm/model').Node> = []
            if (!hasRefRow) {
              blocks.push(schema.nodes.heading.create({ level: 1 }, schema.text('参考')))
            }
            blocks.push(schema.nodes.paragraph.create(null, schema.text(`[${next}] ${textTrim}`)))
            tr.insert(tr.doc.content.size, blocks)
          }
          // 3) 行末/段末光标锚点：与 insertFootnote 一致，补零宽空格避免光标渲染到下一行
          if (isCaretAtLineEnd(tr, after)) {
            tr.insert(after, schema.text('\u200b'))
          }
          tr.setSelection(TextSelection.near(tr.doc.resolve(after)))
          dispatch?.(tr)
          return true
        },
    }
  },

  markdownTokenName: 'ke_footnote',
  markdownTokenizer: footnoteTokenizer,
  parseMarkdown: (token: MarkdownToken) => {
    const a = (token.attrs as Record<string, unknown>) ?? {}
    return {
      type: 'footnote',
      attrs: {
        id: (a.id as string) ?? '',
        n: Number(a.n) || 0,
      },
    }
  },
  renderMarkdown: ({ attrs }: JSONContent) => {
    const a = (attrs as FootnoteAttrs) ?? ({} as FootnoteAttrs)
    return `<!-- ke-footnote: ${keJson({ id: a.id || newId(), n: a.n || 0 }, 'footnote', KE_FIELD_ORDER.footnote)} -->`
  },
})
