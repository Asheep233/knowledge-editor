/**
 * UI 工坊 P3-T19：包隔离宿主 —— 包会话生命周期/崩溃处理/safe mode（Core，无 UI 依赖）。
 *
 * 职责：把「已安装包」提升为一个**受控 guest 会话**：
 * - 启动前校验版本完整性（损坏拒绝）并读取 manifest，生成受限 Broker 连接
 *   （role=guest、能力来自 manifest、绑定当前 context/epoch、声明式命令白名单）；
 * - 崩溃上报：未达上限 → `suspended`（可重启）；超过上限 → `failed` + 停用 + 自动 recover，
 *   并进入 `safeMode`（宿主可提示用户修复/回滚/重装）；
 * - 会话状态可订阅（UI/原生状态上报）；所有副作用通过注入 backend（产品=Tauri Rust 命令）；
 * - W07 B-5：宿主后端（sidecar）不可用/恢复时挂起/恢复会话（不计 guest 崩溃、不触发 safeMode），
 *   供 UI 与会话状态落盘如实反映「宿主故障 ≠ guest 崩溃」。
 *
 * 无 DOM/React 依赖。
 */
import type { BrokerConnection, BrokerRole } from '../broker/broker'
import type { PackManifest } from './manifest'

export type PackageSessionState = 'starting' | 'active' | 'suspended' | 'failed' | 'stopped'

/** W07 B-5：因**宿主后端不可用**而挂起的会话错误前缀（与 guest 自身崩溃/心跳超时区分）。 */
export const HOST_UNAVAILABLE_PREFIX = 'E_HOST_UNAVAILABLE:'

export interface PackageSession {
  packId: string
  version: string
  state: PackageSessionState
  connection?: BrokerConnection
  crashCount: number
  startedAt?: number
  lastError?: string
}

export interface PackageHostBackend {
  /** 版本完整性校验（损坏 → false） */
  verify(packId: string, version: string): Promise<boolean>
  /** 读取已安装版本的 manifest */
  readManifest(packId: string, version: string): Promise<PackManifest>
  /** 停用包（清理会话资源；失败不阻断 safeMode 路径） */
  deactivate(packId: string): Promise<void>
  /** 损坏/崩溃后的自动恢复（对应产品 workshop_pack_recover） */
  recover(packId: string): Promise<{ recovered: boolean; action: string }>
}

export interface PackageHostOptions {
  backend: PackageHostBackend
  /** 当前上下文绑定提供者（start/restart 时读取，保证切库后使用新 epoch） */
  binding: () => { contextId: string; epoch: number }
  /** 连续崩溃上限（超过进入 failed+safeMode，默认 3） */
  maxCrashes?: number
  /** 崩溃后是否自动 recover（默认 true） */
  autoRecover?: boolean
  role?: BrokerRole
  /** 运行期能力上限（信任等级 ∩ manifest；默认不额外限制） */
  capabilityCeiling?: (packId: string, declared: string[]) => string[]
  onSessionChange?: (session: PackageSession) => void
}

const NOW = () => Date.now()

export class PackageHost {
  private readonly backend: PackageHostBackend
  private readonly options: Required<Omit<PackageHostOptions, 'onSessionChange' | 'capabilityCeiling'>> &
    Pick<PackageHostOptions, 'onSessionChange' | 'capabilityCeiling'>
  private readonly sessions = new Map<string, PackageSession>()
  private readonly listeners = new Set<(s: PackageSession) => void>()
  private safeMode = false

  constructor(options: PackageHostOptions) {
    this.backend = options.backend
    this.options = {
      backend: options.backend,
      binding: options.binding,
      maxCrashes: options.maxCrashes ?? 3,
      autoRecover: options.autoRecover ?? true,
      role: options.role ?? 'guest',
      capabilityCeiling: options.capabilityCeiling,
      onSessionChange: options.onSessionChange,
    }
  }

  isSafeMode(): boolean {
    return this.safeMode
  }

  list(): PackageSession[] {
    return [...this.sessions.values()]
  }

  get(packId: string): PackageSession | undefined {
    return this.sessions.get(packId)
  }

