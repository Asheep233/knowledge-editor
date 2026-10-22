/**
 * 历史遗留 bug（用户 2026-10-22 实测）：块级公式里的 `\tag{...}` 编号**叠在公式本体上**
 * 而不是排在正文列右端。
 *
 * 根因：KaTeX 的 `.katex-tag` 是 `position:absolute; right:0`，右边界锚定在最近的定位祖先
 * （`.katex-html` → `.katex`）上。此前块级公式渲染容器 `.ke-math-render` 是 `display:inline-block`
 * （宽度收缩到公式内容宽）→ `\tag` 的 `right:0` 落在公式右缘，与公式正文重叠。
 *
 * 修复：`.ke-math--block .ke-math-render { display:block; width:100% }`，让 KaTeX display math
 * 占满正文列宽，编号自然排到列右端（Chromium 实测：块 680px、渲染容器 680px、tag `(1)` 距右缘 4px，
 * 与公式 base 无重叠 —— 证据见 docs/focus-ui/evidence/math-tag/measurements.json）。
 *
 * happy-dom 不做布局，故本文件分两层锁死：
 *   1) 结构层：真实 Tiptap + KaTeX 渲染后存在 `.katex-tag`，且文本 = 编号；
 *   2) 样式层：index.css 必须有「块级渲染容器 display:block + width:100%」契约（回归会直接变红）。
 */
import React, { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MathExtension } from '../../../editor/extensions/MathExtension'
import { MathBlockExtension } from '../../../editor/extensions/MathBlockExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from '../../../editor/extensions/TableMarkdownExtension'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EXTENSIONS = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  MathExtension,
  MathBlockExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

const CSS_TEXT = readFileSync(join(__dirname, '../../../index.css'), 'utf8')

/** 解析 index.css 规则块（与 MathNodeView.hover.test.tsx 同口径） */
function ruleBodies(selector: string): string[] {
  const clean = CSS_TEXT.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const chunk of clean.split('}')) {
    const i = chunk.indexOf('{')
    if (i < 0) continue
    const selectors = chunk
      .slice(0, i)
      .split(',')
      .map((x) => x.replace(/[\s\n\r]+/g, ' ').trim())
      .filter(Boolean)
    if (selectors.includes(selector)) out.push(chunk.slice(i + 1))
  }
  return out
}

let root: Root | null = null
let harnessEditor: Editor | null = null

function Harness({ content }: { content: string }) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'ke-editor-prose' } },
  })
  useEffect(() => {
    harnessEditor = editor ?? null
  }, [editor])
  return React.createElement(EditorContent, { editor })
}

async function mount(content: string): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const r = createRoot(container)
  root = r
  await act(async () => {
    r.render(React.createElement(Harness, { content }))
  })
  for (let i = 0; i < 60; i++) {
    if (document.querySelector('.ke-math')) break
    await new Promise((res) => setTimeout(res, 20))
  }
  await new Promise((res) => setTimeout(res, 40))
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  harnessEditor?.destroy()
  harnessEditor = null
})

describe('块级公式 \\tag 编号布局（历史遗留 bug 回归）', () => {
  it('KaTeX 渲染出 .katex-tag，且编号文本正确', async () => {
    await mount('$$L = \\mathbb{R} \\tag{1}$$\n')
    const block = document.querySelector('.ke-math--block') as HTMLElement | null
    expect(block, '未渲染出块级公式节点').toBeTruthy()
    const tag = block!.querySelector('.katex-tag') as HTMLElement | null
    expect(tag, 'KaTeX 未生成 .katex-tag（\\tag 未生效或 displayMode 丢失）').toBeTruthy()
    expect((tag!.textContent ?? '').trim()).toBe('(1)')
  })

  it('样式契约：块级渲染容器必须占满正文列宽（否则 tag 锚到公式右缘、与本体重叠）', () => {
    const body = ruleBodies('.ke-math--block .ke-math-render').join(';')
    expect(body, '缺失 .ke-math--block .ke-math-render 规则（tag 叠字回归）').not.toBe('')
    expect(body, '块级渲染容器必须是 display:block').toMatch(/display\s*:\s*block/)
    expect(body, '块级渲染容器必须 width:100%').toMatch(/width\s*:\s*100%/)
    const katexBody = ruleBodies('.ke-math--block .ke-math-render .katex-display').join(';')
    expect(katexBody, 'katex-display 必须 width:100%（tag 右对齐依赖容器满宽）').toMatch(/width\s*:\s*100%/)
  })
})
