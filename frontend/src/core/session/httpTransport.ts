/**
 * UI 工坊 P1-T10：真实 HTTP Transport —— 对接 T09 `/api/context/*` 端点。
 *
 * 无 DOM/React 依赖（只用注入的 fetch）；响应映射到类型化 WriteResult：
 * - 200 → completed（携带 accepted/recovery_durable/file_durable/revision）；
 * - 409 → stale（epoch 已过期）或 conflict（revision/外部改盘，按 detail 无法区分时默认 conflict）；
 * - 其它非 2xx → throw（由 SaveCoordinator 视为 abort/失败，随后可 reconcile 查真实结果）。
 */
import type { SaveTransport, WriteRequest, WriteResult } from './types'

export interface HttpTransportOptions {
  /** 后端 base（默认同源相对路径，浏览器/Tauri 内直接可用） */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** 单次请求超时（ms）；超时会 abort 并抛错（可 reconcile） */
  timeoutMs?: number
}

interface ContextWriteResponse {
  request_id: string
  context_id: string
  rel_path: string
  status: 'completed' | 'conflict'
  kind?: 'revision' | 'external'
  revision?: number
  current_revision?: number
  accepted?: boolean
  recovery_durable?: boolean
  file_durable?: boolean
  detail?: string
}

function mapWriteResponse(data: ContextWriteResponse): WriteResult {
  const base: WriteResult = {
    requestId: data.request_id,
    contextId: data.context_id,
    relPath: data.rel_path,
    status: data.status,
  }
  if (data.status === 'completed') {
    return {
      ...base,
      revision: data.revision,
      accepted: data.accepted,
      recoveryDurable: data.recovery_durable,
      fileDurable: data.file_durable,
    }
  }
  return { ...base, kind: data.kind, currentRevision: data.current_revision, detail: data.detail }
}

export class HttpTransport implements SaveTransport {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: HttpTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 15000
  }

  private async request<T>(path: string, init: RequestInit): Promise<{ status: number; body: T | null }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const resp = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
      let body: T | null = null
      try {
        body = (await resp.json()) as T
      } catch {
        body = null
      }
      return { status: resp.status, body }
    } finally {
      clearTimeout(timer)
    }
  }

  async write(req: WriteRequest): Promise<WriteResult> {
    const { status, body } = await this.request<ContextWriteResponse>('/api/context/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_id: req.contextId,
        epoch: req.epoch,
        rel_path: req.relPath,
        content: req.content,
        expected_revision: req.expectedRevision,
        request_id: req.requestId,
      }),
    })
    if (status === 409) {
      const detail = (body as { detail?: string } | null)?.detail ?? ''
      const stale = /epoch/i.test(detail)
      const external = /外部/.test(detail)
      return {
        requestId: req.requestId,
        contextId: req.contextId,
        relPath: req.relPath,
        status: stale ? 'stale' : 'conflict',
        kind: stale ? undefined : external ? 'external' : 'revision',
        detail,
      }
    }
    if (status !== 200 || !body) throw new Error(`context write 失败: HTTP ${status}`)
    return mapWriteResponse(body)
  }

  async queryResult(requestId: string): Promise<WriteResult | null> {
    const { status, body } = await this.request<ContextWriteResponse>(
      `/api/context/request/${encodeURIComponent(requestId)}`,
      { method: 'GET' },
    )
    if (status === 404 || !body) return null
    if (status !== 200) throw new Error(`context 结果查询失败: HTTP ${status}`)
    return mapWriteResponse(body)
  }
}
