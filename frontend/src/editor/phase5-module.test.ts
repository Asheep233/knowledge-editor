/**
 * Phase 5 模块系统前端测试。
 * 覆盖：
 * - ke.ts：module 字段序含 source；toKeComment / parseKeComment 的 source 支持
 * - ModuleExtension：来源标记（仅含 source）往返零漂移；旧格式标记（id/name）兼容
 * - 插入模块：ke-module 标记 + 复杂内容（标题/公式/信息块/图片/视频/表格/代码块）
 *   整体进入 Document Model 并完整序列化往返
 * - 独立性语义：标记只记录来源，不建立动态关系（无同步字段）
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown, type MarkdownExtensionStorage } from '@tiptap/markdown'
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
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { KE_FIELD_ORDER, parseKeComment, toKeComment } from './ke'
import { stripModuleTitle } from '../components/editor/EditorToolbar'

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

/** 模拟工具栏插入模块：剥离开头标题 + 构造 ke-module 来源标记 + 解析进 Document Model。
 * 与 EditorToolbar.insertModule 行为保持一致（共享 stripModuleTitle）。 */
function insertModuleLikeToolbar(editor: Editor, source: string, body: string): void {
  const stripped = stripModuleTitle(body)
  const marker = `<!-- ke-module: ${JSON.stringify({ source })} -->`
  const md = `${marker}\n\n${stripped}`
  const manager = (editor.storage.markdown as MarkdownExtensionStorage).manager
  const content = manager.parse(md)
  editor.commands.insertContent(content)
}

function typesOf(json: JSONContent): string[] {
  return (json.content ?? []).map((n) => n.type ?? '')
}

describe('Phase 5：ke-module source 字段', () => {
  it('KE_FIELD_ORDER.module 包含 source（规范示例字段序）', () => {
    expect(KE_FIELD_ORDER.module).toContain('source')
    expect(KE_FIELD_ORDER.module.indexOf('source')).toBe(KE_FIELD_ORDER.module.length - 1)
  })

  it('toKeComment 生成含 source 的 ke-module 注释', () => {
    const out = toKeComment('module', { source: 'Modules/Math/Definition.md' })
    expect(out).toBe('<!-- ke-module: {"kind":"module","source":"Modules/Math/Definition.md"} -->')
  })

  it('parseKeComment 解析 source', () => {
    const parsed = parseKeComment('<!-- ke-module: {"source":"Modules/Math/Definition.md"} -->')
    expect(parsed?.kind).toBe('module')
    expect(parsed?.attrs.source).toBe('Modules/Math/Definition.md')
  })
})

describe('Phase 5：来源标记往返', () => {
  it('仅含 source 的标记（规范示例格式）往返零漂移', () => {
    const md =
      '<!-- ke-module: {"source":"Modules/Math/Definition.md"} -->\n\n## 定义\n\n设 X 是集合。'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    const mod = (json.content ?? []).find((n) => n.type === 'module')
    expect(mod?.attrs?.source).toBe('Modules/Math/Definition.md')
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-module: {"source":"Modules/Math/Definition.md"} -->')
    expect(back).toContain('## 定义')
    expect(back).toContain('设 X 是集合。')
    ed.destroy()
  })

  it('旧格式标记（含 id/name/version/params）保持兼容输出', () => {
    const md =
      '<!-- ke-module: {"kind":"module","id":"m1","name":"部署步骤","version":2,"params":{"host":"127.0.0.1"}} -->'
    const ed = makeEditor(md)
    const back = ed.getMarkdown()
    expect(back).toContain('"id":"m1"')
    expect(back).toContain('"name":"部署步骤"')
    expect(back).toContain('"version":2')
    expect(back).not.toContain('"source"')
    ed.destroy()
  })
})

