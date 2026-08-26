/**
 * P1-2 / P1-3 / P1-4 / P1-5 回归测试（knowledge-editor-fix-checklist.md 阶段二·Markdown 保真组）。
 *
 * 覆盖：
 * - P1-2  普通 HTML 注释（块级/行内）与完整 HTML 块 round-trip 原文保留（keHtmlComment / keHtmlBlock / keHtmlCommentInline 节点）；
 * - P1-3  `ke-*` 已知 kind + 损坏 JSON 不再静默丢弃（keFallback 原文保留）；
 * - P1-4  表格 `\|` 转义感知解析（列数不变）+ 单元格 inline 富文本双向（加粗/链接）；
 * - P1-5  ke-module 的 source 与 id/name/version/params 合并输出，字段全保留；
 * - 零漂移：二次序列化输出一致。
 *
 * 扩展注册顺序与 src/editor/index.ts 保持一致：
 * fallback 最先注册（marked rules 中最后执行）→ HTML 保真 → ke-* 具体扩展最后注册（最先执行）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { ModuleExtension } from './extensions/ModuleExtension'
import { AttachmentExtension } from './extensions/AttachmentExtension'
import { VideoExtension } from './extensions/VideoExtension'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'
import {
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
} from './extensions/TableMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import {
  HtmlCommentExtension,
  HtmlBlockExtension,
  HtmlCommentInlineExtension,
} from './extensions/HtmlFidelityExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'

const EXTENSIONS = [
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  HtmlCommentExtension,
  HtmlBlockExtension,
  HtmlCommentInlineExtension,
  StarterKit.configure({
    link: {
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    },
    trailingNode: {
      node: 'paragraph',
      notAfter: ['paragraph', 'footnotes'],
    },
  }),
  ImageMarkdownExtension,
  MathExtension,
  MathBlockExtension,
  NoteExtension,
  ModuleExtension,
  AttachmentExtension,
  VideoExtension,
  FootnoteExtension,
  FootnotesExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function makeEditor(content: string): Editor {
  return new Editor({ extensions: EXTENSIONS, content, contentType: 'markdown' })
}

function blocksOf(json: JSONContent, type: string): JSONContent[] {
  return (json.content ?? []).filter((n) => n.type === type)
}

/** 表格第 0 行的第 col 列单元格内第一个文本节点的内容 */
function tableCellText(table: JSONContent, col: number): string | undefined {
  const header = (table.content ?? [])[0]
  const cell = (header?.content ?? [])[col]
  const para = (cell?.content ?? [])[0]
  return (para?.content ?? []).map((n) => n.text ?? '').join('')
}

// ---------- P1-2：HTML 注释 / HTML 块原文保真 ----------

describe('P1-2 普通 HTML 注释/块 round-trip 原文保留', () => {
  it('块级普通注释解析为 keHtmlComment，raw 精确匹配并原样输出', () => {
    const md = '前文。\n\n<!-- 普通注释 -->\n\n后文。'
    const ed = makeEditor(md)
    const comment = blocksOf(ed.getJSON(), 'keHtmlComment')
    expect(comment.length).toBe(1)
    expect((comment[0]?.attrs as { raw?: string } | undefined)?.raw).toBe('<!-- 普通注释 -->')
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- 普通注释 -->')
    expect(back).toContain('前文')
    expect(back).toContain('后文')
    ed.destroy()
  })

  it('行内普通注释解析为 keHtmlCommentInline 并原样保留', () => {
    const md = '文本 <!-- 行内注释 --> 结尾'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const inline = (json.content ?? [])
      .flatMap((n) => n.content ?? [])
      .filter((n) => n.type === 'keHtmlCommentInline')
    expect(inline.length).toBe(1)
    expect((inline[0]?.attrs as { raw?: string } | undefined)?.raw).toBe('<!-- 行内注释 -->')
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- 行内注释 -->')
    expect(back).toContain('文本')
    expect(back).toContain('结尾')
    ed.destroy()
  })

  it('完整 HTML 块解析为 keHtmlBlock，标签与内容原文保留', () => {
    const md = '前文。\n\n<div class="x">内容</div>\n\n后文。'
    const ed = makeEditor(md)
    const block = blocksOf(ed.getJSON(), 'keHtmlBlock')
    expect(block.length).toBe(1)
    expect((block[0]?.attrs as { raw?: string } | undefined)?.raw).toBe('<div class="x">内容</div>')
    const back = ed.getMarkdown()
    expect(back).toContain('<div class="x">内容</div>')
    expect(back).not.toContain('<div class="x">内容</div>内容</div>')
    ed.destroy()
  })

  it('HTML 保真节点二次序列化零漂移（含注释与 HTML 块的混合文档）', () => {
    const md = [
      '段落一。',
      '',
      '<!-- 块级注释 -->',
      '',
      '<div class="a">块内容</div>',
      '',
      '段落二含 <!-- 行内注释 --> 结束。',
    ].join('\n')
    const ed = makeEditor(md)
    const back1 = ed.getMarkdown()
    expect(back1).toContain('<!-- 块级注释 -->')
    expect(back1).toContain('<div class="a">块内容</div>')
    expect(back1).toContain('<!-- 行内注释 -->')
    const ed2 = makeEditor(back1)
    expect(ed2.getMarkdown()).toBe(back1)
    ed.destroy()
    ed2.destroy()
  })
})

// ---------- P1-3：已知 kind + 损坏 JSON 不再丢弃 ----------

