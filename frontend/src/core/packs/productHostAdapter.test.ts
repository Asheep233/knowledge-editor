/** UI 工坊 A7：产品 guest 宿主适配器（mock invoke；无 DOM）。 */
import type { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { describe, expect, it, vi } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import {
  capabilityCeilingFor,
  createArticleMetaCommandHandler,
  createGuestRequestId,
  createProductHostBackend,
  fetchContextSnapshotWithContent,
  isRecoverableContextError,
  isolationGuard,
  utf8ByteLength,
  writeContextDocument,
} from './productHostAdapter'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const MANIFEST: PackManifest = {
  id: 'com.demo.host',
  name: 'Host Demo',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell', 'panel.sidebar', 'context.read'],
  entry: { html: 'index.html' },
  commands: [],
  assets: [
    { path: 'index.html', sha256: 'a'.repeat(64) },
    { path: 'style.css', sha256: 'b'.repeat(64) },
    { path: 'sdk.js', sha256: 'c'.repeat(64) },
  ],
}

function backend(handler: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const invokeImpl = vi.fn(async (cmd: string, args?: Record<string, unknown>) => handler(cmd, args)) as unknown as typeof tauriInvoke
  return { adapter: createProductHostBackend({ invokeImpl }), invokeImpl }
}

describe('A7 productHostAdapter', () => {
  it('readManifest 读取 manifest.json 并校验', async () => {
    const { adapter } = backend((cmd) => {
      if (cmd === 'workshop_pack_read_asset') return JSON.stringify(MANIFEST)
      return undefined
    })
    const m = await adapter.readManifest('com.demo.host', '1.0.0')
    expect(m.id).toBe('com.demo.host')
    await expect(adapter.readManifest('x', '1.0.0')).resolves.toBeTruthy()
  })

  it('verify / deactivate / recover 命令映射', async () => {
    const { adapter, invokeImpl } = backend((cmd) => {
      if (cmd === 'workshop_pack_verify') return true
      if (cmd === 'workshop_pack_recover') return { recovered: true, action: 'rollback-corrupt-active' }
      return undefined
    })
    expect(await adapter.verify('p', '1.0.0')).toBe(true)
    // deactivate 不写会话状态（避免覆盖 failed/safeMode；由宿主 onSessionChange 负责）
    await adapter.deactivate('p')
    expect(invokeImpl).not.toHaveBeenCalledWith('workshop_pack_session_report', expect.anything())
    expect(await adapter.recover('p')).toEqual({ recovered: true, action: 'rollback-corrupt-active' })
  })

  it('loadEntry：entry + css/js 资产注入（占位符/追加）', async () => {
    const files: Record<string, string> = {
      'index.html': '<html><head>{{STYLE}}</head><body><div id="g">guest</div>{{SCRIPT}}</body></html>',
      'style.css': '#g{color:red}',
      'sdk.js': 'window.__guest=1',
    }
    const { adapter } = backend((cmd, args) => {
      if (cmd === 'workshop_pack_read_asset') return files[String(args?.path)] ?? ''
      return undefined
    })
    const entry = await adapter.loadEntry(MANIFEST)
    expect(entry.html).toContain('<style data-pack-asset="style.css">#g{color:red}</style>')
    expect(entry.html).toContain('<script data-pack-asset="sdk.js">window.__guest=1</script>')
    expect(entry.assets).toEqual({ 'style.css': '#g{color:red}', 'sdk.js': 'window.__guest=1' })
  })

  it('sessionStatus / reportSession 映射', async () => {
    const { adapter, invokeImpl } = backend((cmd) => {
      if (cmd === 'workshop_pack_session_status') return { state: 'active', packId: 'p', capabilities: ['context.read'] }
      if (cmd === 'workshop_pack_session_report') return { state: 'stopped', packId: 'p' }
      return undefined
    })
    expect(await adapter.sessionStatus()).toMatchObject({ state: 'active' })
    expect(await adapter.reportSession({ state: 'stopped', packId: 'p' })).toMatchObject({ state: 'stopped' })
    expect(invokeImpl).toHaveBeenCalledWith('workshop_pack_session_status')
  })

  it('isolationGuard：guest 可访问 Tauri globals → 拒绝', () => {
    expect(isolationGuard({ ownInternals: false, parentInternals: false }).ok).toBe(true)
    const denied = isolationGuard({ ownInternals: true, parentInternals: false })
    expect(denied.ok).toBe(false)
    expect(denied.reason).toContain('E_ISOLATION')
  })

  it('capabilityCeilingFor：community 不允许 ui.shell/context.read → 空集（禁用）；trusted 放行', () => {
    // community 不允许 ui.shell/context.read → 整包禁用（空集，不静默降级）
    expect(capabilityCeilingFor('community', MANIFEST)).toEqual([])
    expect(capabilityCeilingFor('trusted', MANIFEST)).toEqual(['ui.shell', 'panel.sidebar', 'context.read'])
  })

  it('无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/packs/productHostAdapter.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})

describe('W02 article meta command handler', () => {
  it('白名单 article.set-title → PUT meta（路径/参数校验）', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ path: 'Articles/a.md', title: '新标题' }) })) as unknown as typeof fetch
    const handler = createArticleMetaCommandHandler({ fetchImpl, baseUrl: 'http://127.0.0.1:8000' })
    const result = await handler.invoke('article.set-title', { relPath: 'Articles/a.md', title: '新标题' })
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/articles/Articles%2Fa.md/meta',
      expect.objectContaining({ method: 'PUT' }),
    )
    const body = JSON.parse(String((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).body))
    expect(body).toEqual({ title: '新标题' })
  })

  it('article.set-tags → PUT tags；非法路径/空标题/未知命令拒绝', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ path: 'Articles/a.md', tags: ['x'] }) })) as unknown as typeof fetch
    const handler = createArticleMetaCommandHandler({ fetchImpl })
    expect((await handler.invoke('article.set-tags', { relPath: 'Articles/a.md', tags: ['x'] })).ok).toBe(true)
    await expect(handler.invoke('article.set-title', { relPath: '../evil.md', title: 'x' })).rejects.toThrow(/E_PATH/)
    await expect(handler.invoke('article.set-title', { relPath: 'Articles/a.md', title: '  ' })).rejects.toThrow(/E_TITLE/)
    await expect(handler.invoke('article.delete', { relPath: 'Articles/a.md' })).rejects.toThrow(/E_COMMAND_NOT_ALLOWED/)
  })
})


