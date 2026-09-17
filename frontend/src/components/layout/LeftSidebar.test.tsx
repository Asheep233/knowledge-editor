/** LeftSidebar 测试：
 * A. 回收站接线（契约 docs/design-trash-mvp.md §3/§7）：
 *  - 「回收站」导航项启用（此前是 disabled 占位）并渲染回收站列表
 *  - 文档删除 = 单次确认且文案含「可在回收站恢复」
 *  - 文件夹删除 = 保留原「无法恢复」双重确认
 *  - 恢复成功经 onTrashRestored 上报（App 侧 setTreeRefresh）
 * B. 附件区（task-12：附件能力的家迁到左栏；task-22：**默认收起**）—— 可折叠、行点击看
 *  「附属情况与附属记录」（全部 referenced_by 逐条可跳转）、未引用显示自身详情、
 *  「打开文件」<a> 保留、孤儿手动删除、数据源 listAttachments()/listOrphans()
 *  （不依赖 tree.attachments）、refreshKey 驱动刷新。
 *  注：默认收起后，凡涉及行/详情/孤儿区块/错误的用例都先用 `expandAttachments()` 展开。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import LeftSidebar from './LeftSidebar'
import * as api from '../../api/client'
import type { AttachmentItem, OrphanItem, TreePayload } from '../../types'

// 2026-09-15：确认机制由原生 window.confirm（Tauri 下被替换为 async → 恒 truthy、静默绕过）
// 改为自绘 askConfirm。此处 mock 该模块以断言「调用点传对了文案、并遵守用户选择」；
// 对话框自身的渲染/交互由 components/common/PromptDialog.test.tsx 覆盖。
const promptMocks = vi.hoisted(() => ({
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
  askPrompt: vi.fn(async (_title?: string, _defaultValue?: string) => null as string | null),
}))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: promptMocks.askConfirm,
  askPrompt: promptMocks.askPrompt,
  usePrompt: () => promptMocks.askPrompt,
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

vi.mock('../../api/client', () => ({
  attachmentUrl: (rel: string) => `/api/attachments/${rel}`,
  clearRecentDocuments: vi.fn(),
  createDocIn: vi.fn(),
  createFolder: vi.fn(),
  deleteArticle: vi.fn(),
  deleteAttachment: vi.fn(),
  deleteFolder: vi.fn(),
  getFilesByTag: vi.fn(),
  getRecentDocuments: vi.fn(),
  getTags: vi.fn(),
  getTree: vi.fn(),
  listAttachments: vi.fn(),
  listModules: vi.fn(),
  listOrphans: vi.fn(),
  movePath: vi.fn(),
  rebuildIndex: vi.fn(),
  renameDoc: vi.fn(),
  renameFolder: vi.fn(),
  search: vi.fn(),
  listTrash: vi.fn(),
  restoreTrash: vi.fn(),
  purgeTrash: vi.fn(),
  clearTrash: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function tree(articles: string[]): TreePayload {
  return { root: '/ws', articles, modules: [], attachments: { images: [], videos: [], files: [] } }
}

let root: Root | null = null
let container: HTMLDivElement
/** happy-dom v20 未实现 window.alert/confirm（typeof === 'undefined'），直接挂 spy */
let alertSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks 不清实现 → 显式重置，避免上一用例的 mockResolvedValue(false) 泄漏
  promptMocks.askConfirm.mockResolvedValue(true)
  promptMocks.askPrompt.mockResolvedValue(null)
  container = document.createElement('div')
  document.body.appendChild(container)
  alertSpy = vi.fn()
  ;(window as unknown as { alert: unknown }).alert = alertSpy
  vi.mocked(api.getTree).mockResolvedValue(tree([]))
  vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: [] })
  vi.mocked(api.getTags).mockResolvedValue({ tags: [] })
  vi.mocked(api.listModules).mockResolvedValue({ count: 0, modules: [] })
  vi.mocked(api.listTrash).mockResolvedValue({ count: 0, items: [] })
  vi.mocked(api.listAttachments).mockResolvedValue({ count: 0, attachments: [] })
  vi.mocked(api.listOrphans).mockResolvedValue({ count: 0, orphans: [] })
  vi.mocked(api.deleteAttachment).mockResolvedValue({ deleted: '' })
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

async function render(props: Partial<React.ComponentProps<typeof LeftSidebar>> = {}): Promise<void> {
  root = createRoot(container)
  const full: React.ComponentProps<typeof LeftSidebar> = { activeId: null, onOpenArticle: vi.fn(), ...props }
  await act(async () => {
    root!.render(<LeftSidebar {...full} />)
  })
  await settle()
}