  subscribe(listener: (s: PackageSession) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 校验 + 读取 manifest → 创建受限 Broker 连接（会话 active）。 */
  async start(packId: string, version: string): Promise<PackageSession> {
    const session: PackageSession = { packId, version, state: 'starting', crashCount: 0 }
    this.sessions.set(packId, session)
    this.emit(session)
    try {
      if (!(await this.backend.verify(packId, version))) {
        throw new Error(`E_HASH: 包完整性校验失败 ${packId}@${version}`)
      }
      const manifest = await this.backend.readManifest(packId, version)
      const binding = this.options.binding()
      const declared = [...manifest.capabilities]
      const capped = this.options.capabilityCeiling?.(packId, declared) ?? declared
      const connection: BrokerConnection = {
        connectionId: `session-${packId}-${version}-${NOW()}`,
        packId,
        packVersion: version,
        role: this.options.role,
        capabilities: capped,
        contextId: binding.contextId,
        epoch: binding.epoch,
        declaredCommands: (manifest.commands ?? []).map((c) => c.name),
      }
      session.connection = connection
      session.state = 'active'
      session.startedAt = NOW()
      session.lastError = undefined
      this.emit(session)
      return session
    } catch (e) {
      session.state = 'failed'
      session.lastError = String((e as Error)?.message ?? e)
      this.emit(session)
      return session
    }
  }

  /** 上报 guest 崩溃；超过上限 → failed + 停用 + 自动 recover + safeMode。 */
  async reportCrash(packId: string, reason: string): Promise<PackageSession | undefined> {
    const session = this.sessions.get(packId)
    if (!session) return undefined
    session.crashCount += 1
    session.lastError = reason
    if (session.crashCount > this.options.maxCrashes) {
      session.state = 'failed'
      session.connection = undefined
      this.safeMode = this.safeMode || this.options.autoRecover
      this.emit(session)
      try {
        await this.backend.deactivate(packId)
      } catch {
        /* 停用失败不阻断恢复 */
      }
      if (this.options.autoRecover) {
        try {
          const result = await this.backend.recover(packId)
          if (!result.recovered) this.safeMode = true
        } catch {
          this.safeMode = true
        }
      }
      return session
    }
    session.state = 'suspended'
    session.connection = undefined
    this.emit(session)
    return session
  }

  /**
   * W07 B-5：宿主后端不可用（sidecar 崩溃/已降级）→ 把进行中的 active 会话标为 `suspended`
   * 并记录 `E_HOST_UNAVAILABLE: <原因>`；**不计 guest 崩溃次数、不 deactivate/recover、不进 safeMode**
   * （这是宿主故障，不是 guest 崩溃）。连接保留，恢复后由 `markHostRestored` 回到 active。
   */
  markHostUnavailable(reason: string): PackageSession[] {
    const affected: PackageSession[] = []
    const summary = `${HOST_UNAVAILABLE_PREFIX} ${String(reason ?? '').trim()}`.trim()
    for (const session of this.sessions.values()) {
      if (session.state !== 'active') continue
      session.state = 'suspended'
      session.lastError = summary
      this.emit(session)
      affected.push({ ...session, connection: session.connection ? { ...session.connection } : undefined })
    }
    return affected
  }

  /**
   * W07 B-5：宿主后端恢复（`ke:runtime-ready`）→ 仅把「因宿主故障挂起」的会话恢复 `active`
   * 并清除 lastError；guest 自身崩溃导致的 suspended 不在此列（仍等待显式 restart）。
   */
  markHostRestored(): PackageSession[] {
    const restored: PackageSession[] = []
    for (const session of this.sessions.values()) {
      if (session.state !== 'suspended') continue
      if (!session.lastError?.startsWith(HOST_UNAVAILABLE_PREFIX)) continue
      session.state = 'active'
      session.lastError = undefined
      this.emit(session)
      restored.push({ ...session, connection: session.connection ? { ...session.connection } : undefined })
    }
    return restored
  }

  /** 重启（崩溃计数未超限且版本仍完整）；切库后重新绑定当前 epoch。 */
  async restart(packId: string): Promise<PackageSession | undefined> {
    const session = this.sessions.get(packId)
    if (!session) return undefined
    if (session.crashCount > this.options.maxCrashes) return session
    return await this.start(packId, session.version)
  }

  /** 主动停止（停用 + 资源清理）。 */
  async stop(packId: string): Promise<void> {
    const session = this.sessions.get(packId)
    if (!session) return
    session.state = 'stopped'
    session.connection = undefined
    this.emit(session)
    try {
      await this.backend.deactivate(packId)
    } catch {
      /* 停用失败不抛（资源随宿主退出清理） */
    }
  }

  private emit(session: PackageSession): void {
    const pub: PackageSession = { ...session, connection: session.connection ? { ...session.connection } : undefined }
    this.options.onSessionChange?.(pub)
    for (const l of this.listeners) l(pub)
  }
}
