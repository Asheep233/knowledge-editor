/**
 * S-1 回归测试：编辑期恢复点登记的「有界年龄」调度。
 *
 * 核心保护的缺陷：`saveQueue.enqueueSave` 是纯尾沿防抖（每次编辑重置计时器、无 maxWait），
 * 连续输入时永不触发 → 既不保存也不登记恢复点，硬崩溃丢失窗口无界。
 * 本模块必须保证「自首笔未登记编辑起至多 maxAgeMs 必登记一次」，且**不因后续编辑而重置**。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECOVERY_MAX_AGE_MS, createDraftDebounce, normalizeMaxAgeMs } from './draftDebounce'

describe('draftDebounce — S-1 恢复点登记有界年龄', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('单次编辑后在 maxAgeMs 内登记一次（不早不晚）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    expect(d.dirty()).toBe(true)
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS - 1)
    expect(onFlush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(d.dirty()).toBe(false)
  })

  it('★连续编辑不重置计时器：至多 maxAgeMs 必登记（原缺陷的直接回归）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    // 模拟连续敲键：每 500ms 一次，共 10 次（跨度 5s > maxAgeMs）
    for (let i = 0; i < 10; i++) {
      d.touch()
      vi.advanceTimersByTime(500)
    }
    // 若退化为「尾沿防抖」则此处 onFlush 仍是 0（最后一次编辑后还需等 maxAgeMs）
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('登记后继续编辑会开启新窗口，且每窗口各登记一次', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)

    d.touch()
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('无编辑时计时器到点不登记（不产生无谓请求）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS * 3)
    expect(onFlush).not.toHaveBeenCalled()
    expect(d.dirty()).toBe(false)
  })

  it('markSaved(true) 清除未保存标记 → 到点不再登记（防「孤儿草稿」误弹恢复提示）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    // 保存成功且覆盖了最新编辑（EditorArea 用 docSeq 判定）→ 保存路径已自行登记并清除恢复点
    d.markSaved(true)
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).not.toHaveBeenCalled()
    expect(d.dirty()).toBe(false)
  })

  it('markSaved(false)（保存期间有新编辑）不清标记 → 到点仍登记', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    d.markSaved(false) // 保存开始后又有编辑，该次保存未覆盖最新内容
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('markSaved(true) 后继续编辑仍能登记（新窗口不被旧的已清标记吞掉）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    d.markSaved(true)
    d.touch() // 保存后又有新编辑
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('flushNow 立即登记并取消计时器（不重复登记）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    d.flushNow()
    expect(onFlush).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS * 2)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('无编辑时 flushNow 不登记', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })
    d.flushNow()
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('cancel 放弃未决登记（切换文档时不得把旧内容登到新文档名下）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    d.cancel()
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS * 2)
    expect(onFlush).not.toHaveBeenCalled()
    expect(d.dirty()).toBe(false)
  })

  it('cancel 后重新编辑仍能正常登记', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    d.cancel()
    d.touch()
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('dispose 清理计时器（卸载后不再回调）', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush })

    d.touch()
    d.dispose()
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS * 2)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('登记回调期间产生的新编辑会开启新窗口，不被漏掉', () => {
    const onFlush = vi.fn()
    let d: ReturnType<typeof createDraftDebounce>
    onFlush.mockImplementation(() => {
      // 模拟登记过程中用户继续输入
      d.touch()
    })
    d = createDraftDebounce({ onFlush })

    d.touch()
    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(RECOVERY_MAX_AGE_MS)
    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('自定义 maxAgeMs 生效', () => {
    const onFlush = vi.fn()
    const d = createDraftDebounce({ onFlush, maxAgeMs: 1000 })
    expect(d.maxAgeMs).toBe(1000)
    d.touch()
    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('非法 maxAgeMs 回退到默认值', () => {
    expect(normalizeMaxAgeMs(undefined)).toBe(RECOVERY_MAX_AGE_MS)
    expect(normalizeMaxAgeMs(0)).toBe(RECOVERY_MAX_AGE_MS)
    expect(normalizeMaxAgeMs(-5)).toBe(RECOVERY_MAX_AGE_MS)
    expect(normalizeMaxAgeMs(Number.NaN)).toBe(RECOVERY_MAX_AGE_MS)
    expect(normalizeMaxAgeMs(1500)).toBe(1500)
  })
})
