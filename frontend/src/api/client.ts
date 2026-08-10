/** 后端 API 客户端。开发期经 Vite 代理访问 /api。 */
import type {
  ArticleMeta,
  AttachmentListPayload,
  FsEventsPayload,
  HealthInfo,
  HistoryPayload,
  HistoryPreview,
  OrphansPayload,
  RebuildPayload,
  RecentDocumentsPayload,
  RecentWorkspacesPayload,
  RecoveryPayload,
  SearchPayload,
  TagFilesPayload,
  TagListPayload,
  TreePayload,
  WorkspaceState,
} from '../types'
import { filenameFromDisposition, slugForDownload } from '../editor/import-export'

/**
 * 运行时 API 基址（Phase 7 M2）。
 * 桌面版由 main.tsx 挂载前调用 Rust `get_runtime_info` 写入 `window.__KE_API_BASE__`；
 * Web 开发/测试未注入时为空，回退相对路径（Vite 代理 /api），既有 vitest 单测不受影响。
 */
export function apiBase(): string {
  return window.__KE_API_BASE__ ?? ''
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      /* 忽略非 JSON 响应 */
    }
    throw new Error(`${res.status} ${detail}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function getHealth(): Promise<HealthInfo> {
  return request<HealthInfo>('/api/health')
}

export function getTree(): Promise<TreePayload> {
  return request<TreePayload>('/api/tree')
}

export function getArticle(id: string): Promise<ArticleMeta> {
  return request<ArticleMeta>(`/api/articles/${encodeURIComponent(id)}`)
}

export function createArticle(title: string, content = ''): Promise<ArticleMeta> {
  return request<ArticleMeta>('/api/articles', {
    method: 'POST',
    body: JSON.stringify({ title, content }),
  })
}

export function saveArticle(id: string, content: string): Promise<ArticleMeta> {
  return request<ArticleMeta>(`/api/articles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

export function search(q: string): Promise<SearchPayload> {
  return request<SearchPayload>(`/api/search?q=${encodeURIComponent(q)}`)
}

export function deleteArticle(id: string): Promise<void> {
  return request<void>(`/api/articles/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---------- Phase 4.1 Workspace ----------

export function getWorkspaceCurrent(): Promise<WorkspaceState> {
  return request<WorkspaceState>('/api/workspace/current')
}

export function createWorkspace(path: string): Promise<WorkspaceState> {
  return request<WorkspaceState>('/api/workspace/create', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export function openWorkspace(path: string): Promise<WorkspaceState> {
  return request<WorkspaceState>('/api/workspace/open', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export function closeWorkspace(): Promise<WorkspaceState> {
  return request<WorkspaceState>('/api/workspace/close', { method: 'POST' })
}

export function getRecentWorkspaces(): Promise<RecentWorkspacesPayload> {
  return request<RecentWorkspacesPayload>('/api/workspace/recent')
}

// ---------- Phase 4.8 最近文档（软件配置文件存储） ----------
export function getRecentDocuments(): Promise<RecentDocumentsPayload> {
  return request<RecentDocumentsPayload>('/api/workspace/recent-documents')
}

export function recordRecentDocument(relPath: string, title: string): Promise<unknown> {
  return request<unknown>('/api/workspace/recent-documents', {
    method: 'POST',
    body: JSON.stringify({ rel_path: relPath, title }),
  })
}

export function clearRecentDocuments(): Promise<void> {
  return request<void>('/api/workspace/recent-documents', { method: 'DELETE' })
}

// ---------- Phase 4.2 文件树操作 ----------

export function createFolder(path: string): Promise<{ path: string; created: boolean }> {
  return request('/api/fs/dir', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export function renameFolder(path: string, newName: string): Promise<{ from: string; to: string }> {
  return request('/api/fs/dir', {
    method: 'PUT',
    body: JSON.stringify({ path, new_name: newName }),
  })
}

export function deleteFolder(path: string): Promise<void> {
  return request<void>(`/api/fs/dir?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

export function createDocIn(dir: string, title: string): Promise<{ id: string; path: string }> {
  return request('/api/fs/doc', {
    method: 'POST',
    body: JSON.stringify({ dir, title }),
  })
}

export function renameDoc(path: string, newName: string): Promise<{ from: string; to: string }> {
  return request('/api/fs/doc', {
    method: 'PUT',
    body: JSON.stringify({ path, new_name: newName }),
  })
}

export function movePath(src: string, dst: string): Promise<{ from: string; to: string }> {
  return request('/api/fs/move', {
    method: 'POST',
    body: JSON.stringify({ src, dst }),
  })
}

// ---------- Phase 4.3 文件监听 ----------

export function getFsEvents(since: number): Promise<FsEventsPayload> {
  return request<FsEventsPayload>(`/api/fs/events?since=${since}`)
}

// ---------- Phase 4.5 标签 ----------

export function getTags(): Promise<TagListPayload> {
  return request<TagListPayload>('/api/tags')
}

export function getFilesByTag(tag: string): Promise<TagFilesPayload> {
  return request<TagFilesPayload>(`/api/tags/${encodeURIComponent(tag)}`)
}

export function updateArticleMeta(
  id: string,
  body: { title?: string; tags?: string[] },
): Promise<ArticleMeta> {
  return request<ArticleMeta>(`/api/articles/${encodeURIComponent(id)}/meta`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// ---------- Phase 4.7 附件 ----------

export function listAttachments(): Promise<AttachmentListPayload> {
  return request<AttachmentListPayload>('/api/attachments/list')
}

export function listOrphans(): Promise<OrphansPayload> {
  return request<OrphansPayload>('/api/attachments/orphans')
}

/** 删除附件（仅孤儿附件允许，被引用附件后端返回 409；需用户显式确认后调用） */
export function deleteAttachment(rel: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(
    `/api/attachments/${rel.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'DELETE' },
  )
}

/** 打开附件（后端静态服务，新窗口打开）；合并自 editor/ke.ts（P9，URI 编码以本实现为准） */
export function attachmentUrl(rel: string): string {
  return apiBase() + `/api/attachments/${rel.split('/').map(encodeURIComponent).join('/')}`
}

export interface UploadResult {
  path: string
  url: string
  category: 'images' | 'videos' | 'files'
  size: number
  name: string
}

/** 上传附件（约束 4：返回 workspace 相对路径 path，序列化时持久化相对路径） */
export async function uploadAttachment(file: File): Promise<UploadResult> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(apiBase() + '/api/attachments', { method: 'POST', body: fd })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      /* 忽略非 JSON */
    }
    throw new Error(`${res.status} ${detail}`)
  }
  return (await res.json()) as UploadResult
}

// ---------- Phase 5 模块 ----------

export interface ModuleInfo {
  name: string
  path: string
  title: string
  tags: string
}

export interface ModuleListPayload {
  count: number
  modules: ModuleInfo[]
}

export interface ModuleContent {
  name: string
  path: string
  meta: Record<string, unknown>
  content: string
}

/** 模块列表（Modules/ 下全部 Markdown，含子目录，path 为完整相对路径） */
export function listModules(): Promise<ModuleListPayload> {
  return request<ModuleListPayload>('/api/modules')
}

/** 读取模块 Markdown 原文（path 如 Modules/Math/Definition.md，支持子目录） */
export function getModule(relPath: string): Promise<ModuleContent> {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/')
  return request<ModuleContent>(`/api/modules/${encoded}`)
}

// ---------- Phase 3E 导入导出 ----------

export interface ExportPackageBody {
  title: string
  md: string
  refs: string[]
}

export interface ImportedAttachment {
  from: string
  to: string
  reused: boolean
}

export interface ImportResult {
  id: string
  path: string
  title: string
  created: boolean
  imported?: {
    attachments: ImportedAttachment[]
    rewritten_refs?: number
  }
}

/** 导出文档包 .zip（后端打包附件，返回 blob 与 Content-Disposition 文件名） */
export async function exportPackage(body: ExportPackageBody): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(apiBase() + '/api/export/package', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const err = (await res.json()) as { detail?: string }
      if (err.detail) detail = err.detail
    } catch {
      /* 忽略 */
    }
    throw new Error(`${res.status} ${detail}`)
  }
  const blob = await res.blob()
  const fallback = `${slugForDownload(body.title)}_export.zip`
  const disposition = res.headers.get('content-disposition')
  return { blob, filename: disposition ? filenameFromDisposition(disposition, fallback) : fallback }
}

/** 导入普通 Markdown 文件 */
export async function importMarkdown(file: File): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(apiBase() + '/api/import/markdown', { method: 'POST', body: fd })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const err = (await res.json()) as { detail?: string }
      if (err.detail) detail = err.detail
    } catch {
      /* 忽略 */
    }
    throw new Error(`${res.status} ${detail}`)
  }
  return (await res.json()) as ImportResult
}

/** 导入文档包 .zip */
export async function importPackage(file: File): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(apiBase() + '/api/import/package', { method: 'POST', body: fd })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const err = (await res.json()) as { detail?: string }
      if (err.detail) detail = err.detail
    } catch {
      /* 忽略 */
    }
    throw new Error(`${res.status} ${detail}`)
  }
  return (await res.json()) as ImportResult
}

// ---------- Phase 6：索引 / 历史版本 / 异常恢复 ----------

/** 重建全文索引（搜索区域按钮调用） */
export function rebuildIndex(): Promise<RebuildPayload> {
  return request<RebuildPayload>('/api/index/rebuild', { method: 'POST' })
}

/** 历史版本列表（按时间倒序，最多 30 份） */
export function listHistory(docPath: string): Promise<HistoryPayload> {
  return request<HistoryPayload>(`/api/history/list?doc=${encodeURIComponent(docPath)}`)
}

/** 只读预览历史版本内容 */
export function previewHistory(docPath: string, versionId: string): Promise<HistoryPreview> {
  return request<HistoryPreview>(
    `/api/history/preview?doc=${encodeURIComponent(docPath)}&version_id=${encodeURIComponent(versionId)}`,
  )
}

/** 恢复历史版本：写回 Markdown + 更新索引，返回最新文档内容 */
export function restoreHistory(docPath: string, versionId: string): Promise<ArticleMeta> {
  return request<ArticleMeta>('/api/history/restore', {
    method: 'POST',
    body: JSON.stringify({ doc_path: docPath, version_id: versionId }),
  })
}

/** 待恢复内容列表（启动检测） */
export function listRecovery(): Promise<RecoveryPayload> {
  return request<RecoveryPayload>('/api/drafts/recovery')
}

/** 登记恢复点：content 写入草稿文件，供异常退出后恢复 */
export function registerRecovery(docPath: string, content: string): Promise<unknown> {
  return request<unknown>('/api/drafts/recovery', {
    method: 'POST',
    body: JSON.stringify({ doc_path: docPath, content }),
  })
}

/** 丢弃恢复点：清记录 + 删草稿文件 */
export function discardRecovery(docPath: string): Promise<void> {
  return request<void>(`/api/drafts/recovery/${encodeURIComponent(docPath)}`, { method: 'DELETE' })
}

/** 恢复草稿内容到原文档：写回 Markdown + 更新索引，返回最新文档内容 */
export function restoreRecovery(docPath: string): Promise<ArticleMeta> {
  return request<ArticleMeta>('/api/drafts/recovery/restore', {
    method: 'POST',
    body: JSON.stringify({ doc_path: docPath }),
  })
}

