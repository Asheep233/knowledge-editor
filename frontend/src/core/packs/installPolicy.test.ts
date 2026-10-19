/** UI 工坊 T22：安装预览/风险说明/显式确认门禁（Core，无 UI）。 */
import { describe, expect, it } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import { PendingInstallGate, buildInstallPreview } from './installPolicy'
import { MemoryPackFs, type PackHasher } from './store'

const fakeHash: PackHasher = async (bytes) => {
  let h = 2166136261
  for (const b of bytes) h = ((h ^ b) * 16777619) >>> 0
  return h.toString(16).padStart(8, '0').repeat(8)
}

const enc = new TextEncoder()

async function fixture(overrides: Partial<PackManifest> = {}) {
  const files = { 'index.html': enc.encode('<html>pack</html>') }
  const manifest: PackManifest = {
    id: 'com.demo.hello',
    name: 'Hello Pack',
    version: '1.0.0',
    apiVersion: PACK_API_VERSION,
    capabilities: ['ui.shell', 'context.read'],
    entry: { html: 'index.html' },
    commands: [{ name: 'demo.hello', handler: 'hello' }],
    assets: [{ path: 'index.html', sha256: await fakeHash(files['index.html']) }],
    ...overrides,
  }
  return { manifest, files }
}

describe('T22 安装预览与能力风险说明', () => {
  it('预览包含身份/来源/版本/能力风险/warnings，且必须显式确认', async () => {
    const { manifest } = await fixture()
    const preview = buildInstallPreview({ manifest, source: 'local-file', signature: 'valid', sizeBytes: 4096 })
    expect(preview.packId).toBe('com.demo.hello')
    expect(preview.requiresExplicitConfirm).toBe(true)
    expect(preview.blocked).toBe(false)
    expect(preview.capabilities.map((c) => c.capability)).toEqual(['ui.shell', 'context.read'])
    expect(preview.capabilities.find((c) => c.capability === 'ui.shell')?.risk).toBe('medium')
    expect(preview.warnings.join(' ')).toMatch(/本地文件包/)
    expect(preview.warnings.join(' ')).toMatch(/demo\.hello/)
  })

  it('context.write（T26 G2）风险为 high，并触发高影响能力警告', async () => {
    const { manifest } = await fixture({ capabilities: ['context.write'] })
    const preview = buildInstallPreview({ manifest, source: 'local-file', signature: 'valid' })
    expect(preview.capabilities).toEqual([
      expect.objectContaining({ capability: 'context.write', risk: 'high' }),
    ])
    expect(preview.warnings.join(' ')).toMatch(/高影响能力/)
  })

  it('签名无效 → 阻止安装（不是警告后继续）', async () => {
    const { manifest } = await fixture()
    const preview = buildInstallPreview({ manifest, source: 'downloaded', signature: 'invalid' })
    expect(preview.blocked).toBe(true)
    expect(preview.blockReason).toMatch(/E_SIGNATURE/)
  })

  it('下载未签名 → 明确警告（需用户确认）', async () => {
    const { manifest } = await fixture()
    const preview = buildInstallPreview({ manifest, source: 'downloaded', signature: 'missing' })
    expect(preview.blocked).toBe(false)
    expect(preview.warnings.join(' ')).toMatch(/未签名/)
  })
})

describe('T22 显式确认门禁（PendingInstallGate）', () => {
  it('stage 不产生任何安装副作用', async () => {
    const fs = new MemoryPackFs()
    const gate = new PendingInstallGate({ fs, hash: fakeHash })
    const { manifest, files } = await fixture()
    const staged = gate.stage(manifest, files, { source: 'local-file', signature: 'valid' })
    expect(staged.token).toBeTruthy()
    expect(await fs.exists('packs/com.demo.hello/1.0.0')).toBe(false)
    expect(gate.pending()).toHaveLength(1)
  })

  it('confirm 触发安装且 token 一次性（重复 confirm 拒绝）', async () => {
    const fs = new MemoryPackFs()
    const gate = new PendingInstallGate({ fs, hash: fakeHash })
    const { manifest, files } = await fixture()
    const staged = gate.stage(manifest, files, { source: 'local-file', signature: 'valid' })
    const state = await gate.confirm(staged.token)
    expect(state.active).toBe('1.0.0')
    expect(await fs.exists('packs/com.demo.hello/1.0.0/index.html')).toBe(true)
    await expect(gate.confirm(staged.token)).rejects.toThrow(/E_CONFIRM/)
  })

  it('blocked 预览禁止 confirm（签名无效）', async () => {
    const fs = new MemoryPackFs()
    const gate = new PendingInstallGate({ fs, hash: fakeHash })
    const { manifest, files } = await fixture()
    const staged = gate.stage(manifest, files, { source: 'downloaded', signature: 'invalid' })
    await expect(gate.confirm(staged.token)).rejects.toThrow(/E_SIGNATURE/)
    expect(await fs.exists('packs/com.demo.hello')).toBe(false)
  })

  it('cancel 丢弃预览且不安装', async () => {
    const fs = new MemoryPackFs()
    const gate = new PendingInstallGate({ fs, hash: fakeHash })
    const { manifest, files } = await fixture()
    const staged = gate.stage(manifest, files, { source: 'local-file', signature: 'valid' })
    expect(gate.cancel(staged.token)).toBe(true)
    expect(gate.pending()).toHaveLength(0)
    await expect(gate.confirm(staged.token)).rejects.toThrow(/E_CONFIRM/)
    expect(await fs.exists('packs/com.demo.hello')).toBe(false)
  })

  it('预览过期 → confirm 拒绝（需重新预览）', async () => {
    const fs = new MemoryPackFs()
    let now = 1000
    const gate = new PendingInstallGate({ fs, hash: fakeHash, ttlMs: 100, now: () => now })
    const { manifest, files } = await fixture()
    const staged = gate.stage(manifest, files, { source: 'local-file', signature: 'valid' })
    now += 200
    await expect(gate.confirm(staged.token)).rejects.toThrow(/E_CONFIRM/)
  })

  it('预览与最终安装清单一致（写入 manifest.json 的 id/version/能力相同）', async () => {
    const fs = new MemoryPackFs()
    const gate = new PendingInstallGate({ fs, hash: fakeHash })
    const { manifest, files } = await fixture()
    const staged = gate.stage(manifest, files, { source: 'local-file', signature: 'valid' })
    await gate.confirm(staged.token)
    const installed = JSON.parse(new TextDecoder().decode((await fs.readBytes('packs/com.demo.hello/1.0.0/manifest.json'))!))
    expect(installed.id).toBe(staged.preview.packId)
    expect(installed.version).toBe(staged.preview.version)
    expect(installed.capabilities).toEqual(manifest.capabilities)
  })
})
