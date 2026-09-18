/**
 * 独立对抗验证套件 —— F-1…F-5 保真修复（task-31）· 实测版（scratch → 冻结后进仓库）
 *
 * 判据分层：
 *  A. 严格（trimEnd 归一 + 表格前置空行归一 的逐字节 + 幂等）
 *  B. 语义等价（**既有**规范化，两树一致，仅留痕）：`<br>`→硬换行、`<a>`→Markdown 链接、裸 `&`→`&amp;`、`[X]`→`[x]`
 *  C. 已知剩余偏差（本次实测新报，按 FAIL 跟踪）：属性值含 `>` 被改写、混合任务/普通列表变松散、嵌套 HTML 标签丢失
 * 契约（Lead 确认）：F-5 保留原换行风格；F-4 BOM 逐字节保留（不丢不重、内部不含 BOM）；F-1…F-3 不得丢内容/不得换成别的东西
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
import {
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
} from './extensions/TableMarkdownExtension'
import { normalizeGfmFootnotes } from './gfm-footnote'
import { keExportPayload, plainExportPayload } from './export-actions'
import { applyDocTraits, captureDocTraits, frontmatterBlockOf, KE_VERSION, stripFrontmatter, withFrontmatter } from './ke'

export const PROD_EXTENSIONS = [
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

export function saveChain(raw: string): string {
  const traits = captureDocTraits(raw)
  const { out } = roundtrip(raw)
  return applyDocTraits(withFrontmatter(out, KE_VERSION), traits)
}

export function trimEnd(s: string): string {
  return s.replace(/[\r\n]+$/, '')
}

/** 表格前置空行（P1-4 既有规范化）归一后比较 */
export function normComparable(s: string): string {
  return trimEnd(s).replace(/^\n+/, '')
}

function strict(name: string, raw: string): void {
  it(`${name}：逐字节（行尾不计差）+ 幂等`, () => {
    const { body, out, out2 } = roundtrip(raw)
    expect(trimEnd(out), `${name} 往返`).toBe(trimEnd(body))
    expect(out2, `${name} 幂等`).toBe(out)
  })
}

function semantic(name: string, raw: string, check: (out: string) => void): void {
  it(`${name}：语义等价（既有规范化，非逐字节）`, () => {
    const { out, out2 } = roundtrip(raw)
    check(out)
    expect(out2, `${name} 幂等`).toBe(out)
  })
}

const BOM = '\ufeff'

describe('F-1 任务列表（A 层）', () => {
  strict('F1-1 [x]', '- [x] 完成\n')
  strict('F1-2 [ ]', '- [ ] 未完成\n')
  strict('F1-4 嵌套', '- [x] 父\n  - [ ] 子\n')
  strict('F1-6 引用块内', '> - [x] q\n')
  strict('F1-7 含强调与代码', '- [x] **粗** `code`\n')



  it('F1-3 大写 [X]：勾选状态保留（大小写可规范化，语义不得翻转）', () => {
    const { out } = roundtrip('- [X] 完成\n')
    expect(out).toMatch(/- \[[xX]\] 完成/)
    expect(out).not.toContain('[ ]')
  })

  it('既有：`- [x]完成`（GFM 非任务项）与空任务项 `- [ ]` 被转义为字面（pre/post 一致，内容不丢）', () => {
    // 实测 pre-post 两树输出完全一致：`- \\[x\\]完成` / `- \\[ \\]` → 属既有降级，非 F-1 引入
    expect(roundtrip('- [x]完成\n').out).toContain('完成')
    expect(roundtrip('- [ ]\n').out).toContain(']')
  })

  it('D-1（规范 §2.6）混合任务/普通列表：状态与文本不丢 + 幂等（方差：变松散列表，记录在案）', () => {
    const raw = '- [x] a\n- b\n- [ ] c\n'
    const { out, out2 } = roundtrip(raw)
    // 契约（§2.6 F-1）：复选框状态与文本必须保留
    expect(out).toContain('- [x] a')
    expect(out).toContain('- [ ] c')
    expect(out).toContain('- b')
    expect(out).not.toContain('- [ ] a')
    // 已知偏差 D-1：每项之间插入空行（tight→loose）；必须是**稳定**的，不能每轮再变
    console.log('D-1-DEVIATION ratio=' + JSON.stringify(out))
    expect(out2).toBe(out)
  })

  it('F1-10 任务列表 + 段落 + 表格混排：内容不丢 + 幂等', () => {
    const raw = '- [x] a\n\n| c1 | c2 |\n| --- | --- |\n| 1 | 2 |\n\n- [ ] b\n'
    const { out, out2 } = roundtrip(raw)
    expect(out).toContain('- [x] a')
    expect(out).toContain('- [ ] b')
    expect(out).toContain('| --- | --- |')
    expect(out2).toBe(out)
  })

  it('F1 反替代：状态不得被翻转', () => {
    expect(roundtrip('- [x] 完成\n').out).toMatch(/- \[[xX]\] 完成/)
    expect(roundtrip('- [ ] 未完成\n').out).toContain('- [ ] 未完成')
  })
})

