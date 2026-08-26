/**
 * 表格 Markdown 双向支持（Phase 3：Markdown 转换完善）。
 * @tiptap/extension-table 提供 ProseMirror 表格节点（table/tableRow/tableCell/tableHeader），
 * @tiptap/markdown 不内置表格，这里通过 markdownTokenizer / parseMarkdown / renderMarkdown 补齐 GFM 表格。
 *
 * P1-4 保真修复：
 * - 解析兼容 `\|` 转义管道符（parseTableRow 转义感知拆分），round-trip 列数不变；
 * - 单元格走 inline tokenizer/序列化（helpers.tokenizeInline/parseInline + helpers.renderChildren），
 *   加粗/链接/行内公式/脚注等 inline 内容不再退化为纯文本。
 *
 * 限制：GFM 表格不支持合并单元格，colspan/rowspan 在往返中不保留（v1 不做合并 UI）。
 */
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { tableTokenizer } from '../tokenizers'
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core'

export const TableMarkdownExtension = Table.extend({
  markdownTokenName: 'ke_table',
  markdownTokenizer: tableTokenizer,
  parseMarkdown: (token: MarkdownToken, helpers?: MarkdownParseHelpers) => {
    const headers = (token.headers as string[]) ?? []
    const rows = (token.rows as string[][]) ?? []
    // P1-4：单元格文本按 inline Markdown 解析（加粗/链接/公式/脚注保留为 marks/节点）
    const inlineContent = (text: string): JSONContent[] => {
      if (!text) return []
      if (!helpers?.tokenizeInline) return [{ type: 'text', text }]
      return helpers.parseInline(helpers.tokenizeInline(text))
    }
    const cell = (text: string): JSONContent => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: inlineContent(text) }],
    })
    const headerCell = (text: string): JSONContent => ({
      type: 'tableHeader',
      content: [{ type: 'paragraph', content: inlineContent(text) }],
    })
    return {
      type: 'table',
      content: [
        { type: 'tableRow', content: headers.map(headerCell) },
        ...rows.map((r) => ({ type: 'tableRow', content: r.map(cell) })),
      ],
    }
  },
  renderMarkdown: (node: JSONContent, helpers?: MarkdownRendererHelpers) => {
    const rows = node.content ?? []
    const lines: string[] = []
    rows.forEach((row, ri) => {
      // P1-4：单元格内容递归走管理器序列化（marks 边界正确闭合），管道符照旧转义
      const cells = (row.content ?? []).map((c) => {
        const inner = helpers?.renderChildren(c.content ?? []) ?? ''
        return inner.trim()
      })
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
