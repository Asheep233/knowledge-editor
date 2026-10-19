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

import { protocolError, type ProtocolMethods } from '../protocol/types'
import { HttpTransport } from '../session/httpTransport'
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

// ---------------- W02：product host 表单/元信息命令白名单 ----------------

export interface ArticleMetaCommandHandler {
  invoke(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; value?: unknown }>
}

export interface ArticleMetaCommandOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

function assertArticleRelPath(relPath: string): string {
  const rel = relPath.trim().replace(/\\/g, '/')
  if (!rel.startsWith('Articles/') || !rel.endsWith('.md') || rel.includes('..') || rel.includes('\0')) {
    throw new Error(`E_PATH: 非法文章路径 ${relPath}`)
  }
  return rel
}

/** W02 最小交接：guest 经 Broker command.invoke 提交 title/tags → 宿主原子写后端 meta。
 *  仅白名单命令；参数严格校验；未知命令一律拒绝。 */
export function createArticleMetaCommandHandler(options: ArticleMetaCommandOptions = {}): ArticleMetaCommandHandler {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  async function putMeta(relPath: string, body: Record<string, unknown>): Promise<{ ok: boolean; value?: unknown }> {
    const resp = await fetchImpl(`${baseUrl}/api/articles/${encodeURIComponent(relPath)}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`E_META: HTTP ${resp.status}`)
    const data = (await resp.json()) as { path?: string; title?: string; tags?: string[] }
    return { ok: true, value: { relPath: data.path ?? relPath, title: data.title, tags: data.tags } }
  }
  return {
    async invoke(name, args = {}) {
      if (name === 'article.set-title') {
        const relPath = assertArticleRelPath(String(args.relPath ?? ''))
        const title = String(args.title ?? '').trim()
        if (!title || title.length > 200) throw new Error('E_TITLE: 标题为空或过长')
        return await putMeta(relPath, { title })
      }
      if (name === 'article.set-tags') {
        const relPath = assertArticleRelPath(String(args.relPath ?? ''))
        const tags = args.tags
        if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
          throw new Error('E_TAGS: tags 必须是字符串数组')
        }
        return await putMeta(relPath, { tags })
      }
      throw new Error(`E_COMMAND_NOT_ALLOWED: 未授权命令 ${name}`)
    },
  }
}

// ---------------- T26 G1/G2：产品 guest 上下文读写（真实后端；不伪造 durability） ----------------

export interface GuestContextBinding {
  contextId: string
  epoch: number
}

export interface ContextIOOptions {
  /** 后端 base（默认同源相对路径，浏览器/Tauri 内直接可用） */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** 单次请求超时（ms，默认 15000；与 HttpTransport 一致） */
  timeoutMs?: number
}

export interface ContextSnapshotWithContent {
  relPath: string
  revision: number
  diskHash: string
  content?: string
  contentBytes?: number
}

interface SnapshotResponseBody {
  rel_path: string
  revision: number
  disk_hash: string
  context_id?: string
}

interface ArticleReadResponseBody {
  content?: string
}

function encodeRelPathForUrl(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/** content 的 UTF-8 字节数（与磁盘文件字节大小对应；JSON 反序列化不改变码点）。 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * A-10：宿主 fetch 超时/中止 → 协议错误 `E_TIMEOUT`（retryable=true）。
 * 其它网络/HTTP 错误原样抛出（由上层按各自语义处理，不吞错）。
 */
function isAbortError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name
  if (name === 'AbortError') return true
  return /aborted|abort/i.test(String((e as { message?: unknown } | null)?.message ?? e))
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: T | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetchImpl(`${baseUrl}${path}`, { ...init, signal: controller.signal })
    let body: T | null = null
    try {
      body = (await resp.json()) as T
    } catch {
      body = null
    }
    return { status: resp.status, body }
  } catch (e) {
    // 自建 AbortController 到点 abort（或 fetch 以 AbortError 中止）→ E_TIMEOUT（guest 可按 code 重试）
    if (controller.signal.aborted || isAbortError(e)) {
      throw protocolError('E_TIMEOUT', `宿主请求超时（${init.method ?? 'GET'} ${path}，${timeoutMs}ms）`, { path, timeoutMs }, true)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * B-6：判断错误是否属于「上下文绑定失效、重建绑定后可恢复」——
 * sidecar 崩溃自动重启后新后端内存上下文丢失（HTTP 404 `上下文不存在或已关闭`）或
 * epoch 失效（HTTP 409 / E_STALE_CONTEXT）。调用方（ProductBrokerBackend）据此**重试一次**。
 */
export function isRecoverableContextError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const code = (e as { code?: unknown }).code
  if (code === 'E_STALE_CONTEXT') return true
  const message = String((e as { message?: unknown }).message ?? e)
  if (/E_STALE_CONTEXT|epoch 已过期/.test(message)) return true
  // 快照/写请求在后端上下文缺失时的真实响应（E_SNAPSHOT: HTTP 404 / context write 失败: HTTP 404）
  if (/E_SNAPSHOT: HTTP (404|409)/.test(message)) return true
  if (/context write 失败: HTTP (404|409)/.test(message)) return true
  if (/上下文不存在|上下文已关闭/.test(message)) return true
  return false
}

/** 幂等 requestId（guest 写请求在「重建上下文后重试」时复用同一 id，避免重复写）。 */
export function createGuestRequestId(prefix = 'guest'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * G1（内容读通道）：读取上下文快照；`includeContent`（= 连接具备 `context.read`）时附带正文。
 *
 * 正文复用**既有**只读文档 API（`GET /api/articles/{rel}`，返回完整原文含 BOM/frontmatter/CRLF），
 * 不新增/不改后端接口。读不到正文（文件不存在/非文档路径/读失败）时退化为旧形状
 * （仅 `relPath/revision/diskHash`）——`content` 是可选增量字段，旧客户端忽略即可。
 */
export async function fetchContextSnapshotWithContent(
  binding: GuestContextBinding,
  relPath: string,
  includeContent: boolean,
  options: ContextIOOptions = {},
): Promise<ContextSnapshotWithContent> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  const timeoutMs = options.timeoutMs ?? 15000
  const snap = await requestJson<SnapshotResponseBody>(
    fetchImpl,
    baseUrl,
    '/api/context/snapshot',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_id: binding.contextId, epoch: binding.epoch, rel_path: relPath }),
    },
    timeoutMs,
  )
  if (snap.status !== 200 || !snap.body) throw new Error(`E_SNAPSHOT: HTTP ${snap.status}`)
  const result: ContextSnapshotWithContent = {
    relPath: snap.body.rel_path,
    revision: snap.body.revision,
    diskHash: snap.body.disk_hash,
  }
  if (!includeContent) return result
  try {
    const doc = await requestJson<ArticleReadResponseBody>(
      fetchImpl,
      baseUrl,
      `/api/articles/${encodeRelPathForUrl(relPath)}`,
      { method: 'GET' },
      timeoutMs,
    )
    if (doc.status === 200 && typeof doc.body?.content === 'string') {
      result.content = doc.body.content
      result.contentBytes = utf8ByteLength(doc.body.content)
    }
  } catch {
    /* 正文读取失败 → 保留旧形状（content 可选，不改变 snapshot 其余语义） */
  }
  return result
}

export interface ContextWriteOptions extends ContextIOOptions {
  /**
   * true = 传输/HTTP 失败向上抛出（供上层在「上下文绑定失效」时重建绑定后重试一次）；
   * 默认 false = 返回 `{status:'failed'}`（G2 协议语义，不伪造 revision/fileDurable）。
   */
  throwOnError?: boolean
}

/**
 * G2（真实写通道）：把 guest 的 `context.write` 接到真实 `POST /api/context/write`。
 *
 * 语义复用 `HttpTransport`（T10/T14 已验证的保存链传输层）：
 * - 200 `completed` → 原样透传真实 `revision/accepted/recoveryDurable/fileDurable`（**不伪造**）；
 * - 409 epoch 过期 → `stale`；revision/外部改盘冲突 → `conflict`（`kind/currentRevision` 透传）；
 * - 传输/其它 HTTP 失败 → `failed`（不携带 revision/fileDurable；`requestId` 幂等可经后端查询复核）；
 *   若 `throwOnError=true` 则向上抛出（B-6 重试判据）。
 */
export async function writeContextDocument(
  binding: GuestContextBinding,
  params: ProtocolMethods['context.write']['params'],
  options: ContextWriteOptions = {},
): Promise<ProtocolMethods['context.write']['result']> {
  const requestId = params.requestId ?? createGuestRequestId('guest-write')
  const transport = new HttpTransport({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  try {
    const result = await transport.write({
      contextId: binding.contextId,
      epoch: binding.epoch,
      relPath: params.relPath,
      content: params.content,
      expectedRevision: params.expectedRevision,
      requestId,
    })
    const mapped: ProtocolMethods['context.write']['result'] = {
      requestId: result.requestId || requestId,
      status: result.status,
    }
    if (result.status === 'completed') {
      mapped.revision = result.revision
      mapped.accepted = result.accepted
      mapped.recoveryDurable = result.recoveryDurable
      mapped.fileDurable = result.fileDurable
    } else if (result.status === 'conflict' || result.status === 'stale') {
      if (result.kind) mapped.kind = result.kind
      if (result.currentRevision !== undefined) mapped.currentRevision = result.currentRevision
    }
    return mapped
  } catch (e) {
    if (options.throwOnError) throw e
    return { requestId, status: 'failed' }
  }
}
