/**
 * v1.2.0-pre.1 · 保真构造矩阵回归（F-1…F-5）
 *
 * 来源：`docs/analysis-1.1.10/source-mode.md` §4.1 的 41 构造往返实测矩阵
 * （逐字节一致 0/41；本文件固化为**目标行为**回归，初始红 = 待修清单）。
 *
 * 口径：与 `fidelity-regression.test.ts` 一致 ——
 *   正文 = stripFrontmatter(raw).content → setKeContent(editor, body) → editor.getMarkdown()
 * 文档口径额外经过 withFrontmatter + applyDocTraits（保存链路的还原步骤）。
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
import {
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
} from './extensions/TableMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import {
  applyDocTraits,
  captureDocTraits,
  KE_VERSION,
  stripFrontmatter,
  withFrontmatter,
} from './ke'
import { setKeContent } from './index'
import { keExportPayload } from './export-actions'

const EXTENSIONS = [
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  StarterKit.configure({
    link: { openOnClick: false, autolink: true },
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
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
  // F-1：任务列表（`- [x]` / `- [ ]`）—— Tiptap v3 自带 parseMarkdown + renderMarkdown
  TaskList,
  TaskItem,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

function makeEditor(): Editor {
  return new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
}

/** 正文口径往返（加载 → PM → 序列化），尾换行归一 */
function roundTripBody(raw: string): string {
  const ed = makeEditor()
  setKeContent(ed, stripFrontmatter(raw).content)
  const out = ed.getMarkdown()
  ed.destroy()
  return out
}

/** 文档口径往返（含保存链路的 frontmatter + 文件特征还原） */
function roundTripDoc(raw: string): string {
  const traits = captureDocTraits(raw)
  const ed = makeEditor()
  setKeContent(ed, stripFrontmatter(raw).content)
  const out = applyDocTraits(withFrontmatter(ed.getMarkdown(), KE_VERSION), traits)
  ed.destroy()
  return out
}

/** 尾换行归一（与既有保真测试同口径：仅首尾空白差异不计） */
function trimEnds(s: string): string {
  return s.replace(/^\s+|\s+$/g, '')
}

describe('生产接线守卫：修复不得只存在于测试夹具里', () => {
  it('生产扩展表（editor/index.ts）已注册 TaskList/TaskItem', () => {
    const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    expect(src).toMatch(/from '@tiptap\/extension-list'/)
    expect(src).toMatch(/\bTaskList\b/)
    expect(src).toMatch(/\bTaskItem\b/)
  })

  it('行内 HTML/实体 tokenizer 已启用（非仅注释）', () => {
    const src = readFileSync(join(__dirname, 'tokenizers.ts'), 'utf8')
    expect(src).toMatch(/matchHtmlTag/)
    expect(src).toMatch(/HTML_ENTITY_RE/)
    expect(src).toMatch(/MARKDOWN_HANDLED_INLINE_TAGS/)
  })
})

describe('控制组：普通正文往返（矩阵中 19 项「仅尾换行差异」的代表）', () => {
  it('# 标题 + 正文段落：内容逐字节保留', () => {
    const raw = '# 标题\n\n正文段落。\n'
    expect(trimEnds(roundTripBody(raw))).toBe('# 标题\n\n正文段落。')
  })

  it('幂等：二次往返不再变化', () => {
    const once = roundTripBody('# 标题\n\n正文段落。\n')
    expect(roundTripBody(once)).toBe(once)
  })
})

describe('F-1 任务列表：`- [x]` / `- [ ]` 往返保留（不得丢复选框状态）', () => {
  it('未勾选与已勾选同时保留', () => {
    const out = roundTripBody('- [x] 完成\n- [ ] 未完成\n')
    expect(out).toContain('- [x] 完成')
    expect(out).toContain('- [ ] 未完成')
  })

  it('大写 X 归一为小写 x（语义等价，不丢状态）', () => {
    const out = roundTripBody('- [X] 大写成勾选\n')
    expect(out).toMatch(/- \[[xX]\] 大写成勾选/)
  })

  it('与普通无序列表混排：两者都保留', () => {
    const out = roundTripBody('- 普通项\n- [x] 任务项\n')
    expect(out).toContain('- 普通项')
    expect(out).toContain('- [x] 任务项')
  })

  it('幂等', () => {
    const once = roundTripBody('- [x] 完成\n- [ ] 未完成\n')
    expect(roundTripBody(once)).toBe(once)
  })
})

