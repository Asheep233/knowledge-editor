/**
 * task-69 M05（外部复审 2026-10-10，P2，**真实 UI 确认，属内容丢失**）：
 * 脚注条目文本里含**完整的 `ke-footnotes:end` 标记**时，脚注区域被**提前闭合** →
 * 条目丢失、JSON 尾部外泄为正文。
 *
 * 最小样本（`case-drift-13`，136 字节）：
 * ```
 * <!-- ke-footnotes:start -->
 * <!-- ke-footnote-item: {"id":"f1","n":1,"text":"X<!-- ke-footnotes:end -->Y"} -->
 * <!-- ke-footnotes:end -->
 * ```
 * 实测「修复前」节点结构（复审包 before.json 复算一致）：
 *   footnotes(items=[])            ← **条目 f1 整条丢失**
 *   paragraph("Y\"} -->")           ← JSON 尾部外泄
 *   keFallback("<!-- ke-footnotes:end -->")
 *
 * 根因：`footnotesBlockTokenizer`（`src/editor/tokenizers.ts`）用
 * `src.indexOf('<!-- ke-footnotes:end -->')` 找结束标记 —— **不区分「结构标记」与
 * 「JSON 字符串内容里的同名字面量」**，于是命中了 `"text":"X<!-- ke-footnotes:end -->Y"`
 * 里那一处，区域在此截断。
 *
 * 修法（本文件即验收口径）：结束标记扫描必须**跳过 JSON 字符串内部**；只有当标记处于
 * 结构位置（该行的行首、且不在引号内）时才闭合区域。区域内容一律按原文保留。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'

const EXT = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  FootnoteExtension,
  FootnotesExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

const M05_INPUT =
  '<!-- ke-footnotes:start -->\n' +
  '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"X<!-- ke-footnotes:end -->Y"} -->\n' +
  '<!-- ke-footnotes:end -->\n'

interface Snapshot {
  structure: string[]
  items: Array<Record<string, unknown>>
  leaked: string[]
  back: string
}

function snapshot(md: string): Snapshot {
  const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
  const structure: string[] = []
  const items: Array<Record<string, unknown>> = []
  const leaked: string[] = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'footnotes') {
      structure.push(`footnotes(items=${(n.attrs.items as unknown[]).length})`)
      for (const it of (n.attrs.items as Array<Record<string, unknown>>) ?? []) items.push(it)
    } else if (n.isBlock) {
      structure.push(n.type.name)
      if (n.type.name === 'paragraph') {
        const t = n.textContent
        if (t.trim()) leaked.push(t)
      }
    }
    return true
  })
  const back = ed.getMarkdown()
  ed.destroy()
  return { structure, items, leaked, back }
}

describe('task-69 M05：脚注区域不得被 JSON 文本内的结束标记提前闭合', () => {
  it('T1 条目必须保留：footnotes.items 含 f1，且 text 原样含标记字面量', () => {
    const s = snapshot(M05_INPUT)
    expect(s.items.length, `脚注条目丢失：${JSON.stringify(s.structure)}`).toBe(1)
    expect(s.items[0].id).toBe('f1')
    expect(s.items[0].n).toBe(1)
    expect(String(s.items[0].text)).toBe('X<!-- ke-footnotes:end -->Y')
  })

  it('T2 不得外泄：正文里不得出现 JSON 尾部（`Y"} -->`）', () => {
    const s = snapshot(M05_INPUT)
    expect(s.leaked, `正文外泄内容：${JSON.stringify(s.leaked)}`).toEqual([])
  })

  it('T3 节点结构对照（无外泄段落、无多余 keFallback）', () => {
    const s = snapshot(M05_INPUT)
    expect(s.structure).toEqual(['footnotes(items=1)'])
  })

  it('T4 字节对照：读入 → 保存必须逐字节一致', () => {
    const s = snapshot(M05_INPUT)
    expect(s.back, '往返字节不一致').toBe(M05_INPUT.replace(/\n$/, ''))
  })

  it('T4b 二次往返稳定（不累积改写）', () => {
    const once = snapshot(M05_INPUT).back
    const twice = snapshot(`${once}\n`).back
    expect(twice).toBe(once)
  })

  it('T5 契约守护：常规脚注（无嵌套标记）仍正常解析且字节一致', () => {
    const md =
      '<!-- ke-footnotes:start -->\n' +
      '<!-- ke-footnote-item: {"id":"a1","n":1,"text":"普通脚注文本"} -->\n' +
      '<!-- ke-footnotes:end -->\n'
    const s = snapshot(md)
    expect(s.items.length).toBe(1)
    expect(s.items[0].text).toBe('普通脚注文本')
    expect(s.back).toBe(md.replace(/\n$/, ''))
  })

  it('T6 契约守护：多条脚注（含尾部标记形状的文本）全部保留', () => {
    const md =
      '<!-- ke-footnotes:start -->\n' +
      '<!-- ke-footnote-item: {"id":"a1","n":1,"text":"含 <!-- ke-footnotes:end --> 字面量"} -->\n' +
      '<!-- ke-footnote-item: {"id":"a2","n":2,"text":"第二条"} -->\n' +
      '<!-- ke-footnotes:end -->\n'
    const s = snapshot(md)
    expect(s.items.map((i) => i.id)).toEqual(['a1', 'a2'])
    expect(s.items[1].text).toBe('第二条')
  })
})
