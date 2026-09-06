/**
 * per-doc 单飞保存队列（P0-2 / P1-6）。
 *
 * 解决的问题：
 *  - P0-2：防抖窗口内的输入从未落盘，切换文档/关窗时静默丢失。本队列统一管理
 *    防抖 + 串行化，并暴露 flushPending / flushPendingAll 可「立即触发」未决保存。
 *  - P1-6：autosave 与手动保存并发乱序覆盖。同一 docId 内任何时候至多一个保存请求
 *    在途（single-flight）；在途期间的新内容以「最新值合并」，完成后若有更新内容
 *    则再保存一次（latest-wins），保证磁盘最终为最新内容。
 *
 * 语义约定：
 *  - 同一 docId 串行（至多一个在途请求）；不同 docId 并行互不阻塞。
 *  - `enqueueSave(docId, saveFn, debounceMs)`：以 debounceMs（默认 3000ms）合并调度；
 *    若已有在途请求则只更新「最新待保存函数」，完成后自动补一次。
 *  - `flushPending(docId)`：取消该 doc 未决的防抖计时器并立即触发待保存的函数，
 *    返回 Promise；无待保存内容时立即 resolve。
 *  - `flushPendingAll(ids?)`：对全部（或指定）文档执行 flushPending。
 *
 * 本模块为纯逻辑、无 React 依赖，可独立单测（fake timers）。保存函数内部的
 * saveState / 恢复点 / onSaved 等副作用由调用方（EditorArea）在 saveFn 中处理。
 */

export type SaveFn = () => Promise<unknown>

export const DEFAULT_DEBOUNCE_MS = 3000

interface Entry {
  docId: string
  /** 最新待保存函数（防抖中或在途期间追加的内容，latest-wins） */
  latest?: SaveFn
  /** 进行中的串行保存链 */
  running: Promise<void> | null
  /** 防抖计时器 */
  timer: ReturnType<typeof setTimeout> | null
}

const entries = new Map<string, Entry>()

function entryFor(docId: string): Entry {
  let e = entries.get(docId)
  if (!e) {
    e = { docId, running: null, timer: null }
    entries.set(docId, e)
  }
  return e
}

/** 从某个时刻起串行地把该 doc 的待保存函数逐个执行完（latest-wins）。 */
function drain(e: Entry): Promise<void> {
  if (e.running) return e.running
  e.running = (async () => {
    try {
      while (e.latest !== undefined) {
        const fn = e.latest
        e.latest = undefined
        // 保存成败由调用方 saveFn 自行处理（EditorArea 区分 error/恢复点）；
        // 队列只保证串行与“完成后再补一次”，不中断后续保存。
        try {
          await fn()
        } catch {
          /* 继续取下一个（若有最新内容） */
        }
      }
    } finally {
      e.running = null
      // 若 drain 期间又有新内容入队，则再跑一遍；否则清理空闲条目。
      if (e.latest !== undefined) {
        void drain(e)
      } else {
        entries.delete(e.docId)
      }
    }
  })()
  return e.running
}

/**
 * 以防抖方式登记一次保存（latest-wins）。
 * @param docId 文档标识
 * @param saveFn 保存函数（读取当前文档内容并保存）
 * @param debounceMs 防抖毫秒数（0 表示立即）
 * @returns 一个 Promise：若当前已有在途链则等待其完成后 resolve；否则立即 resolve。
 */
export function enqueueSave(docId: string, saveFn: SaveFn, debounceMs = DEFAULT_DEBOUNCE_MS): Promise<void> {
  const e = entryFor(docId)
  e.latest = saveFn
  if (e.timer !== null) clearTimeout(e.timer)
  if (debounceMs > 0) {
    e.timer = setTimeout(() => {
      e.timer = null
      void drain(e)
    }, debounceMs)
  } else {
    e.timer = null
    void drain(e)
  }
  return e.running ?? Promise.resolve()
}

/** 取消并立即触发该 doc 的未决保存（若存在），返回完成 Promise。 */
export function flushPending(docId: string): Promise<void> {
  const e = entries.get(docId)
  if (!e) return Promise.resolve()
  if (e.timer !== null) {
    clearTimeout(e.timer)
    e.timer = null
  }
  if (e.latest !== undefined) return drain(e)
  return e.running ?? Promise.resolve()
}

/** 取消并立即触发多个（或全部）文档的未决保存。 */
export function flushPendingAll(ids?: string[]): Promise<void> {
  const target = ids ?? Array.from(entries.keys())
  return Promise.all(target.map((id) => flushPending(id))).then(() => undefined)
}

/**
 * 取消该 doc 的未决防抖保存（R2：重新加载外部版本前使用）。
 * 只取消「尚未执行」的保存（防抖计时器 + 最新待保存函数）；
 * 已在途的请求无法撤销——调用方可随后 flushPending(docId) 等待在途链完成
 * 再做后续动作（重载/切换），保证「看到的磁盘内容 = 最终落盘内容」。
 */
export function cancelPending(docId: string): void {
  const e = entries.get(docId)
  if (!e) return
  if (e.timer !== null) {
    clearTimeout(e.timer)
    e.timer = null
  }
  e.latest = undefined
  if (e.running === null) entries.delete(docId)
}

/**
 * 带超时兜底的「取消并触发保存」（R1/F02 通用前置：改名、移动、切换工作区等
 * 一切路径变更前先落盘未决内容）。
 * @returns true = 未决保存已清空（已落盘或本无未决）；false = 超时（保存未完成）。
 */
export function flushWithTimeout(docId: string, timeoutMs = 3000): Promise<boolean> {
  return Promise.race([
    flushPending(docId).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs)),
  ])
}

/** 是否存在未决（防抖中/在途待补）保存。 */
export function hasPending(docId: string): boolean {
  const e = entries.get(docId)
  return !!e && (e.latest !== undefined || e.running !== null)
}

/** 当前存在未决保存的文档 id 列表（用于 beforeunload / close-requested 巡检）。 */
export function pendingDocIds(): string[] {
  return Array.from(entries.keys())
}
