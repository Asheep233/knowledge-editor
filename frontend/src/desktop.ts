/** 桌面平台能力封装（Phase 7 M4）。
 *
 * - isDesktop(): 当前是否为 Tauri 桌面环境（hostname=tauri.localhost 或
 *   __TAURI_INTERNALS__ 已就绪；与 main.tsx 的竞态安全判定保持一致）。
 * - pickDirectory(): 原生目录选择器。桌面环境弹出系统对话框（tauri-plugin-dialog），
 *   选择后返回绝对路径；取消返回 null。非桌面（Web/测试）返回 null，
 *   由调用方回退到文本输入。
 */
import { isTauri } from './settings'
import { flushPendingAll } from './state/saveQueue'

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
 */
export async function setupCloseHandshake(): Promise<() => void> {
  if (!isDesktop()) return () => {}
  try {
    const { listen } = await import('@tauri-apps/api/event')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const unlisten = await listen('ke:close-requested', async () => {
      // 全速 flush 未决保存（不等待防抖计时器）；1.5s 兜底由 Rust 侧负责。
      await Promise.race([
        flushPendingAll().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
      ])
      // 用 close() 触发第二次关窗（走 Rust 正常清理），不要用 destroy()。
      const win = getCurrentWindow()
      void win.close()
    })
    return () => {
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
