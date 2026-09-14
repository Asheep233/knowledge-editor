/**
 * 编辑期恢复点登记的「有界年龄」调度（S-1）。
 *
 * 背景（实测）：
 *  - 恢复点原本只在**保存开始时**登记（`EditorArea.buildSaveFn` 内 `registerRecoveryPoint`）。
 *  - 而 `saveQueue.enqueueSave` 是**纯尾沿防抖**：每次编辑都 `clearTimeout` 重置计时器，
 *    且**没有 maxWait**（见 saveQueue.ts:93-98）。
 *  - 后果：用户**连续输入**（相邻按键间隔 < autosaveIntervalMs）时计时器永不触发 →
 *    既不自动保存、也不登记恢复点。硬崩溃的丢失窗口因此**不是「一个 autosave 周期」而是无界**——
 *    一段连续敲了十分钟的写作可以整段蒸发。这是本模块要堵的洞。
 *
 * 设计：把登记节奏与保存防抖**解耦**，采用「有界年龄」策略——
 * 自「首笔未登记编辑」起至多 `maxAgeMs` 内必定登记一次，且**不因后续编辑而重置**。
 * （若重置就又退化成无界等待，正是原缺陷的成因。）
 *
 * 契约：
 *  - `touch()`：每次编辑调用。仅首次启动窗口，后续调用不重置计时器。
 *  - `markSaved(coveredLatest)`：保存成功后调用。**只有当该次保存确实覆盖了最新编辑时**
 *    才可传 `true`（EditorArea 用 `docSeq` 判定「保存开始后无新编辑」）。传 true 会清除
 *    未保存标记，从而避免「保存已清除恢复点 → 本模块又登记一条孤儿草稿 → 下次启动误弹恢复提示」。
 *  - `flushNow()`：立即登记（文档切换 / 关窗前）。
 *  - `cancel()`：放弃未决登记（切换文档时，避免把上一文档内容登到新文档名下）。
 *  - `dispose()`：卸载清理。
 *  - `dirty()`：是否存在「已编辑但尚未登记、且未被保存覆盖」的内容。
 *
 * 复杂度：`touch()` 为 O(1)，不触碰编辑器；序列化只发生在 `onFlush` 内，即每个登记周期
 * 至多一次（而非每次击键）——这是不引入输入卡顿的关键。
 */

export type TimerHandle = ReturnType<typeof setTimeout>

/** 恢复点登记的最大年龄：连续编辑时至多这么久必登记一次（对应 backlog S-1 的「最多丢 3s」）。 */
export const RECOVERY_MAX_AGE_MS = 3000

export interface DraftDebounceOptions {
  /** 触发登记：调用方在此序列化正文并 POST 恢复点。仅在有未保存编辑时调用。 */
  onFlush: () => void
  /** 最大年龄（ms），默认 RECOVERY_MAX_AGE_MS */
  maxAgeMs?: number
  /** 定时器注入（单测用假定时器时可省略；默认用全局 setTimeout） */
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  /** 定时器清理注入 */
  clearTimer?: (handle: TimerHandle) => void
}

export interface DraftDebounce {
  touch(): void
  markSaved(coveredLatest: boolean): void
  flushNow(): void
  cancel(): void
  dispose(): void
  dirty(): boolean
  readonly maxAgeMs: number
}

export function normalizeMaxAgeMs(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return RECOVERY_MAX_AGE_MS
  return v
}

export function createDraftDebounce(opts: DraftDebounceOptions): DraftDebounce {
  const maxAgeMs = normalizeMaxAgeMs(opts.maxAgeMs)
  const setT = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearT = opts.clearTimer ?? ((h) => clearTimeout(h))

  let timer: TimerHandle | null = null
  /** 存在「已编辑、尚未登记、且未被保存覆盖」的内容 */
  let pendingDirty = false

  function clearTimer(): void {
    if (timer !== null) {
      clearT(timer)
      timer = null
    }
  }

  function fire(): void {
    timer = null
    if (!pendingDirty) return
    // 先清标记再回调：回调内的异步过程若又有编辑，touch() 会重新开窗，
    // 不会因为「标记还亮着」而漏掉这批新编辑。
    pendingDirty = false
    opts.onFlush()
  }

  return {
    touch() {
      pendingDirty = true
      // 关键：不 clearTimeout 重置 —— 保证「自首笔编辑起至多 maxAgeMs」有界。
      if (timer === null) timer = setT(fire, maxAgeMs)
    },

    markSaved(coveredLatest: boolean) {
      if (coveredLatest) pendingDirty = false
    },

    flushNow() {
      clearTimer()
      if (!pendingDirty) return
      pendingDirty = false
      opts.onFlush()
    },

    cancel() {
      clearTimer()
      pendingDirty = false
    },

    dispose() {
      clearTimer()
      pendingDirty = false
    },

    dirty() {
      return pendingDirty
    },

    maxAgeMs,
  }
}