describe('Phase 5：插入模块（内容复制 + 来源记录）', () => {
  it('复杂内容进入 Document Model 并完整往返', () => {
    const body = [
      '## 公式',
      '',
      '$$E = mc^2$$',
      '',
      '<!-- ke-note: {"kind":"note","id":"n1","title":"定理","color":"yellow"} -->',
      '',
      '定理内容。',
      '',
      '![图](Attachments/images/x.png)',
      '',
      '<!-- ke-video: {"kind":"video","id":"v2","src":"Attachments/videos/v.mp4","title":"演示"} -->',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```python',
      'print(1)',
      '```',
    ].join('\n')
    const ed = makeEditor('原正文\n\n')
    insertModuleLikeToolbar(ed, 'Modules/Physics/Note.md', body)
    const types = typesOf(ed.getJSON())
    // ke-module 来源标记 + 模块内容全部进入 Document Model
    expect(types).toContain('module')
    expect(types).toContain('heading')
    expect(types).toContain('mathBlock')
    expect(types).toContain('note')
    expect(types).toContain('image')
    expect(types).toContain('video')
    expect(types).toContain('table')
    expect(types).toContain('codeBlock')
    // 序列化：来源标记 + 全部内容保留
    const back = ed.getMarkdown()
    expect(back).toContain('<!-- ke-module: {"source":"Modules/Physics/Note.md"} -->')
    // 块级公式序列化为独占行格式（$$\n...\n$$）
    expect(back).toContain('E = mc^2')
    expect(back).toContain('ke-note')
    expect(back).toContain('![图](Attachments/images/x.png)')
    expect(back).toContain('ke-video')
    expect(back).toContain('| 1 | 2 |')
    expect(back).toContain('print(1)')
    ed.destroy()
  })

  it('插入后标记仅记录来源，不产生动态同步字段', () => {
    const ed = makeEditor('')
    insertModuleLikeToolbar(ed, 'Modules/Math/Definition.md', '## 定义\n\n设 X 是集合。')
    const back = ed.getMarkdown()
    // source 之外不得引入 sync/ref/update 等动态机制字段
    expect(back).not.toContain('"sync"')
    expect(back).not.toContain('"ref"')
    expect(back).not.toContain('"updated"')
    // 再次打开序列化：标记唯一且稳定
    const ed2 = makeEditor(back)
    expect(ed2.getMarkdown()).toBe(back)
    ed.destroy()
    ed2.destroy()
  })

  it('插入模块时剥离自动生成的标题（# 名称）', () => {
    const ed = makeEditor('原正文\n\n')
    // 模块文件内容：创建时自动生成 `# 定理` + 真实内容
    insertModuleLikeToolbar(ed, 'Modules/Math/Theorem.md', '# 定理\n\n## 定义\n\n设 X 是集合。')
    const back = ed.getMarkdown()
    expect(back).not.toContain('# 定理')
    expect(back).toContain('<!-- ke-module: {"source":"Modules/Math/Theorem.md"} -->')
    expect(back).toContain('## 定义')
    expect(back).toContain('设 X 是集合。')
    ed.destroy()
  })

  it('仅标题的空模块插入后不产生正文内容', () => {
    const ed = makeEditor('')
    insertModuleLikeToolbar(ed, 'Modules/Math/Empty.md', '# 空模块\n')
    const types = typesOf(ed.getJSON())
    // 只有隐藏的 module 来源标记 + 编辑器末尾空段落，无其他正文节点
    expect(types).toContain('module')
    expect(types.filter((t) => t !== 'module' && t !== 'paragraph')).toEqual([])
    expect(ed.getMarkdown()).toContain('<!-- ke-module: {"source":"Modules/Math/Empty.md"} -->')
    ed.destroy()
  })
})

describe('Phase 5：stripModuleTitle（插入时剥离自动标题）', () => {
  it('剥离开头一级标题及其后空行', () => {
    expect(stripModuleTitle('# 定理\n\n## 定义\n\n设 X 是集合。')).toBe(
      '## 定义\n\n设 X 是集合。',
    )
  })

  it('开头带空行时同样剥离', () => {
    expect(stripModuleTitle('\n\n# 定理\n\n内容')).toBe('内容')
  })

  it('仅标题的空模块返回空串', () => {
    expect(stripModuleTitle('# 定理\n')).toBe('')
  })

  it('不以一级标题开头则不剥离', () => {
    expect(stripModuleTitle('## 定义\n\n内容')).toBe('## 定义\n\n内容')
    expect(stripModuleTitle('正文内容')).toBe('正文内容')
  })
})
