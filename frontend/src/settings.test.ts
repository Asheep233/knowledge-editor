/** 应用设置纯函数单测（Phase 7 M3）：mergeSettings / sanitizeTheme。 */
import { describe, expect, it, vi } from 'vitest'
import { applyTheme, DEFAULT_SETTINGS, mergeSettings, normalizeSettings, sanitizeHexColor, sanitizeTheme } from './settings'

describe('sanitizeTheme', () => {
  it('接受 system/light/dark', () => {
    expect(sanitizeTheme('system')).toBe('system')
    expect(sanitizeTheme('light')).toBe('light')
    expect(sanitizeTheme('dark')).toBe('dark')
  })

  it('非法值回退 system', () => {
    expect(sanitizeTheme('neon')).toBe('system')
    expect(sanitizeTheme(undefined)).toBe('system')
    expect(sanitizeTheme(null)).toBe('system')
    expect(sanitizeTheme(42)).toBe('system')
  })
})

describe('mergeSettings', () => {
  it('默认值与规划 schema v1 一致', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(1)
    expect(DEFAULT_SETTINGS.startup).toEqual({ restoreLastState: true, autoOpenRecentWorkspace: true })
    expect(DEFAULT_SETTINGS.editor).toEqual({ autosaveIntervalMs: 3000, historyRetentionCount: 30, display: {} })
    expect(DEFAULT_SETTINGS.ui.theme).toBe('system')
    expect(DEFAULT_SETTINGS.maintenance).toEqual({})
  })

  it('部分补丁只覆盖目标分组，其余保持不变', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, { editor: { autosaveIntervalMs: 5000 } })
    expect(out.editor.autosaveIntervalMs).toBe(5000)
    expect(out.editor.historyRetentionCount).toBe(30)
    expect(out.startup.restoreLastState).toBe(true)
    expect(out.ui.theme).toBe('system')
  })

  it('多分组补丁可一次合并', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, {
      startup: { autoOpenRecentWorkspace: false },
      ui: { theme: 'dark' },
    })
    expect(out.startup.autoOpenRecentWorkspace).toBe(false)
    expect(out.startup.restoreLastState).toBe(true)
    expect(out.ui.theme).toBe('dark')
  })

  it('非法 theme 在合并时净化', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, { ui: { theme: 'neon' as never } })
    expect(out.ui.theme).toBe('system')
  })

  it('display / displayPreference 缺省保留原值', () => {
    const base = mergeSettings(DEFAULT_SETTINGS, { editor: { display: { lineNumbers: true } } })
    const out = mergeSettings(base, { editor: { autosaveIntervalMs: 1000 } })
    expect(out.editor.display).toEqual({ lineNumbers: true })
  })

  it('schemaVersion 恒为 1（不可被补丁改动）', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, { schemaVersion: 99 } as never)
    expect(out.schemaVersion).toBe(1)
  })

  it('accentColor 合并时归一化并保留另一侧', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, {
      ui: { accentColor: { light: '#4285F4' } },
    })
    expect(out.ui.accentColor).toEqual({ light: '#4285f4', dark: undefined })
    // 深色侧补丁不覆盖已存浅色
    const base = mergeSettings(DEFAULT_SETTINGS, { ui: { accentColor: { light: '#4285f4' } } })
    const next = mergeSettings(base, { ui: { accentColor: { dark: '#3b82f6' } } })
    expect(next.ui.accentColor).toEqual({ light: '#4285f4', dark: '#3b82f6' })
  })

  it('accentColor 非法值被清除（不写入）', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, {
      ui: { accentColor: { light: 'not-a-color', dark: '#123' } } as never,
    })
    expect(out.ui.accentColor).toEqual({ light: undefined, dark: '#112233' })
  })

  it('accentColor 空字符串 = 清除该侧（回退默认）', () => {
    const base = mergeSettings(DEFAULT_SETTINGS, {
      ui: { accentColor: { light: '#4285f4', dark: '#3b82f6' } },
    })
    const out = mergeSettings(base, { ui: { accentColor: { light: '' } } })
    expect(out.ui.accentColor).toEqual({ light: undefined, dark: '#3b82f6' })
  })
})

