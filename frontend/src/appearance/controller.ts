/**
 * Appearance packages are presentation data. Persist a complete JSON envelope as one
 * opaque setting so both the Rust and browser deep-merge paths replace it atomically.
 * No package can register a handler, replace an editor, or execute application code.
 */
import { getCachedSettings, saveSettings, type AppSettings } from '../settings'
import { APPEARANCE_CONTRACT, validateAppearance, type AppearancePackage } from './model'
import { renderAppearance } from './runtime'

export const APPEARANCE_SETTINGS_KEY = 'appearanceV1'
export const APPEARANCE_BACKUP_KEY = 'appearanceBackupV1'
export const APPEARANCE_CHANGED_EVENT = 'ke:appearance-changed'
export const MAX_PREVIEW_MS = 30_000

export interface AppearanceState {
  schemaVersion: 1
  current: AppearancePackage | null
  previous: AppearancePackage | null
}

export interface AppearanceStatus {
  mode: 'default' | 'active' | 'preview' | 'fallback'
  reason: string | null
  previewExpiresAt: number | null
  rawAvailable: boolean
}

interface LoadedAppearance {
  state: AppearanceState
  raw: string | null
  reason: string | null
}

const emptyState = (): AppearanceState => ({ schemaVersion: 1, current: null, previous: null })
const clone = <T>(value: T): T => structuredClone(value)
let state = emptyState()
let originalRaw: string | null = null
let retainedBackup: string | null = null
let fallbackReason: string | null = null
let initialized = false
let preview: AppearancePackage | null = null
let previewExpiresAt: number | null = null
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewRevision = 0
let mutationTail: Promise<unknown> = Promise.resolve()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRetainedBackup(settings: AppSettings): string | null {
  const value = settings.ui?.displayPreference?.[APPEARANCE_BACKUP_KEY]
  return typeof value === 'string' ? value : null
}

function readStored(settings: AppSettings): LoadedAppearance {
  const value = settings.ui?.displayPreference?.[APPEARANCE_SETTINGS_KEY]
  if (value === undefined || value === null) return { state: emptyState(), raw: null, reason: null }
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (typeof value !== 'string') {
    return { state: emptyState(), raw, reason: '外观配置应为 JSON 字符串，已使用默认外观；原始配置仍可导出。' }
  }
  let envelope: unknown
  try {
    envelope = JSON.parse(value)
  } catch {
    return { state: emptyState(), raw, reason: '外观配置 JSON 损坏，已使用默认外观；原始配置仍可导出。' }
  }
  if (!isRecord(envelope) || envelope.schemaVersion !== 1 || !('current' in envelope) || !('previous' in envelope)) {
    return { state: emptyState(), raw, reason: '不支持此外观存储版本，已使用默认外观；原始配置保留供兼容版本恢复。' }
  }
  const next = emptyState()
  for (const field of ['current', 'previous'] as const) {
    if (envelope[field] === null) continue
    const checked = validateAppearance(envelope[field])
    if (!checked.ok) {
      return { state: emptyState(), raw, reason: `外观配置不兼容或无效：${checked.errors.join('；')}。已使用默认外观，原始配置保留。` }
    }
    next[field] = clone(checked.package)
  }
  return { state: next, raw, reason: null }
}

function notifyChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGED_EVENT, {
    detail: { state: getAppearanceState(), status: getAppearanceStatus() },
  }))
}

function clearPreview(): void {
  if (previewTimer !== undefined) clearTimeout(previewTimer)
  previewTimer = undefined
  preview = null
  previewExpiresAt = null
  previewRevision += 1
}

function renderCurrent(): void {
  renderAppearance(preview ?? (fallbackReason ? null : state.current))
}

/** Return snapshots: callers cannot mutate the running package or rollback state. */
export function getAppearanceState(): AppearanceState {
  return clone(state)
}

export function getPreviewAppearance(): AppearancePackage | null {
  return clone(preview)
}

export function getAppearanceStatus(): AppearanceStatus {
  return {
    mode: preview ? 'preview' : fallbackReason ? 'fallback' : state.current ? 'active' : 'default',
    reason: fallbackReason,
    previewExpiresAt,
    rawAvailable: originalRaw !== null || retainedBackup !== null,
  }
}

/**
 * Called after settings have loaded. Unsupported packages never get rewritten.
 * Repeated initialization with the same settings does not interrupt a preview.
 * ?appearance=off is a recovery route that leaves the stored package untouched.
 */
export function initializeAppearance(settings: AppSettings = getCachedSettings()): AppearanceState {
  const loaded = readStored(settings)
  const backup = readRetainedBackup(settings)
  if (initialized && loaded.raw === originalRaw && backup === retainedBackup) return getAppearanceState()
  clearPreview()
  state = loaded.state
  originalRaw = loaded.raw
  retainedBackup = backup
  fallbackReason = loaded.reason
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('appearance') === 'off') {
    fallbackReason = '本次启动已通过 appearance=off 使用默认外观，已保存的外观配置保持不变。'
  }
  initialized = true
  renderCurrent()
  notifyChange()
  return getAppearanceState()
}

