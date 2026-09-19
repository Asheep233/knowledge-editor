/**
 * 独立对抗验证套件 —— D-1 / D-2 / EDGE-1 修复（task-39）· 骨架（第一段）
 *
 * ⚠️ 由**验证员 verifier-s2** 编写，独立于 task-39 的验收条目与任何修复回归文件。
 * 依据：`docs/document-format.md` §2.6（契约 + D-1/D-2/D-3）+ `docs/backlog-1.1.x.md`
 *      主理人裁决（D-1/D-2/EDGE-1 全修；D-3 保持现状）+ 我在 task-32/36 的原始实测。
 *
 * 判据分层（沿用 task-32 口径）：
 *   A 严格：trimEnd 归一后逐字节 + 幂等
 *   B 语义等价：D-3（裸 `&`→`&amp;`、`[X]`→`[x]`、`<br>`/`<a>` 标准转换）——保持现状，不得回归
 *   C 结构断言：紧凑/列表分离/嵌套归属等结构性不变量（逐字节之外）
 *
 * ── 修前实测（我于 HEAD `00568c4` 树外副本逐条跑出，用作报告对照基线）──
 *   D-1
 *     d1a `- [x] a\n- b\n- [ ] c`        → `- [x] a\n\n- b\n\n- [ ] c`（松散；D-1 本体）
 *     d1b `1. [x] a\n2. b`               → `1. \[x\] a\n2. b`（**复选框被转义成字面**，见 §发现2）
 *     d1c `- a\n  - [x] b`               → 同形（紧凑）
 *     d1d `- [x] a\n  - b`               → 同形（紧凑）
 *     d1e `> - [x] a\n> - b`             → `> - [x] a\n>\n> - b`（引用块内松散）
 *     d1f `- a\n\n- b`（松散列表）        → `- a\n- b`（**松散被压紧**：既有行为，非 D-1 范围但需防修坏）
 *     d1g 多段列表项                      → `- [x] a\n\n  second para\n\n- b`（结构保留）
 *     d1h 段落分隔的两个列表               → 保持两个列表 ✅
 *   D-2
 *     d2a `<em><span>x</span></em>`      → `*x*`（内层丢失；D-2 本体）
 *     d2b `<strong><mark>x</mark></strong>` → `**x**`
 *     d2c `<a href><kbd>k</kbd></a>`     → `[k](http://u)`
 *     d2d 三层嵌套                        → `***x***`
 *     d2e `<span><em>x</em></span>`      → `<span>*x*</span>`（未知外→保留；这是 D-2 的目标形态）
 *     d2f `<em><span title="a>b">x</span></em>` → `*x*`
 *     d2g `<em>x</em>`                   → `*x*`（**不得回归**）
 *     d2i/d2j 代码与围栏内                 → 字面保留 ✅
 *   EDGE-1
 *     e1 `---\n---\n\n正文`              → `stripFrontmatter` **不识别**（整块当正文）、`frontmatterBlockOf`=null、
 *                                          `withFrontmatter` 再套一层 → 双区块；往返丢 `ke_version`
 *     e3/e4 CRLF / BOM+CRLF 变体          → 同上
 *     e5 `---\n---\n\n正文\n\n---\n\n更多` → body=`更多`（**正文被当 frontmatter 吞掉**，见 §发现1）
 *     e7 `---\n\n正文\n\n---`             → body=`""`（**整篇被当 frontmatter → 全量内容丢失**，见 §发现1）
 *     e6 三条定界符                        → body=`正文`、块含三行 `---`
 *
 * 运行（第二段，收到「源码就绪 + 冻结 sha」后）：
 *   cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
 *   npx vitest run src/editor/fidelity-fixes-120.verify.test.ts --reporter=verbose
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { describe, expect, it } from 'vitest'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { ModuleExtension } from './extensions/ModuleExtension'
import { AttachmentExtension } from './extensions/AttachmentExtension'
import { VideoExtension } from './extensions/VideoExtension'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'
import { OrderedListParenExtension, KeListItem } from './extensions/ListExtension'
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'
import {
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
} from './extensions/TableMarkdownExtension'
import { normalizeGfmFootnotes } from './gfm-footnote'
import { applyDocTraits, captureDocTraits, frontmatterBlockOf, KE_VERSION, stripFrontmatter, withFrontmatter } from './ke'

/** 生产同序扩展栈（含 F-1 的 TaskList/TaskItem） */
export const PROD_EXTENSIONS = [
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    // D-1：任务项与普通项是不同类型节点 → 关闭内置 document/blockquote，改用 KeDocument/KeBlockquote
    document: false,
    blockquote: false,
    link: { openOnClick: false, autolink: true },
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  KeBlockquote,
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  OrderedListParenExtension,
  KeListItem,
  TaskList,
  TaskItem,
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

/** 生产口径往返：stripFrontmatter → normalizeGfmFootnotes → setContent → getMarkdown（跑两次） */
export function roundtrip(raw: string): { body: string; out: string; out2: string } {
  const body = stripFrontmatter(raw).content
  const ed = new Editor({ extensions: PROD_EXTENSIONS, content: normalizeGfmFootnotes(body), contentType: 'markdown' })
  const out = ed.getMarkdown()
  ed.destroy()
  const ed2 = new Editor({ extensions: PROD_EXTENSIONS, content: normalizeGfmFootnotes(out), contentType: 'markdown' })
  const out2 = ed2.getMarkdown()
  ed2.destroy()
  return { body, out, out2 }
}

export function trimEnd(s: string): string {
  return s.replace(/[\r\n]+$/, '')
}

/** 三函数一致性辅助：直接取源 frontmatter 区块（E1-9 用） */
export function fmBlockOf(raw: string): string | null {
  return frontmatterBlockOf(raw)
}

/** 文件级保存链（含 traits 还原 + frontmatter 合并） */
export function saveChain(raw: string): string {
  const traits = captureDocTraits(raw)
  const { out } = roundtrip(raw)
  return applyDocTraits(withFrontmatter(out, KE_VERSION), traits)
}

/** 列表结构摘要：按行给出（缩进, 标记类型, 复选框状态, 文本），用于结构断言 */
export function listShape(md: string): string[] {
  return md
    .split(/\r?\n/)
    .filter((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l))
    .map((l) => {
      const indent = /^(\s*)/.exec(l)?.[1].length ?? 0
      const marker = /^\s*([-*+]|\d+[.)])\s/.exec(l)?.[1] ?? '?'
      const box = /\[([ xX])\]/.exec(l)?.[1] ?? '-'
      const text = l.replace(/^\s*(?:[-*+]|\d+[.)])\s*(\[[ xX]\]\s*)?/, '')
      return `${indent}:${marker === '-' || marker === '*' || marker === '+' ? 'ul' : 'ol'}:${box}:${text}`
    })
}


