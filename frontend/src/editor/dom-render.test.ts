/**
 * 真实 DOM 渲染测试（v0.6.5）：复现「插入注释上标后自动换行」的用户场景。
 * 用 happy-dom + React 渲染真实编辑器（ReactNodeView 生效），检查：
 * 1) Document Model：插入上标后不应产生多余空段落（尤其光标在文档末尾时）
 * 2) 渲染 DOM：上标与前后文本处于同一段落、同一行（无块级包裹/额外换行）
 */
import React, { useEffect } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
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
import type { JSONContent } from '@tiptap/core'

// React 18+ 的 act() 需要显式声明测试环境，否则会有 act 警告且行为可能不一致
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DOM_EXTENSIONS = [
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  StarterKit.configure({
    link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
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
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

let harnessEditor: Editor | null = null

function Harness({ content }: { content: string }) {
  const editor = useEditor({
    extensions: DOM_EXTENSIONS,
    content,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'ke-editor-prose' },
    },
  })
  useEffect(() => {
    harnessEditor = editor ?? null
  }, [editor])
  return React.createElement(EditorContent, { editor })
}

async function mount(content: string): Promise<Root> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(Harness, { content }))
  })
  // 等待 React/ProseMirror 完成初始渲染
  await new Promise((r) => setTimeout(r, 50))
  return root
}

describe('DOM 渲染：插入注释上标不换行（v0.6.5）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    harnessEditor = null
  })

  it('光标在文档末尾插入注释：模型无空段落，DOM 上标与文本同行', async () => {
    const root = await mount('第一段内容。')
    const ed = harnessEditor
    expect(ed).toBeTruthy()
    await act(async () => {
      ed!.commands.setTextSelection(ed!.state.doc.content.size) // 光标移到文档末尾
      ed!.commands.insertFootnote('末尾注释')
    })
    await new Promise((r) => setTimeout(r, 50))

    // 1) 文档模型：仅 [p1(含sup), footnotes]，无空段落
    const json = ed!.getJSON() as unknown as JSONContent
    const blocks = json.content ?? []
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'footnotes'])
    expect((blocks[0]?.content ?? []).filter((n) => n.type === 'footnote')).toHaveLength(1)
    // 光标停留在上标之后（同一行）：位置 = p1 的 end（紧邻上标后、p1 边界内）
    const sel = ed!.state.selection.from
    expect(ed!.state.doc.resolve(sel).parent.type.name).toBe('paragraph')

    // 2) 渲染 DOM：sup 位于段落内部，前后无块级元素
    const html = document.body.innerHTML
    expect(html).toContain('ke-footnote-ref')
    // 提取 sup 的父元素：应为 NodeViewWrapper 的 span（inline），其父是 p
    const sup = document.querySelector('sup.ke-footnote-ref')
    expect(sup).toBeTruthy()
    const wrapper = sup!.parentElement
    expect(wrapper?.tagName.toLowerCase()).toBe('span')
    const parent = wrapper!.parentElement
    expect(parent?.tagName.toLowerCase()).toBe('p')
    // 段落内无块级子元素（br/img 是 ProseMirror 的行尾标记，任何段落都有，非换行）
    const blockChildren = Array.from(parent!.children).filter(
      (el) => ['div', 'section', 'p'].includes(el.tagName.toLowerCase()),
    )
    expect(blockChildren.length).toBe(0)
    await act(async () => {
      root.unmount()
    })
  })

  it('光标在段落中间插入注释：模型无空段落，上标与前后文本同一段落', async () => {
    const root = await mount('第一段内容。')
    const ed = harnessEditor
    await act(async () => {
      ed!.commands.setTextSelection(3) // 「第一」之后
      ed!.commands.insertFootnote('中间注释')
    })
    await new Promise((r) => setTimeout(r, 50))

    const json = ed!.getJSON() as unknown as JSONContent
    const blocks = json.content ?? []
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'footnotes'])
    // 光标在上标后（doc 位置 4），且上标后仍是文本（同一行）
    expect(ed!.state.selection.from).toBe(4)
    const sup = document.querySelector('sup.ke-footnote-ref')
    expect(sup).toBeTruthy()
    const wrapper = sup!.parentElement
    expect(wrapper?.tagName.toLowerCase()).toBe('span')
    const parent = wrapper!.parentElement
    expect(parent?.tagName.toLowerCase()).toBe('p')
    // sup 所在 span 的前后兄弟节点都应为文本（inline），无块级换行
    const prev = wrapper!.previousSibling
    const next = wrapper!.nextSibling
    expect(prev?.nodeType).toBe(Node.TEXT_NODE)
    expect(next?.nodeType).toBe(Node.TEXT_NODE)
    await act(async () => {
      root.unmount()
    })
  })
})