/** Current package as readable JSON; incompatible stored data is exported verbatim. */
export function exportAppearance(): string {
  if (fallbackReason && originalRaw !== null) return originalRaw
  return JSON.stringify(state.current ?? state, null, 2)
}

/** Complete saved envelope, including its rollback package; preserve invalid input. */
export function exportAppearanceBackup(): string {
  if (fallbackReason && originalRaw !== null) return originalRaw
  return retainedBackup ?? originalRaw ?? JSON.stringify(state, null, 2)
}

function checkedPackage(input: unknown): AppearancePackage {
  const result = validateAppearance(input)
  if (!result.ok) throw new Error(result.errors.join('；'))
  return clone(result.package)
}

function enqueueMutation(operation: () => Promise<AppearanceState>): Promise<AppearanceState> {
  const result = mutationTail.then(operation)
  // An unsuccessful write must not prevent the next operation from running.
  mutationTail = result.catch(() => undefined)
  return result
}

async function persist(next: AppearanceState, rejectedRaw?: string): Promise<AppearanceState> {
  const raw = JSON.stringify(next)
  const backup = rejectedRaw ?? readRetainedBackup(getCachedSettings())
  const startingPreviewRevision = previewRevision
  await saveSettings({ ui: { displayPreference: {
    [APPEARANCE_SETTINGS_KEY]: raw,
    ...(rejectedRaw === undefined ? {} : { [APPEARANCE_BACKUP_KEY]: rejectedRaw }),
  } } }, { requirePersistence: true })
  // A preview opened while the write was pending belongs to the newer user action.
  // Keep it until expiry, then render the package that has just been saved.
  if (previewRevision === startingPreviewRevision) clearPreview()
  state = clone(next)
  originalRaw = raw
  retainedBackup = backup
  fallbackReason = null
  initialized = true
  renderCurrent()
  notifyChange()
  return getAppearanceState()
}

/** Install/apply a validated package, retaining the most recently saved current one. */
export async function applyAppearance(input: unknown): Promise<AppearanceState> {
  const pkg = checkedPackage(input)
  return enqueueMutation(async () => {
    const latest = readStored(getCachedSettings())
    return persist({ schemaVersion: 1, current: pkg, previous: latest.state.current }, latest.reason ? latest.raw ?? undefined : undefined)
  })
}

export const installAppearance = applyAppearance

/** Disable the current package while keeping a package available for rollback. */
export function resetAppearance(): Promise<AppearanceState> {
  return enqueueMutation(async () => {
    const latest = readStored(getCachedSettings())
    return persist({ schemaVersion: 1, current: null, previous: latest.state.current ?? latest.state.previous }, latest.reason ? latest.raw ?? undefined : undefined)
  })
}

/** Swap saved current/previous, including restoring the built-in default (null). */
export function rollbackAppearance(): Promise<AppearanceState> {
  return enqueueMutation(async () => {
    const latest = readStored(getCachedSettings()).state
    if (!latest.current && !latest.previous) throw new Error('没有可回滚的外观版本。')
    return persist({ schemaVersion: 1, current: latest.previous, previous: latest.current })
  })
}

/** Preview is memory-only and always expires within 30 seconds. */
export function previewAppearance(input: unknown, durationMs = MAX_PREVIEW_MS): AppearanceState {
  const pkg = checkedPackage(input)
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('预览时长必须是正数。')
  clearPreview()
  preview = pkg
  const duration = Math.min(durationMs, MAX_PREVIEW_MS)
  previewExpiresAt = Date.now() + duration
  previewTimer = setTimeout(cancelAppearancePreview, duration)
  renderCurrent()
  notifyChange()
  return getAppearanceState()
}

export function cancelAppearancePreview(): void {
  if (!preview) return
  clearPreview()
  renderCurrent()
  notifyChange()
}

export interface AppearanceApi {
  readonly contract: typeof APPEARANCE_CONTRACT
  validate: typeof validateAppearance
  get: () => { state: AppearanceState; status: AppearanceStatus; preview: AppearancePackage | null }
  export: typeof exportAppearance
  exportBackup: typeof exportAppearanceBackup
  preview: typeof previewAppearance
  cancelPreview: typeof cancelAppearancePreview
  apply: typeof applyAppearance
  reset: typeof resetAppearance
  rollback: typeof rollbackAppearance
}

declare global {
  interface Window {
    astranotaAppearance: AppearanceApi
  }
}

/** Agent integration uses this SDK without granting access to the editor or filesystem. */
export function installAppearanceApi(): AppearanceApi {
  const api: AppearanceApi = Object.freeze({
    get contract() { return clone(APPEARANCE_CONTRACT) },
    validate: validateAppearance,
    get: () => ({ state: getAppearanceState(), status: getAppearanceStatus(), preview: getPreviewAppearance() }),
    export: exportAppearance,
    exportBackup: exportAppearanceBackup,
    preview: previewAppearance,
    cancelPreview: cancelAppearancePreview,
    apply: applyAppearance,
    reset: resetAppearance,
    rollback: rollbackAppearance,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'astranotaAppearance', { value: api, configurable: true })
  }
  return api
}
