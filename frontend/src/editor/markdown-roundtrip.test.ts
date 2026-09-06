/**
 * Markdown <-> Document Model 往返测试（约束 1 数据流验证）。
 * 覆盖：行内/块级公式、KE 注释节点（note/module/attach/video）、
 * 未知标记保留、混合文档往返一致性。
 */
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { parseFootnoteN } from '../components/editor/nodeviews/FootnoteNodeView'
import type { JSONContent } from '@tiptap/core'
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

function findBlock(json: JSONContent, type: string): JSONContent | undefined {
  return (json.content ?? []).find((n) => n.type === type)
}

describe('Markdown <-> Document Model 往返', () => {
  it('行内公式 $...$ 解析为 math 节点并可往返', () => {
    const md = '质量能量关系：$E=mc^2$，其中 c 为光速。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    // math 是行内节点，实际在 paragraph 的 content 里
    const inline = (json.content ?? [])
      .flatMap((n) => n.content ?? [])
      .find((n) => n.type === 'math') as unknown as { attrs?: { latex?: string } } | undefined
    expect(inline).toBeTruthy()
    expect(inline?.attrs?.latex).toBe('E=mc^2')
    const back = ed.getMarkdown()
    expect(back).toContain('$E=mc^2$')
  })

  it('块级公式 $$...$$ 解析为 mathBlock 节点并可往返', () => {
    const md = '推导如下：\n\n$$\nE = mc^2\n$$\n\n证毕。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const block = findBlock(json, 'mathBlock')
    expect(block).toBeTruthy()
    expect((block?.attrs?.latex as string).replace(/\s+/g, '')).toBe('E=mc^2')
    const back = ed.getMarkdown()
    expect(back).toContain('$$\nE = mc^2\n$$')
  })

  it('ke-note 旧自闭合格式：内容迁移为文本子节点，往返输出包裹格式', () => {
    const md = '正文第一段。\n\n<!-- ke-note: {"kind":"note","id":"n1","content":"这是注释","color":"yellow"} -->\n\n正文第二段。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const note = findBlock(json, 'note')
    expect(note).toBeTruthy()
    expect(note?.attrs?.color).toBe('yellow')
    // 旧 content 属性迁移为文本子节点（不再存 attrs.content，v0.7.0）
    const text = (note?.content ?? []).map((n) => n.text ?? '').join('')
    expect(text).toBe('这是注释')
    const back = ed.getMarkdown()
    // 往返输出新包裹格式：块内内容在开始/结束标记之间
    expect(back).toContain('<!-- ke-note:')
    expect(back).toContain('这是注释')
    expect(back).toContain('<!-- /ke-note -->')
    expect(back).not.toContain('"content"')
  })

  it('ke-note label 字段：徽章文字可自定义并可往返；旧文档缺省为空', () => {
    const md = '正文。\n\n<!-- ke-note: {"kind":"note","id":"n2","label":"提示","content":"注意这里","color":"red"} -->\n\n结尾。'
    const ed = makeEditor(md)
    const note = findBlock(ed.getJSON(), 'note')
    expect(note?.attrs?.label).toBe('提示')
    expect((note?.content ?? []).map((n) => n.text ?? '').join('')).toBe('注意这里')
    const back = ed.getMarkdown()
    expect(back).toContain('"label":"提示"')
    // 旧文档无 label：解析为默认空串（NodeView 显示时兜底「信息」）
    const old = makeEditor('<!-- ke-note: {"kind":"note","id":"n3","content":"旧","color":"blue"} -->')
    const oldNote = findBlock(old.getJSON(), 'note')
    expect(oldNote?.attrs?.label).toBe('')
    old.destroy()
    ed.destroy()
  })

  it('ke-note 包裹格式：块内文字为 PM 子节点，可插入脚注上标并往返', () => {
    const md = '正文。\n\n<!-- ke-note: {"kind":"note","id":"n4","title":"要点","color":"green"} -->\n块内文字。\n<!-- /ke-note -->\n\n结尾。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const note = findBlock(json, 'note')
    expect(note).toBeTruthy()
    expect((note?.content ?? []).map((n) => n.text ?? '').join('')).toBe('块内文字。')

    // 定位光标到块内文字末尾（doc 偏移：paragraph '正文。' 占 [1,5)，note 内文本占 [6,11)）
    expect(ed.commands.setTextSelection(11)).toBe(true)
    expect(ed.commands.insertFootnote('块内注释')).toBe(true)
    const json2 = ed.getJSON()
    const note2 = findBlock(json2, 'note')
    // 块内出现 footnote 上标，块本身未被删除
    expect(note2).toBeTruthy()
    expect((note2?.content ?? []).find((n) => n.type === 'footnote')).toBeTruthy()
    // 底部 footnotes 节点同步维护条目
    const fnBlock = (json2.content ?? []).find((n) => n.type === 'footnotes')
    expect((fnBlock?.attrs?.items as unknown[] | undefined)?.length).toBe(1)

    // 往返：包裹格式内保留脚注标记
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-note:')
    expect(back).toContain('<!-- /ke-note -->')
    expect(back).toContain('ke-footnote')
    ed.destroy()
  })

  it('ke-attach 注释解析为 attach 节点（workspace 相对路径 src）', () => {
    const md = '配图如下：\n\n<!-- ke-attach: {"kind":"attach","id":"a1","type":"image","src":"Attachments/images/1710000000000-abc.png","title":"架构图"} -->'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const attach = findBlock(json, 'attach')
    expect(attach).toBeTruthy()
    expect(attach?.attrs?.src).toBe('Attachments/images/1710000000000-abc.png')
    expect(attach?.attrs?.type).toBe('image')
    const back = ed.getMarkdown()
    expect(back).toContain('ke-attach')
    expect(back).toContain('Attachments/images/1710000000000-abc.png')
  })

  it('ke-module 注释解析为 module 节点（params 嵌套 JSON 不截断）', () => {
    const md = '<!-- ke-module: {"kind":"module","id":"m1","name":"部署步骤","version":2,"params":{"host":"127.0.0.1","ports":[8080,8443]}} -->'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const mod = findBlock(json, 'module')
    expect(mod).toBeTruthy()
    expect(mod?.attrs?.name).toBe('部署步骤')
    expect(mod?.attrs?.version).toBe(2)
    expect((mod?.attrs?.params as Record<string, unknown> | undefined)?.host).toBe('127.0.0.1')
    const back = ed.getMarkdown()
    expect(back).toContain('"ports":[8080,8443]')
  })

  it('ke-video 注释解析为 video 节点并可往返', () => {
    const md = '演示：\n\n<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/1710000000000-demo.mp4","title":"演示视频"} -->'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const vid = findBlock(json, 'video')
    expect(vid).toBeTruthy()
    expect(vid?.attrs?.src).toBe('Attachments/videos/1710000000000-demo.mp4')
    const back = ed.getMarkdown()
    expect(back).toContain('ke-video')
  })

  it('ke-footnote 行内注释解析为 footnote 节点并可往返', () => {
    const md = '这是正文<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->带脚注。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const inline = (json.content ?? [])
      .flatMap((n) => n.content ?? [])
      .find((n) => n.type === 'footnote') as unknown as { attrs?: { id?: string; n?: number } } | undefined
    expect(inline).toBeTruthy()
    expect(inline?.attrs?.id).toBe('f1')
    expect(inline?.attrs?.n).toBe(1)
    const back = ed.getMarkdown()
    expect(back).toContain('ke-footnote')
    expect(back).toContain('"n":1')
  })

  it('insertFootnote 命令：插入上标引用并维护独立 footnotes 节点', () => {
    const ed = makeEditor('第一段内容。\n\n第二段内容。')
    ed.commands.setTextSelection(5) // 光标置于第一段中间
    const ok1 = ed.commands.insertFootnote('这是第一条注释')
    expect(ok1).toBe(true)

    let json = ed.getJSON() as unknown as JSONContent
    // Phase 3：不再生成「## 参考」栏，脚注维护为独立 footnotes 节点
    const refHeading = (json.content ?? []).find(
      (n) => n.type === 'heading' && (n.content ?? []).some((t) => t.type === 'text' && t.text === '参考'),
    )
    expect(refHeading).toBeUndefined()
    const fn = (json.content ?? []).find((n) => n.type === 'footnotes')
    expect(fn).toBeTruthy()
    expect((fn?.attrs as { items?: Array<{ n: number; text: string }> } | undefined)?.items?.[0]).toEqual(
      expect.objectContaining({ n: 1, text: '这是第一条注释' }),
    )

    // 第二条注释：编号递增，追加到同一 footnotes 节点
    ed.commands.setTextSelection(1)
    const ok2 = ed.commands.insertFootnote('第二条注释')
    expect(ok2).toBe(true)
    json = ed.getJSON()
    const fn2 = (json.content ?? []).find((n) => n.type === 'footnotes')
    expect((fn2?.attrs as { items?: unknown[] } | undefined)?.items).toHaveLength(2)

    // 上标引用节点存在且编号正确（第二次插入在文首，遍历按文档顺序，需按值查找）
    const footnotes = (json.content ?? [])
      .flatMap((n) => n.content ?? [])
      .filter((n) => n.type === 'footnote')
    expect(footnotes.length).toBe(2)
    expect(footnotes.some((f) => (f.attrs as { n?: number } | undefined)?.n === 1)).toBe(true)
    expect(footnotes.some((f) => (f.attrs as { n?: number } | undefined)?.n === 2)).toBe(true)

    ed.destroy()
  })

  it('insertPlainFootnote 命令：纯 Markdown 样式，正文上标 + 文末 # 参考 与 [n] 段落', () => {
    const ed = makeEditor('正文第一段。')
    ed.commands.setTextSelection(5)
    const ok1 = ed.commands.insertPlainFootnote('第一条参考')
    expect(ok1).toBe(true)
    let json = ed.getJSON() as unknown as JSONContent
    // 正文光标处插入上标 [1]（与 insertFootnote 相同）
    const refs1 = (json.content ?? []).flatMap((n) => n.content ?? []).filter((n) => n.type === 'footnote')
    expect(refs1).toHaveLength(1)
    expect((refs1[0].attrs as { n?: number } | undefined)?.n).toBe(1)
    // 文末：# 参考 标题 + [1] 段落；不创建 footnotes 块级节点
    const heading = (json.content ?? []).filter((n) => n.type === 'heading')
    expect(heading).toHaveLength(1)
    expect((heading[0].content?.[0] as { text?: string } | undefined)?.text).toBe('参考')
    const paras = (json.content ?? []).filter((n) => n.type === 'paragraph')
    expect((paras[paras.length - 1]?.content?.[0] as { text?: string } | undefined)?.text).toBe('[1] 第一条参考')
    expect((json.content ?? []).some((n) => n.type === 'footnotes')).toBe(false)

    // 第二次：文末已是 [n] 开头段落 → 不重复新建 # 参考，编号递增
    ed.commands.setTextSelection(1)
    const ok2 = ed.commands.insertPlainFootnote('第二条参考')
    expect(ok2).toBe(true)
    json = ed.getJSON()
    const heading2 = (json.content ?? []).filter((n) => n.type === 'heading')
    expect(heading2).toHaveLength(1)
    const refs2 = (json.content ?? []).flatMap((n) => n.content ?? []).filter((n) => n.type === 'footnote')
    expect(refs2).toHaveLength(2)
    expect(refs2.some((f) => (f.attrs as { n?: number } | undefined)?.n === 2)).toBe(true)
    const paras2 = (json.content ?? []).filter((n) => n.type === 'paragraph')
    expect((paras2[paras2.length - 1]?.content?.[0] as { text?: string } | undefined)?.text).toBe('[2] 第二条参考')

    // 序列化：正文上标为 ke-footnote 注释；文末为标准 Markdown（方括号转义为 \[n\]，渲染等价）
    const md = ed.getMarkdown()
    expect(md).toContain('ke-footnote')
    expect(md).toContain('# 参考')
    expect(md).toContain('\\[1\\] 第一条参考')
    expect(md).toContain('\\[2\\] 第二条参考')
    // 往返：重新解析后 [n] 文本还原
    const ed2 = makeEditor(md)
    const paras3 = (ed2.getJSON().content ?? []).filter((n) => n.type === 'paragraph')
    expect((paras3[paras3.length - 1]?.content?.[0] as { text?: string } | undefined)?.text).toBe('[2] 第二条参考')
    ed2.destroy()
    ed.destroy()
  })

  it('insertPlainFootnote 与 insertFootnote 编号互通（全文最大编号 + 1）', () => {
    const ed = makeEditor('正文。')
    ed.commands.insertFootnote('块样式条目') // 上标 n=1 + footnotes 节点
    const ok = ed.commands.insertPlainFootnote('纯文本条目')
    expect(ok).toBe(true)
    const json = ed.getJSON()
    const paras = (json.content ?? []).filter((n) => n.type === 'paragraph')
    expect((paras[paras.length - 1]?.content?.[0] as { text?: string } | undefined)?.text).toBe('[2] 纯文本条目')
    ed.destroy()
  })

  it('insertFootnote / insertPlainFootnote：插入上标不产生多余空段落，光标停留上标后同一行', () => {
    // 1) 原样式：首次插入（新建 footnotes 节点路径）
    const ed = makeEditor('第一段内容。')
    ed.commands.setTextSelection(3)
    expect(ed.commands.insertFootnote('第一条注释')).toBe(true)
    let json = ed.getJSON() as unknown as JSONContent
    let blocks = json.content ?? []
    // 结构：仅 [p1(含sup), footnotes]，无末尾空段落（trailingNode 不再补）
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'footnotes'])
    expect((blocks[1]?.attrs?.items as unknown[] | undefined)?.length).toBe(1)
    // 光标停留上标之后同一行：doc 位置 4 = p1 内 sup 后（文本「第一」+ sup）
    expect(ed.state.selection.from).toBe(4)
    expect(ed.state.doc.nodeAt(ed.state.selection.from)?.type.name).toBe('text')
    ed.destroy()

    // 2) 原样式：再次插入（追加条目路径，footnotes 已在文末）
    const ed1 = makeEditor('第一段内容。\n\n第二段。')
    ed1.commands.setTextSelection(3)
    expect(ed1.commands.insertFootnote('第一条')).toBe(true)
    const p1Size = ed1.state.doc.nodeAt(1)?.nodeSize ?? 0
    ed1.commands.setTextSelection(p1Size + 1) // 第二段开头
    expect(ed1.commands.insertFootnote('第二条')).toBe(true)
    json = ed1.getJSON() as unknown as JSONContent
    blocks = json.content ?? []
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'footnotes'])
    expect((blocks[2]?.attrs?.items as unknown[] | undefined)?.length).toBe(2)
    ed1.destroy()

    // 3) 纯 Markdown 样式：不产生多余空段落，光标停留上标后同一行
    const ed2 = makeEditor('第一段内容。')
    ed2.commands.setTextSelection(3)
    expect(ed2.commands.insertPlainFootnote('第二条注释')).toBe(true)
    json = ed2.getJSON() as unknown as JSONContent
    blocks = json.content ?? []
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'paragraph'])
    expect(ed2.state.selection.from).toBe(4)
    expect(ed2.state.doc.nodeAt(ed2.state.selection.from)?.type.name).toBe('text')
    ed2.destroy()
  })

  it('insertPlainFootnote 空文本：仅插入上标，不生成文末参考条目', () => {
    const ed = makeEditor('正文。')
    ed.commands.setTextSelection(3)
    expect(ed.commands.insertPlainFootnote('   ')).toBe(true)
    const json = ed.getJSON() as unknown as JSONContent
    const refs = (json.content ?? []).flatMap((n) => n.content ?? []).filter((n) => n.type === 'footnote')
    expect(refs).toHaveLength(1)
    expect(ed.getMarkdown()).not.toContain('参考')
    ed.destroy()
  })

  it('用户修改上标编号：仅更新上标 attrs.n，不影响底部参考栏，序列化往返正确', () => {
    // parseFootnoteN：仅接受正整数
    expect(parseFootnoteN('3')).toBe(3)
    expect(parseFootnoteN(' 12 ')).toBe(12)
    expect(parseFootnoteN('0')).toBeNull()
    expect(parseFootnoteN('-1')).toBeNull()
    expect(parseFootnoteN('abc')).toBeNull()
    expect(parseFootnoteN('')).toBeNull()

    // 原样式：插入注释，修改上标编号，底部 footnotes items 保持原样
    const ed = makeEditor('第一段内容。')
    ed.commands.setTextSelection(3)
    ed.commands.insertFootnote('底部注释内容')
    // 模拟 FootnoteNodeView 提交：按节点位置 setNodeMarkup 修改编号 1 → 7
    let fnPos = -1
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote') {
        fnPos = pos
        return false
      }
    })
    expect(fnPos).toBeGreaterThanOrEqual(0)
    ed.view.dispatch(ed.state.tr.setNodeMarkup(fnPos, undefined, { n: 7 }))
    let json = ed.getJSON() as unknown as JSONContent
    let refs = (json.content ?? []).flatMap((n) => n.content ?? []).filter((n) => n.type === 'footnote')
    expect(refs[0]?.attrs?.n).toBe(7)
    // 底部参考栏 items 不受影响
    const fnBlock = (json.content ?? []).find((b) => b.type === 'footnotes')
    expect(fnBlock?.attrs?.items).toEqual([expect.objectContaining({ n: 1, text: '底部注释内容' })])
    // 序列化使用新编号，且往返还原
    const back = ed.getMarkdown()
    expect(back).toContain('"n":7')
    const ed2 = makeEditor(back)
    json = ed2.getJSON() as unknown as JSONContent
    refs = (json.content ?? []).flatMap((n) => n.content ?? []).filter((n) => n.type === 'footnote')
    expect(refs[0]?.attrs?.n).toBe(7)
    expect((json.content ?? []).find((b) => b.type === 'footnotes')?.attrs?.items).toEqual([
      expect.objectContaining({ n: 1, text: '底部注释内容' }),
    ])
    ed.destroy()
    ed2.destroy()

    // 纯 Markdown 样式：修改上标编号不影响文末 [n] 参考段落
    const ed3 = makeEditor('第二段内容。')
    ed3.commands.setTextSelection(3)
    ed3.commands.insertPlainFootnote('纯文本条目')
    let pPos = -1
    ed3.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote') {
        pPos = pos
        return false
      }
    })
    expect(pPos).toBeGreaterThanOrEqual(0)
    ed3.view.dispatch(ed3.state.tr.setNodeMarkup(pPos, undefined, { n: 5 }))
    json = ed3.getJSON() as unknown as JSONContent
    refs = (json.content ?? []).flatMap((n) => n.content ?? []).filter((n) => n.type === 'footnote')
    expect(refs[0]?.attrs?.n).toBe(5)
    const paras = (json.content ?? []).filter((n) => n.type === 'paragraph')
    expect(paras[paras.length - 1]?.content?.[0]).toEqual(expect.objectContaining({ text: '[1] 纯文本条目' }))
    ed3.destroy()
  })

  it('未知标记原样保留（兼容第三方编辑器），不破坏文档', () => {
    const md = '段落开始。\n\n<!-- 这是普通注释，不是 KE 节点 -->\n\n段落结束。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('段落开始')
    expect(back).toContain('段落结束')
  })

  it('混合文档整体往返：标题 + 公式 + 注释 + 列表', () => {
    const md = [
      '# 混合文档',
      '',
      '含行内公式 $a^2+b^2=c^2$ 的段落。',
      '',
      '$$',
      '\\int_0^1 x \\, dx = \\frac{1}{2}',
      '$$',
      '',
      '要点：',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '<!-- ke-note: {"kind":"note","id":"n9","content":"补充说明","color":"blue"} -->',
      '',
    ].join('\n')
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const types = (json.content ?? []).map((n) => n.type)
    expect(types).toContain('heading')
    expect(types).toContain('mathBlock')
    expect(types).toContain('bulletList')
    expect(types).toContain('note')
    const back = ed.getMarkdown()
    expect(back).toContain('$a^2+b^2=c^2$')
    expect(back).toContain('\\int_0^1')
    expect(back).toContain('ke-note')
    expect(back).toContain('- 第一项')
  })

  it('代码块 ```lang 解析为 codeBlock 节点并可往返', () => {
    const md = '示例：\n\n```ts\nconst x: number = 1\nif (x > 0) {\n  console.log(x)\n}\n```\n\n结束。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const code = findBlock(json, 'codeBlock')
    expect(code).toBeTruthy()
    expect(code?.attrs?.language).toBe('ts')
    const text = (code?.content ?? [])
      .map((n) => n.text ?? '')
      .join('')
    expect(text).toContain('const x: number = 1')
    expect(text).toContain('console.log(x)')
    const back = ed.getMarkdown()
    expect(back).toContain('```ts')
    expect(back).toContain('const x: number = 1')
    expect(back).toContain('```')
  })

  it('无语言代码块 ``` 解析为 codeBlock 且往返保留空语言', () => {
    const md = '纯文本代码：\n\n```\nhello world\n```'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const code = findBlock(json, 'codeBlock')
    expect(code).toBeTruthy()
    const back = ed.getMarkdown()
    expect(back).toContain('```\nhello world\n```')
  })
})