/** 同一 root 重新渲染（用于 refreshKey / props 变化场景） */
async function rerender(props: Partial<React.ComponentProps<typeof LeftSidebar>> = {}): Promise<void> {
  const full: React.ComponentProps<typeof LeftSidebar> = { activeId: null, onOpenArticle: vi.fn(), ...props }
  await act(async () => {
    root!.render(<LeftSidebar {...full} />)
  })
  await settle()
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await settle()
}

async function openContextMenu(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  })
}

/** 右键菜单中的「删除…」→ 触发确认流程 */
async function deleteVia(node: HTMLElement): Promise<void> {
  await openContextMenu(node)
  await click(findButton('删除…')!)
}

describe('LeftSidebar — 回收站导航项（此前 disabled 占位）', () => {
  it('导航项可点击，点击后渲染回收站列表', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({
      count: 1,
      items: [
        {
          id: '20260915-143012-a1b2',
          rel_path: 'Articles/旧文档.md',
          name: '旧文档.md',
          deleted_at: '2026-09-15T14:30:12+08:00',
          size: 1024,
        },
      ],
    })
    await render()

    const nav = findButton('回收站')!
    expect(nav).toBeTruthy()
    expect(nav.disabled).toBe(false)
    expect(nav.getAttribute('title') ?? '').not.toContain('暂缓')

    await click(nav)

    expect(container.textContent).toContain('Articles/旧文档.md')
    expect(container.querySelectorAll('[data-trash-id]')).toHaveLength(1)
  })

  it('恢复成功经 onTrashRestored 上报（供 App setTreeRefresh）', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({
      count: 1,
      items: [
        {
          id: '20260915-143012-a1b2',
          rel_path: 'Articles/旧文档.md',
          name: '旧文档.md',
          deleted_at: '2026-09-15T14:30:12+08:00',
          size: 1024,
        },
      ],
    })
    vi.mocked(api.restoreTrash).mockResolvedValue({
      id: '20260915-143012-a1b2',
      restored_to: 'Articles/旧文档.md',
      renamed: false,
    })
    const onTrashRestored = vi.fn()
    await render({ onTrashRestored })

    await click(findButton('回收站')!)
    await click(findButton('恢复')!)

    expect(onTrashRestored).toHaveBeenCalledWith('Articles/旧文档.md')
  })
})

describe('LeftSidebar — 删除确认文案（契约 §7）', () => {
  it('文档删除：单次确认且文案含「可在回收站恢复」', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/文档A.md']))
    await render()

    const node = container.querySelector<HTMLElement>('[title="Articles/文档A.md"]')!
    expect(node).toBeTruthy()
    await deleteVia(node)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    const msg = String(promptMocks.askConfirm.mock.calls[0][0])
    expect(msg).toContain('确认删除「文档A.md」')
    expect(msg).toContain('可在回收站恢复')
    expect(msg).not.toContain('无法恢复')
    expect(vi.mocked(api.deleteArticle)).toHaveBeenCalledWith('Articles/文档A.md')
  })

  it('文档删除：取消确认则不发起删除请求', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/文档A.md']))
    promptMocks.askConfirm.mockResolvedValue(false)
    await render()

    await deleteVia(container.querySelector<HTMLElement>('[title="Articles/文档A.md"]')!)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteArticle)).not.toHaveBeenCalled()
  })

  it('文件夹删除：保留原「无法恢复」双重确认', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/子目录/文档B.md']))
    await render()

    const folderRow = container.querySelector<HTMLElement>('div.group')!
    expect(folderRow.textContent).toContain('子目录')
    await deleteVia(folderRow)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(2)
    const first = String(promptMocks.askConfirm.mock.calls[0][0])
    const second = String(promptMocks.askConfirm.mock.calls[1][0])
    expect(first).toContain('确认删除「子目录」')
    expect(first).not.toContain('可在回收站恢复')
    expect(second).toContain('无法恢复')
    expect(vi.mocked(api.deleteFolder)).toHaveBeenCalledWith('Articles/子目录')
  })
})

