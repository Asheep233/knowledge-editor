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
  ui?: Partial<UiSettings>
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

/** 应用主题：写 data-theme（供 CSS 覆盖）与 color-scheme（原生控件/滚动条）。 */
export function applyTheme(theme: UiSettings['theme']): void {
  const el = document.documentElement
  el.dataset.theme = theme
  el.style.colorScheme = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'light dark'
}
