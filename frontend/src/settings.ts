/**
 * 应用设置（Phase 7 M3，规划第 7 章 7.3）。
 *
 * 原则：设置属于应用层。桌面版经 Tauri 命令读写 %APPDATA%\KnowledgeEditor\settings.json
 * （get_settings / update_settings）；Web 版（无 Tauri）降级到 localStorage（ke.settings.v1），
 * 浏览器模式可用且不改后端。schema 与 Rust 端 settings.rs / 规划第 7 章一致。
 */
export interface StartupSettings {
  restoreLastState: boolean
  autoOpenRecentWorkspace: boolean
}

export interface EditorSettings {
  autosaveIntervalMs: number
  historyRetentionCount: number
  display: Record<string, unknown>
}

export interface UiSettings {
  theme: 'system' | 'light' | 'dark'
  displayPreference: Record<string, unknown>
  /**
   * 自定义强调色（Phase 2）：light / dark 两套十六进制色值。
   * 未设置时用令牌层默认（light #4285f4 / dark #3b82f6）。
   * 保存时校验 #RRGGBB；非法值按未设置处理。
   */
  accentColor?: {
    light?: string
    dark?: string
  }
}

export interface AppSettings {
  schemaVersion: number
  startup: StartupSettings
  editor: EditorSettings
  ui: UiSettings
  maintenance: Record<string, unknown>
}

export type SettingsPatch = {
  startup?: Partial<StartupSettings>
  editor?: Partial<EditorSettings>
  ui?: Partial<UiSettings> & {
    /** accentColor 单值为空字符串 = 清除该侧（恢复主题默认），Patch 专用语义 */
    accentColor?: {
      light?: string
      dark?: string
    }
  }
  maintenance?: Record<string, unknown>
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  startup: { restoreLastState: true, autoOpenRecentWorkspace: true },
  editor: { autosaveIntervalMs: 3000, historyRetentionCount: 30, display: {} },
  ui: { theme: 'system', displayPreference: {} },
  maintenance: {},
}

const LS_KEY = 'ke.settings.v1'
let cache: AppSettings | null = null

/** Tauri 环境检测：与 main.tsx 引导一致（比 __TAURI__ 更稳妥）。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function sanitizeTheme(value: unknown): UiSettings['theme'] {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** 校验并归一化十六进制颜色（#RGB / #RRGGBB → #RRGGBB 小写；非法返回 undefined）。
 * 用于 accentColor 持久化前的过滤。 */
export function sanitizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim())
  if (!m) return undefined
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  return `#${hex.toLowerCase()}`
}

/** 纯函数合并：部分补丁深合并到现有设置（供单测；Rust 端 merge 语义一致）。 */
export function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    schemaVersion: 1,
    startup: { ...base.startup, ...patch.startup },
    editor: {
      ...base.editor,
      ...patch.editor,
      display: patch.editor?.display ?? base.editor.display,
    },
    ui: {
      ...base.ui,
      ...patch.ui,
      theme: sanitizeTheme(patch.ui?.theme ?? base.ui.theme),
      displayPreference: patch.ui?.displayPreference ?? base.ui.displayPreference,
      // accentColor 空字符串 = 清除（回退默认）；undefined = 保留原值
      accentColor: {
        light:
          patch.ui?.accentColor?.light === ''
            ? undefined
            : sanitizeHexColor(patch.ui?.accentColor?.light ?? base.ui.accentColor?.light),
        dark:
          patch.ui?.accentColor?.dark === ''
            ? undefined
            : sanitizeHexColor(patch.ui?.accentColor?.dark ?? base.ui.accentColor?.dark),
      },
    },
    maintenance: patch.maintenance ?? base.maintenance,
  }
}

/** 读取设置（应用启动时调用一次；也供设置面板初始化）。 */
export async function loadSettings(): Promise<AppSettings> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    cache = await invoke<AppSettings>('get_settings')
  } else {
    try {
      const raw = localStorage.getItem(LS_KEY)
      cache = raw ? (JSON.parse(raw) as AppSettings) : DEFAULT_SETTINGS
    } catch {
      cache = DEFAULT_SETTINGS
    }
  }
  return cache
}

/** 保存设置（部分补丁），返回合并后的完整设置并刷新内存缓存。 */
export async function saveSettings(patch: SettingsPatch): Promise<AppSettings> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    cache = await invoke<AppSettings>('update_settings', { patch })
  } else {
    const next = mergeSettings(cache ?? DEFAULT_SETTINGS, patch)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next))
    } catch {
      /* localStorage 不可用时忽略（内存缓存仍生效） */
    }
    cache = next
  }
  return cache
}

export function getCachedSettings(): AppSettings {
  return cache ?? DEFAULT_SETTINGS
}

/** EditorArea 自动保存间隔（设置面板改动后即时生效：每次防抖触发时读取缓存）。 */
export function getAutosaveIntervalMs(): number {
  const v = getCachedSettings().editor.autosaveIntervalMs
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SETTINGS.editor.autosaveIntervalMs
}

/** 应用主题：解析 system → 实际明暗，写 data-theme（供 CSS 覆盖）与 color-scheme。
 * P4-2：完整深色主题由 index.css 的 [data-theme="dark"] 覆盖层提供，
 * system 模式跟随 prefers-color-scheme 并响应系统切换。
 * Phase 2：自定义强调色（accentColor）→ 覆写 --primary / --sidebar-primary /
 * --ring（派生 token 用 color-mix 联动 --primary，无需单独覆写）。 */
export function applyTheme(theme: UiSettings['theme'], accent?: UiSettings['accentColor']): void {
  const el = document.documentElement
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const effective = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme
  el.dataset.theme = effective
  el.style.colorScheme = effective === 'dark' ? 'dark' : 'light'
  // 自定义强调色：仅用 CSS 变量覆写，令牌层默认值保持在 :root/[data-theme=dark]，
  // 清除时（undefined）恢复默认（CSS 变量删掉即可回退到层叠默认）。
  const custom = effective === 'dark' ? accent?.dark : accent?.light
  if (custom) {
    el.style.setProperty('--primary', custom)
    el.style.setProperty('--sidebar-primary', custom)
    el.style.setProperty('--ring', custom)
  } else {
    el.style.removeProperty('--primary')
    el.style.removeProperty('--sidebar-primary')
    el.style.removeProperty('--ring')
    // 派生 token 依赖 --primary 的 color-mix，自动随变量变化；无需处理
  }
  if (media) {
    // 系统模式：跟随系统明暗切换（响应式监听，按当前主题是否 system 生效）
    media.addEventListener('change', () => {
      applyTheme(getCachedSettings().ui.theme, getCachedSettings().ui.accentColor)
    })
  }
}
