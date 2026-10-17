/**
 * Vitest 全局 setup（2026-10-18）：修复 CI 偶发「Unhandled Error: document is not defined」。
 *
 * 根因：prosemirror-view 的 `DOMObserver.stop()` 在仍有排队 mutation 时会
 * `window.setTimeout(() => flush(), 20)`；测试 teardown 里 `editor.destroy()` 之后若
 * 20ms 内 happy-dom 环境已被拆除，定时器回调访问 `document` → 未捕获 ReferenceError。
 * Vitest 会把该错误计为「Unhandled Error」，即使 103 个测试文件全部通过也以
 * exit code 1 失败（实测 CI `2ddeacf` 因此红）。
 *
 * 修法（**仅测试环境**）：包装 tiptap `Editor.prototype.destroy`，销毁前先调用
 * `view.domObserver.forceFlush()` —— 同步清空排队 mutation 并取消 20ms 定时器，
 * 把库的 teardown 竞态收敛在测试环境仍存活时。
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
