/**
 * task-68 M02（P1，外部复审 2026-10-10）：**合法 GFM 表格导入后整表变空段落、单元格文字全丢**。
 *
 * 机制（本文件锁定）：`ke_table` 自定义 tokenizer 只认「**首尾都有 `|`** 且分隔线 `-{3,}`」的表格；
 * 合法但非常规的 GFM 表格（短分隔线 `|--|`、无首尾管道、混合首尾管道）没被它认领 →
 * marked 产出**默认 `table` token** → 而全仓没有该 token 的 handler → token 被丢弃 →
 * 整表变成空段落，单元格文字全部消失（真实 UI 确认的内容丢失）。
 *
 * 契约：① 上述矩阵**必须成表且文字不丢**；② 规范表格往返**字节一致**（幂等）；
 * ③ 含 `|` 的普通段落不得被误判为表格（task-66 回归）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'
import { GfmTableFallbackExtension } from './extensions/GfmTableFallbackExtension'
import { setKeContent } from './index'

const EXT = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  TableMarkdownExtension,
  GfmTableFallbackExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
] as never

interface TableProbe {
  isTable: boolean
  rows: number
  cells: number
  text: string
  out: string
}

function probe(md: string): TableProbe {
  const ed = new Editor({ extensions: EXT, content: '', contentType: 'markdown' })
  setKeContent(ed, md)
  let rows = 0
  let cells = 0
  let isTable = false
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'table') {
      isTable = true
      rows = n.childCount
      n.forEach((r) => {
        cells += r.childCount
      })
    }
  })
  const text = ed.state.doc.textContent
  const out = ed.getMarkdown()
  ed.destroy()
  return { isTable, rows, cells, text, out }
}

/** 合法 GFM 表格矩阵（全部为规范允许的写法） */
const CASES: Array<{ name: string; md: string; cols: number }> = [
  { name: '规范（首尾管道 + --- 分隔线）', md: '| a | b |\n| --- | --- |\n| 1 | 2 |\n', cols: 2 },
  { name: '短分隔线（|--|，GFM 允许 1 个以上 -）', md: '| a | b |\n|--|--|\n| 1 | 2 |\n', cols: 2 },
  { name: '无首尾管道', md: 'a | b\n--|--\n1 | 2\n', cols: 2 },
  { name: '混合首尾管道（头有尾无）', md: '| a | b\n|--|--\n| 1 | 2\n', cols: 2 },
  { name: '混合首尾管道（头无尾有）', md: 'a | b |\n--|--|\n1 | 2 |\n', cols: 2 },
  { name: '冒号对齐 + 短分隔线', md: '| a | b |\n|:--|--:|\n| 1 | 2 |\n', cols: 2 },
  { name: '单列短分隔线', md: '| a |\n|-|\n| 1 |\n', cols: 1 },
]

describe('task-68 M02：合法 GFM 表格不得变空段落（内容丢失）', () => {
  for (const { name, md, cols } of CASES) {
    it(`${name}：成表且单元格文字不丢`, () => {
      const r = probe(md)
      expect(r.isTable, `整表未成表（文字丢失）: ${JSON.stringify(r)}`).toBe(true)
      expect(r.rows, '行数不正确（表头 + 数据行）').toBe(2)
      expect(r.cells, '单元格总数不正确（2 行 × 列数）').toBe(2 * cols)
      for (const t of ['a', '1']) {
        expect(r.text, `单元格文字丢失：${t}`).toContain(t)
      }
      if (cols > 1) expect(r.text, '第二列文字丢失').toContain('b')
    })
  }

  it('规范表格往返稳定且幂等（表格行字节一致）', () => {
    // 说明：本层只断言**表格行**逐字节一致 + 首次归一后幂等（文档级字节口径由既有
    // `markdown-roundtrip` / `fidelity-*` / `phase3-roundtrip` 套件覆盖，本单不得回退它们）。
    const md = CASES[0].md
    const first = probe(md).out
    expect(first, `规范表格行被改写：${JSON.stringify(first)}`).toContain('| a | b |')
    expect(first).toContain('| --- | --- |')
    expect(first).toContain('| 1 | 2 |')
    expect(probe(first).out, '第二次往返不稳定（字节漂移）').toBe(first)
  })

  it('短分隔线表格往返稳定（归一为规范分隔线，但文字与结构不丢）', () => {
    const r = probe(CASES[1].md)
    expect(r.out).toContain('| a | b |')
    expect(r.out).toContain('| 1 | 2 |')
    expect(probe(r.out).out, '往返不稳定').toBe(r.out)
  })

  it('task-66 回归：含 `|` 的普通段落不得被误判为表格', () => {
    const md = '公式 $|\\mathbb{Q}|=\\aleph_0$ 出现在段落里，还有 a | b 这样的字面管道。\n'
    const r = probe(md)
    expect(r.isTable, '普通段落被误判为表格').toBe(false)
    expect(r.text).toContain('aleph_0')
    expect(r.text, '段落文字不得丢失').toContain('字面管道')
  })

  it('安全网：默认 `table` token 也有生产 handler（未认领的合法表格不得变成空段落）', () => {
    // 直接用 marked 的 table token 形态驱动 handler（不依赖 ke_table 是否认领）
    const helpers = {
      parseInline: (tokens: unknown[]) =>
        (tokens ?? []).map((t) => ({ type: 'text', text: (t as { text?: string }).text ?? '' })),
      renderChildren: () => '',
    }
    const json = GfmTableFallbackExtension.config.parseMarkdown?.(
      {
        type: 'table',
        header: [{ text: 'h1', tokens: [{ type: 'text', text: 'h1' }] }, { text: 'h2', tokens: [{ type: 'text', text: 'h2' }] }],
        rows: [[{ text: 'c1', tokens: [{ type: 'text', text: 'c1' }] }, { text: 'c2', tokens: [{ type: 'text', text: 'c2' }] }]],
      } as never,
      helpers as never,
    ) as { type?: string; content?: Array<{ type?: string; content?: Array<{ content?: Array<{ content?: Array<{ text?: string }> }> }> }> }
    expect(json?.type, '安全网未产出 table 节点').toBe('table')
    const flat = JSON.stringify(json)
    for (const t of ['h1', 'h2', 'c1', 'c2']) {
      expect(flat, `安全网丢字：${t}`).toContain(t)
    }
  })
})
