/**
 * task-51（v1.2.1）：列表回车异常 —— 空项退出残留缩进 / 再回车删整行。
 *
 * 根因：`KeListItem` 自定义 Enter 用**模块级可变标志** `continuationEmpty` 决定
 * 「再插一个空项」还是「liftListItem」——标志不来自文档状态、跨文档/跨会话残留
 * → 行为不可预测；且残留结构导致后续 Enter「删整行」。
 *
 * 期望：非空项 Enter → 新起一项；**空项 Enter → 干净退出列表**（无残留缩进，光标落在
 * 列表外普通空段落）；该空段落上 Enter → 普通换行（不删整行）；嵌套/引用块内 → 退到上一层。
 *
 * 先红：1-1（第二步应只剩 2 项 + 列表外空段落）、1-2（第三步不得删整行）、3-1（跨文档可预测）。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { KeListItem, OrderedListParenExtension } from './extensions/ListExtension'
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'

const EXTENSIONS = [
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    document: false,
    blockquote: false,
    link: { openOnClick: false, autolink: true },
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  KeBlockquote,
  OrderedListParenExtension,
  KeListItem,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((ed) => ed.destroy())
})

function makeEditor(md: string): Editor {
  const ed = new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
  ed.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
  editors.push(ed)
  return ed
}

/** 触发真实 Enter 键路径（ProseMirror keymap，含扩展的 addKeyboardShortcuts） */
function pressEnter(ed: Editor): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  return !!ed.view.someProp('handleKeyDown', (f) => f(ed.view, event) || undefined)
}

/** 把光标放到第 n 个 listItem 的内容末尾 */
function caretAtEndOfItem(ed: Editor, n: number): void {
  let count = 0
  let target = -1
  ed.state.doc.descendants((node, pos) => {
    if (target >= 0) return false
    if (node.type.name === 'listItem') {
      count++
      if (count === n) target = pos + node.nodeSize - 2
    }
    return true
  })
  if (target < 0) throw new Error(`未找到第 ${n} 个 listItem`)
  ed.commands.setTextSelection(target)
}

const childTypes = (ed: Editor): string[] =>
  (ed.getJSON() as { content?: Array<{ type: string }> }).content?.map((n) => n.type) ?? []

const listItems = (ed: Editor): string[] => {
  const out: string[] = []
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'listItem') out.push(node.textContent)
    return true
  })
  return out
}

const LIST_MD = '1. a\n2. b\n'

describe('1. 复现用例（先红）：三步 Enter', () => {
  it('1-1 第一步：非空项 Enter → 新起第 3 项（空）', () => {
    const ed = makeEditor(LIST_MD)
    caretAtEndOfItem(ed, 2)
    expect(pressEnter(ed)).toBe(true)
    expect(listItems(ed)).toEqual(['a', 'b', ''])
    expect(ed.getMarkdown()).toContain('3.')
    ed.destroy()
  })

  it('1-2 第二步：空项 Enter → 干净退出列表（只剩 2 项 + 列表外一个空段落，无残留空项/缩进）', () => {
    const ed = makeEditor(LIST_MD)
    caretAtEndOfItem(ed, 2)
    pressEnter(ed) // → 3. 空项
    pressEnter(ed) // → 期望：干净退出列表
    expect(listItems(ed)).toEqual(['a', 'b']) // 空项已消失，无残留
    expect(childTypes(ed)[0]).toBe('orderedList')
    expect(childTypes(ed)[1]).toBe('paragraph') // 列表后跟普通空段落（trailingNode 亦保证文末有段落）
    expect(ed.getMarkdown()).not.toContain('3.')
    // 空项已从列表移除（不是被"缩进残留"成第 3 项）
    expect(listItems(ed)).toEqual(['a', 'b'])
    ed.destroy()
  })

  it('1-3 第三步：空段落上 Enter → 普通换行（两个空段落），不得删整行', () => {
    const ed = makeEditor(LIST_MD)
    caretAtEndOfItem(ed, 2)
    pressEnter(ed)
    pressEnter(ed)
    const beforeListItems = listItems(ed)
    const paragraphsBefore = childTypes(ed).filter((t) => t === 'paragraph').length
    pressEnter(ed) // 光标此时在列表外的空段落里
    expect(listItems(ed)).toEqual(beforeListItems) // 列表未被删/未变
    expect(childTypes(ed)[0]).toBe('orderedList')
    // 普通换行：新增一个空段落（不得删整行）
    expect(childTypes(ed).filter((t) => t === 'paragraph').length).toBe(paragraphsBefore + 1)
    ed.destroy()
  })

  it('1-4 序列化：每步 getMarkdown() 无语义漂移（无 `- [ ]`、无额外层级）', () => {
    const ed = makeEditor(LIST_MD)
    caretAtEndOfItem(ed, 2)
    const step1 = (pressEnter(ed), ed.getMarkdown())
    expect(step1.startsWith('1. a\n2. b\n3. ')).toBe(true)
    const step2 = (pressEnter(ed), ed.getMarkdown())
    expect(step2.startsWith('1. a\n2. b\n')).toBe(true)
    expect(step2).not.toContain('3.')
    const step3 = (pressEnter(ed), ed.getMarkdown())
    expect(step3.startsWith('1. a\n2. b\n')).toBe(true)
    for (const md of [step1, step2, step3]) {
      expect(md).not.toContain('- [ ]')
      expect(md).not.toContain('4.')
    }
    ed.destroy()
  })
})

