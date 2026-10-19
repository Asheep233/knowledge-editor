/**
 * UI 工坊：产品 guest Broker 后端（真实后端 HTTP / 真实打印管线）。
 *
 * - G1：`context.snapshot` 仅对具备 `context.read` 的连接返回正文（additive 字段）；
 * - G2：`context.write` 走真实 `POST /api/context/write`（completed/conflict/stale/failed 如实）；
 * - G3（T26）：`print.snapshot` 接**真实打印管线** —— 按参数 relPath 从后端读取可信快照
 *   （正文 + revision）→ PrintJobManager（产品渲染器 + Rust `print_snapshot_pdf`）→ 隔离输出目录
 *   产出真实 PDF → 返回不透明 `pdfToken`（宿主注册表可查真实路径）+ 页数（不可得 → null）；
 *   失败（能力/参数/读快照/渲染/打印）一律如实抛类型化错误，不返回假 token；
 * - W07 B-6：sidecar 崩溃自动重启后新后端内存上下文丢失（HTTP 404）→ 丢弃缓存绑定、
 *   重新 ensureContext（context/open）后**重试一次**（snapshot/write/print 读取路径共用）；
 * - W07 A-10：宿主 fetch 超时 → 协议错误 `E_TIMEOUT`（retryable=true），guest 可按 code 区分超时；
 * - W02：`command.invoke` 白名单命令（article.setTitle/setTags）；
 * - T26 F03：`command.invoke` 新增 `editor.*` **受控编辑器命令桥**（14 条最小白名单，
 *   需连接具备 `editor.commands.readonly`；真正执行由主窗口 EditorArea 注册的
 *   `window.__KE_WORKSHOP_EDITOR__` 受控执行器完成，不暴露任意命令）；
 * - W07 task-27：editor.* 协议名统一为**小写 kebab**（`editor.bullet-list` 等，可写入
 *   manifest.commands[].name 的 `^[a-z][a-z0-9.-]{1,80}$` 校验），内部映射到 camelCase
 *   执行键；旧 camelCase 协议名保留兼容接受（manifest 无法声明，legacy）；
 * - W07 task-29：追加可无头**无参**产品动作（`editor.footnote.insert`/`editor.note.insert`/
 *   `doc.save`，复用 state/shortcuts 的 `runAction` 真实 action handler）；
 * - W07 task-33：追加 4 条**参数化无头命令**（`editor.link.insert`/`editor.math.inline`/
 *   `editor.math.block`/`editor.table.insert`，严格 args 校验 → 编辑器执行器带参执行，
 *   危险 scheme/超长/越界一律 E_BAD_PAYLOAD 且不执行）；对话框类动作仍不暴露未接。
 */
import { connectionHasCapability, type BrokerBackend, type BrokerConnection } from '../../core/broker/broker'
import { createProductPrintRenderer } from '../../core/print/productPrintRenderer'
import { PrintJobManager, type PrintJob, type PrintRenderer, type PrintTransport } from '../../core/print/printJob'
import { assertPrintTargetPath, resolvePrintTarget } from '../../core/print/printOutput'
import { registerPrintToken } from '../../core/print/printTokenRegistry'
import { createTauriPrintTransport } from '../../core/print/tauriPrintTransport'
import {
  createArticleMetaCommandHandler,
  createGuestRequestId,
  fetchContextSnapshotWithContent,
  isRecoverableContextError,
  writeContextDocument,
  type ContextSnapshotWithContent,
} from '../../core/packs/productHostAdapter'
import { protocolError, type ProtocolMethods } from '../../core/protocol/types'
import { runAction, type RunResult } from '../../state/shortcuts'
import { CoreSaveBridge } from '../../core/session/coreSaveBridge'

export const DEFAULT_CONTEXT_ID = 'ke-default'

// ---------------- T26 F03：受控 guest 编辑器命令桥（最小白名单，不暴露任意命令） ----------------

/**
 * guest 可经 `command.invoke` 请求的编辑器命令（协议名 = `editor.<command>`，小写）。
 * 白名单最小化：只含「切换类/历史类」命令，不含任何文本插入/删除/选区/自定义命令；
 * 与 EditorArea 的执行器映射通过 TS `Record<WorkshopEditorCommand, ...>` 编译期对齐。
 */
