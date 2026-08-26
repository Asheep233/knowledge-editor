/**
 * 表格 Markdown 双向支持（Phase 3：Markdown 转换完善）。
 * @tiptap/extension-table 提供 ProseMirror 表格节点（table/tableRow/tableCell/tableHeader），
 * @tiptap/markdown 不内置表格，这里通过 markdownTokenizer / parseMarkdown / renderMarkdown 补齐 GFM 表格。
 *
 * - P1-4：单元格内容按行内 Markdown 往返（**粗体** / [链接](url) / $公式$ 保留），
 *   单元格内的字面量 `|` 用 `\|` 转义，往返列数不变。
 * - 限制：`@tiptap/extension-table` 支持合并单元格，但 GFM 表格语法不保留
 *   colspan/rowspan；合并单元格的编辑 UI 由组件层（TableBubbleMenu）负责，不在本层往返。
 */
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { tableTokenizer } from '../tokenizers'
import type { JSONContent, MarkdownToken } from '@tiptap/core'

/** 把单元格内的行内内容序列化为 Markdown（保留 **粗体** / [链接](url) / $公式$ 等）。
 * P1-4：cellText 之前只取纯文本，会丢失单元格内的行内样式。这里改用 renderChildren
 * 逐节点递归序列化，保证行内样式在往返中不丢。 */
function renderCellContent(cell: JSONContent | undefined, helpers: { renderChildren: (nodes: JSONContent | JSONContent[], separator?: string) => string }): string {
  if (!cell) return ''
  // tableCell/tableHeader 的 content 为 [paragraph]，paragraph 的 content 才是行内节点
  const inline = (cell.content ?? []).flatMap((p: JSONContent) => p.content ?? [])
  if (!inline.length) return ''
  return helpers.renderChildren(inline, '').replace(/\n/g, ' ')
}

export const TableMarkdownExtension = Table.extend({
  markdownTokenName: 'ke_table',
  markdownTokenizer: tableTokenizer,
  parseMarkdown: (token: MarkdownToken, helpers) => {
    const headers = (token.headers as string[]) ?? []
    const rows = (token.rows as string[][]) ?? []
    // P1-4：把单元格文本作为行内 Markdown 解析（**粗体** / [链接](url) / $公式$ 等
    // 变成真实 mark/节点），序列化时再逐节点递归输出，保证行内样式在往返中不丢。
    const parseCellInline = (text: string): JSONContent[] => {
      if (!text) return []
      const inlineTokens = helpers.tokenizeInline?.(text) ?? []
      return inlineTokens.length ? helpers.parseInline(inlineTokens) : [{ type: 'text', text }]
    }
    const cell = (text: string): JSONContent => ({
      type: 'tableCell',
      content: [
        { type: 'paragraph', content: parseCellInline(text) },
      ],
    })
    const headerCell = (text: string): JSONContent => ({
      type: 'tableHeader',
      content: [
        { type: 'paragraph', content: parseCellInline(text) },
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
  renderMarkdown: ({ content }: JSONContent, helpers) => {
    const rows = content ?? []
    const lines: string[] = []
    rows.forEach((row, ri) => {
      const cells = (row.content ?? []).map((c) => renderCellContent(c, helpers))
      // 序列化端统一把单元格内的字面量 `|` 转义为 `\|`，保证往返列数不变（P1-4）
      const pad = cells.length ? cells.map((c) => c.replace(/\|/g, '\\|')) : []
      lines.push(`| ${pad.join(' | ')} |`)
      if (ri === 0) {
        lines.push(`| ${pad.map(() => '---').join(' | ')} |`)
      }
    })
    return lines.length ? `\n${lines.join('\n')}\n` : ''
  },
  // P1-4c：v1 的 Markdown（GFM）往返不保留 colspan/rowspan，合并后的单元格
  // 在「打开→保存」后会退化（跨列内容被拍平）。因此在扩展层禁用合并/拆分单元格：
  // 让 `can().mergeCells()` / `can().splitCell()` 返回 false，TableBubbleMenu 的
  // 合并/拆分按钮即自动置灰（按钮按 can() 控制 disabled）。此处不触碰组件层。
  addCommands() {
    return {
      ...this.parent?.(),
      mergeCells: () => () => false,
      splitCell: () => () => false,
    }
  },
})

export { TableRow, TableCell, TableHeader }
