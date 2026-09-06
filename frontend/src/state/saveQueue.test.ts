/** P0-2 / P1-6 回归测试：per-doc 单飞保存队列（fake timers）。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DEBOUNCE_MS,
  cancelPending,
  enqueueSave,
  flushPending,
  flushPendingAll,
  flushWithTimeout,
  hasPending,
  pendingDocIds,
} from './saveQueue'

describe('saveQueue — P0-2 防抖窗口输入不静默丢失', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('flushPending 在防抖窗口内立即触发保存，且防抖计时器取消后不二次保存', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    enqueueSave('doc-A', save, DEFAULT_DEBOUNCE_MS)
    // 防抖窗口内：尚未触发
    expect(save).not.toHaveBeenCalled()

    // flush 拉平未决计时器，立即保存一次
    await flushPending('doc-A')
    expect(save).toHaveBeenCalledTimes(1)

    // 计时器已被取消，推进时间不应再触发
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushPending 无未决保存时立即 resolve', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    await expect(flushPending('no-such-doc')).resolves.toBeUndefined()
    await flushPending('doc-B')
    expect(save).not.toHaveBeenCalled()
  })

  it('hasPending / pendingDocIds 反映未决状态', () => {
    expect(hasPending('doc-A')).toBe(false)
    enqueueSave('doc-A', vi.fn(), DEFAULT_DEBOUNCE_MS)
    expect(hasPending('doc-A')).toBe(true)
    expect(pendingDocIds()).toContain('doc-A')
    void flushPending('doc-A')
  })
})

describe('saveQueue — P1-6 并发保存串行化为 latest-wins', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('在途时再入队：完成后自动补一次（latest-wins）', async () => {
    const order: string[] = []
    let resolveFirst: () => void
    const first = new Promise<void>((r) => {
      resolveFirst = r
    })
    // 第一次保存（旧内容）进入在途
    enqueueSave('doc-A', () => {
      order.push('save-1')
      return first
    }, 0)
    await Promise.resolve()
    expect(order).toEqual(['save-1'])

    // 在途期间新内容（最新）入队
    enqueueSave('doc-A', () => {
      order.push('save-2')
      return Promise.resolve()
    }, 0)
    await Promise.resolve()
    // 串行：save-2 必须等 save-1 完成
    expect(order).toEqual(['save-1'])

    resolveFirst!()
    await Promise.resolve()
    expect(order).toEqual(['save-1', 'save-2'])
  })

  it('两次保存乱序返回时，磁盘最终为最新内容（串行后自然成立）', async () => {
    const disk: string[] = []
    let resolveOld: () => void
    const oldPromise = new Promise<void>((r) => {
      resolveOld = r
    })
    // 旧内容，慢（100ms 延迟）
    enqueueSave('doc-A', () => {
      disk.push('old')
      return oldPromise
    }, 0)
    await Promise.resolve()
    // 新内容，快（10ms 延迟）
    enqueueSave('doc-A', () => {
      disk.push('new')
      return Promise.resolve()
    }, 0)
    await Promise.resolve()
    // 串行化强制 old 先完成，new 后写
    expect(disk).toEqual(['old'])

    resolveOld!()
    await Promise.resolve()
    // 最新内容最后落盘
    expect(disk).toEqual(['old', 'new'])
    expect(disk[disk.length - 1]).toBe('new')
  })

  it('同一 doc 串行、不同 doc 并行互不阻塞', async () => {
    const order: string[] = []
    let resolveA: () => void
    const aPromise = new Promise<void>((r) => {
      resolveA = r
    })
    enqueueSave('doc-A', () => {
      order.push('a')
      return aPromise
    }, 0)
    await Promise.resolve()
    // B 的保存不应被 A 阻塞
    enqueueSave('doc-B', () => {
      order.push('b')
      return Promise.resolve()
    }, 0)
    await Promise.resolve()
    expect(order).toContain('b')

    resolveA!()
    await Promise.resolve()
    expect(order).toContain('a')
  })

  it('flushPendingAll 一次性触发多个文档的未决保存', async () => {
    const saved: string[] = []
    enqueueSave('doc-A', () => {
      saved.push('A')
      return Promise.resolve()
    }, DEFAULT_DEBOUNCE_MS)
    enqueueSave('doc-B', () => {
      saved.push('B')
      return Promise.resolve()
    }, DEFAULT_DEBOUNCE_MS)
    await flushPendingAll(['doc-A', 'doc-B'])
    expect(saved.sort()).toEqual(['A', 'B'])
  })
})

describe('saveQueue — R2 cancelPending（重新加载外部版本前取消未决保存）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('cancelPending 取消防抖计时器与最新待保存函数：推进时间不再触发保存', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    enqueueSave('doc-A', save, DEFAULT_DEBOUNCE_MS)
    cancelPending('doc-A')

    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 3)
    expect(save).not.toHaveBeenCalled()
    expect(hasPending('doc-A')).toBe(false)
  })

  it('cancelPending 不中断已在途保存（在途链仍完成，latest 已被取消不补跑）', async () => {
    const order: string[] = []
    let resolveFirst: () => void
    const first = new Promise<void>((r) => {
      resolveFirst = r
    })
    enqueueSave('doc-A', () => {
      order.push('save-1')
      return first
    }, 0)
    await Promise.resolve()
    // 在途期间取消：新内容不再补跑，在途保存本身完成
    enqueueSave('doc-A', () => {
      order.push('save-2')
      return Promise.resolve()
    }, 0)
    cancelPending('doc-A')
    resolveFirst!()
    await Promise.resolve()
    expect(order).toEqual(['save-1'])
    expect(hasPending('doc-A')).toBe(false)
  })

  it('flushWithTimeout：保存快速完成时返回 true（未决内容已落盘）', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    enqueueSave('doc-A', save, DEFAULT_DEBOUNCE_MS)
    const ok = await flushWithTimeout('doc-A')
    expect(ok).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushWithTimeout：保存超时返回 false（R1/F02 改为 confirm 兜底）', async () => {
    let resolveSlow: () => void
    const slow = new Promise<void>((r) => {
      resolveSlow = r
    })
    enqueueSave('doc-A', () => slow, 0)
    await Promise.resolve()
    const p = flushWithTimeout('doc-A', 3000)
    vi.advanceTimersByTime(3000)
    await expect(p).resolves.toBe(false)
    resolveSlow!()
  })

  it('flushWithTimeout：无未决保存时立即返回 true', async () => {
    await expect(flushWithTimeout('no-such-doc')).resolves.toBe(true)
  })
})
