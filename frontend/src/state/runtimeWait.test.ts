/** P1-13 回归测试：等待运行时基址（5–15s 才就绪 → 最终注入成功）。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiBase, waitForRuntimeBase } from './runtimeWait'

describe('waitForRuntimeBase — P1-13', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('后端 8s 才就绪：轮询最终拿到基址并成功注入（不因 4s 放弃）', async () => {
    const readyAtMs = 8000
    const probe = vi.fn(async () => (Date.now() >= readyAtMs ? 'http://127.0.0.1:8000/' : null))
    const p = waitForRuntimeBase({ probe, timeoutMs: 30000, pollMs: 100 })

    await vi.advanceTimersByTimeAsync(readyAtMs)
    const result = await p
    expect(result).toBe('http://127.0.0.1:8000')
  })

  it('立即就绪：首次探测即返回（无需等待）', async () => {
    const p = waitForRuntimeBase({
      probe: async () => 'http://127.0.0.1:8000',
      timeoutMs: 30000,
      pollMs: 100,
    })
    await expect(p).resolves.toBe('http://127.0.0.1:8000')
  })

  it('超时后返回 null（不再无限等待）', async () => {
    const p = waitForRuntimeBase({ probe: async () => null, timeoutMs: 30000, pollMs: 100 })
    await vi.advanceTimersByTimeAsync(30500)
    await expect(p).resolves.toBeNull()
  })

  it('事件驱动：ke:runtime-ready 事件 payload 直接带出 api_base', async () => {
    // 明确 payload 契约：Rust 在事件里带 { api_base, ... }
    const waitForEvent = vi
      .fn()
      .mockImplementation(async (_name: string) => 'http://127.0.0.1:8000/')
    const probe = vi.fn(async () => null)
    const p = waitForRuntimeBase({ probe, timeoutMs: 30000, pollMs: 100, waitForEvent })
    await expect(p).resolves.toBe('http://127.0.0.1:8000')
    expect(waitForEvent).toHaveBeenCalledWith('ke:runtime-ready', expect.any(Number))
    // 事件已提供基址，无需再依赖 probe
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('事件超时（返回 null）→ 回退到 probe 轮询', async () => {
    const waitForEvent = vi.fn().mockImplementation(async (_name: string) => null)
    let calls = 0
    const probe = vi.fn(async () => (++calls >= 2 ? 'http://127.0.0.1:8000' : null))
    const p = waitForRuntimeBase({ probe, timeoutMs: 30000, pollMs: 100, waitForEvent })
    await vi.advanceTimersByTimeAsync(200)
    await expect(p).resolves.toBe('http://127.0.0.1:8000')
  })
})

describe('normalizeApiBase', () => {
  it('去尾部斜杠', () => {
    expect(normalizeApiBase('http://127.0.0.1:8000///')).toBe('http://127.0.0.1:8000')
  })
})