describe('F08 — 嵌套对象深合并（与 Rust merge_value 对齐）', () => {
  it('display 深合并：独立键保留，不整体替换', () => {
    const base = {
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_SETTINGS.editor, display: { font: 'dm-sans', spacing: 1 } },
    }
    const out = mergeSettings(base, { editor: { display: { font: 'other' } } })
    expect(out.editor.display).toEqual({ font: 'other', spacing: 1 })
  })

  it('displayPreference / maintenance 深合并；非对象值整体替换', () => {
    const base = {
      ...DEFAULT_SETTINGS,
      ui: { ...DEFAULT_SETTINGS.ui, displayPreference: { a: 1, nested: { x: 1 } } },
      maintenance: { enabled: true, deep: { k: 'v' } },
    }
    const out = mergeSettings(base, {
      ui: { displayPreference: { nested: { x: 2 } } },
      maintenance: { deep: { k2: 'v2' } },
    })
    expect(out.ui.displayPreference).toEqual({ a: 1, nested: { x: 2 } })
    expect(out.maintenance).toEqual({ enabled: true, deep: { k: 'v', k2: 'v2' } })
  })
})

describe('F09 — normalizeSettings 缺失键/非法值兜底', () => {
  it('缺 startup 键 / 非法 theme / 非法 accent：渲染安全且回退默认', () => {
    const out = normalizeSettings({
      editor: { autosaveIntervalMs: 5000 },
      ui: { theme: 'neon', accentColor: { light: '#zzzzzz' } },
    })
    expect(out.startup).toEqual(DEFAULT_SETTINGS.startup)
    expect(out.editor.autosaveIntervalMs).toBe(5000)
    expect(out.ui.theme).toBe('system')
    expect(out.ui.accentColor).toBeUndefined()
  })

  it('非对象输入返回默认副本（互不引用）', () => {
    const out = normalizeSettings('garbage')
    expect(out).toEqual(DEFAULT_SETTINGS)
    out.editor.autosaveIntervalMs = 9999
    expect(DEFAULT_SETTINGS.editor.autosaveIntervalMs).toBe(3000)
  })
})

describe('F13 — applyTheme 系统主题监听器单例（不累积）', () => {
  it('多次调用 applyTheme 只注册一次 matchMedia change 监听器', () => {
    // happy-dom 每次 matchMedia 调用返回新 MediaQueryList 实例，故在原型上计数
    const proto = (window.matchMedia('x') as unknown as object).constructor.prototype as {
      addEventListener: (...a: unknown[]) => void
    }
    const addSpy = vi.spyOn(proto, 'addEventListener')
    applyTheme('system')
    applyTheme('system')
    applyTheme('dark')
    applyTheme('light')
    expect(addSpy).toHaveBeenCalledTimes(1)
    // 主题正确写入
    expect(document.documentElement.dataset.theme).toBe('light')
    addSpy.mockRestore()
  })
})

describe('sanitizeHexColor', () => {
  it('接受 #RGB / #RRGGBB 并归一化', () => {
    expect(sanitizeHexColor('#4285F4')).toBe('#4285f4')
    expect(sanitizeHexColor('4285f4')).toBe('#4285f4')
    expect(sanitizeHexColor('#abc')).toBe('#aabbcc')
    expect(sanitizeHexColor('#ABC')).toBe('#aabbcc')
  })

  it('非法值返回 undefined', () => {
    expect(sanitizeHexColor('red')).toBeUndefined()
    expect(sanitizeHexColor('#12')).toBeUndefined()
    expect(sanitizeHexColor('#1234567')).toBeUndefined()
    expect(sanitizeHexColor(42)).toBeUndefined()
    expect(sanitizeHexColor(undefined)).toBeUndefined()
  })
})
