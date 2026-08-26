/**
 * Markdown 保真系列缺陷回归测试（fidelity / 保真）。
 * 每个用例锁死一个缺陷编号（见 knowledge-editor-fix-checklist.md）：
 *   P0-1  withFrontmatter 合并语义（保留 title/tags/自定义键）
 *   P0-4  setKeContent 清空 undo 历史（Ctrl+Z 不跨文档串内容）
 *   P1-1  加载不触发 update（打开文档不即保存）
 *   P1-2  普通 HTML 注释 / HTML 块原样保留
 *   P1-3  已知 kind 的非法 JSON ke-* 标记原样保留
 *   P1-4  表格转义管道符 / 单元格行内样式往返
 *   P2-17 脚注条目文本含 `} -->` 不整条丢失
 *   P3-5  keJson 保留未声明的自定义字段
 *   P4-1  无 id 节点序列化生成确定性 id
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
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { KE_FIELD_ORDER, KE_VERSION, keJson, keStableId, withFrontmatter } from './ke'
import { setKeContent } from './index'

const EXTENSIONS = [
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
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

describe('P0-1：withFrontmatter 合并语义', () => {
  it('保留 title/tags/自定义键（含带 ke_version 的输入），且 ke_version 更新', () => {
    const md = [
      '---',
      'title: 我的文档',
      'tags: [a, b]',
      'custom_key: xyz',
      'ke_version: 3',
      '---',
      '',
      '# 一级标题',
      '',
      '正文。',
    ].join('\n')
    const out = withFrontmatter(md, KE_VERSION)
    // 所有键逐字节保留
    expect(out).toContain('title: 我的文档')
    expect(out).toContain('tags: [a, b]')
    expect(out).toContain('custom_key: xyz')
    expect(out).toContain(`ke_version: ${KE_VERSION}`)
    expect(out).not.toContain('ke_version: 3')
    // 正文保留
    expect(out).toContain('# 一级标题')
    expect(out).toContain('正文。')
  })

  it('无 ke_version 的 frontmatter：新增版本键并保留其余字段', () => {
    const md = '---\nauthor: 张三\ntitle: 标题\n---\n\n正文'
    const out = withFrontmatter(md)
    expect(out).toContain('author: 张三')
    expect(out).toContain('title: 标题')
    expect(out).toContain(`ke_version: ${KE_VERSION}`)
    expect(out).toContain('正文')
  })

  it('无 frontmatter 时正常生成版本头（不破坏现有测试语义）', () => {
    expect(withFrontmatter('正文内容')).toBe(`---\nke_version: ${KE_VERSION}\n---\n\n正文内容`)
  })

  it('幂等：重复包装不叠加版本头', () => {
    const wrapped = withFrontmatter('正文内容')
    expect(withFrontmatter(wrapped)).toBe(wrapped)
  })
})

describe('P0-4 + P1-1：setKeContent 清空历史且不触发加载 update', () => {
  it('setContent(A) → setKeContent(editor,B) 后 can().undo() 为 false', () => {
    const ed = makeEditor('')
    ed.commands.setContent('A', { contentType: 'markdown', emitUpdate: false })
    expect(ed.can().undo()).toBe(true) // 前置：A 已入历史
    setKeContent(ed, 'B')
    expect(ed.can().undo()).toBe(false) // 加载后历史被清空
    ed.destroy()
  })

  it('加载内容不触发 update（计数为 0），用户输入后 can().undo() 恢复 true', () => {
    let updates = 0
    const ed = makeEditor('')
    ed.on('update', () => {
      updates += 1
    })
    setKeContent(ed, '第一章')
    expect(updates).toBe(0) // 加载不触发保存
    expect(ed.can().undo()).toBe(false)
    // 用户输入：can().undo() 恢复
    ed.commands.insertContent('后续')
    expect(ed.can().undo()).toBe(true)
    expect(updates).toBe(1) // 输入触发一次更新
    ed.destroy()
  })

  it('加载 B 后不得把 A 内容灌进来（undo 不可用）', () => {
    const ed = makeEditor('')
    ed.commands.setContent('A', { contentType: 'markdown', emitUpdate: false })
    setKeContent(ed, 'B')
    expect(ed.getMarkdown()).toContain('B')
    expect(ed.getMarkdown()).not.toContain('A')
    ed.destroy()
  })
})

describe('P1-2：普通 HTML 注释 / HTML 块原样保留', () => {
  it('块级普通注释 <!-- ... --> round-trip 原文不丢', () => {
    const md = '段落开始。\n\n<!-- 普通注释 -->\n\n段落结束。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- 普通注释 -->')
    expect(back).toContain('段落开始')
    expect(back).toContain('段落结束')
    ed.destroy()
  })

  it('HTML 块 <div class="x">内容</div> round-trip 标签与内容均保留', () => {
    const md = '前文。\n\n<div class="x">内容</div>\n\n后文。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<div class="x">内容</div>')
    expect(back).toContain('前文')
    expect(back).toContain('后文')
    ed.destroy()
  })

  it('行内普通注释 round-trip 保留（不丢、不吞）', () => {
    const md = '文本 <!-- 普通注释 --> 结束'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('文本 <!-- 普通注释 --> 结束')
    ed.destroy()
  })

  it('不影响标准 inline 格式与 ke-* 标记', () => {
    const md = '这是<em>斜体</em>与<a href="http://x">链接</a>。\n\n<!-- ke-note: {"kind":"note","id":"n1","content":"补充","color":"blue"} -->'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('*斜体*') // em → italic mark（不被块级 html 保真吞掉）
    expect(back).toContain('ke-note') // ke-* 注释仍走专属 tokenizer
    ed.destroy()
  })
})

describe('P1-3：已知 kind 的非法 JSON ke-* 标记原样保留', () => {
  it('块级已知 kind + 损坏 JSON 保留原文（ke-attach）', () => {
    const md = '前文。\n\n<!-- ke-attach: {bad json} -->\n\n后文。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-attach: {bad json} -->')
    expect(back).toContain('前文')
    expect(back).toContain('后文')
    ed.destroy()
  })

  it('已知 kind + 括号不匹配的损坏 JSON 保留原文（ke-module）', () => {
    const md = '正文。\n\n<!-- ke-module: {"name":"x" -->\n\n结尾。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-module: {"name":"x" -->')
    expect(back).toContain('正文')
    expect(back).toContain('结尾')
    ed.destroy()
  })

  it('能正常解析的已知 kind 仍走专属 tokenizer（不受影响）', () => {
    const md = '<!-- ke-attach: {"kind":"attach","id":"a1","type":"image","src":"Attachments/images/x.png"} -->'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('ke-attach')
    const attach = blocksOf(ed.getJSON(), 'attach')
    expect(attach).toHaveLength(1)
    expect(attach[0]?.attrs?.src).toBe('Attachments/images/x.png')
    ed.destroy()
  })
})

describe('P1-4：表格保真（转义管道符 / 单元格行内样式）', () => {
  it('转义管道符 `| a | b \\| c |` 往返列数不变', () => {
    const md = '| a | b \\| c |\n| --- | --- |\n| 1 | 2 \\| 3 |'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('| a | b \\| c |')
    expect(back).toContain('| 1 | 2 \\| 3 |')
    // 重新解析：列数保持 2，第二列内容含字面量管道符
    const ed2 = makeEditor(back)
    const table = blocksOf(ed2.getJSON(), 'table')[0]
    const headerRow = table?.content?.[0]
    expect(headerRow?.content).toHaveLength(2)
    expect(headerRow?.content?.[1]?.content?.[0]?.content?.[0]?.text).toBe('b | c')
    ed.destroy()
    ed2.destroy()
  })

  it('单元格内行内样式（粗体/链接/公式/斜体）往返保留', () => {
    const md = '| **加粗** | [链接](http://x) |\n| --- | --- |\n| $E=mc^2$ | *斜体* |'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('**加粗**')
    expect(back).toContain('[链接](http://x)')
    expect(back).toContain('$E=mc^2$')
    expect(back).toContain('*斜体*')
    // 解析为真正的 mark/节点而非纯文本（表头首列是加粗）
    const table = blocksOf(ed.getJSON(), 'table')[0]
    const headerRow = table?.content?.[0]
    expect(headerRow?.content?.[0]?.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('bold')
    expect(headerRow?.content?.[1]?.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('link')
    ed.destroy()
  })

  it('合并/拆分单元格在扩展层禁用（GFM 往返不保留 colspan/rowspan）', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const ed = makeEditor(md)
    expect(ed.can().mergeCells()).toBe(false)
    expect(ed.can().splitCell()).toBe(false)
    ed.destroy()
  })
})

describe('P2-17：脚注条目文本含 `}`（甚至紧跟 ` -->）不整条丢失', () => {
  it('条目文本含 `}` 时 round-trip 保留整条脚注', () => {
    const md = [
      '正文段落。',
      '',
      '<!-- ke-footnotes:start -->',
      '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"见 } 括号"} -->',
      '<!-- ke-footnotes:end -->',
    ].join('\n')
    const ed = makeEditor(md)
    const fn = blocksOf(ed.getJSON(), 'footnotes')[0]
    expect(fn?.attrs?.items).toEqual([expect.objectContaining({ id: 'f1', n: 1, text: '见 } 括号' })])
    const back = ed.getMarkdown()
    expect(back).toContain('ke-footnote-item')
    expect(back).toContain('见 } 括号')
    ed.destroy()
  })

  it('条目文本含 `} -->` 时 round-trip 保留整条脚注（P2-17 核心）', () => {
    const md = [
      '正文段落。',
      '',
      '<!-- ke-footnotes:start -->',
      '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"见 } --> 括号"} -->',
      '<!-- ke-footnotes:end -->',
    ].join('\n')
    const ed = makeEditor(md)
    const fn = blocksOf(ed.getJSON(), 'footnotes')[0]
    // 整条脚注不再丢失
    expect(fn?.attrs?.items).toEqual([expect.objectContaining({ id: 'f1', n: 1, text: '见 } --> 括号' })])
    const back = ed.getMarkdown()
    expect(back).toContain('ke-footnote-item')
    expect(back).toContain('见 } --&gt; 括号'.replace('&gt;', '>')) // 原文保留（text:见 } --> 括号）
    // 二次打开：条目仍存在且不重复
    const ed2 = makeEditor(back)
    const fn2 = blocksOf(ed2.getJSON(), 'footnotes')[0]
    expect(fn2?.attrs?.items).toHaveLength(1)
    ed.destroy()
    ed2.destroy()
  })
})

describe('P3-5：keJson 保留未声明的自定义字段', () => {
  it('未知键 extra 追加到输出', () => {
    const out = keJson({ id: 'n1', extra: 'x', color: 'blue' }, 'note', KE_FIELD_ORDER.note)
    expect(out).toContain('"extra":"x"')
    expect(out).toContain('"color":"blue"')
    expect(out).toContain('"id":"n1"')
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed.extra).toBe('x')
    expect(parsed.kind).toBe('note')
  })

  it('kind 不重复输出、空值仍剔除', () => {
    const out = keJson({ id: 'n1', title: '', nested: {}, extra: 0 }, 'note', KE_FIELD_ORDER.note)
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['extra', 'id', 'kind']) // 0 保留, 空串删除
    expect(parsed.extra).toBe(0)
  })
})

describe('P4-1：无 id 节点生成确定性 id', () => {
  it('同一内容两次序列化 id 一致', () => {
    const md = '<!-- ke-attach: {"kind":"attach","type":"image","src":"Attachments/images/x.png"} -->'
    const ed1 = makeEditor(md)
    const back1 = ed1.getMarkdown()
    const ed2 = makeEditor(md)
    const back2 = ed2.getMarkdown()
    expect(back1).toBe(back2)
    const idRe = /"id":"([^"]+)"/.exec(back1)
    expect(idRe).toBeTruthy()
    ed1.destroy()
    ed2.destroy()
  })

  it('keStableId 对同一字段集合稳定，随内容变化', () => {
    const a = keStableId({ src: 'Attachments/images/x.png', title: '图' }, ['src', 'title'])
    const b = keStableId({ src: 'Attachments/images/x.png', title: '图' }, ['src', 'title'])
    const c = keStableId({ src: 'Attachments/images/y.png', title: '图' }, ['src', 'title'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('P3-16：脚注光标零宽空格 U+200B 不写入文件', () => {
  it('withFrontmatter 剥除保存内容中的零宽空格', () => {
    const md = '段落正文\u200b\n\n<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->'
    const out = withFrontmatter(md, KE_VERSION)
    expect(out.includes('\u200b')).toBe(false)
    // 剥除只影响保存输出，不影响解析后的正文（原文用户输入场景由编辑器负责）
    expect(out).toContain('段落正文')
  })

  it('脚注序列化往返不出现零宽空格', () => {
    const md = '正文<!-- ke-footnote: {"id":"f1","n":1} -->\u200b'
    const ed = makeEditor(md)
    // 真实保存链路：withFrontmatter(ed.getMarkdown()) —— 剥除零宽空格
    const back = withFrontmatter(ed.getMarkdown(), KE_VERSION)
    ed.destroy()
    expect(back.includes('\u200b')).toBe(false)
    expect(back).toContain('<!-- ke-footnote:')
  })
})
