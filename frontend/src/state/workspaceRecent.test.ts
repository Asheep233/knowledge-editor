/** P2-9 回归测试：移除最近工作区记录走 apiBase 拼接，不裸 fetch 绕过前缀。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeRecentWorkspace } from './workspaceRecent'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('removeRecentWorkspace — P2-9', () => {
  it('按 apiBase 前缀 + 编码 path 发起 DELETE', async () => {
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = 'http://127.0.0.1:8000'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, statusText: 'OK' })
    vi.stubGlobal('fetch', fetchMock)

    await removeRecentWorkspace('C:\\My Workspace')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/workspace/recent?path=C%3A%5CMy%20Workspace',
      { method: 'DELETE' },
    )
  })

  it('保留既有 apiBase 前缀（不在相对路径上重复丢失）', async () => {
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = ''
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, statusText: 'OK' })
    vi.stubGlobal('fetch', fetchMock)

    await removeRecentWorkspace('/ws')

    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/recent?path=%2Fws', { method: 'DELETE' })
  })

  it('失败时抛出错误（调用方捕获）', async () => {
    ;(window as { __KE_API_BASE__?: string }).__KE_API_BASE__ = 'http://127.0.0.1:8000'
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(removeRecentWorkspace('/ws')).rejects.toThrow('Not Found')
  })
})
