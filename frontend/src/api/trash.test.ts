/** 回收站 API 契约回归（docs/design-trash-mvp.md §3）：路径 / 方法 / 请求体 / 响应类型。
 *  前后端并行开发，以契约为准——本文件锁定前端发出的实际请求形状。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearTrash, listTrash, purgeTrash, restoreTrash } from './client'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = ''
})

/** 最小 Response 替身（request() 只用 ok/status/statusText/json） */
function jsonResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
  }
}

describe('回收站 API 客户端 — 契约 §3', () => {
  it('listTrash：GET /api/trash 并原样返回 {count, items}', async () => {
    const items = [
      {
        id: '20260915-143012-a1b2',
        rel_path: 'Articles/子目录/文档.md',
        name: '文档.md',
        deleted_at: '2026-09-15T14:30:12+08:00',
        size: 2048,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { count: 1, items }))
    vi.stubGlobal('fetch', fetchMock)
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = ''

    const payload = await listTrash()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe('/api/trash')
    expect(init?.method).toBeUndefined() // GET（沿用 request 默认）
    expect(payload).toEqual({ count: 1, items })
  })

  it('restoreTrash：POST /api/trash/restore，body {id}，返回 renamed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { id: '20260915-143012-a1b2', restored_to: 'Articles/子目录/文档-1.md', renamed: true }),
      )
    vi.stubGlobal('fetch', fetchMock)
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = ''

    const result = await restoreTrash('20260915-143012-a1b2')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/trash/restore')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ id: '20260915-143012-a1b2' })
    expect(result).toEqual({
      id: '20260915-143012-a1b2',
      restored_to: 'Articles/子目录/文档-1.md',
      renamed: true,
    })
  })

  it('purgeTrash：DELETE /api/trash/{id}（id 编码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204))
    vi.stubGlobal('fetch', fetchMock)
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = ''

    await expect(purgeTrash('20260915-143012-a1b2')).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/trash/20260915-143012-a1b2')
    expect(init.method).toBe('DELETE')
  })

  it('clearTrash：DELETE /api/trash，204 幂等（不解析 JSON）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204))
    vi.stubGlobal('fetch', fetchMock)
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = ''

    await expect(clearTrash()).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/trash')
    expect(init.method).toBe('DELETE')
  })

  it('失败时抛错且带后端 detail（调用方捕获后展示）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ detail: '目标名称冲突' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = ''

    await expect(restoreTrash('x')).rejects.toThrow('409 目标名称冲突')
  })
})
