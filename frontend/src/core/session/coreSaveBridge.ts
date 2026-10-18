/**
 * UI 工坊 P2-T14（ADR-002 步骤 1）：产品保存链 → Core 的上下文解析与组合桥。
 *
 * 职责（DOM-free，注入 fetch）：
 * - 解析产品工作区根：GET /api/workspace/info → root；
 * - 打开/复用上下文：POST /api/context/open（id 默认 ke-default）；已存在（409）→ switch 取最新 epoch；
 * - 每次保存：取可信快照（revision+diskHash）→ SaveCoordinator（HttpTransport + RecoveryJournal）
 *   三阶段保存；成功后 revision 前进，后续保存自动使用新 revision；
 * - 失败映射：revision/外部冲突 → CoreSaveError（旧 UI 提示可用）；epoch 过期 → E_STALE_CONTEXT。
 *
 * 仅被「当前文档 WYSIWYG 直写」使用（ADR-002 决策 3）；源码通道/导出不在此桥内。
 */
import { CoreSaveError, createCoreSaveFn, type ProductSaveFn } from './productAdapter'
import { MemoryRecoveryStorage, RecoveryJournal } from './recoveryJournal'
import { SaveCoordinator } from './saveCoordinator'
import { HttpTransport } from './httpTransport'
import type { ContextBinding, DocumentSnapshot } from './types'

export interface CoreSaveBridgeOptions {
  fetchImpl?: typeof fetch
  /** 后端 base（默认同源相对路径） */
  baseUrl?: string
  /** 上下文 id（默认 ke-default；产品一工作区一默认上下文） */
  contextId?: string
  /** 恢复日志（默认内存；产品可注入持久化实现） */
  journalFactory?: () => RecoveryJournal
}

export interface CoreSaveResult {
  status: 'saved'
  revision: number
}

interface ContextInfo {
  contextId: string
  epoch: number
}

export class CoreSaveBridge {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly contextId: string
  private readonly journalFactory: () => RecoveryJournal
  private context: ContextInfo | null = null
  private readonly coordinators = new Map<string, SaveCoordinator>()
  private readonly snapshots = new Map<string, DocumentSnapshot>()

  constructor(options: CoreSaveBridgeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
    this.contextId = options.contextId ?? 'ke-default'
    this.journalFactory = options.journalFactory ?? (() => new RecoveryJournal(new MemoryRecoveryStorage()))
  }

  /** 供产品接线检查当前绑定（UI 展示/切库失效）。 */
  currentBinding(): ContextBinding | null {
    return this.context ? { contextId: this.context.contextId, epoch: this.context.epoch } : null
  }

  /** 切工作区/外部状态变化时调用：丢弃缓存上下文与协调器，下次保存重新解析。 */
  invalidate(): void {
    this.context = null
    this.coordinators.clear()
    this.snapshots.clear()
  }

  private async request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
    const resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    let body: T | null = null
    try {
      body = (await resp.json()) as T
    } catch {
      body = null
    }
    return { status: resp.status, body }
  }

  /** 解析工作区根 → 打开/复用上下文（缓存）。 */
  async ensureContext(): Promise<ContextInfo> {
    if (this.context) return this.context
    const info = await this.request<{ root?: string }>('/api/workspace/info', { method: 'GET' })
    if (info.status !== 200 || !info.body?.root) {
      throw new Error(`E_CONTEXT: 读取工作区信息失败（HTTP ${info.status}）`)
    }
    const open = await this.request<{ id: string; epoch: number }>('/api/context/open', {
      method: 'POST',
      body: JSON.stringify({ id: this.contextId, root: info.body.root }),
    })
    if (open.status === 200 && open.body) {
      this.context = { contextId: open.body.id, epoch: open.body.epoch }
      return this.context
    }
    if (open.status === 409) {
      const switched = await this.request<{ id: string; epoch: number }>('/api/context/switch', {
        method: 'POST',
        body: JSON.stringify({ id: this.contextId }),
      })
      if (switched.status === 200 && switched.body) {
        this.context = { contextId: switched.body.id, epoch: switched.body.epoch }
        return this.context
      }
    }
    throw new Error(`E_CONTEXT: 打开上下文失败（HTTP ${open.status}）`)
  }

  private async fetchSnapshot(relPath: string): Promise<DocumentSnapshot> {
    const context = await this.ensureContext()
    const snap = await this.request<{ rel_path: string; revision: number; disk_hash: string }>('/api/context/snapshot', {
      method: 'POST',
      body: JSON.stringify({ context_id: context.contextId, epoch: context.epoch, rel_path: relPath }),
    })
    if (snap.status !== 200 || !snap.body) throw new Error(`E_SNAPSHOT: 获取快照失败（HTTP ${snap.status}）`)
    const snapshot: DocumentSnapshot = { relPath, content: '', revision: snap.body.revision, diskHash: snap.body.disk_hash }
    this.snapshots.set(relPath, snapshot)
    return snapshot
  }

  private coordinatorFor(relPath: string, snapshot: DocumentSnapshot): SaveCoordinator {
    const existing = this.coordinators.get(relPath)
    if (existing) return existing
    const context = this.context!
    const coordinator = new SaveCoordinator({
      transport: new HttpTransport({ baseUrl: this.baseUrl, fetchImpl: this.fetchImpl }),
      binding: { contextId: context.contextId, epoch: context.epoch },
      journal: this.journalFactory(),
    })
    coordinator.registerSnapshot(snapshot)
    this.coordinators.set(relPath, coordinator)
    return coordinator
  }

  /** 创建产品 SaveFn（供 EditorArea 适配；内容回调每次保存时取最新编辑内容）。 */
  async createSaveFn(relPath: string, getContent: () => string): Promise<ProductSaveFn> {
    const coordinator = this.coordinatorFor(relPath, await this.fetchSnapshot(relPath))
    const base = createCoreSaveFn(coordinator, relPath)
    return async (signal?: AbortSignal) => {
      coordinator.recordEdit(relPath, getContent())
      return await base(signal)
    }
  }

  /** 一次性保存（测试/简单调用）：返回 revision；冲突/失败抛 CoreSaveError。 */
  async saveDocument(relPath: string, content: string, requestId?: string): Promise<CoreSaveResult> {
    const coordinator = this.coordinatorFor(relPath, this.snapshots.get(relPath) ?? (await this.fetchSnapshot(relPath)))
    coordinator.recordEdit(relPath, content)
    const result = await coordinator.save(relPath, requestId)
    if (result.status === 'saved') {
      return { status: 'saved', revision: coordinator.state(relPath).revision }
    }
    const code =
      result.status === 'stale_context'
        ? 'E_STALE_CONTEXT'
        : result.status === 'conflict_external'
          ? 'E_CONFLICT_EXTERNAL'
          : result.status === 'conflict_revision'
            ? 'E_CONFLICT'
            : 'E_INTERNAL'
    throw new CoreSaveError(code, result.status, `Core 保存未完成: ${result.status}`)
  }
}
