/** 应用设置纯函数单测（Phase 7 M3）：mergeSettings / sanitizeTheme。 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings, sanitizeTheme } from './settings'

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
})
