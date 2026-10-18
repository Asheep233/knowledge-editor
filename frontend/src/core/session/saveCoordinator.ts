/**
 * UI 工坊 P1-T10：SaveCoordinator —— 无 UI 的保存/恢复垂直切片。
 *
 * 职责：
 *  - 持有文档可信快照（content/revision/diskHash）与保存状态；
 *  - `recordEdit` 只标脏（O(1)），**不广播全文**；
 *  - `save()` 用当前快照 + context binding 调用 Transport；结果按
 *    accepted → recovery_durable → file_durable 三阶段推进，只有 file_durable 才 `saved`；
 *  - abort/超时后保留 requestId，可 `reconcile(requestId)` 查询真实结果；
 *  - `switchContext` 使旧 epoch 失效：后续保存直接 stale_context，**不发请求**；
 *  - 旧 epoch 的迟到响应被丢弃（不应用到新上下文）。
 */
import type { RecoveryJournal } from './recoveryJournal'
import type {
  ContextBinding,
  DocumentSnapshot,
  SaveStateChange,
  SaveStatus,
  SaveTransport,
  WriteResult,
} from './types'

export interface SaveCoordinatorOptions {
  /** 注入 transport（测试内存实现 / 产品 HTTP 实现） */
  transport: SaveTransport
  /** 初始 context binding（未绑定视为 stale） */
  binding: ContextBinding
  /** 状态变化回调（可选，供 UI/测试观察） */
  onStateChange?: (change: SaveStateChange) => void
  /** 可选恢复日志：保存开始前持久化恢复记录，file_durable 后提交（T10 recovery_durable） */
  journal?: RecoveryJournal
}

interface DocState {
  relPath: string
  snapshot: DocumentSnapshot
  status: SaveStatus
  lastRequestId?: string
  lastError?: string
}

export class SaveCoordinator {
  private readonly transport: SaveTransport
  private readonly onStateChange?: (change: SaveStateChange) => void
  private readonly journal?: RecoveryJournal
  private binding: ContextBinding
  private docs = new Map<string, DocState>()
  /** 已知 requestId → 发起时 binding（用于迟到响应判定） */
  private readonly pending = new Map<string, ContextBinding>()

  constructor(opts: SaveCoordinatorOptions) {
    this.transport = opts.transport
    this.binding = opts.binding
    this.onStateChange = opts.onStateChange
    this.journal = opts.journal
  }

  currentBinding(): ContextBinding {
    return { ...this.binding }
  }

  /** 切换上下文：epoch 更新；旧请求保留“迟到但可查询”的记录，响应应用时按 epoch 丢弃。 */
  switchContext(binding: ContextBinding): void {
    this.binding = { ...binding }
    for (const doc of this.docs.values()) {
      if (doc.status === 'saving') {
        // 在途保存不再视为当前上下文状态；保留 pending 供 reconcile（结果可能落盘）
        doc.status = 'dirty'
      }
    }
  }

  registerSnapshot(snapshot: DocumentSnapshot): void {
    this.docs.set(snapshot.relPath, {
      relPath: snapshot.relPath,
      snapshot: { ...snapshot },
      status: 'idle',
    })
  }

  state(relPath: string): { status: SaveStatus; revision: number; lastRequestId?: string; detail?: string } {
    const doc = this.docs.get(relPath)
    if (!doc) throw new Error(`未注册文档: ${relPath}`)
    return { status: doc.status, revision: doc.snapshot.revision, lastRequestId: doc.lastRequestId, detail: doc.lastError }
  }

  snapshot(relPath: string): DocumentSnapshot {
    const doc = this.docs.get(relPath)
    if (!doc) throw new Error(`未注册文档: ${relPath}`)
    return { ...doc.snapshot }
  }

  /** O(1) 标脏：不序列化、不广播全文。 */
  recordEdit(relPath: string, content: string): void {
    const doc = this.docs.get(relPath)
    if (!doc) throw new Error(`未注册文档: ${relPath}`)
    doc.snapshot = { ...doc.snapshot, content }
    if (doc.status !== 'saving') {
      doc.status = 'dirty'
      this.emit(doc)
    }
  }

