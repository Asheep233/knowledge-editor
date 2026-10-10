/**
 * task-69 M03 + U02（外部复审 2026-10-10，P2，真实 UI 确认）：表格识别的**保守边界**。
 *
 * **M03**：
 * - `case-table-tabs`：`\t|列一|列二|` 缩进 → 应是**缩进代码**，实测被自定义 tokenizer 当表格 → **保存改结构**。
 * - `case-table-four-space-indent`：同上（4 空格）。
 * - `case-table-column-mismatch` / `case-drift-49`：表头 2 列、分隔 1 列 → 不应成表（GFM 要求列数一致）。
 * - `case-drift-50`：Tab 缩进的表格样式文本。
 * 方向（与 task-66 的 `start` 严格化同口径）：拿不准就**退回字面文本**，绝不把代码/歧义输入升级为结构节点。
 *
 * **U02**：单行 `|` 保存后（EOF LF 被去掉）切回源码重新解析时抛
 * `Cannot read properties of undefined (reading 'trim')`（`parseTableRow(undefined)`）——
 * 空行/未定义行的防御缺失。
 *
 * 契约守护：**合法 GFM 表格**（含无首尾管道写法）必须仍成表且往返字节一致。
 * 注：`case-table-column-mismatch` 与 `case-drift-49` 由 task-68 的
 * `sep.length !== header.length → undefined` 覆盖，本文件只做**验证 + 用例**（不重复实现）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'

const EXT = [
  StarterKit,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

interface Snap {
  structure: string[]
  tables: number
  codeBlocks: number
  text: string
  back: string
  error?: string
}
function snap(md: string): Snap {
  try {
    const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
    const structure: string[] = []
    let tables = 0
    let codeBlocks = 0
    ed.state.doc.descendants((n) => {
      if (n.isBlock) {
        structure.push(n.type.name)
        if (n.type.name === 'table') tables++
        if (n.type.name === 'codeBlock') codeBlocks++
      }
      return true
    })
    const text = ed.state.doc.textContent
    const back = ed.getMarkdown()
    ed.destroy()
    return { structure, tables, codeBlocks, text, back }
  } catch (e) {
    return { structure: [], tables: 0, codeBlocks: 0, text: '', back: '', error: (e as Error).message }
  }
}

describe('task-69 M03：缩进代码 / 列数不匹配不得被当作表格', () => {
  it('T1 Tab 缩进的表格样式文本 → 缩进代码，不是表格（case-table-tabs）', () => {
    const s = snap('\t|列一|列二|\n\t|---|---|\n\t|中文内容|对照|\n')
    expect(s.tables, `被误判成表格：${JSON.stringify(s.structure)}`).toBe(0)
    expect(s.text, '内容必须保留').toContain('中文内容')
  })

  it('T2 4 空格缩进 → 缩进代码，不是表格（case-table-four-space-indent）', () => {
    const s = snap('    |HEADER_ALPHA|HEADER_BETA|\n    |---|---|\n    |CELL_ALPHA|CELL_BETA|\n')
    expect(s.tables, `被误判成表格：${JSON.stringify(s.structure)}`).toBe(0)
    expect(s.text).toContain('CELL_ALPHA')
  })

  it('T3 Tab 缩进 + 大写哨兵（case-drift-50）内容不丢', () => {
    const s = snap('\t|A|B|\n\t|---|---|\n\t|KEEP|SAFE|\n')
    expect(s.tables).toBe(0)
    expect(s.text).toContain('KEEP')
    expect(s.text).toContain('SAFE')
  })

  it('T4 列数不匹配（2 列表头 + 1 列分隔）→ 不成表、内容原样（case-drift-49 / column-mismatch）', () => {
    // 注：本条已由 task-68 的 `sep.length !== header.length → undefined` 覆盖（绿），
    // 本用例作为**契约守护**保留（中文 + 大写两组哨兵）。
    const cases: Array<[string, string]> = [
      ['|A|B|\n|---|\n|KEEP|SAFE|\n', 'KEEP'],
      ['|列一|列二|\n|---|\n|中文内容|对照|\n', '中文内容'],
    ]
    for (const [md, sentinel] of cases) {
      const s = snap(md)
      expect(s.tables, `列数不匹配仍成表：${JSON.stringify(s.structure)}`).toBe(0)
      expect(s.text, `内容丢失：${JSON.stringify(s.text)}`).toContain(sentinel)
    }
  })
})

describe('task-69 U02：孤立/退化输入的解析不得抛错', () => {
  it('T5 单行 `|`（无 EOF LF）不抛错、内容原样', () => {
    const s = snap('|')
    expect(s.error, `解析抛错：${s.error}`).toBeUndefined()
    expect(s.back).toBe('|')
  })

  it('T6 单行 `|` 带 EOF LF 也不抛错（源码模式往返路径）', () => {
    const s = snap('|\n')
    expect(s.error).toBeUndefined()
  })

  it('T7 退化的多行样本不抛错：`|\\n|`、`|\\n|---|`、只有表头无分隔', () => {
    for (const md of ['|\n|', '|\n|---|\n', '|A|B|', '|A|B|\n']) {
      const s = snap(md)
      expect(s.error, `${JSON.stringify(md)} 抛错：${s.error}`).toBeUndefined()
    }
  })

  it('T8 保存产物再解析不抛错（二次往返稳定）', () => {
    const s = snap('|')
    const twice = snap(`${s.back}\n`)
    expect(twice.error, `二次解析抛错：${twice.error}`).toBeUndefined()
    expect(twice.back).toBe(s.back)
  })
})

describe('task-69 契约守护：合法 GFM 表格仍须成表且往返字节一致', () => {
  it('T9 标准表格（首尾管道）成表 + 字节一致', () => {
    const md = '|列一|列二|\n|---|---|\n|中文内容|对照|'
    const s = snap(`${md}\n`)
    expect(s.tables).toBe(1)
    expect(s.back).toContain('列一')
    expect(s.text).toContain('中文内容')
  })

  it('T10 无首尾管道的 GFM 写法不被"保守化"误伤（若实现尚未支持，此项会红 —— 属 task-68 M02 范围）', () => {
    const s = snap('HEADER_ALPHA | HEADER_BETA\n--- | ---\nCELL_ALPHA | CELL_BETA\n')
    expect(s.text, '无首尾管道表格的文字不得丢失').toContain('CELL_ALPHA')
  })

  it('T11 伪分隔线（`---x---`）与过短分隔线（`--`）按 GFM 判定一致、内容不丢', () => {
    for (const md of ['|列一|列二|\n|---x|---|\n|中文内容|对照|\n', '|列一|列二|\n|--|--|\n|中文内容|对照|\n']) {
      const s = snap(md)
      expect(s.error).toBeUndefined()
      expect(s.text).toContain('中文内容')
      expect(s.text).toContain('对照')
    }
  })
})