// ---------------- T26 G1/G2：产品 guest 上下文读写（真实 HTTP 语义） ----------------

type RouteResult = { status: number; body: unknown } | 'throw'

function routeFetch(route: (url: string, init?: RequestInit) => RouteResult) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const r = route(url, init)
    if (r === 'throw') throw new Error('network down')
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const BASE = 'http://127.0.0.1:8000'
const CTX = { contextId: 'ke-default', epoch: 1 }
const DOC = '---\ntitle: A\n---\n\n正文🙂\n'

function snapshotRoute(contentStatus = 200): (url: string) => RouteResult {
  return (url) => {
    if (url.endsWith('/api/context/snapshot')) {
      return { status: 200, body: { rel_path: 'Articles/a.md', revision: 2, disk_hash: 'hash-2', context_id: 'ke-default' } }
    }
    if (url.includes('/api/articles/')) {
      return contentStatus === 200 ? { status: 200, body: { content: DOC } } : { status: contentStatus, body: { detail: '文章不存在' } }
    }
    return { status: 404, body: { detail: 'not found' } }
  }
}

function writeRoute(result: RouteResult): (url: string) => RouteResult {
  return (url) => (url.endsWith('/api/context/write') ? result : { status: 404, body: {} })
}

describe('T26 G1 内容读通道：context.snapshot 可选正文', () => {
  it('具备 context.read → 快照携带完整正文 + UTF-8 字节数（复用既有只读文档 API）', async () => {
    const { fetchImpl, calls } = routeFetch(snapshotRoute())
    const snap = await fetchContextSnapshotWithContent(CTX, 'Articles/a.md', true, { fetchImpl, baseUrl: BASE })
    expect(snap.relPath).toBe('Articles/a.md')
    expect(snap.revision).toBe(2)
    expect(snap.diskHash).toBe('hash-2')
    expect(snap.content).toBe(DOC)
    expect(snap.contentBytes).toBe(utf8ByteLength(DOC))
    expect(snap.contentBytes).toBe(new TextEncoder().encode(DOC).length)
    // 第一次是 context/snapshot POST（带 context/epoch/rel_path），第二次是只读文档 GET
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe(`${BASE}/api/context/snapshot`)
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ context_id: 'ke-default', epoch: 1, rel_path: 'Articles/a.md' })
    expect(calls[1].url).toBe(`${BASE}/api/articles/Articles/a.md`)
    expect(calls[1].init?.method).toBe('GET')
  })

  it('无 context.read 能力（includeContent=false）→ 只回旧形状，不读正文', async () => {
    const { fetchImpl, calls } = routeFetch(snapshotRoute())
    const snap = await fetchContextSnapshotWithContent(CTX, 'Articles/a.md', false, { fetchImpl, baseUrl: BASE })
    expect(snap).toEqual({ relPath: 'Articles/a.md', revision: 2, diskHash: 'hash-2' })
    expect(snap.content).toBeUndefined()
    expect(snap.contentBytes).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('正文读取失败（404/非文档路径）→ 退化为旧形状（向后兼容，不报错）', async () => {
    const { fetchImpl } = routeFetch(snapshotRoute(404))
    const snap = await fetchContextSnapshotWithContent(CTX, 'Attachments/x.bin', true, { fetchImpl, baseUrl: BASE })
    expect(snap).toEqual({ relPath: 'Articles/a.md', revision: 2, diskHash: 'hash-2' })
  })

  it('context/snapshot 非 200 → E_SNAPSHOT（不伪装成功）', async () => {
    const { fetchImpl } = routeFetch(() => ({ status: 503, body: { detail: 'busy' } }))
    await expect(fetchContextSnapshotWithContent(CTX, 'Articles/a.md', true, { fetchImpl, baseUrl: BASE })).rejects.toThrow(/E_SNAPSHOT/)
  })
})