// ============================================================================
// B. 附件区（task-12 迁入：原 RightPanel 附件用例的等价覆盖）
// ============================================================================
const TS = '2026-09-15T10:00:00+08:00'
const DOC_A = 'Articles/文档A.md'
const DOC_B = 'Articles/子目录/文档B.md'
const DOC_C = 'Articles/文档C.md'
/** 3 篇文档引用同一附件（旧实现只跳 referenced_by[0]） */
const SHARED = 'Attachments/images/共享图.png'
/** 未被任何文档引用 */
const LONE = 'Attachments/files/孤立资料.pdf'
const ORPHAN_PATH = 'Attachments/files/孤儿报告.pdf'

function mkAttachment(over: Partial<AttachmentItem> & { rel_path: string }): AttachmentItem {
  return {
    name: over.rel_path.split('/').pop() ?? over.rel_path,
    category: 'images',
    size: 2048,
    mtime: TS,
    referenced_by: [],
    ...over,
  }
}

function mkOrphan(over: Partial<OrphanItem> & { path: string }): OrphanItem {
  return {
    name: over.path.split('/').pop() ?? over.path,
    size: 4096,
    mtime: TS,
    ...over,
  }
}

const SHARED_ITEM = mkAttachment({ rel_path: SHARED, size: 4096, referenced_by: [DOC_A, DOC_B, DOC_C] })
const LONE_ITEM = mkAttachment({ rel_path: LONE, category: 'files', size: 3072, referenced_by: [] })
const ORPHAN_ITEM = mkOrphan({ path: ORPHAN_PATH, name: '孤儿报告.pdf', size: 1024 })

async function setAttachments(items: AttachmentItem[]): Promise<void> {
  vi.mocked(api.listAttachments).mockResolvedValue({ count: items.length, attachments: items })
}

async function setOrphans(items: OrphanItem[]): Promise<void> {
  vi.mocked(api.listOrphans).mockResolvedValue({ count: items.length, orphans: items })
}

function attachToggle(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('[data-testid="attachments-toggle"]')
  if (!el) throw new Error('未找到附件表头折叠按钮')
  return el
}

function attachRow(rel: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[data-attachment-row="${rel}"]`)
  if (!el) throw new Error(`未找到附件行：${rel}`)
  return el
}

function attachDetail(rel: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-attachment-detail="${rel}"]`)
}

function attachLink(rel: string): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(`[data-attachment-open="${rel}"]`)
}

/** task-22：附件小节默认收起 —— 所有涉及行/详情/孤儿区块/错误的用例都需先点表头展开 */
async function expandAttachments(): Promise<void> {
  await click(attachToggle())
}

