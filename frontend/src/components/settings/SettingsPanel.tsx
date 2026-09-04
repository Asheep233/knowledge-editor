/** 设置面板（Phase 7 M3，规划第 7 章 7.3）：右侧抽屉。
 *
 * 四组设置（schema v1，读写经 Rust 命令，Web 降级 localStorage）：
 * 启动（恢复上次状态 / 自动打开最近 Workspace）、编辑器（自动保存间隔 / 历史版本保留数量）、
 * 界面（主题 system/light/dark）、维护（查看日志 / 打开数据目录 / 重建索引）。
 * 改动即时保存并即时生效（autosave 间隔经 settings 缓存由 EditorArea 读取）。
 */
import { useEffect, useState } from 'react'
import { rebuildIndex } from '../../api/client'
import type { AppSettings, SettingsPatch } from '../../settings'
import {
  DEFAULT_SETTINGS,
  applyTheme,
  isTauri,
  loadSettings,
  saveSettings,
} from '../../settings'
import { Icon } from '../icons'

interface Props {
  open: boolean
  onClose: () => void
}

const THEME_OPTIONS: { value: 'system' | 'light' | 'dark'; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

export default function SettingsPanel({ open, onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexResult, setIndexResult] = useState<string | null>(null)

  // 打开时重新加载（面板独立于 App 生命周期，设置可能被外部修改）
  useEffect(() => {
    if (!open) return
    let alive = true
    setReady(false)
    loadSettings()
      .then((s) => {
        if (!alive) return
        setSettings(s)
        setReady(true)
      })
      .catch(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [open])

  if (!open) return null

  const desktop = isTauri()

  /** 即时保存（开关/单选），成功后应用主题并刷新缓存 */
  const patchAndSave = async (patch: SettingsPatch) => {
    const next = await saveSettings(patch)
    setSettings(next)
    applyTheme(next.ui.theme)
  }

  const setNumber = async (group: 'startup' | 'editor', key: string, value: number) => {
    // 简单防御：非法数值回退当前值（不写盘）
    if (!Number.isFinite(value) || value < 0) return
    await patchAndSave({ [group]: { [key]: value } } as SettingsPatch)
  }

  const handleAutosaveBlur = async (value: string) => {
    const v = Number(value)
    if (!Number.isInteger(v) || v < 500 || v > 600000) {
      setSettings((s) => ({ ...s, editor: { ...s.editor, autosaveIntervalMs: s.editor.autosaveIntervalMs } }))
      return
    }
    if (v === settings.editor.autosaveIntervalMs) return
    await setNumber('editor', 'autosaveIntervalMs', v)
  }

  const handleRetentionBlur = async (value: string) => {
    const v = Number(value)
    if (!Number.isInteger(v) || v < 1 || v > 999) {
      setSettings((s) => ({ ...s, editor: { ...s.editor, historyRetentionCount: s.editor.historyRetentionCount } }))
      return
    }
    if (v === settings.editor.historyRetentionCount) return
    await setNumber('editor', 'historyRetentionCount', v)
  }

  const handleOpenDir = async (cmd: 'open_log_dir' | 'open_data_dir') => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke(cmd)
    } catch (e) {
      window.alert(`打开目录失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleRebuildIndex = async () => {
    if (!window.confirm('重建全文索引？重建期间搜索功能暂不可用。')) return
    setIndexBusy(true)
    setIndexResult(null)
    try {
      const payload = await rebuildIndex()
      const s = payload.stats
      setIndexResult(`重建完成：文档 ${s.document} / 模块 ${s.module} / 附件 ${s.attachment}`)
    } catch (e) {
      setIndexResult(`重建失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIndexBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/20" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 flex h-full w-[400px] flex-col border-l border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <h2 className="text-sm font-semibold text-gray-800">设置</h2>
          <button
            type="button"
            data-action="close-settings"
            onClick={onClose}
            title="关闭"
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <Icon name="close" className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-gray-700">
          {!ready && <p className="py-8 text-center text-gray-400">加载设置中…</p>}

          {/* 启动 */}
          <section className="mb-4">
            <h3 className="mb-1.5 border-b border-gray-100 pb-1 text-[11px] font-semibold text-gray-400">
              启动
            </h3>
            <ToggleRow
              label="恢复上次状态"
              desc="重开上次文档与侧栏布局（迁移期沿用现有记忆逻辑）"
              checked={settings.startup.restoreLastState}
              onChange={(v) => void patchAndSave({ startup: { restoreLastState: v } })}
            />
            <ToggleRow
              label="自动打开最近 Workspace"
              desc="启动时自动打开最近使用的工作区"
              checked={settings.startup.autoOpenRecentWorkspace}
              onChange={(v) => void patchAndSave({ startup: { autoOpenRecentWorkspace: v } })}
            />
          </section>

          {/* 编辑器 */}
          <section className="mb-4">
            <h3 className="mb-1.5 border-b border-gray-100 pb-1 text-[11px] font-semibold text-gray-400">
              编辑器
            </h3>
            <NumberRow
              label="自动保存间隔（毫秒）"
              desc="停止输入后延迟保存，500–600000"
              value={settings.editor.autosaveIntervalMs}
              onBlur={(v) => void handleAutosaveBlur(v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const target = e.currentTarget as HTMLInputElement
                  target.blur()
                }
              }}
            />
            <NumberRow
              label="历史版本保留数量"
              desc="每篇文档保留的备份份数（1–999，迁移期保持 30）"
              value={settings.editor.historyRetentionCount}
              onBlur={(v) => void handleRetentionBlur(v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const target = e.currentTarget as HTMLInputElement
                  target.blur()
                }
              }}
            />
          </section>

          {/* 界面 */}
          <section className="mb-4">
            <h3 className="mb-1.5 border-b border-gray-100 pb-1 text-[11px] font-semibold text-gray-400">
              界面
            </h3>
            <div className="flex gap-2">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => void patchAndSave({ ui: { theme: opt.value } })}
                  className={[
                    'flex-1 rounded border px-2 py-1.5 text-center transition-colors',
                    settings.ui.theme === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                  ].join(' ')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">主题立即生效；深色 UI 完整适配在后续里程碑</p>
          </section>

          {/* 维护 */}
          <section className="mb-4">
            <h3 className="mb-1.5 border-b border-gray-100 pb-1 text-[11px] font-semibold text-gray-400">
              维护
            </h3>
            <div className="space-y-2">
              <MaintenanceButton
                action="open-log"
                label="查看日志"
                desc={desktop ? '打开日志目录（%APPDATA%\\KnowledgeEditor\\logs）' : '桌面版功能'}
                disabled={!desktop}
                onClick={() => void handleOpenDir('open_log_dir')}
              />
              <MaintenanceButton
                action="open-data"
                label="打开数据目录"
                desc={desktop ? '打开 Workspace 目录（%APPDATA%\\KnowledgeEditor\\workspace）' : '桌面版功能'}
                disabled={!desktop}
                onClick={() => void handleOpenDir('open_data_dir')}
              />
              <MaintenanceButton
                action="rebuild-index"
                label={indexBusy ? '重建中…' : '重建索引'}
                desc="重建全文索引（搜索 / 历史恢复依据）"
                disabled={indexBusy}
                onClick={() => void handleRebuildIndex()}
              />
              {indexResult && <p className="text-[11px] text-gray-500">{indexResult}</p>}
            </div>
          </section>
        </div>

        <footer className="shrink-0 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
          设置存储于应用数据目录（settings.json，schema v1），Web 版保存在浏览器本地
        </footer>
      </aside>
    </div>
  )
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="min-w-0 pr-3">
        <div className="text-[12px] text-gray-700">{label}</div>
        <div className="truncate text-[11px] text-gray-400" title={desc}>
          {desc}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-blue-600' : 'bg-gray-300',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

function NumberRow({
  label,
  desc,
  value,
  onBlur,
  onKeyDown,
}: {
  label: string
  desc: string
  value: number
  onBlur: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="flex items-center justify-between py-1">
      <div className="min-w-0 pr-3">
        <div className="text-[12px] text-gray-700">{label}</div>
        <div className="truncate text-[11px] text-gray-400" title={desc}>
          {desc}
        </div>
      </div>
      <input
        type="number"
        className="w-24 rounded border border-gray-200 px-2 py-1 text-right text-[12px] text-gray-700 focus:border-blue-400 focus:outline-none"
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          onBlur(draft ?? e.target.value)
          setDraft(null)
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

function MaintenanceButton({
  action,
  label,
  desc,
  disabled,
  onClick,
}: {
  action: string
  label: string
  desc: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        data-action={action}
        disabled={disabled}
        title={desc}
        onClick={onClick}
        className={[
          'rounded border px-3 py-1.5 text-[12px] transition-colors',
          disabled
            ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
        ].join(' ')}
      >
        {label}
      </button>
      <span className="min-w-0 truncate text-[11px] text-gray-400" title={desc}>
        {desc}
      </span>
    </div>
  )
}
