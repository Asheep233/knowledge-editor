/**
 * UI 工坊 P1/P3-T17：包清单（manifest）与校验 —— 「候选扫描与无损拒绝」。
 *
 * 设计约束（ARCHITECTURE / TASKS T17/T18）：
 * - 只加载**预编译资源**（html/js/css/资产），不在加载时构建；
 * - 能力**声明式**且必须在 allowlist 内；未知能力/超集一律无损拒绝（不静默降级）；
 * - 资源路径禁绝对路径/穿越；每个资源必须给 sha256（安装时校验）；
 * - 清单错误用类型化 code（不靠字符串），拒绝时不得留下半成品（由 PackStore 事务保证）。
 */
export const PACK_API_VERSION = 1

/** 首发允许声明的能力（最小集；扩展需评审 + 协议/SDK 同步升版）。 */
export const ALLOWED_CAPABILITIES = [
  'ui.shell',
  'panel.sidebar',
  'panel.dock',
  'editor.commands.readonly',
  'context.read',
  /** T26 G2：文档写通道（真实 /api/context/write，CAS/幂等；trusted/builtin 才授予） */
  'context.write',
  'print.request',
] as const

export type PackCapability = (typeof ALLOWED_CAPABILITIES)[number]

export interface PackAsset {
  path: string
  sha256: string
  size?: number
}

export interface PackCommand {
  /** 声明式命令名（guest 通过协议请求，host 用激活上下文校验） */
  name: string
  /** 包内入口导出的命令标识（不允许任意脚本代码字符串） */
  handler: string
}

export interface PackManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  capabilities: PackCapability[]
  entry: { html: string; sdk?: string }
  commands?: PackCommand[]
  assets: PackAsset[]
}

export type PackErrorCode = 'E_MANIFEST' | 'E_API_VERSION' | 'E_CAPABILITY' | 'E_PATH' | 'E_HASH' | 'E_ENTRY' | 'E_DUPLICATE'

export class PackValidationError extends Error {
  readonly code: PackErrorCode
  readonly detail: string
  constructor(code: PackErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'PackValidationError'
    this.code = code
    this.detail = detail
  }
}

const ID_RE = /^[a-z0-9][a-z0-9.-]{1,80}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SHA256_RE = /^[a-f0-9]{64}$/

/** 归一化并校验包内相对路径；拒绝绝对路径/穿越/隐藏系统路径。 */
export function safePackPath(path: string): string {
  const raw = (path ?? '').replace(/\\/g, '/')
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new PackValidationError('E_PATH', `绝对路径不允许: ${path}`)
  const parts = raw.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new PackValidationError('E_PATH', `非法路径: ${path}`)
  if (parts[0].startsWith('.')) throw new PackValidationError('E_PATH', `隐藏/系统路径不允许: ${path}`)
  return parts.join('/')
}

export function validateManifest(raw: unknown): PackManifest {
  if (!raw || typeof raw !== 'object') throw new PackValidationError('E_MANIFEST', '清单必须是对象')
  const m = raw as Partial<PackManifest>
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) throw new PackValidationError('E_MANIFEST', `非法包 id: ${String(m.id)}`)
  if (typeof m.name !== 'string' || !m.name.trim()) throw new PackValidationError('E_MANIFEST', '包名不能为空')
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) throw new PackValidationError('E_MANIFEST', `非法版本: ${String(m.version)}`)
  if (typeof m.apiVersion !== 'number' || !Number.isInteger(m.apiVersion)) throw new PackValidationError('E_MANIFEST', 'apiVersion 必须是整数')
  if (m.apiVersion !== PACK_API_VERSION) throw new PackValidationError('E_API_VERSION', `apiVersion=${m.apiVersion} 与 host ${PACK_API_VERSION} 不兼容`)
  if (!Array.isArray(m.capabilities)) throw new PackValidationError('E_MANIFEST', 'capabilities 必须是数组')
  const caps: PackCapability[] = []
  for (const cap of m.capabilities) {
    if (typeof cap !== 'string' || !(ALLOWED_CAPABILITIES as readonly string[]).includes(cap)) {
      throw new PackValidationError('E_CAPABILITY', `未声明允许的能力: ${String(cap)}`)
    }
    if (caps.includes(cap as PackCapability)) throw new PackValidationError('E_CAPABILITY', `能力重复声明: ${cap}`)
    caps.push(cap as PackCapability)
  }
  if (!m.entry || typeof m.entry !== 'object') throw new PackValidationError('E_ENTRY', '缺少 entry')
  const entryHtml = safePackPath(m.entry.html)
  const entrySdk = m.entry.sdk ? safePackPath(m.entry.sdk) : undefined
  if (!Array.isArray(m.assets) || m.assets.length === 0) throw new PackValidationError('E_MANIFEST', 'assets 不能为空')
  const assets: PackAsset[] = []
  const seen = new Set<string>()
  for (const a of m.assets) {
    if (!a || typeof a !== 'object') throw new PackValidationError('E_MANIFEST', '资产项必须是对象')
    const path = safePackPath(a.path)
    if (seen.has(path)) throw new PackValidationError('E_MANIFEST', `资产重复: ${path}`)
    seen.add(path)
    if (typeof a.sha256 !== 'string' || !SHA256_RE.test(a.sha256)) throw new PackValidationError('E_HASH', `资产缺少合法 sha256: ${path}`)
    if (a.size !== undefined && (typeof a.size !== 'number' || a.size < 0)) throw new PackValidationError('E_MANIFEST', `非法 size: ${path}`)
    assets.push({ path, sha256: a.sha256, size: a.size })
  }
  if (!seen.has(entryHtml)) throw new PackValidationError('E_ENTRY', `entry.html 不在 assets 内: ${entryHtml}`)
  if (entrySdk && !seen.has(entrySdk)) throw new PackValidationError('E_ENTRY', `entry.sdk 不在 assets 内: ${entrySdk}`)
  const commands: PackCommand[] = []
  if (m.commands !== undefined) {
    if (!Array.isArray(m.commands)) throw new PackValidationError('E_MANIFEST', 'commands 必须是数组')
    const names = new Set<string>()
    for (const c of m.commands) {
      if (!c || typeof c.name !== 'string' || !/^[a-z][a-z0-9.-]{1,80}$/.test(c.name)) throw new PackValidationError('E_MANIFEST', `非法命令名: ${String(c?.name)}`)
      if (typeof c.handler !== 'string' || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(c.handler)) {
        throw new PackValidationError('E_MANIFEST', `非法 handler 标识: ${String(c?.handler)}`)
      }
      if (names.has(c.name)) throw new PackValidationError('E_MANIFEST', `命令重复: ${c.name}`)
      names.add(c.name)
      commands.push({ name: c.name, handler: c.handler })
    }
  }
  return { id: m.id, name: m.name, version: m.version, apiVersion: m.apiVersion, capabilities: caps, entry: { html: entryHtml, sdk: entrySdk }, commands, assets }
}
