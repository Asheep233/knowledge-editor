/**
 * 独立对抗验证套件（task-5 / verifier-s2）——GFM 脚注 S-2（方案 A：解析侧支持）
 *
 * ⚠️ 本文件由**验证员**编写，与开发者的 gfm-footnote.test.ts **相互独立**：
 *    - 只做对抗：规范符合性、消歧误判、tokenizer/规范化抢占、幂等与 id 确定性、plain-export 闭环、退化输入；
 *    - 断言以**外部权威依据**为准绳（cmark-gfm 参考实现 + 官方测试套件 test/extensions.txt + GitHub Docs），
 *      不照抄方案书（docs/design-s2-gfm-footnote.md）的工程判断。
 *    - 本套件 FAIL ＝ 与规范/保真要求不符，不代表测试抖动；结论见 docs/verification-s2.md。
 *
 * 权威依据（第一段独立核查，原文引文见 docs/verification-s2.md §1）：
 *    [SRC-1] cmark-gfm/src/scanners.re  _scan_footnote_definition
 *            `'[^' ([^\] \r\n\x00\t]+) ']:' [ \t]*`
 *    [SRC-2] cmark-gfm/src/blocks.c:1220 定义行分支要求 `!indented`（缩进 < 4）→ 最多 3 空格前导
 *    [SRC-3] cmark-gfm/src/blocks.c:929  parse_footnote_definition_block_prefix
 *            `if (parser->indent >= 4) { advance 4; return true; } else if (blank) true; else false;`
 *            → **续行缩进 4 空格 = 脚注内容**（不是代码块）；8 空格才是脚注内代码块
 *    [SRC-4] cmark-gfm/test/extensions.txt「Footnotes」：未定义引用→字面文本；未被引用定义→渲染层不输出；
 *            编号按**引用首次出现顺序**；同名标签多引用共享编号
 *    [SRC-5] cmark-gfm/src/map.c normalize_map_label：标签匹配大小写折叠 + 空白归一化；
 *            引用标签 > MAX_LINK_LABEL_LENGTH(999 字节) 永不解析
 *    [SRC-6] cmark-gfm/src/map.c refcmp/sort_map：同标签取 age 最小 → **首个定义优先**
 *    [SRC-7] GitHub Docs「Footnotes」：多行脚注允许 **0 缩进懒续行**（官方示例 [^2]）
 *    [SRC-8] GFM Spec v0.29 无 footnotes 章节（实测 508310 字节全文仅 3 处 CSS + 1 处引言命中）
 *
 * 生产等价路径：`useKeEditor({content:''})` + `setKeContent(editor, md)`
 *   （已核实：全仓 `contentType:'markdown'` 的 setContent 仅 index.ts:331 一处，
 *    初始 content 恒为空串 → setKeContent 是唯一 Markdown 解析入口）。
 *
 * 运行：
 *   cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
 *   npx vitest run src/editor/gfm-footnote-verify.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { OrderedListParenExtension, KeListItem } from './extensions/ListExtension'
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
import { clearMdDocCache, setKeContent } from './index'
import { plainExportPayload } from './export-actions'
import { stripFrontmatter } from './ke'
import type { ArticleMeta } from '../types'

/**
 * 与 `index.ts#useKeEditor` **同序**（仅省略无 tokenizer 的 MathShortcuts / Placeholder；
 * OrderedListParen/KeListItem 必须保留——index.ts 关闭了 StarterKit 的 orderedList/listItem，
 * 缺它们会 schema 解析失败）。
 * tokenizer 承载扩展的相对顺序必须与生产一致，否则抢占结论不可信（C17 有防漂移断言）。
 */
