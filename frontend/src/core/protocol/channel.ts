/**
 * UI 工坊 P1-T11：协议通道实现 —— 官方 shell 与 guest 共用同一 SDK/契约。
 *
 * - `ProtocolPort`：传输抽象（MessagePort / window.postMessage / Tauri 均由宿主注入实现）；
 * - `createInMemoryPorts`：测试与端口模拟用的成对端口；
 * - `GuestClient`：guest（或官方 shell）侧类型化客户端：handshake / request(cancel/timeout) / onEvent；
 * - `HostDispatcher`：host 侧分发器：版本+能力协商、方法注册、错误码化、取消/超时、事件广播。
 *
 * 无 DOM/React 依赖；请求响应全部有超时与取消路径，错误只以 ProtocolError(code) 表达。
 */
import {
  PROTOCOL_VERSION,
  isProtocolError,
  protocolError,
  type ErrorCode,
  type HandshakeReply,
  type HandshakeRequest,
  type HandshakeResponse,
  type HostEvent,
  type MethodName,
  type ProtocolError,
  type ProtocolMethods,
  type ProtocolPort,
  type RequestMessage,
} from './types'

export type { ProtocolPort }

/** 成对内存端口（测试/端口模拟）：A 发 → B 收，反之亦然。 */
export function createInMemoryPorts(): [ProtocolPort, ProtocolPort] {
  const listenersA = new Set<(msg: unknown) => void>()
  const listenersB = new Set<(msg: unknown) => void>()
  let closed = false
  const make = (deliver: (msg: unknown) => void, own: Set<(msg: unknown) => void>): ProtocolPort => ({
    postMessage(msg: unknown) {
      if (closed) return
      queueMicrotask(() => {
        if (closed) return
        deliver(msg)
      })
    },
    onMessage(cb: (msg: unknown) => void) {
      own.add(cb)
      return () => own.delete(cb)
    },
  })
  const a = make((msg) => listenersB.forEach((cb) => cb(msg)), listenersA)
  const b = make((msg) => listenersA.forEach((cb) => cb(msg)), listenersB)
  return [a, b]
}

export interface GuestClientOptions {
  sdkVersion?: string
  requestedFeatures?: string[]
  /** 默认请求超时（ms） */
  timeoutMs?: number
}

interface PendingCall {
  resolve: (v: unknown) => void
  reject: (e: ProtocolError) => void
  timer?: ReturnType<typeof setTimeout>
  controller: AbortController
}

export class ProtocolCallError extends Error {
  readonly error: ProtocolError
  constructor(error: ProtocolError) {
    super(`${error.code}: ${error.message}`)
    this.name = 'ProtocolCallError'
    this.error = error
  }
}

function isHandshakeReply(msg: unknown): msg is HandshakeReply {
  return !!msg && typeof msg === 'object' && (msg as { type?: string }).type === 'handshake.response'
}

export class GuestClient {
  private readonly port: ProtocolPort
  private readonly options: GuestClientOptions
  private readonly pending = new Map<string, PendingCall>()
  private readonly eventHandlers = new Set<(event: HostEvent) => void>()
  private readonly unsubscribe: () => void
  private seq = 0
  private handshakeResult: HandshakeResponse | null = null

  constructor(port: ProtocolPort, options: GuestClientOptions = {}) {
    this.port = port
    this.options = options
    this.unsubscribe = port.onMessage((msg) => this.handleMessage(msg))
  }

  get handshakeInfo(): HandshakeResponse | null {
    return this.handshakeResult
  }

  async handshake(): Promise<HandshakeResponse> {
    const request: HandshakeRequest = {
      type: 'handshake',
      protocolVersion: PROTOCOL_VERSION,
      sdkVersion: this.options.sdkVersion ?? 'sdk-0',
      requestedFeatures: this.options.requestedFeatures ?? [],
    }
    const reply = await new Promise<HandshakeReply>((resolve) => {
      const timer = setTimeout(() => resolve({ type: 'handshake.response', ok: false, error: protocolError('E_TIMEOUT', '握手超时', undefined, true) }), this.options.timeoutMs ?? 5000)
      const stop = this.port.onMessage((msg) => {
        if (!isHandshakeReply(msg)) return
        clearTimeout(timer)
        stop()
        resolve(msg)
      })
      this.port.postMessage(request)
    })
    if (!reply.ok) throw new ProtocolCallError(reply.error)
    this.handshakeResult = reply
    return reply
  }

  async request<M extends MethodName>(method: M, params: ProtocolMethods[M]['params'], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ProtocolMethods[M]['result']> {
    if (!this.handshakeResult) throw new ProtocolCallError(protocolError('E_VERSION', '未完成握手'))
    if (opts.signal?.aborted) throw new ProtocolCallError(protocolError('E_CANCELED', '请求已取消'))
    const requestId = `req-${++this.seq}-${Math.random().toString(36).slice(2, 8)}`
    const controller = new AbortController()
    const onAbort = () => {
      this.port.postMessage({ type: 'cancel', requestId, reason: 'aborted' })
      this.settle(requestId, undefined, protocolError('E_CANCELED', '请求已取消'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    return await new Promise<ProtocolMethods[M]['result']>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.port.postMessage({ type: 'cancel', requestId, reason: 'timeout' })
        this.settle(requestId, undefined, protocolError('E_TIMEOUT', '请求超时', undefined, true))
      }, opts.timeoutMs ?? this.options.timeoutMs ?? 10000)
      this.pending.set(requestId, {
        resolve: (v) => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          resolve(v as ProtocolMethods[M]['result'])
        },
        reject: (error) => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          reject(new ProtocolCallError(error))
        },
        timer,
        controller,
      })
      const message: RequestMessage = { type: 'request', requestId, method, params }
      this.port.postMessage(message)
    })
  }

  onEvent(handler: (event: HostEvent) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  close(): void {
    this.unsubscribe()
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer)
      call.reject(protocolError('E_CANCELED', '客户端已关闭'))
      this.pending.delete(id)
    }
  }

  private settle(requestId: string, result: unknown, error?: ProtocolError): void {
    const call = this.pending.get(requestId)
    if (!call) return
    this.pending.delete(requestId)
    if (error) call.reject(error)
    else call.resolve(result)
  }

  private handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return
    const m = msg as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: ProtocolError; event?: HostEvent }
    if (m.type === 'event' && m.event) {
      for (const h of this.eventHandlers) h(m.event)
      return
    }
    if (m.type !== 'response' || typeof m.requestId !== 'string') return
    if (m.ok) this.settle(m.requestId, m.result)
    else this.settle(m.requestId, undefined, m.error ?? protocolError('E_INTERNAL', '未知协议错误'))
  }
}