export const WORKSHOP_EDITOR_COMMAND_WHITELIST = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'heading1',
  'heading2',
  'heading3',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'undo',
  'redo',
] as const

export type WorkshopEditorCommand = (typeof WORKSHOP_EDITOR_COMMAND_WHITELIST)[number]

/**
 * T26 F03 / W07 task-27：**协议名 → 内部执行键**映射。
 *
 * 协议名必须能写进 `manifest.commands[].name`，而该字段校验为
 * `^[a-z][a-z0-9.-]{1,80}$`（**不允许大写**）→ 多词命令必须用 kebab-case：
 * `editor.bullet-list` / `editor.ordered-list` / `editor.code-block`；单命令词保持 `editor.bold` 等。
 * 内部执行键（camelCase，与 EditorArea `WORKSHOP_EDITOR_EXECUTORS` 对齐）仅用于宿主执行映射。
 * 旧 camelCase 协议名（如 `editor.bulletList`）保留**兼容接受**（既有测试/直调），但 manifest
 * 无法声明（schema 不允许大写），属于显式 legacy 路径。
 */
const PROTOCOL_TO_COMMAND = {
  'editor.bold': 'bold',
  'editor.italic': 'italic',
  'editor.underline': 'underline',
  'editor.strike': 'strike',
  'editor.code': 'code',
  'editor.heading1': 'heading1',
  'editor.heading2': 'heading2',
  'editor.heading3': 'heading3',
  'editor.bullet-list': 'bulletList',
  'editor.ordered-list': 'orderedList',
  'editor.blockquote': 'blockquote',
  'editor.code-block': 'codeBlock',
  'editor.undo': 'undo',
  'editor.redo': 'redo',
} as const satisfies Record<string, WorkshopEditorCommand>

/** 规范化（可与 manifest 声明）的协议名集合，顺序与白名单一致。 */
export type WorkshopEditorProtocolName = keyof typeof PROTOCOL_TO_COMMAND

export const WORKSHOP_EDITOR_PROTOCOL_NAMES = Object.keys(PROTOCOL_TO_COMMAND) as WorkshopEditorProtocolName[]

/** 协议名（含 legacy camelCase）联合类型。 */
export type WorkshopEditorInvokeName = WorkshopEditorProtocolName | `editor.${WorkshopEditorCommand}`

export interface ResolvedWorkshopEditorCommand {
  /** 内部执行键（交给 EditorArea 执行器） */
  command: WorkshopEditorCommand
  /** 规范化协议名（kebab，可写入 manifest） */
  protocolName: WorkshopEditorProtocolName
  /** true = 命中的是旧 camelCase 兼容名（manifest 无法声明，仅直调兼容） */
  legacy: boolean
}

/** `editor.*` 名称 → 内部执行键（规范 kebab 优先；旧 camelCase 兼容一次）。未知 → null。 */
export function resolveWorkshopEditorCommand(name: unknown): ResolvedWorkshopEditorCommand | null {
  if (typeof name !== 'string' || !name.startsWith('editor.')) return null
  const canonical = PROTOCOL_TO_COMMAND[name as WorkshopEditorProtocolName]
  if (canonical) {
    return { command: canonical, protocolName: name as WorkshopEditorProtocolName, legacy: false }
  }
  // 兼容旧 camelCase：editor.bulletList / editor.orderedList / editor.codeBlock 等
  const legacyKey = name.slice('editor.'.length)
  if ((WORKSHOP_EDITOR_COMMAND_WHITELIST as readonly string[]).includes(legacyKey)) {
    const command = legacyKey as WorkshopEditorCommand
    const protocolName = (Object.keys(PROTOCOL_TO_COMMAND) as WorkshopEditorProtocolName[]).find(
      (key) => PROTOCOL_TO_COMMAND[key] === command,
    )
    return protocolName ? { command, protocolName, legacy: true } : null
  }
  return null
}

/** 受控执行器返回（`error` 为符号名，如 E_COMMAND_NOT_ALLOWED / E_EDITOR_NOT_READY）。 */
export interface WorkshopEditorExecutorResult {
  ok: boolean
  error?: string
}

