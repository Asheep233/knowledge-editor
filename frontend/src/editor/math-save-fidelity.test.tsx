/**
 * task-60 写入链保真：① 公式弹窗「打开 → 直接保存 = 逐字节不变」；
 * ② 编辑器「打开 → 保存载荷 = 与原文逐字节等价」（不做任何编辑）。
 *
 * 背景：真机事故是**写入链把内容丢了**（文件里 `\tag` 0 次、备份里 1 次；
 * 现场 234-238 行只剩空 `$$` + `**2.2.2**`）。解析/渲染已由 `math-tag.test.ts` 钉住，
 * 本文件把责任面收窄到「弹窗回写」与「自动保存载荷」两条写入路径。
 *
 * 结论（实测，见回报）：两条路径在当前代码下**都是字节保真**的 ——
 * 弹窗 `MathEditorModal` 是纯 LaTeX textarea（`stripSlots` 只去槽位符 `□`，`trim()` 只去首尾空白），
 * MathLive **未被任何源码 import**（package.json 里有依赖，但 `src/` 无引用；`math-field`
 * 仅作为粘贴解析的 `parseHTML` 规则存在）→ 「MathLive 归一化吃掉 `\tag`」在当前代码里不成立。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'
import { KeListItem, OrderedListParenExtension } from './extensions/ListExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { MathExtension } from './extensions/MathExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'
import { KE_VERSION, withFrontmatter } from './ke'
import { setKeContent } from './index'
import MathEditorModal from '../components/editor/MathEditorModal'

const EXTENSIONS = [
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
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
  ImageMarkdownExtension,
  MathExtension,
  MathBlockExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
] as never

/** 用户现场正文（列表项内缩进 3 空格的 `$$` + `\tag{2.2.2.1}`） */
const USER_BODY = `1. 如果复数$x$满足多项式方程：\n   $$\n   a_0x^n+a_1x^{n-1}+…+a_{n-1}x+a_n=0 \\tag{2.2.2.1}\n   $$\n`
const TAG_LATEX = 'a_0x^n+a_1x^{n-1}+\\cdots+a_{n-1}x+a_n=0 \\tag{2.2.2.1}'

/** 编辑器：灌入 → 不做编辑 → 取保存载荷 */
function savePayload(body: string): { payload: string; body: string } {
  const ed = new Editor({ extensions: EXTENSIONS, content: '', contentType: 'markdown' })
  setKeContent(ed, body)
  const md = ed.getMarkdown()
  const payload = withFrontmatter(md, KE_VERSION)
  ed.destroy()
  return { payload, body: md }
}

