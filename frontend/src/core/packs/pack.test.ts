/** UI 工坊 T17：包清单校验 + 安装事务/回滚/损坏恢复（内存 FS，逐字节可复现）。 */
import { describe, expect, it } from 'vitest'

import { PACK_API_VERSION, PackValidationError, validateManifest, type PackManifest } from './manifest'
import { MemoryPackFs, PackStore, type PackHasher } from './store'

/** 测试用确定性 hasher（64 hex）；与 fakeHash 一一对应。 */
const fakeHash: PackHasher = async (bytes) => {
  let h = 2166136261
  for (const b of bytes) h = ((h ^ b) * 16777619) >>> 0
  return h.toString(16).padStart(8, '0').repeat(8)
}

const enc = new TextEncoder()

async function buildManifest(overrides: Partial<PackManifest> = {}): Promise<{ manifest: PackManifest; files: Record<string, Uint8Array> }> {
  const files = { 'index.html': enc.encode('<html><body>pack</body></html>'), 'sdk.js': enc.encode('export const x = 1') }
  const base: PackManifest = {
    id: 'com.demo.hello',
    name: 'Hello Pack',
    version: '1.0.0',
    apiVersion: PACK_API_VERSION,
    capabilities: ['ui.shell', 'context.read'],
    entry: { html: 'index.html', sdk: 'sdk.js' },
    commands: [{ name: 'demo.hello', handler: 'hello' }],
    assets: [
      { path: 'index.html', sha256: await fakeHash(files['index.html']) },
      { path: 'sdk.js', sha256: await fakeHash(files['sdk.js']) },
    ],
    ...overrides,
  }
  return { manifest: base, files }
}

describe('T17 manifest 校验（候选扫描与无损拒绝）', () => {
  it('合法清单通过，路径归一化', async () => {
    const { manifest } = await buildManifest()
    const v = validateManifest(JSON.parse(JSON.stringify(manifest)))
    expect(v.id).toBe('com.demo.hello')
    expect(v.entry.html).toBe('index.html')
  })

  it('非法路径（穿越/绝对）→ E_PATH', async () => {
    const { manifest } = await buildManifest({ assets: [{ path: '../evil.js', sha256: 'a'.repeat(64) }] })
    expect(() => validateManifest(manifest)).toThrow(PackValidationError)
    try {
      validateManifest(manifest)
    } catch (e) {
      expect((e as PackValidationError).code).toBe('E_PATH')
    }
  })

  it('未知能力 → E_CAPABILITY；超集能力不静默降级', async () => {
    const { manifest } = await buildManifest({ capabilities: ['ui.shell', 'system.exec' as never] })
    try {
      validateManifest(manifest)
      throw new Error('应当拒绝')
    } catch (e) {
      expect((e as PackValidationError).code).toBe('E_CAPABILITY')
    }
  })

  it('apiVersion 不兼容 → E_API_VERSION', async () => {
    const { manifest } = await buildManifest({ apiVersion: 99 })
    try {
      validateManifest(manifest)
      throw new Error('应当拒绝')
    } catch (e) {
      expect((e as PackValidationError).code).toBe('E_API_VERSION')
    }
  })

  it('资产哈希格式/entry 不在 assets → 拒绝', async () => {
    const { manifest } = await buildManifest({ assets: [{ path: 'index.html', sha256: 'bad' }] })
    expect(() => validateManifest(manifest)).toThrow()
    const { manifest: m2 } = await buildManifest({ entry: { html: 'missing.html' } })
    try {
      validateManifest(m2)
      throw new Error('应当拒绝')
    } catch (e) {
      expect((e as PackValidationError).code).toBe('E_ENTRY')
    }
  })
})

