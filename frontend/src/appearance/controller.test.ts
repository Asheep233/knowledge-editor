import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, SettingsPatch } from '../settings'
import { EXAMPLE_APPEARANCE, type AppearancePackage } from './model'

const mocks = vi.hoisted(() => ({
  getCachedSettings: vi.fn(),
  saveSettings: vi.fn(),
  renderAppearance: vi.fn(),
}))

vi.mock('../settings', () => ({
  getCachedSettings: mocks.getCachedSettings,
  saveSettings: mocks.saveSettings,
}))
vi.mock('./runtime', () => ({ renderAppearance: mocks.renderAppearance }))

type Controller = typeof import('./controller')
let controller: Controller
let cached: AppSettings

const packageOf = (id: string): AppearancePackage => ({ ...structuredClone(EXAMPLE_APPEARANCE), id, name: id })
const envelope = (current: unknown, previous: unknown = null) =>
  JSON.stringify({ schemaVersion: 1, current, previous })

function updateCache(patch: SettingsPatch): AppSettings {
  cached = {
    ...cached,
    ui: {
      ...cached.ui,
      ...patch.ui,
      displayPreference: { ...cached.ui.displayPreference, ...patch.ui?.displayPreference },
    },
  }
  return structuredClone(cached)
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.resetModules()
  window.history.replaceState(null, '', '/')
  cached = {
    schemaVersion: 1,
    startup: { restoreLastState: true, autoOpenRecentWorkspace: true },
    editor: { autosaveIntervalMs: 3000, historyRetentionCount: 30, display: {}, shortcuts: { 'editor.bold': 'Ctrl+B' } },
    ui: { theme: 'dark', accentColor: { dark: '#123456' }, displayPreference: { unrelated: { retained: true } } },
    maintenance: {},
  }
  mocks.getCachedSettings.mockImplementation(() => cached)
  mocks.saveSettings.mockImplementation(async (patch: SettingsPatch) => updateCache(patch))
  controller = await import('./controller')
})

afterEach(() => {
  controller.cancelAppearancePreview()
  vi.useRealTimers()
})