describe('F-2 行内 HTML', () => {
  strict('F2-1 span+style', '正文 <span style="color:red">红</span> 结尾\n')
  strict('F2-4 自闭合 img', '前 <img src="a.png" alt="x" /> 后\n')
  strict('F2-5 大写标签', '前 <SPAN>X</SPAN> 后\n')
  strict('F2-8 未闭合标签', '正文 <span> 未闭合\n')
  strict('F2-11a 行内代码内字面', '`<span>x</span>`\n')
  strict('F2-11b 围栏内字面', '```\n<span>x</span>\n```\n')
  strict('F2-3b 属性含实体（不误伤）', '前 <span title="a&amp;b">x</span> 后\n')

  it('C 层·F2-6 属性值含 `>` 不得被改写为非法标签（已知剩余偏差·本次新报）', () => {
    for (const raw of [
      '前 <span title="a>b">x</span> 后\n',
      "前 <span title='a>b'>x</span> 后\n",
      '前 <span title="x>y" id="z">w</span> 后\n',
      '<div data-x="a>b">block</div>\n',
    ]) {
      const { out } = roundtrip(raw)
      expect(trimEnd(out), `原样保留失败：${raw.trim()}`).toBe(trimEnd(raw))
    }
  })

  it('D-2（规范 §2.6）嵌套 HTML：内层未知标签丢失属既有缺口（断言内容不丢 + 幂等）', () => {
    const { out, out2 } = roundtrip('前 <em><span>x</span></em> 后\n')
    // 契约：标准标签（em）走 Markdown 转换；已知偏差 D-2：内层 span 丢失
    console.log('D-2-DEVIATION out=' + JSON.stringify(out))
    expect(out).toContain('前')
    expect(out).toContain('后')
    expect(out).toContain('x')
    expect(out2).toBe(out)
  })

  it('F2-9 行内 HTML 与强调混排：两者都保留', () => {
    const { out } = roundtrip('**<span>x</span>**\n')
    expect(out).toContain('<span>')
    expect(out).toContain('**')
  })

  it('F2-12 标签不得被转义成实体', () => {
    const { out } = roundtrip('前 <span>x</span> 后\n')
    expect(out).not.toContain('&lt;span')
  })

  semantic('F2-2 `<br>` → 硬换行（既有规范化）', '甲<br>乙\n', (out) => {
    expect(out).toContain('甲')
    expect(out).toContain('乙')
    expect(out).not.toContain('甲乙')
  })
  semantic('F2-3 `<a href>` → Markdown 链接（既有规范化）', '前 <a href="http://x">链接</a> 后\n', (out) => {
    expect(out).toContain('链接')
    expect(out).toMatch(/\[链接\]\(http:\/\/x\)/)
  })
})

describe('F-3 HTML 实体', () => {
  strict('F3-1 &copy;', '版权 &copy; 2026\n')
  strict('F3-2a 十进制实体', '&#169; 实体\n')
  strict('F3-2b 十六进制实体', '&#xA9; 实体\n')
  strict('F3-4 &amp; 不二次转义', 'a &amp; b\n')
  strict('F3-5 未知实体', '&notanentity; 文本\n')
  strict('F3-6a 行内代码内字面', '`&copy;`\n')
  strict('F3-6b 围栏内字面', '```\n&copy;\n```\n')
  strict('F3-7a 标题内实体', '# 标题 &copy;\n')
  it('F3-7b 表格单元格内实体：逐字节（表格前置空行归一）+ 幂等', () => {
    const raw = '| a | b |\n| --- | --- |\n| &copy; | x |\n'
    const { body, out, out2 } = roundtrip(raw)
    expect(normComparable(out)).toBe(normComparable(body))
    expect(out2).toBe(out)
  })
  strict('F3-8 多实体混排', '&copy; &#169; &amp; &lt; &gt; &quot; &nbsp;\n')
  strict('F3-10 实体 + 行内 HTML 混排', '前 <span>&copy; A&amp;B</span> 后\n')
  strict('F3-反替代：&copy; 不得被解码为 ©', '版权 &copy;\n')

  semantic('F3-3 裸 `&` → `&amp;`（既有规范化，HTML 语义正确）', 'AT&T 与 a & b\n', (out) => {
    expect(out).toContain('AT')
    expect(out).toContain('&amp;')
  })
})

