/** UI 工坊 T23：工坊入口（flag 关闭零渲染；开启后打开面板）。 */
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listen } from '@tauri-apps/api/event'
import { WorkshopEntry } from './WorkshopEntry'
import type { WorkshopAdapter } from './WorkshopPanel'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeAdapter(): WorkshopAdapter {
  return {
    listInstalled: vi.fn(async () => []),
    stageFromFile: vi.fn(async () => null),
    confirmInstall: vi.fn(async () => undefined),
    cancelPreview: vi.fn(() => true),
    rollback: vi.fn(async () => undefined),
    recover: vi.fn(async () => ({ recovered: false, action: 'clean' })),
  }
}

let root: Root | null = null
let container: HTMLDivElement

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function mount(el: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(el)
  })
  await flush()
}

const buttonByText = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.mocked(listen).mockResolvedValue(() => undefined)
})

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  container.remove()
})

describe('T23 工坊入口', () => {
  it('flag 关闭时零渲染（既有 App 不受影响）', async () => {
    await mount(<WorkshopEntry enabled={false} adapter={makeAdapter()} />)
    expect(container.innerHTML).toBe('')
  })

  it('flag 开启显示入口，点击打开面板并加载已安装包', async () => {
    const adapter = makeAdapter()
    await mount(<WorkshopEntry enabled adapter={adapter} />)
    const entry = buttonByText('创意工坊')
    expect(entry).toBeTruthy()
    await act(async () => {
      entry!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.textContent).toContain('已安装包')
    expect(adapter.listInstalled).toHaveBeenCalled()
  })

  it('收到 workshop://recover-status(safeMode) 事件显示 safe mode 徽标', async () => {
    const handlers: Array<(e: { payload: unknown }) => void> = []
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      handlers.push(handler as unknown as (e: { payload: unknown }) => void)
      return () => undefined
    })
    await mount(<WorkshopEntry enabled adapter={makeAdapter()} />)
    await flush()
    await act(async () => {
      for (const h of handlers) h({ payload: { safeMode: true } })
    })
    await flush()
    expect(container.textContent).toContain('safe mode')
  })

  it('点击关闭后对话框消失', async () => {
    await mount(<WorkshopEntry enabled adapter={makeAdapter()} />)
    await act(async () => {
      buttonByText('创意工坊')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    await act(async () => {
      buttonByText('关闭')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('W07 C2-3 冷启动入口 safeMode/恢复角标', () => {
  const baseAdapter = () => {
    const adapter = makeAdapter()
    return adapter as WorkshopAdapter & { startupStatus: ReturnType<typeof vi.fn> }
  }

  function adapterWithStatus(status: unknown) {
    const adapter = makeAdapter() as WorkshopAdapter & { startupStatus: ReturnType<typeof vi.fn> }
    adapter.startupStatus = vi.fn(async () => status as never)
    return adapter
  }

  it('safeMode=true → 入口显示角标（aria/title 可读）并同步 safe mode 文案', async () => {
    const adapter = adapterWithStatus({
      found: true,
      checked: 2,
      safeMode: true,
      results: [{ id: 'com.demo.bad', recovered: false, action: 'corrupt-no-fallback' }],
    })
    await mount(<WorkshopEntry enabled adapter={adapter} />)
    await flush()
    const badge = container.querySelector('[data-testid="workshop-startup-badge"]')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toContain('启动恢复告警')
    expect(badge!.getAttribute('title')).toContain('safe mode')
    expect(container.textContent).toContain('safe mode')
    expect(adapter.startupStatus).toHaveBeenCalledTimes(1)
  })

  it('非 clean 恢复动作（回滚/清理 journal）→ 角标显示处理数量', async () => {
    const adapter = adapterWithStatus({
      found: true,
      checked: 3,
      safeMode: false,
      results: [
        { id: 'com.demo.a', recovered: true, action: 'rollback-corrupt-active' },
        { id: 'com.demo.b', recovered: true, action: 'cleanup-journal' },
        { id: 'com.demo.c', recovered: false, action: 'clean' },
      ],
    })
    await mount(<WorkshopEntry enabled adapter={adapter} />)
    await flush()
    const badge = container.querySelector('[data-testid="workshop-startup-badge"]')!
    expect(badge.textContent).toContain('启动恢复 2')
    expect(badge.getAttribute('title')).toContain('已自动恢复 2 个包')
  })

  it('无状态（found:false / 全 clean / 旧构建无 startupStatus）→ 无角标（不误报）', async () => {
    const notFound = adapterWithStatus({ found: false, checked: 0, safeMode: false, results: [] })
    await mount(<WorkshopEntry enabled adapter={notFound} />)
    await flush()
    expect(container.querySelector('[data-testid="workshop-startup-badge"]')).toBeNull()
    expect(container.textContent).not.toContain('safe mode')

    if (root) {
      await act(async () => root!.unmount())
      root = null
    }
    container.remove()
    const cleanOnly = adapterWithStatus({
      found: true,
      checked: 1,
      safeMode: false,
      results: [{ id: 'com.demo.x', recovered: false, action: 'clean' }],
    })
    await mount(<WorkshopEntry enabled adapter={cleanOnly} />)
    await flush()
    expect(container.querySelector('[data-testid="workshop-startup-badge"]')).toBeNull()

    if (root) {
      await act(async () => root!.unmount())
      root = null
    }
    container.remove()
    const legacy = baseAdapter()
    delete (legacy as { startupStatus?: unknown }).startupStatus
    await mount(<WorkshopEntry enabled adapter={legacy} />)
    await flush()
    expect(container.querySelector('[data-testid="workshop-startup-badge"]')).toBeNull()
  })

  it('读取 startupStatus 抛错 → 静默降级（入口正常、无角标）', async () => {
    const adapter = makeAdapter() as WorkshopAdapter & { startupStatus: ReturnType<typeof vi.fn> }
    adapter.startupStatus = vi.fn(async () => {
      throw new Error('E_UNKNOWN_COMMAND')
    })
    await mount(<WorkshopEntry enabled adapter={adapter} />)
    await flush()
    expect(buttonByText('创意工坊')).toBeTruthy()
    expect(container.querySelector('[data-testid="workshop-startup-badge"]')).toBeNull()
    expect(container.textContent).not.toContain('E_UNKNOWN_COMMAND')
  })

  it('入口只在挂载时读一次（面板打开后由 Panel 自己按需再读，各自职责）', async () => {
    const adapter = adapterWithStatus({
      found: true,
      checked: 1,
      safeMode: false,
      results: [{ id: 'com.demo.a', recovered: true, action: 'rollback-corrupt-active' }],
    })
    await mount(<WorkshopEntry enabled adapter={adapter} />)
    await flush()
    expect(adapter.startupStatus).toHaveBeenCalledTimes(1)
    const badge = container.querySelector('[data-testid="workshop-startup-badge"]')
    expect(badge).toBeTruthy()
    await act(async () => {
      buttonByText('创意工坊')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    // 面板自身 effect（W07 C1-4 提示）会独立读一次；入口角标不重复触发
    expect(adapter.startupStatus).toHaveBeenCalledTimes(2)
  })
})
