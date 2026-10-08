/**
 * task-61：空公式不得静默消失 / 不得留下空块（数据安全）+ 清理 MathLive 死按钮。
 *
 * 事故指纹 = 文件里出现
 * ```
 * $$
 *
 * $$
 * ```
 * 那是 `MathBlockExtension.renderMarkdown` 对 **latex 为空** 的 mathBlock 的序列化结果。
 * 本套件钉三件事：
 *  ① **解析**遇空 `$$` 块**不产生** mathBlock 节点（退化为字面文本段落）→ 不会凭空造出空块；
 *  ② **编辑期**留下的空 mathBlock 在**保存前**被清掉（`pruneEmptyMathBlocks`），
 *     且正在弹窗编辑的那个必须保留；非空公式（含 `\tag`/`align`）一律不动；
 *  ③ **清空有内容的公式**不得静默删除：弹窗先 `askConfirm` 确认（删除本身单事务、Ctrl+Z 可撤销）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'
import { KeListItem, OrderedListParenExtension } from './extensions/ListExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { MathExtension } from './extensions/MathExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'
import { KE_VERSION, withFrontmatter } from './ke'
import { setKeContent } from './index'
import { pruneEmptyMathBlocks } from './math/emptyBlocks'
import MathEditorModal from '../components/editor/MathEditorModal'

const CS = vi.hoisted(() => ({ confirmResult: true, confirmMessages: [] as string[] }))
vi.mock('../components/common/PromptDialog', () => ({
  askConfirm: async (msg: string) => {
    CS.confirmMessages.push(msg)
    return CS.confirmResult
  },
  askPrompt: async () => null,
  PromptRoot: (props: { children?: unknown }) => props.children,
  PromptHost: () => null,
  usePrompt: () => async () => null,
}))

const EXTENSIONS = [
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    document: false,
    blockquote: false,
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  KeBlockquote,
  OrderedListParenExtension,
  KeListItem,
  MathExtension,
  MathBlockExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
] as never

function makeEditor(md = ''): Editor {
  const ed = new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
  if (md) setKeContent(ed, md)
  return ed
}

/** 文档里所有 mathBlock 的 latex */
function mathBlocks(ed: Editor): string[] {
  const out: string[] = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'mathBlock') out.push((n.attrs.latex as string) ?? '')
  })
  return out
}

describe('task-61 ① 解析：空 `$$` 块不得变成 mathBlock 节点', () => {
  const cases: Array<[string, string]> = [
    ['0 字符（两空行）', '正文\n\n$$\n\n$$\n\n结尾\n'],
    ['相邻定界符', '正文\n\n$$\n$$\n\n结尾\n'],
    ['仅空白', '正文\n\n$$  \n  \n$$\n\n结尾\n'],
    ['列表项内', '1. 文本\n   $$\n   \n   $$\n'],
    ['引用块内', '> 引理\n>\n> $$\n>\n> $$\n'],
    ['表格单元格内', '| a |\n| --- |\n| $$ |\n| $$ |\n'],
    ['连续多个空块', '$$\n\n$$\n\n$$\n\n$$\n'],
  ]
  for (const [label, md] of cases) {
    it(`${label}：不产生 mathBlock，且内容以字面文本保留`, () => {
      const ed = makeEditor(md)
      expect(mathBlocks(ed), `凭空造出空 mathBlock：${JSON.stringify(mathBlocks(ed))}`).toEqual([])
      // 字面 `$$` 仍在文档里（不丢内容）
      expect(ed.state.doc.textContent).toContain('$$')
      ed.destroy()
    })
  }

  it('仅注释的空块：会解析为 mathBlock（latex 非空），不算空节点 —— 记录现状', () => {
    const ed = makeEditor('正文\n\n$$\n% comment\n$$\n\n结尾\n')
    expect(mathBlocks(ed)).toEqual(['% comment'])
    ed.destroy()
  })
})

