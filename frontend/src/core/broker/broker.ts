/**
 * UI 工坊 P3-T18：宿主 Broker —— 按连接身份/能力/上下文 epoch/命令授权校验 guest 请求。
 *
 * 红线（ARCHITECTURE / TASKS T18）：
 * - guest 没有任意 app 命令面：只能经受控协议方法访问，且每个方法要求声明能力；
 * - 连接身份绑定 (packId, packVersion, capabilities, contextId, epoch, declaredCommands)；
 *   上下文切换（epoch 变化）后旧连接请求一律 `E_STALE_CONTEXT`；
 * - 命令必须来自 manifest.commands 的声明式白名单，未声明 → `E_FORBIDDEN`；
 * - 代理有界：单连接在途请求上限（`E_BUSY`）、单次 payload 上限（`E_BAD_PAYLOAD` 带 limit）；
 * - 错误全部类型化（code/retryable/details），不靠字符串。
 *
 * 本模块无 DOM/React 依赖；后端通过注入 `BrokerBackend`（真实实现接 Core/T09）。
 */
import type { MethodName, ProtocolMethods, ProtocolError } from '../protocol/types'
import { protocolError } from '../protocol/types'

export type BrokerRole = 'official' | 'trusted' | 'guest'

export interface BrokerConnection {
  connectionId: string
  packId: string
  packVersion: string
  role: BrokerRole
  /** 授予的能力（来自 manifest allowlist ∩ host 策略；official 可全部） */
  capabilities: string[]
  contextId: string
  epoch: number
  /** manifest.commands 声明的命令名白名单 */
  declaredCommands: string[]
}

export interface BrokerBackend {
  snapshot(params: ProtocolMethods['context.snapshot']['params'], conn: BrokerConnection): Promise<ProtocolMethods['context.snapshot']['result']>
  write(params: ProtocolMethods['context.write']['params'], conn: BrokerConnection): Promise<ProtocolMethods['context.write']['result']>
  print(params: ProtocolMethods['print.snapshot']['params'], conn: BrokerConnection): Promise<ProtocolMethods['print.snapshot']['result']>
  invokeCommand(params: ProtocolMethods['command.invoke']['params'], conn: BrokerConnection): Promise<ProtocolMethods['command.invoke']['result']>
  /** 当前上下文 epoch（宿主真实状态；用于校验连接是否过期） */
  currentEpoch(contextId: string): number | null
}

export interface BrokerOptions {
  /** 单连接最大在途请求数（默认 8） */
  maxInflight?: number
  /** 单次请求 params 序列化最大字节数（默认 512KiB） */
  maxPayloadBytes?: number
  /** official 角色隐含全能力（默认 true） */
  officialFullAccess?: boolean
}

/** 方法 → 需要的能力（protocol.capabilities 无需能力） */
export const METHOD_CAPABILITIES: Readonly<Record<Exclude<MethodName, 'protocol.capabilities'>, string>> = {
  'context.snapshot': 'context.read',
  'context.write': 'context.write',
  'print.snapshot': 'print.request',
  'command.invoke': 'ui.shell',
}

/**
 * 连接是否拥有某能力（official 角色在 fullAccess 下视为全能力）。
 * G1：产品 Broker 后端用它决定 `context.snapshot` 是否返回正文（`context.read`）——
 * 与 `authorize` 用同一判定，避免「协议层与返回内容」两套能力口径。
 */
export function connectionHasCapability(conn: BrokerConnection, capability: string, officialFullAccess = true): boolean {
  return (officialFullAccess && conn.role === 'official') || conn.capabilities.includes(capability)
}

export interface BrokerAuthResult {
  ok: boolean
  error?: ProtocolError
}

interface InflightCounter {
  count: number
}

export class Broker {
  private readonly backend: BrokerBackend
  private readonly options: Required<BrokerOptions>
  private readonly inflight = new Map<string, InflightCounter>()