describe('F-4 BOM', () => {
  const BOM_CASES: Array<[string, string]> = [
    ['F4-1 BOM+frontmatter(LF)', `${BOM}---\nke_version: 1\ntitle: 标题\n---\n\n正文\n`],
    ['F4-2 BOM+frontmatter(CRLF)', `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n`],
    ['F4-4 BOM+正文', `${BOM}# 标题\n\n正文\n`],
    ['F4-6 BOM+CRLF 正文', `${BOM}# 标题\r\n\r\n正文\r\n`],
    ['F4-9a BOM+任务列表', `${BOM}- [x] 完成\n`],
    ['F4-9b BOM+实体', `${BOM}版权 &copy;\n`],
  ]
  for (const [name, raw] of BOM_CASES) {
    it(`${name}：frontmatter 不泄漏 + BOM 保留且不重复 + 幂等`, () => {
      const body = stripFrontmatter(raw).content
      expect(body, `${name} 正文含 frontmatter`).not.toContain('ke_version')
      expect(body, `${name} 正文出现 ## ---`).not.toContain('## ---')
      const saved = saveChain(raw)
      expect(saved.startsWith(BOM), `${name} BOM 丢失`).toBe(true)
      expect((saved.match(/\ufeff/g) ?? []).length, `${name} BOM 数量`).toBe(1)
      expect(saveChain(saved), `${name} 幂等`).toBe(saved)
    })
  }
  it('F4-3 BOM+frontmatter：二次往返稳定（pre-fix 非幂等）', () => {
    const raw = `${BOM}---\nke_version: 1\ntitle: 标题\n---\n\n正文\n`
    const once = saveChain(raw)
    expect(saveChain(once)).toBe(once)
    const { out, out2 } = roundtrip(raw)
    expect(out2).toBe(out)
  })
  it('F4-7 双 BOM → 归一为单个', () => {
    const raw = `${BOM}${BOM}# 标题\n\n正文\n`
    const saved = saveChain(raw)
    expect((saved.match(/\ufeff/g) ?? []).length).toBe(1)
    expect(saveChain(saved)).toBe(saved)
  })
  it('F4-5 只有 BOM：不崩、输出确定', () => {
    const saved = saveChain(BOM)
    expect(typeof saved).toBe('string')
    expect(saveChain(saved)).toBe(saved)
  })
  it('F4-10 无 BOM 文件不得凭空出现 BOM', () => {
    expect(saveChain('# 标题\n\n正文\n').startsWith(BOM)).toBe(false)
  })
  it('F4-8 文件中部（非行首）的 BOM 不得被吞', () => {
    const { out, out2 } = roundtrip(`段落一\n\n${BOM}段落二\n`)
    expect(out).toContain('段落二')
    expect(out2).toBe(out)
  })
})

