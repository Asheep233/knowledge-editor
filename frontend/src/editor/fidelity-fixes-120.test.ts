/**
 * v1.2.0-pre.1 · 保真修复回归（task-39）
 *
 * 覆盖：D-1 混排列表紧凑 / D-2 嵌套未知标签 / EDGE-1 空 frontmatter /
 *       ADD-1 frontmatter 定界符吞正文 / ADD-2 有序列表任务项 / ADD-3 控制项 /
 *       withFrontmatter 光标锚点剥除开关（源码通道）。
 *
 * 口径与 `fidelity-constructs.test.ts` 一致：
 *   正文 = stripFrontmatter(raw).content → setKeContent(editor, body) → editor.getMarkdown()
 * 每组用例在注释里给出**修前实测值**（verifier 基线 / 本人探针），断言**修后**值。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { describe, expect, it } from 'vitest'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
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
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'
import { KeListItem, OrderedListParenExtension } from './extensions/ListExtension'
import {
  captureDocTraits,
  frontmatterBlockOf,
  KE_VERSION,
  stripFrontmatter,
  withFrontmatter,
  applyDocTraits,
} from './ke'
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
]

const BOM = '\ufeff'

function makeEditor(): Editor {
  return new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
}

/** 正文口径往返（加载 → PM → 序列化），首尾空白归一 */
function roundTrip(body: string): string {
  const ed = makeEditor()
  setKeContent(ed, body)
  const out = ed.getMarkdown()
  ed.destroy()
  return out.replace(/^\s+|\s+$/g, '')
}

/** 文档口径往返（保存链路的 frontmatter + 文件特征还原） */
function roundTripDoc(raw: string): string {
  const ed = makeEditor()
  setKeContent(ed, stripFrontmatter(raw).content)
  const out = applyDocTraits(withFrontmatter(ed.getMarkdown(), KE_VERSION), captureDocTraits(raw))
  ed.destroy()
  return out
}

const jsonOf = (body: string): unknown => {
  const ed = makeEditor()
  setKeContent(ed, body)
  const out = ed.getJSON()
  ed.destroy()
  return out
}

// ─────────────────────────────────────────────────────────── D-1 混排列表紧凑

describe('D-1 混合任务/普通列表：紧凑结构 + 状态正确', () => {
  it('D1-1 混排紧凑（修前：`- [x] a\\n\\n- b\\n\\n- [ ] c` 每项插空行）', () => {
    expect(roundTrip('- [x] a\n- b\n- [ ] c')).toBe('- [x] a\n- b\n- [ ] c')
  })

  it('D1-2 复选框状态与文本不丢（模型层 checked=true/false）', () => {
    const out = roundTrip('- [x] a\n- b\n- [ ] c')
    expect(out).toContain('- [x] a')
    expect(out).toContain('- [ ] c')
    expect(out).toContain('- b')
    // 反替代：状态不得被翻转
    expect(out).not.toContain('- [ ] a')
    expect(out).not.toContain('- [x] c')
    expect(JSON.stringify(jsonOf('- [x] a\n- b\n- [ ] c'))).toContain('"checked":true')
    expect(JSON.stringify(jsonOf('- [x] a\n- b\n- [ ] c'))).toContain('"checked":false')
  })

  it('D1-3 幂等：二次往返逐字节稳定', () => {
    const once = roundTrip('- [x] a\n- b\n- [ ] c')
    expect(roundTrip(once)).toBe(once)
  })

  it('D1-4 反向（普通项在首）：`- b` + `- [x] a` 仍紧凑', () => {
    expect(roundTrip('- b\n- [x] a')).toBe('- b\n- [x] a')
  })

  it('D1-5 纯任务列表不回归（本来紧凑）', () => {
    expect(roundTrip('- [x] a\n- [ ] c')).toBe('- [x] a\n- [ ] c')
  })

  it('D1-6 纯普通列表不回归', () => {
    expect(roundTrip('- b\n- c')).toBe('- b\n- c')
  })

  it('D1-7 嵌套列表不回归（子项缩进保持）', () => {
    expect(roundTrip('- [x] a\n  - b')).toBe('- [x] a\n  - b')
  })

  it('D1-8 结构反例①：段落分隔的两个列表必须仍是两个列表', () => {
    expect(roundTrip('- [x] a\n\n段落\n\n- b')).toBe('- [x] a\n\n段落\n\n- b')
  })

  it('D1-9 结构反例②：仅空行分隔的松散纯普通列表保持既有行为（ADD-3 控制项）', () => {
    // 修前 = 修后：解析期就是一个 bulletList（松散被规范化为紧凑），本次不得改动
    expect(roundTrip('- a\n\n- b')).toBe('- a\n- b')
  })

  it('D1-10 任务↔有序 混排亦紧凑（修前：空行分隔）', () => {
    expect(roundTrip('- [x] a\n1. b')).toBe('- [x] a\n1. b')
  })

  it('D1-11 引用块内混排同样紧凑（修前：`> - [x] a\\n>\\n> - b`）', () => {
    expect(roundTrip('> - [x] a\n> - b')).toBe('> - [x] a\n> - b')
  })

  it('D1-12 引用块内混排幂等', () => {
    const once = roundTrip('> - [x] a\n> - b')
    expect(roundTrip(once)).toBe(once)
  })
})