describe('F-2 行内 HTML：标签原样保留（不得只留文本）', () => {
  it('span 带属性', () => {
    const raw = '正文 <span style="color:red">红</span> 结尾\n'
    const out = roundTripBody(raw)
    expect(out).toContain('<span style="color:red">')
    expect(out).toContain('</span>')
  })

  it('br 自闭合：不得丢换行导致两行粘连（`br` 属既有标准转换，不强制 raw 保真）', () => {
    const out = roundTripBody('上行<br />下行\n')
    expect(out).toContain('上行')
    expect(out).toContain('下行')
    expect(out).not.toContain('上行下行')
  })

  it('幂等', () => {
    const once = roundTripBody('正文 <span style="color:red">红</span> 结尾\n')
    expect(roundTripBody(once)).toBe(once)
  })
})

describe('F-2 属性含 `>`：引号感知（verifier 独立构造的最小复现）', () => {
  it('双引号属性内 `>` 不得截断标签、不得把闭合 `>` 转义', () => {
    const out = roundTripBody('前 <span title="a>b">x</span> 后\n')
    expect(out).toContain('<span title="a>b">')
    expect(out).not.toContain('&gt;')
  })

  it('单引号属性与多属性同样成立', () => {
    const out = roundTripBody("前 <span title='a>b' id='z'>x</span> 后\n")
    expect(out).toContain("<span title='a>b' id='z'>")
    expect(out).not.toContain('&gt;')

    const out2 = roundTripBody('前 <span title="x>y" id="z">w</span> 后\n')
    expect(out2).toContain('title="x>y"')
    expect(out2).not.toContain('&gt;')
  })

  it('块级 HTML 属性含 `>` 同样不被截断', () => {
    const out = roundTripBody('<div data-x="a>b">block</div>\n')
    expect(out).toContain('<div data-x="a>b">')
    expect(out).not.toContain('&gt;')
  })

  it('幂等', () => {
    const once = roundTripBody('前 <span title="a>b">x</span> 后\n')
    expect(roundTripBody(once)).toBe(once)
  })
})

describe('F-2/F-3 安全边界：代码与数学语境不得被误当 HTML/实体', () => {
  it('行内代码内标签保持字面（不被当 HTML 原子）', () => {
    const out = roundTripBody('示例：`<span>x</span>` 结束\n')
    expect(out).toContain('`<span>x</span>`')
  })

  it('围栏代码块内标签保持字面', () => {
    const out = roundTripBody('```html\n<span>y</span>\n```\n')
    expect(out).toContain('<span>y</span>')
    expect(out).toContain('```')
  })

  it('小于号非标签：`a < b` 与 `1 <3` 不被误判为标签（`<` 转义属既有规范化，允许 &lt;）', () => {
    const out = roundTripBody('价格 a < b 且 1 <3 与 2<3\n')
    // 关键断言：三处比较关系都还在（未被吞进 HTML 原子），`<` 是否转义成 `&lt;` 不作要求
    // —— 后者是序列化器的既有行为（属矩阵里「语义保留、字节变化」一类），非本次修复范围。
    expect(out).toMatch(/a (&lt;|<) b/)
    expect(out).toMatch(/1 (&lt;|<)3/)
    expect(out).toMatch(/2(&lt;|<)3/)
    expect(out).toContain('价格')
  })

  it('行内代码内实体保持字面', () => {
    const out = roundTripBody('实体示例：`&copy;` 结束\n')
    expect(out).toContain('`&copy;`')
  })
})

describe('F-3 HTML 实体：不得二次转义', () => {
  it('&copy; 保持为 &copy;（不得变成 &amp;copy;）', () => {
    const out = roundTripBody('&copy; 2026 AstraNota\n')
    expect(out).toContain('&copy;')
    expect(out).not.toContain('&amp;copy;')
  })

  it('数字实体与 &amp; 保持', () => {
    const out = roundTripBody('&#169; 与 &amp; 与 A & B\n')
    expect(out).toContain('&#169;')
    expect(out).toContain('&amp;')
    expect(out).not.toContain('&amp;amp;')
  })
})

