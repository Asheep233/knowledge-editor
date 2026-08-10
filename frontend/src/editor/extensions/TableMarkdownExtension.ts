/**
 * 表格 Markdown 双向支持（Phase 3：Markdown 转换完善）。
 * @tiptap/extension-table 提供 ProseMirror 表格节点（table/tableRow/tableCell/tableHeader），
 * @tiptap/markdown 不内置表格，这里通过 markdownTokenizer / parseMarkdown / renderMarkdown 补齐 GFM 表格。
 *
 * 限制：单元格按纯文本处理（GFM 表格不支持合并单元格，colspan/rowspan 在往返中不保留）。
 */
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { tableTokenizer } from '../tokenizers'
import type { JSONContent, MarkdownToken } from '@tiptap/core'

function cellText(cell: JSONContent | undefined): string {
  if (!cell) return ''
  const parts: string[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
    for (const c of n.content ?? []) walk(c)
  }
  walk(cell)
  return parts.join('').trim()
}

export const TableMarkdownExtension = Table.extend({
  markdownTokenName: 'ke_table',
  markdownTokenizer: tableTokenizer,
  parseMarkdown: (token: MarkdownToken) => {
    const headers = (token.headers as string[]) ?? []
    const rows = (token.rows as string[][]) ?? []
    const cell = (text: string): JSONContent => ({
      type: 'tableCell',
      content: [
        { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] },
      ],
    })
    const headerCell = (text: string): JSONContent => ({
      type: 'tableHeader',
      content: [
        { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] },
      ],
    })
    return {
      type: 'table',
      content: [
        { type: 'tableRow', content: headers.map(headerCell) },
        ...rows.map((r) => ({ type: 'tableRow', content: r.map(cell) })),
      ],
    }
  },
  renderMarkdown: ({ content }: JSONContent) => {
    const rows = content ?? []
    const lines: string[] = []
    rows.forEach((row, ri) => {
      const cells = (row.content ?? []).map(cellText)
      const pad = cells.length ? cells.map((c) => c.replace(/\|/g, '\\|')) : []
      lines.push(`| ${pad.join(' | ')} |`)
      if (ri === 0) {
        lines.push(`| ${pad.map(() => '---').join(' | ')} |`)
      }
    })
    return lines.length ? `\n${lines.join('\n')}\n` : ''
  },
})

export { TableRow, TableCell, TableHeader }
