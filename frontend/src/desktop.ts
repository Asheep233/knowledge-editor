/** 桌面平台能力封装（Phase 7 M4）。
 *
 * - isDesktop(): 当前是否为 Tauri 桌面环境（hostname=tauri.localhost 或
 *   __TAURI_INTERNALS__ 已就绪；与 main.tsx 的竞态安全判定保持一致）。
 * - pickDirectory(): 原生目录选择器。桌面环境弹出系统对话框（tauri-plugin-dialog），
 *   选择后返回绝对路径；取消返回 null。非桌面（Web/测试）返回 null，
 *   由调用方回退到文本输入。
 */
import { isTauri } from './settings'

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
