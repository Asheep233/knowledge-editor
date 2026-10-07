/**
 * task-59：「引用块内 atom（如行间公式）之后那条空引用行按 Backspace 反复横跳」回归。
 *
 * **修复前实测**（用同一结构在本文件同款栈上跑）：
 * ```
 * 初始: blockquote[paragraph(引理1),mathBlock,paragraph] | paragraph  from=8 (depth2)
 * BS#1: tx=1 from=9(depth1) shape=blockquote[paragraph(引理1),mathBlock] | paragraph | paragraph   ← 空段落被 lift 出引用块
 * BS#2: tx=3（最后一次 docChanged=true）from=8(depth2) shape=blockquote[…,mathBlock,paragraph] | paragraph  ← 又被 join 回引用块
 * BS#3: 同 BS#1 ……                                                          ← 结构与光标回到原点，净变化 0
 * ```
 * 即「lift 出容器 ↔ 下一次 Backspace 又 join 回容器」来回抵消 = 用户看到的横跳。
 * 对照：前一块是**普通段落**时第 2 次不会重新 join（`blockquote[甲,乙,*空*]` 实测稳定），
 * 故该振荡只在「**atom + 其后空段落**」组合出现。
 *
 * **修复后**：空行被直接删除（一次按键 = 一次单调变化），光标落到上一行文字末尾；
 * 公式节点不受影响，后续 Backspace 交回浏览器默认（删除字符）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'
import { MathBlockExtension } from './extensions/MathBlockExtension'

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

/** 块结构摘要（含文本，便于断言"内容没被改动"） */
function shape(ed: Editor): string {
  const parts: string[] = []
  ed.state.doc.forEach((n) => {
    if (n.type.name === 'blockquote') {
      const inner = n.content.content
        .map((c) => `${c.type.name}${c.textContent ? `(${c.textContent})` : ''}`)
        .join(',')
      parts.push(`blockquote[${inner}]`)
    } else parts.push(`${n.type.name}${n.textContent ? `(${n.textContent})` : ''}`)
  })
  return parts.join(' | ')
}

type Step = { shape: string; from: number; depth: number; tx: number; changed: number }

/** 把光标放到 refBlockquote 内最后一个空段落，逐次按 Backspace 并记录快照 */
function pressBackspace(
  doc: unknown,
  times: number,
  opts: { caret?: 'last-empty' | 'last-textblock-end' } = {},
): { steps: Step[]; editor: Editor; md0: string; initialShape: string } {
  const ed = new Editor({ extensions: EXT, content: doc as never })
  let target = -1
  if (opts.caret === 'last-textblock-end') {
    ed.state.doc.descendants((n, pos) => {
      if (n.isTextblock) target = pos + Math.max(1, n.content.size)
    })
  } else {
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'paragraph' && n.textContent === '') target = pos + 1
    })
  }
  if (target < 0) throw new Error('测试构造错误：找不到光标落点')
  ed.commands.setTextSelection(target)
  const md0 = ed.getMarkdown()
  const initialShape = shape(ed)
  const steps: Step[] = []
  for (let i = 0; i < times; i++) {
    let tx = 0
    let changed = 0
    const counter = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      tx += 1
      if (transaction.docChanged) changed += 1
    }
    ed.on('transaction', counter)
    ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    ed.off('transaction', counter)
    steps.push({ shape: shape(ed), from: ed.state.selection.from, depth: ed.state.selection.$from.depth, tx, changed })
  }
  return { steps, editor: ed, md0, initialShape }
}