/** 列表项之间的空行检测（松散） */
function hasBlankBetweenItems(md: string): boolean {
  const lines = md.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i])) continue
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j > i + 1 && j < lines.length && /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[j])) return true
  }
  return false
}
/** 顶层列表数量（PM 结构计数，用于「两个列表不得粘连/同一列表不得拆开」） */
function topLevelListCount(md: string): number {
  const ed = new Editor({ extensions: PROD_EXTENSIONS, content: normalizeGfmFootnotes(md), contentType: 'markdown' })
  const json = ed.getJSON() as unknown as { content?: Array<{ type?: string }> }
  const n = (json.content ?? []).filter(
    (x) => x.type === 'bulletList' || x.type === 'orderedList' || x.type === 'taskList',
  ).length
  ed.destroy()
  return n
}

describe('D-1 混合列表', () => {
  it('D1-1 混排紧凑 + 状态/文本不丢（严格）', () => {
    const raw = '- [x] a\n- b\n- [ ] c\n'
    const { out } = roundtrip(raw)
    expect(hasBlankBetweenItems(out), '项间出现空行（仍松散）').toBe(false)
    expect(trimEnd(out)).toBe(trimEnd(raw))
    expect(out).toContain('- [x] a')
    expect(out).toContain('- [ ] c')
  })

  it('D1-2 有序列表内任务项不得被转义为字面', () => {
    const { out } = roundtrip('1. [x] a\n2. b\n')
    expect(out, '复选框被转义').not.toContain('\\[x\\]')
    expect(out).toMatch(/^1\. \[[ xX]\] a$/m)
    expect(hasBlankBetweenItems(out)).toBe(false)
  })

  it('D1-3 普通项内嵌任务项：紧凑 + 归属正确', () => {
    const { out } = roundtrip('- a\n  - [x] b\n')
    expect(trimEnd(out)).toBe('- a\n  - [x] b')
    expect(hasBlankBetweenItems(out)).toBe(false)
  })

  it('D1-4 任务项内嵌普通项：紧凑 + 归属正确', () => {
    const { out } = roundtrip('- [x] a\n  - b\n')
    expect(trimEnd(out)).toBe('- [x] a\n  - b')
    expect(hasBlankBetweenItems(out)).toBe(false)
  })

  it('D1-5 引用块内混排不得插入 > 空行', () => {
    const { out } = roundtrip('> - [x] a\n> - b\n')
    expect(out, '引用块内出现空行分隔').not.toMatch(/>\s*\n>\s*\n>/)
    expect(trimEnd(out)).toBe('> - [x] a\n> - b')
  })

  it('D1-6 结构反例：段落分隔的两个列表必须仍是两个列表', () => {
    const raw = '- [x] a\n\n中间文字\n\n- b\n'
    const { out } = roundtrip(raw)
    expect(out).toContain('中间文字')
    expect(topLevelListCount(out), '两个列表被粘连').toBe(2)
  })

  it('D1-7 结构反例：仅空行分隔仍是同一个（松散）列表，不得拆成两个', () => {
    const raw = '- a\n\n- b\n'
    const { out, out2 } = roundtrip(raw)
    expect(topLevelListCount(out), '同一列表被拆成两个').toBe(1)
    expect(out2).toBe(out)
  })

  it('D1-8 多段列表项：项内空行必须保留（不得为紧凑压平）', () => {
    const out = roundtrip('- [x] a\n\n  second para\n- b\n').out
    expect(out).toContain('second para')
    expect(out, '项内段落空行被压平').toMatch(/a\r?\n\r?\n\s*second para/)
  })

  it('D1-9 松散纯列表现状：单列表 + 幂等（记录既有「松散→紧凑」，防修坏）', () => {
    const { out, out2 } = roundtrip('- a\n\n- b\n')
    expect(topLevelListCount(out)).toBe(1)
    expect(out2).toBe(out)
    console.log('D1-9-LOOSE-DEVIATION out=' + JSON.stringify(out))
  })

  it('D1-10 大写 [X] 状态不得变成未勾选', () => {
    const out = roundtrip('- [X] 任务\n- [ ] 另一个\n').out
    expect(out).toMatch(/- \[[xX]\] 任务/)
    expect(out).toContain('- [ ] 另一个')
  })

  it('D1-11 CRLF 混排：紧凑 + traits 保留 + 幂等', () => {
    const raw = '- [x] a\r\n- b\r\n'
    const traits = captureDocTraits(raw)
    const { out, out2 } = roundtrip(raw)
    expect(hasBlankBetweenItems(out)).toBe(false)
    expect(trimEnd(applyDocTraits(out, traits))).toBe(trimEnd(raw))
    expect(out2).toBe(out)
  })

  it('D1-12 幂等：混排二次往返稳定', () => {
    const { out, out2 } = roundtrip('- [x] a\n- b\n- [ ] c\n')
    expect(out2).toBe(out)
    expect(hasBlankBetweenItems(out2)).toBe(false)
  })

  it('D1-13 三层混排：层级与状态均不丢', () => {
    const raw = '- [x] 一\n  - 二\n    1. [ ] 三\n'
    const { out } = roundtrip(raw)
    expect(out).toContain('[x] 一')
    expect(out).toContain('1. [ ] 三')
    expect(hasBlankBetweenItems(out)).toBe(false)
  })

  it('D1-14 列表后紧跟表格/标题不得粘连', () => {
    const raw = '- [x] a\n- b\n\n# 标题\n\n| c1 | c2 |\n| --- | --- |\n| 1 | 2 |\n'
    const { out } = roundtrip(raw)
    expect(out).toContain('# 标题')
    expect(out).toContain('| --- | --- |')
    expect(hasBlankBetweenItems(out)).toBe(false)
  })
})