// ─────────────────────────────────────────────────────────── D-2 嵌套未知标签

describe('D-2 标准标签内嵌未知标签：内层原样保留 + 外层标准转换', () => {
  it('D2-1 `<em><span>x</span></em>`（修前：`*x*`，内层丢失）', () => {
    expect(roundTrip('前 <em><span>x</span></em> 后')).toBe('前 <span>*x*</span> 后')
  })

  it('D2-2 `<strong><mark>y</mark></strong>`（修前：`**y**`）', () => {
    expect(roundTrip('前 <strong><mark>y</mark></strong> 后')).toBe('前 <mark>**y**</mark> 后')
  })

  it('D2-3 `<a href><kbd>z</kbd></a>`（修前：`[z](url)`）', () => {
    expect(roundTrip('前 <a href="http://e.com"><kbd>z</kbd></a> 后')).toBe(
      '前 <kbd>[z](http://e.com)</kbd> 后',
    )
  })

  it('D2-4 三层嵌套：内层未知标签全部保留', () => {
    expect(roundTrip('前 <em><span><mark>x</mark></span></em> 后')).toBe(
      '前 <span><mark>*x*</mark></span> 后',
    )
  })

  it('D2-5 属性含 `>` 不被截断', () => {
    expect(roundTrip('前 <em><span title="a>b">x</span></em> 后')).toBe(
      '前 <span title="a>b">*x*</span> 后',
    )
  })

  it('D2-6 自闭合内层（纯原子、无可承载 mark 的文本）→ 整体按 raw 保真', () => {
    expect(roundTrip('前 <em><img src="a.png"></em> 后')).toBe('前 <em><img src="a.png"></em> 后')
  })

  it('D2-7 大小写：内层标签原文（含大小写）保留', () => {
    expect(roundTrip('前 <EM><SPAN>x</SPAN></EM> 后')).toBe('前 <SPAN>*x*</SPAN> 后')
  })

  it('D2-8 参照形态不回归：`<span><em>x</em></span>` → `<span>*x*</span>`', () => {
    expect(roundTrip('前 <span><em>x</em></span> 后')).toBe('前 <span>*x*</span> 后')
  })

  it('D2-9 纯标准标签仍走标准转换（P1-2 契约不回归）', () => {
    expect(roundTrip('前 <em>x</em> 后')).toBe('前 *x* 后')
    expect(roundTrip('前 <strong>y</strong> 后')).toBe('前 **y** 后')
    expect(roundTrip('前 <del>z</del> 后')).toBe('前 ~~z~~ 后')
  })

  it('D2-10 独立未知标签不回归（tokenizer 路径）', () => {
    expect(roundTrip('前 <span>x</span> 后')).toBe('前 <span>x</span> 后')
    expect(roundTrip('前 <mark>y</mark> 后')).toBe('前 <mark>y</mark> 后')
  })

  it('D2-11 代码内保持字面（行内 + 围栏）', () => {
    expect(roundTrip('前 `<em><span>x</span></em>` 后')).toBe('前 `<em><span>x</span></em>` 后')
    expect(roundTrip('```\n<em><span>x</span></em>\n```')).toContain('<em><span>x</span></em>')
  })

  it('D2-12 幂等：二次往返稳定', () => {
    const once = roundTrip('前 <em><span>x</span></em> 后')
    expect(roundTrip(once)).toBe(once)
  })
})

// ─────────────────────────────────────────── EDGE-1 / ADD-1 frontmatter

