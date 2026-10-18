/**
 * UI 工坊 A7：产品壳 guest 宿主适配器（ADR-004）——把 Core PackageHost 接到产品 Tauri 命令。
 *
 * - readManifest / verify / deactivate / recover：映射产品 `workshop_pack_*` 命令；
 * - loadEntry：读取已安装包的 entry HTML 与声明的 css/js 资产（read_asset），
 *   按占位符 `{{STYLE}}`/`{{SCRIPT}}` 注入（无占位符则追加），供 sandbox iframe 使用；
 * - sessionStatus / reportSession：`workshop_pack_session_status/report`（app data 落盘）；
 * - isolationGuard：ADR-004 隔离守卫——验证 guest 是否继承 Tauri globals；
 * - capabilityCeilingFor：T24 信任等级 ∩ manifest 声明（运行期 Broker 能力上限）。
 *
 * 无 DOM/React 依赖（iframe/心跳宿主由 UI 组件负责）。
 */
import { invoke } from '@tauri-apps/api/core'

import { validateManifest, type PackManifest } from './manifest'
import type { PackageHostBackend } from './packageHost'
import { evaluateTrust, type TrustTier } from './trustPolicy'

export interface ProductHostAdapterOptions {
  invokeImpl?: typeof invoke
}

export interface LoadedPackEntry {
  html: string
  /** 已注入的额外资产（path → 内容，用于诊断/证据） */
  assets: Record<string, string>
}

export interface SessionStatus {
  state: 'idle' | 'starting' | 'active' | 'suspended' | 'failed' | 'stopped'
  packId?: string | null
  capabilities?: string[]
  lastError?: string | null
  updatedAt?: string | null
}

const WORKSHOP_ORIGIN = 'http://workshop.localhost'

export interface ProductHostBackend extends PackageHostBackend {
  loadEntry(manifest: PackManifest): Promise<LoadedPackEntry>
  /** A7：包入口的独立 origin URL（workshop 自定义协议；Windows 映射为 http://workshop.localhost） */
  entryUrl(manifest: PackManifest): string
  sessionStatus(): Promise<SessionStatus>
  reportSession(status: SessionStatus): Promise<SessionStatus>
}

export function createProductHostBackend(options: ProductHostAdapterOptions = {}): ProductHostBackend {
  const call = options.invokeImpl ?? invoke

  async function readAsset(packId: string, version: string, path: string): Promise<string> {
    return (await call('workshop_pack_read_asset', { id: packId, version, path })) as string
  }

  return {
    async verify(packId: string, version: string): Promise<boolean> {
      return (await call('workshop_pack_verify', { id: packId, version })) as boolean
    },
    async readManifest(packId: string, version: string): Promise<PackManifest> {
      const raw = await readAsset(packId, version, 'manifest.json')
      return validateManifest(JSON.parse(raw))
    },
    async deactivate(_packId: string): Promise<void> {
      // 产品侧 guest 为 webview 内 iframe，无独立进程需要停用；会话状态由宿主
      // onSessionChange → reportSession 负责（此处不得写 stopped，否则会覆盖 failed/safeMode 状态）。
    },
    async recover(packId: string): Promise<{ recovered: boolean; action: string }> {
      const result = (await call('workshop_pack_recover', { id: packId })) as { recovered?: boolean; action?: string }
      return { recovered: result?.recovered === true, action: result?.action ?? 'unknown' }
    },
    async loadEntry(manifest: PackManifest): Promise<LoadedPackEntry> {
      let html = await readAsset(manifest.id, manifest.version, manifest.entry.html)
      const assets: Record<string, string> = {}
      for (const asset of manifest.assets) {
        if (asset.path === manifest.entry.html) continue
        if (!/\.(css|js)$/.test(asset.path)) continue
        try {
          const content = await readAsset(manifest.id, manifest.version, asset.path)
          assets[asset.path] = content
          if (asset.path.endsWith('.css')) {
            const style = `<style data-pack-asset="${asset.path}">${content}</style>`
            html = html.includes('{{STYLE}}') ? html.replace('{{STYLE}}', style) : html.replace('</head>', `${style}</head>`)
          } else {
            const script = `<script data-pack-asset="${asset.path}">${content}<\/script>`
            html = html.includes('{{SCRIPT}}') ? html.replace('{{SCRIPT}}', script) : html.replace('</body>', `${script}</body>`)
          }
        } catch {
          /* 缺失可选资产不阻断（entry 必需，已在前面读取） */
        }
      }
      return { html, assets }
    },
    entryUrl(manifest: PackManifest): string {
      const seg = [manifest.id, manifest.version, manifest.entry.html]
        .map((x) => x.split('/').map((p) => encodeURIComponent(p)).join('/'))
        .join('/')
      return `${WORKSHOP_ORIGIN}/${seg}`
    },
    async sessionStatus(): Promise<SessionStatus> {
      return (await call('workshop_pack_session_status')) as SessionStatus
    },
    async reportSession(status: SessionStatus): Promise<SessionStatus> {
      return (await call('workshop_pack_session_report', { status })) as SessionStatus
    },
  }
}

/** ADR-004 隔离守卫：guest 若能访问 Tauri globals → 禁止启用该包（isolation-failed）。 */
export function isolationGuard(probe: { ownInternals: boolean; parentInternals: boolean }): { ok: boolean; reason?: string } {
  if (probe.ownInternals || probe.parentInternals) {
    return { ok: false, reason: 'E_ISOLATION: guest 可访问 Tauri globals（ADR-001 风险），禁止用 iframe 宿主' }
  }
  return { ok: true }
}

/** T24 信任等级 → 运行期能力上限（不允许的能力直接返回空集，表示禁用包）。 */
export function capabilityCeilingFor(tier: TrustTier, manifest: PackManifest): string[] {
  const decision = evaluateTrust({ manifest, source: 'local-file', signature: 'missing', tier })
  return decision.allowed ? decision.effectiveCapabilities : []
}
