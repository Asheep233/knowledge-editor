/**
 * S-2 测试：GFM 脚注 `[^1]` / `[^1]: 内容` 的等价解析（规范 `document-format.md` §2.3.1）。
 *
 * 三层：
 *  1) 纯函数：规范化输出（消歧边界、编号、重复定义、注入安全、确定性）
 *  2) 编辑器管线：规范化产物经真实扩展集解析为 `footnote` / `footnotes` 节点
 *  3) 闭环 + 互斥：plain-export 产物回读等价；GFM 表格 / 公式 / ke-* 不被抢占
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { ModuleExtension } from './extensions/ModuleExtension'
import { AttachmentExtension } from './extensions/AttachmentExtension'
import { VideoExtension } from './extensions/VideoExtension'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'
import {
  countGfmFootnotes,
  footnoteId,
  inlineMaskRanges,
  normalizeFootnoteLabel,
  normalizeGfmFootnotes,
  parseGfmDefinitionStart,
  scanRefsInLine,
} from './gfm-footnote'
import { downgradeKeNodes } from './plain-export'

const EXT = [
  StarterKit,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
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
]

/** 走生产同款管线：normalizeGfmFootnotes → marked/tiptap 解析 */
function parse(md: string) {
  const ed = new Editor({ extensions: EXT, content: normalizeGfmFootnotes(md), contentType: 'markdown' })
  // 收集**全部**节点类型（含容器 table/note 与 atom footnotes）；
  // 排除 text，否则结果被大量文本节点淹没。
  const chain: string[] = []
  let items: Array<{ id: string; n: number; text: string }> = []
  ed.state.doc.descendants((n) => {
    if (n.type.name !== 'text') chain.push(n.type.name)
    if (n.type.name === 'footnotes') {
      items = ((n.attrs as { items?: Array<{ id: string; n: number; text: string }> }).items ?? []).slice()
    }
    return true
  })
  const text = ed.state.doc.textContent
  const out = ed.getMarkdown()
  ed.destroy()
  return { chain, text, out, items }
}

const has = (chain: string[], t: string) => chain.includes(t)

