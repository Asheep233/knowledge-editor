/** UI 工坊 A7：guest 宿主 UI（blocked/启用路径；产品测试栈 react-dom/client + act）。 */
import { act } from 'react'

const CS = vi.hoisted(() => ({
  runtimeSubscribers: [] as Array<{ onUnavailable?: (m: string) => void; onReady?: () => void }>,
}))

vi.mock('../../core/packs/runtimeHealthEvents', () => ({
  subscribeRuntimeHealthEvents: async (callbacks?: { onUnavailable?: (m: string) => void; onReady?: () => void }) => {
    CS.runtimeSubscribers.push(callbacks ?? {})
    return () => undefined
  },
}))

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from '../../core/packs/manifest'
import type { GuestHostBackend } from '../../core/packs/guestHost'
import { HostDispatcher } from '../../core/protocol/channel'
import { WorkshopGuestFrame } from './WorkshopGuestFrame'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MANIFEST: PackManifest = {
  id: 'com.demo.guest',
  name: 'Guest Demo',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell', 'context.read'],
  entry: { html: 'index.html' },
  commands: [],
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

function backend(): GuestHostBackend {
  return {
    verify: vi.fn(async () => true),
    readManifest: vi.fn(async () => MANIFEST),
    deactivate: vi.fn(async () => undefined),
    recover: vi.fn(async () => ({ recovered: true, action: 'clean' })),
    loadEntry: vi.fn(async () => ({ html: '<!doctype html><html><body>guest</body></html>', assets: {} })),
    reportSession: vi.fn(async () => undefined),
  }
}

let root: Root | null = null
let container: HTMLDivElement

const flush = async (times = 3) => {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

const text = () => container.textContent ?? ''
const buttonByText = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined
const click = async (el: HTMLElement | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function mount(tier: 'trusted' | 'community', backendImpl = backend()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<WorkshopGuestFrame packId="com.demo.guest" version="1.0.0" tier={tier} backend={backendImpl} />)
  })
  await flush()
}

beforeEach(() => {
  CS.runtimeSubscribers.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  container.remove()
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('A7 WorkshopGuestFrame', () => {
  it('community 等级能力不允许 → 显示错误、不渲染 iframe', async () => {
    await mount('community')
    await click(buttonByText('启用 guest'))
    expect(text()).toMatch(/E_CAPABILITY_TIER/)
    expect(text()).toContain('guest：failed')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('trusted 等级启用 → active + 能力显示 + iframe 渲染', async () => {
    await mount('trusted')
    await click(buttonByText('启用 guest'))
    expect(text()).toContain('guest：active')
    expect(text()).toContain('ui.shell, context.read')
    expect(container.querySelector('iframe')).not.toBeNull()
  })
})

describe('T26 G4 宿主事件 → dispatcher.emit（guest 协议事件源）', () => {
  it('保存成功 window 事件 → emit document-saved（载荷正确）', async () => {
    const emitSpy = vi.spyOn(HostDispatcher.prototype, 'emit')
    await mount('trusted')
    await click(buttonByText('启用 guest'))
    expect(text()).toContain('guest：active')
    window.dispatchEvent(
      new CustomEvent('ke:workshop-document-saved', { detail: { relPath: 'Articles/a.md', revision: 7 } }),
    )
    await flush(5)
    expect(emitSpy).toHaveBeenCalledWith({ type: 'document-saved', relPath: 'Articles/a.md', revision: 7 })
  })

  it('主题变化（data-theme）→ emit theme-changed', async () => {
    const emitSpy = vi.spyOn(HostDispatcher.prototype, 'emit')
    await mount('trusted')
    await click(buttonByText('启用 guest'))
    document.documentElement.dataset.theme = 'dark'
    await flush(5)
    expect(emitSpy).toHaveBeenCalledWith({ type: 'theme-changed', theme: 'dark' })
  })

  it('文档切换 window 事件 → emit context-changed（上下文解析失败时回退默认上下文，不丢通知）', async () => {
    const emitSpy = vi.spyOn(HostDispatcher.prototype, 'emit')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    await mount('trusted')
    await click(buttonByText('启用 guest'))
    window.dispatchEvent(new CustomEvent('ke:workshop-context-changed', { detail: { relPath: 'Articles/b.md' } }))
    await flush(8)
    expect(emitSpy).toHaveBeenCalledWith({ type: 'context-changed', contextId: 'ke-default', epoch: 1 })
  })
})

describe('W07 B-5 宿主 sidecar 健康事件 → guest 会话状态', () => {
  it('sidecar 异常 → guest 会话 suspended + lastError 落盘；runtime-ready → 恢复 active', async () => {
    const b = backend()
    const reports: Array<{ state: string; lastError?: string | null }> = []
    const reportMock = b.reportSession as unknown as {
      mockImplementation: (fn: (s: { state: string; lastError?: string | null }) => Promise<unknown>) => void
    }
    reportMock.mockImplementation(async (status) => {
      reports.push({ state: status.state, lastError: status.lastError })
      return status
    })
    await mount('trusted', b)
    await click(buttonByText('启用 guest'))
    expect(text()).toContain('guest：active')
    expect(CS.runtimeSubscribers.length).toBeGreaterThan(0)
    const subscriber = CS.runtimeSubscribers[CS.runtimeSubscribers.length - 1]

    act(() => subscriber.onUnavailable?.('后端连接中断，正在自动恢复（第 1/3 次）'))
    await flush(4)
    expect(text()).toContain('guest：suspended')
    expect(reports.some((r) => r.state === 'suspended' && String(r.lastError ?? '').includes('E_HOST_UNAVAILABLE'))).toBe(true)

    act(() => subscriber.onReady?.())
    await flush(4)
    expect(text()).toContain('guest：active')
    expect(reports.some((r) => r.state === 'active' && !r.lastError)).toBe(true)
  })

  it('未启用 guest 时收到事件 → 不产生状态上报/不误报', async () => {
    const b = backend()
    await mount('trusted', b)
    // 不点「启用 guest」，只触发事件
    expect(CS.runtimeSubscribers.length).toBeGreaterThan(0)
    const subscriber = CS.runtimeSubscribers[CS.runtimeSubscribers.length - 1]
    act(() => subscriber.onUnavailable?.('后端连接中断'))
    await flush(3)
    expect(text()).not.toContain('guest：suspended')
    expect(b.reportSession).not.toHaveBeenCalled()
  })
})