  /**
   * 保存：把**当前可信快照**发给 Transport。
   * abort/timeout（transport 抛错）时保留 requestId 与 pending binding；状态回 dirty，
   * 调用方可 `reconcile` 查询结果（结果可能已落盘，不能假设失败）。
   */
  async save(relPath: string, requestId?: string): Promise<{ status: SaveStatus; requestId?: string; result?: WriteResult }> {
    const doc = this.docs.get(relPath)
    if (!doc) throw new Error(`未注册文档: ${relPath}`)
    const binding = { ...this.binding }
    const rid = requestId ?? createRequestId()
    // 旧 epoch/未绑定 → 本地直接 stale，不发请求（切库屏障）
    if (!binding.contextId || binding.epoch <= 0) {
      doc.status = 'stale_context'
      this.emit(doc)
      return { status: doc.status, requestId: rid }
    }
    doc.status = 'saving'
    doc.lastRequestId = rid
    this.pending.set(rid, binding)
    if (this.journal) await this.journal.begin(binding, relPath, doc.snapshot.content, doc.snapshot.revision, rid)
    this.emit(doc)
    try {
      const result = await this.transport.write({
        contextId: binding.contextId,
        epoch: binding.epoch,
        relPath,
        content: doc.snapshot.content,
        expectedRevision: doc.snapshot.revision,
        requestId: rid,
      })
      return await this.applyResult(doc, binding, result)
    } catch (e) {
      // abort/超时：保留 pending，状态回 dirty；真实结果必须通过 reconcile 查询
      doc.status = 'dirty'
      doc.lastError = String((e as Error)?.message ?? e)
      this.emit(doc)
      return { status: doc.status, requestId: rid }
    }
  }

  /** 查询超时/abort 后的真实结果；已完成则应用（仅当 context binding 仍有效）。 */
  async reconcile(requestId: string): Promise<{ status: SaveStatus; result?: WriteResult }> {
    const binding = this.pending.get(requestId)
    if (!binding) throw new Error(`未知 requestId: ${requestId}`)
    const result = await this.transport.queryResult(requestId)
    if (!result) {
      return { status: this.bindingStatusFor(requestId) }
    }
    const doc = [...this.docs.values()].find((d) => d.lastRequestId === requestId)
    if (!doc) return { status: 'idle', result }
    return await this.applyResult(doc, binding, result)
  }

  private bindingStatusFor(requestId: string): SaveStatus {
    for (const doc of this.docs.values()) if (doc.lastRequestId === requestId) return doc.status
    return 'idle'
  }

  private async applyResult(doc: DocState, requestBinding: ContextBinding, result: WriteResult): Promise<{ status: SaveStatus; requestId?: string; result?: WriteResult }> {
    // 迟到响应：发起时 binding 与当前不同 → 丢弃，不得改当前上下文状态/快照
    if (
      requestBinding.contextId !== this.binding.contextId ||
      requestBinding.epoch !== this.binding.epoch
    ) {
      this.pending.delete(result.requestId)
      return { status: doc.status, result: { ...result, status: 'stale', detail: 'context 已切换，丢弃迟到响应' } }
    }
    this.pending.delete(result.requestId)
    let status: SaveStatus
    if (result.status === 'completed' && result.fileDurable) {
      doc.snapshot = {
        ...doc.snapshot,
        revision: result.revision ?? doc.snapshot.revision,
        diskHash: result.fileDurable ? hashContent(doc.snapshot.content) : doc.snapshot.diskHash,
      }
      doc.status = 'saved'
      status = 'saved'
      if (this.journal) {
        // 保存成功 → 提交当前恢复记录，并清理同一文档的旧恢复记录（abort 重试后的残留）
        await this.journal.commit(result.requestId)
        for (const stale of this.journal.pending(doc.relPath)) await this.journal.commit(stale.requestId)
      }
    } else if (result.status === 'conflict' && result.kind === 'revision') {
      doc.status = 'conflict_revision'
      status = 'conflict_revision'
    } else if (result.status === 'conflict' && result.kind === 'external') {
      doc.status = 'conflict_external'
      status = 'conflict_external'
    } else if (result.status === 'stale') {
      doc.status = 'stale_context'
      status = 'stale_context'
    } else {
      doc.status = 'failed'
      doc.lastError = result.detail ?? '保存失败'
      status = 'failed'
    }
    if (result.status !== 'completed') doc.lastError = result.detail
    this.emit(doc)
    return { status, requestId: result.requestId, result }
  }

  private emit(doc: DocState): void {
    this.onStateChange?.({
      relPath: doc.relPath,
      status: doc.status,
      revision: doc.snapshot.revision,
      requestId: doc.lastRequestId,
      detail: doc.lastError,
    })
  }
}

function createRequestId(): string {
  // 无 DOM/crypto 依赖（Node 与浏览器均有 globalThis.crypto，但保留回退）
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 简易内容指纹（与后端 sha256 不同；仅用于本地快照推进，不做跨端校验）。 */
export function hashContent(content: string): string {
  let h = 5381
  for (let i = 0; i < content.length; i++) h = ((h << 5) + h + content.charCodeAt(i)) | 0
  return `local-${(h >>> 0).toString(16)}`
}