describe('task-59：引用块内空段落 Backspace 不得横跳', () => {
  it('用户结构 blockquote[段落, mathBlock, 空段落]：Backspace 删除该空行且**单调**（不回弹、不删公式）', () => {
    const { steps, editor, md0, initialShape } = pressBackspace(
      { type: 'doc', content: [{ type: 'blockquote', content: [P('引理1'), MATH, P()] }] },
      3,
    )
    const md1 = editor.getMarkdown()

    // ① 第一次：空段落被删除（1 次有意义变化；事务数 ≤ 2 防风暴）
    expect(steps[0].changed, `第 1 次 Backspace 应有且仅有 1 次结构变化：${JSON.stringify(steps[0])}`).toBe(1)
    expect(steps[0].tx, '第 1 次 Backspace 事务数应 ≤ 2').toBeLessThanOrEqual(2)
    expect(steps[0].shape).toBe('blockquote[paragraph(引理1),mathBlock] | paragraph')
    expect(steps[0].shape, '第一次按键必须产生进展（修前是 lift，本修后是删除空行）').not.toBe(initialShape)

    // ② 单调：**不得回到初始形态**（修前的横跳正是 A→B→A），且后续按键保持稳定
    for (const [i, s] of steps.entries()) {
      expect(s.shape, `第 ${i + 1} 次按键回到初始结构 = 横跳：${JSON.stringify(steps)}`).not.toBe(initialShape)
      expect(s.tx, `单次按键事务数应 ≤ 3（防风暴）：${JSON.stringify(s)}`).toBeLessThanOrEqual(3)
    }
    expect(steps[1].shape).toBe(steps[0].shape)
    expect(steps[2].shape).toBe(steps[0].shape)

    // ③ 公式保真：mathBlock 仍在、latex 未变、引理1 文本未被改动
    expect(steps[0].shape).toContain('mathBlock')
    expect(JSON.stringify(editor.getJSON())).toContain('a ≤ b')
    expect(md1).toContain('> $$\n> a ≤ b\n> $$')
    // ④ 空引用行已从 markdown 消失（修前 md 末尾残留 `>\n>` 空行）
    expect(md0).toContain('>\n>')
    expect(md1.trimEnd().endsWith('> $$')).toBe(true)

    editor.destroy()
  })

  it('对照：引用块内普通段落之间按 Backspace（非 atom）→ 默认行为不变、同样不回弹', () => {
    const { steps, editor, initialShape } = pressBackspace(
      { type: 'doc', content: [{ type: 'blockquote', content: [P('甲'), P('乙'), P()] }] },
      3,
    )
    expect(steps[0].shape).toBe('blockquote[paragraph(甲),paragraph(乙)] | paragraph')
    expect(steps[0].shape).not.toBe(initialShape)
    for (const s of steps) expect(s.shape, `对照出现回弹：${JSON.stringify(steps)}`).not.toBe(initialShape)
    expect(steps[1].shape).toBe(steps[0].shape)
    expect(steps[2].shape).toBe(steps[0].shape)
    editor.destroy()
  })

  it('对照：文档末尾空段落（前一块是普通段落）→ 原默认行为不变', () => {
    const { steps, editor } = pressBackspace({ type: 'doc', content: [P('x'), P()] }, 2)
    // 默认 joinBackward：空段落并进上一段 → paragraph(x)，之后稳定
    expect(steps[0].shape).toBe('paragraph(x)')
    expect(steps[1].shape).toBe(steps[0].shape)
    editor.destroy()
  })

  it('文档级空段落紧跟「以 atom 结尾的引用块」：**记录现状**（不经本修分支，防新增破坏路径）', () => {
    const { steps, editor } = pressBackspace(
      { type: 'doc', content: [{ type: 'blockquote', content: [P('引理1'), MATH] }, P()] },
      2,
    )
    // 说明：该位置不在用户复现路径上；本修**不接管**（默认 ProseMirror 行为）。
    // 断言仅锁「不因本修引入新破坏」：引用块仍在、blockquote 内的段落文本不变。
    expect(steps[0].shape).toContain('blockquote[paragraph(引理1)')
    expect(editor.getJSON()).toBeTruthy()
    editor.destroy()
  })

  it('非空段落不受影响：Backspace 不触发新分支（不误删段落/公式）', () => {
    const { steps, editor, initialShape } = pressBackspace(
      { type: 'doc', content: [{ type: 'blockquote', content: [P('引理1'), MATH, P('正文')] }] },
      1,
      { caret: 'last-textblock-end' },
    )
    expect(steps[0].changed, '非空段落上不得发生结构删除').toBe(0)
    expect(steps[0].shape).toBe(initialShape)
    expect(JSON.stringify(editor.getJSON())).toContain('a ≤ b')
    editor.destroy()
  })
})
