/**
 * UI 工坊 P4-T24：包签名**公钥信任根**（Keyring）——内置密钥清单/轮换重叠/撤销/过期。
 *
 * - 信任根是宿主内置/签发的 ed25519 公钥集合，按 keyId 查找；支持多把**同时有效**（轮换重叠期），
 *   撤销（revokedAt）后旧签名立即失效；到期（expiresAt）同样失效；
 * - `verifyWithKeyring` 组合 T24 的 `verifyPackSignature`：未知密钥/已撤销/已过期/验签失败 → invalid；
 *   无签名 → missing；返回结构化原因（供安装预览/信任策略/诊断）。
 * - 本模块只做「信任根判定」，不含密钥分发/轮换操作流程（T24 后续/Rust 产品化）。
 *
 * 无 DOM/React 依赖。
 */
import type { PackManifest } from './manifest'
import { parseHex, verifyPackSignature, type Ed25519VerifyFn, type SignatureStatus, type SignatureVerification } from './signature'

export interface PackKeyringEntry {
  keyId: string
  /** raw ed25519 公钥（32 bytes）或 hex（64 hex chars） */
  publicKey: Uint8Array | string
  /** 撤销时间（ISO 字符串或 epoch ms）；撤销后任何签名都失效 */
  revokedAt?: string | number
  /** 过期时间（ISO 字符串或 epoch ms）；到期后失效 */
  expiresAt?: string | number
  /** 备注（审计用） */
  note?: string
}

export interface PackKeyringOptions {
  now?: () => number
}

function toMs(value: string | number | undefined): number | null {
  if (value === undefined) return null
  if (typeof value === 'number') return value
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function keyBytes(entry: PackKeyringEntry): Uint8Array | null {
  if (entry.publicKey instanceof Uint8Array) return entry.publicKey.length === 32 ? entry.publicKey : null
  const parsed = parseHex(entry.publicKey)
  return parsed && parsed.length === 32 ? parsed : null
}

export class PackKeyring {
  private readonly entries = new Map<string, PackKeyringEntry>()
  private readonly now: () => number

  constructor(entries: PackKeyringEntry[] = [], options: PackKeyringOptions = {}) {
    this.now = options.now ?? Date.now
    for (const entry of entries) {
      if (!entry.keyId) continue
      this.entries.set(entry.keyId, entry)
    }
  }

  list(): PackKeyringEntry[] {
    return [...this.entries.values()]
  }

  /** 当前可用的 keyId（未撤销/未过期/公钥合法）。 */
  activeKeyIds(): string[] {
    const now = this.now()
    return [...this.entries.values()]
      .filter((e) => keyBytes(e) !== null && !this.isRevoked(e, now) && !this.isExpired(e, now))
      .map((e) => e.keyId)
  }

  private isRevoked(entry: PackKeyringEntry, now: number): boolean {
    const revoked = toMs(entry.revokedAt)
    return revoked !== null && now >= revoked
  }

  private isExpired(entry: PackKeyringEntry, now: number): boolean {
    const expires = toMs(entry.expiresAt)
    return expires !== null && now >= expires
  }

  /** 组合验签：无签名 missing；未知/撤销/过期 → invalid（带结构化原因）；否则用签名内 keyId 的密钥验签。 */
  async verify(
    manifest: PackManifest,
    signature: Parameters<typeof verifyPackSignature>[0]['signature'],
    verifyFn?: Ed25519VerifyFn,
  ): Promise<SignatureVerification> {
    if (!signature) return { status: 'missing' }
    const entry = this.entries.get(signature.keyId)
    if (!entry) return { status: 'invalid', keyId: signature.keyId, reason: `E_SIGNATURE_KEY: 未知密钥 ${signature.keyId}` }
    const now = this.now()
    if (this.isRevoked(entry, now)) {
      return { status: 'invalid', keyId: signature.keyId, reason: `E_SIGNATURE_REVOKED: 密钥已撤销 ${signature.keyId}` }
    }
    if (this.isExpired(entry, now)) {
      return { status: 'invalid', keyId: signature.keyId, reason: `E_SIGNATURE_EXPIRED: 密钥已过期 ${signature.keyId}` }
    }
    const bytes = keyBytes(entry)
    if (!bytes) return { status: 'invalid', keyId: signature.keyId, reason: 'E_SIGNATURE_KEY: 公钥格式非法' }
    return await verifyPackSignature({ manifest, signature, publicKeys: { [signature.keyId]: bytes } }, verifyFn)
  }

  /** 便捷：返回签名状态字符串（valid/missing/invalid），供安装预览使用。 */
  async status(
    manifest: PackManifest,
    signature: Parameters<typeof verifyPackSignature>[0]['signature'],
    verifyFn?: Ed25519VerifyFn,
  ): Promise<SignatureStatus> {
    return (await this.verify(manifest, signature, verifyFn)).status
  }
}

/**
 * 首发内置信任根（当前为空：产品尚未签发发布密钥）。
 * 产品化时在此登记发布公钥（keyId 与打包器一致），并按轮换计划保留重叠期。
 */
export const BUILTIN_PACK_KEYRING: PackKeyringEntry[] = []
