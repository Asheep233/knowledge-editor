/** 应用设置纯函数单测（Phase 7 M3）：mergeSettings / sanitizeTheme；task-29 追加自定义快捷键与「三处同步」守门。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSettings,
  sanitizeHexColor,
  sanitizeShortcutsMap,
  sanitizeTheme,
} from './settings'
import { SHORTCUT_UNBOUND } from './state/shortcuts'

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
    expect(DEFAULT_SETTINGS.editor).toEqual({ autosaveIntervalMs: 3000, historyRetentionCount: 30, noteBgOpacity: 100, quoteBgOpacity: 100, mathAutocomplete: true, shortcuts: {}, display: {} })
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

// ---------------------------------------------------------------------------
// task-29（v1.2.0-pre.1 ①）：自定义快捷键 —— 字段净化 / 键级合并 / 「三处同步」守门
// ---------------------------------------------------------------------------

describe('task-29 sanitizeShortcutsMap — 非法值降级', () => {
  it('只保留 string→string；非法键位丢弃、非字符串丢弃、非对象输入 → {}', () => {
    expect(sanitizeShortcutsMap(undefined)).toEqual({})
    expect(sanitizeShortcutsMap('oops')).toEqual({})
    expect(sanitizeShortcutsMap({ a: 1, b: null, c: {} })).toEqual({})
    const out = sanitizeShortcutsMap({
      'editor.bold': 'ctrl+shift+b', // 归一化
      'editor.italic': 'Ctrl+', // 非法键位 → 丢弃（回退内置默认）
      'editor.undo': 42, // 非字符串 → 丢弃
      'unknown.action': 'Ctrl+Alt+9', // 未知 action 保留（降级不丢配置）
      'doc.save': SHORTCUT_UNBOUND, // 墓碑保留
      'doc.new': '', // 回退默认保留
    })
    expect(out).toEqual({
      'editor.bold': 'Ctrl+Shift+B',
      'unknown.action': 'Ctrl+Alt+9',
      'doc.save': 'none',
      'doc.new': '',
    })
  })

  it('normalizeSettings 对未知键/非法值的降级有断言，且不影响其它字段', () => {
    const s = normalizeSettings({
      editor: {
        autosaveIntervalMs: 5000,
        shortcuts: { 'editor.bold': 'Ctrl+Shift+B', 'editor.x': 'nope', 'editor.y': { bad: true } },
      },
    })
    expect(s.editor.autosaveIntervalMs).toBe(5000)
    expect(s.editor.shortcuts).toEqual({ 'editor.bold': 'Ctrl+Shift+B' })
    // 缺省 → 空映射（= 全部沿用内置键位，行为零变化）
    expect(normalizeSettings({}).editor.shortcuts).toEqual({})
    expect(normalizeSettings({ editor: { shortcuts: 'oops' } }).editor.shortcuts).toEqual({})
  })
})

describe('task-29 mergeSettings — 快捷键键级合并（对齐 Rust merge_value 深合并）', () => {
  it('补丁只影响目标动作，其它动作绑定保留（不得整体替换）', () => {
    const base = {
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_SETTINGS.editor, shortcuts: { 'editor.bold': 'Ctrl+Shift+B' } },
    }
    const next = mergeSettings(base, { editor: { shortcuts: { 'doc.save': 'Ctrl+Alt+S' } } })
    expect(next.editor.shortcuts).toEqual({ 'editor.bold': 'Ctrl+Shift+B', 'doc.save': 'Ctrl+Alt+S' })
  })

  it('墓碑解绑：写入 none 覆盖同动作旧绑定（深合并下「删键」无效，必须用墓碑）', () => {
    const base = {
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_SETTINGS.editor, shortcuts: { 'editor.italic': 'Ctrl+Alt+I' } },
    }
    const next = mergeSettings(base, { editor: { shortcuts: { 'editor.italic': SHORTCUT_UNBOUND } } })
    expect(next.editor.shortcuts?.['editor.italic']).toBe('none')
  })

  it('未提供 shortcuts 的补丁不清空既有绑定', () => {
    const base = {
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_SETTINGS.editor, shortcuts: { 'editor.bold': 'Ctrl+Shift+B' } },
    }
    const next = mergeSettings(base, { editor: { autosaveIntervalMs: 1000 } })
    expect(next.editor.shortcuts).toEqual({ 'editor.bold': 'Ctrl+Shift+B' })
  })
})

describe('task-29 守门① — 前端 DEFAULT 的每个字段都必须被 Rust from_value_lenient 接受', () => {
  // 背景：handover §3.3 坑 12「新增设置字段必须同步三处；漏 from_value_lenient = IPC 返回 null、设置静默失效」。
  // 本测直接读 Rust 源码，断言前端会持久化的每个键都出现在白名单函数体内 —— 漏加即红。
  function rustSettingsSource(): string {
    const candidates = [
      resolve(process.cwd(), '../desktop/src-tauri/src/settings.rs'),
      resolve(process.cwd(), 'desktop/src-tauri/src/settings.rs'),
    ]
    for (const p of candidates) {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        /* 试下一个候选路径 */
      }
    }
    throw new Error('未找到 desktop/src-tauri/src/settings.rs（守门测试需要源码）')
  }

  function collectDefaultKeys(obj: unknown, out: Set<string> = new Set()): Set<string> {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return out
    for (const [k, v] of Object.entries(obj)) {
      out.add(k)
      collectDefaultKeys(v, out)
    }
    return out
  }

  it('DEFAULT_SETTINGS 的每个键（含 shortcuts）都在 from_value_lenient 白名单里', () => {
    const src = rustSettingsSource()
    const start = src.indexOf('fn from_value_lenient')
    expect(start, 'settings.rs 缺少 from_value_lenient').toBeGreaterThan(0)
    const nextFn = src.indexOf('\nfn ', start + 10)
    const body = src.slice(start, nextFn > 0 ? nextFn : undefined)

    // 默认值里缺省、但前端会写入的字段（accentColor 不在 DEFAULT 中）
    const optional = ['accentColor', 'light', 'dark']
    const keys = [...collectDefaultKeys(DEFAULT_SETTINGS), ...optional]
    const missing = keys.filter((k) => !body.includes(`"${k}"`))
    expect(missing, `以下设置字段漏了 Rust from_value_lenient 白名单：${missing.join(', ')}`).toEqual([])
    expect(keys).toContain('shortcuts')
  })

  it('Rust 结构体同样声明 shortcuts（三处同步的第二处）', () => {
    const src = rustSettingsSource()
    const structStart = src.indexOf('pub struct EditorSettings')
    expect(structStart).toBeGreaterThan(0)
    const structEnd = src.indexOf('\n}', structStart)
    const body = src.slice(structStart, structEnd)
    expect(body).toContain('pub shortcuts:')
  })
})