describe('task-61 ② 保存前清理空 mathBlock（pruneEmptyMathBlocks）', () => {
  it('Mod-m 式插入的空 mathBlock：清理后文档与 markdown 都不再含 `$$` 块', () => {
    const ed = makeEditor('正文\n')
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'mathBlock', attrs: { latex: '', id: 'm1' } })
    expect(mathBlocks(ed), '前提：插入后确实存在空 mathBlock').toEqual([''])
    expect(ed.getMarkdown()).toContain('$$')

    expect(pruneEmptyMathBlocks(ed, null)).toBe(true)
    expect(mathBlocks(ed)).toEqual([])
    const md = ed.getMarkdown()
    expect(md, `空块被写进文件：${JSON.stringify(md)}`).not.toContain('$$')
    expect(withFrontmatter(md, KE_VERSION)).not.toContain('$$')
    // 幂等：再清一次无事发生
    expect(pruneEmptyMathBlocks(ed, null)).toBe(false)
    ed.destroy()
  })

  it('正在弹窗编辑的空块（keepId）必须保留；非空公式（`\\tag`/`align`）一律不动', () => {
    const ed = new Editor({
      extensions: EXTENSIONS,
      content: {
        type: 'doc',
        content: [
          { type: 'mathBlock', attrs: { latex: '', id: 'editing' } },
          { type: 'mathBlock', attrs: { latex: '', id: 'orphan' } },
          { type: 'mathBlock', attrs: { latex: 'a+b=0 \\tag{1}', id: 'tagged' } },
        ],
      },
    })
    expect(mathBlocks(ed).length, `构造失败：${JSON.stringify(mathBlocks(ed))}`).toBe(3)

    expect(pruneEmptyMathBlocks(ed, 'editing')).toBe(true)
    const left = mathBlocks(ed)
    expect(left, `保留策略不对：${JSON.stringify(left)}`).toEqual(['', 'a+b=0 \\tag{1}'])
    expect(ed.getMarkdown()).toContain('\\tag{1}')
    ed.destroy()
  })

  it('「打开含字面空 `$$` 的文档 → 不编辑 → 保存」：不新增/删除空块，内容仅 EOF 规范化', () => {
    for (const md of ['正文\n\n$$\n\n$$\n\n结尾\n', '$$\n\n$$\n\n$$\n\n$$\n', '> 引理\n>\n> $$\n>\n> $$\n']) {
      const ed = makeEditor(md)
      pruneEmptyMathBlocks(ed, null) // 保存路径会调用
      const out = ed.getMarkdown()
      expect(mathBlocks(ed)).toEqual([])
      expect(out.trimEnd(), `内容漂移：in=${JSON.stringify(md)} out=${JSON.stringify(out)}`).toBe(md.trimEnd())
      expect(Math.abs(out.length - md.length)).toBeLessThanOrEqual(1)
      expect(makeEditor(out).getMarkdown(), '重复保存不得继续漂移').toBe(out)
      ed.destroy()
    }
  })

  it('行内公式不受影响（`$…$` 为空也不删，空行内本就没有块语义）', () => {
    const ed = makeEditor('正文 $x$ 结尾\n')
    expect(pruneEmptyMathBlocks(ed, null)).toBe(false)
    expect(ed.getMarkdown()).toContain('$x$')
    ed.destroy()
  })
})

describe('task-61 ③ 清空有内容的公式：必须确认（且删除可撤销）', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    CS.confirmResult = true
    CS.confirmMessages = []
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = null
    container.remove()
    vi.restoreAllMocks()
  })

  async function openModal(initialValue: string): Promise<{ onSave: ReturnType<typeof vi.fn>; onDeleteEmpty: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> }> {
    const onSave = vi.fn()
    const onDeleteEmpty = vi.fn()
    const onClose = vi.fn()
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <MathEditorModal open initialValue={initialValue} isBlock onSave={onSave} onDeleteEmpty={onDeleteEmpty} onClose={onClose} />,
      )
    })
    return { onSave, onDeleteEmpty, onClose }
  }

  /** 清空 textarea（React onChange）后按 Esc 或点「完成」 */
  async function clearAndSave(how: 'done' | 'esc'): Promise<void> {
    const ta = document.querySelector('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(ta, '')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      if (how === 'esc') {
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      } else {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '完成')
        btn!.click()
      }
      // askConfirm 的 Promise + double-rAF
      for (let i = 0; i < 6; i++) await Promise.resolve()
      await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))
    })
  }

  it('清空有内容的公式 + 点「完成」：先确认；取消 → 不删除、不关闭', async () => {
    CS.confirmResult = false
    const { onDeleteEmpty, onClose } = await openModal('a+b=0 \\tag{1}')
    await clearAndSave('done')
    expect(CS.confirmMessages.length, '未弹确认 = 静默删除').toBe(1)
    expect(CS.confirmMessages[0]).toContain('删除')
    expect(onDeleteEmpty).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('清空有内容的公式 + 点「完成」：确认后删除', async () => {
    const { onDeleteEmpty, onClose } = await openModal('a+b=0 \\tag{1}')
    await clearAndSave('done')
    expect(CS.confirmMessages.length).toBe(1)
    expect(onDeleteEmpty).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('清空有内容的公式 + **Esc**：同一条确认闸门（Esc 与「完成」不是两条路）', async () => {
    CS.confirmResult = false
    const { onDeleteEmpty } = await openModal('a+b=0 \\tag{1}')
    await clearAndSave('esc')
    expect(CS.confirmMessages.length, 'Esc 绕过确认 = 静默删除').toBe(1)
    expect(onDeleteEmpty).not.toHaveBeenCalled()
  })

  it('新建（initialValue 为空）的清空保存：无内容可丢 → 不打扰用户，直接删除', async () => {
    const { onDeleteEmpty } = await openModal('')
    await clearAndSave('done')
    expect(CS.confirmMessages).toEqual([])
    expect(onDeleteEmpty).toHaveBeenCalledTimes(1)
  })

  it('task-61 ④：MathLive 死按钮已移除（不再出现「可视化编辑」）', async () => {
    await openModal('a+b')
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).not.toContain('可视化编辑')
    expect(labels).not.toContain('源码编辑')
    expect(labels).toContain('完成')
  })
})
