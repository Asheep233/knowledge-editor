/** 与 backend API 对应的类型定义。 */

export interface HealthInfo {
  status: string
  app: string
  version: string
  /** Phase 5E：后端启动时间（ISO 8601 UTC） */
  started_at: string
  workspace: string
}

export interface TreePayload {
  root: string
  articles: string[]
  modules: string[]
  attachments: {
    images: string[]
    videos: string[]
    files: string[]
  }
}

export interface ArticleMeta {
  id: string
  path: string
  title: string
  content: string
  meta?: Record<string, unknown>
  /** Phase 4.6：文档元信息 */
  created_at?: string
  updated_at?: string
  size?: number
  word_count?: number
  tags?: string[]
}

export interface SearchResult {
  id: number
  rel_path: string
  kind: string
  title: string
  updated_at: string
  snippet?: string
}

export interface SearchPayload {
  query: string
  count: number
  results: SearchResult[]
}

// ---------- Phase 4：Workspace 管理 ----------

export interface WorkspaceState {
  open: boolean
  root?: string
  stats?: { document: number; module: number; attachment: number }
}

export interface RecentWorkspace {
  path: string
  /** 路径当前是否仍然存在（失效条目置灰提示，可单独移除） */
  exists: boolean
}

export interface RecentWorkspacesPayload {
  workspaces: RecentWorkspace[]
}

export interface RecentDocument {
  rel_path: string
  title: string
  opened_at: string
}

export interface RecentDocumentsPayload {
  documents: RecentDocument[]
}

// ---------- Phase 4：文件监听 ----------

export interface FsEvent {
  seq: number
  type: 'created' | 'modified' | 'deleted'
  rel: string
}

export interface FsEventsPayload {
  events: FsEvent[]
  last_seq: number
}

// ---------- Phase 4：标签 ----------

export interface TagInfo {
  name: string
  count: number
}

export interface TagListPayload {
  tags: TagInfo[]
}

export interface TagFilesPayload {
  tag: string
  count: number
  files: SearchResult[]
}

// ---------- Phase 4：附件 ----------

export interface AttachmentItem {
  rel_path: string
  name: string
  category: string
  size: number
  mtime: string
  referenced_by: string[]
}

export interface AttachmentListPayload {
  count: number
  attachments: AttachmentItem[]
}

export interface OrphanItem {
  name: string
  path: string
  size: number
  mtime: string
}

export interface OrphansPayload {
  count: number
  orphans: OrphanItem[]
}

// ---------- Phase 6：历史版本 / 异常恢复 / 索引 ----------

export interface HistoryVersion {
  /** 快照文件名 stem（YYYYMMDD-HHMMSS-mmm），作为版本标识 */
  id: string
  /** 本地时间 ISO（含毫秒，秒级展示） */
  timestamp: string
  size: number
}

export interface HistoryPayload {
  doc_path: string
  versions: HistoryVersion[]
}

export interface HistoryPreview {
  doc_path: string
  version_id: string
  content: string
}

export interface RecoveryItem {
  doc_path: string
  draft_path: string
  saved_at: string
  session_id: string
}

export interface RecoveryPayload {
  count: number
  items: RecoveryItem[]
}

export interface RebuildPayload {
  status: string
  stats: { document: number; module: number; attachment: number }
}