describe('LeftSidebar 附件区（task-12 迁入；task-22 默认收起）— 折叠两态与行信息', () => {
  it('默认收起：表头显示「附件 N」+ 刷新按钮，不渲染行/详情/孤儿区块；点表头展开后行信息齐全', async () => {
    await setAttachments([SHARED_ITEM, LONE_ITEM])
    await render()

    // —— 默认收起：只留一行表头 ——
    expect(attachToggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('附件 2')
    expect(container.querySelector('button[aria-label="刷新附件"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)
    expect(attachDetail(SHARED)).toBeNull()
    expect(container.querySelector('[data-testid="orphans-block"]')).toBeNull()

    // —— 点表头展开后行信息齐全 ——
    await expandAttachments()
    expect(attachToggle().getAttribute('aria-expanded')).toBe('true')

    const sharedRow = attachRow(SHARED)
    expect(sharedRow.querySelector('svg')).toBeTruthy()
    expect(sharedRow.textContent).toContain('共享图.png')
    expect(sharedRow.textContent).toContain('4.0 KB')
    expect(sharedRow.textContent).toContain('已引用')
    expect(sharedRow.textContent).not.toContain('Attachments/')

    const loneRow = attachRow(LONE)
    expect(loneRow.textContent).toContain('孤立资料.pdf')
    expect(loneRow.textContent).toContain('3.0 KB')
    expect(loneRow.textContent).toContain('未引用')
  })

  it('展开后再点表头收起：只剩表头（无行 / 无详情 / 无孤儿区块 / 无底部说明），再点恢复', async () => {
    await setAttachments([SHARED_ITEM])
    await setOrphans([ORPHAN_ITEM])
    await render()

    await expandAttachments()
    expect(attachRow(SHARED)).toBeTruthy()

    await click(attachToggle())
    expect(attachToggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)
    expect(container.querySelector('[data-testid="orphans-block"]')).toBeNull()
    expect(findButton('删除')).toBeUndefined()
    expect(container.textContent).not.toContain('孤儿附件仅支持手动删除')

    await click(attachToggle())
    expect(attachRow(SHARED)).toBeTruthy()
  })

  it('有孤儿 + 默认收起态：表头琥珀徽章可见（信号不丢）且在折叠按钮内；孤儿区块不渲染', async () => {
    await setAttachments([SHARED_ITEM])
    await setOrphans([ORPHAN_ITEM])
    await render()

    const badge = container.querySelector<HTMLElement>('[data-testid="orphan-badge"]')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toContain('孤儿附件 1')
    expect(badge!.className).toContain('amber')
    expect(attachToggle().contains(badge)).toBe(true)
    // 收起态零孤儿 DOM：区块与删除入口都不得渲染
    expect(container.querySelector('[data-testid="orphans-block"]')).toBeNull()
    expect(findButton('删除')).toBeUndefined()
  })

  it('有孤儿 + 展开态：孤儿区块 / 删除按钮 / 列表行 / 底部说明齐全', async () => {
    await setAttachments([SHARED_ITEM])
    await setOrphans([ORPHAN_ITEM])
    await render()
    await expandAttachments()

    expect(container.querySelector('[data-testid="orphans-block"]')).toBeTruthy()
    expect(findButton('删除')).toBeTruthy()
    expect(attachRow(SHARED)).toBeTruthy()
    expect(container.textContent).toContain('孤儿附件（1）')
    expect(container.textContent).toContain('孤儿附件仅支持手动删除，不随笔记回滚。')
  })

  it('0 附件：表头计数为 0 且默认收起不渲染空态文案；展开后显示「暂无附件」', async () => {
    await render()

    expect(container.textContent).toContain('附件 0')
    expect(container.textContent, '默认收起不得渲染空态文案').not.toContain('暂无附件')
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)

    await expandAttachments()
    expect(container.textContent).toContain('暂无附件')

    await click(attachToggle())
    expect(container.textContent, '收起后空态文案应一并收起').not.toContain('暂无附件')
  })

  it('无孤儿时表头不出现琥珀徽章（无孤儿噪声）', async () => {
    await setAttachments([SHARED_ITEM])
    await setOrphans([])
    await render()

    expect(attachToggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-testid="orphan-badge"]')).toBeNull()
  })
})

describe('LeftSidebar 附件区（task-12 迁入 / task-22 默认收起）— 点击行看「附属情况与附属记录」', () => {
  it('已引用行 → 列出全部 3 篇 referenced_by（不是只取 [0]）', async () => {
    await setAttachments([SHARED_ITEM])
    await render()
    await expandAttachments()
    await click(attachRow(SHARED))

    const detail = attachDetail(SHARED)!
    expect(detail).toBeTruthy()
    expect(detail.textContent).toContain('附属情况与附属记录')
    expect(detail.textContent).toContain('引用篇数')
    expect(detail.getAttribute('data-ref-count')).toBe('3')

    const docs = Array.from(detail.querySelectorAll<HTMLButtonElement>('[data-ref-doc]'))
    expect(docs.map((b) => b.getAttribute('data-ref-doc'))).toEqual([DOC_A, DOC_B, DOC_C])
    for (const d of [DOC_A, DOC_B, DOC_C]) {
      expect(detail.textContent).toContain(d)
    }
  })

  it('详情内逐条点击 → onOpenArticle 收到正确 docRel（含第 2/3 篇）；点行本身不跳转', async () => {
    await setAttachments([SHARED_ITEM])
    const onOpenArticle = vi.fn()
    await render({ onOpenArticle })
    await expandAttachments()

    await click(attachRow(SHARED))
    expect(onOpenArticle, '点击行只应就地展开，不应跳转').not.toHaveBeenCalled()

    const docs = Array.from(attachDetail(SHARED)!.querySelectorAll<HTMLButtonElement>('[data-ref-doc]'))
    await click(docs[1])
    await click(docs[2])
    await click(docs[0])
    expect(onOpenArticle).toHaveBeenCalledWith(DOC_A)
    expect(onOpenArticle).toHaveBeenCalledWith(DOC_B)
    expect(onOpenArticle).toHaveBeenCalledWith(DOC_C)
    expect(onOpenArticle).toHaveBeenCalledTimes(3)
  })

  it('未引用行 → 「未被任何文档引用」+ 路径 / 大小 / 修改时间', async () => {
    await setAttachments([LONE_ITEM])
    const onOpenArticle = vi.fn()
    await render({ onOpenArticle })
    await expandAttachments()
    await click(attachRow(LONE))

    const detail = attachDetail(LONE)!
    expect(detail.textContent).toContain('未被任何文档引用')
    expect(detail.getAttribute('data-ref-count')).toBe('0')
    expect(detail.querySelectorAll('[data-ref-doc]')).toHaveLength(0)
    expect(detail.textContent).toContain(LONE)
    expect(detail.textContent).toContain('3.0 KB')
    expect(detail.textContent).toContain('2026')
    expect(onOpenArticle).not.toHaveBeenCalled()
  })

  it('同行两击 = 展开再收起（行仍在、列表不塌）', async () => {
    await setAttachments([SHARED_ITEM, LONE_ITEM])
    await render()
    await expandAttachments()

    await click(attachRow(SHARED))
    expect(attachDetail(SHARED)).toBeTruthy()
    await click(attachRow(SHARED))
    expect(attachDetail(SHARED)).toBeNull()
    expect(attachRow(SHARED)).toBeTruthy()
  })

  it('点另一行 = 切换详情（同时只展开一行，上一行不残留）', async () => {
    await setAttachments([SHARED_ITEM, LONE_ITEM])
    await render()
    await expandAttachments()

    await click(attachRow(SHARED))
    expect(attachDetail(SHARED)).toBeTruthy()

    await click(attachRow(LONE))
    expect(attachDetail(LONE)).toBeTruthy()
    expect(attachDetail(SHARED)).toBeNull()
  })
})

describe('LeftSidebar 附件区（task-12 迁入 / task-22 默认收起）— 打开文件 / 孤儿删除 / 加载边界', () => {
  it('「打开文件」<a> 保留：href = attachmentUrl(rel_path)、target=_blank，且不嵌套在行按钮内', async () => {
    await setAttachments([SHARED_ITEM])
    await render()
    await expandAttachments()

    const link = attachLink(SHARED)!
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe(api.attachmentUrl(SHARED))
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    expect(link.getAttribute('title')).toBe('打开附件')
    // 独立元素：不得嵌在行按钮（或任何按钮）内
    expect(link.closest('button')).toBeNull()
  })

  it('DOM 合法性：不产生嵌套交互元素（button/a 内不得再嵌 button/a）', async () => {
    await setAttachments([SHARED_ITEM, LONE_ITEM])
    await setOrphans([ORPHAN_ITEM])
    await render()
    await expandAttachments()
    await click(attachRow(SHARED))
    await click(attachRow(LONE))

    for (const el of Array.from(container.querySelectorAll('button, a'))) {
      expect(el.querySelector('button, a'), '嵌套交互元素').toBeNull()
    }
  })

  it('删除孤儿：确认 → deleteAttachment(path) 并刷新列表', async () => {
    await setAttachments([SHARED_ITEM])
    await setOrphans([ORPHAN_ITEM])
    await render()
    await expandAttachments()
    const before = vi.mocked(api.listAttachments).mock.calls.length

    await click(findButton('删除')!)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(String(promptMocks.askConfirm.mock.calls[0][0])).toContain('孤儿报告.pdf')
    expect(vi.mocked(api.deleteAttachment)).toHaveBeenCalledWith(ORPHAN_PATH)
    expect(vi.mocked(api.listAttachments).mock.calls.length).toBeGreaterThan(before)
  })

  it('取消删除 → 不发起 deleteAttachment', async () => {
    await setAttachments([SHARED_ITEM])
    await setOrphans([ORPHAN_ITEM])
    promptMocks.askConfirm.mockResolvedValue(false)
    await render()
    await expandAttachments()

    await click(findButton('删除')!)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteAttachment)).not.toHaveBeenCalled()
  })

  it('加载失败：展开后显示可见错误；重试后恢复列表', async () => {
    vi.mocked(api.listAttachments).mockRejectedValueOnce(new Error('boom'))
    await render()
    await expandAttachments()
    expect(container.textContent).toContain('加载失败，请重试')

    await setAttachments([SHARED_ITEM])
    await click(findButton('重试')!)
    expect(attachRow(SHARED)).toBeTruthy()
  })

  it('refreshKey 变化触发重新加载（数据源不依赖 tree.attachments）', async () => {
    await setAttachments([SHARED_ITEM])
    await render({ refreshKey: 0 })
    expect(vi.mocked(api.listAttachments).mock.calls.length).toBe(1)

    await rerender({ refreshKey: 1 })
    expect(vi.mocked(api.listAttachments).mock.calls.length).toBe(2)
  })
})
