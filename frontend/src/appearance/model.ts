/**
 * Appearance API v1 is a data contract, independent of the application version.
 * Packages describe presentation only; they never contain CSS, JavaScript or DOM.
 */
export const TOKEN_NAMES = [
  'background', 'foreground', 'card', 'card-foreground', 'popover',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground', 'border', 'input',
  'ring', 'sidebar', 'sidebar-foreground', 'sidebar-accent',
  'sidebar-accent-foreground', 'sidebar-border',
] as const

export type TokenName = (typeof TOKEN_NAMES)[number]
export type AppearanceFont = 'system' | 'sans' | 'serif' | 'mono'
export type AppearanceMetric = 'sidebarWidth' | 'inspectorWidth' | 'controlRadius' | 'uiFontSize'

export interface AppearancePackage {
  schemaVersion: 1
  id: string
  name: string
  version: string
  appearanceApi: 1
  tokens?: {
    light?: Partial<Record<TokenName, string>>
    dark?: Partial<Record<TokenName, string>>
  }
  metrics?: Partial<Record<AppearanceMetric, number>>
  layout?: { navigationSide?: 'left' | 'right' }
  font?: AppearanceFont
}

export const APPEARANCE_CONTRACT = {
  schemaVersion: 1,
  appearanceApi: 1,
  maxBytes: 64 * 1024,
  colorFormat: '#RGB | #RRGGBB',
  tokens: TOKEN_NAMES,
  bounds: {
    sidebarWidth: { min: 220, max: 420 },
    inspectorWidth: { min: 260, max: 440 },
    controlRadius: { min: 0, max: 20 },
    uiFontSize: { min: 12, max: 18 },
  },
  fonts: ['system', 'sans', 'serif', 'mono'] as const,
  slots: [
    'shell-root', 'shell-body', 'shell-navigation',
    'shell-main', 'shell-inspector', 'shell-status', 'editor-toolbar', 'editor-tabs',
    'settings',
  ] as const,
  scope: 'chrome',
  media: 'screen',
  protectedSurfaces: ['document', 'source-editor', 'math', 'export-preview', 'print'] as const,
} as const

export const EXAMPLE_APPEARANCE: AppearancePackage = {
  schemaVersion: 1,
  appearanceApi: 1,
  id: 'quiet-sage',
  name: '静谧青绿',
  version: '1.0.0',
  font: 'sans',
  tokens: {
    light: {
      background: '#fafbf8', foreground: '#24332d', card: '#ffffff',
      'card-foreground': '#24332d', popover: '#f0f4ee', primary: '#42745b',
      'primary-foreground': '#ffffff', secondary: '#e5eee5',
      'secondary-foreground': '#31523e', muted: '#eef2eb',
      'muted-foreground': '#68796c', accent: '#ddebdc',
      'accent-foreground': '#294b36', border: '#dce4d8', input: '#cedacb', ring: '#42745b',
      sidebar: '#eff4ec', 'sidebar-foreground': '#24332d',
      'sidebar-accent': '#ddebdc', 'sidebar-accent-foreground': '#294b36',
      'sidebar-border': '#dce4d8',
    },
    dark: {
      background: '#1b2420', foreground: '#e5ece3', card: '#222e27',
      'card-foreground': '#e5ece3', popover: '#2b3930', primary: '#9ac5a0',
      'primary-foreground': '#1c3325', secondary: '#304b37',
      'secondary-foreground': '#c4dec4', muted: '#29362e',
      'muted-foreground': '#a3b3a4', accent: '#354c3a',
      'accent-foreground': '#d8ead4', border: '#3b4a3e', input: '#4b5c4f', ring: '#9ac5a0',
      sidebar: '#1f2b23', 'sidebar-foreground': '#e5ece3',
      'sidebar-accent': '#354c3a', 'sidebar-accent-foreground': '#d8ead4',
      'sidebar-border': '#3b4a3e',
    },
  },
  metrics: { sidebarWidth: 280, inspectorWidth: 300, controlRadius: 8, uiFontSize: 13 },
  layout: { navigationSide: 'left' },
}

export type AppearanceValidation =
  | { ok: true; package: AppearancePackage }
  | { ok: false; errors: string[] }

const TOP_LEVEL_KEYS = ['schemaVersion', 'id', 'name', 'version', 'appearanceApi', 'tokens', 'metrics', 'layout', 'font']
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}：不支持的字段`)
  }
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = COLOR.exec(value.trim())
  if (!match) return undefined
  const hex = match[1].toLowerCase()
  return `#${hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex}`
}

function isJsonData(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (!Array.isArray(value) && !record(value)) return false
  ancestors.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    // Reading an accessor would execute code while importing the package.
    if (!descriptor || !('value' in descriptor) || !isJsonData(descriptor.value, ancestors)) return false
  }
  ancestors.delete(value)
  return true
}

