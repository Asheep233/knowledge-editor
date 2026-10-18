/**
 * UI 工坊 P3-T22：首次安装前确认 —— 安装预览/风险说明/显式确认门禁（Core，无 UI）。
 *
 * 红线（TASKS T22）：安装前必须展示包身份/来源/版本/声明能力/影响，并**显式确认**；
 * 未确认不得安装；签名无效/来源不受信必须阻止（不是警告后继续）；预览内容与最终安装清单一致。
 *
 * UI（工坊控制面）只负责渲染 preview 与收集 confirm；安装动作只能由 `PendingInstallGate.confirm`
 * 触发，保证无法绕过确认。
 */
import type { PackManifest, PackCapability } from './manifest'
import type { PackFileSystem, PackHasher, PackState } from './store'
import { PackStore } from './store'

export type PackSource = 'local-file' | 'downloaded' | 'builtin'

export type SignatureStatus = 'valid' | 'missing' | 'invalid'

export interface CapabilityRisk {
  capability: PackCapability | string
  risk: 'low' | 'medium' | 'high'
  summary: string
}

export interface InstallPreview {
  packId: string
  name: string
  version: string
  apiVersion: number
  source: PackSource
  signature: SignatureStatus
  sizeBytes?: number
  capabilities: CapabilityRisk[]
  warnings: string[]
  blocked: boolean
  blockReason?: string
  /** 必须由用户显式确认后，confirm(confirmToken) 才能安装 */
  requiresExplicitConfirm: true
}

const CAPABILITY_RISK: Record<string, CapabilityRisk> = {
  'ui.shell': { capability: 'ui.shell', risk: 'medium', summary: '替换应用周边 UI 外壳（编辑面仍由官方渲染）' },
  'panel.sidebar': { capability: 'panel.sidebar', risk: 'low', summary: '在侧栏添加面板' },
  'panel.dock': { capability: 'panel.dock', risk: 'low', summary: '在停靠区添加面板' },
  'editor.commands.readonly': { capability: 'editor.commands.readonly', risk: 'medium', summary: '发起只读编辑命令（选择/滚动/复制，不写正文）' },
  'context.read': { capability: 'context.read', risk: 'low', summary: '读取当前工作区文档树/搜索（经受控协议）' },
  'print.request': { capability: 'print.request', risk: 'low', summary: '请求打印当前文档的可信快照' },
}

/** 能力 → 风险视图（UI 适配器复用；未知能力按 high 处理）。 */
export function capabilityRisk(capability: string): CapabilityRisk {
  return CAPABILITY_RISK[capability] ?? { capability, risk: 'high', summary: '未识别的能力声明' }
}

export interface PreviewInput {
  manifest: PackManifest
  source: PackSource
  signature?: SignatureStatus
  sizeBytes?: number
}

/** 生成安装预览（纯函数；不含安装副作用）。 */
export function buildInstallPreview(input: PreviewInput): InstallPreview {
  const { manifest } = input
  const signature: SignatureStatus = input.signature ?? 'missing'
  const caps: CapabilityRisk[] = manifest.capabilities.map((cap) => capabilityRisk(cap))
  const warnings: string[] = []
  let blocked = false
  let blockReason: string | undefined
  if (signature === 'invalid') {
    blocked = true
    blockReason = 'E_SIGNATURE: 包签名无效，禁止安装'
  }
  if (signature === 'missing' && input.source === 'downloaded') {
    warnings.push('该包来自下载且未签名；仅在你信任来源时继续')
  }
  if (input.source === 'local-file') warnings.push('本地文件包：请确认文件来源与完整性（sha256 由清单限定）')
  if (caps.some((c) => c.risk === 'high')) warnings.push('包含高影响能力，建议仅在隔离测试环境使用')
  if (manifest.commands?.length) warnings.push(`声明了 ${manifest.commands.length} 个命令：${manifest.commands.map((c) => c.name).join(', ')}`)
  return {
    packId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    source: input.source,
    signature,
    sizeBytes: input.sizeBytes,
    capabilities: caps,
    warnings,
    blocked,
    blockReason,
    requiresExplicitConfirm: true,
  }
}

export interface StagedInstall {
  token: string
  preview: InstallPreview
  manifest: PackManifest
  files: Record<string, Uint8Array>
  createdAt: number
}

export interface PendingInstallGateOptions {
  fs: PackFileSystem
  hash?: PackHasher
  /** 预览 token 有效期（毫秒，默认 10 分钟；过期必须重新预览） */
  ttlMs?: number
  now?: () => number
}

let tokenSeq = 0

/**
 * 安装门禁：`stage` 只做预览/暂存（无安装副作用）；安装只能经 `confirm(token)` 显式触发。
 * 每次 confirm 只消费一次 token；blocked 预览不能 confirm；过期 token 必须重新 stage。
 */
export class PendingInstallGate {
  private readonly fs: PackFileSystem
  private readonly hash?: PackHasher
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly staged = new Map<string, StagedInstall>()

  constructor(options: PendingInstallGateOptions) {
    this.fs = options.fs
    this.hash = options.hash
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000
    this.now = options.now ?? Date.now
  }

  /** 暂存候选包并返回预览 token；不写入任何包目录。 */
  stage(manifest: PackManifest, files: Record<string, Uint8Array>, input: Omit<PreviewInput, 'manifest'>): StagedInstall {
    const preview = buildInstallPreview({ manifest, ...input })
    const token = `stage-${++tokenSeq}-${this.now().toString(36)}`
    const staged: StagedInstall = { token, preview, manifest, files, createdAt: this.now() }
    this.staged.set(token, staged)
    return staged
  }

  /** 显式确认并安装；token 一次性消费；blocked/过期 token 拒绝。 */
  async confirm(token: string): Promise<PackState> {
    const staged = this.staged.get(token)
    if (!staged) throw new Error('E_CONFIRM: 未知或已使用的预览 token')
    if (this.now() - staged.createdAt > this.ttlMs) {
      this.staged.delete(token)
      throw new Error('E_CONFIRM: 预览已过期，请重新确认')
    }
    if (staged.preview.blocked) {
      this.staged.delete(token)
      throw new Error(staged.preview.blockReason ?? 'E_CONFIRM: 安装被阻止')
    }
    this.staged.delete(token)
    const store = new PackStore(this.fs, this.hash)
    return await store.install(staged.manifest, staged.files)
  }

  /** 用户取消：丢弃预览（不安装）。 */
  cancel(token: string): boolean {
    return this.staged.delete(token)
  }

  pending(): StagedInstall[] {
    return [...this.staged.values()]
  }
}
