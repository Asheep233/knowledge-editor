/**
 * UI 工坊：产品 guest Broker 后端（真实后端 HTTP / 真实打印管线）。
 *
 * - G1：`context.snapshot` 仅对具备 `context.read` 的连接返回正文（additive 字段）；
 * - G2：`context.write` 走真实 `POST /api/context/write`（completed/conflict/stale/failed 如实）；
 * - G3（T26）：`print.snapshot` 接**真实打印管线** —— 按参数 relPath 从后端读取可信快照
 *   （正文 + revision）→ PrintJobManager（产品渲染器 + Rust `print_snapshot_pdf`）→ 隔离输出目录
 *   产出真实 PDF → 返回不透明 `pdfToken`（宿主注册表可查真实路径）+ 页数（不可得 → null）；
 *   失败（能力/参数/读快照/渲染/打印）一律如实抛类型化错误，不返回假 token；
 * - W02：`command.invoke` 白名单命令（article.setTitle/setTags）。
 */
import { connectionHasCapability, type BrokerBackend, type BrokerConnection } from '../../core/broker/broker'
import { createProductPrintRenderer } from '../../core/print/productPrintRenderer'
import { PrintJobManager, type PrintJob, type PrintRenderer, type PrintTransport } from '../../core/print/printJob'
import { assertPrintTargetPath, resolvePrintTarget } from '../../core/print/printOutput'
import { registerPrintToken } from '../../core/print/printTokenRegistry'
import { createTauriPrintTransport } from '../../core/print/tauriPrintTransport'
import {
  createArticleMetaCommandHandler,
  fetchContextSnapshotWithContent,
  writeContextDocument,
  type ContextSnapshotWithContent,
} from '../../core/packs/productHostAdapter'
import { protocolError, type ProtocolMethods } from '../../core/protocol/types'
import { CoreSaveBridge } from '../../core/session/coreSaveBridge'

export const DEFAULT_CONTEXT_ID = 'ke-default'

let sharedBridge: CoreSaveBridge | null = null
function bridge(): CoreSaveBridge {
  if (!sharedBridge) {
    const base = (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__ ?? ''
    sharedBridge = new CoreSaveBridge({ baseUrl: base, contextId: DEFAULT_CONTEXT_ID })
  }
  return sharedBridge
}

export interface GuestContextInfo {
  contextId: string
  epoch: number
}

/** 当前宿主上下文（context/open 真实 epoch；G4 context-changed 也复用它）。 */
export async function contextInfo(): Promise<GuestContextInfo> {
  return await bridge().ensureContext()
}

/** 测试/切工作区：清空共享桥（避免跨测试串上下文）。 */
export function resetGuestContextBridgeForTests(): void {
  sharedBridge = null
}

/** 上下文 epoch 失效（宿主 Core 保存桥 switch 过上下文）→ 丢弃缓存，下次重新 open/switch。 */
export function refreshGuestContext(): void {
  sharedBridge?.invalidate()
}

function isStaleContextError(e: unknown): boolean {
  const message = String((e as Error)?.message ?? e)
  return /HTTP 409/.test(message) || /E_STALE_CONTEXT/.test(message) || /epoch 已过期/.test(message)
}

/**
 * 以「真实上下文」执行一次 guest 后端操作；遇到 epoch 失效（宿主保存桥 switch 过上下文）
 * 丢弃缓存上下文后重试一次 —— 否则 guest 在宿主 Core 保存后立刻读快照/打印会 409。
 * 仍失败则如实抛错。
 */
async function withGuestContext<T>(
  op: (ctx: GuestContextInfo) => Promise<T>,
  resolveContext: () => Promise<GuestContextInfo>,
): Promise<T> {
  const ctx = await resolveContext()
  try {
    return await op(ctx)
  } catch (e) {
    if (!isStaleContextError(e)) throw e
    refreshGuestContext()
    const fresh = await resolveContext()
    return await op(fresh)
  }
}

export interface GuestSnapshotOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  context?: () => Promise<GuestContextInfo>
}