/** Validate atomically: a malformed package never partially changes the active UI. */
export function validateAppearance(input: string | unknown): AppearanceValidation {
  let raw: unknown
  try {
    if (typeof input !== 'string' && !isJsonData(input)) {
      return { ok: false, errors: ['外观包只能包含 JSON 数据，不能包含函数、访问器或循环引用'] }
    }
    const serialized = typeof input === 'string' ? input : JSON.stringify(input)
    if (typeof serialized !== 'string') return { ok: false, errors: ['外观包必须是 JSON 对象'] }
    if (new TextEncoder().encode(serialized).byteLength > APPEARANCE_CONTRACT.maxBytes) {
      return { ok: false, errors: ['外观包超过 64 KiB 大小限制'] }
    }
    // The JSON round trip removes references/prototypes and ensures only data reaches the renderer.
    raw = JSON.parse(serialized)
  } catch {
    return { ok: false, errors: ['外观包必须是有效 JSON，不能包含循环引用或可执行内容'] }
  }
  if (!record(raw)) return { ok: false, errors: ['外观包必须是 JSON 对象'] }

  const errors: string[] = []
  unknownKeys(raw, TOP_LEVEL_KEYS, 'package', errors)
  if (raw.schemaVersion !== 1) errors.push('schemaVersion：仅支持版本 1')
  if (raw.appearanceApi !== 1) errors.push('appearanceApi：当前仅支持接口版本 1')
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) errors.push('id：使用 1–64 个小写字母、数字、点、下划线或连字符，以字母或数字开头')
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) errors.push('name：使用 1–80 个可显示字符')
  if (typeof raw.version !== 'string' || raw.version.length > 64 || !VERSION.test(raw.version)) errors.push('version：使用语义版本号，如 1.0.0')
  if (raw.font !== undefined && !(APPEARANCE_CONTRACT.fonts as readonly unknown[]).includes(raw.font)) errors.push('font：仅支持 system、sans、serif 或 mono')

  const tokens: NonNullable<AppearancePackage['tokens']> = {}
  if (raw.tokens !== undefined) {
    if (!record(raw.tokens)) errors.push('tokens：必须是对象')
    else {
      unknownKeys(raw.tokens, ['light', 'dark'], 'tokens', errors)
      for (const mode of ['light', 'dark'] as const) {
        const values = raw.tokens[mode]
        if (values === undefined) continue
        if (!record(values)) { errors.push(`tokens.${mode}：必须是对象`); continue }
        unknownKeys(values, TOKEN_NAMES, `tokens.${mode}`, errors)
        const normalized: Partial<Record<TokenName, string>> = {}
        for (const token of TOKEN_NAMES) {
          if (!(token in values)) continue
          const color = normalizeColor(values[token])
          if (!color) errors.push(`tokens.${mode}.${token}：仅接受 #RGB 或 #RRGGBB 颜色`)
          else normalized[token] = color
        }
        tokens[mode] = normalized
      }
    }
  }

  const metrics: NonNullable<AppearancePackage['metrics']> = {}
  if (raw.metrics !== undefined) {
    if (!record(raw.metrics)) errors.push('metrics：必须是对象')
    else {
      unknownKeys(raw.metrics, Object.keys(APPEARANCE_CONTRACT.bounds), 'metrics', errors)
      for (const key of Object.keys(APPEARANCE_CONTRACT.bounds) as AppearanceMetric[]) {
        const value = raw.metrics[key]
        if (value === undefined) continue
        const { min, max } = APPEARANCE_CONTRACT.bounds[key]
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
          errors.push(`metrics.${key}：必须是 ${min}–${max} 之间的有限数值`)
        } else metrics[key] = value
      }
    }
  }
  const layout: NonNullable<AppearancePackage['layout']> = {}
  if (raw.layout !== undefined) {
    if (!record(raw.layout)) errors.push('layout：必须是对象')
    else {
      unknownKeys(raw.layout, ['navigationSide'], 'layout', errors)
      if (raw.layout.navigationSide !== undefined) {
        if (raw.layout.navigationSide !== 'left' && raw.layout.navigationSide !== 'right') errors.push('layout.navigationSide：仅支持 left 或 right')
        else layout.navigationSide = raw.layout.navigationSide
      }
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    package: {
      schemaVersion: 1, appearanceApi: 1, id: raw.id as string, name, version: raw.version as string,
      ...(raw.tokens === undefined ? {} : { tokens }),
      ...(raw.metrics === undefined ? {} : { metrics }),
      ...(raw.layout === undefined ? {} : { layout }),
      ...(raw.font === undefined ? {} : { font: raw.font as AppearanceFont }),
    },
  }
}
