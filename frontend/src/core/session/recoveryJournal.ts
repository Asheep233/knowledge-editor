/**
 * UI 工坊 P1-T10：恢复日志（recovery durable）—— 与 DOM/Node 无关的持久化边界。
 *
 * 语义（ARCHITECTURE「协议必须表达的语义」）：
 * - 保存**开始前**先持久化恢复记录（content + 快照 revision + requestId + binding）；
 * - 只有 file_durable 后才 commit（删除恢复记录）；
 * - 进程崩溃后新会话 `pending()` 仍能读回未提交记录 → 可恢复为「未保存草稿」；
 * - 存储通过注入的 `RecoveryStorage`（Tauri 内实现为文件/IndexedDB；测试用内存）。
 */
import type { ContextBinding } from './types'

export interface RecoveryRecord {
  requestId: string
  contextId: string
  epoch: number
  relPath: string
  content: string
  revision: number
  createdAt: number
}

/** 持久化原语：整份 JSON 文本读/写/删（实现方保证 write 返回即已落盘）。 */
export interface RecoveryStorage {
  read(): Promise<string | null>
  write(text: string): Promise<void>
  remove(): Promise<void>
}

export class MemoryRecoveryStorage implements RecoveryStorage {
  text: string | null = null

  async read(): Promise<string | null> {
    return this.text
  }

  async write(text: string): Promise<void> {
    this.text = text
  }

  async remove(): Promise<void> {
    this.text = null
  }
}

export class RecoveryJournal {
  private readonly storage: RecoveryStorage
  private records = new Map<string, RecoveryRecord>()
  private loaded = false
  private lastError?: string

  constructor(storage: RecoveryStorage) {
    this.storage = storage
  }

  /** 读取持久化日志（损坏时不抛错：记录 error 并视为空，避免阻断打开文档）。 */
  async load(): Promise<RecoveryRecord[]> {
    if (this.loaded) return [...this.records.values()]
    this.loaded = true
    const text = await this.storage.read()
    if (!text) return []
    try {
      const parsed = JSON.parse(text) as RecoveryRecord[]
      if (Array.isArray(parsed)) {
        for (const rec of parsed) {
          if (rec && typeof rec.relPath === 'string' && typeof rec.requestId === 'string') {
            this.records.set(rec.requestId, rec)
          }
        }
      }
    } catch (e) {
      this.lastError = `恢复日志损坏: ${String((e as Error)?.message ?? e)}`
    }
    return [...this.records.values()]
  }

  error(): string | undefined {
    return this.lastError
  }

  pending(relPath?: string): RecoveryRecord[] {
    const all = [...this.records.values()]
    return relPath ? all.filter((r) => r.relPath === relPath) : all
  }

  /** 保存开始前调用：写恢复记录并持久化（write 返回即 recovery_durable）。 */
  async begin(binding: ContextBinding, relPath: string, content: string, revision: number, requestId: string): Promise<RecoveryRecord> {
    const record: RecoveryRecord = {
      requestId,
      contextId: binding.contextId,
      epoch: binding.epoch,
      relPath,
      content,
      revision,
      createdAt: Date.now(),
    }
    this.records.set(requestId, record)
    await this.persist()
    return record
  }

  /** file_durable 后调用：删除恢复记录（全部删除时持久化层清空/删除文件）。 */
  async commit(requestId: string): Promise<void> {
    if (!this.records.delete(requestId)) return
    await this.persist()
  }

  private async persist(): Promise<void> {
    const list = [...this.records.values()]
    if (list.length === 0) {
      await this.storage.remove()
      return
    }
    await this.storage.write(JSON.stringify(list))
  }
}
