/** UI 工坊 T19：包隔离宿主 — 会话生命周期/崩溃处理/safe mode（Core）。 */
import { describe, expect, it, vi } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import { PackageHost, type PackageHostBackend } from './packageHost'

const MANIFEST: PackManifest = {
  id: 'com.demo.hello',
  name: 'Hello',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell', 'context.read'],
  entry: { html: 'index.html' },
  commands: [{ name: 'demo.hello', handler: 'hello' }],
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

function backend(overrides: Partial<PackageHostBackend> = {}): PackageHostBackend {
  return {
    verify: vi.fn(async () => true),
    readManifest: vi.fn(async () => MANIFEST),
    deactivate: vi.fn(async () => undefined),
    recover: vi.fn(async () => ({ recovered: true, action: 'rollback-corrupt-active' })),
    ...overrides,
  }
}

function makeHost(b: PackageHostBackend = backend(), epoch = 1) {
  return new PackageHost({ backend: b, binding: () => ({ contextId: 'ctx-A', epoch }), maxCrashes: 2 })
}

describe('T19 包隔离宿主', () => {
  it('start：校验完整性 → 生成受限 Broker 连接（guest/能力/命令白名单/context-epoch）', async () => {
    const host = makeHost()
    const session = await host.start('com.demo.hello', '1.0.0')
    expect(session.state).toBe('active')
    expect(session.connection).toMatchObject({
      packId: 'com.demo.hello',
      packVersion: '1.0.0',
      role: 'guest',
      capabilities: ['ui.shell', 'context.read'],
      contextId: 'ctx-A',
      epoch: 1,
      declaredCommands: ['demo.hello'],
    })
    expect(host.get('com.demo.hello')?.state).toBe('active')
  })

  it('start：版本损坏 → failed，不建立连接', async () => {
    const host = makeHost(backend({ verify: vi.fn(async () => false) }))
    const session = await host.start('com.demo.hello', '1.0.0')
    expect(session.state).toBe('failed')
    expect(session.connection).toBeUndefined()
    expect(session.lastError).toMatch(/E_HASH/)
  })

  it('崩溃未超限 → suspended 且可 restart 复活（重新绑定 epoch）', async () => {
    let epoch = 1
    const host = new PackageHost({ backend: backend(), binding: () => ({ contextId: 'ctx-A', epoch }), maxCrashes: 2 })
    await host.start('com.demo.hello', '1.0.0')
    epoch = 7
    const crashed = await host.reportCrash('com.demo.hello', 'guest renderer crashed')
    expect(crashed?.state).toBe('suspended')
    expect(crashed?.connection).toBeUndefined()
    const restarted = await host.restart('com.demo.hello')
    expect(restarted?.state).toBe('active')
    expect(restarted?.connection?.epoch).toBe(7) // 切库后使用新 epoch
  })

  it('崩溃超过上限 → failed + 停用 + 自动 recover + safeMode', async () => {
    const b = backend()
    const host = makeHost(b)
    await host.start('com.demo.hello', '1.0.0')
    await host.reportCrash('com.demo.hello', 'crash1')
    await host.reportCrash('com.demo.hello', 'crash2')
    expect(host.isSafeMode()).toBe(false)
    const failed = await host.reportCrash('com.demo.hello', 'crash3')
    expect(failed?.state).toBe('failed')
    expect(b.deactivate).toHaveBeenCalledWith('com.demo.hello')
    expect(b.recover).toHaveBeenCalledWith('com.demo.hello')
    expect(host.isSafeMode()).toBe(true)
  })

  it('recover 未成功 → 保持 safeMode；自动 recover 可关闭', async () => {
    const b = backend({ recover: vi.fn(async () => ({ recovered: false, action: 'corrupt-no-fallback' })) })
    const host = makeHost(b)
    await host.start('com.demo.hello', '1.0.0')
    for (let i = 0; i < 4; i++) await host.reportCrash('com.demo.hello', `c${i}`)
    expect(host.isSafeMode()).toBe(true)
    const host2 = new PackageHost({
      backend: backend(),
      binding: () => ({ contextId: 'c', epoch: 1 }),
      maxCrashes: 1,
      autoRecover: false,
    })
    await host2.start('com.demo.hello', '1.0.0')
    await host2.reportCrash('com.demo.hello', 'x')
    await host2.reportCrash('com.demo.hello', 'y')
    expect(host2.isSafeMode()).toBe(false)
  })

  it('stop：会话 stopped + 停用资源；状态可订阅', async () => {
    const b = backend()
    const seen: string[] = []
    const host = makeHost(b)
    host.subscribe((s) => seen.push(s.state))
    await host.start('com.demo.hello', '1.0.0')
    await host.stop('com.demo.hello')
    expect(host.get('com.demo.hello')?.state).toBe('stopped')
    expect(b.deactivate).toHaveBeenCalledWith('com.demo.hello')
    expect(seen).toContain('starting')
    expect(seen).toContain('active')
    expect(seen).toContain('stopped')
  })

  it('运行期能力上限：信任等级裁剪后的能力才进入 Broker 连接', async () => {
    const host = new PackageHost({
      backend: backend(),
      binding: () => ({ contextId: 'ctx-A', epoch: 1 }),
      capabilityCeiling: (_packId, declared) => declared.filter((c) => c !== 'ui.shell'),
    })
    const session = await host.start('com.demo.hello', '1.0.0')
    expect(session.connection?.capabilities).toEqual(['context.read'])
  })

  it('无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/packs/packageHost.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
