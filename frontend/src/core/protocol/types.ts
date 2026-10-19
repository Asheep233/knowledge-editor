/**
 * UI 工坊 P1-T11：host ↔ guest 唯一类型化协议契约（版本化）。
 *
 * 设计约束（ARCHITECTURE / T11）：
 * - 命令、事件、请求/响应、错误、取消全部**类型化**；错误用 code 而非仅字符串；
 * - SDK 与 host 共用本文件类型（单一来源）；
 * - 协议版本 + 能力协商（不能用「未声明能力」的隐藏通道绕过）；
 * - 破坏性变更由 contract 测试拦截（PROTOCOL_CONTRACT 快照）。
 *
 * 本模块无 DOM/React 依赖：传输通过注入的 `ProtocolPort`（MessagePort/窗口 postMessage/Tauri 均可实现）。
 */

export const PROTOCOL_VERSION = 1 as const

export type ProtocolVersion = typeof PROTOCOL_VERSION

/** 错误码：guest/SDK 必须按 code 处理，不得依赖 message 文本。 */
export type ErrorCode =
  | 'E_VERSION'
  | 'E_UNKNOWN_METHOD'
  | 'E_BAD_PAYLOAD'
  | 'E_FORBIDDEN'
  | 'E_CAPABILITY'
  | 'E_CANCELED'
  | 'E_TIMEOUT'
  | 'E_BUSY'
  | 'E_STALE_CONTEXT'
  | 'E_CONFLICT'
  | 'E_INTERNAL'

export interface ProtocolError {
  code: ErrorCode
  message: string
  /** 是否可安全重试（协议语义，不是文案） */
  retryable: boolean
  details?: Record<string, unknown>
}

export interface HandshakeRequest {
  type: 'handshake'
  protocolVersion: number
  sdkVersion: string
  requestedFeatures: string[]
}

export interface HandshakeResponse {
  type: 'handshake.response'
  ok: true
  protocolVersion: number
  hostVersion: string
  acceptedFeatures: string[]
  contextId: string | null
  epoch: number | null
}

export interface HandshakeFailure {
  type: 'handshake.response'
  ok: false
  error: ProtocolError
}

export type HandshakeReply = HandshakeResponse | HandshakeFailure

/** host→guest 事件（guest 只读；不得发请求回传） */
export type HostEvent =
  | { type: 'context-changed'; contextId: string | null; epoch: number | null }
  | { type: 'theme-changed'; theme: 'light' | 'dark' | 'system' }
  | { type: 'selection-changed'; text: string; empty: boolean }
  | { type: 'document-saved'; relPath: string; revision: number }
  | { type: 'host-shutdown'; reason: string }

export interface EventMessage {
  type: 'event'
  event: HostEvent
}

export interface RequestMessage {
  type: 'request'
  requestId: string
  method: string
  params: unknown
}

export interface SuccessResponse {
  type: 'response'
  requestId: string
  ok: true
  result: unknown
}

export interface FailureResponse {
  type: 'response'
  requestId: string
  ok: false
  error: ProtocolError
}

export interface CancelMessage {
  type: 'cancel'
  requestId: string
  reason?: string
}

/** 传输抽象：MessagePort/window.postMessage/Tauri 均可注入实现（协议层不依赖 DOM）。 */
export interface ProtocolPort {
  postMessage(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
}

export type ProtocolMessage =
  | HandshakeRequest
  | EventMessage
  | RequestMessage
  | SuccessResponse
  | FailureResponse
  | CancelMessage

/** 可表达的 guest→host 方法（SDK 与 host 共用；新增方法必须升版本或加能力）。 */
export interface ProtocolMethods {
  'protocol.capabilities': { params: Record<string, never>; result: { protocolVersion: number; features: string[]; contextId: string | null; epoch: number | null } }
  /**
   * G1（T26 G1G2）：`content`/`contentBytes` 为**可选增量字段**（additive）——
   * 仅当连接拥有 `context.read` 能力时宿主返回正文；旧 guest/SDK 忽略未知字段即可，
   * 因此不构成破坏性契约变更，无需升 `PROTOCOL_VERSION`。
   */
  'context.snapshot': {
    params: { relPath: string }
    result: {
      relPath: string
      revision: number
      diskHash: string
      /** 当前 revision 对应的文档完整原文（含 BOM/frontmatter/CRLF，逐字节语义） */
      content?: string
      /** `content` 的 UTF-8 字节数（与磁盘文件大小一致；无 content 时不返回） */
      contentBytes?: number
    }
  }
  'context.write': {
    params: { relPath: string; content: string; expectedRevision: number; requestId?: string }
    result: {
      requestId: string
      status: 'completed' | 'conflict' | 'stale' | 'failed'
      kind?: 'revision' | 'external'
      revision?: number
      currentRevision?: number
      accepted?: boolean
      recoveryDurable?: boolean
      fileDurable?: boolean
    }
  }
  /**
   * T26 G3：`pdfToken` 为宿主真实打印产物（隔离目录 PDF）的不透明 token；
   * `pages` 在宿主无法得知页数时为 **null**（产品 Rust PrintToPdf 不回传页数，禁止伪造 1）。
   * 这是对 guest 的显式语义扩展：旧实现恒返回 `{pdfToken: relPath, pages: 1}` 假结果。
   */
  'print.snapshot': { params: { relPath: string }; result: { pdfToken: string; pages: number | null } }
  /** 声明式命令调用：仅允许 manifest.commands 中声明的 name（T17/T18） */
  'command.invoke': { params: { name: string; args?: Record<string, unknown> }; result: { ok: boolean; value?: unknown } }
}

export type MethodName = keyof ProtocolMethods

export function isProtocolError(value: unknown): value is ProtocolError {
  if (!value || typeof value !== 'object') return false
  const v = value as ProtocolError
  return typeof v.code === 'string' && typeof v.message === 'string' && typeof v.retryable === 'boolean'
}

export function protocolError(code: ErrorCode, message: string, details?: Record<string, unknown>, retryable = false): ProtocolError {
  return details ? { code, message, retryable, details } : { code, message, retryable }
}

/** 契约快照：破坏性变更必须让 contract 测试失败（显式评审后更新本常量）。 */
export const PROTOCOL_CONTRACT = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  methods: ['protocol.capabilities', 'context.snapshot', 'context.write', 'print.snapshot', 'command.invoke'] as MethodName[],
  errorCodes: [
    'E_VERSION',
    'E_UNKNOWN_METHOD',
    'E_BAD_PAYLOAD',
    'E_FORBIDDEN',
    'E_CAPABILITY',
    'E_CANCELED',
    'E_TIMEOUT',
    'E_BUSY',
    'E_STALE_CONTEXT',
    'E_CONFLICT',
    'E_INTERNAL',
  ] as ErrorCode[],
  events: ['context-changed', 'theme-changed', 'selection-changed', 'document-saved', 'host-shutdown'],
  messageTypes: ['handshake', 'handshake.response', 'event', 'request', 'response', 'cancel'],
})