describe('F-4 BOM + frontmatter：容忍 BOM，不得把 frontmatter 当正文', () => {
  it('stripFrontmatter 能识别带 BOM 的 frontmatter 并解析版本', () => {
    const raw = '\ufeff---\r\nke_version: 1\r\ntitle: 带 BOM 的文档\r\n---\r\n\r\n正文\r\n'
    const { version, content } = stripFrontmatter(raw)
    expect(version).toBe(1)
    expect(content).not.toContain('ke_version')
    expect(content).toContain('正文')
  })

  it('文档口径往返：frontmatter 正常写回、BOM 保留、正文不出现 `## ---`', () => {
    const raw = '\ufeff---\r\ntitle: 带 BOM 的文档\r\n---\r\n\r\n正文段落\r\n'
    const out = roundTripDoc(raw)
    expect(out.startsWith('\ufeff')).toBe(true)
    // 注意：title 等既有键由**后端** PUT 的 frontmatter 行级合并保留（P0-1），
    // 前端保存链路只负责写回 ke_version 与正文（此处不重复断言 title）。
    expect(out).toContain(`ke_version: ${KE_VERSION}`)
    expect(out).toContain('正文段落')
    expect(out).not.toContain('## ---')
    expect(out).not.toContain('ke_version: 1\r\n---\r\n\r\n---')
  })

  it('无 frontmatter 但带 BOM：正文不被前缀污染', () => {
    const { version, content } = stripFrontmatter('\ufeff# 标题\n\n正文\n')
    expect(version).toBe(0)
    expect(content.startsWith('# 标题')).toBe(true)
  })
})

describe('F-4/F-5 导出：KE 导出按磁盘原文还原 BOM/换行（发布验收「导出 vs 源文档 diff=0」）', () => {
  async function exportText(raw: string): Promise<string> {
    const ed = makeEditor()
    setKeContent(ed, stripFrontmatter(raw).content)
    const target = keExportPayload(ed, '导出用例', raw)
    const text = await target.blob.text()
    ed.destroy()
    return text
  }

  it('CRLF + BOM 文档：导出保持 BOM 与 CRLF', async () => {
    const raw = '\ufeff---\r\nke_version: 1\r\n---\r\n\r\n# 标题\r\n\r\n正文\r\n'
    const out = await exportText(raw)
    expect(out.startsWith('\ufeff')).toBe(true)
    expect(out).not.toMatch(/(?<!\r)\n/)
  })

  it('LF 文档：导出不引入 CR/BOM', async () => {
    const out = await exportText('---\nke_version: 1\n---\n\n# 标题\n\n正文\n')
    expect(out).not.toContain('\r')
    expect(out.startsWith('\ufeff')).toBe(false)
  })

  it('源 frontmatter 的其余键（title/tags）随 KE 导出保留', async () => {
    // 源用**过期版本号**，以验证「其余键保留 + ke_version 被更新」
    const raw = '---\r\nke_version: 3\r\ntitle: 标题\r\ntags: [a, b]\r\n---\r\n\r\n正文\r\n'
    const out = await exportText(raw)
    expect(out).toContain('title: 标题')
    expect(out).toContain('tags: [a, b]')
    expect(out).toContain(`ke_version: ${KE_VERSION}`)
    expect(out).not.toContain('ke_version: 3')
  })

  it('无 frontmatter 的源：导出不新增多余键', async () => {
    const out = await exportText('正文段落\n')
    expect(out).toContain(`ke_version: ${KE_VERSION}`)
    expect(out).not.toContain('title:')
  })

  it('调用方已接线的源码级守卫（EditorArea 传 article.content）', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'layout', 'EditorArea.tsx'), 'utf8')
    expect(src).toMatch(/keExportPayload\(editor, article\.title, article\.content\)/)
    expect(src).toMatch(/applyDocTraits\(\s*withFrontmatter\(editor\.getMarkdown\(\), KE_VERSION\),\s*captureDocTraits\(article\.content\)/)
  })
})

describe('F-5 换行风格：CRLF 文档保存后仍是 CRLF', () => {
  it('captureDocTraits 识别 CRLF', () => {
    expect(captureDocTraits('# 标题\r\n\r\n正文\r\n').eol).toBe('\r\n')
    expect(captureDocTraits('# 标题\n\n正文\n').eol).toBe('\n')
  })

  it('CRLF 文档往返后逐字节保留 CRLF（不出现裸 LF）', () => {
    const raw = '---\r\nke_version: 1\r\n---\r\n\r\n# 标题\r\n\r\n正文\r\n'
    const out = roundTripDoc(raw)
    expect(out).toContain('\r\n')
    expect(/(?<!\r)\n/.test(out)).toBe(false)
  })

  it('LF 文档往返后不引入 CR（不擅自改成 Windows 换行）', () => {
    const out = roundTripDoc('---\nke_version: 1\n---\n\n# 标题\n\n正文\n')
    expect(out).not.toContain('\r')
  })

  it('applyDocTraits 幂等', () => {
    const traits = captureDocTraits('a\r\nb\r\n')
    const once = applyDocTraits('x\ny\n', traits)
    expect(applyDocTraits(once, traits)).toBe(once)
  })
})