describe('appearance controller storage and recovery', () => {
  it('uses defaults when older settings omit displayPreference, without blocking startup', () => {
    const legacy = { ui: { theme: 'system' } } as AppSettings
    expect(controller.initializeAppearance(legacy).current).toBeNull()
    expect(controller.getAppearanceStatus().mode).toBe('default')
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(null)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('loads existing settings without writing or altering application preferences', () => {
    const pkg = packageOf('stored')
    cached.ui.displayPreference.appearanceV1 = envelope(pkg)
    const before = structuredClone(cached)
    expect(controller.initializeAppearance(cached).current).toEqual(pkg)
    expect(controller.getAppearanceStatus().mode).toBe('active')
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(pkg)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
    expect(cached).toEqual(before)
  })

  it.each([
    'broken JSON',
    JSON.stringify({ schemaVersion: 42, current: null, previous: null }),
    envelope({ ...packageOf('future'), appearanceApi: 999 }),
  ])('preserves rejected raw input and uses the built-in UI: %s', (raw) => {
    cached.ui.displayPreference.appearanceV1 = raw
    controller.initializeAppearance(cached)
    expect(controller.getAppearanceState().current).toBeNull()
    expect(controller.getAppearanceStatus()).toMatchObject({ mode: 'fallback', rawAvailable: true })
    expect(controller.getAppearanceStatus().reason).toBeTruthy()
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(null)
    expect(controller.exportAppearance()).toBe(raw)
    expect(controller.exportAppearanceBackup()).toBe(raw)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('retains rejected raw data through explicit reset and another app startup', async () => {
    const raw = '{"schemaVersion":99,"futureData":"keep me"}'
    cached.ui.displayPreference.appearanceV1 = raw
    controller.initializeAppearance(cached)
    await controller.resetAppearance()
    expect(controller.getAppearanceStatus().mode).toBe('default')
    expect(cached.ui.displayPreference.appearanceBackupV1).toBe(raw)
    expect(controller.exportAppearanceBackup()).toBe(raw)
    vi.resetModules()
    controller = await import('./controller')
    controller.initializeAppearance(cached)
    expect(controller.exportAppearanceBackup()).toBe(raw)
  })

  it('uses appearance=off for this startup without modifying saved packages', () => {
    const pkg = packageOf('saved')
    const raw = envelope(pkg)
    cached.ui.displayPreference.appearanceV1 = raw
    window.history.replaceState(null, '', '/?appearance=off')
    expect(controller.initializeAppearance(cached).current).toEqual(pkg)
    expect(controller.getAppearanceStatus().mode).toBe('fallback')
    expect(controller.getAppearanceStatus().reason).toContain('appearance=off')
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(null)
    expect(controller.exportAppearanceBackup()).toBe(raw)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('persists one opaque JSON value and keeps unrelated settings untouched', async () => {
    const before = structuredClone(cached)
    const pkg = packageOf('installed')
    await controller.applyAppearance(JSON.stringify(pkg))
    expect(mocks.saveSettings).toHaveBeenCalledWith({ ui: { displayPreference: { appearanceV1: expect.any(String) } } }, { requirePersistence: true })
    expect(JSON.parse(mocks.saveSettings.mock.calls[0][0].ui.displayPreference.appearanceV1)).toEqual({ schemaVersion: 1, current: pkg, previous: null })
    expect(cached.ui.displayPreference.unrelated).toEqual(before.ui.displayPreference.unrelated)
    expect(cached.ui.theme).toBe('dark')
    expect(cached.ui.accentColor).toEqual(before.ui.accentColor)
    expect(cached.editor).toEqual(before.editor)
    expect(controller.getAppearanceState().current).toEqual(pkg)
    expect(JSON.parse(controller.exportAppearance())).toEqual(pkg)
  })

  it('reset and rollback preserve the saved package, including default/null transitions', async () => {
    const pkg = packageOf('installed')
    await controller.applyAppearance(pkg)
    await controller.rollbackAppearance()
    expect(controller.getAppearanceState()).toMatchObject({ current: null, previous: pkg })
    await controller.rollbackAppearance()
    expect(controller.getAppearanceState()).toMatchObject({ current: pkg, previous: null })
    await controller.resetAppearance()
    await controller.resetAppearance()
    expect(controller.getAppearanceState()).toMatchObject({ current: null, previous: pkg })
    await controller.rollbackAppearance()
    expect(controller.getAppearanceState().current).toEqual(pkg)
  })

  it('rejects invalid packages without replacing saved settings or a valid preview', async () => {
    const pkg = packageOf('preview')
    controller.previewAppearance(pkg)
    const calls = mocks.renderAppearance.mock.calls.length
    await expect(controller.applyAppearance({ appearanceApi: 999 })).rejects.toThrow()
    expect(() => controller.previewAppearance('{}')).toThrow()
    expect(controller.getAppearanceStatus().mode).toBe('preview')
    expect(mocks.renderAppearance).toHaveBeenCalledTimes(calls)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })
})

describe('appearance controller ordering and previews', () => {
  it('waits for persistence before committing runtime state', async () => {
    const pkg = packageOf('pending')
    let finish!: () => void
    mocks.saveSettings.mockImplementation(async (patch: SettingsPatch) => {
      await new Promise<void>((resolve) => { finish = resolve })
      return updateCache(patch)
    })
    const pending = controller.applyAppearance(pkg)
    await Promise.resolve()
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1)
    expect(controller.getAppearanceState().current).toBeNull()
    expect(mocks.renderAppearance).not.toHaveBeenCalled()
    finish()
    await pending
    expect(controller.getAppearanceState().current).toEqual(pkg)
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(pkg)
  })

  it('serializes writes and reads the latest saved package for rollback', async () => {
    const first = packageOf('first')
    const second = packageOf('second')
    let finish!: () => void
    mocks.saveSettings.mockImplementationOnce(async (patch: SettingsPatch) => {
      await new Promise<void>((resolve) => { finish = resolve })
      return updateCache(patch)
    })
    const pendingFirst = controller.applyAppearance(first)
    const pendingSecond = controller.applyAppearance(second)
    await Promise.resolve()
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([pendingFirst, pendingSecond])
    expect(controller.getAppearanceState()).toMatchObject({ current: second, previous: first })
    const externallySaved = packageOf('external')
    cached.ui.displayPreference.appearanceV1 = envelope(externallySaved, first)
    await controller.resetAppearance()
    expect(controller.getAppearanceState()).toMatchObject({ current: null, previous: externallySaved })
  })

  it('keeps a newer SDK preview while an earlier package finishes saving', async () => {
    const installed = packageOf('installed')
    const temporary = packageOf('newer-preview')
    let finish!: () => void
    mocks.saveSettings.mockImplementationOnce(async (patch: SettingsPatch) => {
      await new Promise<void>((resolve) => { finish = resolve })
      return updateCache(patch)
    })
    const pending = controller.applyAppearance(installed)
    await Promise.resolve()
    controller.previewAppearance(temporary, 1000)
    finish()
    await pending
    expect(controller.getAppearanceState().current).toEqual(installed)
    expect(controller.getAppearanceStatus().mode).toBe('preview')
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(temporary)
    vi.advanceTimersByTime(1000)
    expect(controller.getAppearanceStatus().mode).toBe('active')
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(installed)
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('reports write failures, retains the runtime and allows subsequent writes', async () => {
    const first = packageOf('saved')
    await controller.applyAppearance(first)
    controller.previewAppearance(packageOf('preview'))
    const before = controller.exportAppearanceBackup()
    mocks.saveSettings.mockRejectedValueOnce(new Error('disk full'))
    await expect(controller.applyAppearance(packageOf('failed'))).rejects.toThrow('disk full')
    expect(controller.getAppearanceState().current).toEqual(first)
    expect(controller.getAppearanceStatus().mode).toBe('preview')
    expect(controller.exportAppearanceBackup()).toBe(before)
    await controller.applyAppearance(packageOf('retry'))
    expect(controller.getAppearanceState().current?.id).toBe('retry')
    expect(controller.getAppearanceStatus().mode).toBe('active')
  })

  it('never persists previews, caps their duration and restores the saved package', async () => {
    const pkg = packageOf('saved')
    await controller.applyAppearance(pkg)
    mocks.saveSettings.mockClear()
    controller.previewAppearance(packageOf('temporary'), 120_000)
    expect(controller.getAppearanceStatus()).toMatchObject({ mode: 'preview', previewExpiresAt: Date.now() + 30_000 })
    expect(controller.getAppearanceState().current).toEqual(pkg)
    vi.advanceTimersByTime(29_999)
    expect(controller.getAppearanceStatus().mode).toBe('preview')
    vi.advanceTimersByTime(1)
    expect(controller.getAppearanceStatus()).toMatchObject({ mode: 'active', previewExpiresAt: null })
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(pkg)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('replaces preview timers and leaves an identical settings reload alone', () => {
    controller.initializeAppearance(cached)
    controller.previewAppearance(packageOf('first'), 1000)
    vi.advanceTimersByTime(500)
    controller.previewAppearance(packageOf('second'), 2000)
    controller.initializeAppearance(cached)
    vi.advanceTimersByTime(500)
    expect(controller.getAppearanceStatus().mode).toBe('preview')
    vi.advanceTimersByTime(1500)
    expect(controller.getAppearanceStatus().mode).toBe('default')
    expect(mocks.renderAppearance).toHaveBeenLastCalledWith(null)
  })

  it('protects state and SDK contract snapshots from caller mutations and emits updates', async () => {
    const onChange = vi.fn()
    window.addEventListener(controller.APPEARANCE_CHANGED_EVENT, onChange)
    try {
      const api = controller.installAppearanceApi()
      expect(window.astranotaAppearance).toBe(api)
      const contract = api.contract as unknown as Record<string, unknown>
      contract.changedByCaller = true
      expect((api.contract as unknown as Record<string, unknown>).changedByCaller).toBeUndefined()
      const pkg = packageOf('saved')
      await api.apply(pkg)
      pkg.name = 'changed input'
      const snapshot = api.get()
      snapshot.state.current!.name = 'changed output'
      expect(controller.getAppearanceState().current?.name).toBe('saved')
      expect(onChange).toHaveBeenCalledTimes(1)
      api.preview(packageOf('preview'), 100)
      const previewSnapshot = api.get().preview!
      previewSnapshot.name = 'changed preview output'
      expect(controller.getPreviewAppearance()?.name).toBe('preview')
      expect(api.get().preview?.name).toBe('preview')
      api.cancelPreview()
      expect(controller.getPreviewAppearance()).toBeNull()
      vi.advanceTimersByTime(100)
      expect(onChange).toHaveBeenCalledTimes(3)
    } finally {
      window.removeEventListener(controller.APPEARANCE_CHANGED_EVENT, onChange)
    }
  })
})
