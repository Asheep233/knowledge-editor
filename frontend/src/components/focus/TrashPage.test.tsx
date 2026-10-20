/**
 * Focus 回收站页（TrashPage）行为测试。
 *
 * 覆盖：
 *  ① 列表渲染（名称/原路径/删除时间/大小）与副标题计数；
 *  ② 恢复：restoreTrash(id) + 刷新 + 成功提示；同名冲突（renamed）提示自动改名；
 *  ③ 彻底删除：askConfirm 二次确认（取消不调用）；
 *  ④ 清空回收站：askConfirm 二次确认（取消不调用）+ 刷新；
 *  ⑤ 刷新按钮 / refreshToken 重新取数；
 *  ⑥ 加载中 / 加载失败 + 重试 / 空态。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import * as api from '../../api/client'
import type { TrashItem, TrashListPayload } from '../../types'
import { TrashPage } from './TrashPage'
import type { FocusPageProps } from './pageTypes'

const promptMocks = vi.hoisted(() => ({
  askPrompt: vi.fn(async (_title?: string, _defaultValue?: string) => null as string | null),
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
}))
vi.mock('../common/PromptDialog', () => ({
  askPrompt: promptMocks.askPrompt,
  askConfirm: promptMocks.askConfirm,
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
    id: '20261014-110200-a1b2',
    rel_path: 'Articles/普通物理学（上）/Homework-Ch6-旧版.md',
    name: 'Homework-Ch6-旧版.md',
    deleted_at: '2026-10-14T03:02:00Z',
    size: 16588,
  },
  {
    id: '20261013-194400-c3d4',
    rel_path: 'Articles/收集箱/未命名笔记 03.md',
    name: '未命名笔记 03.md',
    deleted_at: '2026-10-13T11:44:00Z',
    size: 1126,
  },
  {
    id: '20261012-093000-e5f6',
    rel_path: 'Articles/收集箱/张量初步.md',
    name: '张量初步.md',
    deleted_at: '2026-10-12T01:30:00Z',
    size: 3276,
  },
]

function payload(items: TrashItem[] = ITEMS): TrashListPayload {
  return { count: items.length, items }
}

let root: Root | null = null
let container: HTMLDivElement

function byTestId(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}
function text(): string {
  return container.textContent ?? ''
}
function allButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}
function buttonByText(label: string): HTMLButtonElement | undefined {
  return allButtons().find((b) => (b.textContent ?? '').replace(/\s+/g, '').includes(label.replace(/\s+/g, '')))
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

async function mount(overrides: Partial<FocusPageProps> = {}): Promise<FocusPageProps> {
  const props: FocusPageProps = {
    onNavigate: vi.fn(),
    onOpenArticle: vi.fn(),
    onNewArticle: vi.fn(),
    refreshToken: 0,
    ...overrides,
  }
  await act(async () => {
    root = createRoot(container)
    root.render(<TrashPage {...props} />)
  })
  await settle()
  return props
}

async function rerender(props: FocusPageProps): Promise<void> {
  await act(async () => {
    root!.render(<TrashPage {...props} />)
  })
  await settle()
}

async function click(el: Element | null | undefined, label: string): Promise<void> {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  promptMocks.askConfirm.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.mocked(api.listTrash).mockResolvedValue(payload())
  vi.mocked(api.restoreTrash).mockResolvedValue({
    id: ITEMS[0].id,
    restored_to: ITEMS[0].rel_path,
    renamed: false,
  })
  vi.mocked(api.purgeTrash).mockResolvedValue(undefined)
  vi.mocked(api.clearTrash).mockResolvedValue(undefined)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

describe('TrashPage · 数据渲染', () => {
  it('渲染回收站行：名称/原路径/删除时间/大小；副标题显示项数', async () => {
    await mount()
    expect(api.listTrash).toHaveBeenCalledTimes(1)
    expect(text()).toContain('3 篇已删除文档')
    expect(byTestId('trash-list')).toBeTruthy()
    for (const item of ITEMS) {
      expect(byTestId(`trash-row-${item.id}`)?.textContent).toContain(item.name)
    }
    // 原路径（所在文件夹）
    expect(text()).toContain('Articles/普通物理学（上）')
    expect(text()).toContain('Articles/收集箱')
    // 大小（formatBytes：16588 → 16.2 KB）+ 删除时间（10 月 14 日）
    expect(text()).toContain('16.2 KB')
    expect(text()).toContain('10 月 14 日')
    // 底部范围说明
    expect(text()).toContain('只有文档会进入回收站')
  })

  it('refreshToken 变化 / 点刷新按钮 → 重新取数', async () => {
    const props = await mount()
    await rerender({ ...props, refreshToken: 1 })
    expect(api.listTrash).toHaveBeenCalledTimes(2)
    await click(buttonByText('刷新'), '刷新按钮')
    expect(api.listTrash).toHaveBeenCalledTimes(3)
  })
})

describe('TrashPage · 加载/错误/空态', () => {
  it('加载中显示占位文案，完成后渲染列表', async () => {
    let resolveList: ((v: TrashListPayload) => void) | null = null
    vi.mocked(api.listTrash).mockImplementation(
      () => new Promise<TrashListPayload>((resolve) => {
        resolveList = resolve
      }),
    )
    await act(async () => {
      root = createRoot(container)
      root.render(
        <TrashPage onNavigate={vi.fn()} onOpenArticle={vi.fn()} onNewArticle={vi.fn()} refreshToken={0} />,
      )
    })
    expect(byTestId('loading-state')?.textContent).toContain('加载中')
    await act(async () => {
      resolveList?.(payload())
    })
    await settle()
    expect(byTestId('trash-list')).toBeTruthy()
  })

  it('加载失败显示错误态，点重试恢复', async () => {
    vi.mocked(api.listTrash).mockRejectedValueOnce(new Error('backend down'))
    await mount()
    expect(byTestId('error-state')?.textContent).toContain('回收站加载失败')
    await click(buttonByText('重试'), '重试按钮')
    expect(byTestId('trash-list')).toBeTruthy()
    expect(api.listTrash).toHaveBeenCalledTimes(2)
  })

  it('空态：回收站为空时显示引导，清空按钮禁用', async () => {
    vi.mocked(api.listTrash).mockResolvedValue(payload([]))
    await mount()
    expect(byTestId('empty-state')?.textContent).toContain('回收站为空')
    expect(byTestId('clear-trash')?.hasAttribute('disabled')).toBe(true)
  })
})

describe('TrashPage · 恢复', () => {
  it('恢复：restoreTrash(id) → 刷新 + 成功提示', async () => {
    await mount()
    await click(byTestId(`trash-restore-${ITEMS[0].id}`), '恢复按钮')
    expect(api.restoreTrash).toHaveBeenCalledWith(ITEMS[0].id)
    expect(api.listTrash).toHaveBeenCalledTimes(2)
    expect(byTestId('page-status')?.textContent).toContain('已恢复')
    expect(byTestId('page-status')?.textContent).toContain(ITEMS[0].rel_path)
  })

  it('恢复同名冲突（后端自动改名）：提示新文件名', async () => {
    vi.mocked(api.restoreTrash).mockResolvedValue({
      id: ITEMS[0].id,
      restored_to: 'Articles/普通物理学（上）/Homework-Ch6-旧版-1.md',
      renamed: true,
    })
    await mount()
    await click(byTestId(`trash-restore-${ITEMS[0].id}`), '恢复按钮')
    expect(byTestId('page-status')?.textContent).toContain('自动改名')
    expect(byTestId('page-status')?.textContent).toContain('Homework-Ch6-旧版-1.md')
  })

  it('恢复失败：提示错误信息', async () => {
    vi.mocked(api.restoreTrash).mockRejectedValue(new Error('409 目标路径冲突'))
    await mount()
    await click(byTestId(`trash-restore-${ITEMS[0].id}`), '恢复按钮')
    expect(byTestId('page-status')?.textContent).toContain('恢复失败')
  })
})

describe('TrashPage · 彻底删除与清空', () => {
  it('彻底删除：askConfirm 确认后 purgeTrash(id) + 刷新', async () => {
    await mount()
    await click(byTestId(`trash-purge-${ITEMS[1].id}`), '彻底删除按钮')
    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(promptMocks.askConfirm).mock.calls[0][0]).toContain(ITEMS[1].name)
    expect(api.purgeTrash).toHaveBeenCalledWith(ITEMS[1].id)
    expect(api.listTrash).toHaveBeenCalledTimes(2)
    expect(byTestId('page-status')?.textContent).toContain('已彻底删除')
  })

  it('彻底删除：取消确认不调用 purgeTrash', async () => {
    promptMocks.askConfirm.mockResolvedValue(false)
    await mount()
    await click(byTestId(`trash-purge-${ITEMS[1].id}`), '彻底删除按钮')
    expect(api.purgeTrash).not.toHaveBeenCalled()
    expect(api.listTrash).toHaveBeenCalledTimes(1)
  })

  it('清空回收站：askConfirm 确认后 clearTrash + 刷新', async () => {
    vi.mocked(api.listTrash).mockResolvedValueOnce(payload()).mockResolvedValueOnce(payload([]))
    await mount()
    await click(byTestId('clear-trash'), '清空回收站')
    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(promptMocks.askConfirm).mock.calls[0][0]).toContain('清空回收站')
    expect(api.clearTrash).toHaveBeenCalledTimes(1)
    expect(api.listTrash).toHaveBeenCalledTimes(2)
    expect(byTestId('page-status')?.textContent).toContain('回收站已清空')
    expect(byTestId('empty-state')).toBeTruthy()
  })

  it('清空回收站：取消确认不调用 clearTrash', async () => {
    promptMocks.askConfirm.mockResolvedValue(false)
    await mount()
    await click(byTestId('clear-trash'), '清空回收站')
    expect(api.clearTrash).not.toHaveBeenCalled()
    expect(api.listTrash).toHaveBeenCalledTimes(1)
  })

  it('清空失败：提示错误', async () => {
    vi.mocked(api.clearTrash).mockRejectedValue(new Error('500 磁盘错误'))
    await mount()
    await click(byTestId('clear-trash'), '清空回收站')
    expect(byTestId('page-status')?.textContent).toContain('清空回收站失败')
  })
})
