/** T26 G4：产品 window 事件 → 协议 HostEvent 桥（emit 调用/载荷/如实不伪造/主题观察）。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HostEvent } from '../../core/protocol/types'
import { createHostEventBridge, observeProductTheme, readProductTheme } from './hostEventBridge'
import {
  WORKSHOP_EVENT_CONTEXT_CHANGED,
  WORKSHOP_EVENT_DOCUMENT_SAVED,
  WORKSHOP_EVENT_THEME_CHANGED,
} from './workshopHostEvents'

const flush = async (times = 3) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
}

function dispatch(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

const debugWindow = () =>
  window as unknown as { __keHostEventLog?: HostEvent[]; __keHostEventErrors?: string[] }

afterEach(() => {
  delete document.documentElement.dataset.theme
  debugWindow().__keHostEventLog = undefined
  debugWindow().__keHostEventErrors = undefined
})

describe('T26 G4 HostEventBridge', () => {
  it('保存事件（带真实 revision）→ emit document-saved，载荷正确', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({ emit })
    dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, { relPath: 'Articles/a.md', revision: 7 })
    await flush()
    expect(emit).toHaveBeenCalledWith({ type: 'document-saved', relPath: 'Articles/a.md', revision: 7 })
    expect(bridge.emitted).toEqual([{ type: 'document-saved', relPath: 'Articles/a.md', revision: 7 }])
    bridge.dispose()
  })

  it('保存事件缺 revision → 用注入的 resolveRevision 解析真实 revision（不伪造）', async () => {
    const emit = vi.fn()
    const resolveRevision = vi.fn(async () => 12)
    const bridge = createHostEventBridge({ emit, resolveRevision })
    dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, { relPath: 'Articles/b.md', revision: null })
    await flush()
    expect(resolveRevision).toHaveBeenCalledWith('Articles/b.md')
    expect(emit).toHaveBeenCalledWith({ type: 'document-saved', relPath: 'Articles/b.md', revision: 12 })
    bridge.dispose()
  })

  it('revision 解析失败 → 拒绝发射（宁可不发，不伪造），记 error', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({ emit, resolveRevision: async () => null })
    dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, { relPath: 'Articles/c.md', revision: null })
    await flush()
    expect(emit).not.toHaveBeenCalled()
    expect(bridge.errors.join('\n')).toMatch(/无法确认真实 revision/)
    bridge.dispose()
  })

  it('非法保存载荷（缺 relPath/非法 revision）→ 不发射', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({ emit })
    dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, { revision: 1 })
    dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, { relPath: '', revision: 1 })
    dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, { relPath: 'Articles/x.md', revision: -2 })
    await flush()
    expect(emit).not.toHaveBeenCalled()
    expect(bridge.errors.length).toBeGreaterThanOrEqual(3)
    bridge.dispose()
  })

  it('上下文变化 → emit context-changed（真实 contextId/epoch）', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({
      emit,
      resolveContext: async () => ({ contextId: 'ke-default', epoch: 3 }),
    })
    dispatch(WORKSHOP_EVENT_CONTEXT_CHANGED, { relPath: 'Articles/a.md' })
    await flush()
    expect(emit).toHaveBeenCalledWith({ type: 'context-changed', contextId: 'ke-default', epoch: 3 })
    bridge.dispose()
  })

  it('上下文解析失败 → 回退默认上下文仍发射并记 error（不丢通知）', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({
      emit,
      resolveContext: async () => {
        throw new Error('backend down')
      },
    })
    dispatch(WORKSHOP_EVENT_CONTEXT_CHANGED, null)
    await flush()
    expect(emit).toHaveBeenCalledWith({ type: 'context-changed', contextId: 'ke-default', epoch: 1 })
    expect(bridge.errors.join('\n')).toMatch(/backend down/)
    bridge.dispose()
  })

  it('主题事件 → emit theme-changed；非法 theme 拒绝', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({ emit })
    dispatch(WORKSHOP_EVENT_THEME_CHANGED, { theme: 'dark' })
    dispatch(WORKSHOP_EVENT_THEME_CHANGED, { theme: 'neon' })
    await flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({ type: 'theme-changed', theme: 'dark' })
    expect(bridge.errors.join('\n')).toMatch(/非法 theme/)
    bridge.dispose()
  })

  it('dispose 后退订：不再发射', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({ emit })
    bridge.dispose()
    dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, { relPath: 'Articles/a.md', revision: 1 })
    await flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('诊断日志 window.__keHostEventLog 记录已发射事件', async () => {
    const emit = vi.fn()
    const bridge = createHostEventBridge({ emit })
    dispatch(WORKSHOP_EVENT_THEME_CHANGED, { theme: 'light' })
    await flush()
    expect(debugWindow().__keHostEventLog).toEqual([{ type: 'theme-changed', theme: 'light' }])
    bridge.dispose()
  })
})

describe('T26 G4 产品主题观察', () => {
  it('readProductTheme：data-theme dark/light/未设置（system）', () => {
    expect(readProductTheme()).toBe('system')
    document.documentElement.dataset.theme = 'dark'
    expect(readProductTheme()).toBe('dark')
    document.documentElement.dataset.theme = 'light'
    expect(readProductTheme()).toBe('light')
  })

  it('observeProductTheme：data-theme 变化 → 回调实际主题；dispose 后不再触发', async () => {
    const seen: string[] = []
    const stop = observeProductTheme((theme) => seen.push(theme))
    document.documentElement.dataset.theme = 'dark'
    await flush()
    expect(seen).toEqual(['dark'])
    document.documentElement.dataset.theme = 'light'
    await flush()
    expect(seen).toEqual(['dark', 'light'])
    stop()
    document.documentElement.dataset.theme = 'dark'
    await flush()
    expect(seen).toEqual(['dark', 'light'])
  })
})