describe('EDGE-1 / ADD-1 frontmatter 区块识别与写回', () => {
  it('E1-1 空块被识别：正文不含 `---`，version=0（修前：整块当正文）', () => {
    const raw = '---\n---\n\n正文'
    expect(stripFrontmatter(raw)).toEqual({ version: 0, content: '正文' })
    expect(frontmatterBlockOf(raw)).toBe('---\n---\n\n')
  })

  it('E1-2 空块写回 `ke_version`（恰一次，无双区块）', () => {
    const out = withFrontmatter(stripFrontmatter('---\n---\n\n正文').content, KE_VERSION)
    expect(out).toBe('---\nke_version: 1\n---\n\n正文')
    expect(out.match(/ke_version/g)).toHaveLength(1)
    expect(out.match(/^---$/gm)).toHaveLength(2)
  })

  it('E1-3 空块 + 后续 `---` 分隔线：中间正文不得被吞（修前 content=`"更多\\n"`）', () => {
    const raw = '---\n---\n\n正文\n\n---\n\n更多'
    expect(stripFrontmatter(raw).content).toBe('正文\n\n---\n\n更多')
    expect(frontmatterBlockOf(raw)).toBe('---\n---\n\n')
  })

  it('E1-4 行首 HR + 行尾 HR：content 不得为空（修前 content=""，整篇丢失）', () => {
    const raw = '---\n\n正文\n\n---\n'
    expect(stripFrontmatter(raw).content).toBe(raw)
    expect(frontmatterBlockOf(raw)).toBeNull()
    // 保存路径不得再套一层 frontmatter 后丢掉正文
    const saved = withFrontmatter(stripFrontmatter(raw).content, KE_VERSION)
    expect(saved).toContain('正文')
    expect(saved.match(/ke_version/g)).toHaveLength(1)
  })

  it('E1-5 空块（BOM / CRLF / BOM+CRLF）三变体一致', () => {
    for (const raw of [
      `${BOM}---\n---\n\n正文\n`,
      `---\r\n---\r\n\r\n正文\r\n`,
      `${BOM}---\r\n---\r\n\r\n正文\r\n`,
    ]) {
      const s = stripFrontmatter(raw)
      expect(s.content).toContain('正文')
      expect(s.content).not.toContain('---')
      expect(frontmatterBlockOf(raw)).toBeTruthy()
    }
  })

  it('E1-6 三个函数行为一致：有块 / 无块判定相同', () => {
    const withFm = '---\ntitle: x\n---\n\n正文\n'
    const withoutFm = '---\n\n正文\n\n---\n'
    // 有块：block + strip.content = 原文
    const block = frontmatterBlockOf(withFm)!
    expect(block + stripFrontmatter(withFm).content).toBe(withFm)
    // 无块：block=null 且 strip 原样返回
    expect(frontmatterBlockOf(withoutFm)).toBeNull()
    expect(stripFrontmatter(withoutFm).content).toBe(withoutFm)
  })

  it('E1-7 非空 frontmatter 逐字节保留（未知键/注释/嵌套映射/多行数组，K2 口径）', () => {
    const raw = '---\n# 注释\ntitle: 我的文档\ntags:\n  - a\n  - b\ncustom:\n  nested: 1\nke_version: 1\n---\n\n正文'
    const s = stripFrontmatter(raw)
    expect(s.version).toBe(1)
    expect(s.content).toBe('正文')
    expect(frontmatterBlockOf(raw)).toBe('---\n# 注释\ntitle: 我的文档\ntags:\n  - a\n  - b\ncustom:\n  nested: 1\nke_version: 1\n---\n\n')
    const out = withFrontmatter(raw, KE_VERSION) // 文档口径：输入即原文（含 frontmatter）
    // 其余键逐字节保留，仅 ke_version 更新（此处值未变 → 期望整体不变）
    for (const line of ['# 注释', 'title: 我的文档', 'tags:', '  - a', '  - b', 'custom:', '  nested: 1']) {
      expect(out).toContain(line)
    }
    expect(out.match(/ke_version/g)).toHaveLength(1)
    expect(out).toBe(raw)
  })

  it('E1-8 保存/导出幂等：文档口径二次往返不变', () => {
    for (const raw of [
      '---\n---\n\n正文\n',
      '---\n---\n\n正文\n\n---\n\n更多\n',
      '---\n\n正文\n\n---\n',
      '---\ntitle: x\nke_version: 1\n---\n\n正文\n',
      `${BOM}---\r\n---\r\n\r\n正文\r\n`,
    ]) {
      const once = roundTripDoc(raw)
      expect(roundTripDoc(once)).toBe(once)
    }
  })

  it('E1-9 正文疑似 HR 但首行不是 YAML：整篇视为正文（不剥离）', () => {
    const raw = '---\nnot yaml here\n---\n\n正文'
    expect(stripFrontmatter(raw).content).toBe(raw)
    expect(frontmatterBlockOf(raw)).toBeNull()
  })
})

