/**
 * UI 工坊 P2-T14：Core SaveCoordinator ↔ 既有产品 UI 的适配层（不重写旧 App / 不隐藏旧编辑面）。
 *
 * 目标：让现有 EditorArea/SaveQueue 的 `SaveFn = (signal?) => Promise<unknown>` 逐步迁到
 * Core 保存语义（快照 revision / 三阶段 / abort 可查 / 切档），同时旧组件不需要理解 Core 类型：
 * - `createCoreSaveFn(coordinator, relPath)`：返回产品 `SaveFn`；仅 file_durable 才 resolve，
 *   冲突/失败抛类型化错误（旧 UI 的 dirty 指示与错误提示仍可用）；
 * - `createEditHook(coordinator, relPath)`：把旧编辑器 onUpdate 内容变更 O(1) 标脏（不广播全文）；
 * - `createSaveStateReporter(coordinator, callbacks)`：把 Core SaveStatus 映射为旧 UI 回调
 *   （saving/saved/conflict/failed），供保存状态条使用；
 * - `switchDocument(coordinator, snapshot)`：切档时登记新可信快照（旧编辑器内容/撤销历史由编辑器持有）。
 *
 * 无 DOM/React 依赖；行为可在 Node/vitest 直接测试（不依赖 React 测试框架）。
 */
import type { SaveCoordinator } from './saveCoordinator'
import type { DocumentSnapshot, SaveStateChange, SaveStatus } from './types'

/** 产品侧保存函数的既有签名（state/saveQueue.ts::SaveFn）。 */
export type ProductSaveFn = (signal?: AbortSignal) => Promise<unknown>

export class CoreSaveError extends Error {
  readonly code: string
  readonly status: SaveStatus
  constructor(code: string, status: SaveStatus, message: string) {
    super(`${code}: ${message}`)
    this.name = 'CoreSaveError'
    this.code = code
    this.status = status
  }
}

const ABORT_ERROR_NAME = 'AbortError'

function throwAbort(): never {
  const e = new Error('保存已取消（AbortSignal）')
  e.name = ABORT_ERROR_NAME
  throw e
}

/** 产品 SaveFn 适配：只把真正落盘（file_durable）视为保存成功。 */
export function createCoreSaveFn(coordinator: SaveCoordinator, relPath: string): ProductSaveFn {
  return async (signal?: AbortSignal): Promise<unknown> => {
    if (signal?.aborted) throwAbort()
    let aborted = false
    const onAbort = () => {
      aborted = true
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const out = await coordinator.save(relPath)
      if (aborted || signal?.aborted) throwAbort()
      if (out.status === 'saved') {
        return { status: 'saved', revision: coordinator.state(relPath).revision }
      }
      const code =
        out.status === 'stale_context' ? 'E_STALE_CONTEXT' : out.status === 'conflict_external' ? 'E_CONFLICT_EXTERNAL' : out.status === 'conflict_revision' ? 'E_CONFLICT' : 'E_INTERNAL'
      throw new CoreSaveError(code, out.status, `Core 保存未完成: ${out.status}`)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** 旧编辑器 onUpdate(content) → O(1) 标脏。 */
export function createEditHook(coordinator: SaveCoordinator, relPath: string): (content: string) => void {
  return (content: string) => coordinator.recordEdit(relPath, content)
}

export interface LegacySaveCallbacks {
  onSaving?: () => void
  onSaved?: (revision: number) => void
  onConflict?: (kind: 'revision' | 'external' | 'stale', detail?: string) => void
  onError?: (detail: string) => void
}

/** Core SaveStatus → 旧 UI 回调（保存状态条/错误提示）。返回取消订阅函数。 */
export function createSaveStateReporter(coordinator: SaveCoordinator, relPath: string, callbacks: LegacySaveCallbacks): () => void {
  const unsubscribe = coordinator.subscribe((change: SaveStateChange) => {
    if (change.relPath !== relPath) return
    if (change.status === 'saving') callbacks.onSaving?.()
    else if (change.status === 'saved') callbacks.onSaved?.(change.revision ?? 0)
    else if (change.status === 'conflict_revision') callbacks.onConflict?.('revision', change.detail)
    else if (change.status === 'conflict_external') callbacks.onConflict?.('external', change.detail)
    else if (change.status === 'stale_context') callbacks.onConflict?.('stale', change.detail)
    else if (change.status === 'failed') callbacks.onError?.(change.detail ?? '保存失败')
  })
  return unsubscribe
}

/** 切档：登记新文档可信快照（旧编辑器撤销历史/内容由编辑器自身保持）。 */
export function switchDocument(coordinator: SaveCoordinator, snapshot: DocumentSnapshot): void {
  coordinator.registerSnapshot(snapshot)
}

/** 供产品接线检查 Core 是否有未保存内容（切档/关闭前 flush 判定）。 */
export function hasDirtyDocument(coordinator: SaveCoordinator, relPath: string): boolean {
  try {
    return coordinator.state(relPath).status === 'dirty' || coordinator.state(relPath).status === 'saving'
  } catch {
    return false
  }
}
