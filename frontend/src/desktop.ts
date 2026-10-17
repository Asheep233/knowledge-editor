/** 桌面平台能力封装（Phase 7 M4）。
 *
 * - isDesktop(): 当前是否为 Tauri 桌面环境（hostname=tauri.localhost 或
 *   __TAURI_INTERNALS__ 已就绪；与 main.tsx 的竞态安全判定保持一致）。
 * - pickDirectory(): 原生目录选择器。桌面环境弹出系统对话框（tauri-plugin-dialog），
 *   选择后返回绝对路径；取消返回 null。非桌面（Web/测试）返回 null，
 *   由调用方回退到文本输入。
 */
import { askConfirm } from './components/common/PromptDialog'
import { isTauri } from './settings'
import { flushPendingAll, unsafeDocIds } from './state/saveQueue'

/** 桌面破坏性动作前的 flush 预算（与 Rust 1.5s 兜底定时器对齐） */
const DESKTOP_FLUSH_TIMEOUT_MS = 1500

/** 全速 flush 未决保存；返回是否在预算内完成（false = 仍有未决/超时）。 */
async function flushForDesktopAction(): Promise<boolean> {
  return Promise.race([
    flushPendingAll()
      .then(() => true)
      .catch(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DESKTOP_FLUSH_TIMEOUT_MS)),
  ])
}

/** 调用 Rust 命令；旧版壳/测试环境没有该命令时静默忽略（走各自兜底路径）。 */
async function invokeMaybe(cmd: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke(cmd)
  } catch {
    /* ignore */
  }
}

export function isDesktop(): boolean {
  if (typeof window === 'undefined' || typeof location === 'undefined') return false
  return location.hostname === 'tauri.localhost' || isTauri()
}

export async function pickDirectory(title = '选择目录'): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, multiple: false, title })
    return typeof selected === 'string' && selected.length > 0 ? selected : null
  } catch {
    return null
  }
}

/**
 * P1-14 桌面关窗 flush 握手（前端侧）。
 *
 * Rust 契约（桌面子代理已实现）：on_window_event CloseRequested 首次关窗时
 * prevent_close + hide + emit 'ke:close-requested'（空 payload）+ 1.5s 兜底定时器。
 * 前端收到该事件后：先全速 flushPendingAll（不等待防抖，1.5s 内尽力而为），
 * 然后调用 getCurrentWindow().close() 触发第二次关窗，让 Rust 走正常清理（sidecar 等）。
 * 注意：不要用 destroy()——destroy 会跳过 Rust 的 sidecar 清理。
 * 若第二次 close() 前 1.5s 兜底定时器已到，Rust 自行退出，无害。
 *
 * R-1 追加：菜单「重新加载」（`ke:reload-requested`）同样先 flush 再刷新，
 * 避免 reload 销毁前端上下文导致尾部防抖内容丢失。
 */
export async function setupCloseHandshake(): Promise<() => void> {
  if (!isDesktop()) return () => {}
  try {
    const { listen } = await import('@tauri-apps/api/event')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    // R-1（独立验证发现）：菜单「重新加载」/ Ctrl+R 会立即销毁 WebView 前端上下文，
    // 而 `beforeunload` 里的 `void flushPendingAll()` **不 await** → 尾部防抖未落盘的内容
    // 有丢失窗口。改由 Rust emit `ke:reload-requested`，前端 await 完 flush 再触发 reload；
    // Rust 侧 1.5s 兜底保证即使前端异常也会刷新。
    const unlistenReload = await listen('ke:reload-requested', async () => {
      const flushed = await flushForDesktopAction()
      const unsafe = unsafeDocIds()
      if (!flushed || unsafe.length > 0) {
        // SD-02：有内容未落盘 → 先取消 Rust 兜底刷新，让用户明确选择
        await invokeMaybe('app_cancel_pending_reload')
        const ok = await askConfirm(
          `有 ${unsafe.length || 1} 篇文档未保存成功，重新加载将丢失这些修改。仍要重新加载？`,
        )
        if (!ok) return
      }
      await invokeMaybe('reload_main_window')
    })
    const unlisten = await listen('ke:close-requested', async () => {
      const flushed = await flushForDesktopAction()
      const unsafe = unsafeDocIds()
      if (!flushed || unsafe.length > 0) {
        // SD-02（2026-10-17 审查）：旧实现 flush 后无条件 win.close() ——
        // 保存失败时窗口直接消失、编辑静默丢失。现在先取消 Rust 的 1.5s 兜底
        // 强退（给用户确认时间）：取消 → 撤销待定退出并恢复窗口；确认 → 正常二次 close。
        await invokeMaybe('app_hold_exit')
        const ok = await askConfirm(
          `有 ${unsafe.length || 1} 篇文档未保存成功，立即退出将丢失这些修改。仍要退出？`,
        )
        if (!ok) {
          await invokeMaybe('app_cancel_pending_exit')
          return
        }
      }
      // 用 close() 触发第二次关窗（走 Rust 正常清理），不要用 destroy()。
      const win = getCurrentWindow()
      void win.close()
    })
    return () => {
      try {
        unlistenReload()
      } catch {
        /* ignore */
      }
      try {
        unlisten()
      } catch {
        /* ignore */
      }
    }
  } catch {
    return () => {}
  }
}

/**
 * 2026-09-20 真机发现：**WebView2 持有焦点时原生菜单加速键不一定送达** ——
 * 用户实测「Ctrl+Q 没反应」（Ctrl+R 则被 WebView2 当浏览器加速键自行刷新）。
 * 这里在 WebView 层补一条兜底：Ctrl+Q / Ctrl+R 直接调用与菜单**同一个** Rust 握手命令。
 *
 * 菜单项与其加速键仍然保留（焦点在 WebView 之外时照旧可用）；两条路径最终都进
 * `begin_close_handshake` / `begin_reload_handshake`，行为一致。
 */
export function setupNativeShortcutFallback(): () => void {
  if (!isDesktop()) return () => {}
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return
    const key = e.key.toLowerCase()
    if (key !== 'q' && key !== 'r') return
    e.preventDefault()
    e.stopPropagation()
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke(key === 'q' ? 'app_request_exit' : 'app_request_reload'))
      .catch(() => undefined)
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
