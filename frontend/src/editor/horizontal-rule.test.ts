/**
 * 2026-11-11「插入分割线」功能回归：
 * - StarterKit HorizontalRule + Markdown 扩展的 GFM `---` 双向转换；
 * - 工具栏/命令面板触发的是 `setHorizontalRule`（PM 节点），保存后必须是 `---` 行。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'

const EXTENSIONS = [StarterKit, Markdown.configure({ indentation: { style: 'space', size: 2 } })]

function countHr(json: any): number {
  let n = 0
  const walk = (node: any) => {
    if (!node) return
    if (node.type === 'horizontalRule') n++
    for (const c of node.content ?? []) walk(c)
  }
  walk(json)
  return n
}

describe('分割线（horizontalRule）Markdown 往返', () => {
  it('`---` 解析为 horizontalRule 并原样序列化', () => {
    const ed = new Editor({ extensions: EXTENSIONS, content: '甲\n\n---\n\n乙\n', contentType: 'markdown' })
    const json = ed.getJSON()
    const out = ed.getMarkdown()
    ed.destroy()
    expect(countHr(json), '必须解析出分割线节点').toBe(1)
    expect(out).toContain('---')
    expect(out).not.toContain('\\-\\-\\-')
  })

  it('setHorizontalRule 插入的节点保存为 `---`，重开仍是分割线', () => {
    const ed = new Editor({ extensions: EXTENSIONS, content: '甲\n\n乙\n', contentType: 'markdown' })
    ed.commands.focus('end')
    ed.commands.setHorizontalRule()
    const md = ed.getMarkdown()
    ed.destroy()
    expect(md).toMatch(/^---$/m)

    const ed2 = new Editor({ extensions: EXTENSIONS, content: md, contentType: 'markdown' })
    expect(countHr(ed2.getJSON())).toBe(1)
    ed2.destroy()
  })

  it('往返幂等（ghr 前后空行不漂移）', () => {
    const ed = new Editor({ extensions: EXTENSIONS, content: '甲\n\n---\n\n乙\n', contentType: 'markdown' })
    const md1 = ed.getMarkdown()
    ed.destroy()
    const ed2 = new Editor({ extensions: EXTENSIONS, content: md1, contentType: 'markdown' })
    const md2 = ed2.getMarkdown()
    ed2.destroy()
    expect(md2).toBe(md1)
  })
})