  constructor(backend: BrokerBackend, options: BrokerOptions = {}) {
    this.backend = backend
    this.options = {
      maxInflight: options.maxInflight ?? 8,
      maxPayloadBytes: options.maxPayloadBytes ?? 512 * 1024,
      officialFullAccess: options.officialFullAccess ?? true,
    }
  }

  /** 纯授权检查（不调用后端；便于契约测试与错误路径穷举）。 */
  authorize(method: MethodName, params: unknown, conn: BrokerConnection): BrokerAuthResult {
    if (!conn.connectionId) return { ok: false, error: protocolError('E_FORBIDDEN', '连接未标识') }
    // 上下文 epoch 过期 → 拒绝（切库后旧连接不得写/读新库）
    const current = this.backend.currentEpoch(conn.contextId)
    if (current === null) return { ok: false, error: protocolError('E_STALE_CONTEXT', '上下文已关闭', { contextId: conn.contextId }) }
    if (current !== conn.epoch) {
      return { ok: false, error: protocolError('E_STALE_CONTEXT', '连接 epoch 已过期', { expected: current, received: conn.epoch }, true) }
    }
    if (method === 'protocol.capabilities') return { ok: true }
    const required = METHOD_CAPABILITIES[method as Exclude<MethodName, 'protocol.capabilities'>]
    const official = conn.role === 'official' && this.options.officialFullAccess
    if (!official && required && !conn.capabilities.includes(required)) {
      return { ok: false, error: protocolError('E_CAPABILITY', `缺少能力: ${required}`, { required, granted: conn.capabilities }) }
    }
    // 声明式命令白名单
    if (method === 'command.invoke') {
      const p = params as { name?: unknown } | null
      const name = typeof p?.name === 'string' ? p.name : ''
      if (!name) return { ok: false, error: protocolError('E_BAD_PAYLOAD', 'command.invoke 缺少 name') }
      if (!conn.declaredCommands.includes(name)) {
        return { ok: false, error: protocolError('E_FORBIDDEN', `命令未在 manifest 声明: ${name}`, { name }) }
      }
    }
    // payload 上限
    let size = 0
    try {
      size = JSON.stringify(params ?? null)?.length ?? 0
    } catch {
      return { ok: false, error: protocolError('E_BAD_PAYLOAD', 'params 不可序列化') }
    }
    if (size > this.options.maxPayloadBytes) {
      return { ok: false, error: protocolError('E_BAD_PAYLOAD', '请求超限', { limit: this.options.maxPayloadBytes, actual: size }) }
    }
    // 在途上限
    const counter = this.inflight.get(conn.connectionId) ?? { count: 0 }
    if (counter.count >= this.options.maxInflight) {
      return { ok: false, error: protocolError('E_BUSY', '在途请求超限', { maxInflight: this.options.maxInflight }, true) }
    }
    return { ok: true }
  }

  /** 执行受控方法（授权 → 计数器 → 调后端 → 释放）。 */
  async handle<M extends Exclude<MethodName, 'protocol.capabilities'>>(
    method: M,
    params: ProtocolMethods[M]['params'],
    conn: BrokerConnection,
  ): Promise<ProtocolMethods[M]['result']> {
    const auth = this.authorize(method, params, conn)
    if (!auth.ok) throw auth.error
    const counter = this.inflight.get(conn.connectionId) ?? { count: 0 }
    counter.count += 1
    this.inflight.set(conn.connectionId, counter)
    try {
      switch (method) {
        case 'context.snapshot':
          return (await this.backend.snapshot(params as never, conn)) as never
        case 'context.write':
          return (await this.backend.write(params as never, conn)) as never
        case 'print.snapshot':
          return (await this.backend.print(params as never, conn)) as never
        case 'command.invoke':
          return (await this.backend.invokeCommand(params as never, conn)) as never
        default:
          throw protocolError('E_UNKNOWN_METHOD', `未知方法: ${String(method)}`)
      }
    } finally {
      counter.count = Math.max(0, counter.count - 1)
      if (counter.count === 0) this.inflight.delete(conn.connectionId)
    }
  }
}