// ---------- R3 / F03 / F06 回归（v1.1.1-pre.1 审查） ----------

describe('R3 — 空 ke-note 不吞噬后续内容（ke-note 包裹格式不变量）', () => {
  const N1 = '<!-- ke-note: {"kind":"note","id":"n1","title":"空"} -->'
  const N2 = '<!-- ke-note: {"kind":"note","id":"n2","title":"非空"} -->'
  const END2 = '<!-- /ke-note -->'

  it('空信息块 + 非空信息块：两个 note 节点都保留，n2 内容不被吞', () => {
    const md = `${N1}\n\n${N2}\n内容X\n${END2}`
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const notes = (json.content ?? []).filter((n) => n.type === 'note') as JSONContent[]
    expect(notes).toHaveLength(2)
    expect(notes[0]?.attrs?.id).toBe('n1')
    expect(notes[1]?.attrs?.id).toBe('n2')
    expect((notes[1]?.content ?? []).map((n) => n.text ?? '').join('')).toContain('内容X')
    ed.destroy()
  })

  it('空信息块往返：序列化输出闭合标记，重开仍为两个独立的 note', () => {
    const md = `${N1}\n\n${N2}\n内容X\n${END2}`
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    // R3 第一部分：空内容也输出 <!-- /ke-note -->（不再与旧自闭合格式混淆）
    expect(back.split('<!-- ke-note:').length - 1).toBe(2)
    expect(back.split('<!-- /ke-note -->').length - 1).toBe(2)
    expect(back).toContain('内容X')
    ed.destroy()

    // 往返稳定：重开序列化结果，两个 note 仍在
    const ed2 = makeEditor(back)
    const notes = (ed2.getJSON().content ?? []).filter((n) => n.type === 'note') as JSONContent[]
    expect(notes).toHaveLength(2)
    expect((notes[1]?.content ?? []).map((n) => n.text ?? '').join('')).toContain('内容X')
    ed2.destroy()
  })

  it('旧格式（自闭合无内容）后跟非空信息块：不吞后续（旧文档兼容）', () => {
    const md = `<!-- ke-note: {"kind":"note","id":"old","title":"旧空"} -->\n\n${N2}\n内容Y\n${END2}`
    const ed = makeEditor(md)
    const notes = (ed.getJSON().content ?? []).filter((n) => n.type === 'note') as JSONContent[]
    expect(notes).toHaveLength(2)
    expect((notes[1]?.content ?? []).map((n) => n.text ?? '').join('')).toContain('内容Y')
    ed.destroy()
  })
})