export const VERIFY_EXTENSIONS = [
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    link: { openOnClick: false, autolink: true },
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
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
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

/** 生产等价打开：空 content 建实例 → setKeContent（内部含 GFM 规范化 + 解析缓存）。 */
export function openDoc(md: string): Editor {
  clearMdDocCache() // 保证「独立解析」语义（不被会话级 JSON 缓存掩盖）
  const ed = new Editor({ extensions: VERIFY_EXTENSIONS, content: '', contentType: 'markdown' })
  setKeContent(ed, md)
  return ed
}

/** 一次 open→save。 */
export function roundtrip(md: string): string {
  const ed = openDoc(md)
  const out = ed.getMarkdown()
  ed.destroy()
  return out
}

/** 连续两次 open→save（收敛性：first 与 second 必须逐字节相同）。 */
export function saveTwice(md: string): { first: string; second: string } {
  const first = roundtrip(md)
  const second = roundtrip(first)
  return { first, second }
}

/** 收集文档中指定类型节点（文档顺序）。 */
export function collectNodes(json: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (n: JSONContent): void => {
    if (n.type === type) out.push(n)
    for (const c of n.content ?? []) walk(c)
  }
  walk(json)
  return out
}

interface ItemShape {
  id: string
  n: number
  text: string
}

/** footnotes 节点的条目；不存在返回 []。 */
export function footnoteItems(ed: Editor): ItemShape[] {
  const nodes = collectNodes(ed.getJSON(), 'footnotes')
  const items: ItemShape[] = []
  for (const n of nodes) {
    const arr = (n.attrs?.items as ItemShape[] | undefined) ?? []
    items.push(...arr)
  }
  return items
}

/** footnote 行内引用（attrs: id/n）。 */
export function footnoteRefs(ed: Editor): Array<{ id: string; n: number }> {
  return collectNodes(ed.getJSON(), 'footnote').map((n) => ({
    id: String(n.attrs?.id ?? ''),
    n: Number(n.attrs?.n ?? 0),
  }))
}

/** 全文档纯文本（text 节点拼接），用于「不得丢字」断言。 */
export function plainText(json: JSONContent): string {
  const parts: string[] = []
  const walk = (n: JSONContent): void => {
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
    for (const c of n.content ?? []) walk(c)
  }
  walk(json)
  return parts.join('')
}

/** 文档中某个类型节点的首个实例。 */
export function firstNode(ed: Editor, type: string): JSONContent | undefined {
  return collectNodes(ed.getJSON(), type)[0]
}

const ARTICLE: ArticleMeta = {
  id: 'verify-a1',
  path: '/verify.md',
  title: '验证文档',
  content: '',
  tags: [],
  meta: {},
}

/** 「导出普通 Markdown」真实载荷（plainExportPayload → Blob.text()）。 */
export async function exportPlain(ed: Editor): Promise<string> {
  const target = plainExportPayload(ed, ARTICLE)
  return await target.blob.text()
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 规范符合性（以 cmark-gfm / GitHub Docs 为准绳）
// ─────────────────────────────────────────────────────────────────────────────
describe('A. 规范符合性', () => {
  it('A1 [SRC-2] 行首定义（0 缩进）识别为 footnotes 条目、引用为 footnote 节点', () => {
    const ed = openDoc('正文[^1]。\n\n[^1]: 第一脚注\n')
    expect(footnoteItems(ed)).toHaveLength(1)
    expect(footnoteItems(ed)[0]?.text).toBe('第一脚注')
    expect(footnoteRefs(ed)).toHaveLength(1)
    expect(footnoteRefs(ed)[0]?.n).toBe(1)
    expect(plainText(ed.getJSON())).not.toContain('第一脚注')
  })

  it('A2 [SRC-2] 1/2/3 空格前导的定义行均识别', () => {
    for (const pad of [' ', '  ', '   ']) {
      const ed = openDoc(`引用[^x]。\n\n${pad}[^x]: 内容\n`)
      expect(footnoteItems(ed), `pad=${pad.length}`).toHaveLength(1)
      expect(footnoteItems(ed)[0]?.text, `pad=${pad.length}`).toBe('内容')
    }
  })

  it('A3 [SRC-2] 4 空格缩进的定义行不识别（= 缩进代码块），且内容不得丢', () => {
    const ed = openDoc('正文\n\n    [^1]: 缩进代码\n\n引用[^1]。\n')
    expect(footnoteItems(ed)).toHaveLength(0)
    expect(plainText(ed.getJSON())).toContain('[^1]: 缩进代码')
    expect(roundtrip('正文\n\n    [^1]: 缩进代码\n\n引用[^1]。\n')).toContain('[^1]: 缩进代码')
  })

  it('A4 [SRC-3] 4 空格续行并入同一脚注（GFM 正确形态，方案书 case G 的根因）', () => {
    const ed = openDoc('正文[^1]。\n\n[^1]: 第一段\n    续行\n')
    expect(footnoteItems(ed)).toHaveLength(1)
    const text = footnoteItems(ed)[0]?.text ?? ''
    expect(text).toContain('第一段')
    expect(text).toContain('续行')
    // GFM 语义：续行是脚注段落的一部分，绝不能成为代码块
    expect(collectNodes(ed.getJSON(), 'codeBlock')).toHaveLength(0)
  })

  it('A5 [SRC-3] 空行 + 4 空格续行 = 脚注内第二段（换行保真）', () => {
    const ed = openDoc('正文[^1]。\n\n[^1]: 第一段\n\n    第二段\n')
    const text = footnoteItems(ed)[0]?.text ?? ''
    expect(text).toContain('第一段')
    expect(text).toContain('第二段')
    expect(collectNodes(ed.getJSON(), 'codeBlock')).toHaveLength(0)
  })

  it('A6 [SRC-3] 空行 + 8 空格续行 = 脚注内代码块（缩进内容保真，不得丢字）', () => {
    const ed = openDoc('正文[^1]。\n\n[^1]: 首段\n\n        代码块内容\n')
    const text = footnoteItems(ed)[0]?.text ?? ''
    expect(text).toContain('首段')
    expect(text).toContain('代码块内容')
    // 8 空格 = 4（脚注前缀）+ 4（代码块）→ 至少保留 4 空格缩进语义
    expect(text).toMatch(/^ {4}代码块内容/m)
  })

  it('A7 [SRC-7] 0 缩进懒续行并入脚注（GitHub Docs 官方多行示例）', () => {
    const ed = openDoc('正文[^2]。\n\n[^2]: To add line breaks, add 2 spaces.  \nThis is a second line.\n')
    const text = footnoteItems(ed)[0]?.text ?? ''
    expect(text).toContain('To add line breaks')
    expect(text).toContain('This is a second line.')
  })

  it('A8 [SRC-1] 标签字符集：命名/数字/-/_/. 标签均可识别', () => {
    for (const label of ['note', '1', 'a-b', 'a_b', 'a.b']) {
      const ed = openDoc(`引用[^${label}]。\n\n[^${label}]: 内容\n`)
      expect(footnoteItems(ed), `label=${label}`).toHaveLength(1)
      expect(footnoteRefs(ed), `label=${label}`).toHaveLength(1)
    }
  })

  it('A11 [SRC-1] `[^]`、`[^ ]`、`[^]:` 不识别为脚注且字面保真', () => {
    const md = '空 [^] 空格 [^ ] 与 [^]: x\n'
    const ed = openDoc(md)
    expect(footnoteItems(ed)).toHaveLength(0)
    expect(footnoteRefs(ed)).toHaveLength(0)
    expect(plainText(ed.getJSON())).toContain('[^]')
    expect(plainText(ed.getJSON())).toContain('[^ ]')
  })

  it('A12 [SRC-5] 标签匹配大小写不敏感（[^Note] 命中 [^note] 定义）', () => {
    const ed = openDoc('引用[^Note]。\n\n[^note]: 定义\n')
    expect(footnoteItems(ed)).toHaveLength(1)
    expect(footnoteRefs(ed)).toHaveLength(1)
    expect(footnoteRefs(ed)[0]?.n).toBe(footnoteItems(ed)[0]?.n)
  })

  it('A15 [SRC-4] 编号按引用首次出现顺序（定义顺序打乱）', () => {
    const ed = openDoc('[^b] 先出现，[^a] 后出现。\n\n[^a]: A 定义\n\n[^b]: B 定义\n')
    const items = footnoteItems(ed)
    expect(items).toHaveLength(2)
    const b = items.find((i) => i.text === 'B 定义')
    const a = items.find((i) => i.text === 'A 定义')
    expect(b?.n).toBe(1)
    expect(a?.n).toBe(2)
  })

  it('A16 [SRC-4] 同一标签多次引用共享同一编号', () => {
    const ed = openDoc('一[^x] 二[^x] 三[^x]。\n\n[^x]: 定义\n')
    expect(footnoteItems(ed)).toHaveLength(1)
    const refs = footnoteRefs(ed)
    expect(refs).toHaveLength(3)
    expect(new Set(refs.map((r) => r.n)).size).toBe(1)
    expect(new Set(refs.map((r) => r.id)).size).toBe(1)
  })

  it('A22 行内引用前恰有 1 个字符时仍须解析为 footnote 节点（不得变块级 fallback）', () => {
    const ed = openDoc('一[^1]。\n\n[^1]: 定义\n')
    expect(collectNodes(ed.getJSON(), 'keFallback'), '引用被当作块级 fallback').toHaveLength(0)
    expect(footnoteRefs(ed)).toHaveLength(1)
    expect(plainText(ed.getJSON())).toContain('一')
    expect(plainText(ed.getJSON())).toContain('。')
  })

  it('A17 [SRC-4] 未定义引用保持字面文本（GFM 语义；A1 无条件识别会违背）', () => {
    const ed = openDoc('数组 a[^nope] 无定义。\n')
    expect(footnoteRefs(ed)).toHaveLength(0)
    expect(plainText(ed.getJSON())).toContain('[^nope]')
  })

  it('A18 [SRC-4] 未被引用定义：项目红线=不丢行（规范渲染层本会丢弃）', () => {
    const ed = openDoc('正文无关。\n\n[^1]: 孤立定义\n')
    expect(footnoteItems(ed)).toHaveLength(1)
    expect(footnoteItems(ed)[0]?.text).toBe('孤立定义')
  })

  it('A19 [SRC-6] 重复标签定义：首个优先，其余不得静默消失', () => {
    const out = roundtrip('[^1]: 第一个\n\n[^1]: 第二个\n\n引用[^1]。\n')
    expect(out).toContain('第一个')
    expect(out).toContain('第二个')
    const ed = openDoc('[^1]: 第一个\n\n[^1]: 第二个\n\n引用[^1]。\n')
    expect(footnoteItems(ed)).toHaveLength(1)
    expect(footnoteItems(ed)[0]?.text).toBe('第一个')
  })

  it('A20 [SRC-4] 前向引用（引用在定义之前）生效', () => {
    const ed = openDoc('正文[^later]。\n\n[^later]: 后置定义\n')
    expect(footnoteRefs(ed)).toHaveLength(1)
    expect(footnoteItems(ed)[0]?.text).toBe('后置定义')
  })

  it('A21 [SRC-2] 容器内定义（cmark 允许相对缩进<4）：至少不得静默丢内容', () => {
    const out1 = roundtrip('> [^1]: 引用块里的定义\n\n引用[^1]。\n')
    expect(out1, 'blockquote 内定义内容丢失').toContain('引用块里的定义')
    const out2 = roundtrip('- [^1]: 列表项里的定义\n\n引用[^1]。\n')
    expect(out2, 'list 内定义内容丢失').toContain('列表项里的定义')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B. 消歧与代码上下文（不得误判 / 不得改写代码）
// ─────────────────────────────────────────────────────────────────────────────
describe('B. 消歧与代码上下文', () => {
  it('B1 字面量 a[^1] + 同名定义 → 采用 A2（定义感知）时判为脚注（记录为相对 GFM 的偏差）', () => {
    const ed = openDoc('数组 a[^1] 与 [1] 与 x[^2]。\n\n[^1]: 定义\n')
    // 有同名定义 → A2 下 a[^1] 会被识别（GFM 亦如此：定义存在即引用）
    expect(footnoteRefs(ed)).toHaveLength(1)
    expect(plainText(ed.getJSON())).toContain('[1]')
    expect(plainText(ed.getJSON())).toContain('x[^2]')
  })

  it('B4 转义 \\[^1] 保持字面（逃生舱有效）', () => {
    const ed = openDoc('转义 \\[^1] 是字面量。\n\n[^1]: 定义\n')
    expect(footnoteRefs(ed)).toHaveLength(0)
    expect(plainText(ed.getJSON())).toContain('[^1]')
  })

  it('B5 行内代码 `[^1]` 保持字面', () => {
    const ed = openDoc('代码 `[^1]` 保持字面。\n\n[^1]: 定义\n')
    expect(footnoteRefs(ed)).toHaveLength(0)
    expect(plainText(ed.getJSON())).toContain('[^1]')
  })

  it('B6 行内代码 `[^1]: x` 保持字面', () => {
    const ed = openDoc('代码 `[^1]: x` 保持字面。\n\n[^1]: 定义\n')
    expect(footnoteRefs(ed)).toHaveLength(0)
    expect(footnoteItems(ed)).toHaveLength(1) // 真定义仍生效
    expect(plainText(ed.getJSON())).toContain('[^1]: x')
  })

  it('B7 围栏代码块内 `[^1]: x` 保持字面，且不成为定义', () => {
    const md = '```\n[^1]: 不是定义\n```\n'
    const out = roundtrip(md)
    expect(out).toContain('[^1]: 不是定义')
    const ed = openDoc(md)
    expect(footnoteItems(ed)).toHaveLength(0)
  })

  it('B8 4 空格缩进代码块内的 `[^1]` 不得被改写（同名定义存在时）', () => {
    const md = '正文：\n\n    [^1] 在缩进代码块里\n\n[^1]: 定义\n\n引用[^1]。\n'
    const ed = openDoc(md)
    const code = collectNodes(ed.getJSON(), 'codeBlock')
    expect(code.length, '缩进代码块节点丢失').toBeGreaterThan(0)
    const codeText = code.map((c) => plainText(c)).join('\n')
    expect(codeText, '缩进代码块内容被改写').toContain('[^1] 在缩进代码块里')
    const out = roundtrip(md)
    expect(out, '往返后代码块内容被改写').toContain('[^1] 在缩进代码块里')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C. 抢占（GFM 表格 / 公式 / ke-* / HTML / 标题 / 列表 / 引用块）
// ─────────────────────────────────────────────────────────────────────────────
describe('C. 抢占', () => {
  it('C1 定义行之后的 GFM 表格不被吞（表格结构完好）', () => {
    const ed = openDoc('[^1]: 定义\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n引用[^1]。\n')
    const table = firstNode(ed, 'table')
    expect(table, '表格被吞').toBeTruthy()
    const cells = collectNodes(ed.getJSON(), 'tableCell').length + collectNodes(ed.getJSON(), 'tableHeader').length
    expect(cells, '表格行列丢失').toBeGreaterThanOrEqual(4)
    expect(footnoteItems(ed)[0]?.text).toBe('定义')
  })

  it('C2 定义行之前的 GFM 表格结构不受影响', () => {
    const ed = openDoc('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n[^1]: 定义\n\n引用[^1]。\n')
    expect(firstNode(ed, 'table')).toBeTruthy()
    expect(footnoteItems(ed)).toHaveLength(1)
  })

  it('C3 表格单元格内的 [^1] 不破坏表格结构', () => {
    const ed = openDoc('| a | b |\n| --- | --- |\n| x[^1] | y |\n\n[^1]: 定义\n')
    expect(firstNode(ed, 'table')).toBeTruthy()
    const cells = collectNodes(ed.getJSON(), 'tableCell').length + collectNodes(ed.getJSON(), 'tableHeader').length
    expect(cells, '表格行列丢失').toBeGreaterThanOrEqual(4)
  })

  it('C4 `$行内公式$` 内含 [^2] 时仍是 math 节点且 latex 不被污染', () => {
    const ed = openDoc('式子 $x[^2]$ 与引用[^2]。\n\n[^2]: 定义\n')
    const math = firstNode(ed, 'math')
    expect(math, 'math 节点丢失（被规范化改写）').toBeTruthy()
    expect(math?.attrs?.latex, 'math latex 被写入 ke 注释').toBe('x[^2]')
  })

  it('C5 `$$块级公式$$` 内的 `[^1]: x` 行不得被识别为定义、公式结构不得破坏', () => {
    const md = '$$\n[^1]: 公式里的行\n$$\n\n引用[^1]。\n'
    const ed = openDoc(md)
    const blocks = collectNodes(ed.getJSON(), 'mathBlock')
    expect(blocks, '块级公式节点丢失').toHaveLength(1)
    const latex = String(blocks[0]?.attrs?.latex ?? '')
    expect(latex, '公式内容被抽走').toContain('公式里的行')
    expect(latex, 'ke-footnotes 区域被吞进公式 latex').not.toContain('ke-footnotes')
    expect(footnoteItems(ed), '公式内文本被当成脚注定义').toHaveLength(0)
    const out = roundtrip(md)
    const ed2 = openDoc(out)
    for (const b of collectNodes(ed2.getJSON(), 'mathBlock')) {
      expect(String(b.attrs?.latex ?? ''), '往返后公式 latex 含区域标记').not.toContain('ke-footnotes')
    }
  })

  it('C6 定义行后紧跟 `<!-- ke-note: … -->`：信息块节点不得被吞', () => {
    const ed = openDoc('[^1]: 定义\n<!-- ke-note: {"id":"n","label":"提示"} -->\n\n引用[^1]。\n')
    expect(firstNode(ed, 'note'), 'ke-note 节点被吞').toBeTruthy()
    expect(footnoteItems(ed)[0]?.text).toBe('定义')
  })

  it('C7 已有 ke-footnotes 区域与 GFM 定义混排：不得产生重复/空壳区域', () => {
    const md =
      '正文[^1]。\n\n<!-- ke-footnotes:start -->\n' +
      '<!-- ke-footnote-item: {"id":"ke-aaaaaaaaaaaa","n":1,"text":"ke 条目"} -->\n' +
      '<!-- ke-footnotes:end -->\n\n[^2]: GFM 定义\n'
    const ed = openDoc(md)
    const regions = collectNodes(ed.getJSON(), 'footnotes')
    expect(regions.length, '出现多个 footnotes 区域').toBe(1)
    expect(footnoteItems(ed).map((i) => i.text).join('|')).toContain('ke 条目')
    expect(footnoteItems(ed).map((i) => i.text).join('|')).toContain('GFM 定义')
  })

  it('C8 普通 HTML 注释/HTML 块内的 [^1] 不得被改写（否则注释被提前终止）', () => {
    const mdComment = '<!-- 注释里的 [^1] -->\n\n[^1]: 定义\n\n引用[^1]。\n'
    const outComment = roundtrip(mdComment)
    expect(outComment, 'HTML 注释内容被改写').toContain('注释里的 [^1]')
    const mdDiv = '<div class="x">\n[^1] 在 HTML 块里\n</div>\n\n[^1]: 定义\n\n引用[^1]。\n'
    const outDiv = roundtrip(mdDiv)
    expect(outDiv, 'HTML 块内容被改写').toContain('[^1] 在 HTML 块里')
  })

  it('C9 标题内的引用 `# 标题[^1]` 仍是 heading + footnote', () => {
    const ed = openDoc('# 标题[^1]\n\n[^1]: 定义\n')
    const h = firstNode(ed, 'heading')
    expect(h).toBeTruthy()
    expect(plainText(h as JSONContent)).toContain('标题')
    expect(footnoteRefs(ed)).toHaveLength(1)
  })

  it('C10 形如定义的标题 `## [^1]: 文本` 必须仍是标题', () => {
    const ed = openDoc('## [^1]: 标题文本\n')
    const h = firstNode(ed, 'heading')
    expect(h, '标题被当成脚注定义').toBeTruthy()
    expect(plainText(h as JSONContent)).toContain('[^1]: 标题文本')
    expect(footnoteItems(ed)).toHaveLength(0)
  })

  it('C11 列表项内 `- [^1]: x` 不破坏列表且内容不丢', () => {
    const out = roundtrip('- [^1]: 列表项里的定义\n\n引用[^1]。\n')
    expect(out).toContain('列表项里的定义')
  })

  it('C12 引用块内 `> [^1]: x` 不破坏 blockquote 且内容不丢', () => {
    const ed = openDoc('> [^1]: 引用块里的定义\n\n引用[^1]。\n')
    expect(firstNode(ed, 'blockquote'), 'blockquote 节点丢失').toBeTruthy()
    expect(plainText(ed.getJSON())).toContain('引用块里的定义')
  })

  it('C13 setext 标题不被干扰', () => {
    const ed = openDoc('标题\n===\n\n引用[^1]。\n\n[^1]: 定义\n')
    expect(firstNode(ed, 'heading'), 'setext 标题丢失').toBeTruthy()
    expect(footnoteItems(ed)).toHaveLength(1)
  })

  it('C14 定义行紧邻围栏代码块：围栏内容完好', () => {
    const ed = openDoc('[^1]: 定义\n\n```\ncode [^2] here\n```\n\n引用[^1]。\n')
    const code = collectNodes(ed.getJSON(), 'codeBlock')
    expect(code.length).toBeGreaterThan(0)
    expect(code.map((c) => plainText(c)).join('\n')).toContain('code [^2] here')
  })

  it('C15 定义行后紧跟 ATX 标题（段落可被打断）不被吞', () => {
    const ed = openDoc('[^1]: 定义\n# 标题\n\n引用[^1]。\n')
    expect(firstNode(ed, 'heading'), '标题被吞').toBeTruthy()
    expect(footnoteItems(ed)[0]?.text).toBe('定义')
  })

  it('C16 混排压力样本：脚注 + 表格 + 公式 + ke-note + HTML 注释 + 围栏', () => {
    const md = [
      '# 标题[^a]',
      '',
      '[^a]: 脚注 A',
      '',
      '| 列1 | 列2 |',
      '| --- | --- |',
      '| $x^2$ | y |',
      '',
      '$$',
      'E = mc^2',
      '$$',
      '',
      '<!-- ke-note: {"id":"n1","label":"提示"} -->',
      '信息内容',
      '<!-- /ke-note -->',
      '',
      '<!-- 普通注释 [^a] -->',
      '',
      '```',
      'fence [^a]',
      '```',
      '',
      '正文引用[^a]。',
      '',
      '[^b]: 脚注 B',
    ].join('\n')
    const ed = openDoc(md)
    expect(firstNode(ed, 'table'), 'table 丢失').toBeTruthy()
    expect(firstNode(ed, 'math'), '行内 math 丢失').toBeTruthy()
    expect(firstNode(ed, 'mathBlock'), 'mathBlock 丢失').toBeTruthy()
    expect(firstNode(ed, 'note'), 'note 丢失').toBeTruthy()
    expect(firstNode(ed, 'codeBlock'), 'codeBlock 丢失').toBeTruthy()
    expect(firstNode(ed, 'heading'), 'heading 丢失').toBeTruthy()
    expect(footnoteItems(ed)).toHaveLength(2)
    // 围栏与 HTML 注释内的 [^a] 不得被改写
    const out = ed.getMarkdown()
    expect(out).toContain('fence [^a]')
    expect(out).toContain('普通注释 [^a]')
  })

  it('C17 防漂移：VERIFY_EXTENSIONS 的 tokenizer 承载顺序与 index.ts 生产顺序一致', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/editor/index.ts'), 'utf8')
    const region = src.slice(src.indexOf('export function useKeEditor'))
    const start = region.indexOf('extensions: [')
    const end = region.indexOf('\n    ],', start)
    expect(start >= 0 && end > start, 'index.ts 扩展数组定位失败').toBe(true)
    const body = region.slice(start, end)
    const TOKENIZER_EXT = new Set([
      'HtmlPassthroughExtension',
      'HtmlPassthroughInlineExtension',
      'GenericFallbackExtension',
      'GenericFallbackInlineExtension',
      'ImageMarkdownExtension',
      'MathExtension',
      'MathBlockExtension',
      'NoteExtension',
      'ModuleExtension',
      'AttachmentExtension',
      'VideoExtension',
      'FootnoteExtension',
      'FootnotesExtension',
      'TableMarkdownExtension',
    ])
    const prodOrder: string[] = []
    for (const m of body.matchAll(/\b([A-Za-z][A-Za-z0-9]*)Extension\b/g)) {
      const name = m[1]
      if (TOKENIZER_EXT.has(name) && !prodOrder.includes(name)) prodOrder.push(name)
    }
    const verifyOrder = VERIFY_EXTENSIONS.filter((e) => TOKENIZER_EXT.has(e.name)).map((e) => e.name)
    expect(verifyOrder).toEqual(prodOrder)
  })

  it('C18 4 空格缩进代码块整体内容不被任何新规则消费', () => {
    const md = [
      '正文',
      '',
      '    [^1] 引用样式',
      '    [^2]: 定义样式',
      '    - 列表样式',
      '    普通行',
      '',
      '[^1]: 真定义',
      '',
      '引用[^1]。',
    ].join('\n')
    const ed = openDoc(md)
    const codeText = collectNodes(ed.getJSON(), 'codeBlock').map((c) => plainText(c)).join('\n')
    expect(codeText).toContain('[^1] 引用样式')
    expect(codeText).toContain('[^2]: 定义样式')
    expect(codeText).toContain('- 列表样式')
    expect(codeText).toContain('普通行')
  })

  it('C19 懒续行不得吞掉紧随其后的块级结构（blockquote / 列表 / 围栏 / 表格 / 标题）', () => {
    const blocks: Array<[string, string]> = [
      ['blockquote', '> 引用内容'],
      ['bulletList', '- 列表项'],
      ['orderedList', '1. 列表项'],
      ['codeBlock', '```\n代码\n```'],
      ['heading', '# 标题'],
      ['table', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ]
    for (const [type, block] of blocks) {
      const md = `[^1]: 定义\n${block}\n\n引用[^1]。\n`
      const ed = openDoc(md)
      expect(firstNode(ed, type), `懒续行吞掉了 ${type}（${block.split('\n')[0]}）`).toBeTruthy()
      expect(footnoteItems(ed)[0]?.text, `定义文本被 ${type} 污染`).toBe('定义')
    }
  })

  it('C20 未知/大小写变体 ke-* 注释仍原样保留（fallback start 改动后的回归）', () => {
    const md = [
      '正文开头',
      '',
      '<!-- ke-future: {"a":1} -->',
      '',
      '中间',
      '',
      '<!-- ke-NOTE: {"id":"x"} -->',
      '',
      '结尾',
    ].join('\n')
    const ed = openDoc(md)
    const out = ed.getMarkdown()
    expect(out).toContain('ke-future: {"a":1}')
    expect(out).toContain('ke-NOTE: {"id":"x"}')
    expect(plainText(ed.getJSON())).toContain('正文开头')
    expect(plainText(ed.getJSON())).toContain('结尾')
  })

  it('C21 链接目标 URL 内的 [^1] 不得被改写（否则 URL 损坏）', () => {
    const md = '见 [点我](http://example.com/[^1]) 结束。\n\n[^1]: 定义\n'
    const out = roundtrip(md)
    expect(out, '链接目标被写入 ke 注释').toContain('http://example.com/[^1]')
  })

  it('C22 跨行行内代码内的 [^1] 不得被改写（CommonMark 允许 code span 跨行）', () => {
    const md = '代码 `跨行\n[^1] 内容` 结束。\n\n[^1]: 定义\n'
    const ed = openDoc(md)
    const out = ed.getMarkdown()
    expect(out, '跨行 code span 内容被改写').toContain('[^1] 内容')
  })

  it('C23 自动链接 / HTML 标签属性内不得被改写', () => {
    const md = '见 <http://example.com/[^1]> 与 <a href="http://x/[^1]">l</a>。\n\n[^1]: 定义\n'
    const out = roundtrip(md)
    expect(out).toContain('http://example.com/[^1]')
    expect(out).toContain('http://x/[^1]')
  })

  it('C25 引用式链接定义 / 图片目标 URL 内的 [^1] 不得被改写', () => {
    const md = '[ref]: http://example.com/[^1]\n\n![alt](http://img.example/[^1])\n\n见 [x][ref]。\n\n[^1]: 定义\n'
    const out = roundtrip(md)
    expect(out, '引用式链接定义 URL 被写入注释').toContain('http://example.com/[^1]')
    expect(out, '图片目标 URL 被写入注释').toContain('http://img.example/[^1]')
  })

  it('C26 行首（块级起始位置）的引用仍须是 footnote 节点，不得变块级 fallback', () => {
    const ed = openDoc('[^1] 开头引用。\n\n[^1]: 定义\n')
    expect(collectNodes(ed.getJSON(), 'keFallback'), '行首引用被块级 fallback 消费').toHaveLength(0)
    expect(footnoteRefs(ed)).toHaveLength(1)
    // `[^1]` 之后的空格是原文内容 → 转换为节点后必须原样保留（保真，不 trim）
    expect(plainText(ed.getJSON()), '标记后空格被吞/多余空格').toBe(' 开头引用。')
  })

  it('C27 相邻两个行首引用不产生多余块级节点', () => {
    const ed = openDoc('[^1][^2] 开头。\n\n[^1]: A\n\n[^2]: B\n')
    expect(collectNodes(ed.getJSON(), 'keFallback')).toHaveLength(0)
    expect(footnoteRefs(ed)).toHaveLength(2)
  })

  it('C28 图片 alt 内的 [^1] 不得被写成 HTML 注释文本（alt 是用户内容）', () => {
    const md = '![图[^1]](a.png)\n\n[^1]: 定义\n'
    const ed = openDoc(md)
    const img = firstNode(ed, 'image')
    expect(img, '图片节点丢失').toBeTruthy()
    const alt = String(img?.attrs?.alt ?? '')
    expect(alt, 'alt 被写入 ke 注释').not.toContain('<!-- ke-footnote')
    // 引用要么成为 footnote 节点，要么保持字面；不得只剩注释文本
    expect(footnoteRefs(ed).length + (alt.includes('[^1]') ? 1 : 0)).toBeGreaterThan(0)
  })

  it('C29 行首注释 + 同行正文时，未知 kind / 损坏 JSON 仍须原样保留（C26 修复不得漏内容）', () => {
    const cases: Array<[string, string]> = [
      ['未知 kind', '<!-- ke-future: {"a":1} -->正文照常。'],
      ['大小写变体', '<!-- ke-NOTE: {"id":"x"} -->正文照常。'],
      ['ke-footnote 损坏 JSON', '<!-- ke-footnote: {broken -->正文照常。'],
      ['ke-module 已知 kind', '<!-- ke-module: {"name":"M"} -->正文照常。'],
    ]
    for (const [name, md] of cases) {
      const ed = openDoc(md + '\n')
      const json = ed.getJSON()
      const out = ed.getMarkdown()
      expect(plainText(json), `${name}：正文丢失`).toContain('正文照常。')
      expect(out, `${name}：注释原文丢失`).toContain('<!-- ke-')
      expect(out, `${name}：kind 丢失`).toContain('ke-')
      ed.destroy()
    }
  })

  it('C24 唯一标签规模 2000 时规范化不发生超线性爆炸（性能门）', () => {
    const lines: string[] = []
    for (let i = 0; i < 2000; i++) lines.push(`正文引用[^L${i}] 结束。`)
    lines.push('')
    for (let i = 0; i < 2000; i++) lines.push(`[^L${i}]: 内容 ${i}`)
    const md = lines.join('\n')
    const t0 = performance.now()
    const ed = openDoc(md)
    const dt = performance.now() - t0
    expect(footnoteItems(ed)).toHaveLength(2000)
    expect(dt, `2000 脚注解析耗时 ${dt.toFixed(0)}ms`).toBeLessThan(30000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D. 幂等性与确定性
// ─────────────────────────────────────────────────────────────────────────────
describe('D. 幂等性与确定性', () => {
  it('D1 open→save 第二次起字节稳定', () => {
    const { first, second } = saveTwice('正文[^1]。\n\n[^1]: 脚注内容\n')
    expect(second).toBe(first)
  })

  it('D2 连续 3 次 open→save 全部相同', () => {
    const md = '正文[^1] 与[^note]。\n\n[^1]: 数字标签\n\n[^note]: 命名标签\n'
    const a = roundtrip(md)
    const b = roundtrip(a)
    const c = roundtrip(b)
    expect(b).toBe(a)
    expect(c).toBe(b)
  })

  it('D3 id 确定性：两次独立解析同一输入 → JSON 深度相等', () => {
    const md = '正文[^1]。\n\n[^1]: 脚注内容\n'
    const ed1 = openDoc(md)
    const ed2 = openDoc(md)
    expect(ed2.getJSON()).toEqual(ed1.getJSON())
  })

  it('D5 GFM 文档 → 保存为 ke 方言 → 再次 open→save 收敛', () => {
    const md = '正文[^a] 与表格。\n\n[^a]: 内容\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n'
    const ke1 = roundtrip(md)
    const ke2 = roundtrip(ke1)
    expect(ke2).toBe(ke1)
  })

  it('D6 重复标签（其余保留为文本）后二次解析稳定，且不得新增/复制 footnotes 区域', () => {
    const md = '[^1]: 第一个\n\n[^1]: 第二个\n\n引用[^1]。\n'
    const ke1 = roundtrip(md)
    const ke2 = roundtrip(ke1)
    expect(ke2, '重复标签文档两轮不一致').toBe(ke1)
    expect((ke1.match(/ke-footnotes:start/g) ?? []).length, '区域被复制').toBe(1)
    expect(ke2).toContain('第二个')
  })

  it('D7 CRLF 输入往返稳定且不吞行', () => {
    const md = '引用[^1]。\r\n\r\n[^1]: 定义\r\n'
    const ke1 = roundtrip(md)
    const ke2 = roundtrip(ke1)
    expect(ke2).toBe(ke1)
    expect(ke1).toContain('定义')
  })

  it('D8 无尾随换行输入不产生尾部漂移', () => {
    const md = '引用[^1]。\n\n[^1]: 定义'
    const ke1 = roundtrip(md)
    const ke2 = roundtrip(ke1)
    expect(ke2).toBe(ke1)
  })

  it('D9 空文档 / 仅空白文档不因新路径产生异常且稳定', () => {
    expect(roundtrip('')).toBe('')
    const ws = roundtrip('\n\n')
    // 空白文档被规整为空串或保留空白都可接受，但必须收敛
    expect(roundtrip(ws)).toBe(ws)
    expect(['', '\n\n']).toContain(ws)
  })

  it('D10 编号稳定：文档头部插入一个新脚注后，既有脚注 id 不变', () => {
    const base = '正文[^a]。\n\n[^a]: A 内容\n'
    const before = footnoteItems(openDoc(base))
    const afterMd = '新增[^z]。\n\n' + base + '\n[^z]: Z 内容\n'
    const after = footnoteItems(openDoc(afterMd))
    const aAfter = after.find((i) => i.text === 'A 内容')
    expect(aAfter?.id).toBe(before[0]?.id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// E. plain-export 闭环
// ─────────────────────────────────────────────────────────────────────────────
describe('E. plain-export 闭环', () => {
  it('E1 ke 脚注文档 → plainExportPayload → 重新解析：条目 (n,text) 等价', async () => {
    const md = '正文[^1] 与[^note]。\n\n[^1]: 数字标签内容\n\n[^note]: 命名标签内容\n'
    const ed = openDoc(md)
    const before = footnoteItems(ed).map((i) => `${i.n}:${i.text}`).sort()
    const exported = await exportPlain(ed)
    const ed2 = openDoc(stripFrontmatter(exported).content)
    const after = footnoteItems(ed2).map((i) => `${i.n}:${i.text}`).sort()
    expect(after).toEqual(before)
  })

  it('E2 导出产物回读后再导出 → 与首次导出字节相同（不动点）', async () => {
    const md = '正文[^1]。\n\n[^1]: 内容\n'
    const ed = openDoc(md)
    const first = await exportPlain(ed)
    const ed2 = openDoc(stripFrontmatter(first).content)
    const second = await exportPlain(ed2)
    expect(second).toBe(first)
  })

  it('E3 多行脚注（含空行/代码块）导出→回读：文本等价（GFM 4 空格续行语义）', async () => {
    const md = '正文[^1]。\n\n[^1]: 第一段\n\n    第二段\n\n        代码块内容\n'
    const ed = openDoc(md)
    const before = footnoteItems(ed)[0]?.text ?? ''
    const exported = await exportPlain(ed)
    const ed2 = openDoc(stripFrontmatter(exported).content)
    const after = footnoteItems(ed2)[0]?.text ?? ''
    expect(after).toBe(before)
  })

  it('E4 导出产物引用/定义配对（[^n] 与 [^n]: 数量与标签一致）', async () => {
    const md = '正文[^1] 与[^note] 与重复[^1]。\n\n[^1]: 内容一\n\n[^note]: 内容二\n'
    const ed = openDoc(md)
    const exported = await exportPlain(ed)
    // plain-export 按 n 命名标签（[^1]:/[^2]:），故定义标签应为数字且与引用编号集合一致
    const refs = [...exported.matchAll(/\[\^([^\]]+)\](?!:)/g)].map((m) => m[1])
    const defs = [...exported.matchAll(/^\[\^([^\]]+)\]:/gm)].map((m) => m[1])
    expect(defs.sort()).toEqual(['1', '2'])
    expect(new Set(refs)).toEqual(new Set(defs))
  })

  it('E7 GFM 文档 → open→save → 导出普通 Markdown → 回读结构等价（闭环不退化）', async () => {
    const md = '正文[^a]。\n\n[^a]: 内容 A\n'
    const ed = openDoc(md)
    const ke = ed.getMarkdown()
    const ed2 = openDoc(ke)
    const exported = await exportPlain(ed2)
    const ed3 = openDoc(stripFrontmatter(exported).content)
    const a1 = footnoteItems(ed).map((i) => `${i.n}:${i.text}`).sort()
    const a3 = footnoteItems(ed3).map((i) => `${i.n}:${i.text}`).sort()
    expect(a3).toEqual(a1)
  })

  it('E8 脚注 text 首行自带缩进时导出→回读仍等价（首行 `[^n]: ` 后缩进不可丢失）', async () => {
    const md = '正文[^1]。\n\n[^1]:     首行缩进内容\n\n    第二段\n'
    const ed = openDoc(md)
    const before = footnoteItems(ed)[0]?.text ?? ''
    const exported = await exportPlain(ed)
    const after = footnoteItems(openDoc(stripFrontmatter(exported).content))[0]?.text ?? ''
    expect(after).toBe(before)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F. 退化输入
// ─────────────────────────────────────────────────────────────────────────────
describe('F. 退化输入', () => {
  it('F1 空定义 `[^1]:`（无内容）不丢行不抛异常', () => {
    const out = roundtrip('正文\n\n[^1]:\n')
    expect(out).toContain('正文')
    expect(out).toContain('ke-footnote-item')
  })

  it('F2 仅定义无引用：内容保留', () => {
    const out = roundtrip('只有定义。\n\n[^1]: 孤立内容\n')
    expect(out).toContain('孤立内容')
  })

  it('F3 仅引用无定义：字面语义保真（允许转义形态，但必须收敛）', () => {
    const out = roundtrip('只有引用[^1]。\n')
    // 无定义时 marked/GM 语义是字面文本；序列化为 \[^1\] 属可接受保真形态
    expect(out).toContain('^1')
    expect(out).toContain('只有引用')
    expect(roundtrip(out), '转义后第二轮不稳定').toBe(out)
  })

  it('F4 重复标签 ×3：首个生效、其余保留', () => {
    const out = roundtrip('[^1]: 第一\n\n[^1]: 第二\n\n[^1]: 第三\n\n引用[^1]。\n')
    expect(out).toContain('第一')
    expect(out).toContain('第二')
    expect(out).toContain('第三')
  })

  it('F5 超长标签（1000 字符）不崩溃、不吞行、丢失不静默', () => {
    const long = 'a'.repeat(1000)
    const md = `引用[^${long}]。\n\n[^${long}]: 内容\n`
    const out = roundtrip(md)
    expect(out).toContain(long)
    expect(out).toContain('内容')
  })

  it('F6 标签含特殊字符（- _ . 中文）', () => {
    for (const label of ['a-b_c.d', '中文标签']) {
      const ed = openDoc(`引用[^${label}]。\n\n[^${label}]: 内容\n`)
      expect(footnoteItems(ed), `label=${label}`).toHaveLength(1)
    }
  })

  it('F7 畸形语法 `[^`、`]^[`、`[^^]`、`[^1` 不崩溃且不丢字', () => {
    const md = '畸形 [^ 与 ]^[ 与 [^^] 与 [^1 结束\n'
    const ed = openDoc(md)
    expect(footnoteItems(ed)).toHaveLength(0)
    const t = plainText(ed.getJSON())
    expect(t).toContain('[^')
    expect(t).toContain(']^[')
  })

  it('F8 定义行仅尾随空白 `[^1]:   ` 行为稳定', () => {
    const out = roundtrip('正文\n\n[^1]:   \n')
    expect(out).toContain('正文')
  })

  it('F9 定义内容含 `]`/`[`/`^`/花括号不全不误吞', () => {
    const md = '引用[^1]。\n\n[^1]: 内容含 [ ] ^ { 半括号\n'
    const ed = openDoc(md)
    expect(footnoteItems(ed)[0]?.text).toContain('内容含')
    const out = ed.getMarkdown()
    expect(out).toContain('半括号')
  })

  it('F10 定义内容含 `-->` 不破坏 ke 注释边界', () => {
    const md = '引用[^1]。\n\n[^1]: 内容含 --> 结束符\n'
    const ed = openDoc(md)
    expect(footnoteItems(ed)[0]?.text).toContain('-->')
    const ke1 = ed.getMarkdown()
    const ke2 = roundtrip(ke1)
    expect(ke2).toBe(ke1)
    expect(footnoteItems(openDoc(ke1))[0]?.text).toContain('-->')
  })

  it('F11 定义行在文档末尾（无尾随换行）', () => {
    const ed = openDoc('引用[^1]。\n\n[^1]: 末尾定义')
    expect(footnoteItems(ed)[0]?.text).toBe('末尾定义')
  })

  it('F13 脚注内容自引用/互引用不无限递归', () => {
    const md = '引用[^1] 与[^2]。\n\n[^1]: 内容里提到[^2]\n\n[^2]: 内容里提到[^1]\n'
    const ed = openDoc(md)
    expect(footnoteItems(ed)).toHaveLength(2)
    expect(collectNodes(ed.getJSON(), 'footnote').length).toBeGreaterThanOrEqual(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// H. 方案书 §1.1 五个损坏 case 的独立复现（验收标准原文）
// ─────────────────────────────────────────────────────────────────────────────
describe('H. 方案书验收用例（A/B/C/G/H 不得再损坏）', () => {
  it('H-A 引用+定义：不得变链接、定义不得消失', () => {
    const ed = openDoc('正文[^1]。\n\n[^1]: 第一脚注\n')
    expect(footnoteRefs(ed)).toHaveLength(1)
    expect(footnoteItems(ed)[0]?.text).toBe('第一脚注')
    const out = ed.getMarkdown()
    expect(out, '出现假链接').not.toMatch(/\[\^1\]\(/)
  })

  it('H-B 仅引用无定义：内容保留且第二次起幂等', () => {
    const out1 = roundtrip('正文[^1]。\n')
    expect(out1).toContain('^1')
    expect(roundtrip(out1)).toBe(out1)
  })

  it('H-C 孤立定义：整行不得消失', () => {
    const out = roundtrip('正文无关。\n\n[^1]: 孤立定义\n')
    expect(out).toContain('孤立定义')
  })

  it('H-G 多行续行：不得变成代码块', () => {
    const ed = openDoc('正文[^1]。\n\n[^1]: 第一段\n    续行\n')
    expect(collectNodes(ed.getJSON(), 'codeBlock'), '续行变代码块').toHaveLength(0)
    expect(footnoteItems(ed)[0]?.text ?? '').toContain('续行')
  })

  it('H-H 命名标签：同样不得变链接', () => {
    const ed = openDoc('正文[^note]。\n\n[^note]: 命名内容\n')
    expect(footnoteRefs(ed)).toHaveLength(1)
    expect(footnoteItems(ed)[0]?.text).toBe('命名内容')
    expect(ed.getMarkdown()).not.toMatch(/\[\^note\]\(/)
  })
})
