/**
 * UI 工坊 P4-T24（续）：包签名验证 Core —— Ed25519 + 公钥注入。
 *
 * - 签名载荷 = **清单规范化 JSON**（字段排序、仅签名覆盖字段），资产完整性由清单内 sha256 保证；
 * - 验签函数可注入（默认 WebCrypto Ed25519；测试/宿主可用其它实现）；
 * - 结果三态：`valid` / `missing` / `invalid`（未知 keyId、验签失败、解析失败均 invalid 并给 reason），
 *   供 T22 安装预览 / T24 信任策略直接使用（不抛异常，缺失≠通过）。
 *
 * 无 DOM/React 依赖。
 */
import type { PackManifest } from './manifest'

export interface PackSignature {
  alg: 'ed25519'
  keyId: string
  /** 签名 hex（小写，128 hex chars = 64 bytes） */
  signature: string
}

export type SignatureStatus = 'valid' | 'missing' | 'invalid'

export interface SignatureVerification {
  status: SignatureStatus
  keyId?: string
  reason?: string
}

export type Ed25519VerifyFn = (payload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => Promise<boolean>

/** 默认：WebCrypto Ed25519 验签（Node ≥20 / 现代浏览器）。 */
export const webCryptoEd25519Verify: Ed25519VerifyFn = async (payload, signature, publicKey) => {
  const key = await globalThis.crypto.subtle.importKey('raw', publicKey as unknown as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'])
  return await globalThis.crypto.subtle.verify('Ed25519', key, signature as unknown as ArrayBuffer, payload as unknown as ArrayBuffer)
}

/** 规范化签名载荷：字段固定顺序 + UTF-8 JSON（不含 signature 自身）。 */
export function canonicalManifestPayload(manifest: PackManifest): Uint8Array {
  const canonical = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    capabilities: [...manifest.capabilities],
    entry: { html: manifest.entry.html, sdk: manifest.entry.sdk ?? null },
    commands: (manifest.commands ?? []).map((c) => ({ name: c.name, handler: c.handler })),
    assets: manifest.assets.map((a) => ({ path: a.path, sha256: a.sha256, size: a.size ?? null })),
  }
  return new TextEncoder().encode(JSON.stringify(canonical))
}

export function parseHex(value: string): Uint8Array | null {
  const hex = value.trim().toLowerCase()
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export interface VerifyPackSignatureInput {
  manifest: PackManifest
  signature?: PackSignature | null
  /** keyId → 公钥（raw 32 bytes） */
  publicKeys: Record<string, Uint8Array>
}

/** 校验包签名（不抛异常；任何异常都映射为 invalid + reason）。 */
export async function verifyPackSignature(
  input: VerifyPackSignatureInput,
  verifyFn: Ed25519VerifyFn = webCryptoEd25519Verify,
): Promise<SignatureVerification> {
  const sig = input.signature
  if (!sig) return { status: 'missing' }
  if (sig.alg !== 'ed25519') return { status: 'invalid', keyId: sig.keyId, reason: `E_SIGNATURE_ALG: 不支持的算法 ${String(sig.alg)}` }
  const publicKey = input.publicKeys[sig.keyId]
  if (!publicKey) return { status: 'invalid', keyId: sig.keyId, reason: `E_SIGNATURE_KEY: 未知密钥 ${sig.keyId}` }
  const signatureBytes = parseHex(sig.signature)
  if (!signatureBytes) return { status: 'invalid', keyId: sig.keyId, reason: 'E_SIGNATURE_FORMAT: 签名不是合法 hex' }
  try {
    const ok = await verifyFn(canonicalManifestPayload(input.manifest), signatureBytes, publicKey)
    return ok ? { status: 'valid', keyId: sig.keyId } : { status: 'invalid', keyId: sig.keyId, reason: 'E_SIGNATURE: 验签失败' }
  } catch (e) {
    return { status: 'invalid', keyId: sig.keyId, reason: `E_SIGNATURE: ${String((e as Error)?.message ?? e)}` }
  }
}