// ─────────────────────────────────────────── ADD-2 有序列表任务项

describe('ADD-2 有序列表任务项 `1. [x] a` 保留', () => {
  it('A2-1 `1. [x] a` 不被转义（修前：`1. \\[x\\] a`）', () => {
    expect(roundTrip('1. [x] a\n2. b')).toBe('1. [x] a\n2. b')
  })

  it('A2-2 `[ ]` / `[X]` 同样保留 + 幂等', () => {
    expect(roundTrip('1. [ ] a\n2. [X] b')).toBe('1. [ ] a\n2. [X] b')
    const once = roundTrip('1. [x] a\n2. b')
    expect(roundTrip(once)).toBe(once)
  })

  it('A2-3 项中间的 `[x]` 文本不受影响（只还原列表标记之后）', () => {
    expect(roundTrip('1. see [x] here\n2. b')).toBe('1. see \\[x\\] here\n2. b')
  })
})

// ─────────────────────────────────────────── withFrontmatter 光标锚点开关

describe('withFrontmatter 光标锚点（U+200B）剥除开关', () => {
  const ZWSP = '\u200b'

  it('Z1 默认剥除（正文通道行为零变化）', () => {
    expect(withFrontmatter(`前${ZWSP}后`)).not.toContain(ZWSP)
  })

  it('Z2 `stripCaretArtifacts: false` 保留用户真写的 U+200B（源码通道）', () => {
    const out = withFrontmatter(`前${ZWSP}后`, KE_VERSION, { stripCaretArtifacts: false })
    expect(out).toContain(`前${ZWSP}后`)
  })

  it('Z3 显式 false 时既有 frontmatter 仍正确合并（ke_version 一次）', () => {
    const out = withFrontmatter(`---\nke_version: 1\n---\n\n前${ZWSP}后`, KE_VERSION, {
      stripCaretArtifacts: false,
    })
    expect(out).toContain(`前${ZWSP}后`)
    expect(out.match(/ke_version/g)).toHaveLength(1)
  })

  it('Z4 默认剥除在带 frontmatter 时同样生效', () => {
    const out = withFrontmatter(`---\nke_version: 1\n---\n\n前${ZWSP}后`)
    expect(out).not.toContain(ZWSP)
  })
})

// ─────────────────────────────────────────── 接线守卫（防只改测试不改生产）

describe('生产接线守卫', () => {
  const indexSrc = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const tokenizerSrc = readFileSync(join(__dirname, 'tokenizers.ts'), 'utf8')
  const keSrc = readFileSync(join(__dirname, 'ke.ts'), 'utf8')

  it('S1 生产扩展表接管 Document / Blockquote（D-1/ADD-3 生效的必要条件）', () => {
    expect(indexSrc).toMatch(/document:\s*false/)
    expect(indexSrc).toMatch(/blockquote:\s*false/)
    expect(indexSrc).toMatch(/\bKeDocument\b/)
    expect(indexSrc).toMatch(/\bKeBlockquote\b/)
  })

  it('S2 D-2 接管逻辑在生产 tokenizer 中（非仅测试夹具）', () => {
    expect(tokenizerSrc).toMatch(/function claimStandardWrapper/)
    expect(tokenizerSrc).toMatch(/STANDARD_WRAPPER_TOKEN/)
  })

  it('S3 光标锚点开关在生产 ke.ts 中且默认 true', () => {
    expect(keSrc).toMatch(/stripCaretArtifacts\?:\s*boolean/)
    expect(keSrc).toMatch(/stripCaretArtifacts\s*=\s*true/)
  })

  it('S4 ADD-2 渲染还原在生产列表扩展中', () => {
    const listSrc = readFileSync(join(__dirname, 'extensions', 'ListExtension.ts'), 'utf8')
    expect(listSrc).toMatch(/ORDERED_TASK_MARKER_RE/)
    expect(listSrc).toMatch(/getExtensionField/)
  })
})