describe('D-2 嵌套未知标签', () => {
  it('D2-1 <em><span>x</span></em>：未知标签保留 + 标准标签转换（契约口径）', () => {
    const out = roundtrip('<em><span>x</span></em>\n').out
    // 契约（§2.6）：未知标签原样保留、标准标签仍走 Markdown 转换、文本不丢
    expect(out).toContain('<span>')
    expect(out).toContain('</span>')
    expect(out).toContain('x')
    expect(out).not.toContain('<em>')
    expect(out).toContain('*')
    // 当前形态记录：未知标签被置于外层（严格读法期望 *<span>x</span>*）→ 报告 §4 已列为偏差待裁决
    console.log('D2-1-FORM ' + JSON.stringify(trimEnd(out)))
  })

  it('D2-2 <strong><mark>x</mark></strong>：未知标签保留 + 标准转换（契约口径）', () => {
    const out = roundtrip('<strong><mark>x</mark></strong>\n').out
    expect(out).toContain('<mark>')
    expect(out).toContain('x')
    expect(out).not.toContain('<strong>')
    expect(out).toContain('**')
    console.log('D2-2-FORM ' + JSON.stringify(trimEnd(out)))
  })

  it('D2-3 <a href><kbd>k</kbd></a>：kbd 与链接均保留（契约口径）', () => {
    const out = roundtrip('<a href="http://u"><kbd>k</kbd></a>\n').out
    expect(out).toContain('<kbd>')
    expect(out).toContain('k')
    expect(out).toContain('http://u')
    console.log('D2-3-FORM ' + JSON.stringify(trimEnd(out)))
  })

  it('D2-4 三层：<em><strong><span>x</span></strong></em>（契约口径）', () => {
    const out = roundtrip('<em><strong><span>x</span></strong></em>\n').out
    expect(out).toContain('<span>')
    expect(out).toContain('x')
    expect(out).not.toContain('<em>')
    expect(out).not.toContain('<strong>')
    expect(out).toContain('***')
    console.log('D2-4-FORM ' + JSON.stringify(trimEnd(out)))
  })

  it('D2-5 未知外→标准内（既有正确形态，防回归）', () => {
    const out = roundtrip('<span><em>x</em></span>\n').out
    expect(trimEnd(out)).toBe('<span>*x*</span>')
  })

  it('D2-6 属性含 > 的未知标签必须原样保留（契约口径）', () => {
    const out = roundtrip('<em><span title="a>b">x</span></em>\n').out
    expect(out).toContain('<span title="a>b">')
    expect(out).toContain('x')
    console.log('D2-6-FORM ' + JSON.stringify(trimEnd(out)))
  })

  it('D2-7 内层自闭合未知标签保留', () => {
    const out = roundtrip('<em><img src="a.png" /></em>\n').out
    expect(out).toContain('<img src="a.png" />')
  })

  it('D2-8 大写嵌套保留原大小写（契约口径）', () => {
    const out = roundtrip('<EM><SPAN>x</SPAN></EM>\n').out
    expect(out).toContain('<SPAN>')
    expect(out).toContain('</SPAN>')
    expect(out).toContain('x')
    console.log('D2-8-FORM ' + JSON.stringify(trimEnd(out)))
  })

  it('D2-9 纯标准标签仍转 Markdown（不得回归）', () => {
    expect(trimEnd(roundtrip('<em>x</em>\n').out)).toBe('*x*')
    expect(trimEnd(roundtrip('<strong>x</strong>\n').out)).toBe('**x**')
    expect(trimEnd(roundtrip('<del>x</del>\n').out)).toBe('~~x~~')
  })

  it('D2-10 代码/围栏内必须字面', () => {
    expect(trimEnd(roundtrip('`<em><span>x</span></em>`\n').out)).toBe('`<em><span>x</span></em>`')
    expect(trimEnd(roundtrip('```\n<em><span>x</span></em>\n```\n').out)).toBe('```\n<em><span>x</span></em>\n```')
  })

  it('D2-11 标准标签 + 未知兄弟混排', () => {
    const out = roundtrip('a <em>b</em> <span>c</span>\n').out
    expect(out).toContain('<span>c</span>')
    expect(out).toContain('*b*')
  })

  it('D2-12 文本不得丢', () => {
    for (const raw of ['<em><span>x</span></em>\n', '<strong><mark>x</mark></strong>\n', '<a href="http://u"><kbd>x</kbd></a>\n']) {
      expect(roundtrip(raw).out, `文本丢失：${raw.trim()}`).toContain('x')
    }
  })

  it('D2-14 集合保全口径对照：标签/文本/mark 均不丢（与 D2-1..D2-8 的严格口径并列）', () => {
    const cases: Array<[string, string[]]> = [
      ['<em><span>x</span></em>', ['<span>', 'x', '*']],
      ['<strong><mark>x</mark></strong>', ['<mark>', 'x', '**']],
      ['<a href="http://u"><kbd>k</kbd></a>', ['<kbd>', 'k', '](http://u)']],
      ['<em><strong><span>x</span></strong></em>', ['<span>', 'x', '***']],
      ['<em><span title="a>b">x</span></em>', ['<span title="a>b">', 'x', '*']],
      ['<EM><SPAN>x</SPAN></EM>', ['<SPAN>', 'x', '*']],
    ]
    for (const [raw, needles] of cases) {
      const out = roundtrip(raw + '\n').out
      for (const n of needles) expect(out, `${raw} 缺 ${n}`).toContain(n)
      expect(out, `${raw} 小写标签被丢`).not.toContain('<em>')
    }
  })

  it('D2-13 幂等', () => {
    const { out, out2 } = roundtrip('<em><span>x</span></em>\n')
    expect(out2).toBe(out)
  })
})

