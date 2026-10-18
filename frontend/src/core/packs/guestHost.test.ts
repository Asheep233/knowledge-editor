/** UI 工坊 A7：产品 guest 会话宿主控制器（fake backend/wire；无 DOM）。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import { createGuestSessionHost, type GuestHostBackend } from './guestHost'

const MANIFEST: PackManifest = {
  id: 'com.demo.guest',
  name: 'Guest Demo',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell', 'panel.sidebar', 'context.read'],
  entry: { html: 'index.html' },
  commands: [],
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

function backend(overrides: Partial<GuestHostBackend> = {}): GuestHostBackend {
  return {
    verify: vi.fn(async () => true),
    readManifest: vi.fn(async () => MANIFEST),
    deactivate: vi.fn(async () => undefined),
    recover: vi.fn(async () => ({ recovered: true, action: 'clean' })),
    loadEntry: vi.fn(async () => ({ html: '<html>guest</html>', assets: {} })),
    reportSession: vi.fn(async () => undefined),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('A7 GuestSessionHost', () => {
  it('trusted 等级启动：会话 active、entry 加载、能力上限=等级∩manifest、状态落盘', async () => {
    const b = backend()
    const statuses: string[] = []
    const host = createGuestSessionHost({ backend: b, tier: 'trusted', onStatus: (s) => statuses.push(s.state) })
    const result = await host.start('com.demo.guest', '1.0.0')
    expect(result.blocked).toBe(false)
    expect(result.entryHtml).toBe('<html>guest</html>')
    expect(result.capabilities).toEqual(['ui.shell', 'panel.sidebar', 'context.read'])
    expect(statuses).toContain('active')
    expect(b.reportSession).toHaveBeenCalledWith(expect.objectContaining({ state: 'active', packId: 'com.demo.guest' }))
    await host.stop()
    expect(b.reportSession).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopped' }))
  })

  it('community 等级能力不允许 → blocked，不启动会话', async () => {
    const b = backend()
    const host = createGuestSessionHost({ backend: b, tier: 'community' })
    const result = await host.start('com.demo.guest', '1.0.0')
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('E_CAPABILITY_TIER')
    expect(b.loadEntry).not.toHaveBeenCalled()
    expect(b.reportSession).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed' }))
  })

  it('心跳超时 → 自动 reportCrash（suspended）→ 再超限 failed + safeMode', async () => {
    vi.useFakeTimers()
    const b = backend()
    const host = createGuestSessionHost({ backend: b, tier: 'trusted', maxCrashes: 2 })
    await host.start('com.demo.guest', '1.0.0')
    host.startHeartbeatMonitor()
    host.heartbeat()
    await vi.advanceTimersByTimeAsync(1500) // 第一次超时 → reportCrash → suspended
    host.heartbeat()
    await vi.advanceTimersByTimeAsync(1500) // 第二次 → suspended
    host.heartbeat()
    await vi.advanceTimersByTimeAsync(1500) // 第三次 → 超限 failed
    expect(b.deactivate).toHaveBeenCalled()
    expect(b.recover).toHaveBeenCalled()
    expect(host.isSafeMode()).toBe(true)
    await host.stop()
  })

  it('未收到心跳前不误报崩溃', async () => {
    vi.useFakeTimers()
    const b = backend()
    const host = createGuestSessionHost({ backend: b, tier: 'trusted' })
    await host.start('com.demo.guest', '1.0.0')
    host.startHeartbeatMonitor()
    await vi.advanceTimersByTimeAsync(3000)
    expect(b.deactivate).not.toHaveBeenCalled()
    await host.stop()
  })
})
