/**
 * UI 工坊 A7：产品 guest 会话宿主控制器（DOM-free，可单测；iframe/UI 由组件薄封装）。
 *
 * 职责：
 * - start：PackageHost 启动受限会话（能力上限由 T24 信任等级 ∩ manifest 计算，空集=禁用）→
 *   读取已安装包真实 entry（adapter.loadEntry）→ 返回 {session, entryHtml} 供 UI 注入 sandbox iframe；
 * - 心跳监控：guest 每 tick 心跳；超时（默认 1200ms）自动 host.reportCrash('heartbeat timeout')；
 * - 会话状态持久化：状态变化经 adapter.reportSession 落 `workshop-session-status.json`；
 * - stop：停止会话并持久化 stopped（崩溃/超限时由 PackageHost 触发 deactivate+recover+safeMode）。
 *
 * 安全：本模块不接触 DOM；sandbox/隔离守卫（isolationGuard）由 UI 组件在注入前执行。
 */
import { PackageHost, type PackageHostBackend, type PackageSession } from './packageHost'
import type { PackManifest } from './manifest'
import type { TrustTier } from './trustPolicy'
import { capabilityCeilingFor } from './productHostAdapter'

export interface GuestHostBackend extends PackageHostBackend {
  loadEntry(manifest: PackManifest): Promise<{ html: string; assets: Record<string, string> }>
  reportSession(status: { state: string; packId?: string | null; capabilities?: string[]; lastError?: string | null }): Promise<unknown>
}

export interface GuestHostOptions {
  backend: GuestHostBackend
  tier: TrustTier
  contextId?: string
  maxCrashes?: number
  heartbeatTimeoutMs?: number
  /** 会话状态变化回调（诊断/UI） */
  onStatus?: (status: { state: string; packId: string; lastError?: string }) => void
}

export interface GuestStartResult {
  blocked: boolean
  reason?: string
  session?: PackageSession
  entryHtml?: string
  assets?: Record<string, string>
  capabilities: string[]
}

export class GuestSessionHost {
  private readonly options: Required<Pick<GuestHostOptions, 'contextId' | 'maxCrashes' | 'heartbeatTimeoutMs'>> &
    Pick<GuestHostOptions, 'onStatus'>
  private readonly backend: GuestHostBackend
  private readonly tier: TrustTier
  private host: PackageHost | null = null
  private packId = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private lastHeartbeatAt = 0
  private startedAt = 0
  private stopped = false

  constructor(options: GuestHostOptions) {
    this.backend = options.backend
    this.tier = options.tier
    this.options = {
      contextId: options.contextId ?? 'ke-default',
      maxCrashes: options.maxCrashes ?? 2,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 1200,
      onStatus: options.onStatus,
    }
  }

  /** 启动受限会话并加载真实入口；能力不允许（空集）→ blocked（不启动）。 */
  async start(packId: string, version: string): Promise<GuestStartResult> {
    this.packId = packId
    const manifest = await this.backend.readManifest(packId, version)
    const ceiling = capabilityCeilingFor(this.tier, manifest)
    if (ceiling.length === 0) {
      const reason = `E_CAPABILITY_TIER: 信任等级 ${this.tier} 不允许该包声明能力（禁止启用）`
      await this.report('failed', reason)
      return { blocked: true, reason, capabilities: [] }
    }
    this.host = new PackageHost({
      backend: this.backend,
      binding: () => ({ contextId: this.options.contextId, epoch: 1 }),
      maxCrashes: this.options.maxCrashes,
      capabilityCeiling: () => ceiling,
      onSessionChange: (session) => {
        void this.report(session.state, undefined, session.connection?.capabilities)
      },
    })
    this.startedAt = Date.now()
    const session = await this.host.start(packId, version)
    const entry = await this.backend.loadEntry(manifest)
    await this.report(session.state, undefined, session.connection?.capabilities)
    return { blocked: false, session, entryHtml: entry.html, assets: entry.assets, capabilities: ceiling }
  }

  /** guest 心跳（UI 收到 postMessage 后调用）。 */
  heartbeat(): void {
    this.lastHeartbeatAt = Date.now()
  }

  /** 启动心跳监控：超时自动 reportCrash（幂等，只报一次）。 */
  startHeartbeatMonitor(): void {
    if (this.timer || !this.host) return
    this.timer = setInterval(() => {
      if (this.stopped || !this.host) return
      const reference = this.lastHeartbeatAt === 0 ? this.startedAt : this.lastHeartbeatAt
      if (Date.now() - reference > this.options.heartbeatTimeoutMs) {
        this.lastHeartbeatAt = Date.now() // 避免同一中断重复上报
        void this.host.reportCrash(this.packId, 'heartbeat timeout (guest crash detected)').catch(() => undefined)
      }
    }, 150)
  }

  /** 停止会话（崩溃路径由 PackageHost 负责 deactivate/recover/safeMode）。 */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.host) await this.host.stop(this.packId)
    await this.report('stopped')
  }

  isSafeMode(): boolean {
    return this.host?.isSafeMode() ?? false
  }

  private async report(state: string, lastError?: string, capabilities?: string[]): Promise<void> {
    this.options.onStatus?.({ state, packId: this.packId, lastError })
    try {
      await this.backend.reportSession({
        state,
        packId: this.packId || null,
        capabilities: capabilities ?? [],
        lastError: lastError ?? null,
      })
    } catch {
      /* 状态落盘失败不阻断会话（诊断用途） */
    }
  }
}

export function createGuestSessionHost(options: GuestHostOptions): GuestSessionHost {
  return new GuestSessionHost(options)
}
