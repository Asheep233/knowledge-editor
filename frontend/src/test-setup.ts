/**
 * Vitest 全局 setup（2026-10-18）：修复 CI 偶发「Unhandled Error: document is not defined」。
 *
 * 根因：prosemirror-view 的 `DOMObserver.stop()` 在仍有排队 mutation 时会
 * `window.setTimeout(() => flush(), 20)`；测试 teardown 里 `editor.destroy()` 之后若
 * 20ms 内 happy-dom 环境已被拆除，定时器回调访问 `document` → 未捕获 ReferenceError。
 * Vitest 会把该错误计为「Unhandled Error」，即使 103 个测试文件全部通过也以
 * exit code 1 失败（实测 CI `2ddeacf` 因此红）。
 *
 * 修法（**仅测试环境**，两层防护）：
 * ① 包装 tiptap `Editor.prototype.destroy`，销毁前先 `view.domObserver.forceFlush()`；
 * ② 追踪所有 <=100ms 的短定时器，并在**每个用例结束后**统一清除 —— 覆盖不走
 *   `Editor.destroy` 的路径（如测试文件直接持有 EditorView / setEditable 等）。
 *   实测 CI e7274e5 仍在 `gfm-footnote-verify.test.ts` 命中同族错误，故补第二层。
 *
 * 注：本文件只做测试基建，不影响生产代码。
 */
import { Editor } from '@tiptap/core'

interface DomObserverLike {
  forceFlush?: () => void
}

interface EditorProtoLike {
  destroy: (...args: unknown[]) => unknown
  view?: { domObserver?: DomObserverLike }
  __keTestFlushPatched?: boolean
}

const proto = Editor.prototype as unknown as EditorProtoLike

if (!proto.__keTestFlushPatched) {
  const originalDestroy = proto.destroy
  proto.destroy = function patchedDestroy(this: EditorProtoLike, ...args: unknown[]) {
    try {
      this.view?.domObserver?.forceFlush?.()
    } catch {
      /* 尽力而为：flush 失败不得阻塞销毁 */
    }
    return originalDestroy.apply(this, args)
  }
  proto.__keTestFlushPatched = true
}


// ---------------------------------------------------------------------------
// 第二层防护：每个用例结束后清空短定时器（<=100ms）。
// 原因：prosemirror-view 的 DOMObserver.stop() 在仍有排队 mutation 时会
// `setTimeout(flush, 20)`；若测试对象不是经 Editor.destroy 销毁（直接持有
// EditorView、setEditable、组件卸载等），该定时器仍可能在 happy-dom 环境
// teardown 之后触发 → `document is not defined` 未捕获异常 → Vitest exit 1。
// 只清理短定时器：长定时器（业务防抖/轮询）本应由用例自行管理，且超时远在
// teardown 之后，Vitest 会判其未完成并提示——不在此处吞掉真实问题。
// ---------------------------------------------------------------------------
import { afterEach } from 'vitest'

interface TimerWindow {
  setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number
  clearTimeout: (id?: number) => void
}

const timerWin = window as unknown as TimerWindow
const shortTimers = new Set<number>()
const originalSetTimeout = timerWin.setTimeout.bind(window)
const originalClearTimeout = timerWin.clearTimeout.bind(window)

timerWin.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
  let timerId = 0
  const wrapped: TimerHandler =
    typeof handler === 'function'
      ? (() => {
          shortTimers.delete(timerId)
          ;(handler as (...a: unknown[]) => void)(...args)
        }) as TimerHandler
      : handler
  timerId = originalSetTimeout(wrapped, timeout)
  if (typeof timeout === 'number' && timeout <= 100) shortTimers.add(timerId)
  return timerId
}) as TimerWindow['setTimeout']

timerWin.clearTimeout = ((id?: number): void => {
  if (id !== undefined) shortTimers.delete(id)
  originalClearTimeout(id)
}) as TimerWindow['clearTimeout']

afterEach(() => {
  for (const id of shortTimers) {
    try {
      originalClearTimeout(id)
    } catch {
      /* ignore */
    }
  }
  shortTimers.clear()
})
