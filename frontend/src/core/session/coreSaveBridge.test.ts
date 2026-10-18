/** UI 工坊 T14 桥（ADR-002 步骤 1）：上下文解析 + 快照 + Core 保存（注入 fetch，无 DOM）。 */
import { describe, expect, it } from 'vitest'

import { CoreSaveBridge } from './coreSaveBridge'
import { CoreSaveError } from './productAdapter'

type Call = { path: string; init?: RequestInit }

function json(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response
}

function makeFetch(handler: (path: string, init?: RequestInit) => Response) {
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push({ path, init })
    return handler(path, init)
  }) as unknown as typeof fetch
  return { impl, calls }
}

function writeBody(calls: Call[], index: number): Record<string, unknown> {
  return JSON.parse(String(calls[index].init?.body))
}

describe('T14 CoreSaveBridge（上下文解析 + 快照 + Core 保存）', () => {
  it('ensureContext：workspace/info → context/open，并缓存（不重复请求）', async () => {
    const { impl, calls } = makeFetch((path) => {
      if (path.endsWith('/api/workspace/info')) return json(200, { root: 'C:/ws' })
      if (path.endsWith('/api/context/open')) return json(200, { id: 'ke-default', epoch: 3 })
      return json(404, {})
    })
    const bridge = new CoreSaveBridge({ fetchImpl: impl })
    expect(await bridge.ensureContext()).toEqual({ contextId: 'ke-default', epoch: 3 })
    expect(await bridge.ensureContext()).toEqual({ contextId: 'ke-default', epoch: 3 })
    expect(calls.filter((c) => c.path.endsWith('/api/workspace/info'))).toHaveLength(1)
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ id: 'ke-default', root: 'C:/ws' })
  })

  it('context/open 409 → switch 取最新 epoch', async () => {
    const { impl, calls } = makeFetch((path) => {
      if (path.endsWith('/api/workspace/info')) return json(200, { root: 'C:/ws' })
      if (path.endsWith('/api/context/open')) return json(409, { detail: '已存在' })
      if (path.endsWith('/api/context/switch')) return json(200, { id: 'ke-default', epoch: 9 })
      return json(404, {})
    })
    const bridge = new CoreSaveBridge({ fetchImpl: impl })
    expect(await bridge.ensureContext()).toEqual({ contextId: 'ke-default', epoch: 9 })
    expect(calls.some((c) => c.path.endsWith('/api/context/switch'))).toBe(true)
  })

  it('saveDocument：snapshot rev0 → write(expectedRevision=0) → revision 1；第二次保存用新 revision', async () => {
    let revision = 0
    const { impl, calls } = makeFetch((path) => {
      if (path.endsWith('/api/workspace/info')) return json(200, { root: 'C:/ws' })
      if (path.endsWith('/api/context/open')) return json(200, { id: 'ke-default', epoch: 1 })
      if (path.endsWith('/api/context/snapshot')) return json(200, { rel_path: 'Articles/a.md', revision, disk_hash: 'h' })
      if (path.endsWith('/api/context/write')) {
        revision += 1
        return json(200, {
          request_id: writeBody(calls, calls.length - 1)['request_id'],
          context_id: 'ke-default',
          rel_path: 'Articles/a.md',
          status: 'completed',
          revision,
          accepted: true,
          recovery_durable: true,
          file_durable: true,
        })
      }
      return json(404, {})
    })
    const bridge = new CoreSaveBridge({ fetchImpl: impl })
    expect(await bridge.saveDocument('Articles/a.md', '第一版')).toEqual({ status: 'saved', revision: 1 })
    expect(await bridge.saveDocument('Articles/a.md', '第二版')).toEqual({ status: 'saved', revision: 2 })
    const writes = calls.filter((c) => c.path.endsWith('/api/context/write'))
    expect(writes).toHaveLength(2)
    expect(JSON.parse(String(writes[0].init?.body))).toMatchObject({ expected_revision: 0, content: '第一版' })
    expect(JSON.parse(String(writes[1].init?.body))).toMatchObject({ expected_revision: 1, content: '第二版' })
  })

  it('revision 冲突 → 抛 CoreSaveError(E_CONFLICT)', async () => {
    const { impl } = makeFetch((path) => {
      if (path.endsWith('/api/workspace/info')) return json(200, { root: 'C:/ws' })
      if (path.endsWith('/api/context/open')) return json(200, { id: 'ke-default', epoch: 1 })
      if (path.endsWith('/api/context/snapshot')) return json(200, { rel_path: 'a.md', revision: 0, disk_hash: 'h' })
      if (path.endsWith('/api/context/write')) return json(409, { detail: 'expectedRevision 已过期' })
      return json(404, {})
    })
    const bridge = new CoreSaveBridge({ fetchImpl: impl })
    const err = (await bridge.saveDocument('a.md', 'x').catch((e) => e)) as CoreSaveError
    expect(err).toBeInstanceOf(CoreSaveError)
    expect(err.code).toBe('E_CONFLICT')
  })

  it('epoch 过期 → 抛 CoreSaveError(E_STALE_CONTEXT)', async () => {
    const { impl } = makeFetch((path) => {
      if (path.endsWith('/api/workspace/info')) return json(200, { root: 'C:/ws' })
      if (path.endsWith('/api/context/open')) return json(200, { id: 'ke-default', epoch: 1 })
      if (path.endsWith('/api/context/snapshot')) return json(200, { rel_path: 'a.md', revision: 0, disk_hash: 'h' })
      if (path.endsWith('/api/context/write')) return json(409, { detail: '上下文 epoch 已过期: 期望 2, 收到 1' })
      return json(404, {})
    })
    const bridge = new CoreSaveBridge({ fetchImpl: impl })
    await expect(bridge.saveDocument('a.md', 'x')).rejects.toMatchObject({ code: 'E_STALE_CONTEXT' })
  })

  it('invalidate：丢弃上下文缓存，下次重新 open', async () => {
    let opens = 0
    const { impl } = makeFetch((path) => {
      if (path.endsWith('/api/workspace/info')) return json(200, { root: 'C:/ws' })
      if (path.endsWith('/api/context/open')) {
        opens += 1
        return json(200, { id: 'ke-default', epoch: opens })
      }
      return json(404, {})
    })
    const bridge = new CoreSaveBridge({ fetchImpl: impl })
    await bridge.ensureContext()
    bridge.invalidate()
    expect(await bridge.ensureContext()).toEqual({ contextId: 'ke-default', epoch: 2 })
    expect(opens).toBe(2)
  })

  it('工作区未打开（info 非 200）→ 明确错误', async () => {
    const { impl } = makeFetch(() => json(409, { detail: '未打开工作区' }))
    const bridge = new CoreSaveBridge({ fetchImpl: impl })
    await expect(bridge.ensureContext()).rejects.toThrow(/E_CONTEXT/)
  })

  it('无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/session/coreSaveBridge.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