describe('S-2 纯函数：规范化输出', () => {
  it('无脚注定义的文档原样返回（零行为变化）', () => {
    const md = '# 标题\n\n正文含 [^1] 但无定义，还有 [链接](a.md)。\n'
    expect(normalizeGfmFootnotes(md)).toBe(md)
    expect(countGfmFootnotes(md)).toEqual({ definitions: 0, references: 0 })
  })

  it('无 "[^" 的文档快速路径原样返回（含 256KB 级）', () => {
    const md = 'a'.repeat(1000) + '\n\n| 列 |\n| --- |\n'
    expect(normalizeGfmFootnotes(md)).toBe(md)
  })

  it('定义的 4 空格续行并入同一条目（GFM gfmFootnoteDefinitionCont）', () => {
    const out = normalizeGfmFootnotes('正文[^1]。\n\n[^1]: 第一段\n\n    第二段\n')
    expect(out).toContain('<!-- ke-footnotes:start -->')
    expect(out).toContain('第一段\\n\\n第二段')
    expect(out).toContain('<!-- ke-footnotes:end -->')
  })

  it('★ 编号按「定义首次被引用」的文档顺序（GFM 语义）', () => {
    // 正文先引用 bignote 再引用 1 → bignote 编号 1，1 编号 2
    const out = normalizeGfmFootnotes('A[^bignote] B[^1]\n\n[^1]: one\n[^bignote]: two\n')
    const items = [...out.matchAll(/ke-footnote-item: \{"id":"([^"]+)","n":(\d+)/g)].map((m) => `${m[1]}=${m[2]}`)
    const idBignote = footnoteId(normalizeFootnoteLabel('bignote'))
    const id1 = footnoteId(normalizeFootnoteLabel('1'))
    expect(items).toContain(`${idBignote}=1`)
    expect(items).toContain(`${id1}=2`)
  })

  it('仅定义无引用：保留内容并追加编号（与 GFM 渲染丢弃不同——编辑器不丢作者内容）', () => {
    const out = normalizeGfmFootnotes('正文无关。\n\n[^1]: 孤立定义\n')
    expect(out).toContain('孤立定义')
    expect(out).toContain('<!-- ke-footnotes:start -->')
  })

  it('重复定义：首个生效，其余保留为普通文本（不静默丢行）', () => {
    const out = normalizeGfmFootnotes('正文[^a]。\n\n[^a]: 第一个\n[^a]: 第二个\n')
    expect(out).toContain('第一个')
    expect(out).toContain('第二个') // 未静默丢弃
    expect([...out.matchAll(/ke-footnote-item:/g)]).toHaveLength(1)
  })

  it('大小写不敏感匹配（normalizeIdentifier）', () => {
    // 注：GFM label 文法不含空白（`text - spaceOrTab`），故此处只测大小写
    expect(normalizeFootnoteLabel('BigNote')).toBe(normalizeFootnoteLabel('bignote'))
    const out = normalizeGfmFootnotes('正文[^BIGNOTE]。\n\n[^bignote]: 内容\n')
    expect(out).toContain('ke-footnote:')
    expect(out).toContain('内容')
  })

  it('★ 边界：转义 / 行内代码内 / 围栏内 / 4 空格缩进 都不识别', () => {
    const esc = normalizeGfmFootnotes('正文\\[^1]。\n\n[^1]: 定义\n')
    expect(esc).not.toContain('ke-footnote:') // 引用未转 -> 无行内标记
    expect(esc).toContain('ke-footnotes:start') // 定义仍被收编

    const inlineCode = '正文 `[^1]` 代码。'
    // 掩码职责在调用方（inlineMaskRanges）；只调 scanRefsInLine 是"未掩码"语义
    expect(scanRefsInLine(inlineCode, inlineMaskRanges(inlineCode))).toHaveLength(0)
    expect(inlineMaskRanges(inlineCode)).toHaveLength(1)

    const fence = '```\n[^1]: 不是定义\n```\n\n正文[^1]。\n'
    expect(countGfmFootnotes(fence).definitions).toBe(0)
    expect(normalizeGfmFootnotes(fence)).toBe(fence)

    const indented = '正文无关。\n\n    [^1]: 缩进代码块\n'
    expect(countGfmFootnotes(indented).definitions).toBe(0)
  })

  it('未定义引用保持字面文本（定义感知，与 GFM 一致）', () => {
    const out = normalizeGfmFootnotes('正文[^missing]。\n\n[^1]: 只有这个\n')
    expect(out).not.toContain('ke-footnote:') // 无 "ke-footnote:"（注意别被 "ke-footnotes" 误判）
    expect(out).toContain('正文[^missing]。')
  })

  it('★ 脚注正文含 `-->` 原样往返（不得转义——P2-17 已由平衡 JSON 解析解决）', () => {
    const md = '正文[^1]。\n\n[^1]: 箭头 --> 结束\n'
    const out = normalizeGfmFootnotes(md)
    // 不引入任何转义：原文逐字保留
    expect(out).toContain('箭头 --> 结束')
    expect(out).not.toContain('\\u003e')
    // 平衡 JSON 解析（parseFootnoteItem）能正确取回整条，不被 `-->` 截断
    const r = parse(md)
    expect(r.items.map((i) => i.text)).toContain('箭头 --> 结束')
    // 再走一遍仍稳定
    expect(parse(r.out).items.map((i) => i.text)).toContain('箭头 --> 结束')
  })

  it('id 确定性：同一 label 两次派生一致（否则每次打开都会重写文件）', () => {
    expect(footnoteId(normalizeFootnoteLabel('note'))).toBe(footnoteId(normalizeFootnoteLabel('note')))
    const a = normalizeGfmFootnotes('x[^note]\n\n[^note]: t\n')
    const b = normalizeGfmFootnotes('x[^note]\n\n[^note]: t\n')
    expect(a).toBe(b)
  })

  it('parseGfmDefinitionStart 文法边界', () => {
    expect(parseGfmDefinitionStart('[^1]: x')).toEqual({ label: '1', body: 'x' })
    expect(parseGfmDefinitionStart('   [^1]: x')).toEqual({ label: '1', body: 'x' })
    // 4 空格 = 缩进代码块，**不是**定义起始（规范 §2.3.1 边界表）
    expect(parseGfmDefinitionStart('    [^1]: x')).toBeNull()
    expect(parseGfmDefinitionStart('[^]: x')).toBeNull() // 空 label
    expect(parseGfmDefinitionStart('[^1] x')).toBeNull() // 缺冒号
    expect(parseGfmDefinitionStart('[^a b]: x')).toBeNull() // label 含空格
    expect(parseGfmDefinitionStart('[^a[b]: x')).toBeNull() // 未转义 '['
    expect(parseGfmDefinitionStart('[^a\\]b]: x')).toEqual({ label: 'a]b', body: 'x' }) // 转义 ']'
  })
})

describe('S-2 掩码：不得改写非正文文本（独立验证发现的 5 个缺陷回归）', () => {
  it('D-A：缩进代码块内的 `[^1]` 不被改写', () => {
    const md = '正文：\n\n    [^1] 在缩进代码块里\n\n[^1]: 定义\n\n引用[^1]。\n'
    const out = normalizeGfmFootnotes(md)
    const codeLine = out.split('\n').find((l) => l.includes('在缩进代码块里'))
    expect(codeLine).toContain('[^1]') // 保持字面
    expect(codeLine).not.toContain('ke-footnote:')
  })

  it('D-B：行内公式 `$x[^2]$` 不被污染', () => {
    const md = '式子 $x[^2]$ 与引用[^1]。\n\n[^1]: 定义\n[^2]: 公式脚注\n'
    const out = normalizeGfmFootnotes(md)
    const mathLine = out.split('\n').find((l) => l.includes('式子'))
    expect(mathLine).toContain('$x[^2]$')
    expect(mathLine).not.toContain('$x<!--')
  })

  it('D-C：块级公式内的定义行不被提取（$$ 结构不破坏）', () => {
    const md = '正文[^1]。\n\n$$\n[^1]: 公式里的行\n$$\n\n[^1]: 真定义\n'
    const out = normalizeGfmFootnotes(md)
    const mathBody = out.split('\n').find((l) => l.includes('公式里的行'))
    expect(mathBody).toBe('[^1]: 公式里的行') // 原样留在 $$ 内
    expect([...out.matchAll(/ke-footnote-item:/g)]).toHaveLength(1) // 只收编真定义
  })

  it('D-D：HTML 注释内的 `[^1]` 不被改写（不产生嵌套注释）', () => {
    const md = '<!-- 注释里的 [^1] -->\n\n正文[^1]。\n\n[^1]: 定义\n'
    const out = normalizeGfmFootnotes(md)
    expect(out.split('\n')[0]).toBe('<!-- 注释里的 [^1] -->')
    expect(out.split('\n')[0]).not.toContain('ke-footnote:')
  })

  it('D-D2：行内 HTML 标签内的 `[^1]` 不被改写', () => {
    const md = '正文 <span data-x="[^1]">hi</span> 与引用[^1]。\n\n[^1]: 定义\n'
    const out = normalizeGfmFootnotes(md)
    expect(out).toContain('data-x="[^1]"')
  })

  it('★ D-E：重复定义中和为字面文本，且不产生多余上标（内容不丢）', () => {
    const md = '[^1]: 第一个\n\n[^1]: 第二个\n\n引用[^1]。\n'
    const out = normalizeGfmFootnotes(md)
    // 重复定义行被**转义中和**（否则 marked 当 link-ref-def 消费 → 内容消失）
    expect(out).toContain('\\[^1\\]: 第二个')
    const dupLine = out.split('\n').find((l) => l.includes('第二个'))
    expect(dupLine).not.toContain('ke-footnote:')
    // 恰好 1 个条目（首个生效）+ 正文 1 个行内引用
    expect([...out.matchAll(/ke-footnote-item:/g)]).toHaveLength(1)
    expect(out.match(/ke-footnote:/g) ?? []).toHaveLength(1)
    // 端到端：两段文本都还在（原缺陷：第二个被吃掉）
    const r = parse(md)
    expect(r.out).toContain('第一个')
    expect(r.out).toContain('第二个')
    expect(r.items).toHaveLength(1)
  })

  it('D-F：CRLF 文档的空行压缩生效（原实现在 CRLF 下永不匹配）', () => {
    const crlf = '正文[^1]。\r\n\r\n\r\n\r\n[^1]: 定义\r\n'
    const out = normalizeGfmFootnotes(crlf)
    expect(out).toContain('\r\n')
    expect(out).not.toMatch(/\r\n\r\n\r\n/)
  })

  it('掩码方向性：漏转是安全退化（宁可为字面文本）', () => {
    // 行内代码与围栏内的引用一律保持字面，不因"可能漏转"而误转
    const md = '代码 `[^1]` 与\n\n```\n[^1]\n```\n\n[^1]: 定义\n'
    const out = normalizeGfmFootnotes(md)
    expect(out.match(/ke-footnote:/g) ?? []).toHaveLength(0)
    expect(out).toContain('`[^1]`')
  })
})

describe('S-2 编辑器管线：三类损坏不再发生', () => {
  it('★ case A：引用 + 定义 → 脚注节点，不再变链接', () => {
    const r = parse('正文[^1]。\n\n[^1]: 第一脚注\n')
    expect(has(r.chain, 'footnote')).toBe(true)
    expect(has(r.chain, 'footnotes')).toBe(true)
    expect(r.out).not.toMatch(/\[\^1\]\(/) // 不再产出假链接
    expect(r.out).toContain('ke-footnote')
  })

  it('★ case C：孤立定义不再整行消失（原为真数据丢失）', () => {
    const r = parse('正文无关。\n\n[^1]: 孤立定义\n')
    expect(r.out).toContain('孤立定义')
    expect(has(r.chain, 'footnotes')).toBe(true)
  })

  it('★ case G：多段落脚注续行不再变代码块', () => {
    const r = parse('正文[^1]。\n\n[^1]: 第一段\n\n    续行\n')
    expect(r.chain).not.toContain('codeBlock')
    // footnotes 是 atom，其 items[].text 不在 textContent 中——按 attrs 断言
    expect(r.items.some((i) => i.text.includes('续行'))).toBe(true)
  })

  it('★ case H：命名标签同样识别', () => {
    const r = parse('正文[^note]。\n\n[^note]: 命名内容\n')
    expect(has(r.chain, 'footnote')).toBe(true)
    expect(has(r.chain, 'footnotes')).toBe(true)
  })

  it('case B：仅引用无定义 → 保持字面（与改动前一致）', () => {
    const r = parse('正文[^1]。\n')
    expect(has(r.chain, 'footnote')).toBe(false)
    expect(r.text).toContain('[^1]')
  })

  it('二次解析幂等：规范化后的 ke 方言再走一次不变化', () => {
    const once = normalizeGfmFootnotes('正文[^1]。\n\n[^1]: 内容\n')
    expect(normalizeGfmFootnotes(once)).toBe(once)
  })
})

describe('S-2 闭环：导出普通 Markdown → 回读等价（原测试盲区）', () => {
  it('★ GFM 文档 → 规范化 → 落 ke → plain-export 降级 → 回读，脚注结构等价', () => {
    const gfm = '正文引用[^1]与命名[^note]。\n\n[^1]: 第一条\n[^note]: 第二条\n'
    // 打开（规范化 + 解析）后落盘为 ke 方言
    const saved = parse(gfm).out
    expect(saved).toContain('ke-footnote')
    // 导出「普通 Markdown」→ 降级回 GFM
    const exported = downgradeKeNodes(saved)
    expect(exported).toContain('[^1]')
    expect(exported).toMatch(/\[\^1\]: /)
    // 回读导出产物 → 脚注结构仍等价
    const re = parse(exported)
    expect(has(re.chain, 'footnote')).toBe(true)
    expect(has(re.chain, 'footnotes')).toBe(true)
    const texts = re.items.map((i) => i.text).join('|')
    expect(texts).toContain('第一条')
    expect(texts).toContain('第二条')
  })
})

describe('S-2 互斥：不抢占既有语法', () => {
  it('GFM 表格不被脚注规则吃掉', () => {
    const r = parse('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n\n正文[^1]。\n\n[^1]: 定义\n')
    expect(r.chain).toContain('table')
    expect(has(r.chain, 'footnote')).toBe(true)
  })

  it('行内/块级公式不被吃掉', () => {
    const r = parse('公式 $E=mc^2$ 与引用[^1]。\n\n$$\n\\int x\n$$\n\n[^1]: 定义\n')
    expect(r.chain).toContain('math')
    expect(r.chain).toContain('mathBlock')
    expect(has(r.chain, 'footnote')).toBe(true)
  })

  it('ke-* 标记不被吃掉，且与 GFM 脚注共存', () => {
    const md =
      '<!-- ke-note: {"kind":"note","id":"n1","title":"要点"} -->\n块内<!-- /ke-note -->\n\n' +
      '正文[^1]。\n\n[^1]: 定义\n'
    const r = parse(md)
    expect(r.chain).toContain('note')
    expect(has(r.chain, 'footnote')).toBe(true)
  })

  it('ke 原生脚注区域不被重复处理（与 GFM 混用）', () => {
    const md =
      '正文<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->在此。\n\n' +
      '<!-- ke-footnotes:start -->\n' +
      '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"原生"} -->\n' +
      '<!-- ke-footnotes:end -->\n'
    expect(normalizeGfmFootnotes(md)).toBe(md) // 无 GFM 定义 → 原样
    const r = parse(md)
    expect(has(r.chain, 'footnote')).toBe(true)
    expect(r.items.map((i) => i.text)).toContain('原生')
  })
})