describe('F-5 换行（按文档保留原风格）', () => {
  const EOL_CASES: Array<[string, string, '\n' | '\r\n']> = [
    ['F5-1 全 CRLF', '# 标题\r\n\r\n正文\r\n', '\r\n'],
    ['F5-2 CRLF+frontmatter', '---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n', '\r\n'],
    ['F5-3a LF 文档', '# 标题\n\n正文\n', '\n'],
    ['F5-3b LF+frontmatter', '---\nke_version: 1\n---\n\n正文\n', '\n'],
    ['F5-4 混排（CRLF 多）', '# 标题\r\n\n正文\r\n', '\r\n'],
    ['F5-6 无尾换行 LF', '# 标题\n\n正文', '\n'],
    ['F5-7 围栏内 CRLF', '```\r\ncode line1\r\ncode line2\r\n```\r\n', '\r\n'],
  ]
  for (const [name, raw, eol] of EOL_CASES) {
    it(`${name}：风格判定 + traits 还原后逐字节 + 幂等`, () => {
      const traits = captureDocTraits(raw)
      expect(traits.eol, `${name} 主导风格`).toBe(eol)
      const { body, out, out2 } = roundtrip(raw)
      // 契约：混排/单个 CR 按主导风格处理（不要求逐字符保真）→ 两侧都施加 traits 后比较
      expect(trimEnd(applyDocTraits(out, traits)), `${name} traits 还原后`).toBe(
        trimEnd(applyDocTraits(body, traits)),
      )
      expect(out2, `${name} 幂等`).toBe(out)
    })
  }
  it('F5-5 单个 CR：按主导风格 LF 处理（不要求逐字符保真）+ 内容不丢 + 幂等', () => {
    const raw = '甲\r乙\r'
    const traits = captureDocTraits(raw)
    expect(traits.eol).toBe('\n')
    const { out, out2 } = roundtrip(raw)
    expect(out).not.toContain('\r')
    expect(out).toContain('甲')
    expect(out).toContain('乙')
    expect(out2).toBe(out)
  })

  it('F5 反向：LF 文档不得被改成 CRLF', () => {
    const traits = captureDocTraits('# 标题\n\n正文\n')
    expect(traits.eol).toBe('\n')
    expect(roundtrip('# 标题\n\n正文\n').out).not.toContain('\r')
  })
  it('F5-9 组合：BOM + CRLF + 任务列表 + 实体', () => {
    const raw = `${BOM}- [x] 完成\r\n\r\n版权 &copy; 2026\r\n`
    const traits = captureDocTraits(raw)
    expect(traits).toEqual({ bom: true, eol: '\r\n' })
    const saved = saveChain(raw)
    expect(saved.startsWith(BOM)).toBe(true)
    expect(saved).toContain('\r\n')
    expect(saveChain(saved)).toBe(saved)
  })
})

