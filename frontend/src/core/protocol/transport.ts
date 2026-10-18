/**
 * UI 工坊 P1-T11：可复用「带标签/方向」的传输适配器（DOM-free 核心）。
 *
 * 背景（Windows/WebView2 实测，见 evidence/P1-T11-transport-probe.md）：
 * MessagePort 无法 transfer 进 opaque-origin sandbox iframe → 首发 guest 传输使用
 * window.postMessage JSON 桥。本模块把「桥」抽象成可测试的 DOM-free 传输：
 * - 每条消息包一层信封 `{__keProtoChannel, dir, payload}`，按 channelId 隔离、按方向过滤；
 * - 端点注入 `send/subscribe`（浏览器里是 window.postMessage，测试里是内存队列）；
 * - 大消息（结构化 clone）与事件/请求共用此通道；顺序由底层 postMessage 保证。
 */
import type { ProtocolPort } from './types'

export const WIRE_CHANNEL_KEY = '__keProtoChannel' as const

export type WireDirection = 'host-to-guest' | 'guest-to-host'

export interface WireEnvelope {
  __keProtoChannel: string
  dir: WireDirection
  payload: unknown
}

export interface WireEndpoint {
  /** 发送一条信封（浏览器实现：postMessage(structured clone)） */
  send(envelope: WireEnvelope): void
  /** 订阅收到的信封（已做 channel/方向过滤前的原始数据） */
  subscribe(cb: (data: unknown) => void): () => void
}

export interface WireTransportOptions {
  channelId: string
  role: 'host' | 'guest'
}

export interface WireTransportStats {
  sent: number
  received: number
  droppedOtherChannel: number
  malformed: number
}

function isEnvelope(value: unknown): value is WireEnvelope {
  if (!value || typeof value !== 'object') return false
  const v = value as WireEnvelope
  return typeof v.__keProtoChannel === 'string' && (v.dir === 'host-to-guest' || v.dir === 'guest-to-host') && 'payload' in v
}

/**
 * 创建一端协议 Port：host 角色发 host-to-guest、收 guest-to-host；guest 反之。
 * channelId 隔离同一 webview 内多个 guest 实例；未知/畸形信封丢弃并计数（不抛错）。
 */
export interface WireTransport {
  port: ProtocolPort
  stats: WireTransportStats
  close(): void
}

export function createWireTransport(endpoint: WireEndpoint, options: WireTransportOptions): WireTransport {
  const stats: WireTransportStats = { sent: 0, received: 0, droppedOtherChannel: 0, malformed: 0 }
  const outDir: WireDirection = options.role === 'host' ? 'host-to-guest' : 'guest-to-host'
  const inDir: WireDirection = options.role === 'host' ? 'guest-to-host' : 'host-to-guest'
  const listeners = new Set<(msg: unknown) => void>()
  const unsubscribe = endpoint.subscribe((data) => {
    if (!isEnvelope(data)) {
      stats.malformed += 1
      return
    }
    if (data.__keProtoChannel !== options.channelId) {
      stats.droppedOtherChannel += 1
      return
    }
    if (data.dir !== inDir) {
      stats.malformed += 1
      return
    }
    stats.received += 1
    for (const cb of listeners) cb(data.payload)
  })
  const port: ProtocolPort = {
    postMessage(msg: unknown) {
      stats.sent += 1
      endpoint.send({ __keProtoChannel: options.channelId, dir: outDir, payload: msg })
    },
    onMessage(cb: (msg: unknown) => void) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return { port, stats, close: unsubscribe }
}

/** 便捷：内存双向端点对（测试/端口模拟；支持大消息与顺序保持）。 */
export function createMemoryWirePair(): [WireEndpoint, WireEndpoint] {
  const subsA = new Set<(d: unknown) => void>()
  const subsB = new Set<(d: unknown) => void>()
  const endpoint = (own: Set<(d: unknown) => void>, peer: Set<(d: unknown) => void>): WireEndpoint => ({
    send(envelope: WireEnvelope) {
      queueMicrotask(() => peer.forEach((cb) => cb(structuredClone(envelope))))
    },
    subscribe(cb: (d: unknown) => void) {
      own.add(cb)
      return () => own.delete(cb)
    },
  })
  return [endpoint(subsA, subsB), endpoint(subsB, subsA)]
}