describe('T26 G2 真实写通道：context.write → /api/context/write', () => {
  it('completed → 真实 revision/accepted/recoveryDurable/fileDurable 透传（不伪造）', async () => {
    const { fetchImpl, calls } = routeFetch(
      writeRoute({
        status: 200,
        body: {
          request_id: 'rid-1',
          context_id: 'ke-default',
          rel_path: 'Articles/a.md',
          status: 'completed',
          revision: 3,
          accepted: true,
          recovery_durable: true,
          file_durable: true,
        },
      }),
    )
    const result = await writeContextDocument(CTX, { relPath: 'Articles/a.md', content: '新正文', expectedRevision: 2 }, { fetchImpl, baseUrl: BASE })
    expect(result).toEqual({
      requestId: 'rid-1',
      status: 'completed',
      revision: 3,
      accepted: true,
      recoveryDurable: true,
      fileDurable: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/api/context/write`)
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      context_id: 'ke-default',
      epoch: 1,
      rel_path: 'Articles/a.md',
      content: '新正文',
      expected_revision: 2,
    })
  })

  it('revision 冲突 → conflict/kind=revision + currentRevision（无伪造 revision）', async () => {
    const { fetchImpl } = routeFetch(
      writeRoute({
        status: 200,
        body: { request_id: 'rid-2', context_id: 'ke-default', rel_path: 'Articles/a.md', status: 'conflict', kind: 'revision', current_revision: 5 },
      }),
    )
    const result = await writeContextDocument(CTX, { relPath: 'Articles/a.md', content: 'x', expectedRevision: 1 }, { fetchImpl, baseUrl: BASE })
    expect(result).toMatchObject({ requestId: 'rid-2', status: 'conflict', kind: 'revision', currentRevision: 5 })
    expect(result.revision).toBeUndefined()
    expect(result.fileDurable).toBeUndefined()
  })

  it('epoch 过期（409）→ stale', async () => {
    const { fetchImpl } = routeFetch(writeRoute({ status: 409, body: { detail: '上下文 epoch 已过期: 期望 2, 收到 1' } }))
    const result = await writeContextDocument(CTX, { relPath: 'Articles/a.md', content: 'x', expectedRevision: 1 }, { fetchImpl, baseUrl: BASE })
    expect(result).toMatchObject({ status: 'stale' })
  })

  it('HTTP 500 / 网络失败 → failed（不伪造成功、不伪造 durability）', async () => {
    const http500 = routeFetch(writeRoute({ status: 500, body: { detail: 'boom' } }))
    const r1 = await writeContextDocument(CTX, { relPath: 'Articles/a.md', content: 'x', expectedRevision: 1 }, { fetchImpl: http500.fetchImpl, baseUrl: BASE })
    expect(r1.status).toBe('failed')
    expect(r1.revision).toBeUndefined()
    expect(r1.fileDurable).toBeUndefined()
    const network = routeFetch(() => 'throw')
    const r2 = await writeContextDocument(CTX, { relPath: 'Articles/a.md', content: 'x', expectedRevision: 1 }, { fetchImpl: network.fetchImpl, baseUrl: BASE })
    expect(r2.status).toBe('failed')
  })

  it('requestId 透传（幂等）：params.requestId 作为 request_id 发送', async () => {
    const { fetchImpl, calls } = routeFetch(
      writeRoute({ status: 200, body: { request_id: 'rid-9', context_id: 'ke-default', rel_path: 'Articles/a.md', status: 'completed', revision: 1, file_durable: true } }),
    )
    const result = await writeContextDocument(CTX, { relPath: 'Articles/a.md', content: 'x', expectedRevision: 0, requestId: 'guest-req-42' }, { fetchImpl, baseUrl: BASE })
    expect(JSON.parse(String(calls[0].init?.body)).request_id).toBe('guest-req-42')
    expect(result.requestId).toBe('rid-9')
    expect(result.revision).toBe(1)
  })
})


// ---------------- W07 A-10/B-6：桥接超时语义 + 可恢复上下文错误判据 ----------------

function abortError(): Error {
  const e = new Error('signal is aborted without reason')
  e.name = 'AbortError'
  return e
}

/** 永不自行完成的 fetch：仅在 AbortSignal abort 时以 AbortError 拒绝（模拟宿主 fetch 超时）。 */
function hangingAbortFetch(): typeof fetch {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(abortError())
          return
        }
        signal?.addEventListener('abort', () => reject(abortError()), { once: true })
      }),
  ) as unknown as typeof fetch
}

describe('W07 A-10：宿主 fetch 超时 → 协议错误 E_TIMEOUT（retryable）', () => {
  it('snapshot 请求超时 → E_TIMEOUT/retryable=true（不再是 E_INTERNAL/signal aborted）', async () => {
    const err = (await fetchContextSnapshotWithContent(CTX, 'Articles/a.md', false, {
      fetchImpl: hangingAbortFetch(),
      baseUrl: BASE,
      timeoutMs: 20,
    }).catch((e) => e)) as { code?: string; retryable?: boolean; message?: string }
    expect(err.code).toBe('E_TIMEOUT')
    expect(err.retryable).toBe(true)
    expect(String(err.message)).toContain('超时')
    expect(String(err.message)).not.toMatch(/aborted/i)
  })

  it('可选正文读取超时 → 仍返回旧形状快照（G1 兼容语义不变，不把可选字段失败升级为协议错误）', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/context/snapshot')) {
        return { status: 200, ok: true, json: async () => ({ rel_path: 'Articles/a.md', revision: 2, disk_hash: 'h-2' }) } as unknown as Response
      }
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError()), { once: true })
      })
    }) as unknown as typeof fetch
    const snap = await fetchContextSnapshotWithContent(CTX, 'Articles/a.md', true, { fetchImpl, baseUrl: BASE, timeoutMs: 20 })
    expect(snap).toEqual({ relPath: 'Articles/a.md', revision: 2, diskHash: 'h-2' })
    expect(snap.content).toBeUndefined()
  })

  it('isRecoverableContextError：404/409 上下文失效可恢复；500/E_TIMEOUT/网络错误不重试', () => {
    expect(isRecoverableContextError(new Error('E_SNAPSHOT: HTTP 404'))).toBe(true)
    expect(isRecoverableContextError(new Error('E_SNAPSHOT: HTTP 409'))).toBe(true)
    expect(isRecoverableContextError(new Error('context write 失败: HTTP 404'))).toBe(true)
    expect(isRecoverableContextError(new Error('上下文不存在或已关闭: ke-default'))).toBe(true)
    expect(isRecoverableContextError(Object.assign(new Error('epoch'), { code: 'E_STALE_CONTEXT' }))).toBe(true)
    expect(isRecoverableContextError(new Error('E_SNAPSHOT: HTTP 500'))).toBe(false)
    expect(isRecoverableContextError(new Error('context write 失败: HTTP 500'))).toBe(false)
    expect(isRecoverableContextError({ code: 'E_TIMEOUT', retryable: true, message: '宿主请求超时' })).toBe(false)
    expect(isRecoverableContextError(new Error('ECONNREFUSED'))).toBe(false)
    expect(isRecoverableContextError(null)).toBe(false)
  })

  it('createGuestRequestId：前缀 + 非空随机后缀（写重试复用同一 id）', () => {
    const a = createGuestRequestId('guest-write')
    expect(a).toMatch(/^guest-write-[0-9a-z]+-[0-9a-z]+$/)
    expect(createGuestRequestId('guest-write')).not.toBe(a)
  })
})
