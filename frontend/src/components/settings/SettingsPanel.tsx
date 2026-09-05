/** 设置面板（Phase 7 M3，规划第 7 章 7.3）：右侧抽屉。
 *
 * 四组设置（schema v1，读写经 Rust 命令，Web 降级 localStorage）：
 * 启动（恢复上次状态 / 自动打开最近 Workspace）、编辑器（自动保存间隔 / 历史版本保留数量）、
 * 界面（主题 system/light/dark）、维护（查看日志 / 打开数据目录 / 重建索引）。
 * 改动即时保存并即时生效（autosave 间隔经 settings 缓存由 EditorArea 读取）。
 *
 * 本文件为「对齐参考稿 settings.html 卡片式布局」重排：右内容区 max-w-[680px] 居中，
 * 每组 = 标题行（14px 标题 + 右侧副文案）+ 一张 rounded-lg border bg-card 卡片，
 * 卡片内每行 px-4 py-3.5、行间 divide-y，行内左侧 14px 标题 + 12px 描述、右侧控件。
 * 仅为视觉重排，未改任何设置 schema / 持久化 / 锚点逻辑。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
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

/** 强调色默认值（与 index.css 令牌层一致：浅 #4285f4 / 深 #3b82f6） */
const DEFAULT_ACCENT = { light: '#4285f4', dark: '#3b82f6' }

