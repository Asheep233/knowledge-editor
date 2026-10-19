/** UI 工坊 T24：可信包限定 — 信任等级/签名策略/能力上限/持久化（Core 单测）。 */
import { describe, expect, it } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import { MemoryTrustStore, evaluateStoredTrust, evaluateTrust } from './trustPolicy'

const MANIFEST: PackManifest = {
  id: 'com.demo.hello',
  name: 'Hello',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell', 'panel.sidebar', 'context.read'],
  entry: { html: 'index.html' },
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

describe('T24 信任策略（安装期）', () => {
  it('签名无效 → 阻止（任何等级）', () => {
    const d = evaluateTrust({ manifest: MANIFEST, source: 'builtin', signature: 'invalid', tier: 'builtin' })
    expect(d.allowed).toBe(false)
    expect(d.violations.join(' ')).toMatch(/E_SIGNATURE/)
  })

  it('下载未签名 → 阻止（默认策略）；本地未签名允许', () => {
    expect(evaluateTrust({ manifest: MANIFEST, source: 'downloaded', signature: 'missing', tier: 'trusted' }).allowed).toBe(false)
    expect(evaluateTrust({ manifest: MANIFEST, source: 'local-file', signature: 'missing', tier: 'trusted' }).allowed).toBe(true)
  })

  it('community 等级不允许 ui.shell/context.read → 阻止（不是静默裁剪）', () => {
    const d = evaluateTrust({ manifest: MANIFEST, source: 'local-file', signature: 'valid', tier: 'community' })
    expect(d.allowed).toBe(false)
    expect(d.violations.join(' ')).toMatch(/E_CAPABILITY_TIER/)
    expect(d.effectiveCapabilities).toEqual(['panel.sidebar'])
  })

  it('trusted 等级允许 ui.shell/context.read；builtin 全允许', () => {
    const trusted = evaluateTrust({ manifest: MANIFEST, source: 'local-file', signature: 'valid', tier: 'trusted' })
    expect(trusted.allowed).toBe(true)
    expect(trusted.effectiveCapabilities).toEqual(['ui.shell', 'panel.sidebar', 'context.read'])
    const builtin = evaluateTrust({ manifest: MANIFEST, source: 'builtin', signature: 'missing', tier: 'builtin' })
    expect(builtin.allowed).toBe(true)
    expect(builtin.requiresExplicitConfirm).toBe(false)
  })

  it('trusted 等级能力超过上限 → 阻止并列出违规能力', () => {
    const rich: PackManifest = { ...MANIFEST, capabilities: ['ui.shell', 'editor.commands.readonly'] }
    const d = evaluateTrust({ manifest: rich, source: 'local-file', signature: 'valid', tier: 'community' })
    expect(d.allowed).toBe(false)
    expect(d.violations[0]).toContain('ui.shell')
  })

  it('context.write（T26 G2）只授予 trusted/builtin，community 拒绝（不是静默裁剪）', () => {
    const writeManifest: PackManifest = { ...MANIFEST, capabilities: ['context.write'] }
    const community = evaluateTrust({ manifest: writeManifest, source: 'local-file', signature: 'valid', tier: 'community' })
    expect(community.allowed).toBe(false)
    expect(community.violations.join(' ')).toMatch(/E_CAPABILITY_TIER/)
    expect(community.violations.join(' ')).toMatch(/context\.write/)
    expect(community.effectiveCapabilities).toEqual([])

    const trusted = evaluateTrust({ manifest: writeManifest, source: 'local-file', signature: 'valid', tier: 'trusted' })
    expect(trusted.allowed).toBe(true)
    expect(trusted.effectiveCapabilities).toEqual(['context.write'])

    const builtin = evaluateTrust({ manifest: writeManifest, source: 'builtin', signature: 'missing', tier: 'builtin' })
    expect(builtin.allowed).toBe(true)
    expect(builtin.effectiveCapabilities).toEqual(['context.write'])
  })

  it('显式确认策略：builtin+有效签名不需要；其它需要', () => {
    expect(evaluateTrust({ manifest: MANIFEST, source: 'builtin', signature: 'valid', tier: 'builtin' }).requiresExplicitConfirm).toBe(false)
    expect(evaluateTrust({ manifest: MANIFEST, source: 'local-file', signature: 'valid', tier: 'trusted' }).requiresExplicitConfirm).toBe(true)
  })
})

describe('T24 信任授权持久化（TrustStore）', () => {
  it('默认 community；grant/revoke 生效并持久化列表', async () => {
    const store = new MemoryTrustStore()
    expect(await store.tierOf('com.demo.hello')).toBe('community')
    await store.grant('com.demo.hello', 'trusted')
    expect(await store.tierOf('com.demo.hello')).toBe('trusted')
    expect(await store.list()).toEqual([{ packId: 'com.demo.hello', tier: 'trusted' }])
    await store.revoke('com.demo.hello')
    expect(await store.tierOf('com.demo.hello')).toBe('community')
    expect(await store.list()).toEqual([])
  })

  it('evaluateStoredTrust 使用持久化等级 + 能力上限（运行期交集）', async () => {
    const store = new MemoryTrustStore()
    const denied = await evaluateStoredTrust(store, { manifest: MANIFEST, source: 'local-file', signature: 'valid' })
    expect(denied.allowed).toBe(false) // 默认 community 不允许 ui.shell
    await store.grant('com.demo.hello', 'trusted')
    const allowed = await evaluateStoredTrust(store, { manifest: MANIFEST, source: 'local-file', signature: 'valid' })
    expect(allowed.allowed).toBe(true)
    expect(allowed.effectiveCapabilities).toEqual(MANIFEST.capabilities)
  })

  it('无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/packs/trustPolicy.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
