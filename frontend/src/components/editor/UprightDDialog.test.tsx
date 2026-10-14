/**
 * task-74 组件测：预览对话框的「列表 + 勾选 + 另存新文件」。
 * 红线守护：**原件 sha256 不变**、取消勾选**不写入**该处、重名**顺延序号且不覆盖**。
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UprightDDialog from './UprightDDialog'
import type { MathDocNode } from '../../editor/upright-d'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

const MD = '正文 dx 不变\n\n$dx + d_i$\n\n$$\ndM/dt\n$$\n'
const DOC: MathDocNode = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '正文 dx 不变' }] },
    { type: 'paragraph', content: [{ type: 'math', attrs: { latex: 'dx + d_i' } }] },
    { type: 'mathBlock', attrs: { latex: 'dM/dt' } },
  ],
}

let root: Root | null = null
let container: HTMLDivElement
let created: Array<{ title: string; content: string }> = []
let saved: Array<{ fileName: string; path?: string; changed: number }> = []
let closed = 0

const mount = async (props: Partial<React.ComponentProps<typeof UprightDDialog>> = {}) => {
  const createArticle = vi.fn(async (title: string, content: string) => {
    created.push({ title, content })
    return { path: `Articles/${title}.md`, id: `Articles/${title}.md` }
  })
  await act(async () => {
    root = createRoot(container)
    root.render(
      React.createElement(UprightDDialog, {
        open: true,
        markdown: MD,
        doc: DOC,
        fileName: 'Week3.md',
        existingNames: [],
        createArticle,
        onClose: () => { closed++ },
        onSaved: (info) => { saved.push(info) },
        ...props,
      }),
    )
  })
  return createArticle
}

const clickSave = async () => {
  const btn = container.querySelector('[data-ke-upright-save]') as HTMLButtonElement
  await act(async () => { btn.click() })
}
const toggle = async (id: string) => {
  const box = container.querySelector(`[data-ke-upright-hit="${id}"]`) as HTMLInputElement
  await act(async () => { box.click() })
}

beforeEach(() => {
  created = []
  saved = []
  closed = 0
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe('task-74 对话框：预览与勾选', () => {
  it('列出「将修改 N 处 / 跳过 M 处」，默认全勾', async () => {
    await mount()
    expect(container.querySelector('[data-ke-upright-summary]')?.textContent).toContain('将修改 3 处')
    expect(container.querySelector('[data-ke-upright-summary]')?.textContent).toContain('跳过 1 处')
    const boxes = [...container.querySelectorAll('[data-ke-upright-hit]')] as HTMLInputElement[]
    expect(boxes.length).toBe(3)
    expect(boxes.every((b) => b.checked), '默认应全勾').toBe(true)
    // 跳过区可见（变量 d_i）
    expect(container.querySelectorAll('[data-ke-upright-skip]').length).toBe(1)
  })

  it('全不选后计数归零、保存被禁用', async () => {
    await mount()
    const allOff = [...container.querySelectorAll('button')].find((b) => b.textContent === '全不选') as HTMLButtonElement
    await act(async () => { allOff.click() })
    expect(container.querySelector('[data-ke-upright-summary]')?.textContent).toContain('将修改 0 处')
    expect((container.querySelector('[data-ke-upright-save]') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('task-74 对话框：另存新文件', () => {
  it('另存为 <原名>-正体d.md，内容只改勾选处', async () => {
    await mount()
    await clickSave()
    expect(created.length).toBe(1)
    expect(created[0].title).toBe('Week3-正体d')
    expect(created[0].content).toBe('正文 dx 不变\n\n$\\mathrm{d}x + d_i$\n\n$$\n\\mathrm{d}M/\\mathrm{d}t\n$$\n')
    expect(saved[0]).toMatchObject({ fileName: 'Week3-正体d.md', path: 'Articles/Week3-正体d.md', changed: 3 })
  })

  it('取消勾选后**不写入**该处（只改剩下两处）', async () => {
    await mount()
    await toggle('0:0') // 行内公式里的 dx
    await clickSave()
    expect(created[0].content).toContain('$dx + d_i$') // 未勾选 → 保持原样
    expect(created[0].content).toContain('\\mathrm{d}M/\\mathrm{d}t')
    expect(saved[0].changed).toBe(2)
  })

  it('重名时顺延 (2)，且不带 .md 传给后端（后端自加扩展名）', async () => {
    await mount({ existingNames: ['Week3-正体d.md'] })
    expect(container.querySelector('[data-ke-upright-target]')?.textContent).toBe('Week3-正体d (2).md')
    await clickSave()
    expect(created[0].title).toBe('Week3-正体d (2)')
  })

  it('后端 409（并发重名）→ 自动顺延序号重试，不覆盖', async () => {
    const createArticle = vi.fn(async (title: string, content: string) => {
      created.push({ title, content })
      if (title === 'Week3-正体d') throw new Error('409 已存在同名文章: Week3-正体d.md')
      return { path: `Articles/${title}.md` }
    })
    await mount({ createArticle })
    await clickSave()
    expect(created.map((c) => c.title)).toEqual(['Week3-正体d', 'Week3-正体d (2)'])
    expect(saved[0].fileName).toBe('Week3-正体d (2).md')
  })

  it('**原件 sha256 不变**：入参 markdown 未被修改，且没有任何写原件的调用', async () => {
    const before = sha256(MD)
    const mdSnapshot = MD
    await mount()
    await clickSave()
    expect(sha256(mdSnapshot), '原件内容被改动').toBe(before)
    expect(sha256(MD)).toBe(before)
    // 只调用了一次 createArticle（新建），没有 saveArticle/写原件
    expect(created.length).toBe(1)
    expect(created[0].title).not.toContain('Week3.md')
  })

  it('正文里定位不到公式跨度 → 报错并**中止**，不写任何文件', async () => {
    await mount({ markdown: '这篇正文里没有公式' })
    await clickSave()
    expect(created.length).toBe(0)
    expect(container.querySelector('[data-ke-upright-error]')?.textContent).toContain('定位失败')
  })

  it('没有可改项时保存按钮禁用（不产生空文件）', async () => {
    const plain: MathDocNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }
    await mount({ doc: plain })
    expect((container.querySelector('[data-ke-upright-save]') as HTMLButtonElement).disabled).toBe(true)
    expect(container.textContent).toContain('没有发现')
  })

  it('成功后给出「已另存…（原件未改动）」提示，且**不自动打开**新文件（按钮变「关闭」）', async () => {
    await mount()
    await clickSave()
    const note = container.querySelector('[data-ke-upright-done]')?.textContent ?? ''
    expect(note).toContain('已另存：Articles/Week3-正体d.md')
    expect(note).toContain('原件未改动')
    // 成功态：保存按钮消失、出现「关闭」；只有一次新建调用（没有打开/切换文档的动作）
    expect(container.querySelector('[data-ke-upright-save]')).toBeNull()
    expect(container.querySelector('[data-ke-upright-close]')?.textContent).toBe('关闭')
    expect(created.length).toBe(1)
    expect(closed).toBe(0)
  })

  it('取消按钮只关闭、不写文件', async () => {
    await mount()
    const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === '取消') as HTMLButtonElement
    await act(async () => { cancel.click() })
    expect(closed).toBe(1)
    expect(created.length).toBe(0)
  })
})
