/**
 * AstraNota UI 创意工坊 guest SDK（发布形态，独立于宿主前端源码）。
 *
 * 外部开发者把 `dist/guest-sdk.js`（iife，全局 `KeWorkshopSDK`）内联进包入口，
 * 使用 `KeWorkshopSDK.connectGuest({requestedFeatures})` 建立与宿主的协议线：
 * - 握手（features/version/context/epoch）
 * - `request(method, params)`（Broker 能力过滤 + 超时 + 取消错误）
 * - 心跳（宿主心跳监控；guest 需周期性发送）
 *
 * wire 与宿主约定：`{type:'t19-wire', direction:'host-to-guest'|'guest-to-host', msg}`；
 * 启动握手：先 `{type:'t19-guest-alive'}`，宿主回 `{type:'t19-port'}` 后开始协议。
 */
export interface GuestWirePort {
  postMessage(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
}

export interface ConnectOptions {
  requestedFeatures: string[]
  sdkVersion?: string
  timeoutMs?: number
  /** 自定义 wire（默认：跨 iframe postMessage） */
  port?: GuestWirePort
}

export type MethodName = 'protocol.capabilities' | 'context.snapshot' | 'context.write' | 'print.snapshot' | 'command.invoke'

export interface GuestConnection {
  handshake(): Promise<HandshakeInfo>
  request(method: MethodName | string, params?: Record<string, unknown>): Promise<unknown>
  heartbeat(): void
  close(reason?: string): void
  readonly handshakeInfo: HandshakeInfo | null
}

export interface HandshakeInfo {
  ok: boolean
  protocolVersion: number
  hostVersion: string
  acceptedFeatures: string[]
  contextId: string
  epoch: number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SdkError extends Error {
  readonly code: string
  readonly retryable: boolean
  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'SdkError'
    this.code = code
    this.retryable = retryable
  }
}

function defaultPort(): GuestWirePort {
  return {
    postMessage: (msg) => window.parent.postMessage({ type: 't19-wire', direction: 'guest-to-host', msg }, '*'),
    onMessage: (cb) => {
      const handler = (e: MessageEvent) => {
        const d = e.data as { type?: string; direction?: string; msg?: unknown }
        if (d?.type === 't19-wire' && d.direction === 'host-to-guest') cb(d.msg)
      }
      window.addEventListener('message', handler)
      return () => window.removeEventListener('message', handler)
    },
  }
}

let seq = 0

export function connectGuest(options: ConnectOptions): GuestConnection {
  const timeoutMs = options.timeoutMs ?? 5000
  const port = options.port ?? defaultPort()
  const pending = new Map<string, Pending>()
  const unsubscribe = port.onMessage((raw) => {
    const msg = raw as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: { code?: string; message?: string; retryable?: boolean } }
    if (msg?.type === 'handshake.response') {
      const p = pending.get('__handshake')
      if (!p) return
      pending.delete('__handshake')
      clearTimeout(p.timer)
      if (msg.ok) p.resolve(msg)
      else p.reject(new SdkError(msg.error?.code ?? 'E_HANDSHAKE', msg.error?.message ?? '握手被拒绝'))
      return
    }
    if (msg?.type === 'response' && msg.requestId) {
      const p = pending.get(msg.requestId)
      if (!p) return
      pending.delete(msg.requestId)
      clearTimeout(p.timer)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new SdkError(msg.error?.code ?? 'E_PROTOCOL', msg.error?.message ?? '请求失败', msg.error?.retryable))
    }
  })

  const handshakeRef = { info: null as HandshakeInfo | null }
  const connection: GuestConnection = {
    get handshakeInfo() {
      return handshakeRef.info
    },
    async handshake() {
      const msg = { protocolVersion: 1, sdkVersion: options.sdkVersion ?? 'sdk-0.1.0', requestedFeatures: options.requestedFeatures }
      const res = (await rawRequest('handshake', msg)) as { ok?: boolean; protocolVersion?: number; hostVersion?: string; acceptedFeatures?: string[]; contextId?: string; epoch?: number; error?: { code?: string; message?: string } }
      if (!res?.ok) throw new SdkError(res?.error?.code ?? 'E_HANDSHAKE', res?.error?.message ?? '握手被拒绝')
      const info: HandshakeInfo = {
        ok: true,
        protocolVersion: res.protocolVersion ?? 1,
        hostVersion: res.hostVersion ?? 'unknown',
        acceptedFeatures: res.acceptedFeatures ?? [],
        contextId: res.contextId ?? '',
        epoch: res.epoch ?? 0,
      }
      handshakeRef.info = info
      return info
    },
    request: (method, params = {}) => rawRequest(method, params),
    heartbeat: () => window.parent.postMessage({ type: 't19-heartbeat' }, '*'),
    close(reason = 'guest-closed') {
      unsubscribe()
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.reject(new SdkError('E_CLOSED', reason))
      }
      pending.clear()
    },
  }

  function rawRequest(kind: string, payload: unknown): Promise<unknown> {
    const requestId = `sdk-${++seq}`
    const pendingKey = kind === 'handshake' ? '__handshake' : requestId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(pendingKey)
        reject(new SdkError('E_TIMEOUT', `请求超时: ${kind}`, true))
      }, timeoutMs)
      pending.set(pendingKey, { resolve, reject, timer })
      if (kind === 'handshake') port.postMessage({ type: 'handshake', ...(payload as object) })
      else port.postMessage({ type: 'request', requestId, method: kind, params: payload })
    })
  }

  return connection
}

/** 便捷入口：等待宿主 t19-port 后自动握手（打包入口可直接调用）。 */
export function autoConnect(options: ConnectOptions): Promise<GuestConnection> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SdkError('E_TIMEOUT', '等待宿主 t19-port 超时')), options.timeoutMs ?? 10000)
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string }
      if (d?.type !== 't19-port') return
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      const conn = connectGuest(options)
      conn.handshake().then(() => resolve(conn)).catch(reject)
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 't19-guest-alive' }, '*')
  })
}

export const SDK_VERSION = '0.1.0'