describe('交叉验证', () => {
  it('X1 ke-* 序列化快照逐字节不变', () => {
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
    const { out, out2 } = roundtrip(snap)
    expect(out).toContain('<!-- ke-note: {"kind":"note","id":"n1","title":"注","color":"blue"} -->')
    expect(out).toContain('<!-- ke-module: {"kind":"module","id":"m1","name":"模块"} -->')
    expect(out).toContain('<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"x.pdf","title":"文档"} -->')
    expect(out).toContain(
      '<!-- ke-video: {"kind":"video","id":"v1","src":"v.mp4","title":"视频","controls":true,"autoplay":false,"loop":false} -->',
    )
    expect(out).toContain('<!-- ke-footnote-item: {"id":"ke-aaaaaaaaaaaa","n":1,"text":"脚注"} -->')
    expect(out2).toBe(out)
  })

  it('X2 防漂移：生产 index.ts 仍注册 TaskList/TaskItem，且顺序合理', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/editor/index.ts'), 'utf8')
    expect(src).toMatch(/from '@tiptap\/extension-list'/)
    expect(src).toMatch(/\bTaskList\b/)
    expect(src).toMatch(/\bTaskItem\b/)
    const scope = src.slice(src.indexOf('export function useKeEditor'))
    const start = scope.indexOf('extensions: [')
    const end = scope.indexOf('\n    ],', start)
    // 去注释后再提取（注释里也会提到扩展名，例如 ImageMarkdownExtension 的说明）
    const region = scope.slice(start, end).replace(/\/\/[^\n]*/g, '')
    const WANT = [
      'KeListItem',
      'TaskList',
      'TaskItem',
      'ImageMarkdownExtension',
      'MathExtension',
      'MathBlockExtension',
      'FootnoteExtension',
      'FootnotesExtension',
      'TableMarkdownExtension',
    ]
    const seen: string[] = []
    for (const m of region.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\b/g)) {
      if (WANT.includes(m[1]) && !seen.includes(m[1])) seen.push(m[1])
    }
    const idx = (name: string): number => seen.indexOf(name)
    expect(seen.length, '未能从 index.ts 提取扩展顺序').toBeGreaterThanOrEqual(WANT.length - 1)
    expect(idx('TaskList')).toBeGreaterThan(idx('KeListItem'))
    expect(idx('TaskItem')).toBeGreaterThan(idx('TaskList'))
    expect(idx('ImageMarkdownExtension')).toBeGreaterThan(idx('TaskItem'))
  })

  it('X3 组合矩阵：BOM+CRLF+任务列表+实体+行内 HTML', () => {
    const raw = `${BOM}- [x] 任务\r\n\r\n版权 &copy; 与 <span class="x">红</span>\r\n`
    const traits = captureDocTraits(raw)
    const { body, out, out2 } = roundtrip(raw)
    expect(trimEnd(applyDocTraits(out, traits))).toBe(trimEnd(applyDocTraits(body, traits)))
    expect(out2).toBe(out)
  })

  it('X4 回归对照：正文/标题/列表/表格/公式样本', () => {
    for (const raw of [
      '# 标题\n\n正文段落\n',
      '- a\n- b\n',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      '前 $x^2$ 后\n',
      '$$\nE=mc^2\n$$\n',
    ]) {
      const { body, out, out2 } = roundtrip(raw)
      expect(normComparable(out), `回归样本：${JSON.stringify(raw)}`).toBe(normComparable(body))
      expect(out2).toBe(out)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F-6 导出侧 traits（Lead 追加要求：KE 单文件 + 文档包；「导出 vs 磁盘源文档 diff=0」）
// ─────────────────────────────────────────────────────────────────────────────
describe('F-6 导出侧（KE 单文件 / 文档包）', () => {
  function editorFromRaw(raw: string): Editor {
    const body = stripFrontmatter(raw).content
    return new Editor({ extensions: PROD_EXTENSIONS, content: normalizeGfmFootnotes(body), contentType: 'markdown' })
  }

  it('E1 KE 导出：BOM + CRLF 源 → 导出保留 BOM 与 CRLF', async () => {
    const src = `${BOM}---\r\nke_version: 1\r\ntitle: 标题\r\n---\r\n\r\n正文段落\r\n`
    const ed = editorFromRaw(src)
    const target = keExportPayload(ed, '标题', src)
    const text = await target.blob.text()
    ed.destroy()
    const traits = captureDocTraits(text)
    expect(traits).toEqual({ bom: true, eol: '\r\n' })
    expect(text.startsWith(BOM)).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toContain('\n') // 无裸 LF
    expect(text).toContain('正文段落')
    expect(text).toContain('ke_version: 1')
  })

  it('E2 KE 导出：LF/无 BOM 源 → 导出不得凭空出现 BOM/CRLF', async () => {
    const src = '---\nke_version: 1\n---\n\n正文段落\n'
    const ed = editorFromRaw(src)
    const text = await keExportPayload(ed, '标题', src).blob.text()
    ed.destroy()
    expect(text.startsWith(BOM)).toBe(false)
    expect(text).not.toContain('\r')
  })

  it('E3 KE 导出（未传 sourceRaw）→ 默认 LF/无 BOM（内部产物口径）', async () => {
    const src = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n`
    const ed = editorFromRaw(src)
    const text = await keExportPayload(ed, '标题').blob.text()
    ed.destroy()
    expect(text.startsWith(BOM)).toBe(false)
    expect(text).not.toContain('\r')
  })

  it('E4 「diff=0」测量：正文与文件特征一致；frontmatter 仅 ke_version（如实记录差异）', async () => {
    const src = `${BOM}---\r\nke_version: 1\r\ntitle: 标题\r\ntags: [a]\r\n---\r\n\r\n正文段落\r\n`
    const ed = editorFromRaw(src)
    const text = await keExportPayload(ed, '标题', src).blob.text()
    ed.destroy()
    // 文件特征 + 正文一致
    expect(captureDocTraits(text)).toEqual(captureDocTraits(src))
    expect(trimEnd(stripFrontmatter(text).content)).toBe(trimEnd(stripFrontmatter(src).content))
    // frontmatter 差异如实记录（导出仅重建 ke_version，不携带 title/tags）
    const fmOf = (s: string): string => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(s.startsWith(BOM) ? s.slice(1) : s) ?? [])[1] ?? ''
    console.log('E4-FM-SRC : ' + JSON.stringify(fmOf(src)))
    console.log('E4-FM-EXPT: ' + JSON.stringify(fmOf(text)))
    expect(fmOf(text)).toContain('ke_version')
  })

  it('E5 文档包路径：EditorArea 在 packageExportAndSave 前按 article.content 还原 traits（源码级）', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8')
    const pkgAt = src.indexOf('handleExportPackage')
    expect(pkgAt).toBeGreaterThan(0)
    const block = src.slice(pkgAt, pkgAt + 1200)
    expect(block).toContain('applyDocTraits')
    expect(block).toContain('captureDocTraits(article.content)')
    expect(block.indexOf('applyDocTraits')).toBeLessThan(block.indexOf('packageExportAndSave'))
    // KE 单文件导出：以磁盘原文作 sourceRaw
    expect(src).toMatch(/keExportPayload\(editor, article\.title, article\.content\)/)
    // 载入路径捕获 traits
    expect(src).toMatch(/captureTraits\(article\.id, article\.content\)/)
  })

  it('E6 文档包载荷（复刻生产表达式）：BOM+CRLF 源 → 传给后端的 md 保留 traits', () => {
    const src = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n`
    const ed = editorFromRaw(src)
    // EditorArea.handleExportPackage 的原表达式：
    const md = applyDocTraits(withFrontmatter(ed.getMarkdown(), KE_VERSION), captureDocTraits(src))
    ed.destroy()
    expect(captureDocTraits(md)).toEqual({ bom: true, eol: '\r\n' })
    expect(trimEnd(stripFrontmatter(md).content)).toBe(trimEnd(stripFrontmatter(src).content))
  })

  it('E7 普通 Markdown 导出：不套 traits（既定口径：外部可读的派生文件）→ LF/无 BOM', async () => {
    const src = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n`
    const ed = editorFromRaw(src)
    const text = await plainExportPayload(ed, {
      id: 'x',
      path: '/x.md',
      title: '标题',
      content: src,
      tags: [],
      meta: {},
    }).blob.text()
    ed.destroy()
    expect(text.startsWith(BOM)).toBe(false)
    expect(text).not.toContain('\r')
    expect(text).toContain('正文')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 增量复验（task-36）：KE 导出保留源 frontmatter 键（title/tags/自定义）
// 判据（Lead 口径）：正文与既有键逐字节一致 + ke_version 更新为当前值 = PASS
// ─────────────────────────────────────────────────────────────────────────────
describe('F-6b 增量复验：KE 导出 frontmatter 保留', () => {
  const BOMX = '\ufeff'
  const editorOf = (raw: string): Editor =>
    new Editor({
      extensions: PROD_EXTENSIONS,
      content: normalizeGfmFootnotes(stripFrontmatter(raw).content),
      contentType: 'markdown',
    })

  /** 本地独立实现：取文件 frontmatter 区块（含定界符），不用被测实现的同名函数 */
  function fmBlockOf(text: string): string {
    const src = text.startsWith(BOMX) ? text.slice(1) : text
    const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)+/.exec(src)
    return m ? m[0] : ''
  }
  /** frontmatter 键值体（去定界符与尾随空行） */
  function fmBodyOf(text: string): string {
    const blk = fmBlockOf(text)
    if (!blk) return ''
    const sm = blk.startsWith(BOMX) ? blk.slice(1) : blk
    return sm.replace(/^---\r?\n/, '').replace(/\r?\n---[\s\S]*$/, '')
  }

  it('K1 title/tags/自定义键 + 过期 ke_version → 其余键保留、ke_version 更新', async () => {
    const src = ['---', 'ke_version: 0', 'title: 我的标题', 'tags: [alpha, beta]', 'custom_key: keep-me', '---', '', '正文段落', ''].join('\n')
    const ed = editorOf(src)
    const text = await keExportPayload(ed, '我的标题', src).blob.text()
    ed.destroy()
    const fm = fmBodyOf(text)
    expect(fm).toContain('title: 我的标题')
    expect(fm).toContain('tags: [alpha, beta]')
    expect(fm).toContain('custom_key: keep-me')
    expect(fm).toContain('ke_version: 1')
    expect(fm).not.toContain('ke_version: 0')
    expect(trimEnd(stripFrontmatter(text).content)).toBe(trimEnd(stripFrontmatter(src).content))
  })

  it('K2 未知键 / 注释 / 多行数组：如实比对 frontmatter 区块', async () => {
    const src = [
      '---',
      'title: 标题',
      '# 这是注释',
      'nested:',
      '  a: 1',
      '  b: two',
      'list:',
      '  - x',
      '  - y',
      'weird-key_2: "val:with:colon"',
      'ke_version: 1',
      '---',
      '',
      '正文',
      '',
    ].join('\n')
    const ed = editorOf(src)
    const text = await keExportPayload(ed, '标题', src).blob.text()
    ed.destroy()
    const srcFm = trimEnd(fmBodyOf(src))
    const outFm = trimEnd(fmBodyOf(text))
    console.log('K2-FM-SRC: ' + JSON.stringify(srcFm))
    console.log('K2-FM-OUT: ' + JSON.stringify(outFm))
    expect(outFm).toBe(srcFm)
  })

  it('K3 键顺序：ke_version 位于中间时顺序不得改变', async () => {
    const src = ['---', 'title: T', 'ke_version: 0', 'tags: [a]', '---', '', '正文', ''].join('\n')
    const ed = editorOf(src)
    const text = await keExportPayload(ed, 'T', src).blob.text()
    ed.destroy()
    const keys = fmBodyOf(text)
      .split(/\r?\n/)
      .map((l) => /^([A-Za-z_][\w-]*)\s*:/.exec(l)?.[1])
      .filter(Boolean)
    expect(keys).toEqual(['title', 'ke_version', 'tags'])
  })

  it('K4 源无 ke_version → 追加为第一键（顺序变化如实记录）', async () => {
    const src = ['---', 'title: T', 'tags: [a]', '---', '', '正文', ''].join('\n')
    const ed = editorOf(src)
    const text = await keExportPayload(ed, 'T', src).blob.text()
    ed.destroy()
    const fm = fmBodyOf(text)
    expect(fm).toContain('title: T')
    expect(fm).toContain('tags: [a]')
    expect(fm).toContain('ke_version: 1')
    console.log('K4-FM-OUT: ' + JSON.stringify(fm))
  })

  it('K5 源无 frontmatter → 导出只加 ke_version，不得引入其他键', async () => {
    const src = '# 标题\n\n正文\n'
    const ed = editorOf(src)
    const text = await keExportPayload(ed, '标题', src).blob.text()
    ed.destroy()
    const fm = fmBodyOf(text)
    expect(fm.trim()).toBe('ke_version: 1')
  })

  it('K6 BOM + CRLF + frontmatter：三者同时保留', async () => {
    const src = `${BOMX}---\r\nke_version: 0\r\ntitle: 标题\r\ntags: [a]\r\n---\r\n\r\n正文\r\n`
    const ed = editorOf(src)
    const text = await keExportPayload(ed, '标题', src).blob.text()
    ed.destroy()
    expect(text.startsWith(BOMX)).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    const fm = fmBodyOf(text)
    expect(fm).toContain('title: 标题')
    expect(fm).toContain('tags: [a]')
    expect(fm).toContain('ke_version: 1')
    expect(trimEnd(stripFrontmatter(text).content)).toBe(trimEnd(stripFrontmatter(src).content))
  })

  it('K7 整文件严格 diff：如实列出与源文件的差异', async () => {
    const src = `${BOMX}---\r\nke_version: 0\r\ntitle: 标题\r\ntags: [alpha, beta]\r\n---\r\n\r\n正文段落\r\n`
    const ed = editorOf(src)
    const text = await keExportPayload(ed, '标题', src).blob.text()
    ed.destroy()
    const same = text === src
    console.log('K7-STRICT-DIFF identical=' + String(same))
    if (!same) {
      const a = src.split(/\r?\n/)
      const b = text.split(/\r?\n/)
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) console.log(`K7-LINE ${i}: src=${JSON.stringify(a[i])} out=${JSON.stringify(b[i])}`)
      }
    }
    // 口径：正文与既有键逐字节一致 + ke_version 更新 = PASS（顺序/尾换行差异单独记录）
    expect(fmBodyOf(text).replace(/ke_version: \d+/, 'ke_version: <v>')).toBe(
      fmBodyOf(src).replace(/ke_version: \d+/, 'ke_version: <v>'),
    )
    expect(trimEnd(stripFrontmatter(text).content)).toBe(trimEnd(stripFrontmatter(src).content))
    expect(captureDocTraits(text)).toEqual(captureDocTraits(src))
  })

  it('K8 空 frontmatter 区块：**既有边界**（stripFrontmatter 不识别空块）——导出产物本身正常', async () => {
    const src = '---\n---\n\n正文\n'
    // PRE-EXISTING：正则 `[\\s\\S]*?` 之后还要 `\\r?\\n---`，空块（首行即闭合 `---`）匹配不到 →
    // 载入时整块被当正文（基线副本同一正则同样 null，与本修复无关）
    console.log('K8-PREEXIST-strip=' + JSON.stringify(stripFrontmatter(src).content))
    const ed = editorOf(src)
    const text = await keExportPayload(ed, 'T', src).blob.text()
    ed.destroy()
    expect(text).toContain('ke_version: 1')
    expect(text).toContain('正文')
    expect(captureDocTraits(text)).toEqual(captureDocTraits(src))
  })

  it('K9 frontmatter 后多余空行：差异如实记录（可能被规整为单空行）', async () => {
    const src = '---\ntitle: T\n---\n\n\n\n正文\n'
    const ed = editorOf(src)
    const text = await keExportPayload(ed, 'T', src).blob.text()
    ed.destroy()
    console.log('K9-OUT: ' + JSON.stringify(text))
    expect(fmBodyOf(text)).toContain('title: T')
    expect(trimEnd(stripFrontmatter(text).content)).toBe(trimEnd(stripFrontmatter(src).content))
  })

  it('K10 文档包（.zip）路径：源 frontmatter 其余键保留（生产表达式复刻 + 漂移哨兵）', async () => {
    const src = '---\nke_version: 0\ntitle: 我的标题\ntags: [alpha]\ncustom: x\n---\n\n正文段落\n'
    const ed = editorOf(src)
    // 复刻 EditorArea.handleExportPackage（task-35 修复版）
    const fmBlock = frontmatterBlockOf(src)
    const md = applyDocTraits(
      withFrontmatter(fmBlock ? fmBlock + ed.getMarkdown() : ed.getMarkdown(), KE_VERSION),
      captureDocTraits(src),
    )
    ed.destroy()
    // ⚠️ 漂移哨兵：复刻不会自动跟上生产，若源码组合变了必须重写本用例（否则会假绿）
    const src2 = readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8')
    const at = src2.indexOf('handleExportPackage')
    const block = src2.slice(at, at + 1500)
    for (const needle of [
      'frontmatterBlockOf(article.content)',
      'fmBlock ? fmBlock + editor.getMarkdown() : editor.getMarkdown()',
      'withFrontmatter(',
      'KE_VERSION',
      'captureDocTraits(article.content)',
      'applyDocTraits(',
    ]) {
      expect(block, `生产接线已漂移（缺 ${needle}）→ 本复刻过期，需重写 K10`).toContain(needle)
    }
    expect(block.indexOf('frontmatterBlockOf')).toBeLessThan(block.indexOf('packageExportAndSave'))
    const fm = fmBodyOf(md)
    console.log('K10-ZIP-FM: ' + JSON.stringify(fm))
    expect(fm, 'zip 载荷丢失源 frontmatter 键').toContain('title: 我的标题')
    expect(fm).toContain('tags: [alpha]')
    expect(fm).toContain('custom: x')
    expect(fm).toContain('ke_version: 1')
  })

  it('K12 zip 载荷强断言：逐字节 = 源文件（仅 ke_version 值 + 尾换行不同）', () => {
    const src = `${BOMX}---\r\nke_version: 0\r\ntitle: 标题\r\ntags: [a]\r\ncustom: x\r\n---\r\n\r\n正文段落\r\n`
    const ed = editorOf(src)
    const fmBlock = frontmatterBlockOf(src)
    const md = applyDocTraits(
      withFrontmatter(fmBlock ? fmBlock + ed.getMarkdown() : ed.getMarkdown(), KE_VERSION),
      captureDocTraits(src),
    )
    ed.destroy()
    const norm = (t: string): string => t.replace(/ke_version: \d+/, 'ke_version: <v>').replace(/[\r\n]+$/, '')
    if (norm(md) !== norm(src)) {
      const a = norm(src).split(/\r?\n/)
      const b = norm(md).split(/\r?\n/)
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) console.log(`K12-LINE ${i}: src=${JSON.stringify(a[i])} out=${JSON.stringify(b[i])}`)
      }
    }
    expect(norm(md)).toBe(norm(src))
    expect(md.startsWith(BOMX)).toBe(true)
    expect(md.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('K11 源码级：文档包接线必须使用 sourceRaw 的 frontmatter 区块', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8')
    const at = src.indexOf('handleExportPackage')
    const block = src.slice(at, at + 1200)
    console.log('K11-PKG-BLOCK: ' + JSON.stringify(block.slice(block.indexOf('const md ='), block.indexOf('const md =') + 200)))
    expect(block).toContain('frontmatterBlockOf')
  })
})
