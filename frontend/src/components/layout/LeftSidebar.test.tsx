/** LeftSidebar 回收站接线测试（契约 docs/design-trash-mvp.md §3/§7）：
 *  - 「回收站」导航项启用（此前是 disabled 占位）并渲染回收站列表
 *  - 文档删除 = 单次确认且文案含「可在回收站恢复」
 *  - 文件夹删除 = 保留原「无法恢复」双重确认
 *  - 恢复成功经 onTrashRestored 上报（App 侧 setTreeRefresh）
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import LeftSidebar from './LeftSidebar'
import * as api from '../../api/client'
import type { TreePayload } from '../../types'

vi.mock('../../api/client', () => ({
  attachmentUrl: (rel: string) => `/api/attachments/${rel}`,
  clearRecentDocuments: vi.fn(),
  createDocIn: vi.fn(),
  createFolder: vi.fn(),
  deleteArticle: vi.fn(),
  deleteFolder: vi.fn(),
  getFilesByTag: vi.fn(),
  getRecentDocuments: vi.fn(),
  getTags: vi.fn(),
  getTree: vi.fn(),
  listModules: vi.fn(),
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
let confirmSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  alertSpy = vi.fn()
  confirmSpy = vi.fn(() => true)
  ;(window as unknown as { alert: unknown }).alert = alertSpy
  ;(window as unknown as { confirm: unknown }).confirm = confirmSpy
  vi.mocked(api.getTree).mockResolvedValue(tree([]))
  vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: [] })
  vi.mocked(api.getTags).mockResolvedValue({ tags: [] })
  vi.mocked(api.listModules).mockResolvedValue({ count: 0, modules: [] })
  vi.mocked(api.listTrash).mockResolvedValue({ count: 0, items: [] })
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

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const msg = String(confirmSpy.mock.calls[0][0])
    expect(msg).toContain('确认删除「文档A.md」')
    expect(msg).toContain('可在回收站恢复')
    expect(msg).not.toContain('无法恢复')
    expect(vi.mocked(api.deleteArticle)).toHaveBeenCalledWith('Articles/文档A.md')
  })

  it('文档删除：取消确认则不发起删除请求', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/文档A.md']))
    confirmSpy.mockReturnValue(false)
    await render()

    await deleteVia(container.querySelector<HTMLElement>('[title="Articles/文档A.md"]')!)

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteArticle)).not.toHaveBeenCalled()
  })

  it('文件夹删除：保留原「无法恢复」双重确认', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/子目录/文档B.md']))
    await render()

    const folderRow = container.querySelector<HTMLElement>('div.group')!
    expect(folderRow.textContent).toContain('子目录')
    await deleteVia(folderRow)

    expect(confirmSpy).toHaveBeenCalledTimes(2)
    const first = String(confirmSpy.mock.calls[0][0])
    const second = String(confirmSpy.mock.calls[1][0])
    expect(first).toContain('确认删除「子目录」')
    expect(first).not.toContain('可在回收站恢复')
    expect(second).toContain('无法恢复')
    expect(vi.mocked(api.deleteFolder)).toHaveBeenCalledWith('Articles/子目录')
  })
})
