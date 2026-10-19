/**
 * W07 B-4/B-5：Rust sidecar 运行时健康事件（前端订阅 + 状态归约）。
 *
 * Rust `desktop/src-tauri/src/sidecar.rs` 在 sidecar 生命周期关键点发射：
 * - `ke:runtime-ready`（侧车 health 成功，payload 含 api_base/workspace/version/pid/port）；
 * - `ke:sidecar-exited`（已启动的侧车进程退出；`restarting/attempt/maxRestarts` 表明是否会自动拉起）；
 * - `ke:runtime-error`（启动/自动拉起失败或崩溃重启耗尽；`terminal:true` = 不再自动恢复）。
 *
 * 本模块把事件归约为 UI 可显示的健康状态（B-4 banner），并向工坊 guest 宿主暴露
 * 「后端不可用 / 已恢复」回调（B-5 会话状态上行）。
 *
 * 非 Tauri 环境（Web 开发 / vitest）`listen` 会失败 → 静默降级为 no-op，绝不抛错/unhandled rejection。
 */

export const RUNTIME_EVENT_READY = 'ke:runtime-ready'
export const RUNTIME_EVENT_SIDECAR_EXITED = 'ke:sidecar-exited'
export const RUNTIME_EVENT_ERROR = 'ke:runtime-error'

export type RuntimeHealthPhase = 'idle' | 'restarting' | 'degraded' | 'recovered'

export interface RuntimeHealthState {
  phase: RuntimeHealthPhase
  /** 面向用户的简短说明（不伪造：只转述真实事件） */
  message: string
  /** 自动拉起第几次（1-based；未知为 null） */
  attempt: number | null
  maxRestarts: number | null
  /** 状态更新时间戳（ms） */
  updatedAt: number
}

export interface SidecarExitedPayload {
  code?: number | null
  signal?: number | null
  restarting?: boolean
  attempt?: number
  maxRestarts?: number
}

export interface RuntimeErrorPayload {
  message?: string
  terminal?: boolean
  attempt?: number
  maxRestarts?: number
}

export interface RuntimeReadyPayload {
  api_base?: string
  workspace?: string
  version?: string
  pid?: number
  port?: number
}

export type RuntimeHealthEventKind = 'sidecar-exited' | 'runtime-error' | 'runtime-ready'

export interface RuntimeHealthCallbacks {
  /** 每次归约出**新状态**时回调（同状态重复事件不回调） */
  onChanged?: (state: RuntimeHealthState) => void
  /** 后端进入不可用（restarting/degraded）时回调 —— B-5：guest 会话挂起 */
  onUnavailable?: (message: string) => void
  /** 后端恢复（ke:runtime-ready，且此前确实处于异常态）时回调 —— B-5：guest 会话恢复 */
  onReady?: (payload: RuntimeReadyPayload) => void
}

/** 订阅函数签名（测试注入替身；生产默认走 @tauri-apps/api/event）。 */
export type RuntimeHealthListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>