/** 主窗口 EditorArea 注册的受控执行器；不存在 = 编辑器未就绪（不得假成功）。 */
export interface WorkshopEditorExecutor {
  /** W07 task-33：签名扩展为 `(name, args?)`；无参命令收到非空 args 由执行器拒绝（E_BAD_PAYLOAD）。 */
  execute(name: string, args?: Record<string, unknown>): WorkshopEditorExecutorResult
}

interface WorkshopEditorHolder {
  __KE_WORKSHOP_EDITOR__?: WorkshopEditorExecutor
}

export function getWorkshopEditorExecutor(): WorkshopEditorExecutor | null {
  const holder = (typeof window !== 'undefined' ? window : globalThis) as WorkshopEditorHolder
  const executor = holder.__KE_WORKSHOP_EDITOR__
  return executor && typeof executor.execute === 'function' ? executor : null
}

/** `editor.*` 且能解析到白名单内部键（规范 kebab 或旧 camelCase；大小写敏感）。 */
export function isWorkshopEditorInvokeName(name: unknown): name is WorkshopEditorInvokeName {
  return resolveWorkshopEditorCommand(name) !== null
}

// ---------------- W07 task-29：可无头执行的产品 action（复用 action 注册表） ----------------

/**
 * W07 task-29：可无头执行的**无参产品动作**（协议名 = 既有 action id，全部匹配 manifest
 * `commands[].name` 正则；逐条声明、最小化）。
 *
 * 只接「不需要参数、不需要对话框/文件选择」的动作：脚注插入、信息块插入、文档保存。
 * （`editor.table.insert` 在 task-33 升级为**参数化命令**，走执行器 insertTable(rows/cols/...)；
 * link/math/module 等对话框动作仍不接，改为参数化无头命令或保持不暴露。）
 */
export const WORKSHOP_EDITOR_ACTION_WHITELIST = [
  'editor.footnote.insert',
  'editor.note.insert',
  'doc.save',
] as const

export type WorkshopEditorActionName = (typeof WORKSHOP_EDITOR_ACTION_WHITELIST)[number]

export function isWorkshopEditorActionName(name: unknown): name is WorkshopEditorActionName {
  return typeof name === 'string' && (WORKSHOP_EDITOR_ACTION_WHITELIST as readonly string[]).includes(name)
}

// ---------------- W07 task-33：参数化无头命令（严格 args 校验） ----------------

/** 参数化命令协议名（均匹配 manifest 正则；逐条声明）→ 执行器内部键。 */
export const WORKSHOP_EDITOR_PARAM_COMMANDS = [
  'editor.link.insert',
  'editor.math.inline',
  'editor.math.block',
  'editor.table.insert',
] as const

export type WorkshopEditorParamName = (typeof WORKSHOP_EDITOR_PARAM_COMMANDS)[number]
export type WorkshopEditorParamKey = 'linkInsert' | 'mathInline' | 'mathBlock' | 'tableInsert'

export const WORKSHOP_EDITOR_PARAM_KEY: Record<WorkshopEditorParamName, WorkshopEditorParamKey> = {
  'editor.link.insert': 'linkInsert',
  'editor.math.inline': 'mathInline',
  'editor.math.block': 'mathBlock',
  'editor.table.insert': 'tableInsert',
}

export function isWorkshopEditorParamName(name: unknown): name is WorkshopEditorParamName {
  return typeof name === 'string' && (WORKSHOP_EDITOR_PARAM_COMMANDS as readonly string[]).includes(name)
}

export interface WorkshopLinkArgs {
  href: string
  text?: string
}

export interface WorkshopMathArgs {
  latex: string
}

export interface WorkshopTableArgs {
  rows: number
  cols: number
  withHeaderRow: boolean
}

export type WorkshopEditorParamArgs = WorkshopLinkArgs | WorkshopMathArgs | WorkshopTableArgs

export interface WorkshopEditorArgsValidation {
  ok: boolean
  /** 失败原因（人类可读；成功时 undefined） */
  error?: string
  /** 规范化后的参数（缺省值已填充；成功时存在） */
  value?: WorkshopEditorParamArgs
}

const LINK_HREF_MAX = 2048
const LINK_TEXT_MAX = 500
const MATH_LATEX_MAX = 2000
const TABLE_MIN = 1
const TABLE_MAX = 8
/** 控制字符（允许常见空白 \t \n \r；其余拒绝）。 */
const CONTROL_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function isPlainArgsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(obj).every((key) => allowed.includes(key))
}

