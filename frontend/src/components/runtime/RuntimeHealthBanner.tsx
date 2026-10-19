/**
 * W07 B-4：sidecar 运行时健康 banner（App 级，全局可见，不依赖工坊面板是否打开）。
 *
 * - 监听 Rust 侧 `ke:sidecar-exited` / `ke:runtime-error` / `ke:runtime-ready`（见
 *   `core/packs/runtimeHealthEvents.ts`），显示「自动恢复中 / 已降级 / 已恢复」三类提示；
 * - 非 Tauri 环境（Web/vitest）订阅安全降级为 no-op，组件不渲染任何内容（不误报）；
 * - `ke:runtime-ready` 恢复后显示「后端已恢复」并在 TTL 后自动消失；
 * - 恢复事件若带 `api_base`（崩溃重启可能换端口）→ 刷新 `window.__KE_API_BASE__`，
 *   既有 fetch 层在请求时读取该全局（main.tsx 启动期同一约定）。
 */
import { useEffect, useState } from 'react'

import {
  idleRuntimeHealth,
  subscribeRuntimeHealthEvents,
  type RuntimeHealthState,
  type RuntimeReadyPayload,
} from '../../core/packs/runtimeHealthEvents'

/** 诊断钩子：最近一次运行时健康状态（W07 探针/排障读取；guest 不可达，仅主窗口）。 */
interface RuntimeHealthDebugWindow {
  __keRuntimeHealth?: RuntimeHealthState
}

export interface RuntimeHealthBannerProps {
  /** 测试注入：事件订阅实现（默认走 Tauri `@tauri-apps/api/event`） */
  subscribe?: typeof subscribeRuntimeHealthEvents
  /** 「已恢复」提示停留时长（ms，默认 4s） */
  recoveredTtlMs?: number
}

const PHASE_STYLE: Record<Exclude<RuntimeHealthState['phase'], 'idle'>, string> = {
  restarting: 'bg-amber-100 text-amber-800 border-amber-200',
  degraded: 'bg-rose-100 text-rose-800 border-rose-200',
  recovered: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}

const PHASE_LABEL: Record<Exclude<RuntimeHealthState['phase'], 'idle'>, string> = {
  restarting: '后端重连中',
  degraded: '后端已降级',
  recovered: '后端已恢复',
}

export function RuntimeHealthBanner({
  subscribe = subscribeRuntimeHealthEvents,
  recoveredTtlMs = 4000,
}: RuntimeHealthBannerProps) {
  const [health, setHealth] = useState<RuntimeHealthState>(idleRuntimeHealth)

  useEffect(() => {
    let disposed = false
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    void subscribe({
      onChanged: (next) => {
        if (disposed) return
        setHealth(next)
        try {
          ;(window as RuntimeHealthDebugWindow).__keRuntimeHealth = next
        } catch {
          /* 诊断钩子失败不影响 UI */
        }
        clearTimer()
        if (next.phase === 'recovered') {
          timer = setTimeout(() => {
            if (!disposed) {
              setHealth(idleRuntimeHealth())
              try {
                ;(window as RuntimeHealthDebugWindow).__keRuntimeHealth = idleRuntimeHealth()
              } catch {
                /* 忽略 */
              }
            }
          }, recoveredTtlMs)
        }
      },
      onReady: (payload: RuntimeReadyPayload) => {
        // 崩溃重启后 api_base 可能变化：刷新启动期注入的同一全局（请求层每次读取）。
        const base = payload?.api_base
        if (typeof base === 'string' && base.length > 0) {
          try {
            window.__KE_API_BASE__ = base
          } catch {
            /* 忽略：只影响后续请求基址刷新 */
          }
        }
      },
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else off = unlisten
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      clearTimer()
      off?.()
    }
  }, [subscribe, recoveredTtlMs])

  if (health.phase === 'idle') return null
  const phase = health.phase as Exclude<RuntimeHealthState['phase'], 'idle'>
  return (
    <div
      data-testid="runtime-health-banner"
      data-phase={phase}
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-2 border-b px-4 py-1 text-center text-xs ${PHASE_STYLE[phase]}`}
    >
      <span className="font-medium">{PHASE_LABEL[phase]}</span>
      <span className="opacity-90">{health.message}</span>
      {phase === 'degraded' && (
        <span className="opacity-70">（可尝试重启应用；日志见设置 → 打开日志目录）</span>
      )}
    </div>
  )
}
