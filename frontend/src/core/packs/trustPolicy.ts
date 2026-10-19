/**
 * UI 工坊 P4-T24：可信包限定 — 信任等级/签名策略/能力上限/授权持久化（Core，无 UI）。
 *
 * 规则（与 TASK 包 P4「可信包限定」和 ARCHITECTURE 安全模型对齐）：
 * - 每个包有信任等级：`builtin`（内置，最高）/ `trusted`（用户显式授予）/ `community`（默认，最低）；
 * - 安装前 `evaluateTrust` 给出 blocked/violations；签名无效、下载未签名（按策略）→ 阻止；
 *   等级不允许的能力 → 阻止（不是静默裁剪，安装期直接拒绝，避免「能力被偷偷降级」）；
 * - 运行期 Broker 能力上限由等级决定：`capabilityCeiling` 供 PackageHost/Broker 构建连接时取交集
 *   （即使 manifest 声明更多能力，运行时也只能用等级允许的子集）；
 * - 用户授权（grant/revoke → tier）通过注入的 `TrustStore` 持久化（产品 = Rust 设置存储）。
 */
import type { PackManifest, PackCapability } from './manifest'
import type { SignatureStatus, PackSource } from './installPolicy'

export type TrustTier = 'builtin' | 'trusted' | 'community'

export interface TrustDecision {
  tier: TrustTier
  allowed: boolean
  violations: string[]
  /** 运行期允许的能力子集（等级 ∩ manifest 声明） */
  effectiveCapabilities: PackCapability[]
  requiresExplicitConfirm: boolean
}

export interface TrustPolicy {
  /** 下载未签名是否阻止（默认 true） */
  blockUnsignedDownloads?: boolean
  /** 各等级允许的能力（builtin 默认全部） */
  capabilitiesByTier?: Record<TrustTier, PackCapability[] | 'all'>
}

const ALL_CAPS: PackCapability[] = ['ui.shell', 'panel.sidebar', 'panel.dock', 'editor.commands.readonly', 'context.read', 'context.write', 'print.request']

const DEFAULT_POLICY: Required<TrustPolicy> = {
  blockUnsignedDownloads: true,
  capabilitiesByTier: {
    builtin: 'all',
    // T26 G2：文档写能力只授予 trusted/builtin（community 无真实写权限）。
    trusted: ['ui.shell', 'panel.sidebar', 'panel.dock', 'editor.commands.readonly', 'context.read', 'context.write', 'print.request'],
    community: ['panel.sidebar', 'panel.dock', 'print.request'],
  },
}

export interface TrustInput {
  manifest: PackManifest
  source: PackSource
  signature: SignatureStatus
  tier: TrustTier
}

export function evaluateTrust(input: TrustInput, policy: TrustPolicy = {}): TrustDecision {
  const cfg = { ...DEFAULT_POLICY, ...policy }
  const allowedList = cfg.capabilitiesByTier[input.tier]
  const ceiling: PackCapability[] = allowedList === 'all' ? [...ALL_CAPS] : [...allowedList]
  const violations: string[] = []
  if (input.signature === 'invalid') violations.push('E_SIGNATURE: 包签名无效')
  if (cfg.blockUnsignedDownloads && input.source === 'downloaded' && input.signature !== 'valid') {
    violations.push('E_UNSIGNED: 下载包未签名（策略阻止）')
  }
  const overCapabilities = input.manifest.capabilities.filter((cap) => !ceiling.includes(cap))
  if (overCapabilities.length > 0) {
    violations.push(`E_CAPABILITY_TIER: 信任等级 ${input.tier} 不允许能力 ${overCapabilities.join(', ')}`)
  }
  const effectiveCapabilities = input.manifest.capabilities.filter((cap) => ceiling.includes(cap))
  return {
    tier: input.tier,
    allowed: violations.length === 0,
    violations,
    effectiveCapabilities,
    requiresExplicitConfirm: input.tier !== 'builtin',
  }
}

/** 信任等级持久化（产品实现 = 设置/包元数据；测试 = 内存）。 */
export interface TrustStore {
  tierOf(packId: string): Promise<TrustTier>
  grant(packId: string, tier: TrustTier): Promise<void>
  revoke(packId: string): Promise<void>
  list(): Promise<Array<{ packId: string; tier: TrustTier }>>
}

export class MemoryTrustStore implements TrustStore {
  private readonly tiers = new Map<string, TrustTier>()

  async tierOf(packId: string): Promise<TrustTier> {
    return this.tiers.get(packId) ?? 'community'
  }

  async grant(packId: string, tier: TrustTier): Promise<void> {
    this.tiers.set(packId, tier)
  }

  async revoke(packId: string): Promise<void> {
    this.tiers.delete(packId)
  }

  async list(): Promise<Array<{ packId: string; tier: TrustTier }>> {
    return [...this.tiers.entries()].map(([packId, tier]) => ({ packId, tier }))
  }
}

/** 便捷：按持久化等级 + manifest/来源/签名评估运行期上限。 */
export async function evaluateStoredTrust(store: TrustStore, input: Omit<TrustInput, 'tier'>, policy: TrustPolicy = {}): Promise<TrustDecision> {
  const tier = await store.tierOf(input.manifest.id)
  return evaluateTrust({ ...input, tier }, policy)
}