describe('P1-3 ke-* 损坏 JSON 原文保留', () => {
  it('已知 kind（ke-attach）携带损坏 JSON 时整体保留为 keFallback', () => {
    const md = '前文。\n\n<!-- ke-attach: {bad json} -->\n\n后文。'
    const ed = makeEditor(md)
    const fb = blocksOf(ed.getJSON(), 'keFallback')
    expect(fb.length).toBe(1)
    expect((fb[0]?.attrs as { raw?: string } | undefined)?.raw).toBe('<!-- ke-attach: {bad json} -->')
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-attach: {bad json} -->')
    expect(back).toContain('前文')
    expect(back).toContain('后文')
    ed.destroy()
  })

  it('损坏 JSON 不抢占有效标记：合法 ke-attach 仍解析为 attach 节点', () => {
    const md = '<!-- ke-attach: {"kind":"attach","id":"a1","type":"image","src":"Attachments/images/x.png","title":"图"} -->'
    const ed = makeEditor(md)
    expect(blocksOf(ed.getJSON(), 'attach').length).toBe(1)
    expect(blocksOf(ed.getJSON(), 'keFallback').length).toBe(0)
    const back = ed.getMarkdown()
    expect(back).toContain('"src":"Attachments/images/x.png"')
    ed.destroy()
  })

  it('损坏 JSON 行内标记（ke-footnote 坏 JSON）原文保留', () => {
    const md = '正文 <!-- ke-footnote: {bad} --> 结尾'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-footnote: {bad} -->')
    ed.destroy()
  })
})

// ---------- P1-4：表格转义管道 + 单元格富文本 ----------

describe('P1-4 表格保真', () => {
  it('转义管道符 `\\|` 不再错切列：列数不变、内容还原', () => {
    const md = '| a | b \\| c |\n| --- | --- |\n| 1 | 2 |'
    const ed = makeEditor(md)
    const table = blocksOf(ed.getJSON(), 'table')
    expect(table.length).toBe(1)
    // 表头两列（`b \| c` 是第二列的单元格内容，不拆成第三列）
    expect((table[0]?.content ?? [])[0]?.content).toHaveLength(2)
    expect(tableCellText(table[0], 1)).toBe('b | c')
    const back = ed.getMarkdown()
    expect(back).toContain('| a | b \\| c |')
    expect(back).toContain('| 1 | 2 |')
    ed.destroy()
  })

  it('单元格加粗/链接保留为 inline marks 并往返输出 Markdown', () => {
    const md = '| **x** | [y](http://a.b) |\n| --- | --- |'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const table = blocksOf(json, 'table')
    expect(table.length).toBe(1)
    const header = (table[0]?.content ?? [])[0]
    const cell0 = (header?.content ?? [])[0]
    const bold = (cell0?.content ?? [])[0]?.content?.[0]
    expect(bold).toEqual(expect.objectContaining({ type: 'text', text: 'x', marks: [{ type: 'bold' }] }))
    const cell1 = (header?.content ?? [])[1]
    const link = (cell1?.content ?? [])[0]?.content?.[0]
    expect(link?.type).toBe('text')
    expect(link?.text).toBe('y')
    expect((link?.marks as Array<{ type: string; attrs?: { href?: string } }> | undefined)?.[0]).toEqual(
      expect.objectContaining({ type: 'link', attrs: expect.objectContaining({ href: 'http://a.b' }) }),
    )
    const back = ed.getMarkdown()
    expect(back).toContain('| **x** | [y](http://a.b) |')
    ed.destroy()
  })

  it('富文本 + 转义管道混合表格二次序列化零漂移', () => {
    const md = '| 项 | 值 |\n| --- | --- |\n| **A** | 1 \\| 2 |'
    const ed = makeEditor(md)
    const back1 = ed.getMarkdown()
    expect(back1).toContain('**A**')
    expect(back1).toContain('1 \\| 2')
    const ed2 = makeEditor(back1)
    expect(ed2.getMarkdown()).toBe(back1)
    ed.destroy()
    ed2.destroy()
  })
})

// ---------- P1-5：ke-module source 合并输出 ----------

describe('P1-5 ke-module 字段全保留', () => {
  it('{kind,id,name,version,params,source} 全字段 round-trip 保留', () => {
    const md = '<!-- ke-module: {"kind":"module","id":"m1","name":"部署","version":2,"params":{"a":1},"source":"Modules/x.md"} -->'
    const ed = makeEditor(md)
    const mod = blocksOf(ed.getJSON(), 'module')
    expect(mod.length).toBe(1)
    const attrs = mod[0]?.attrs as Record<string, unknown> | undefined
    expect(attrs?.id).toBe('m1')
    expect(attrs?.name).toBe('部署')
    expect(attrs?.version).toBe(2)
    expect((attrs?.params as Record<string, unknown> | undefined)?.a).toBe(1)
    expect(attrs?.source).toBe('Modules/x.md')
    const back = ed.getMarkdown()
    // source 与既有字段合并输出，互不丢弃
    expect(back).toContain('"id":"m1"')
    expect(back).toContain('"name":"部署"')
    expect(back).toContain('"version":2')
    expect(back).toContain('"params":{"a":1}')
    expect(back).toContain('"source":"Modules/x.md"')
    // 二次序列化零漂移
    const ed2 = makeEditor(back)
    expect(ed2.getMarkdown()).toBe(back)
    ed.destroy()
    ed2.destroy()
  })

  it('仅含 source 的来源标记（规范示例格式）往返零漂移', () => {
    const md = '<!-- ke-module: {"source":"Modules/Math/Definition.md"} -->\n\n## 定义\n\n设 X 是集合。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('"source":"Modules/Math/Definition.md"')
    expect(back).toContain('## 定义')
    const ed2 = makeEditor(back)
    expect(ed2.getMarkdown()).toBe(back)
    ed.destroy()
    ed2.destroy()
  })
})
