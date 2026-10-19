/** W07 B-4：App 级 sidecar 健康 banner —— 崩溃中/恢复/降级可见；无事件不误报。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeHealthCallbacks, RuntimeHealthState } from '../../core/packs/runtimeHealthEvents'
import { RuntimeHealthBanner } from './RuntimeHealthBanner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = async (times = 3) => {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

function state(overrides: Partial<RuntimeHealthState>): RuntimeHealthState {
  return {
    phase: 'idle',
    message: '',
    attempt: null,
    maxRestarts: null,
    updatedAt: 0,
    ...overrides,
  }
}

let root: Root | null = null
let container: HTMLDivElement
let callbacks: RuntimeHealthCallbacks

function mount(recoveredTtlMs = 40) {
  const subscribe = vi.fn(async (cb?: RuntimeHealthCallbacks) => {
    callbacks = cb ?? {}
    return () => undefined
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<RuntimeHealthBanner subscribe={subscribe} recoveredTtlMs={recoveredTtlMs} />)
  })
  return { subscribe }
}

const banner = () => container.querySelector('[data-testid="runtime-health-banner"]') as HTMLElement | null

beforeEach(() => {
  callbacks = {}
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  container.remove()
  delete (window as unknown as { __keRuntimeHealth?: unknown }).__keRuntimeHealth
  vi.restoreAllMocks()
})

describe('W07 B-4 RuntimeHealthBanner', () => {
  it('无事件（idle）→ 不渲染 banner（不误报）', async () => {
    const { subscribe } = mount()
    await flush()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(banner()).toBeNull()
  })

  it('sidecar 崩溃自动恢复中 → 显示「后端重连中」并带重试次数', async () => {
    mount()
    await flush()
    act(() => {
      callbacks.onChanged?.(
        state({ phase: 'restarting', message: '后端连接中断，正在自动恢复（第 2/3 次）', attempt: 2, maxRestarts: 3 }),
      )
    })
    await flush()
    const el = banner()
    expect(el).not.toBeNull()
    expect(el!.dataset.phase).toBe('restarting')
    expect(el!.textContent).toContain('后端重连中')
    expect(el!.textContent).toContain('第 2/3 次')
    // 诊断钩子（W07 探针可读）
    expect((window as unknown as { __keRuntimeHealth?: { phase: string } }).__keRuntimeHealth?.phase).toBe('restarting')
  })

  it('runtime-error 终态 → 显示「后端已降级」+ 原因', async () => {
    mount()
    await flush()
    act(() => {
      callbacks.onChanged?.(state({ phase: 'degraded', message: '后端已降级：侧车崩溃且自动重启次数已耗尽' }))
    })
    await flush()
    expect(banner()!.dataset.phase).toBe('degraded')
    expect(banner()!.textContent).toContain('后端已降级')
    expect(banner()!.textContent).toContain('自动重启次数已耗尽')
  })

  it('ke:runtime-ready 恢复 → 显示「后端已恢复」，TTL 后自动消失，并刷新 api base', async () => {
    mount(30)
    await flush()
    act(() => {
      callbacks.onChanged?.(state({ phase: 'restarting', message: '后端连接中断，正在自动恢复' }))
      callbacks.onReady?.({ api_base: 'http://127.0.0.1:8001' })
      callbacks.onChanged?.(state({ phase: 'recovered', message: '后端已恢复' }))
    })
    await flush()
    expect(banner()!.dataset.phase).toBe('recovered')
    expect(banner()!.textContent).toContain('后端已恢复')
    expect((window as unknown as { __KE_API_BASE__?: string }).__KE_API_BASE__).toBe('http://127.0.0.1:8001')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    await flush()
    expect(banner()).toBeNull()
    delete (window as unknown as { __KE_API_BASE__?: string }).__KE_API_BASE__
  })

  it('卸载后忽略迟到事件（不 setState、无异常）', async () => {
    mount()
    await flush()
    await act(async () => root!.unmount())
    root = null
    act(() => {
      callbacks.onChanged?.(state({ phase: 'degraded', message: 'late' }))
    })
    expect(container.querySelector('[data-testid="runtime-health-banner"]')).toBeNull()
  })
})