/** 空/缺省 args（无参命令的唯一合法形态）。 */
export function isEmptyCommandArgs(args: unknown): boolean {
  if (args === undefined || args === null) return true
  return isPlainArgsObject(args) && Object.keys(args).length === 0
}

function validateLinkArgs(args: Record<string, unknown>): WorkshopEditorArgsValidation {
  if (!hasOnlyKeys(args, ['href', 'text'])) return { ok: false, error: '仅允许 href/text 参数' }
  if (typeof args.href !== 'string') return { ok: false, error: 'href 必须是字符串' }
  const href = args.href.trim()
  if (href.length === 0) return { ok: false, error: 'href 不能为空' }
  if (href.length > LINK_HREF_MAX) return { ok: false, error: `href 超长（>${LINK_HREF_MAX}）` }
  // 拒绝控制字符/空白（URL 中不应出现裸空白）
  if (CONTROL_EXCEPT_WHITESPACE.test(href) || /\s/.test(href)) {
    return { ok: false, error: 'href 含控制字符/空白' }
  }
  // 严格 scheme 白名单：http(s)/mailto；javascript:/data:/file:/相对路径等一律拒绝
  const schemeOk = /^https?:\/\/[^\s]+$/i.test(href) || /^mailto:[^\s]+$/i.test(href)
  if (!schemeOk) return { ok: false, error: 'href 仅允许 http://、https://、mailto:' }
  let text: string | undefined
  if (args.text !== undefined) {
    if (typeof args.text !== 'string') return { ok: false, error: 'text 必须是字符串' }
    if (args.text.length > LINK_TEXT_MAX) return { ok: false, error: `text 超长（>${LINK_TEXT_MAX}）` }
    if (CONTROL_EXCEPT_WHITESPACE.test(args.text)) return { ok: false, error: 'text 含控制字符' }
    text = args.text.length > 0 ? args.text : undefined
  }
  return { ok: true, value: text === undefined ? { href } : { href, text } }
}

function validateMathArgs(args: Record<string, unknown>): WorkshopEditorArgsValidation {
  if (!hasOnlyKeys(args, ['latex'])) return { ok: false, error: '仅允许 latex 参数' }
  if (typeof args.latex !== 'string') return { ok: false, error: 'latex 必须是字符串' }
  const latex = args.latex
  if (latex.length === 0) return { ok: false, error: 'latex 不能为空' }
  if (latex.length > MATH_LATEX_MAX) return { ok: false, error: `latex 超长（>${MATH_LATEX_MAX}）` }
  if (CONTROL_EXCEPT_WHITESPACE.test(latex)) return { ok: false, error: 'latex 含控制字符' }
  return { ok: true, value: { latex } }
}

function validateTableArgs(args: Record<string, unknown>): WorkshopEditorArgsValidation {
  if (!hasOnlyKeys(args, ['rows', 'cols', 'withHeaderRow'])) {
    return { ok: false, error: '仅允许 rows/cols/withHeaderRow 参数' }
  }
  const readDim = (key: 'rows' | 'cols'): { ok: true; value: number } | { ok: false; error: string } => {
    if (args[key] === undefined) return { ok: true, value: 3 }
    const value = args[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < TABLE_MIN || value > TABLE_MAX) {
      return { ok: false, error: `${key} 必须是 ${TABLE_MIN}-${TABLE_MAX} 的整数` }
    }
    return { ok: true, value }
  }
  const rows = readDim('rows')
  if (!rows.ok) return { ok: false, error: rows.error }
  const cols = readDim('cols')
  if (!cols.ok) return { ok: false, error: cols.error }
  let withHeaderRow = true
  if (args.withHeaderRow !== undefined) {
    if (typeof args.withHeaderRow !== 'boolean') return { ok: false, error: 'withHeaderRow 必须是布尔值' }
    withHeaderRow = args.withHeaderRow
  }
  return { ok: true, value: { rows: rows.value, cols: cols.value, withHeaderRow } }
}

