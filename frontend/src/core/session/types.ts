/**
 * UI 工坊 P1-T10：常驻 Core / DocumentSession 的类型化边界（无 React/DOM 依赖）。
 *
 * 语义遵 ARCHITECTURE.md「协议必须表达的语义」：
 * - 快照绑定 `(contextId, epoch, relPath, revision, diskHash)`；
 * - 保存结果区分 `accepted` / `recovery_durable` / `file_durable`，**只有 file_durable 才算已保存**；
 * - requestId 幂等；超时/abort 后经 queryResult 查询真实结果（不能断言未执行）；
 * - 旧 epoch 的迟到响应不得应用到新上下文。
 */

export interface ContextBinding {
  contextId: string
  epoch: number
}

/** 可信快照：全文 + 目标 revision + 取得时磁盘指纹。 */
export interface DocumentSnapshot {
  relPath: string
  content: string
  revision: number
  diskHash: string
}

export type SaveStatus =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'conflict_revision'
  | 'conflict_external'
  | 'stale_context'
  | 'failed'

export interface WriteRequest {
  contextId: string
  epoch: number
  relPath: string
  content: string
  expectedRevision: number
  requestId: string
}

export interface WriteResult {
  requestId: string
  contextId: string
  relPath: string
  status: 'completed' | 'conflict' | 'stale' | 'failed'
  kind?: 'revision' | 'external'
  revision?: number
  currentRevision?: number
  accepted?: boolean
  recoveryDurable?: boolean
  fileDurable?: boolean
  detail?: string
}

/** 传输层：T09 真实端点（/api/context/*）或测试内存实现。 */
export interface SaveTransport {
  write(req: WriteRequest): Promise<WriteResult>
  queryResult(requestId: string): Promise<WriteResult | null>
}

export interface SaveStateChange {
  relPath: string
  status: SaveStatus
  revision?: number
  requestId?: string
  detail?: string
}
