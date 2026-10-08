/**
 * task-60（`\tag` 渲染异常）——**解析/渲染链路回归**。
 *
 * 背景：真机（v1.2.8）在用户文档里量到 **0 个 `.katex-tag`**，一度怀疑「列表项内缩进的
 * `$$` 没被识别为 mathBlock，退化成 inline math → KaTeX 行内模式不支持 `\tag`」。
 * 本套件用**与生产同序的扩展栈**证实该假设**不成立**，并把整条链路锁住：
 *
 *   markdown（列表项内缩进 3 空格的 `$$…\tag{…}$$`）
 *     → `orderedList > listItem > mathBlock`（**不是** inline `math`），latex 逐字含 `\tag`
 *     → `MathBlockExtension.renderMarkdown` 原样输出 `$$\n…\n$$`（往返不漂移，D 层契约）
 *     → `katex.renderToString(latex, { displayMode: true })` 产出 `.katex-tag`（含 `(2.2.2.1)`）
 *
 * 对照与边界：
 *  · 顶层 `$$…\tag…$$`、引用块内 `$$…\tag…$$` 同样是 mathBlock 且能产出 tag；
 *  · **真行内** `$…\tag…$`：KaTeX 行内模式**不产生** `.katex-tag`（上游既定行为，非本仓库缺陷）
 *    → 仅作记录性断言，不做自动「提升为块」的处理（会改文档结构/序列化，需产品决策）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'
import { KeListItem, OrderedListParenExtension } from './extensions/ListExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { MathExtension } from './extensions/MathExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { ModuleExtension } from './extensions/ModuleExtension'
import { AttachmentExtension } from './extensions/AttachmentExtension'
import { VideoExtension } from './extensions/VideoExtension'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { setKeContent } from './index'

/** 与生产 `index.ts` 同序的扩展栈（D-1/ADD-3 起：Document/Blockquote 由 Ke* 接管） */
const EXTENSIONS = [
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    document: false,
    blockquote: false,
    link: { openOnClick: false, autolink: true },
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  KeBlockquote,
  OrderedListParenExtension,
  KeListItem,
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
  TaskList,
  TaskItem,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
] as never

function parse(md: string): { types: string[]; latex: string[]; out: string } {
  const ed = new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
  setKeContent(ed, md)
  const types: string[] = []
  const latex: string[] = []
  ed.state.doc.descendants((n) => {
    types.push(n.type.name)
    if (n.attrs?.latex !== undefined) latex.push(String(n.attrs.latex))
  })
  const out = ed.getMarkdown()
  ed.destroy()
  return { types, latex, out }
}

const TAG = '\\tag{2.2.2.1}'
/** 用户现场：有序列表项内、缩进 3 空格的 `$$` 块（第 235-237 行） */
const USER_MD = `1. 如果复数$x$满足多项式方程：\n   $$\n   a_0x^n+a_1x^{n-1}+a_n=0 ${TAG}\n   $$\n`

describe('task-60 `\\tag`：解析与渲染链路', () => {
  it('用户现场：列表项内缩进 `$$` 必须解析为 **mathBlock**（不是 inline math），latex 含 `\\tag`', () => {
    const { types, latex } = parse(USER_MD)
    expect(types).toContain('orderedList')
    expect(types).toContain('listItem')
    expect(types, '退化成 inline math 的回归').toContain('mathBlock')
    // inline `math` 只应来自 `$x$` 那一处，不应出现第二个（即 `$$` 块没被当行内）
    expect(types.filter((t) => t === 'math').length).toBe(1)
    expect(latex).toContain(`a_0x^n+a_1x^{n-1}+a_n=0 ${TAG}`)
  })

  it('D 层契约：`$$` 块往返序列化不漂移（含列表缩进与 tag）', () => {
    const { out } = parse(USER_MD)
    expect(out).toContain(`   $$\n   a_0x^n+a_1x^{n-1}+a_n=0 ${TAG}\n   $$`)
    expect(out).toContain(`1. 如果复数$x$满足多项式方程：`)
    // 再往返一次必须稳定
    expect(parse(out).out).toBe(out)
  })

  it('渲染：mathBlock 的 latex → KaTeX display 模式产出 `.katex-tag`（含 `(2.2.2.1)`）', () => {
    const { latex } = parse(USER_MD)
    const blockLatex = latex.find((l) => l.includes('\\tag'))!
    const html = katex.renderToString(blockLatex, { displayMode: true, throwOnError: false, output: 'html' })
    expect(html).toContain('class="katex-tag"')
    expect(html.replace(/<[^>]+>/g, '')).toContain('(2.2.2.1)')
  })

  it('对照：顶层 / 引用块内的 `$$…\\tag…$$` 同样是 mathBlock 且能产出 tag', () => {
    const top = parse(`正文\n\n$$\na+b=0 ${TAG}\n$$\n`)
    expect(top.types).toContain('mathBlock')
    expect(top.out).toContain(`$$\na+b=0 ${TAG}\n$$`)
    const quote = parse(`> 引理\n>\n> $$\n> a+b=0 ${TAG}\n> $$\n`)
    expect(quote.types).toContain('mathBlock')
    expect(quote.types).toContain('blockquote')
    for (const latex of [top.latex, quote.latex]) {
      const l = latex.find((x) => x.includes('\\tag'))!
      expect(katex.renderToString(l, { displayMode: true, throwOnError: false })).toContain('katex-tag')
    }
  })

  it('边界记录：**真行内** `$…\\tag…$` 解析为 inline math，KaTeX 行内模式不产出 `.katex-tag`（上游既定行为）', () => {
    const { types, latex } = parse(`正文 $a+b=0 ${TAG}$ 结尾\n`)
    expect(types).toContain('math')
    expect(types).not.toContain('mathBlock')
    const inlineLatex = latex[0]
    const html = katex.renderToString(inlineLatex, { displayMode: false, throwOnError: false })
    expect(html, 'KaTeX 行内模式不支持 \\tag（不产出 tag 元素）').not.toContain('katex-tag')
  })
})
