/**
 * task-68 M02（P1，外部复审 2026-10-10）：默认 `table` token 的**生产 handler**（安全网）。
 *
 * 背景：表格走 `ke_table` 自定义 tokenizer（见 `tokenizers.ts`）。任何**未被它认领**的合法 GFM 表格
 * 会落到 marked 内置的 `table` token 上；而全仓此前没有该 token 的 handler →
 * `@tiptap/markdown` 直接把 token 丢掉 → **整表变成一个空段落、全部单元格文字丢失**。
 *
 * 本扩展只声明「token → 节点」的映射（不注册节点类型，节点由 `TableMarkdownExtension` 提供），
 * 因此即使将来 `ke_table` 又漏掉某种写法，最坏也只是**归一化**，绝不会「变空」。
 */
import { Extension } from '@tiptap/core'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { renderGfmTable } from './TableMarkdownExtension'

interface MarkedCell {
  text?: string
  tokens?: MarkdownToken[]
}

/** marked 的 table token 形态：{ header: Cell[], rows: Cell[][] } */
interface MarkedTableToken {
  header?: MarkedCell[]
  rows?: MarkedCell[][]
}

export const GfmTableFallbackExtension = Extension.create({
  name: 'gfmTableFallback',
  markdownTokenName: 'table',
  parseMarkdown: (token: MarkdownToken, helpers): JSONContent => {
    const t = token as unknown as MarkedTableToken
    const header = t.header ?? []
    const rows = t.rows ?? []
    const parseCellInline = (cell: MarkedCell | undefined): JSONContent[] => {
      if (!cell) return []
      if (cell.tokens?.length) return helpers.parseInline(cell.tokens)
      const text = cell.text ?? ''
      return text ? [{ type: 'text', text }] : []
    }
    const cellNode = (type: 'tableHeader' | 'tableCell', cell: MarkedCell | undefined): JSONContent => ({
      type,
      content: [{ type: 'paragraph', content: parseCellInline(cell) }],
    })
    // 列数按表头对齐：不足补空单元格、超出截断（GFM 口径：多余单元格忽略）
    const width = Math.max(header.length, 1)
    const row = (cells: MarkedCell[]): JSONContent => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_v, i) => cellNode('tableCell', cells[i])),
    })
    return {
      type: 'table',
      content: [
        { type: 'tableRow', content: Array.from({ length: width }, (_v, i) => cellNode('tableHeader', header[i])) },
        ...rows.map(row),
      ],
    }
  },
  // 必须同时提供渲染器：仅声明 token 名而无 `renderMarkdown` 会被序列化器选中 →
  // `getMarkdown()` 返回空串（实测）。这里复用主扩展的规范 GFM 渲染，保证两条 handler 同口径。
  renderMarkdown: (node: JSONContent, helpers: { renderChildren: (nodes: JSONContent | JSONContent[], separator?: string) => string }) =>
    renderGfmTable(node, helpers),
})

export default GfmTableFallbackExtension
