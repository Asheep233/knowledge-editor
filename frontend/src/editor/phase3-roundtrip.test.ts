/**
 * Phase 3 完整往返测试。
 * 覆盖：
 * - 基础 Markdown：标题/文本/粗体/斜体/删除线/列表/引用/代码块/链接/图片/表格
 * - KE 节点：Formula / InfoBlock(note) / Footnote + footnotes 区域 / Module / Attachment / Video
 * - 未知 ke-* 标记 GenericFallback（块级 + 行内）原样保留
 * - 零漂移：多次「打开 → 序列化」输出完全一致
 * - frontmatter ke_version：strip / wrap 幂等
 * - insertFootnote：维护独立 footnotes 节点（不再生成 ## 参考）
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
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
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { KE_VERSION, stripFrontmatter, withFrontmatter } from './ke'
import type { JSONContent } from '@tiptap/core'

// 顺序关键：fallback 必须最先注册（@tiptap/markdown 通过 marked.use + unshift 注册，
// 后注册的 tokenizer 先执行）。fallback 最先注册 → 最后执行，具体 ke-* tokenizer 优先；
// 同时 fallback 正则含负向前瞻排除已知 kind，双保险。
const EXTENSIONS = [
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

describe('Phase 3：基础 Markdown 往返', () => {
  it('表格（GFM）解析为 table 节点并可往返', () => {
    const md = '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const table = blocksOf(json, 'table')
    expect(table.length).toBe(1)
    // 首行是 tableHeader，后续是 tableCell
    const firstRow = (table[0].content ?? [])[0]
    expect(firstRow?.type).toBe('tableRow')
    expect((firstRow?.content ?? [])[0]?.type).toBe('tableHeader')
    const back = ed.getMarkdown()
    expect(back).toContain('| 名称 | 数量 |')
    expect(back).toContain('| 苹果 | 3 |')
    expect(back).toContain('| 香蕉 | 5 |')
    ed.destroy()
  })

  it('链接与图片（StarterKit 内置）往返', () => {
    const md = '访问[示例站点](https://example.com)与图片：\n\n![架构图](Attachments/images/arch.png)'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('[示例站点](https://example.com)')
    expect(back).toContain('![架构图](Attachments/images/arch.png)')
    ed.destroy()
  })

  it('粗体/斜体/删除线/列表/引用往返', () => {
    const md = [
      '这是**粗体**、*斜体*、~~删除线~~文本。',
      '',
      '- 无序一',
      '- 无序二',
      '',
      '1. 有序一',
      '2. 有序二',
      '',
      '> 引用一段话',
    ].join('\n')
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('**粗体**')
    expect(back).toContain('*斜体*')
    expect(back).toContain('~~删除线~~')
    expect(back).toContain('- 无序一')
    expect(back).toContain('1. 有序一')
    expect(back).toContain('> 引用一段话')
    ed.destroy()
  })
})

describe('Phase 3：footnotes 独立节点', () => {
  it('脚注区域解析为 footnotes 节点，往返不重复生成', () => {
    const md = [
      '正文段落。',
      '',
      '<!-- ke-footnotes:start -->',
      '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"第一条脚注"} -->',
      '<!-- ke-footnote-item: {"id":"f2","n":2,"text":"第二条脚注"} -->',
      '<!-- ke-footnotes:end -->',
      '',
    ].join('\n')
    const ed = makeEditor(md)
    const fn = blocksOf(ed.getJSON(), 'footnotes')
    expect(fn.length).toBe(1)
    expect(fn[0]?.attrs?.items).toEqual([
      { id: 'f1', n: 1, text: '第一条脚注' },
      { id: 'f2', n: 2, text: '第二条脚注' },
    ])
    const back = ed.getMarkdown()
    expect(back).toContain('ke-footnotes:start')
    expect(back).toContain('ke-footnote-item')
    // 重新打开：仍只有一个 footnotes 节点（不重复生成）
    const ed2 = makeEditor(back)
    expect(blocksOf(ed2.getJSON(), 'footnotes').length).toBe(1)
    expect(blocksOf(ed2.getJSON(), 'footnotes')[0]?.attrs?.items).toHaveLength(2)
    ed.destroy()
    ed2.destroy()
  })

  it('正文出现「## 参考」标题不影响脚注', () => {
    const md = [
      '## 参考',
      '',
      '正文中的普通「参考」小节。',
      '',
      '<!-- ke-footnotes:start -->',
      '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"真实脚注"} -->',
      '<!-- ke-footnotes:end -->',
      '',
    ].join('\n')
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    // 标题保留为普通 heading；脚注区域独立存在且条目完整
    expect(back).toContain('## 参考')
    expect(back).toContain('ke-footnotes:start')
    expect(back).toContain('"text":"真实脚注"')
    const ed2 = makeEditor(back)
    expect(blocksOf(ed2.getJSON(), 'footnotes').length).toBe(1)
    ed.destroy()
    ed2.destroy()
  })

  it('insertFootnote 维护 footnotes 节点，不再生成「## 参考」栏', () => {
    const ed = makeEditor('第一段内容。\n\n第二段内容。')
    ed.commands.setTextSelection(3)
    const ok = ed.commands.insertFootnote('第一条注释')
    expect(ok).toBe(true)

    let json = ed.getJSON()
    // 不再生成 ## 参考 标题
    const refHeading = blocksOf(json, 'heading').find(
      (n) => (n.content ?? []).some((t) => t.type === 'text' && t.text === '参考'),
    )
    expect(refHeading).toBeUndefined()
    const fn = blocksOf(json, 'footnotes')
    expect(fn.length).toBe(1)
    expect(fn[0]?.attrs?.items).toEqual([expect.objectContaining({ n: 1, text: '第一条注释' })])

    // 第二次插入：编号递增，追加到同一 footnotes 节点
    ed.commands.setTextSelection(1)
    ed.commands.insertFootnote('第二条注释')
    json = ed.getJSON()
    const fn2 = blocksOf(json, 'footnotes')
    expect(fn2.length).toBe(1)
    expect(fn2[0]?.attrs?.items).toHaveLength(2)
    expect(fn2[0]?.attrs?.items).toEqual([
      expect.objectContaining({ n: 1 }),
      expect.objectContaining({ n: 2, text: '第二条注释' }),
    ])

    // 上标引用存在
    const refs = (json.content ?? [])
      .flatMap((n) => n.content ?? [])
      .filter((n) => n.type === 'footnote')
    expect(refs.length).toBe(2)

    // Markdown 往返：区域唯一，重新打开不重复
    const back = ed.getMarkdown()
    expect(back).toContain('ke-footnotes:start')
    const ed2 = makeEditor(back)
    expect(blocksOf(ed2.getJSON(), 'footnotes').length).toBe(1)
    expect(blocksOf(ed2.getJSON(), 'footnotes')[0]?.attrs?.items).toHaveLength(2)
    ed.destroy()
    ed2.destroy()
  })
})

describe('Phase 3：InfoBlock 通用信息块', () => {
  it('content 字段往返（v0.7.0：迁移为文本子节点，输出包裹格式）', () => {
    const md = '<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"green","content":"重要内容"} -->'
    const ed = makeEditor(md)
    const note = blocksOf(ed.getJSON(), 'note')[0]
    expect((note?.content ?? []).map((n) => n.text ?? '').join('')).toBe('重要内容')
    expect(note?.attrs?.color).toBe('green')
    expect(note?.attrs?.title).toBe('要点')
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-note:')
    expect(back).toContain('重要内容')
    expect(back).toContain('<!-- /ke-note -->')
    expect(back).not.toContain('"content"')
    ed.destroy()
  })

  it('旧文档 text 字段迁移为子节点（兼容 v0）', () => {
    const md = '<!-- ke-note: {"kind":"note","id":"n2","text":"旧内容","color":"blue"} -->'
    const ed = makeEditor(md)
    const note = blocksOf(ed.getJSON(), 'note')[0]
    expect((note?.content ?? []).map((n) => n.text ?? '').join('')).toBe('旧内容')
    expect(note?.attrs?.color).toBe('blue')
    const back = ed.getMarkdown()
    expect(back).toContain('旧内容')
    expect(back).not.toContain('"text"')
    ed.destroy()
  })
})

describe('Phase 3：未知扩展 GenericFallback', () => {
  it('块级未知 ke-* 标记保留原样', () => {
    const md = '前文。\n\n<!-- ke-futureblock: {"future":true} -->\n\n后文。'
    const ed = makeEditor(md)
    const fb = blocksOf(ed.getJSON(), 'keFallback')
    expect(fb.length).toBe(1)
    expect(fb[0]?.attrs?.raw).toBe('<!-- ke-futureblock: {"future":true} -->')
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-futureblock: {"future":true} -->')
    expect(back).toContain('前文')
    expect(back).toContain('后文')
    ed.destroy()
  })

  it('行内未知 ke-* 标记保留原样', () => {
    const md = '文本 <!-- ke-future-inline: {"x":1} --> 结束'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-future-inline: {"x":1} -->')
    expect(back).toContain('文本')
    expect(back).toContain('结束')
    ed.destroy()
  })

  it('未知标记多次往返不漂移', () => {
    const md = '前文。\n\n<!-- ke-unknown: {"a":{"b":[1,2]}} -->\n\n后文。'
    const ed = makeEditor(md)
    const back1 = ed.getMarkdown()
    const ed2 = makeEditor(back1)
    const back2 = ed2.getMarkdown()
    expect(back2).toBe(back1)
    ed.destroy()
    ed2.destroy()
  })
})

describe('Phase 3：frontmatter ke_version', () => {
  it('stripFrontmatter 解析版本并剥离正文', () => {
    expect(stripFrontmatter('---\nke_version: 1\n---\n\n正文内容').version).toBe(1)
    expect(stripFrontmatter('---\nke_version: 1\n---\n\n正文内容').content).toBe('正文内容')
    expect(stripFrontmatter('无 frontmatter 的文档').version).toBe(0)
    expect(stripFrontmatter('无 frontmatter 的文档').content).toBe('无 frontmatter 的文档')
  })

  it('withFrontmatter 写入版本头且幂等', () => {
    const wrapped = withFrontmatter('正文内容')
    expect(wrapped).toBe(`---\nke_version: ${KE_VERSION}\n---\n\n正文内容`)
    // 幂等：重复包装不叠加
    expect(withFrontmatter(wrapped)).toBe(wrapped)
  })

  it('frontmatter 不进入 Document Model（编辑器内为纯正文）', () => {
    const md = '---\nke_version: 1\n---\n\n# 标题\n\n正文。'
    const ed = makeEditor(stripFrontmatter(md).content)
    const json = ed.getJSON()
    expect(blocksOf(json, 'heading').length).toBe(1)
    expect(ed.getMarkdown()).toContain('# 标题')
    ed.destroy()
  })
})

describe('Phase 3：完整文档往返与零漂移', () => {
  it('包含全部节点类型的文档：往返一致 + 二次序列化零漂移', () => {
    const md = [
      '# 一级标题',
      '',
      '## 二级标题',
      '',
      '这是**粗体**、*斜体*、~~删除线~~ 与 [链接](https://example.com)。',
      '',
      '- 无序项一',
      '- 无序项二',
      '',
      '1. 有序项一',
      '2. 有序项二',
      '',
      '> 引用内容',
      '',
      '行内公式 $E=mc^2$，块级公式：',
      '',
      '$$',
      '\\int_0^1 x \\, dx',
      '$$',
      '',
      '| 列A | 列B |',
      '| --- | --- |',
      '| 值1 | 值2 |',
      '',
      '![图片说明](Attachments/images/img.png)',
      '',
      '<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"Attachments/files/doc.pdf","title":"文档"} -->',
      '',
      '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4","title":"演示"} -->',
      '',
      '<!-- ke-module: {"kind":"module","id":"m1","name":"步骤","params":{"a":1}} -->',
      '',
      '脚注引用<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->在此。',
      '',
      '<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"yellow","content":"重要内容"} -->',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '<!-- ke-futureblock: {"future":true} -->',
      '',
      '<!-- ke-footnotes:start -->',
      '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"脚注内容"} -->',
      '<!-- ke-footnotes:end -->',
      '',
    ].join('\n')

    // Markdown ↓ 导入编辑器
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const blockTypes = (json.content ?? []).map((n) => n.type)
    for (const t of ['heading', 'mathBlock', 'table', 'attach', 'video', 'module', 'note', 'codeBlock', 'keFallback', 'footnotes']) {
      expect(blockTypes).toContain(t)
    }
    const inlineTypes = (json.content ?? []).flatMap((n) => n.content ?? []).map((n) => n.type)
    expect(inlineTypes).toContain('math')
    expect(inlineTypes).toContain('footnote')

    // 修改（模拟一次编辑）：切换一个标题级别
    const heading = blocksOf(json, 'heading')[0]
    expect(heading?.attrs?.level).toBe(1)

    // ↓ 保存
    const back1 = ed.getMarkdown()
    expect(back1).toContain('# 一级标题')
    expect(back1).toContain('**粗体**')
    expect(back1).toContain('$E=mc^2$')
    expect(back1).toContain('| 值1 | 值2 |')
    expect(back1).toContain('![图片说明](Attachments/images/img.png)')
    expect(back1).toContain('ke-attach')
    expect(back1).toContain('ke-video')
    expect(back1).toContain('ke-module')
    expect(back1).toContain('ke-footnote')
    expect(back1).toContain('<!-- ke-note:')
    expect(back1).toContain('重要内容')
    expect(back1).toContain('<!-- /ke-note -->')
    expect(back1).toContain('const a = 1')
    expect(back1).toContain('ke-futureblock')
    expect(back1).toContain('ke-footnotes:start')

    // ↓ 重新打开
    const ed2 = makeEditor(back1)
    // 二次序列化：零漂移（输出与首次保存完全一致）
    const back2 = ed2.getMarkdown()
    expect(back2).toBe(back1)

    // 第三次往返仍稳定
    const ed3 = makeEditor(back2)
    expect(ed3.getMarkdown()).toBe(back2)
    ed.destroy()
    ed2.destroy()
    ed3.destroy()
  })
})
