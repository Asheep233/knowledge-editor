/**
 * 前端握手：等待拿到运行时 API 基址（P1-13）。
 *
 * 原缺陷：main.tsx 用 10 次 × 400ms（共 4s）后就放弃，而 Rust sidecar 冷启动 / 首次
 * 全量重建索引可能需 5–30s，导致前端放弃注入、回退相对路径且不再恢复。
 *
 * 本模块把「等待注入」抽成纯逻辑 `waitForRuntimeBase`：
 *  - 先异步探测一次；
 *  - 若提供了事件等待（Rust 注入的 `ke:runtime-ready` 或 `__KE_API_BASE__` 已就绪），
 *    优先等事件（有界），事件到达即重新探测；
 *  - 事件没来则按 pollMs 轮询 probe，直到成功或超时（默认 30s）。
 * main.tsx 在桌面环境（Tauri host）调用它拿到基址后写入 `window.__KE_API_BASE__`。
 */

export interface WaitRuntimeOpts {
  /** 异步探测：调用 Rust `get_runtime_info` 等，返回 api_base（原始字符串）或 null */
  probe: () => Promise<string | null>
  /** 总超时（ms），默认 30s 对齐后端启动窗口 */
  timeoutMs: number
  pollMs?: number
  /**
   * 可选：事件等待（如 `ke:runtime-ready`）。事件到达后拿到 payload 里的 api_base
   * 直接返回（string）；超时返回 null。返回的字符串会被 normalizeApiBase 规范化。
   */
  waitForEvent?: (name: string, timeoutMs: number) => Promise<string | null>
  /** 时钟（可注入，默认 Date.now） */
  now?: () => number
}

/** 规范化 api base：去尾部斜杠。 */
export function normalizeApiBase(base: string): string {
  return base.replace(/\/+$/, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export const DEFAULT_RUNTIME_WAIT_MS = 30000
export const RUNTIME_EVENT_BOUND_MS = 5000

export async function waitForRuntimeBase(opts: WaitRuntimeOpts): Promise<string | null> {
  const { probe, timeoutMs, pollMs = 100, waitForEvent, now = () => Date.now() } = opts
  const probeOnce = async (): Promise<string | null> => {
    const b = await probe()
    return b ? normalizeApiBase(b) : null
  }

  const immediate = await probeOnce()
  if (immediate) return immediate

  // 事件驱动：监听 ke:runtime-ready（有界等待），事件 payload 直接带出 api_base
  if (waitForEvent) {
    let fromEvent: string | null = null
    try {
      fromEvent = await waitForEvent('ke:runtime-ready', Math.min(timeoutMs, RUNTIME_EVENT_BOUND_MS))
    } catch {
      fromEvent = null
    }
    if (fromEvent) return normalizeApiBase(fromEvent)
    const afterEvent = await probeOnce()
    if (afterEvent) return afterEvent
  }

  // 轮询直到成功或超时（30s）
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    await sleep(pollMs)
    const b = await probeOnce()
    if (b) return b
  }
  return null
}