describe('EDGE-1 空 frontmatter 与定界符边界', () => {
  const BOMX = '\ufeff'
  it('E1-1 空块识别：`---\\n---\\n\\n正文` → body=正文', () => {
    const raw = '---\n---\n\n正文\n'
    expect(trimEnd(stripFrontmatter(raw).content)).toBe('正文')
    expect(fmBlockOf(raw), 'frontmatterBlockOf 未识别空块').toBeTruthy()
  })

  it('E1-2 空块 + BOM：识别 + BOM 保留', () => {
    const raw = `${BOMX}---\n---\n\n正文\n`
    expect(trimEnd(stripFrontmatter(raw).content)).toBe('正文')
    expect(saveChain(raw).startsWith(BOMX)).toBe(true)
  })

  it('E1-3 空块 + CRLF：识别 + CRLF 保留', () => {
    const raw = '---\r\n---\r\n\r\n正文\r\n'
    expect(trimEnd(stripFrontmatter(raw).content)).toBe('正文')
    expect(saveChain(raw)).toContain('\r\n')
    expect(saveChain(raw).replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('E1-4 空块 + BOM + CRLF 组合', () => {
    const raw = `${BOMX}---\r\n---\r\n\r\n正文\r\n`
    expect(trimEnd(stripFrontmatter(raw).content)).toBe('正文')
    const saved = saveChain(raw)
    expect(saved.startsWith(BOMX)).toBe(true)
    expect(saved.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('E1-5 空块 + 后续分隔线：正文与「更多」都不得丢（发现1-a）', () => {
    const raw = '---\n---\n\n正文\n\n---\n\n更多\n'
    const content = stripFrontmatter(raw).content
    expect(content, '正文被当 frontmatter 吞掉').toContain('正文')
    expect(content).toContain('更多')
  })

  it('E1-6 行首 HR 非 frontmatter：`---\\n\\n正文\\n\\n---` 不得丢正文（发现1-b）', () => {
    const raw = '---\n\n正文\n\n---\n'
    expect(stripFrontmatter(raw).content, '整篇被当 frontmatter').toContain('正文')
  })

  it('E1-7 只有空块：不崩、无双区块', () => {
    const raw = '---\n---\n'
    const saved = saveChain(raw)
    const dashLines = saved.split(/\r?\n/).filter((l) => l.trim() === '---').length
    expect(dashLines, '出现第二个 frontmatter 区块').toBe(2)
  })

  it('E1-8 三条定界符：不丢正文', () => {
    expect(stripFrontmatter('---\n---\n---\n\n正文\n').content).toContain('正文')
  })

  it('E1-9 三函数一致性：block 剥离后 == stripFrontmatter.content', () => {
    for (const raw of ['---\nke_version: 1\ntitle: T\n---\n\n正文\n', '---\n---\n\n正文\n']) {
      const blk = fmBlockOf(raw)
      if (!blk) continue
      const rest = raw.replace(blk, '')
      expect(trimEnd(rest), `不一致：${JSON.stringify(raw)}`).toBe(trimEnd(stripFrontmatter(raw).content))
    }
  })

  it('E1-10 空块源保存：ke_version 恰一次 + 单区块', () => {
    const saved = saveChain('---\n---\n\n正文\n')
    expect((saved.match(/ke_version/g) ?? []).length).toBe(1)
    expect(saved.split(/\r?\n/).filter((l) => l.trim() === '---').length).toBe(2)
  })

  it('E1-11 幂等：空块源二次往返稳定', () => {
    const { out, out2 } = roundtrip('---\n---\n\n正文\n')
    expect(out2).toBe(out)
    expect(saveChain(saveChain('---\n---\n\n正文\n'))).toBe(saveChain('---\n---\n\n正文\n'))
  })

  it('E1-13 合法 frontmatter 不得被一刀切拒掉：首行空行型（FAIL-1 回归）', () => {
    const raw = '---\n\nke_version: 1\n---\n\n正文\n'
    expect(fmBlockOf(raw), '开块后的前导空行导致整块被拒').toBeTruthy()
    expect(trimEnd(stripFrontmatter(raw).content)).toBe('正文')
    const saved = saveChain(raw)
    expect((saved.match(/ke_version/g) ?? []).length, '出现双 frontmatter 区块').toBe(1)
  })

  it('E1-14 合法 frontmatter：顶层序列型必须识别（FAIL-2 同族）', () => {
    const raw = '---\n- a\n- b\n---\n\n正文\n'
    expect(fmBlockOf(raw), '序列型 frontmatter 被拒').toBeTruthy()
    expect(trimEnd(stripFrontmatter(raw).content)).toBe('正文')
  })

  it('E1-15 合法 frontmatter 变体矩阵：注释/多行数组/嵌套映射/块标量/含冒号值/行尾空格', () => {
    const variants: Array<[string, string]> = [
      ['首行注释', '---\n# 注释\nke_version: 1\n---\n\n正文\n'],
      ['多行数组', '---\ntags:\n  - a\n  - b\nke_version: 1\n---\n\n正文\n'],
      ['嵌套映射', '---\nnested:\n  a: 1\nke_version: 1\n---\n\n正文\n'],
      ['块标量', '---\ndesc: |\n  第一行\n  第二行\nke_version: 1\n---\n\n正文\n'],
      ['键值含冒号', '---\nweird-key_2: "val:with:colon"\nke_version: 1\n---\n\n正文\n'],
      ['开闭行尾空格', '---   \nke_version: 1\n---   \n\n正文\n'],
      ['值含 ---', '---\ntitle: ---\nke_version: 1\n---\n\n正文\n'],
      ['闭合后无空行', '---\nke_version: 1\n---\n正文\n'],
    ]
    for (const [name, raw] of variants) {
      expect(fmBlockOf(raw), `${name}：frontmatter 被拒`).toBeTruthy()
      expect(trimEnd(stripFrontmatter(raw).content), `${name}：正文不正确`).toBe('正文')
    }
  })

  it('E1-16 无闭合的 `---` 开块仍须视为正文（不得误判为 frontmatter）', () => {
    const raw = '---\ntitle: x\n\n正文\n'
    expect(fmBlockOf(raw)).toBeNull()
    expect(stripFrontmatter(raw).content).toContain('正文')
  })

  it('E1-12 非空 frontmatter 回归', () => {
    const raw = '---\nke_version: 1\ntitle: T\n---\n\n正文\n'
    expect(trimEnd(stripFrontmatter(raw).content)).toBe('正文')
    const saved = saveChain(raw)
    // 注：saveChain 只覆盖前端链；title 等键的回填由后端 merge_frontmatter 负责，不在此断言
    expect((saved.match(/ke_version/g) ?? []).length).toBe(1)
    expect(saved).toContain('正文')
  })
})

describe('交叉验证', () => {
  it('X0 防漂移：生产 index.ts 的块级栈与我的镜像一致（KeDocument/KeBlockquote + 关闭内置）', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/editor/index.ts'), 'utf8')
    expect(src, '未关闭 StarterKit 内置 document').toMatch(/document:\s*false/)
    expect(src, '未关闭 StarterKit 内置 blockquote').toMatch(/blockquote:\s*false/)
    expect(src).toMatch(/\bKeDocument\b/)
    expect(src).toMatch(/\bKeBlockquote\b/)
    // 按导入对象身份断言（Node.create 的 .name 是 'doc'/'blockquote'，不是变量名）
    expect(PROD_EXTENSIONS.includes(KeDocument), '镜像缺 KeDocument').toBe(true)
    expect(PROD_EXTENSIONS.includes(KeBlockquote), '镜像缺 KeBlockquote').toBe(true)
    expect(PROD_EXTENSIONS.some((e) => e.name === 'taskList'), '镜像缺 taskList').toBe(true)
  })

  it('X1 ke-* 六类快照不变', () => {
    const snap = [
      '<!-- ke-note: {"kind":"note","id":"n1","title":"注","color":"blue"} -->',
      '信息内容',
      '<!-- /ke-note -->',
      '',
      '<!-- ke-module: {"kind":"module","id":"m1","name":"模块"} -->',
      '',
      '<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"x.pdf","title":"文档"} -->',
      '',
      '<!-- ke-video: {"kind":"video","id":"v1","src":"v.mp4","title":"视频"} -->',
      '',
      '正文<!-- ke-footnote: {"kind":"footnote","id":"ke-aaaaaaaaaaaa","n":1} -->。',
      '',
      '<!-- ke-footnotes:start -->',
      '<!-- ke-footnote-item: {"id":"ke-aaaaaaaaaaaa","n":1,"text":"脚注"} -->',
      '<!-- ke-footnotes:end -->',
      '',
    ].join('\n')
    const out = roundtrip(snap).out
    expect(out).toContain('<!-- ke-note: {"kind":"note","id":"n1","title":"注","color":"blue"} -->')
    expect(out).toContain('<!-- ke-module: {"kind":"module","id":"m1","name":"模块"} -->')
    expect(out).toContain('<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"x.pdf","title":"文档"} -->')
    expect(out).toContain('<!-- ke-video: {"kind":"video","id":"v1","src":"v.mp4","title":"视频","controls":true,"autoplay":false,"loop":false} -->')
    expect(out).toContain('<!-- ke-footnote-item: {"id":"ke-aaaaaaaaaaaa","n":1,"text":"脚注"} -->')
  })

  it('X2 D-3 保持现状（不得被本次修复改动）', () => {
    expect(roundtrip('AT&T 与 a & b\n').out).toContain('&amp;')
    expect(roundtrip('- [X] 完成\n').out).toMatch(/- \[[xX]\] 完成/)
    expect(roundtrip('甲<br>乙\n').out).toContain('甲')
    expect(roundtrip('前 <a href="http://x">链接</a> 后\n').out).toMatch(/\[链接\]\(http:\/\/x\)/)
  })
})
