/**
 * T26 G4：宿主事件接线（产品 UI → 工坊 guest 的方向：window 自定义事件）。
 *
 * 分工（最小接线，不引入状态库/不改 App 架构）：
 * - 产品侧（EditorArea 等）在**真实状态发生**时 dispatch 本模块定义的 window 事件（不 await、不阻塞）；
 * - WorkshopGuestFrame 在 guest 会话 active 时监听这些事件，翻译成协议 `HostEvent` 后
 *   `dispatcher.emit(...)`（见 `hostEventBridge.ts`）。
 *
 * 只做「谁发生了什么」的事实转达；不在事件里携带伪造的 revision/epoch —— 解析不到真实值时
 * 载荷字段可为 null，由宿主桥按后端真实状态补全或拒绝发射（宁可不发射，不伪造）。
 */

/** 文档保存成功（EditorArea 保存链真实落盘后 dispatch） */
export const WORKSHOP_EVENT_DOCUMENT_SAVED = 'ke:workshop-document-saved'
/** 当前文档/上下文切换（EditorArea article 装载切换时 dispatch） */
export const WORKSHOP_EVENT_CONTEXT_CHANGED = 'ke:workshop-context-changed'
/** 产品主题变化（`document.documentElement.dataset.theme`，由 applyTheme 写入） */
export const WORKSHOP_EVENT_THEME_CHANGED = 'ke:workshop-theme-changed'

export type WorkshopTheme = 'light' | 'dark' | 'system'

export interface WorkshopDocumentSavedDetail {
  /** 保存的文档工作区相对路径（产品约定：ArticleMeta.id 即 relPath，如 `Articles/a.md`） */
  relPath: string
  /** 保存后的真实 revision；旧保存链（非 Core）不返回 → null，由宿主桥向后端快照解析 */
  revision: number | null
}

export interface WorkshopContextChangedDetail {
  /** 当前文档 relPath（null = 关闭文档）；协议 context-changed 只带 contextId/epoch，本字段仅诊断用 */
  relPath: string | null
}

export interface WorkshopThemeChangedDetail {
  theme: WorkshopTheme
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.dispatchEvent === 'function'
}

function dispatch<K extends string>(name: K, detail: unknown): void {
  if (!hasWindow()) return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** 保存成功 → 通知工坊（无监听者时零副作用）。 */
export function notifyWorkshopDocumentSaved(detail: WorkshopDocumentSavedDetail): void {
  dispatch(WORKSHOP_EVENT_DOCUMENT_SAVED, detail)
}

/** 文档切换/打开 → 通知工坊（无监听者时零副作用）。 */
export function notifyWorkshopContextChanged(detail: WorkshopContextChangedDetail): void {
  dispatch(WORKSHOP_EVENT_CONTEXT_CHANGED, detail)
}

/** 主题变化 → 通知工坊（无监听者时零副作用）。 */
export function notifyWorkshopThemeChanged(detail: WorkshopThemeChangedDetail): void {
  dispatch(WORKSHOP_EVENT_THEME_CHANGED, detail)
}

/** 监听一个工坊宿主事件；返回退订函数（组件卸载时调用）。 */
export function onWorkshopHostEvent<K extends string>(
  name: K,
  handler: (detail: unknown) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined
  const listener = (event: Event) => handler((event as CustomEvent<unknown>).detail)
  window.addEventListener(name, listener)
  return () => window.removeEventListener(name, listener)
}