/** guest 侧可信快照读取（带 epoch 失效重试；G1 内容读与 G3 打印共用）。 */
export async function fetchGuestSnapshot(
  relPath: string,
  includeContent: boolean,
  options: GuestSnapshotOptions = {},
): Promise<ContextSnapshotWithContent> {
  const resolveContext = options.context ?? contextInfo
  const read = (ctx: GuestContextInfo) =>
    fetchContextSnapshotWithContent(ctx, relPath, includeContent, {
      baseUrl: options.baseUrl ?? (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__ ?? '',
      fetchImpl: options.fetchImpl,
    })
  return await withGuestContext(read, resolveContext)
}

/** 解析文档当前真实 revision（G4 document-saved 的旧保存链补全；读不到 → 抛错不伪造）。 */
export async function resolveGuestRevision(relPath: string, options: GuestSnapshotOptions = {}): Promise<number> {
  const snapshot = await fetchGuestSnapshot(relPath, false, options)
  return snapshot.revision
}

function apiBaseOf(options: ProductBrokerBackendOptions): string {
  return options.baseUrl ?? (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__ ?? ''
}

/** 打印目标 relPath 的安全校验（工作区相对路径；不允许绝对/穿越/非 Markdown）。 */
export function normalizeGuestPrintRelPath(raw: unknown): string {
  if (typeof raw !== 'string') throw protocolError('E_BAD_PAYLOAD', 'print.snapshot 缺少 relPath')
  const rel = raw.trim().replace(/\\/g, '/')
  if (rel.length === 0 || rel.length > 512) throw protocolError('E_BAD_PAYLOAD', 'print.snapshot relPath 为空或过长')
  if (rel.includes('\0')) throw protocolError('E_BAD_PAYLOAD', 'print.snapshot relPath 含非法字符')
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    throw protocolError('E_BAD_PAYLOAD', `print.snapshot relPath 不允许绝对路径: ${rel}`)
  }
  const parts = rel.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw protocolError('E_BAD_PAYLOAD', `print.snapshot relPath 非法: ${rel}`)
  }
  if (!/\.(md|markdown)$/i.test(rel)) {
    throw protocolError('E_BAD_PAYLOAD', `print.snapshot 只支持 Markdown 文档: ${rel}`)
  }
  return rel
}

export interface ProductBrokerBackendOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** 上下文解析（默认 CoreSaveBridge.ensureContext；测试注入） */
  context?: () => Promise<GuestContextInfo>
  /** 打印渲染器/传输/输出目标（默认产品真实实现；测试注入以隔离真实 IO） */
  printRenderer?: PrintRenderer
  printTransport?: PrintTransport
  resolvePrintTarget?: (request: { relPath: string; revision: number }) => Promise<string>
}

export class ProductBrokerBackend implements BrokerBackend {
  private readonly options: ProductBrokerBackendOptions
  private printManager: PrintJobManager | null = null

  constructor(options: ProductBrokerBackendOptions = {}) {
    this.options = options
  }

  currentEpoch() {
    return 1
  }

  private baseUrl(): string {
    return apiBaseOf(this.options)
  }

  private context(): Promise<GuestContextInfo> {
    return this.options.context ? this.options.context() : contextInfo()
  }

  async snapshot(params: ProtocolMethods['context.snapshot']['params'], conn: BrokerConnection) {
    // G1：仅具备 context.read 的连接返回正文（Broker 已按能力拒绝无权限请求；此处第二道防线）。
    // 正文复用既有只读文档 API；读不到时退化为旧形状 {relPath,revision,diskHash}。
    return await fetchGuestSnapshot(params.relPath, connectionHasCapability(conn, 'context.read'), {
      baseUrl: this.baseUrl(),
      fetchImpl: this.options.fetchImpl,
      context: () => this.context(),
    })
  }

