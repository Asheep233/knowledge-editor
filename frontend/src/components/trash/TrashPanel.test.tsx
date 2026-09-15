/** 回收站面板测试（契约 docs/design-trash-mvp.md §3/§5/§9）：
 *  列表渲染（原路径/删除时间/大小）、空态、加载态、错误重试、
 *  恢复（含 renamed: true 提示）、恢复的是当前打开文档的明确提示、
 *  彻底删除与清空的确认取消分支。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import TrashPanel, { baseName, formatBytes, formatDeletedAt } from './TrashPanel'
import * as api from '../../api/client'
import type { TrashItem } from '../../types'

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
  listTrash: vi.fn(),
  restoreTrash: vi.fn(),
  purgeTrash: vi.fn(),
  clearTrash: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ITEMS: TrashItem[] = [
  {
    id: '20260915-143012-a1b2',
    rel_path: 'Articles/子目录/文档.md',
    name: '文档.md',
    deleted_at: '2026-09-15T14:30:12+08:00',
    size: 2048,
  },
  {
    id: '20260915-150845-c3d4',
    rel_path: 'Articles/另一篇.md',
    name: '另一篇.md',
    deleted_at: '2026-09-15T15:08:45+08:00',
    size: 512,
  },
]

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

async function render(props: React.ComponentProps<typeof TrashPanel> = {}): Promise<void> {
  root = createRoot(container)
  await act(async () => {
    root!.render(<TrashPanel {...props} />)
  })
  await settle()
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await settle()
}

function findButton(text: string, within: ParentNode = container): HTMLButtonElement | undefined {
  return Array.from(within.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-trash-id]'))
}

function alertTexts(): string[] {
  return alertSpy.mock.calls.map((c) => String(c[0]))
}

describe('TrashPanel — 列表渲染', () => {
  it('渲染每项：文件名 / 原路径 / 删除时间 / 大小', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: ITEMS.length, items: ITEMS })
    await render()

    const r = rows()
    expect(r).toHaveLength(2)
    expect(r[0].textContent).toContain('文档.md')
    expect(r[0].textContent).toContain('Articles/子目录/文档.md')
    expect(r[0].textContent).toContain('2.0 KB')
    expect(r[0].textContent).toContain('2026')
    expect(r[1].textContent).toContain('另一篇.md')
    expect(r[1].textContent).toContain('512 B')
  })

  it('空态：回收站为空，且不显示「清空」', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: 0, items: [] })
    await render()

    expect(container.textContent).toContain('回收站为空')
    expect(findButton('清空')).toBeUndefined()
    expect(rows()).toHaveLength(0)
  })

  it('加载态：请求未返回时显示「加载中…」', async () => {
    vi.mocked(api.listTrash).mockReturnValue(new Promise(() => {}))
    root = createRoot(container)
    await act(async () => {
      root!.render(<TrashPanel />)
    })

    expect(container.textContent).toContain('加载中…')
  })

  it('加载失败给出错误 + 重试入口', async () => {
    vi.mocked(api.listTrash)
      .mockRejectedValueOnce(new Error('500 boom'))
      .mockResolvedValueOnce({ count: 1, items: [ITEMS[0]] })
    await render()

    expect(container.textContent).toContain('加载失败，请重试')
    await click(findButton('重试')!)
    expect(container.textContent).toContain('Articles/子目录/文档.md')
    expect(rows()).toHaveLength(1)
  })

  it('formatBytes / formatDeletedAt / baseName 边界', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatDeletedAt('not-a-date')).toBe('not-a-date')
    expect(baseName('Articles/子目录/文档.md')).toBe('文档.md')
    expect(baseName('文档.md')).toBe('文档.md')
  })
})

describe('TrashPanel — 恢复', () => {
  it('恢复成功：调用 restoreTrash(id)、提示原路径、回调 onRestored 并刷新列表', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: 1, items: [ITEMS[0]] })
    vi.mocked(api.restoreTrash).mockResolvedValue({
      id: ITEMS[0].id,
      restored_to: 'Articles/子目录/文档.md',
      renamed: false,
    })
    const onRestored = vi.fn()
    await render({ onRestored })

    await click(findButton('恢复')!)

    expect(vi.mocked(api.restoreTrash)).toHaveBeenCalledWith(ITEMS[0].id)
    expect(alertTexts().join('\n')).toContain('已恢复：Articles/子目录/文档.md')
    expect(onRestored).toHaveBeenCalledWith('Articles/子目录/文档.md')
    expect(vi.mocked(api.listTrash)).toHaveBeenCalledTimes(2) // 初次 + 恢复后刷新
  })

  it('renamed: true → 提示「已恢复为 xxx-1.md」', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: 1, items: [ITEMS[0]] })
    vi.mocked(api.restoreTrash).mockResolvedValue({
      id: ITEMS[0].id,
      restored_to: 'Articles/子目录/文档-1.md',
      renamed: true,
    })
    await render()

    await click(findButton('恢复')!)

    expect(alertTexts().join('\n')).toContain('已恢复为 文档-1.md')
    expect(alertTexts().join('\n')).toContain('自动改名')
  })

  it('恢复的正是当前打开文档 → 明确提示需重新打开（坑 3）', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: 1, items: [ITEMS[0]] })
    vi.mocked(api.restoreTrash).mockResolvedValue({
      id: ITEMS[0].id,
      restored_to: 'Articles/子目录/文档.md',
      renamed: false,
    })
    await render({ activeId: 'Articles/子目录/文档.md' })

    await click(findButton('恢复')!)

    expect(alertTexts().join('\n')).toContain('正是当前打开的文档')
  })

  it('恢复失败：提示错误且不触发 onRestored', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: 1, items: [ITEMS[0]] })
    vi.mocked(api.restoreTrash).mockRejectedValue(new Error('404 entry 不存在'))
    const onRestored = vi.fn()
    await render({ onRestored })

    await click(findButton('恢复')!)

    expect(alertTexts().join('\n')).toContain('恢复失败：404 entry 不存在')
    expect(onRestored).not.toHaveBeenCalled()
  })
})

describe('TrashPanel — 彻底删除 / 清空', () => {
  it('彻底删除：取消确认则不调用 purgeTrash', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: 1, items: [ITEMS[0]] })
    promptMocks.askConfirm.mockResolvedValue(false)
    await render()

    await click(findButton('彻底删除')!)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(String(promptMocks.askConfirm.mock.calls[0][0])).toContain('无法恢复')
    expect(vi.mocked(api.purgeTrash)).not.toHaveBeenCalled()
  })

  it('彻底删除：确认后调用 purgeTrash(id) 并刷新列表', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: 1, items: [ITEMS[0]] })
    vi.mocked(api.purgeTrash).mockResolvedValue(undefined)
    await render()

    await click(findButton('彻底删除')!)

    expect(vi.mocked(api.purgeTrash)).toHaveBeenCalledWith(ITEMS[0].id)
    expect(vi.mocked(api.listTrash)).toHaveBeenCalledTimes(2)
  })

  it('清空：取消确认则不调用 clearTrash', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: ITEMS.length, items: ITEMS })
    promptMocks.askConfirm.mockResolvedValue(false)
    await render()

    await click(findButton('清空')!)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(String(promptMocks.askConfirm.mock.calls[0][0])).toContain('清空后无法恢复')
    expect(vi.mocked(api.clearTrash)).not.toHaveBeenCalled()
  })

  it('清空：确认后调用 clearTrash() 并刷新列表', async () => {
    vi.mocked(api.listTrash).mockResolvedValue({ count: ITEMS.length, items: ITEMS })
    vi.mocked(api.clearTrash).mockResolvedValue(undefined)
    await render()

    await click(findButton('清空')!)

    expect(vi.mocked(api.clearTrash)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.listTrash)).toHaveBeenCalledTimes(2)
  })
})
