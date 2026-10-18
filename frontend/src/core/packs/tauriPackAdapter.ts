/**
 * UI 工坊 P3-T21/T23：产品 Tauri 包命令 → WorkshopAdapter 适配器。
 *
 * 产品实现（desktop/src-tauri/src/pack_store.rs）：workshop_pack_scan/install/list/verify/
 * activate/rollback/recover。本适配器只做**调用与视图映射**；安装确认语义由 UI 显式点击触发
 * （扫描/预览不写盘，confirm 才 install）。
 */
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

import type { InstalledPackView, InstallPreviewView, RecoverAllView, RecoverResultView, WorkshopAdapter } from '../../components/workshop/WorkshopPanel'
import { capabilityRisk } from './installPolicy'
import { LocalTrustStore, defaultTrustStorage } from './localTrustStore'
import type { KeyValueStorage } from './localTrustStore'
import type { TrustStore, TrustTier } from './trustPolicy'

export interface TauriPackAdapterOptions {
  invokeImpl?: typeof invoke
  /** 信任等级持久化（默认 localStorage；测试可注入内存） */
  trustStore?: TrustStore
  trustStorage?: KeyValueStorage
  /** 选择本地包目录（默认使用 Tauri dialog 插件选择目录；测试可注入替身） */
  chooseSourceDir?: () => Promise<string | null>
}

type SignatureStatus = 'valid' | 'missing' | 'invalid'

interface ScanResponse {
  packId: string
  name: string
  version: string
  apiVersion: number
  capabilities: string[]
  commands?: unknown[]
  sizeBytes?: number
  blocked?: boolean
  signatureStatus?: SignatureStatus
  signatureReason?: string
}

interface ListResponse {
  packs: Array<{
    id: string
    name: string
    active: string | null
    previous: string | null
    activeVersion: string
    capabilities: string[]
    signatureStatus?: SignatureStatus
    signatureReason?: string | null
  }>
}

function err(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

/** 默认目录选择：Tauri dialog 插件（目录选择，单选）。 */
export async function choosePackDirectory(): Promise<string | null> {
  const selected = await openDialog({ directory: true, multiple: false, title: '选择 UI 工坊包目录（含 manifest.json）' })
  return typeof selected === 'string' ? selected : null
}

export function createTauriPackAdapter(options: TauriPackAdapterOptions = {}): WorkshopAdapter {
  const call = options.invokeImpl ?? invoke
  const chooseSourceDir = options.chooseSourceDir ?? choosePackDirectory
  const trustStore: TrustStore = options.trustStore ?? new LocalTrustStore(options.trustStorage ?? defaultTrustStorage())
  return {
    async listInstalled(): Promise<InstalledPackView[]> {
      try {
        const res = (await call('workshop_pack_list')) as ListResponse
        return (res.packs ?? []).map((p) => ({
          id: p.id,
          name: p.name || p.id,
          version: p.activeVersion || p.active || '',
          active: !!p.active && p.active === p.activeVersion,
          previous: p.previous,
          capabilities: p.capabilities ?? [],
          signature: p.signatureStatus,
        }))
      } catch (e) {
        throw err(e)
      }
    },
    async stageFromFile(): Promise<InstallPreviewView | null> {
      const dir = await chooseSourceDir()
      if (!dir) return null
      let scan: ScanResponse
      try {
        scan = (await call('workshop_pack_scan', { sourceDir: dir })) as ScanResponse
      } catch (e) {
        throw err(e)
      }
      const signature: SignatureStatus = scan.signatureStatus ?? 'missing'
      const signatureInvalid = signature === 'invalid'
      return {
        token: dir,
        packId: scan.packId,
        name: scan.name,
        version: scan.version,
        apiVersion: scan.apiVersion,
        source: 'local-file',
        signature,
        capabilities: (scan.capabilities ?? []).map((cap) => {
          const risk = capabilityRisk(cap)
          return { capability: risk.capability, risk: risk.risk, summary: risk.summary }
        }),
        warnings: signatureInvalid
          ? ['签名无效：安装将被拒绝']
          : ['本地目录包：请确认来源可信（sha256 由包清单限定）'],
        blocked: scan.blocked === true || signatureInvalid,
        blockReason: signatureInvalid
          ? (scan.signatureReason ?? 'E_SIGNATURE: 包签名无效，禁止安装')
          : scan.blocked
            ? (scan.signatureReason ?? 'E_SIGNATURE: 该包被阻止安装')
            : undefined,
      }
    },
    async confirmInstall(token: string): Promise<void> {
      try {
        await call('workshop_pack_install', { sourceDir: token })
      } catch (e) {
        throw err(e)
      }
    },
    cancelPreview(): boolean {
      return true // 扫描/预览无服务端状态，取消即丢弃 UI token
    },
    async rollback(packId: string): Promise<void> {
      try {
        await call('workshop_pack_rollback', { id: packId })
      } catch (e) {
        throw err(e)
      }
    },
    async tierOf(packId: string): Promise<TrustTier> {
      return await trustStore.tierOf(packId)
    },
    async grantTrust(packId: string, tier: TrustTier): Promise<void> {
      await trustStore.grant(packId, tier)
    },
    async revokeTrust(packId: string): Promise<void> {
      await trustStore.revoke(packId)
    },
    async uninstall(packId: string): Promise<void> {
      try {
        await call('workshop_pack_uninstall', { id: packId })
      } catch (e) {
        throw err(e)
      }
    },
    async recoverAll(): Promise<RecoverAllView> {
      try {
        const res = (await call('workshop_pack_recover_all')) as { checked?: number; safeMode?: boolean; results?: unknown }
        return { checked: Number(res.checked ?? 0), safeMode: !!res.safeMode, results: res.results }
      } catch (e) {
        throw err(e)
      }
    },
    async recover(packId: string): Promise<RecoverResultView> {
      try {
        const res = (await call('workshop_pack_recover', { id: packId })) as { recovered: boolean; action: string }
        return { recovered: !!res.recovered, action: String(res.action ?? 'clean') }
      } catch (e) {
        throw err(e)
      }
    },
  }
}