describe('T17 安装事务 / 回滚 / 损坏恢复', () => {
  it('安装成功：不可变目录 + 单提交点 state + journal 清理', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const { manifest, files } = await buildManifest()
    const st = await store.install(manifest, files)
    expect(st.active).toBe('1.0.0')
    expect(await store.verify('com.demo.hello', '1.0.0')).toBe(true)
    expect(await fs.exists('packs/com.demo.hello/txn.json')).toBe(false)
    expect(await fs.exists('packs/com.demo.hello/1.0.0/manifest.json')).toBe(true)
    // staging 清理
    expect((await fs.listDir('packs/com.demo.hello')).some((n) => n.startsWith('.staging'))).toBe(false)
  })

  it('资产哈希不匹配 → 无损拒绝（不写版本目录、state 不变）', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const { manifest, files } = await buildManifest()
    const bad = { ...files, 'sdk.js': enc.encode('tampered') }
    await expect(store.install(manifest, bad)).rejects.toThrow(/E_HASH/)
    expect(await fs.exists('packs/com.demo.hello/1.0.0')).toBe(false)
    expect((await store.state('com.demo.hello')).active).toBeNull()
    expect((await fs.listDir('packs/com.demo.hello')).some((n) => n.startsWith('.staging'))).toBe(false)
  })

  it('重复安装同版本 → E_DUPLICATE，旧状态保持', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const { manifest, files } = await buildManifest()
    await store.install(manifest, files)
    await expect(store.install(manifest, files)).rejects.toThrow(/E_DUPLICATE/)
    expect((await store.state('com.demo.hello')).active).toBe('1.0.0')
  })

  it('升级保留 previous；回滚交换 active/previous', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const v1 = await buildManifest({ version: '1.0.0' })
    await store.install(v1.manifest, v1.files)
    const v2 = await buildManifest({ version: '2.0.0' })
    const st = await store.install(v2.manifest, v2.files)
    expect(st.active).toBe('2.0.0')
    expect(st.previous).toBe('1.0.0')
    const rb = await store.rollback('com.demo.hello')
    expect(rb.active).toBe('1.0.0')
    expect(rb.previous).toBe('2.0.0')
    expect(await store.verify('com.demo.hello', '1.0.0')).toBe(true)
  })

  it('无 previous 时回滚 → 报错', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const { manifest, files } = await buildManifest()
    await store.install(manifest, files)
    await expect(store.rollback('com.demo.hello')).rejects.toThrow(/E_ROLLBACK/)
  })

  it('安装中途 rename 失败（模拟崩溃）→ state 不变、staging/journal 可恢复清理', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const { manifest, files } = await buildManifest()
    fs.failOnRename = (_from, to) => to.endsWith('state.json.tmp') || to.endsWith('state.json')
    await expect(store.install(manifest, files)).rejects.toThrow(/E_IO/)
    fs.failOnRename = undefined
    expect((await store.state('com.demo.hello')).active).toBeNull()
    const rec = await store.recover('com.demo.hello')
    expect(rec.state.active).toBeNull()
    expect((await fs.listDir('packs/com.demo.hello')).some((n) => n.startsWith('.staging'))).toBe(false)
    expect(await fs.exists('packs/com.demo.hello/txn.json')).toBe(false)
    // 恢复后可重新安装
    const ok = await store.install(manifest, files)
    expect(ok.active).toBe('1.0.0')
  })

  it('active 损坏 + previous 可用 → recover 自动回滚到 previous', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const v1 = await buildManifest({ version: '1.0.0' })
    await store.install(v1.manifest, v1.files)
    const v2 = await buildManifest({ version: '2.0.0' })
    await store.install(v2.manifest, v2.files)
    // 篡改 active 版本内资产（模拟磁盘损坏）
    await fs.writeBytes('packs/com.demo.hello/2.0.0/index.html', enc.encode('corrupted'))
    expect(await store.verify('com.demo.hello', '2.0.0')).toBe(false)
    const rec = await store.recover('com.demo.hello')
    expect(rec.recovered).toBe(true)
    expect(rec.action).toBe('rollback-corrupt-active')
    expect(rec.state.active).toBe('1.0.0')
    expect(await store.verify('com.demo.hello', '1.0.0')).toBe(true)
  })

  it('激活损坏版本 → E_HASH 拒绝，状态保持', async () => {
    const fs = new MemoryPackFs()
    const store = new PackStore(fs, fakeHash)
    const v1 = await buildManifest({ version: '1.0.0' })
    await store.install(v1.manifest, v1.files)
    const v2 = await buildManifest({ version: '2.0.0' })
    await store.install(v2.manifest, v2.files)
    await fs.writeBytes('packs/com.demo.hello/1.0.0/sdk.js', enc.encode('bad'))
    await expect(store.activate('com.demo.hello', '1.0.0')).rejects.toThrow(/E_HASH/)
    expect((await store.state('com.demo.hello')).active).toBe('2.0.0')
  })

  it('包层无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    for (const f of ['manifest.ts', 'store.ts']) {
      const raw = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(src).not.toMatch(/document\./)
      expect(src).not.toMatch(/window\./)
      expect(src).not.toMatch(/from ['"]react['"]/)
    }
  })
})
