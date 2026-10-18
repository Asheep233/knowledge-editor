/** UI 工坊 T24：包签名公钥信任根（Keyring）——轮换重叠/撤销/过期/组合验签。 */
import { generateKeyPairSync, sign, verify as nodeVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import { PackKeyring, type PackKeyringEntry } from './keyring'
import { canonicalManifestPayload } from './signature'

const MANIFEST: PackManifest = {
  id: 'com.demo.kr',
  name: 'Keyring Demo',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell'],
  entry: { html: 'index.html' },
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

function makeKey(keyId: string): { entry: PackKeyringEntry; signHex: (p: Uint8Array) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))
  return {
    entry: { keyId, publicKey: raw },
    signHex: (payload: Uint8Array) => sign(null, payload, privateKey).toString('hex'),
  }
}

const nodeVerifyFn = async (payload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> => {
  const { createPublicKey } = await import('node:crypto')
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey)])
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
  try {
    return nodeVerify(null, Buffer.from(payload), key, Buffer.from(signature))
  } catch {
    return false
  }
}

function sig(keyId: string, signHex: (p: Uint8Array) => string) {
  return { alg: 'ed25519' as const, keyId, signature: signHex(canonicalManifestPayload(MANIFEST)) }
}

describe('T24 公钥信任根（Keyring）', () => {
  it('有效密钥 → valid；activeKeyIds 只含可用密钥', async () => {
    const k1 = makeKey('k1')
    const kr = new PackKeyring([k1.entry])
    expect(kr.activeKeyIds()).toEqual(['k1'])
    const res = await kr.verify(MANIFEST, sig('k1', k1.signHex), nodeVerifyFn)
    expect(res).toEqual({ status: 'valid', keyId: 'k1' })
    expect(await kr.status(MANIFEST, sig('k1', k1.signHex), nodeVerifyFn)).toBe('valid')
  })

  it('轮换重叠：新旧两把密钥同时有效，均可验签', async () => {
    const oldKey = makeKey('k-old')
    const newKey = makeKey('k-new')
    const kr = new PackKeyring([oldKey.entry, newKey.entry])
    expect(kr.activeKeyIds().sort()).toEqual(['k-new', 'k-old'])
    expect((await kr.verify(MANIFEST, sig('k-old', oldKey.signHex), nodeVerifyFn)).status).toBe('valid')
    expect((await kr.verify(MANIFEST, sig('k-new', newKey.signHex), nodeVerifyFn)).status).toBe('valid')
  })

  it('撤销后旧签名立即 invalid（E_SIGNATURE_REVOKED）', async () => {
    const k = makeKey('k1')
    const kr = new PackKeyring([{ ...k.entry, revokedAt: 1000 }], { now: () => 1001 })
    const res = await kr.verify(MANIFEST, sig('k1', k.signHex), nodeVerifyFn)
    expect(res.status).toBe('invalid')
    expect(res.reason).toMatch(/E_SIGNATURE_REVOKED/)
    expect(kr.activeKeyIds()).toEqual([])
  })

  it('过期后 invalid（E_SIGNATURE_EXPIRED）', async () => {
    const k = makeKey('k1')
    const kr = new PackKeyring([{ ...k.entry, expiresAt: '2026-01-01T00:00:00Z' }], { now: () => Date.parse('2026-06-01T00:00:00Z') })
    const res = await kr.verify(MANIFEST, sig('k1', k.signHex), nodeVerifyFn)
    expect(res.status).toBe('invalid')
    expect(res.reason).toMatch(/E_SIGNATURE_EXPIRED/)
  })

  it('未知密钥/无签名/公钥非法 → invalid/missing/invalid，不抛异常', async () => {
    const k = makeKey('k1')
    const kr = new PackKeyring([k.entry])
    expect((await kr.verify(MANIFEST, sig('unknown', k.signHex), nodeVerifyFn)).reason).toMatch(/E_SIGNATURE_KEY/)
    expect((await kr.verify(MANIFEST, null, nodeVerifyFn)).status).toBe('missing')
    const badKr = new PackKeyring([{ keyId: 'bad', publicKey: 'zz' }])
    expect((await badKr.verify(MANIFEST, sig('bad', k.signHex), nodeVerifyFn)).reason).toMatch(/公钥格式非法/)
  })

  it('篡改清单后签名失效（信任根不掩盖篡改）', async () => {
    const k = makeKey('k1')
    const kr = new PackKeyring([k.entry])
    const tampered = { ...MANIFEST, version: '9.9.9' }
    expect((await kr.verify(tampered, sig('k1', k.signHex), nodeVerifyFn)).status).toBe('invalid')
  })

  it('hex 公钥同样可用', async () => {
    const k = makeKey('k1')
    const hex = Buffer.from(k.entry.publicKey as Uint8Array).toString('hex')
    const kr = new PackKeyring([{ keyId: 'k1', publicKey: hex }])
    expect((await kr.verify(MANIFEST, sig('k1', k.signHex), nodeVerifyFn)).status).toBe('valid')
  })

  it('无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/packs/keyring.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