describe('task-60 ② 编辑器「打开 → 保存载荷」字节保真', () => {
  it('用户现场正文：保存载荷与「原文直接过 withFrontmatter」逐字节一致', () => {
    const { payload, body } = savePayload(USER_BODY)
    // 内容逐字节一致（公式本体 / \tag / 3 空格列表缩进 / 换行风格全保留）
    expect(body.slice(0, USER_BODY.length)).toBe(USER_BODY)
    // 唯一差异：**EOF 一次性规范化**（结尾补一个空行），且**不累积**（见下一用例）
    expect(body).toBe(USER_BODY + '\n')
    expect(payload).toBe(withFrontmatter(USER_BODY + '\n', KE_VERSION))
  })

  it('幂等：连续两次「打开→保存」载荷不再变化（自动保存不会越存越坏）', () => {
    const first = savePayload(USER_BODY)
    expect(first.body).toBe(USER_BODY + '\n')
    // 第二轮、第三轮用上一轮落盘的**正文**再走一遍（模拟后续自动保存）
    const second = savePayload(first.body)
    const third = savePayload(second.body)
    expect(second.body, `第二轮=${JSON.stringify(second.body)}`).toBe(first.body)
    expect(third.body).toBe(first.body)
    expect(second.payload).toBe(first.payload)
    expect(third.payload).toBe(first.payload)
  })

  it('`\\tag` 与公式本体在保存载荷中原样保留（含 3 空格列表缩进）', () => {
    const { payload } = savePayload(USER_BODY)
    expect(payload).toContain('   $$\n   a_0x^n+a_1x^{n-1}+…+a_{n-1}x+a_n=0 \\tag{2.2.2.1}\n   $$')
  })

  it('同类构造：align + 多 tag、`\\prec`、行内 `\\tag` 均字节保真', () => {
    const cases = [
      '正文\n\n$$\n\\begin{aligned}a &= b \\tag{1}\\\\ c &= d \\tag{2}\\end{aligned}\n$$\n',
      '正文 $x \\prec y$ 结尾\n',
      '正文 $a+b=0 \\tag{9}$ 结尾\n',
      '$$\n\\sum_{i=1}^{n} \\lambda_i x_i \\tag{2.2.2.2}\n$$\n',
    ]
    for (const md of cases) {
      const { body, payload } = savePayload(md)
      // 内容（去掉首尾空白后）逐字节一致；EOF 空行由编辑器规范化，最多 ±1 个换行
      expect(body.trimEnd(), `内容不保真: in=${JSON.stringify(md)}\n out=${JSON.stringify(body)}`).toBe(md.trimEnd())
      expect(Math.abs(body.length - md.length), `EOF 规范化超出 1 个字符: in=${JSON.stringify(md.slice(-6))} out=${JSON.stringify(body.slice(-6))}`).toBeLessThanOrEqual(1)
      expect(savePayload(body).body, '重复保存不得继续漂移/增长').toBe(body)
      expect(payload).toBe(withFrontmatter(body, KE_VERSION))
    }
  })
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('task-60 ① 公式弹窗「打开 → 直接保存」字节保真', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
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

  /** 渲染弹窗 → 点「完成」→ 取 onSave 收到的 latex */
  async function roundTrip(initialValue: string): Promise<{ saved: string | null; deleted: boolean }> {
    // 每个用例独立挂载：先卸载旧 root 并清掉 portal 残留（modal 走 createPortal → document.body）
    await act(async () => {
      root?.unmount()
    })
    root = null
    document.body.querySelectorAll('[data-math-modal]').forEach((n) => n.remove())
    const onSave = vi.fn()
    const onDeleteEmpty = vi.fn()
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <MathEditorModal
          open
          initialValue={initialValue}
          isBlock
          onSave={onSave}
          onDeleteEmpty={onDeleteEmpty}
          onClose={() => undefined}
        />,
      )
    })
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '完成')
    expect(btn, '找不到「完成」按钮').toBeTruthy()
    await act(async () => {
      btn!.click()
      // close(true) 用 double-rAF 提交
      await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))
    })
    return { saved: onSave.mock.calls[0]?.[0] ?? null, deleted: onDeleteEmpty.mock.calls.length > 0 }
  }

  it('`\\tag` 长公式：不改动直接保存 → 逐字节不变', async () => {
    const { saved } = await roundTrip(TAG_LATEX)
    expect(saved).toBe(TAG_LATEX)
  })

  it('align + 多 tag / `\\prec` / 空格式公式：均逐字节不变', async () => {
    for (const latex of [
      '\\begin{aligned}a &= b \\tag{1}\\\\ c &= d \\tag{2}\\end{aligned}',
      'x \\prec y',
      '\\sum_{i=1}^{n}\\lambda_i x_i \\tag{2.2.2.2}',
    ]) {
      const { saved, deleted } = await roundTrip(latex)
      expect(saved, `弹窗改动/丢失了 latex: in=${JSON.stringify(latex)} out=${JSON.stringify(saved)} deleted=${deleted}`).toBe(latex)
    }
  })

  it('记录既有契约：槽位符 `□` 会被 stripSlots 去掉、首尾空白会被 trim（非本次事故路径）', async () => {
    expect((await roundTrip('a+□b')).saved).toBe('a+b')
    expect((await roundTrip('  a+b  ')).saved).toBe('a+b')
  })

  it('记录既有契约：空 latex 保存 = 删除公式（onDeleteEmpty）', async () => {
    const { saved, deleted } = await roundTrip('')
    expect(saved).toBeNull()
    expect(deleted).toBe(true)
  })
})
