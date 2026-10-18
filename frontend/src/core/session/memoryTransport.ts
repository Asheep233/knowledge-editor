/** UI 工坊 P1-T10 测试替身：内存 SaveTransport（确定性故障注入）。 */
import type { SaveTransport, WriteRequest, WriteResult } from './types'

export interface MemoryTransportOptions {
  /** 覆盖写结果（默认按 requestId 幂等 completed/fileDurable） */
  resultFor?: (req: WriteRequest) => WriteResult | null
  /** 写调用抛错（模拟 abort/超时） */
  failWrite?: (req: WriteRequest) => Error | null
  /** 延迟（毫秒） */
  delayMs?: number
}

export class MemoryTransport implements SaveTransport {
  readonly calls: WriteRequest[] = []
  readonly queries: string[] = []
  private readonly options: MemoryTransportOptions
  private readonly serverResults = new Map<string, WriteResult>()
  private revisions = new Map<string, number>()

  constructor(options: MemoryTransportOptions = {}) {
    this.options = options
  }

  async write(req: WriteRequest): Promise<WriteResult> {
    this.calls.push(req)
    const injectedFail = this.options.failWrite?.(req)
    if (injectedFail) throw injectedFail
    if (this.options.delayMs) await new Promise((r) => setTimeout(r, this.options.delayMs))
    const key = `${req.contextId}\u0000${req.relPath}`
    const prev = this.revisions.get(key) ?? 0
    const injected = this.options.resultFor?.(req) ?? null
    const result: WriteResult =
      injected ?? {
        requestId: req.requestId,
        contextId: req.contextId,
        relPath: req.relPath,
        status: 'completed',
        accepted: true,
        recoveryDurable: true,
        fileDurable: true,
        revision: prev + 1,
      }
    if (result.status === 'completed' && result.fileDurable) this.revisions.set(key, result.revision ?? prev + 1)
    this.serverResults.set(req.requestId, result)
    return result
  }

  async queryResult(requestId: string): Promise<WriteResult | null> {
    this.queries.push(requestId)
    return this.serverResults.get(requestId) ?? null
  }

  /** 测试钩子：模拟「服务端已完成，客户端写调用超时」的场景。 */
  seedCompleted(requestId: string, result: WriteResult): void {
    this.serverResults.set(requestId, result)
  }
}
