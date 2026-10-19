/** T26 G3：打印渲染器 —— 快照 Markdown → HTML（产品编辑器同源 schema）+ 错误路径。 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  renderMarkdownSnapshotBody,
  resetPrintEditorProviderForTests,
  setPrintEditorProvider,
  type KePrintEditorLike,
} from './printEditorBridge'

const created: Editor[] = []

function makeEditor(): KePrintEditorLike {
  const editor = new Editor({
    extensions: [StarterKit, Markdown.configure({ indentation: { style: 'space', size: 2 } })],
    content: '',
    contentType: 'markdown',
  })
  created.push(editor)
  return editor as unknown as KePrintEditorLike
}

afterEach(() => {
  resetPrintEditorProviderForTests()
  while (created.length > 0) created.pop()?.destroy()
})

describe('T26 G3 printEditorBridge：可信快照 Markdown → HTML', () => {
  it('用产品编辑器同源 schema/解析器渲染标题/正文/列表', () => {
    const editor = makeEditor()
    const html = renderMarkdownSnapshotBody('# 标题\n\n正文段落\n\n- 项目一\n- 项目二', () => editor)
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<p>正文段落</p>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li><p>项目一</p></li>')
  })

  it('去除 BOM/frontmatter、归一 CRLF（打印正文不含元信息）', () => {
    const editor = makeEditor()
    const raw = '\uFEFF---\r\ntitle: 测试\r\nke_version: 1\r\n---\r\n\r\nHello 正文'
    const html = renderMarkdownSnapshotBody(raw, () => editor)
    expect(html).toContain('Hello 正文')
    expect(html).not.toContain('ke_version')
    expect(html).not.toContain('title:')
  })

  it('未注册产品编辑器 → E_PRINT_RENDERER（如实失败，不静默输出空页）', () => {
    expect(() => renderMarkdownSnapshotBody('# x')).toThrow(/E_PRINT_RENDERER/)
    setPrintEditorProvider(() => null)
    expect(() => renderMarkdownSnapshotBody('# x')).toThrow(/E_PRINT_RENDERER/)
  })

  it('编辑器缺少 markdown 管理器 → E_PRINT_RENDERER', () => {
    const fake = { extensionManager: { extensions: [StarterKit] }, storage: {} } as unknown as KePrintEditorLike
    expect(() => renderMarkdownSnapshotBody('# x', () => fake)).toThrow(/Markdown 管理器/)
  })

  it('Markdown 解析失败 → E_PRINT_RENDERER 带原因（不吞错）', () => {
    const fake = {
      extensionManager: { extensions: [StarterKit] },
      storage: { markdown: { manager: { parse: vi.fn(() => { throw new Error('boom-parse') }) } } },
    } as unknown as KePrintEditorLike
    expect(() => renderMarkdownSnapshotBody('# x', () => fake)).toThrow(/E_PRINT_RENDERER: 快照 Markdown 解析失败（boom-parse）/)
  })

  it('setPrintEditorProvider 注册后默认可解析（生产接线路径）', () => {
    const editor = makeEditor()
    setPrintEditorProvider(() => editor)
    expect(renderMarkdownSnapshotBody('**加粗**')).toContain('<strong>加粗</strong>')
  })
})
