/**
 * F03 审计缺陷回归：Ctrl+Shift+B（Mod-Shift-b）引用快捷键失效。
 *
 * 根因：`KeBlockquote = Blockquote.extend()` 的 `addKeyboardShortcuts()` 重写快捷键表时只返回
 * `{ Backspace: ... }`，**丢弃了上游 `@tiptap/extension-blockquote` 的 `Mod-Shift-b`**；而
 * `editor/index.ts` 用 `blockquote: false` 关闭了内置扩展 → 引用快捷键完全失效（工具栏可用）。
 *
 * 修复要求：继承上游快捷键表（保留 Mod-Shift-b），同时不回归本扩展的 Backspace 修复行为
 * （容器内 atom 之后的空段落直接删除，见 task-59）。
 */
import { Editor, getExtensionField } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { KeBlockquote, KeDocument } from './KeBlockJoin'
import { MathBlockExtension } from './MathBlockExtension'

/** 与生产 index.ts 同序的最小相关栈（KeDocument/KeBlockquote + mathBlock + trailingNode） */
const EXT = [
  StarterKit.configure({
    document: false,
    blockquote: false,
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  KeBlockquote,
  MathBlockExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
] as never

const P = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const MATH = { type: 'mathBlock', attrs: { latex: 'a ≤ b' } }

function makeEditor(content: unknown): Editor {
  return new Editor({ extensions: EXT, content: content as never })
}

type ShortcutMap = Record<string, () => boolean>

/** 取 KeBlockquote 扩展实例真实生效的快捷键表（经 getExtensionField 注入 this.parent/editor）。 */
function blockquoteShortcuts(ed: Editor): ShortcutMap {
  const extension = ed.extensionManager.extensions.find((e) => e.name === 'blockquote')
  expect(extension, '编辑器应包含 blockquote 扩展（KeBlockquote）').toBeTruthy()
  const factory = getExtensionField(
    extension as never,
    'addKeyboardShortcuts',
    { editor: ed, type: ed.schema.nodes.blockquote } as never,
  ) as unknown as (() => ShortcutMap) | undefined
  expect(typeof factory).toBe('function')
  return factory!()
}

function pressModShiftB(ed: Editor): void {
  const event = new KeyboardEvent('keydown', {
    key: 'B',
    code: 'KeyB',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  // 真实浏览器 Ctrl+Shift+B 的 key='B'（大写）+ keyCode=66；ProseMirror keymap 在修饰键下
  // 会用 keyCode 回退匹配小写绑定（w3c-keyname base[66]='b'）→ 这里补齐 keyCode 以贴近真实事件。
  Object.defineProperty(event, 'keyCode', { get: () => 66 })
  ed.view.dom.dispatchEvent(event)
}

describe('F03 缺陷回归：Ctrl+Shift+B 引用快捷键', () => {
  it('KeBlockquote 快捷键表保留上游 Mod-Shift-b（不再只返回 Backspace）', () => {
    const ed = makeEditor({ type: 'doc', content: [P('一段')] })
    const shortcuts = blockquoteShortcuts(ed)
    expect(typeof shortcuts['Mod-Shift-b'], '快捷键表必须包含 Mod-Shift-b（上游被 KeBlockquote 覆盖丢失过）').toBe(
      'function',
    )
    expect(typeof shortcuts['Backspace'], '本扩展自定义 Backspace 仍应在表中').toBe('function')
    ed.destroy()
  })

  it('真实 keydown Mod-Shift-b → toggleBlockquote（引用开/关可往返）', () => {
    const ed = makeEditor({ type: 'doc', content: [P('引用我')] })
    ed.commands.setTextSelection(2)
    expect(ed.isActive('blockquote')).toBe(false)

    pressModShiftB(ed)
    expect(ed.isActive('blockquote'), '第一次 Ctrl+Shift+B 应把段落变成引用').toBe(true)
    expect(ed.getJSON().content?.[0]?.type).toBe('blockquote')

    pressModShiftB(ed)
    expect(ed.isActive('blockquote'), '第二次 Ctrl+Shift+B 应取消引用（toggle 往返）').toBe(false)
    expect(ed.getJSON().content?.[0]?.type).toBe('paragraph')
    ed.destroy()
  })

  it('Backspace 行为不回归：容器内 atom 之后的空段落仍被直接删除（不删公式）', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [{ type: 'blockquote', content: [P('引理1'), MATH, P()] }],
    })
    let target = -1
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === '') target = pos + 1
    })
    expect(target).toBeGreaterThan(0)
    ed.commands.setTextSelection(target)

    ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))

    const json = ed.getJSON()
    const quote = json.content?.[0]
    expect(quote?.type).toBe('blockquote')
    // 空段落被删除；引理与公式仍在
    expect(quote?.content?.map((n) => n.type)).toEqual(['paragraph', 'mathBlock'])
    expect((quote?.content?.[1] as { attrs?: Record<string, unknown> })?.attrs?.latex).toBe('a ≤ b')
    expect(ed.getMarkdown()).toContain('a ≤ b')
    ed.destroy()
  })

  it('自定义 Backspace 仍优先于上游（空引用行直接调用自定义 handler 返回 false，交回默认行为）', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'blockquote', content: [P()] }] })
    // 光标在空引用行内（depth=2）；上游 handleBackspace 会删除整个空引用块，
    // 本扩展自定义逻辑只接管「atom 之后的空段落」→ 这里应返回 false（不误删引用块）。
    ed.commands.setTextSelection(2)
    const shortcuts = blockquoteShortcuts(ed)
    expect(shortcuts['Backspace']()).toBe(false)
    expect(ed.getJSON().content?.[0]?.type).toBe('blockquote')
    ed.destroy()
  })
})