/**
 * 严格校验参数化命令 args（协议层第一道防线；EditorArea 执行器再做类型防御）：
 * - `editor.link.insert`：{href ≤2048, 仅 http/https/mailto, text ≤500}；
 * - `editor.math.inline|block`：{latex ≤2000, 拒绝控制字符（常见空白除外）}；
 * - `editor.table.insert`：{rows/cols 整数 1-8 缺省 3, withHeaderRow 布尔缺省 true}。
 * 失败 → `{ok:false,error}`（调用方如实映射 E_BAD_PAYLOAD，不执行）。
 */
export function validateWorkshopEditorArgs(name: string, args: unknown): WorkshopEditorArgsValidation {
  if (!isWorkshopEditorParamName(name)) return { ok: false, error: '非参数化命令' }
  // 缺省 args（undefined/null）等价空对象：table 可全缺省；link/math 由各自必填校验拒绝
  const raw = args === undefined || args === null ? {} : args
  if (!isPlainArgsObject(raw)) return { ok: false, error: 'args 必须是对象' }
  const parsed = raw as Record<string, unknown>
  switch (name) {
    case 'editor.link.insert':
      return validateLinkArgs(parsed)
    case 'editor.math.inline':
    case 'editor.math.block':
      return validateMathArgs(parsed)
    case 'editor.table.insert':
      return validateTableArgs(parsed)
    default:
      return { ok: false, error: '非参数化命令' }
  }
}

/** guest 命令桥接受的全部协议名（14 切换 + 4 参数化 + 3 无参动作 = 21 条；供诊断/单测）。 */
export const WORKSHOP_COMMAND_PROTOCOL_NAMES: readonly string[] = [
  ...WORKSHOP_EDITOR_PROTOCOL_NAMES,
  ...WORKSHOP_EDITOR_PARAM_COMMANDS,
  ...WORKSHOP_EDITOR_ACTION_WHITELIST,
]

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

/**
 * 以「真实上下文」执行一次 guest 后端操作；遇到**可恢复的上下文失效**时丢弃缓存绑定后重试一次：
 * - B-6：sidecar 崩溃自动重启 → 新后端内存上下文丢失，快照/写返回 HTTP 404（`E_SNAPSHOT` /
 *   `context write 失败`）→ 重新 ensureContext（context/open 重建绑定）后重试；
 * - 既有：宿主保存桥 switch 过上下文导致 epoch 失效（HTTP 409 / E_STALE_CONTEXT）。
 * 只重试一次（不无限循环）；仍失败则如实抛错，不吞错。
 */
async function withGuestContext<T>(
  op: (ctx: GuestContextInfo) => Promise<T>,
  resolveContext: () => Promise<GuestContextInfo>,
): Promise<T> {
  const ctx = await resolveContext()
  try {
    return await op(ctx)
  } catch (e) {
    if (!isRecoverableContextError(e)) throw e
    refreshGuestContext()
    const fresh = await resolveContext()
    return await op(fresh)
  }
}

