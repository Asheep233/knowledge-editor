/** RightPanel「附件」区改造回归（task-9，需求③ A 档 + 列表可收起）。
 *
 * 覆盖点：
 *  1. 附件列表默认收起（表头仍显示「附件 N」+ 刷新按钮），点表头展开
 *  2. 有孤儿附件时，**收起态**只剩一行表头：孤儿琥珀徽章在折叠按钮内可见，
 *     孤儿区块（说明 + 删除按钮）随列表一并收起（task-11 裁决）
 *  3. 点击已引用附件行 → 就地展开「附属情况与附属记录」：引用篇数 + **全部**引用文档（逐条可跳转）
 *  4. 点击未引用附件行 → 显示「未被引用」+ 附件自身详情（全路径 / 大小 / 修改时间）
 *  5. 再次点击同一行 → 收起该行；点另一行 → 切换（同时只展开一行）
 *  6. 既有信息不丢：图标 / 名称 / 大小 / 已引用-未引用徽章 / 孤儿删除按钮 / 底部说明文案（展开态）
 *
 * 本组件只读展示（点击仅跳转回调），不写回任何文档内容 —— 套件内不涉及编辑器/NodeView。
 */
import { act, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import RightPanel from './RightPanel'
import * as api from '../../api/client'
import type { AttachmentItem, OrphanItem } from '../../types'

// 删除孤儿附件走自绘确认框（原生 confirm 在 Tauri 下被替换 → 恒 truthy）：mock 以确保可控
const promptMocks = vi.hoisted(() => ({
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
}))

vi.mock('../common/PromptDialog', () => ({
  askConfirm: promptMocks.askConfirm,
  askPrompt: vi.fn(async () => null),
  usePrompt: () => vi.fn(async () => null),
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

vi.mock('../../api/client', () => ({
  attachmentUrl: (rel: string) => `/api/attachments/${rel}`,
  deleteAttachment: vi.fn(),
  listAttachments: vi.fn(),
  listOrphans: vi.fn(),
  updateArticleMeta: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const T0 = '2026-09-15T10:00:00+08:00'

function attachment(over: Partial<AttachmentItem> & { rel_path: string }): AttachmentItem {
  return {
    name: over.rel_path.split('/').pop() ?? over.rel_path,
    category: 'images',
    size: 2048,
    mtime: T0,
    referenced_by: [],
    ...over,
  }
}

function orphan(over: Partial<OrphanItem> & { path: string }): OrphanItem {
  return {
    name: over.path.split('/').pop() ?? over.path,
    size: 4096,
    mtime: T0,
    ...over,
  }
}

async function setAttachments(items: AttachmentItem[]): Promise<void> {
  vi.mocked(api.listAttachments).mockResolvedValue({ count: items.length, attachments: items })
}

async function setOrphans(items: OrphanItem[]): Promise<void> {
  vi.mocked(api.listOrphans).mockResolvedValue({ count: items.length, orphans: items })
}

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks 不清实现 → 显式重置，避免上一用例数据泄漏
  promptMocks.askConfirm.mockResolvedValue(true)
  vi.mocked(api.listAttachments).mockResolvedValue({ count: 0, attachments: [] })
  vi.mocked(api.listOrphans).mockResolvedValue({ count: 0, orphans: [] })
  vi.mocked(api.deleteAttachment).mockResolvedValue({ deleted: '' })
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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function render(over: Partial<ComponentProps<typeof RightPanel>> = {}): Promise<void> {
  root = createRoot(container)
  const props: ComponentProps<typeof RightPanel> = { article: null, ...over }
  await act(async () => {
    root!.render(<RightPanel {...props} />)
  })
  await settle()
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await settle()
}

function toggle(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('[data-testid="attachments-toggle"]')
  if (!el) throw new Error('未找到附件表头折叠按钮')
  return el
}

function row(rel: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[data-attachment-row="${rel}"]`)
  if (!el) throw new Error(`未找到附件行：${rel}`)
  return el
}

function detail(rel: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-attachment-detail="${rel}"]`)
}

function requireDetail(rel: string): HTMLElement {
  const el = detail(rel)
  if (!el) throw new Error(`未找到附件详情面板：${rel}`)
  return el
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

describe('RightPanel 附件区 — 默认收起 + 表头信号', () => {
  it('默认收起：只渲染表头（附件 N + 刷新按钮），不渲染附件行', async () => {
    await setAttachments([
      attachment({ rel_path: 'Images/图一.png' }),
      attachment({ rel_path: 'Files/文档一.pdf', category: 'files' }),
    ])
    await render()

    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)
    // 收起态表头仍显示「附件 N」
    expect(container.textContent).toContain('附件 2')
    // 刷新按钮保留在表头
    expect(container.querySelector('button[aria-label="添加附件"]')).toBeTruthy()
  })

  it('点表头展开；再点表头收起', async () => {
    await setAttachments([attachment({ rel_path: 'Images/图一.png', name: '图一.png', size: 1536 })])
    await render()

    await click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(1)

    await click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)
    expect(container.textContent).toContain('附件 1')
  })

  it('有孤儿 + 收起态：仅表头可见（徽章在表头），孤儿区块/删除按钮/列表行一律不渲染', async () => {
    await setAttachments([attachment({ rel_path: 'Images/图一.png' })])
    await setOrphans([orphan({ path: 'Images/孤儿.png' })])
    await render()

    const badge = container.querySelector<HTMLElement>('[data-testid="orphan-badge"]')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toContain('孤儿附件 1')
    // 琥珀色信号（class 断言：text-amber-600），且位于表头折叠按钮内（收起态可见、点它即展开）
    expect(badge!.className).toContain('amber')
    expect(toggle().contains(badge)).toBe(true)

    // 收起 = 只剩一行表头（task-11 裁决）：孤儿区块任何 DOM 都不得渲染
    expect(container.querySelector('[data-testid="orphans-block"]')).toBeNull()
    expect(findButton('删除')).toBeUndefined()
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)
    expect(container.textContent).not.toContain('孤儿附件（1）')
    expect(container.textContent).not.toContain('孤儿附件仅支持手动删除')
  })

  it('有孤儿 + 展开态：孤儿区块 / 删除按钮 / 列表行 / 底部说明齐全', async () => {
    await setAttachments([attachment({ rel_path: 'Images/图一.png' })])
    await setOrphans([orphan({ path: 'Images/孤儿.png' })])
    await render()
    await click(toggle())

    expect(container.querySelector('[data-testid="orphans-block"]')).toBeTruthy()
    expect(findButton('删除')).toBeTruthy()
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(1)
    expect(container.textContent).toContain('孤儿附件（1）')
    expect(container.textContent).toContain('孤儿附件仅支持手动删除，不随笔记回滚。')
  })

  it('无孤儿时收起态表头不出现琥珀提示', async () => {
    await setAttachments([attachment({ rel_path: 'Images/图一.png' })])
    await setOrphans([])
    await render()
    expect(container.querySelector('[data-testid="orphan-badge"]')).toBeNull()
  })

  it('无附件：收起态不渲染空态文案（不占空间），展开后提示「暂无附件」', async () => {
    await render()
    expect(container.textContent).not.toContain('暂无附件')
    await click(toggle())
    expect(container.textContent).toContain('暂无附件')
    expect(container.textContent).toContain('附件 0')
  })
})

describe('RightPanel 附件区 — 点击附件行就地展开「附属情况与附属记录」', () => {
  const cited = attachment({
    rel_path: 'Files/报告.pdf',
    name: '报告.pdf',
    category: 'files',
    size: 2048,
    referenced_by: ['Articles/主文档.md', 'Articles/引用二.md', 'Modules/模块三.md'],
  })
  const uncited = attachment({
    rel_path: 'Images/未引用图.png',
    name: '未引用图.png',
    size: 512,
    mtime: T0,
  })

  /** 展开附件小节（行详情仍需点击行本身触发） */
  async function renderSectionOpen() {
    await setAttachments([cited, uncited])
    const onOpenArticle = vi.fn()
    await render({ onOpenArticle })
    await click(toggle())
    return onOpenArticle
  }

  it('已引用：列出全部引用文档（不是只取 [0]）且逐条可跳转', async () => {
    const onOpenArticle = await renderSectionOpen()
    // 点击已引用附件行 → 就地展开（不跳转）
    await click(row(cited.rel_path))

    const detailEl = requireDetail(cited.rel_path)
    expect(detailEl.textContent).toContain('附属情况与附属记录')
    expect(detailEl.textContent).toContain('引用篇数')
    expect(detailEl.getAttribute('data-ref-count')).toBe('3')

    const docButtons = Array.from(detailEl.querySelectorAll<HTMLButtonElement>('[data-ref-doc]'))
    expect(docButtons).toHaveLength(3)
    expect(docButtons.map((b) => b.getAttribute('data-ref-doc'))).toEqual(cited.referenced_by)
    for (const doc of cited.referenced_by) {
      expect(detailEl.textContent).toContain(doc)
    }

    // 点击行本身只展开、不跳转（跳转由条目负责）
    expect(onOpenArticle).not.toHaveBeenCalled()

    // 第 2 篇（[1]）也能跳转 —— 旧实现只取 referenced_by[0]
    await click(docButtons[1])
    expect(onOpenArticle).toHaveBeenCalledWith('Articles/引用二.md')
    await click(docButtons[2])
    expect(onOpenArticle).toHaveBeenCalledWith('Modules/模块三.md')
    expect(onOpenArticle).toHaveBeenCalledTimes(2)
  })

  it('未引用：显示「未被引用」+ 附件自身详情（全路径 / 大小 / 修改时间）', async () => {
    const onOpenArticle = await renderSectionOpen()
    // 点击未引用附件行：旧实现点了完全没反应，现在必须展开详情
    await click(row(uncited.rel_path))

    const detailEl = requireDetail(uncited.rel_path)
    expect(detailEl.textContent).toContain('未被引用')
    expect(detailEl.textContent).toContain('未被任何文档引用')
    expect(detailEl.getAttribute('data-ref-count')).toBe('0')
    expect(detailEl.querySelectorAll('[data-ref-doc]')).toHaveLength(0)
    // 附件自身详情
    expect(detailEl.textContent).toContain('Images/未引用图.png')
    expect(detailEl.textContent).toContain('512 B')
    expect(detailEl.textContent).toContain('2026')
    expect(onOpenArticle).not.toHaveBeenCalled()
  })

  it('再次点击同一行 → 收起该行详情（行仍在）', async () => {
    await renderSectionOpen()

    await click(row(cited.rel_path))
    expect(detail(cited.rel_path)).toBeTruthy()
    await click(row(cited.rel_path))
    expect(detail(cited.rel_path)).toBeNull()
    // 行未被移除，可再次展开
    expect(row(cited.rel_path)).toBeTruthy()
    await click(row(cited.rel_path))
    expect(detail(cited.rel_path)).toBeTruthy()
  })

  it('点另一行 = 切换详情：上一行详情收起（同时只展开一行，列表不塌）', async () => {
    await renderSectionOpen()

    await click(row(cited.rel_path))
    expect(detail(cited.rel_path)).toBeTruthy()

    await click(row(uncited.rel_path))
    expect(detail(uncited.rel_path)).toBeTruthy()
    expect(detail(cited.rel_path)).toBeNull()
    // 切换详情不应连带收起整个列表
    expect(row(cited.rel_path)).toBeTruthy()
    expect(detail(uncited.rel_path)).toBeTruthy()
  })
})

describe('RightPanel 附件区 — 既有信息一个不少', () => {
  it('展开后保留：图标 / 名称 / 大小 / 已引用-未引用徽章 / 底部说明 / 孤儿删除', async () => {
    const cited = attachment({
      rel_path: 'Files/报告.pdf',
      name: '报告.pdf',
      category: 'files',
      size: 2048,
      referenced_by: ['Articles/主文档.md'],
    })
    const uncited = attachment({ rel_path: 'Images/未引用图.png', name: '未引用图.png', size: 512 })
    await setAttachments([cited, uncited])
    await setOrphans([orphan({ path: 'Images/孤儿.png', name: '孤儿.png' })])
    await render()
    await click(toggle())

    const citedRow = row(cited.rel_path)
    const uncitedRow = row(uncited.rel_path)
    // 图标（线性 SVG）仍在行内
    expect(citedRow.querySelector('svg')).toBeTruthy()
    expect(uncitedRow.querySelector('svg')).toBeTruthy()
    // 名称 + 大小
    expect(citedRow.textContent).toContain('报告.pdf')
    expect(citedRow.textContent).toContain('2.0 KB')
    expect(uncitedRow.textContent).toContain('未引用图.png')
    expect(uncitedRow.textContent).toContain('512 B')
    // 已引用 / 未引用徽章
    expect(citedRow.textContent).toContain('已引用')
    expect(uncitedRow.textContent).toContain('未引用')
    // 底部说明文案
    expect(container.textContent).toContain('孤儿附件仅支持手动删除，不随笔记回滚。')
    // 孤儿区块随列表展开后可见（收起态只剩表头琥珀提示，见第一个 describe）
    expect(container.textContent).toContain('孤儿附件（1）')
    expect(findButton('删除')).toBeTruthy()
  })

  it('孤儿删除按钮仍走确认 → deleteAttachment + 重新加载', async () => {
    await setAttachments([attachment({ rel_path: 'Images/图一.png' })])
    await setOrphans([orphan({ path: 'Images/孤儿.png', name: '孤儿.png' })])
    await render()
    await click(toggle())

    await click(findButton('删除')!)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(String(promptMocks.askConfirm.mock.calls[0][0])).toContain('孤儿.png')
    expect(vi.mocked(api.deleteAttachment)).toHaveBeenCalledWith('Images/孤儿.png')
    // 删除成功后重新拉取列表
    expect(vi.mocked(api.listAttachments).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