export function idleRuntimeHealth(): RuntimeHealthState {
  return { phase: 'idle', message: '', attempt: null, maxRestarts: null, updatedAt: 0 }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function textOf(payload: unknown): string {
  return typeof payload === 'string' ? payload : ''
}

/**
 * 纯归约：事件 → 健康状态（可单测，无 DOM/时间副作用）。
 * - 初始 `idle` 收到 `ke:runtime-ready` 保持 idle（正常启动不弹「已恢复」banner）；
 * - `ke:sidecar-exited`：restarting !== false → restarting（自动恢复中），否则 degraded；
 * - `ke:runtime-error`：degraded（terminal 与否都属降级，terminal 用于文案/级别）；
 * - 异常态收到 `ke:runtime-ready` → recovered。
 */
export function reduceRuntimeHealth(
  state: RuntimeHealthState,
  kind: RuntimeHealthEventKind,
  payload?: unknown,
  now: number = Date.now(),
): RuntimeHealthState {
  if (kind === 'runtime-ready') {
    if (state.phase === 'idle') return state
    return { phase: 'recovered', message: '后端已恢复', attempt: null, maxRestarts: null, updatedAt: now }
  }
  if (kind === 'sidecar-exited') {
    const p = (payload ?? {}) as SidecarExitedPayload
    const restarting = p.restarting !== false
    const attempt = isFiniteNumber(p.attempt) ? p.attempt : null
    const maxRestarts = isFiniteNumber(p.maxRestarts) ? p.maxRestarts : null
    if (!restarting) {
      return {
        phase: 'degraded',
        message: '后端连接已断开（侧车已停止）',
        attempt: null,
        maxRestarts,
        updatedAt: now,
      }
    }
    const suffix = attempt !== null && maxRestarts !== null ? `（第 ${attempt}/${maxRestarts} 次）` : ''
    return {
      phase: 'restarting',
      message: `后端连接中断，正在自动恢复${suffix}`,
      attempt,
      maxRestarts,
      updatedAt: now,
    }
  }
  const p = (payload ?? {}) as RuntimeErrorPayload
  const detail = typeof p.message === 'string' && p.message.trim() ? p.message.trim() : '后端服务不可用'
  return {
    phase: 'degraded',
    message: `后端已降级：${detail}`,
    attempt: isFiniteNumber(p.attempt) ? p.attempt : null,
    maxRestarts: isFiniteNumber(p.maxRestarts) ? p.maxRestarts : null,
    updatedAt: now,
  }
}

/** 默认 listen 实现：动态 import Tauri 事件 API（非 Tauri 环境失败由调用方吞掉）。 */
const defaultListen: RuntimeHealthListen = async (event, handler) => {
  const { listen } = await import('@tauri-apps/api/event')
  return (await listen(event, handler as never)) as unknown as () => void
}

/** 单次 listen 的安全包装：失败（非 Tauri/运行期异常）→ 返回 no-op 退订。 */
async function attachSafely(
  listen: RuntimeHealthListen,
  event: string,
  handler: (event: { payload: unknown }) => void,
): Promise<() => void> {
  try {
    const unlisten = await listen(event, handler)
    return typeof unlisten === 'function' ? unlisten : () => undefined
  } catch {
    return () => undefined
  }
}

/**
 * 订阅三个运行时事件；返回退订函数（可重复调用/幂等）。
 * 事件处理与回调异常均被吞掉（UI 可观测性不得反过来影响主流程）。
 */
export async function subscribeRuntimeHealthEvents(
  callbacks: RuntimeHealthCallbacks = {},
  listen: RuntimeHealthListen = defaultListen,
): Promise<() => void> {
  let state = idleRuntimeHealth()
  let disposed = false
  const offs: Array<() => void> = []

  const push = (next: RuntimeHealthState, kind: RuntimeHealthEventKind, payload: unknown): void => {
    if (disposed) return
    if (next === state) return
    const prev = state
    state = next
    try {
      callbacks.onChanged?.(state)
      if (kind !== 'runtime-ready' && (state.phase === 'restarting' || state.phase === 'degraded')) {
        callbacks.onUnavailable?.(state.message)
      }
      if (kind === 'runtime-ready' && prev.phase !== 'idle' && state.phase === 'recovered') {
        callbacks.onReady?.((payload ?? {}) as RuntimeReadyPayload)
      }
    } catch {
      /* 回调异常不影响事件订阅 */
    }
  }

  const on = (kind: RuntimeHealthEventKind) => (event: { payload: unknown }) =>
    push(reduceRuntimeHealth(state, kind, event?.payload), kind, event?.payload)

  const attached = await Promise.all([
    attachSafely(listen, RUNTIME_EVENT_SIDECAR_EXITED, on('sidecar-exited')),
    attachSafely(listen, RUNTIME_EVENT_ERROR, on('runtime-error')),
    attachSafely(listen, RUNTIME_EVENT_READY, on('runtime-ready')),
  ])
  if (disposed) {
    attached.forEach((off) => off())
    return () => undefined
  }
  offs.push(...attached)
  return () => {
    disposed = true
    offs.splice(0).forEach((off) => off())
  }
}

/** 诊断/测试用：把未知 payload 转可读摘要（不伪造；只取字符串 message）。 */
export function runtimeErrorSummary(payload: unknown): string {
  const p = (payload ?? {}) as RuntimeErrorPayload
  return typeof p.message === 'string' && p.message.trim() ? p.message.trim() : textOf(payload) || '后端服务不可用'
}