describe('F03 — 大小写变体 ke- 注释原样保留（document-format §4）', () => {
  it('ke-NOTE 块级大小写变体：解析为 fallback 保留原文，往返不丢', () => {
    const md = '<!-- ke-NOTE: {"kind":"note","id":"x1","title":"大标题"} -->'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const fallback = (json.content ?? []).find((n) => n.type === 'keFallback')
    expect(fallback).toBeTruthy()
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-NOTE:')
    ed.destroy()
  })

  it('ke-Footnote 大小写变体（行内）：保留原文不丢', () => {
    const md = '正文<!-- ke-Footnote: {"kind":"footnote","id":"f9","n":9} -->结尾。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-Footnote:')
    ed.destroy()
  })
})

describe('F06 — 块级 footnote 系不再静默丢失', () => {
  it('独占一行的 ke-footnote 引用：原样保留', () => {
    const md = '正文。\n\n<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->\n\n结尾。'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-footnote:')
    ed.destroy()
  })

  it('未闭合 ke-footnotes 区域：start 与 item 标记均保留', () => {
    const md = '正文。\n\n<!-- ke-footnotes:start -->\n<!-- ke-footnote-item: {"id":"f1","n":1,"text":"注释"} -->'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-footnotes:start -->')
    expect(back).toContain('<!-- ke-footnote-item:')
    ed.destroy()
  })

  it('孤儿 footnote-item：原样保留', () => {
    const md = '<!-- ke-footnote-item: {"id":"f2","n":2,"text":"孤儿女"} -->'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-footnote-item:')
    ed.destroy()
  })

  it('行内 footnote（段落中部）仍解析为 footnote 节点（兜底不干扰正常用例）', () => {
    const md = '这是正文<!-- ke-footnote: {"kind":"footnote","id":"f3","n":3} -->带脚注。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const inline = (json.content ?? [])
      .flatMap((n) => n.content ?? [])
      .find((n) => n.type === 'footnote')
    expect(inline).toBeTruthy()
    expect((inline as unknown as { attrs?: { id?: string } })?.attrs?.id).toBe('f3')
    ed.destroy()
  })

  it('段首脚注（注释后同行有正文）：注释保留为 fallback 块，正文照常成段不丢', () => {
    // 编辑器可产出：光标置于段首插入脚注 → 序列化后行首为 ke-footnote 引用。
    // 该形态无法在块级重建 inline 脚注节点（marked html 规则会吞掉），
    // 要求：注释原文保留（不静默丢失）+ 正文照常成段。
    const md = '<!-- ke-footnote: {"kind":"footnote","id":"f4","n":4} -->第一段开头正文。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const blocks = json.content ?? []
    const fb = blocks.find((n) => n.type === 'keFallback')
    expect(fb).toBeTruthy()
    expect((fb?.attrs as { raw?: string } | undefined)?.raw).toContain('ke-footnote')
    expect(blocks.some((n) => n.type === 'paragraph')).toBe(true)
    // 往返稳定：正文保留、脚注引用保留
    const back = ed.getMarkdown()
    expect(back).toContain('第一段开头正文。')
    expect(back).toContain('ke-footnote')
    ed.destroy()
  })
})
