/**
 * 加载状态判定纯函数（P2-8：错误静默吞掉——失败被显示为空/旧/已保存）。
 *
 * 各 UI 加载点（LeftSidebar 加载文件树、EditorArea 加载历史版本、App 加载树错误）
 * 统一用本函数区分 loading / error / empty / ready，避免把「加载失败」误显示为空空如也。
 */

export type LoadState = 'loading' | 'error' | 'empty' | 'ready'

export interface LoadStateInput {
  error: boolean
  loading: boolean
  /** 已加载的数据条数（0 视为空） */
  count: number
}

export function classifyLoadState({ error, loading, count }: LoadStateInput): LoadState {
  if (loading) return 'loading'
  if (error) return 'error'
  if (count === 0) return 'empty'
  return 'ready'
}

/** 便捷：由 classifyLoadState 派生是否应显示「加载失败，重试」占位。 */
export function isLoadError(state: LoadState): boolean {
  return state === 'error'
}
