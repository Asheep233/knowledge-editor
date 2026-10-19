/** UI 工坊 A7：产品 guest 宿主适配器（mock invoke；无 DOM）。 */
import type { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { describe, expect, it, vi } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import { capabilityCeilingFor, createArticleMetaCommandHandler, createProductHostBackend, isolationGuard } from './productHostAdapter'

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
