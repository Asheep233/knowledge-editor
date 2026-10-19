/** W07 B-4/B-5：sidecar 运行时健康事件归约与订阅（纯逻辑 + 注入 listen，无 Tauri 依赖）。 */
import { describe, expect, it, vi } from 'vitest'

import {
  RUNTIME_EVENT_ERROR,
  RUNTIME_EVENT_READY,
  RUNTIME_EVENT_SIDECAR_EXITED,
  idleRuntimeHealth,
  reduceRuntimeHealth,
  subscribeRuntimeHealthEvents,
  type RuntimeHealthCallbacks,
  type RuntimeHealthListen,
} from './runtimeHealthEvents'

describe('W07 B-4 runtimeHealthEvents：状态归约', () => {
  it('正常启动（idle 收到 ke:runtime-ready）不产生 banner 状态（不误报「已恢复」）', () => {
    const idle = idleRuntimeHealth()
    expect(reduceRuntimeHealth(idle, 'runtime-ready', { api_base: 'http://127.0.0.1:8000' })).toBe(idle)
  })

  it('ke:sidecar-exited（restarting=true）→ restarting，含第 N/M 次与载荷 code', () => {
    const next = reduceRuntimeHealth(idleRuntimeHealth(), 'sidecar-exited', {
      code: 1,
      signal: null,
      restarting: true,
      attempt: 2,
      maxRestarts: 3,
    })
    expect(next.phase).toBe('restarting')
    expect(next.message).toContain('正在自动恢复')
    expect(next.message).toContain('第 2/3 次')
    expect(next.attempt).toBe(2)
    expect(next.maxRestarts).toBe(3)
  })

  it('ke:sidecar-exited（restarting=false，显式停机）→ degraded', () => {
    const next = reduceRuntimeHealth(idleRuntimeHealth(), 'sidecar-exited', { restarting: false })
    expect(next.phase).toBe('degraded')
    expect(next.message).toContain('侧车已停止')
  })

  it('ke:runtime-error → degraded，message 原样转述（不伪造）', () => {
    const next = reduceRuntimeHealth(idleRuntimeHealth(), 'runtime-error', {
      message: '侧车崩溃且自动重启次数已耗尽',
      terminal: true,
      maxRestarts: 3,
    })
    expect(next.phase).toBe('degraded')
    expect(next.message).toBe('后端已降级：侧车崩溃且自动重启次数已耗尽')
    expect(next.maxRestarts).toBe(3)
  })

  it('异常态收到 ke:runtime-ready → recovered；恢复后再次 ready 不重复变化', () => {
    let state = reduceRuntimeHealth(idleRuntimeHealth(), 'sidecar-exited', { restarting: true })
    state = reduceRuntimeHealth(state, 'runtime-ready', { api_base: 'http://127.0.0.1:8001' })
    expect(state.phase).toBe('recovered')
    expect(state.message).toBe('后端已恢复')
  })
})

describe('W07 B-4/B-5 runtimeHealthEvents：订阅', () => {
  function fakeListen() {
    const handlers = new Map<string, (event: { payload: unknown }) => void>()
    const unlistened: string[] = []
    const listen: RuntimeHealthListen = vi.fn(async (event, handler) => {
      handlers.set(event, handler)
      return () => {
        unlistened.push(event)
        handlers.delete(event)
      }
    })
    return { listen, handlers, unlistened }
  }

  it('三个事件各自驱动回调：不可用（B-5 挂起）/恢复（B-5 恢复）/状态变化（B-4 banner）', async () => {
    const { listen, handlers } = fakeListen()
    const states: string[] = []
    const unavailable: string[] = []
    const ready: string[] = []
    const callbacks: RuntimeHealthCallbacks = {
      onChanged: (s) => states.push(s.phase),
      onUnavailable: (m) => unavailable.push(m),
      onReady: (p) => ready.push(String(p.api_base)),
    }
    const dispose = await subscribeRuntimeHealthEvents(callbacks, listen)
    expect([...handlers.keys()].sort()).toEqual(
      [RUNTIME_EVENT_READY, RUNTIME_EVENT_ERROR, RUNTIME_EVENT_SIDECAR_EXITED].sort(),
    )
    handlers.get(RUNTIME_EVENT_SIDECAR_EXITED)!({ payload: { restarting: true, attempt: 1, maxRestarts: 3 } })
    expect(states).toEqual(['restarting'])
    expect(unavailable).toHaveLength(1)
    handlers.get(RUNTIME_EVENT_ERROR)!({ payload: { message: '重启失败', terminal: true } })
    expect(states).toEqual(['restarting', 'degraded'])
    expect(unavailable).toHaveLength(2)
    expect(unavailable[1]).toContain('重启失败')
    handlers.get(RUNTIME_EVENT_READY)!({ payload: { api_base: 'http://127.0.0.1:8001' } })
    expect(states).toEqual(['restarting', 'degraded', 'recovered'])
    expect(ready).toEqual(['http://127.0.0.1:8001'])
    dispose()
  })

  it('dispose 后退订全部事件；重复 dispose 幂等', async () => {
    const { listen, handlers, unlistened } = fakeListen()
    const onChanged = vi.fn()
    const dispose = await subscribeRuntimeHealthEvents({ onChanged }, listen)
    const lateHandler = handlers.get(RUNTIME_EVENT_ERROR)!
    dispose()
    expect(unlistened.sort()).toEqual([RUNTIME_EVENT_READY, RUNTIME_EVENT_ERROR, RUNTIME_EVENT_SIDECAR_EXITED].sort())
    dispose()
    lateHandler({ payload: { message: 'late' } })
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('listen 失败（非 Tauri/Web 环境）→ 安全降级为 no-op，不抛错、不回调', async () => {
    const listen: RuntimeHealthListen = vi.fn(async () => {
      throw new Error('not tauri')
    })
    const onChanged = vi.fn()
    await expect(subscribeRuntimeHealthEvents({ onChanged }, listen)).resolves.toBeTypeOf('function')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('listen 返回非函数（旧 mock/异常实现）→ 退订函数仍可用', async () => {
    const listen = vi.fn(async () => undefined as unknown as () => void)
    const dispose = await subscribeRuntimeHealthEvents({}, listen as unknown as RuntimeHealthListen)
    expect(() => dispose()).not.toThrow()
  })
})