export interface GuestSnapshotOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  context?: () => Promise<GuestContextInfo>
  /** 单次宿主请求超时（ms；A-10：超时映射 E_TIMEOUT/retryable） */
  timeoutMs?: number
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
      timeoutMs: options.timeoutMs,
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
  /** 单次宿主请求超时（ms，默认 15000；A-10 超时 → E_TIMEOUT/retryable；测试可缩短） */
  requestTimeoutMs?: number
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
      timeoutMs: this.options.requestTimeoutMs,
    })
  }

  async write(params: ProtocolMethods['context.write']['params'], _conn: BrokerConnection) {
    // G2：真实 /api/context/write；completed/conflict/stale/failed 如实返回，不伪造 revision/fileDurable。
    // B-6：sidecar 重启后上下文丢失（HTTP 404）→ 重建绑定后**重试一次**；requestId 幂等复用。
    const requestId = params.requestId ?? createGuestRequestId('guest-write')
    try {
      return await withGuestContext(
        (ctx) =>
          writeContextDocument(ctx, { ...params, requestId }, {
            baseUrl: this.baseUrl(),
            fetchImpl: this.options.fetchImpl,
            timeoutMs: this.options.requestTimeoutMs,
            throwOnError: true,
          }),
        () => this.context(),
      )
    } catch {
      // 重试后仍失败 / 非可恢复错误：按 G2 协议语义如实返回 failed（不伪造 revision/fileDurable）
      return { requestId, status: 'failed' as const }
    }
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
      timeoutMs: this.options.requestTimeoutMs,
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

  /**
   * T26 F03：`editor.*` 受控编辑器命令桥。
   * 顺序：协议名/白名单（未知 → E_COMMAND_NOT_ALLOWED）→ 连接能力 `editor.commands.readonly`
   * （否则 E_CAPABILITY）→ 主窗口执行器（缺失 → E_EDITOR_NOT_READY）→ 执行结果如实映射
   * （失败不返回假成功）。执行器本身也只认白名单（第二道防线，见 EditorArea）。
   */
  private async invokeEditorCommand(
    name: WorkshopEditorInvokeName,
    conn: BrokerConnection,
    args?: Record<string, unknown> | null,
  ): Promise<ProtocolMethods['command.invoke']['result']> {
    const resolved = resolveWorkshopEditorCommand(name)
    if (!resolved) {
      throw protocolError('E_FORBIDDEN', `E_COMMAND_NOT_ALLOWED: 未授权编辑命令 ${String(name)}`, {
        name,
        protocolNames: [...WORKSHOP_COMMAND_PROTOCOL_NAMES],
      })
    }
    // W07 task-33：14 条切换命令为**无参命令** → 收到非空 args 明确拒绝（不静默忽略）
    if (!isEmptyCommandArgs(args)) {
      throw protocolError('E_BAD_PAYLOAD', `E_BAD_PAYLOAD: ${String(name)} 不接受参数`, { name })
    }
    if (!connectionHasCapability(conn, 'editor.commands.readonly')) {
      throw protocolError('E_CAPABILITY', '缺少能力: editor.commands.readonly', {
        required: 'editor.commands.readonly',
        granted: conn.capabilities,
      })
    }
    const executor = getWorkshopEditorExecutor()
    if (!executor) {
      throw protocolError('E_INTERNAL', 'E_EDITOR_NOT_READY: 编辑器未就绪（主窗口 EditorArea 未挂载）', {
        name,
        protocolName: resolved.protocolName,
      })
    }
    let result: WorkshopEditorExecutorResult
    try {
      // 协议名（kebab/legacy）→ 内部执行键（EditorArea 白名单映射）
      result = executor.execute(resolved.command)
    } catch (e) {
      throw protocolError('E_INTERNAL', `E_COMMAND_EXECUTION_FAILED: ${String((e as Error)?.message ?? e)}`, { name })
    }
    if (!result || result.ok !== true) {
      throw protocolError('E_INTERNAL', `E_COMMAND_EXECUTION_FAILED: ${result?.error ?? '执行器未返回成功'}`, { name })
    }
    // 契约形状保持 {ok,value:{name,executed}}（回显 guest 请求的原始协议名；映射细节不扩返回面）
    return { ok: true, value: { name, executed: true } }
  }

  /**
   * W07 task-33：参数化无头命令（link/math/table）——严格校验 args → 能力 → 执行器（带参数）。
   * 非法 args 一律 E_BAD_PAYLOAD 且**不执行**（不假成功）；执行器缺失/失败如实错误。
   */
  private async invokeEditorParamCommand(
    name: WorkshopEditorParamName,
    conn: BrokerConnection,
    args: Record<string, unknown> | null | undefined,
  ): Promise<ProtocolMethods['command.invoke']['result']> {
    const validation = validateWorkshopEditorArgs(name, args)
    if (!validation.ok || !validation.value) {
      throw protocolError('E_BAD_PAYLOAD', `E_BAD_PAYLOAD: ${String(name)} 参数非法（${validation.error ?? '未知'}）`, {
        name,
      })
    }
    if (!connectionHasCapability(conn, 'editor.commands.readonly')) {
      throw protocolError('E_CAPABILITY', '缺少能力: editor.commands.readonly', {
        required: 'editor.commands.readonly',
        granted: conn.capabilities,
      })
    }
    const executor = getWorkshopEditorExecutor()
    if (!executor) {
      throw protocolError('E_INTERNAL', 'E_EDITOR_NOT_READY: 编辑器未就绪（主窗口 EditorArea 未挂载）', { name })
    }
    const paramKey = WORKSHOP_EDITOR_PARAM_KEY[name]
    let result: WorkshopEditorExecutorResult
    try {
      result = executor.execute(paramKey, validation.value as unknown as Record<string, unknown>)
    } catch (e) {
      throw protocolError('E_INTERNAL', `E_COMMAND_EXECUTION_FAILED: ${String((e as Error)?.message ?? e)}`, { name })
    }
    if (!result || result.ok !== true) {
      throw protocolError('E_INTERNAL', `E_COMMAND_EXECUTION_FAILED: ${result?.error ?? '执行器未返回成功'}`, { name })
    }
    return { ok: true, value: { name, executed: true } }
  }

  /**
   * W07 task-29：执行可无头产品动作（复用 product action 注册表 `runAction`）。
   * - action handler 未注册（编辑器/应用未就绪）→ runAction 返回 `{ran:false}` → 如实
   *   `E_EDITOR_NOT_READY`（不假成功）；
   * - handler 抛错 → `E_COMMAND_EXECUTION_FAILED`；
   * - 成功 → `{ok:true,value:{name,executed:true}}`。
   */
  private async invokeEditorAction(
    name: WorkshopEditorActionName,
    conn: BrokerConnection,
    args?: Record<string, unknown> | null,
  ): Promise<ProtocolMethods['command.invoke']['result']> {
    // W07 task-33：无参动作收到非空 args 明确拒绝（不静默忽略）
    if (!isEmptyCommandArgs(args)) {
      throw protocolError('E_BAD_PAYLOAD', `E_BAD_PAYLOAD: ${String(name)} 不接受参数`, { name })
    }
    if (!connectionHasCapability(conn, 'editor.commands.readonly')) {
      throw protocolError('E_CAPABILITY', '缺少能力: editor.commands.readonly', {
        required: 'editor.commands.readonly',
        granted: conn.capabilities,
      })
    }
    let result: RunResult
    try {
      // 协议名即既有 action id（EditorArea 注册真实 handler：表格 3×3 带表头/脚注/信息块/保存）
      result = runAction(name)
    } catch (e) {
      throw protocolError('E_INTERNAL', `E_COMMAND_EXECUTION_FAILED: ${String((e as Error)?.message ?? e)}`, { name })
    }
    if (!result || result.ran !== true) {
      throw protocolError('E_INTERNAL', 'E_EDITOR_NOT_READY: 命令未执行（action handler 未注册/编辑器未就绪）', {
        name,
        via: result?.via ?? 'none',
      })
    }
    return { ok: true, value: { name, executed: true } }
  }

  async invokeCommand(params: ProtocolMethods['command.invoke']['params'], conn: BrokerConnection) {
    const name = params.name
    // W07 task-33：参数化无头命令（link/math/table 尺寸；严格 args 校验）
    if (isWorkshopEditorParamName(name)) {
      return await this.invokeEditorParamCommand(name, conn, params.args as Record<string, unknown> | null | undefined)
    }
    // W07 task-29：无参产品动作（协议名 = 既有 action id；doc.save 也走此通道）
    if (isWorkshopEditorActionName(name)) {
      return await this.invokeEditorAction(name, conn, params.args as Record<string, unknown> | null | undefined)
    }
    // T26 F03：editor.* 走受控编辑器切换命令桥；其它名称仍走既有 W02 article meta 白名单
    if (typeof name === 'string' && name.startsWith('editor.')) {
      return await this.invokeEditorCommand(
        name as WorkshopEditorInvokeName,
        conn,
        params.args as Record<string, unknown> | null | undefined,
      )
    }
    // 未白名单的 doc.* / 其它未知前缀：明确拒绝（不落到 article meta 处理器，错误语义更清晰）
    if (typeof name === 'string' && name.startsWith('doc.')) {
      throw protocolError('E_FORBIDDEN', `E_COMMAND_NOT_ALLOWED: 未授权文档命令 ${name}`, {
        name,
        protocolNames: [...WORKSHOP_COMMAND_PROTOCOL_NAMES],
      })
    }
    // W02：白名单命令（article.set-title/set-tags）→ 宿主原子写后端 meta；其余命令拒绝
    if (!this.commandHandler) {
      this.commandHandler = createArticleMetaCommandHandler({ baseUrl: this.baseUrl() })
    }
    return await this.commandHandler.invoke(name, params.args)
  }
}
