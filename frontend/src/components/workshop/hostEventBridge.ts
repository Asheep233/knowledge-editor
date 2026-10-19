/**
 * T26 G4：产品 window 事件 → 协议 `HostEvent` 的宿主侧桥。
 *
 * 约束（如实/不伪造）：
 * - 只翻译**真实发生**的产品状态：保存成功、文档切换、主题变化；
 * - `document-saved.revision` 若产品事件未带真实 revision（旧保存链不返回），
 *   通过注入的 `resolveRevision(relPath)` 向后端快照读取**真实 revision**；
 *   读不到 → 记 error 且**不发射**（绝不编造 revision）；
 * - `context-changed` 的 contextId/epoch 优先取真实上下文（resolveContext），
 *   失败时退回 `fallbackContext`（产品当前只有一个默认上下文，epoch=1）；
 * - 本模块无 React 依赖，便于单测；DOM 事件与 MutationObserver 均做可用性防御。
 */
import type { HostEvent } from '../../core/protocol/types'
import {
  WORKSHOP_EVENT_CONTEXT_CHANGED,
  WORKSHOP_EVENT_DOCUMENT_SAVED,
  WORKSHOP_EVENT_THEME_CHANGED,
  onWorkshopHostEvent,
  type WorkshopTheme,
} from './workshopHostEvents'

export interface HostEventContext {
  contextId: string | null
  epoch: number | null
}

export interface HostEventBridgeOptions {
  /** 发射到 host 协议分发器（生产为 HostDispatcher.emit） */
  emit: (event: HostEvent) => void
  /** 解析真实上下文（后端 context/open）；失败/缺省 → fallbackContext */
  resolveContext?: () => Promise<HostEventContext>
  /** 旧保存链事件不带 revision 时，向后端读取真实 revision；返回 null 表示解析失败 */
  resolveRevision?: (relPath: string) => Promise<number | null>
  /** 上下文解析失败时的回退值（产品单默认上下文；仅用于不丢失 context-changed 通知） */
  fallbackContext?: HostEventContext
}

export interface HostEventBridge {
  /** 已成功发射的事件（发射顺序） */
  readonly emitted: HostEvent[]
  /** 被拒绝/解析失败的事件（诊断；不发射） */
  readonly errors: string[]
  dispose(): void
}

interface HostEventDebugWindow {
  __keHostEventLog?: HostEvent[]
  __keHostEventErrors?: string[]
}

const DEFAULT_CONTEXT: HostEventContext = { contextId: 'ke-default', epoch: 1 }

function debugWindow(): HostEventDebugWindow | null {
  return typeof window === 'undefined' ? null : (window as HostEventDebugWindow)
}

function isNonEmptyString(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0')
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function validContext(value: unknown): HostEventContext | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { contextId?: unknown; epoch?: unknown }
  const contextId = v.contextId === null || typeof v.contextId === 'string' ? (v.contextId as string | null) : null
  const epoch = v.epoch === null || isNonNegativeInteger(v.epoch) ? (v.epoch as number | null) : null
  return { contextId, epoch }
}

/** 产品主题的唯一状态落点：`document.documentElement.dataset.theme`（applyTheme 写入）。 */
export function readProductTheme(root?: HTMLElement | null): WorkshopTheme {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
  const raw = el?.dataset?.theme
  return raw === 'dark' || raw === 'light' ? raw : 'system'
}

/** 观察产品主题变化（data-theme 属性变化）；返回停止函数。 */
export function observeProductTheme(listener: (theme: WorkshopTheme) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => undefined
  const root = document.documentElement
  let last = readProductTheme(root)
  const observer = new MutationObserver(() => {
    const next = readProductTheme(root)
    if (next === last) return
    last = next
    listener(next)
  })
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/**
 * 创建宿主事件桥：挂 3 个产品 window 事件监听 + 返回 dispose。
 * 事件处理一律异步容错（失败只记录，不抛到 window 事件分发链）。
 */
export function createHostEventBridge(options: HostEventBridgeOptions): HostEventBridge {
  const emitted: HostEvent[] = []
  const errors: string[] = []
  const fallbackContext = options.fallbackContext ?? DEFAULT_CONTEXT
  const debug = debugWindow()

  const record = (event: HostEvent): void => {
    emitted.push(event)
    if (debug) debug.__keHostEventLog = [...(debug.__keHostEventLog ?? []), event]
    options.emit(event)
  }
  const fail = (reason: string): void => {
    errors.push(reason)
    if (debug) debug.__keHostEventErrors = [...(debug.__keHostEventErrors ?? []), reason]
  }
  const run = (task: () => Promise<void>): void => {
    void task().catch((e) => fail(String((e as Error)?.message ?? e)))
  }

  const offSaved = onWorkshopHostEvent(WORKSHOP_EVENT_DOCUMENT_SAVED, (raw) => {
    run(async () => {
      const detail = (raw ?? {}) as { relPath?: unknown; revision?: unknown }
      if (!isNonEmptyString(detail.relPath)) {
        fail('document-saved: 缺少合法 relPath')
        return
      }
      const relPath = detail.relPath
      let revision: number | null = isNonNegativeInteger(detail.revision) ? detail.revision : null
      if (revision === null && options.resolveRevision) {
        try {
          const resolved = await options.resolveRevision(relPath)
          revision = isNonNegativeInteger(resolved) ? resolved : null
        } catch (e) {
          fail(`document-saved: revision 解析失败（${String((e as Error)?.message ?? e)}）`)
          return
        }
      }
      if (revision === null) {
        fail('document-saved: 无法确认真实 revision，拒绝发射（不伪造）')
        return
      }
      record({ type: 'document-saved', relPath, revision })
    })
  })

  const offContext = onWorkshopHostEvent(WORKSHOP_EVENT_CONTEXT_CHANGED, () => {
    run(async () => {
      let ctx: HostEventContext | null = null
      if (options.resolveContext) {
        try {
          ctx = validContext(await options.resolveContext())
        } catch (e) {
          fail(`context-changed: 上下文解析失败（${String((e as Error)?.message ?? e)}），使用回退上下文`)
        }
      }
      const context = ctx ?? validContext(fallbackContext) ?? DEFAULT_CONTEXT
      record({ type: 'context-changed', contextId: context.contextId, epoch: context.epoch })
    })
  })

  const offTheme = onWorkshopHostEvent(WORKSHOP_EVENT_THEME_CHANGED, (raw) => {
    const detail = (raw ?? {}) as { theme?: unknown }
    const theme = detail.theme
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') {
      fail(`theme-changed: 非法 theme ${JSON.stringify(theme)}`)
      return
    }
    record({ type: 'theme-changed', theme })
  })

  return {
    emitted,
    errors,
    dispose() {
      offSaved()
      offContext()
      offTheme()
    },
  }
}
