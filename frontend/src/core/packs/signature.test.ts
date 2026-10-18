/** UI 工坊 T24：包签名验证 Core（Ed25519，注入验签实现；无 DOM）。 */
import { generateKeyPairSync, sign, verify as nodeVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from './manifest'
import { canonicalManifestPayload, parseHex, verifyPackSignature } from './signature'

const MANIFEST: PackManifest = {
  id: 'com.demo.signed',
  name: 'Signed Pack',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell'],
  entry: { html: 'index.html' },
  commands: [{ name: 'demo.hello', handler: 'hello' }],
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPub = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))
  const signHex = (payload: Uint8Array) => sign(null, payload, privateKey).toString('hex')
  return { rawPub, signHex }
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

describe('T24 包签名验证（Ed25519）', () => {
  it('有效签名 → valid', async () => {
    const { rawPub, signHex } = keypair()
    const signature = signHex(canonicalManifestPayload(MANIFEST))
    const res = await verifyPackSignature(
      { manifest: MANIFEST, signature: { alg: 'ed25519', keyId: 'k1', signature }, publicKeys: { k1: rawPub } },
      nodeVerifyFn,
    )
    expect(res).toEqual({ status: 'valid', keyId: 'k1' })
  })

  it('清单被篡改（能力/版本变化）→ invalid', async () => {
    const { rawPub, signHex } = keypair()
    const signature = signHex(canonicalManifestPayload(MANIFEST))
    const tampered: PackManifest = { ...MANIFEST, capabilities: ['ui.shell', 'context.read'] }
    const res = await verifyPackSignature(
      { manifest: tampered, signature: { alg: 'ed25519', keyId: 'k1', signature }, publicKeys: { k1: rawPub } },
      nodeVerifyFn,
    )
    expect(res.status).toBe('invalid')
    expect(res.reason).toMatch(/E_SIGNATURE/)
  })

  it('未知 keyId → invalid；无签名 → missing', async () => {
    const { rawPub, signHex } = keypair()
    const signature = signHex(canonicalManifestPayload(MANIFEST))
    const unknown = await verifyPackSignature(
      { manifest: MANIFEST, signature: { alg: 'ed25519', keyId: 'k-unknown', signature }, publicKeys: { k1: rawPub } },
      nodeVerifyFn,
    )
    expect(unknown.status).toBe('invalid')
    expect(unknown.reason).toMatch(/E_SIGNATURE_KEY/)
    expect((await verifyPackSignature({ manifest: MANIFEST, publicKeys: {} }, nodeVerifyFn)).status).toBe('missing')
  })

  it('非法签名格式/算法 → invalid（不抛异常）', async () => {
    const badHex = await verifyPackSignature(
      { manifest: MANIFEST, signature: { alg: 'ed25519', keyId: 'k1', signature: 'zz' }, publicKeys: { k1: new Uint8Array(32) } },
      nodeVerifyFn,
    )
    expect(badHex.status).toBe('invalid')
    expect(badHex.reason).toMatch(/E_SIGNATURE_FORMAT/)
    const badAlg = await verifyPackSignature(
      { manifest: MANIFEST, signature: { alg: 'rsa' as never, keyId: 'k1', signature: '00' }, publicKeys: { k1: new Uint8Array(32) } },
      nodeVerifyFn,
    )
    expect(badAlg.status).toBe('invalid')
    expect(badAlg.reason).toMatch(/E_SIGNATURE_ALG/)
  })

  it('验签实现抛错 → invalid（宿主不崩溃）', async () => {
    const { rawPub, signHex } = keypair()
    const signature = signHex(canonicalManifestPayload(MANIFEST))
    const res = await verifyPackSignature(
      { manifest: MANIFEST, signature: { alg: 'ed25519', keyId: 'k1', signature }, publicKeys: { k1: rawPub } },
      async () => {
        throw new Error('backend unavailable')
      },
    )
    expect(res.status).toBe('invalid')
    expect(res.reason).toMatch(/backend unavailable/)
  })

  it('canonicalManifestPayload 稳定（同内容不同键顺序 → 同字节）', () => {
    const a = canonicalManifestPayload(MANIFEST)
    const b = canonicalManifestPayload(JSON.parse(JSON.stringify({ ...MANIFEST })) as PackManifest)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('canonical 载荷与 Rust 侧契约逐字节一致（跨语言 parity）', () => {
    const expected =
      '{"id":"com.demo.signed","name":"Signed Pack","version":"1.0.0","apiVersion":1,' +
      '"capabilities":["ui.shell"],"entry":{"html":"index.html","sdk":null},' +
      '"commands":[{"name":"demo.hello","handler":"hello"}],' +
      '"assets":[{"path":"index.html","sha256":"' + 'a'.repeat(64) + '","size":null}]}'
    expect(new TextDecoder().decode(canonicalManifestPayload(MANIFEST))).toBe(expected)
  })

  it('parseHex 严格校验', () => {
    expect(parseHex('00ff')).toEqual(new Uint8Array([0, 255]))
    expect(parseHex('0')).toBeNull()
    expect(parseHex('zz')).toBeNull()
    expect(parseHex('')).toBeNull()
  })

  it('无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/packs/signature.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