  async write(params: ProtocolMethods['context.write']['params'], _conn: BrokerConnection) {
    // G2：真实 /api/context/write；completed/conflict/stale/failed 如实返回，不伪造 revision/fileDurable。
    const ctx = await this.context()
    return await writeContextDocument(ctx, params, {
      baseUrl: this.baseUrl(),
      fetchImpl: this.options.fetchImpl,
    })
  }

  /** T26 G3：真实打印管线（能力：print.request；输出到宿主应用数据目录下的隔离 PDF）。 */
  async print(
    params: ProtocolMethods['print.snapshot']['params'],
    conn: BrokerConnection,
  ): Promise<ProtocolMethods['print.snapshot']['result']> {
    // 第二道能力防线（Broker.authorize 已按 METHOD_CAPABILITIES 拦截，这里防直调/漏配）。
    if (!connectionHasCapability(conn, 'print.request')) {
      throw protocolError('E_CAPABILITY', '缺少能力: print.request', {
        required: 'print.request',
        granted: conn.capabilities,
      })
    }
    const relPath = normalizeGuestPrintRelPath(params?.relPath)
    // 可信快照：正文 + revision 均来自后端（不是编辑器当前 DOM，也不隐式保存）；
    // 带 epoch 失效重试（宿主 Core 保存后上下文 epoch 可能已前进）。
    const snapshot = await fetchGuestSnapshot(relPath, true, {
      baseUrl: this.baseUrl(),
      fetchImpl: this.options.fetchImpl,
      context: () => this.context(),
    })
    if (typeof snapshot.content !== 'string' || snapshot.content.length === 0) {
      throw protocolError('E_INTERNAL', `E_PRINT_SNAPSHOT: 无法读取文档正文（${relPath}）`, { relPath })
    }
    const revision = snapshot.revision
    if (!Number.isInteger(revision) || revision < 0) {
      throw protocolError('E_INTERNAL', `E_PRINT_SNAPSHOT: 后端未返回合法 revision（${relPath}）`, { relPath })
    }
    const target = await (this.options.resolvePrintTarget ?? resolvePrintTarget)({ relPath, revision })
    let job: PrintJob
    try {
      job = await this.getPrintManager().enqueue({ relPath, revision, content: snapshot.content }, target)
    } catch (e) {
      // PrintJobManager 失败即真实失败：原样透出渲染/打印错误（不返回假 token/假页数）。
      throw protocolError('E_INTERNAL', `E_PRINT: ${String((e as Error)?.message ?? e)}`, {
        relPath,
        revision,
        target,
      })
    }
    if (job.state !== 'done' || !job.pdfPath) {
      throw protocolError('E_INTERNAL', `E_PRINT: 打印未完成（state=${job.state}${job.error ? `, ${job.error}` : ''}）`, {
        relPath,
        revision,
        target,
      })
    }
    const pages = Number.isInteger(job.pages) && (job.pages as number) > 0 ? (job.pages as number) : null
    const pdfToken = registerPrintToken({ pdfPath: job.pdfPath, relPath, revision, pages })
    return { pdfToken, pages }
  }

  private getPrintManager(): PrintJobManager {
    if (!this.printManager) {
      this.printManager = new PrintJobManager({
        renderer: this.options.printRenderer ?? createProductPrintRenderer(),
        transport: this.options.printTransport ?? createTauriPrintTransport(),
        // 打印是串行资源（单 renderer 窗口）；超时覆盖大文档渲染 + ready 握手 + PrintToPdf。
        maxConcurrent: 1,
        timeoutMs: 120_000,
        validateTargetPath: assertPrintTargetPath,
      })
    }
    return this.printManager
  }

  private commandHandler: ReturnType<typeof createArticleMetaCommandHandler> | null = null

  async invokeCommand(params: ProtocolMethods['command.invoke']['params']) {
    // W02：白名单命令（article.set-title/set-tags）→ 宿主原子写后端 meta；其余命令拒绝
    if (!this.commandHandler) {
      this.commandHandler = createArticleMetaCommandHandler({ baseUrl: this.baseUrl() })
    }
    return await this.commandHandler.invoke(params.name, params.args)
  }
}