describe('2. 不可预测性回归：不依赖跨文档/跨会话标志', () => {
  it('2-1 两个全新编辑器跑同一序列 → 结果逐字节一致', () => {
    const run = (): string[] => {
      const ed = makeEditor(LIST_MD)
      caretAtEndOfItem(ed, 2)
      const out = [pressEnter(ed), pressEnter(ed), pressEnter(ed)].map(() => ed.getMarkdown())
      ed.destroy()
      return out
    }
    expect(run()).toEqual(run())
  })

  it('2-2 交替文档（模拟切换）不串味：A 序列不受 B 的按键历史影响', () => {
    const a = makeEditor(LIST_MD)
    caretAtEndOfItem(a, 2)
    pressEnter(a) // A：留下空项（历史标志若存在会被置位）
    const b = makeEditor(LIST_MD)
    caretAtEndOfItem(b, 2)
    pressEnter(b) // B 的第一步（在旧实现里会被 A 的历史影响 → 行为不同）
    expect(listItems(b)).toEqual(['a', 'b', '']) // 新文档第一步必须是「新起一项」
    a.destroy()
    b.destroy()
  })
})

describe('3. 不删列表 / 其它项逐字节不变', () => {
  it('3-1 退出后原列表其余项与原文逐字节一致', () => {
    const ed = makeEditor('1. 第一项\n2. 第二项\n')
    caretAtEndOfItem(ed, 2)
    pressEnter(ed)
    pressEnter(ed)
    expect(ed.getMarkdown().startsWith('1. 第一项\n2. 第二项\n')).toBe(true)
    expect(listItems(ed)).toEqual(['第一项', '第二项'])
    ed.destroy()
  })
})

describe('4. 嵌套 / 引用块', () => {
  it('4-1 嵌套列表：空项 Enter 退到上一层（不拆坏父列表）', () => {
    const ed = makeEditor('1. 父\n   1. 子\n')
    expect(listItems(ed)).toEqual(['父子', '子']) // 外层项 textContent 含嵌套子项
    caretAtEndOfItem(ed, 2) // 内层「子」项
    expect(pressEnter(ed)).toBe(true) // → 新空子项
    expect(pressEnter(ed)).toBe(true) // → 退出内层（回到父项内）
    const md = ed.getMarkdown()
    expect(md.startsWith('1. 父\n   1. 子')).toBe(true) // 父级与内层原项保留
    expect(md).not.toContain('   2.') // 内层空项已退出（未残留成第 2 个嵌套项）
    expect(childTypes(ed)[0]).toBe('orderedList') // 外层列表未被拆掉
    ed.destroy()
  })

  it('4-2 引用块内列表：空项 Enter 退出到引用块内普通段落，父级引用块不坏', () => {
    const ed = makeEditor('> 1. a\n> 2. b\n')
    caretAtEndOfItem(ed, 2)
    pressEnter(ed)
    pressEnter(ed)
    const md = ed.getMarkdown()
    expect(md.startsWith('> 1. a\n> 2. b')).toBe(true) // 两项与引用块保留
    expect(md).not.toContain('> 3.') // 空项未残留为列表项
    ed.destroy()
  })
})
describe('6. 只含公式的列表项（atom 的 textContent 为空串 —— 用户实测那条列表）', () => {
  it('6-1 在 `2. $b$` 上 Enter → 新增第 3 项，不得把第 2 项提出列表', () => {
    const ed = makeEditor('1. $a$\n2. $b$\n\n后文\n')
    caretAtEndOfItem(ed, 2)
    expect(pressEnter(ed)).toBe(true)
    // 注意：atom（行内公式）在 PM 里的 textContent 是 latex 文本（含 $），不是空串 ——
    // 所以断言写实际值；关键是「三项」而不是「两项 + 列表外段落」。
    expect(listItems(ed)).toEqual(['$a$', '$b$', ''])       // 三项，且第 2 项内容未被提出
    expect(ed.getMarkdown()).toContain('3.')
    expect(childTypes(ed)).toEqual(['orderedList', 'paragraph'])  // 列表仍在（没被拆）、后文段落仍在
    ed.destroy()
  })

  it('6-2 再 Enter（真空项）→ 干净退出列表（2 项 + 列表外空段落）', () => {
    const ed = makeEditor('1. $a$\n2. $b$\n\n后文\n')
    caretAtEndOfItem(ed, 2)
    pressEnter(ed)
    pressEnter(ed)
    expect(listItems(ed)).toEqual(['$a$', '$b$'])
    expect(childTypes(ed)[0]).toBe('orderedList')
    expect(childTypes(ed)[1]).toBe('paragraph')
    expect(ed.getMarkdown()).not.toContain('3.')
    ed.destroy()
  })
})
