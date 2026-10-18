/** UI 工坊 P1-T10：HttpTransport 单测（mock fetch；验证与 T09 /api/context/* 的映射）。 */
import { describe, expect, it, vi } from 'vitest'

import { HttpTransport } from './httpTransport'
import type { WriteRequest } from './types'

const REQ: WriteRequest = {
  contextId: 'ctx-1',
  epoch: 2,
  relPath: 'Articles/a.md',
  content: '正文',
  expectedRevision: 0,
  requestId: 'req-http-1',
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

describe('HttpTransport（T09 /api/context/*）', () => {
  it('completed 响应映射（含三阶段标志与 revision）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      request_id: 'req-http-1', context_id: 'ctx-1', rel_path: 'Articles/a.md', status: 'completed',
      revision: 1, accepted: true, recovery_durable: true, file_durable: true,
    })) as unknown as typeof fetch
    const transport = new HttpTransport({ fetchImpl })
    const result = await transport.write(REQ)
    expect(result).toMatchObject({
      requestId: 'req-http-1', contextId: 'ctx-1', relPath: 'Articles/a.md',
      status: 'completed', revision: 1, accepted: true, recoveryDurable: true, fileDurable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('409 epoch 过期 → stale', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { detail: '上下文 epoch 已过期: 期望 3, 收到 2' })) as unknown as typeof fetch
    const transport = new HttpTransport({ fetchImpl })
    const result = await transport.write(REQ)
    expect(result.status).toBe('stale')
  })

  it('409 revision 冲突 → conflict(revision)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { detail: 'expectedRevision 已过期' })) as unknown as typeof fetch
    const transport = new HttpTransport({ fetchImpl })
    const result = await transport.write(REQ)
    expect(result.status).toBe('conflict')
    expect(result.kind).toBe('revision')
  })

  it('非 2xx 抛错（由 SaveCoordinator 视为 abort 并可 reconcile）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { detail: 'boom' })) as unknown as typeof fetch
    const transport = new HttpTransport({ fetchImpl })
    await expect(transport.write(REQ)).rejects.toThrow(/HTTP 500/)
  })

  it('queryResult：404 → null；200 → 映射结果', async () => {
    const notFound = vi.fn(async () => jsonResponse(404, { detail: '不存在' })) as unknown as typeof fetch
    await expect(new HttpTransport({ fetchImpl: notFound }).queryResult('none')).resolves.toBeNull()
    const done = vi.fn(async () => jsonResponse(200, {
      request_id: 'req-http-1', context_id: 'ctx-1', rel_path: 'Articles/a.md', status: 'completed',
      revision: 1, accepted: true, recovery_durable: true, file_durable: true,
    })) as unknown as typeof fetch
    const result = await new HttpTransport({ fetchImpl: done }).queryResult('req-http-1')
    expect(result?.status).toBe('completed')
    expect(result?.fileDurable).toBe(true)
  })

  it('请求超时 → abort 抛错（可 reconcile）', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise((_r, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('AbortError: timeout')))
      })
      return jsonResponse(200, {})
    }) as unknown as typeof fetch
    const transport = new HttpTransport({ fetchImpl, timeoutMs: 10 })
    await expect(transport.write(REQ)).rejects.toThrow(/AbortError/)
  })
})