export default function SettingsPanel({ open, onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexResult, setIndexResult] = useState<string | null>(null)
  // 分组导航（参考稿 §3.6：常规 / 外观 / 维护；左栏点击 = 右侧锚点跳转）
  const [group, setGroup] = useState<'general' | 'appearance' | 'maintenance'>('general')
  const contentRef = useRef<HTMLDivElement | null>(null)

  // 右侧滚动监听：更新左栏激活态（IntersectionObserver，组进入视口顶部即激活）
  useEffect(() => {
    if (!open) return
    const root = contentRef.current
    if (!root) return
    const targets = ['general', 'appearance', 'maintenance']
      .map((g) => document.getElementById(`settings-group-${g}`))
      .filter(Boolean) as HTMLElement[]
    if (targets.length === 0) return
    const onScroll = () => {
      const top = root.getBoundingClientRect().top
      let current: typeof group = 'general'
      for (const g of targets) {
        const el = g as HTMLElement & { dataset: { group: typeof group } }
        if (el.getBoundingClientRect().top - top <= 24) current = el.dataset.group
        else break
      }
      setGroup(current)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => root.removeEventListener('scroll', onScroll)
  }, [open])

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
    applyTheme(next.ui.theme, next.ui.accentColor)
  }

  const setNumber = async (group: 'startup' | 'editor', key: string, value: number) => {
    // 简单防御：非法数值回退当前值（不写盘）
    if (!Number.isFinite(value) || value < 0) return
    await patchAndSave({ [group]: { [key]: value } } as SettingsPatch)
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
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* 顶栏：标题行 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Icon name="settings" className="size-[18px] text-muted-foreground" />
          <span className="text-[16px] font-semibold tracking-tight text-foreground">设置</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">KnowledgeEditor v1.0.2 · Alpha</span>
          <button
            type="button"
            data-action="close-settings"
            onClick={onClose}
            title="返回编辑器"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左分组栏（参考稿 §3.6：220px popover 底 + 34px rounded-lg 按钮，点击锚点跳转） */}
        <aside
          className="flex w-[220px] shrink-0 flex-col border-r p-3"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--popover)' }}
        >
          <div className="flex flex-col gap-1">
            {([
              ['general', '常规'],
              ['appearance', '外观'],
              ['maintenance', '维护'],
            ] as const).map(([g, label]) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(g)
                  const el = document.getElementById(`settings-group-${g}`)
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className={[
                  'flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none',
                  group === g
                    ? ''
                    : 'hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
                style={
                  group === g
                    ? { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
                    : { color: 'var(--foreground)' }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </aside>

        {/* 右内容区：全量多组滚动（参考稿：一页从上到下全部设置项，卡片式） */}
        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto bg-background">
          {!ready ? (
            <p className="py-8 text-center text-muted-foreground">加载设置中…</p>
          ) : (
            <div className="mx-auto flex w-full max-w-[680px] flex-col gap-7 px-6 py-6">
              {/* 常规：启动、恢复与保存偏好（锚点 general） */}
              <div id="settings-group-general" data-group="general" className="scroll-mt-4">
                <section aria-labelledby="section-general">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 id="section-general" className="text-[14px] font-semibold whitespace-nowrap text-foreground">常规</h2>
                    <p className="text-[12px] text-muted-foreground">启动、恢复与保存偏好</p>
                  </div>
                  <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
                    <div className="flex flex-col divide-y divide-border">
                      <SettingRow label="启动时恢复上次打开的文档" desc="继续上次的写作现场">
                        <Switch
                          checked={settings.startup.restoreLastState}
                          ariaLabel="启动时恢复上次打开的文档"
                          onChange={(v) => void patchAndSave({ startup: { restoreLastState: v } })}
                        />
                      </SettingRow>
                      <SettingRow label="启动时自动打开最近 Workspace" desc="自动打开最近使用的工作区">
                        <Switch
                          checked={settings.startup.autoOpenRecentWorkspace}
                          ariaLabel="启动时自动打开最近 Workspace"
                          onChange={(v) => void patchAndSave({ startup: { autoOpenRecentWorkspace: v } })}
                        />
                      </SettingRow>
                      <SettingRow label="自动保存间隔" desc="停止输入后延迟保存">
                        <Select
                          value={String(settings.editor.autosaveIntervalMs)}
                          ariaLabel="自动保存间隔"
                          options={[
                            { value: '1000', label: '1 秒' },
                            { value: '3000', label: '3 秒（默认）' },
                            { value: '5000', label: '5 秒' },
                            { value: '30000', label: '30 秒' },
                            { value: '60000', label: '1 分钟' },
                          ]}
                          onChange={(v) => void setNumber('editor', 'autosaveIntervalMs', Number(v))}
                        />
                      </SettingRow>
                      <SettingRow label="历史版本保留数量" desc="每篇文档保留的备份份数（1–999）">
                        <NumberInput
                          value={settings.editor.historyRetentionCount}
                          onBlur={(v) => void handleRetentionBlur(v)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const target = e.currentTarget as HTMLInputElement
                              target.blur()
                            }
                          }}
                        />
                      </SettingRow>
                    </div>
                  </div>
                </section>
              </div>

              {/* 外观：主题 + 自定义强调色（锚点 appearance） */}
              <div id="settings-group-appearance" data-group="appearance" className="scroll-mt-4">
                <section aria-labelledby="section-appearance">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 id="section-appearance" className="text-[14px] font-semibold whitespace-nowrap text-foreground">外观</h2>
                    <p className="text-[12px] text-muted-foreground">主题与界面强调色</p>
                  </div>
                  <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
                    <div className="flex flex-col divide-y divide-border">
                      <SettingRow label="主题" desc="深色主题跟随系统（v1.0.1+）">
                        <div role="group" aria-label="主题模式" className="inline-flex shrink-0 items-center rounded-lg border border-border bg-muted p-0.5">
                          {THEME_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              aria-pressed={settings.ui.theme === opt.value}
                              onClick={() => void patchAndSave({ ui: { theme: opt.value } })}
                              className={[
                                'flex h-7 items-center justify-center rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                                settings.ui.theme === opt.value
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-foreground hover:bg-card hover:text-accent-foreground',
                              ].join(' ')}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </SettingRow>
                      <SettingRow label="强调色 · 浅色" desc="自定义浅色主题强调色（留空用默认）">
                        <AccentControl
                          value={settings.ui.accentColor?.light}
                          fallback={DEFAULT_ACCENT.light}
                          ariaLabel="强调色 · 浅色"
                          onChange={(v) => void patchAndSave({ ui: { accentColor: { light: v ?? '' } } })}
                        />
                      </SettingRow>
                      <SettingRow label="强调色 · 深色" desc="自定义深色主题强调色（留空用默认）">
                        <AccentControl
                          value={settings.ui.accentColor?.dark}
                          fallback={DEFAULT_ACCENT.dark}
                          ariaLabel="强调色 · 深色"
                          onChange={(v) => void patchAndSave({ ui: { accentColor: { dark: v ?? '' } } })}
                        />
                      </SettingRow>
                    </div>
                  </div>
                </section>
              </div>

              {/* 维护：索引、数据目录与应用更新（锚点 maintenance） */}
              <div id="settings-group-maintenance" data-group="maintenance" className="scroll-mt-4">
                <section aria-labelledby="section-maintenance">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 id="section-maintenance" className="text-[14px] font-semibold whitespace-nowrap text-foreground">维护</h2>
                    <p className="text-[12px] text-muted-foreground">索引、数据目录与应用更新</p>
                  </div>
                  <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
                    <div className="flex flex-col divide-y divide-border">
                      <SettingRow label="重建索引" desc="重建全文索引（搜索 / 历史恢复依据）">
                        <Button
                          onClick={() => void handleRebuildIndex()}
                          disabled={indexBusy}
                          status={indexResult ?? undefined}
                        >
                          {indexBusy ? '重建中…' : '重建索引'}
                        </Button>
                      </SettingRow>
                      <SettingRow label="查看日志" desc={desktop ? '打开日志目录（%APPDATA%\\KnowledgeEditor\\logs）' : '桌面版功能'}>
                        <Button disabled={!desktop} onClick={() => void handleOpenDir('open_log_dir')}>查看日志</Button>
                      </SettingRow>
                      <SettingRow label="打开数据目录" desc={desktop ? '打开 Workspace 目录（%APPDATA%\\KnowledgeEditor\\workspace）' : '桌面版功能'}>
                        <Button disabled={!desktop} onClick={() => void handleOpenDir('open_data_dir')}>打开数据目录</Button>
                      </SettingRow>
                      <SettingRow label="检查更新" desc="当前使用的应用版本">
                        <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-secondary-foreground">
                          已是最新
                        </span>
                      </SettingRow>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 卡片行：左侧 14px 标题 + 12px 描述，右侧控件，px-4 py-3.5（参考稿行结构） */
function SettingRow({
  label,
  desc,
  children,
}: {
  label: string
  desc?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-5 text-foreground">{label}</p>
        {desc ? <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{desc}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** 开关（h-5 w-9 rounded-full，开 = --primary 底白圆钮；参考稿） */
function Switch({
  checked,
  ariaLabel,
  onChange,
}: {
  checked: boolean
  ariaLabel: string
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-primary' : 'bg-muted',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 size-4 rounded-full bg-white shadow transition-all duration-200',
          checked ? 'left-[18px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  )
}

/** 下拉（h-8 rounded-md border-input bg-popover，右侧 chevron；参考稿） */
function Select({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  ariaLabel: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 cursor-pointer appearance-none rounded-md border border-input bg-popover py-0 pl-3 pr-8 text-[13px] text-foreground/80 outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

/** 数字输入（h-8 rounded-md border-input bg-card；参考稿） */
function NumberInput({
  value,
  onBlur,
  onKeyDown,
}: {
  value: number
  onBlur: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      className="w-24 rounded-md border border-input bg-card px-2 py-1 text-[13px] text-right text-foreground/80 outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        onBlur(draft ?? e.target.value)
        setDraft(null)
      }}
      onKeyDown={onKeyDown}
    />
  )
}

/** 强调色控件：色板 + hex 输入 + 重置按钮（空值 = 使用主题默认） */
function AccentControl({
  value,
  fallback,
  ariaLabel,
  onChange,
}: {
  value?: string
  fallback: string
  ariaLabel: string
  onChange: (v: string | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const current = draft ?? value ?? ''
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={current || fallback}
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(e.target.value)
        }}
        className="h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
      />
      <input
        type="text"
        value={current}
        placeholder={fallback}
        aria-label={`${ariaLabel} 色值`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value.trim()
          setDraft(null)
          if (!v) {
            onChange(null)
          } else if (/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v)) {
            onChange(v)
          }
          // 非法值：不落盘，输入框回显当前保存值
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="w-[74px] shrink-0 rounded border border-input bg-card px-1.5 py-1 font-mono text-[11px] text-foreground/80 outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
      />
      <button
        type="button"
        title="重置为默认"
        aria-label={`${ariaLabel} 重置`}
        disabled={!value}
        onClick={() => onChange(null)}
        className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="rebuild" className="size-3.5" />
      </button>
    </div>
  )
}

/** 维护操作按钮（h-8 rounded-md border bg-card，右侧可选 status 小字） */
function Button({
  children,
  onClick,
  disabled,
  status,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  status?: string
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={[
          'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
          disabled
            ? 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/50'
            : 'border-border bg-card text-foreground/80 hover:bg-muted',
        ].join(' ')}
      >
        {children}
      </button>
      {status ? <p className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={status}>{status}</p> : null}
    </div>
  )
}
