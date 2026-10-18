/**
 * UI 工坊 P4-T24/T23：前端 TrustStore 持久化实现（可注入 storage；产品=localStorage，测试=内存）。
 *
 * 注意：这是**过渡实现**（产品最终应放 Rust 设置/包元数据，随 T21/T24 产品化替换）；
 * 语义与 TrustStore 一致：默认 community；grant/revoke 写入；损坏 JSON 视为空（不阻断工坊）。
 */
import type { TrustStore, TrustTier } from './trustPolicy'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryKeyValueStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

const VALID_TIERS: TrustTier[] = ['builtin', 'trusted', 'community']

export class LocalTrustStore implements TrustStore {
  private readonly storage: KeyValueStorage
  private readonly key: string

  constructor(storage: KeyValueStorage, key = 'ke.workshop.trust') {
    this.storage = storage
    this.key = key
  }

  private read(): Map<string, TrustTier> {
    const out = new Map<string, TrustTier>()
    const raw = this.storage.getItem(this.key)
    if (!raw) return out
    try {
      const parsed = JSON.parse(raw) as Record<string, string>
      for (const [packId, tier] of Object.entries(parsed)) {
        if (VALID_TIERS.includes(tier as TrustTier)) out.set(packId, tier as TrustTier)
      }
    } catch {
      /* 损坏数据视为空，不阻断工坊 */
    }
    return out
  }

  private write(map: Map<string, TrustTier>): void {
    if (map.size === 0) {
      this.storage.removeItem(this.key)
      return
    }
    this.storage.setItem(this.key, JSON.stringify(Object.fromEntries(map)))
  }

  async tierOf(packId: string): Promise<TrustTier> {
    return this.read().get(packId) ?? 'community'
  }

  async grant(packId: string, tier: TrustTier): Promise<void> {
    const map = this.read()
    map.set(packId, tier)
    this.write(map)
  }

  async revoke(packId: string): Promise<void> {
    const map = this.read()
    map.delete(packId)
    this.write(map)
  }

  async list(): Promise<Array<{ packId: string; tier: TrustTier }>> {
    return [...this.read().entries()].map(([packId, tier]) => ({ packId, tier }))
  }
}

/** 默认 storage：浏览器 localStorage；不可用（测试/无 DOM）→ 内存。 */
export function defaultTrustStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStorage }).localStorage
    if (ls && typeof ls.getItem === 'function') return ls
  } catch {
    /* ignore */
  }
  return new MemoryKeyValueStorage()
}