export interface HostDispatcherOptions {
  hostVersion?: string
  protocolVersion?: number
  features?: string[]
  /** 当前上下文（握手/事件里回给 guest） */
  context: () => { contextId: string | null; epoch: number | null }
}

export type HostHandler<M extends MethodName> = (
  params: ProtocolMethods[M]['params'],
  ctx: { requestId: string; signal: AbortSignal },
) => ProtocolMethods[M]['result'] | Promise<ProtocolMethods[M]['result']>

export type HostHandlers = { [M in MethodName]?: HostHandler<M> }

export class HostDispatcher {
  private readonly port: ProtocolPort
  private readonly handlers: HostHandlers
  private readonly options: HostDispatcherOptions
  private readonly active = new Map<string, AbortController>()
  private readonly unsubscribe: () => void
  private started = false

  constructor(port: ProtocolPort, handlers: HostHandlers, options: HostDispatcherOptions) {
    this.port = port
    this.handlers = handlers
    this.options = options
    this.unsubscribe = port.onMessage((msg) => void this.handleMessage(msg))
  }

  start(): void {
    this.started = true
  }

  emit(event: HostEvent): void {
    if (!this.started) return
    this.port.postMessage({ type: 'event', event })
  }

  cancel(requestId: string, reason = 'canceled'): void {
    this.active.get(requestId)?.abort()
    this.port.postMessage({ type: 'event', event: { type: 'host-shutdown', reason } })
  }

  close(): void {
    this.unsubscribe()
    for (const c of this.active.values()) c.abort()
    this.active.clear()
  }

  private reply(requestId: string, result: unknown): void {
    this.port.postMessage({ type: 'response', requestId, ok: true, result })
  }

  private fail(requestId: string, error: ProtocolError): void {
    this.port.postMessage({ type: 'response', requestId, ok: false, error })
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!this.started || !msg || typeof msg !== 'object') return
    const m = msg as {
      type?: string
      requestId?: string
      method?: string
      params?: unknown
      protocolVersion?: number
      requestedFeatures?: string[]
    }
    if (m.type === 'handshake') {
      const version = this.options.protocolVersion ?? PROTOCOL_VERSION
      if (m.protocolVersion !== version) {
        this.failHandshake(protocolError('E_VERSION', `协议版本不兼容：host=${version}, guest=${m.protocolVersion}`))
        return
      }
      const hostFeatures = this.options.features ?? []
      const acceptedFeatures = (m.requestedFeatures ?? []).filter((f) => hostFeatures.includes(f))
      const ctx = this.options.context()
      const reply: HandshakeResponse = {
        type: 'handshake.response',
        ok: true,
        protocolVersion: version,
        hostVersion: this.options.hostVersion ?? 'host-0',
        acceptedFeatures,
        contextId: ctx.contextId,
        epoch: ctx.epoch,
      }
      this.port.postMessage(reply)
      return
    }
    if (m.type === 'cancel') {
      if (typeof m.requestId === 'string') this.active.get(m.requestId)?.abort()
      return
    }
    if (m.type !== 'request') return
    const requestId = typeof m.requestId === 'string' ? m.requestId : ''
    if (!requestId || typeof m.method !== 'string') {
      if (requestId) this.fail(requestId, protocolError('E_BAD_PAYLOAD', '请求缺少 requestId/method'))
      return
    }
    const handler = (this.handlers as Record<string, HostHandler<MethodName> | undefined>)[m.method]
    if (!handler) {
      this.fail(requestId, protocolError('E_UNKNOWN_METHOD', `未知方法: ${m.method}`, { method: m.method }))
      return
    }
    const controller = new AbortController()
    this.active.set(requestId, controller)
    try {
      const result = await handler((m.params ?? {}) as never, { requestId, signal: controller.signal })
      if (controller.signal.aborted) return
      this.reply(requestId, result)
    } catch (e) {
      if (controller.signal.aborted) return
      this.fail(requestId, this.normalizeError(e))
    } finally {
      this.active.delete(requestId)
    }
  }

  private failHandshake(error: ProtocolError): void {
    this.port.postMessage({ type: 'handshake.response', ok: false, error })
  }

  private normalizeError(e: unknown): ProtocolError {
    if (isProtocolError(e)) return e
    const err = e as Error
    return protocolError('E_INTERNAL', err?.message ?? String(e))
  }
}

/** 便捷构造：host 侧抛错时保证带 code。 */
export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>, retryable = false): ProtocolError {
  return protocolError(code, message, details, retryable)
}
