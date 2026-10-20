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
import { APP_VERSION } from '../../version'
import { askConfirm } from '../common/PromptDialog'
import ShortcutsSection from './ShortcutsSection'
import AppearanceSection from './AppearanceSection'
import { getAppearanceStatus } from '../../appearance/controller'

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

/** 设置分组（左栏导航 + 右侧锚点；**顺序即文档顺序**，task-37 高亮联动依据） */
const GROUPS = ['general', 'appearance', 'shortcuts', 'maintenance'] as const
type Group = (typeof GROUPS)[number]

/** 左栏高亮参考线：滚动容器顶部下方 24px 处，最后一个越过该线的分组即激活 */
const ACTIVE_LINE_OFFSET = 24

/**
 * 点击左栏后的**抑制窗口**（ms）：平滑滚动期间忽略滚动驱动的高亮更新，避免「点击后闪烁」
 * （实测 维护 → 快捷键 → 维护）。取值依据：Chromium 平滑滚动典型 300–500ms，700ms 覆盖到位；
 * 到期后**强制复核一次**（有界，不会永久滞留点击选择）。
 */
const CLICK_SYNC_SUPPRESS_MS = 700

/** 「触底 / 可滚」判定容差（px） */
const SCROLL_EPSILON = 2

export default function SettingsPanel({ open, onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexResult, setIndexResult] = useState<string | null>(null)
  // 分组导航（参考稿 §3.6：常规 / 外观 / 快捷键 / 维护；左栏点击 = 右侧锚点跳转）
  const [group, setGroup] = useState<Group>('general')
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** 点击抑制截止时间戳（0 = 无抑制） */
  const clickSuppressUntilRef = useRef(0)
  /** 抑制到期后的复核定时器 */
  const clickSuppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 当前滚动同步函数（定时器/点击处理器复用，避免合成事件） */
  const syncGroupRef = useRef<() => void>(() => undefined)

  // 保持设置组件挂载，预览确认条通过 portal 显示在主界面上。
  useEffect(() => {
    if (!open) return
    const sync = () => setPreviewing(getAppearanceStatus().mode === 'preview')
    sync()
    window.addEventListener('ke:appearance-changed', sync)
    return () => window.removeEventListener('ke:appearance-changed', sync)
  }, [open])

  // 右侧滚动监听：更新左栏激活态（scroll + 参考线比较；**不是** IntersectionObserver）。
  // task-37 修复：旧实现只在 `open` 时用 `document.getElementById` 取一次目标元素并缓存，
  // 而「加载设置中…」占位会把整棵内容子树卸载重挂 → 缓存节点变成 detached（rect 全 0）→
  // 每次比较都通过 → 恒高亮最后一组「维护」，且滚回顶部也不回落（主理人 GUI 实测缺陷）。
  // 现在：① 依赖 `ready`（内容挂载后才注册）；② **每次滚动重新查询**目标元素，绝不缓存；
  //       ③ 不可滚动时滚动位置无信息量 → 不动高亮（否则「触底例外」恒真会误高亮末段）；
  //       ④ 点击后的抑制窗口内不跟滚动（防平滑滚动中途闪烁），到期复核一次。
  useEffect(() => {
    if (!open || !ready) return
    const root = contentRef.current
    if (!root) return

    const syncActiveGroup = () => {
      // ④ 点击抑制窗口内：保持点击目标，避免平滑滚动中途闪回中间分组
      if (Date.now() < clickSuppressUntilRef.current) return
      const sections = GROUPS.map((g) => root.querySelector<HTMLElement>(`#settings-group-${g}`)).filter(
        (el): el is HTMLElement => el !== null,
      )
      if (sections.length === 0) return
      // ③ 不可滚动（内容不足一屏 / 高倍缩放）：滚动位置无信息量 → 高亮交给点击，不做滚动联动。
      //    若不挡这一步，下面的「触底例外」会在 scrollHeight === clientHeight 时恒真 →
      //    高亮被钉死在末段「维护」，而屏幕顶部显示的是「常规」（verifier 反例）。
      const scrollable = root.scrollHeight - root.clientHeight > SCROLL_EPSILON
      if (!scrollable) return
      const line = root.getBoundingClientRect().top + ACTIVE_LINE_OFFSET
      // 兜底：一个分组都未越过参考线（顶部品牌区下方）时高亮第一组
      let current = (sections[0].dataset.group as Group | undefined) ?? 'general'
      for (const el of sections) {
        if (el.getBoundingClientRect().top <= line) current = (el.dataset.group as Group | undefined) ?? current
        else break
      }
      // 触底例外：最后一组永远到不了参考线（已滚到底）→ 高亮最后一组，
      // 否则点击「维护」后高亮会停在倒数第二组（点击与高亮打架）。
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - SCROLL_EPSILON
      if (atBottom) current = (sections[sections.length - 1].dataset.group as Group | undefined) ?? current
      setGroup((prev) => (prev === current ? prev : current))
    }

    syncGroupRef.current = syncActiveGroup
    root.addEventListener('scroll', syncActiveGroup, { passive: true })
    syncActiveGroup()
    return () => {
      root.removeEventListener('scroll', syncActiveGroup)
      syncGroupRef.current = () => undefined
    }
  }, [open, ready])

  // 卸载/关闭时清理点击抑制定时器
  useEffect(
    () => () => {
      if (clickSuppressTimerRef.current !== null) clearTimeout(clickSuppressTimerRef.current)
      clickSuppressTimerRef.current = null
    },
    [],
  )

  /**
   * 点击左栏分组：立即高亮（点击意图优先）→ 开抑制窗口 → 平滑滚动 →
   * 窗口到期**强制复核一次**（滚动已停，按真实位置对齐；与点击目标一致则无变化）。
   * 取舍：抑制是**有界**的（700ms），到期必复核 → 既不闪烁，也不丢「滚轮/滚动条滚动时高亮跟随」。
   */
  const jumpToGroup = (g: Group) => {
    setGroup(g)
    clickSuppressUntilRef.current = Date.now() + CLICK_SYNC_SUPPRESS_MS
    if (clickSuppressTimerRef.current !== null) clearTimeout(clickSuppressTimerRef.current)
    clickSuppressTimerRef.current = setTimeout(() => {
      clickSuppressTimerRef.current = null
      clickSuppressUntilRef.current = 0
      syncGroupRef.current()
    }, CLICK_SYNC_SUPPRESS_MS)
    document.getElementById(`settings-group-${g}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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

  /** 即时保存（开关/单选），成功后应用主题并刷新缓存。
   * F19：失败不再静默——显示明确错误（原实现抛错阻塞调用链且无反馈）。 */
  const patchAndSave = async (patch: SettingsPatch) => {
    try {
      const next = await saveSettings(patch)
      setSettings(next)
      applyTheme(next.ui.theme, next.ui.accentColor)
    } catch (e) {
      window.alert(`设置保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
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

  /**
   * task-29：保存单个动作的快捷键。
   * 值语义：`''` = 恢复内置默认；`'none'` = 解绑墓碑；其它 = 自定义规范键位。
   * 走 `{ editor: { shortcuts: { <actionId>: spec } } }` 补丁 → 后端 merge_value 键级深合并
   * （其它动作的绑定不受影响）。保存后分发器下次按键即用新值（即改即生效，无需重启）。
   */
  const handleShortcutBind = async (actionId: string, spec: string) => {
    await patchAndSave({ editor: { shortcuts: { [actionId]: spec } } })
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
    if (!(await askConfirm('重建全文索引？重建期间搜索功能暂不可用。'))) return
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
    <div
      data-ke-slot="settings"
      data-ke-appearance-scope="chrome"
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={previewing ? { display: 'none' } : undefined}
      aria-hidden={previewing || undefined}
    >
      {/* 遮罩：点击空白处返回编辑器（阻断式浮层，scrim 取设计令牌） */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--scrim)' }}
      />

      {/* 居中设置浮层：宽 min(760px, 100vw-48px)、高 ≤ 85vh、24px 圆角卡片 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative z-10 flex max-h-[85vh] flex-col overflow-hidden rounded-[24px] border border-border bg-card"
        style={{ width: 'min(760px, calc(100vw - 48px))', boxShadow: 'var(--elev-lg)' }}
      >
        {/* 头部：返回 / 标题 / 版本号 */}
        <div className="shrink-0 border-b border-border">
          <header className="flex flex-wrap items-start gap-3 px-6 pb-3 pt-5">
            <button
              type="button"
              data-action="close-settings"
              onClick={onClose}
              title="返回编辑器"
              aria-label="返回编辑器"
              className="grid size-8 shrink-0 place-items-center rounded-control border border-border bg-card text-text-2 shadow-sm transition-colors hover:bg-surface-2 hover:text-foreground motion-reduce:transition-none"
            >
              <Icon name="chevron-left" className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 id="settings-title" className="font-display text-[21px] font-semibold tracking-tight text-foreground">
                设置
              </h1>
              <p className="mt-0.5 text-[12px] leading-5 text-text-3">所有偏好只保存在本机，修改后立即生效。</p>
            </div>
            <span className="whitespace-nowrap pt-1 text-[12px] text-text-3">
              AstraNota v{APP_VERSION} · Alpha
            </span>
          </header>

          {/* 分组导航：卡片内顶部横向分段；点击滚动到对应分组
              （button[data-nav-group] / aria-current="page" 契约保留，供滚动联动与读屏） */}
          <nav aria-label="设置分组" className="flex flex-wrap items-center gap-1 px-6 pb-3">
            {(
              [
                ['general', '常规'],
                ['appearance', '外观'],
                ['shortcuts', '快捷键'],
                ['maintenance', '维护'],
              ] as const
            ).map(([g, label]) => (
              <button
                key={g}
                type="button"
                // task-37：激活态补 aria-current（与视觉高亮同源，便于断言/读屏）
                aria-current={group === g ? 'page' : undefined}
                data-nav-group={g}
                onClick={() => jumpToGroup(g)}
                className={[
                  'flex h-8 items-center rounded-menu px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 active:scale-[.98] motion-reduce:transition-none',
                  group === g
                    ? 'bg-primary-soft text-accent-foreground'
                    : 'text-text-2 hover:bg-surface-2 hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* 内容区：全量多组滚动（一页从上到下全部设置项，分组卡片式）
            class 保持 min-h-0 flex-1 overflow-y-auto bg-background —— 是 task-37 滚动联动的根节点契约 */}
        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto bg-background">
          {!ready ? (
            <p className="py-10 text-center text-[13px] text-text-3">加载设置中…</p>
          ) : (
            <div className="mx-auto flex w-full flex-col gap-5 px-6 py-6">
              {/* 常规：启动、恢复与保存偏好（锚点 general） */}
              <GroupAnchor group="general">
                <section
                  aria-labelledby="section-general"
                  className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm"
                >
                  <GroupHeading id="section-general" title="常规" desc="启动、恢复与保存偏好" />
                  <div className="flex flex-col divide-y divide-border border-t border-border">
                    <SettingRow label="启动时恢复上次打开的文档" desc="继续上次的写作现场">
                      <Switch
                        checked={settings.startup.restoreLastState}
                        ariaLabel="启动时恢复上次打开的文档"
                        onChange={(v) => void patchAndSave({ startup: { restoreLastState: v } })}
                      />
                    </SettingRow>
                    <SettingRow label="切换工作区…" desc="打开工作区选择窗口（与菜单「文件 → 打开工作区」等效）">
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent('ke:open-workspace-dialog'))}
                        className="h-9 rounded-control bg-surface-2 px-3.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-surface-3"
                      >
                        切换…
                      </button>
                    </SettingRow>
                    <SettingRow label="启动时自动打开最近 Workspace" desc="自动打开最近使用的工作区">
                      <Switch
                        checked={settings.startup.autoOpenRecentWorkspace}
                        ariaLabel="启动时自动打开最近 Workspace"
                        onChange={(v) => void patchAndSave({ startup: { autoOpenRecentWorkspace: v } })}
                      />
                    </SettingRow>
                    <SettingRow label="公式自动补全" desc="输入 \\ 命令时悬浮建议，Tab 选择（如 \\fr → \\frac）">
                      <Switch
                        checked={settings.editor.mathAutocomplete !== false}
                        ariaLabel="公式自动补全"
                        onChange={(v) => void patchAndSave({ editor: { mathAutocomplete: v } })}
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
                </section>
              </GroupAnchor>

              {/* 外观：主题 + 自定义强调色（锚点 appearance） */}
              <GroupAnchor group="appearance">
                <section
                  aria-labelledby="section-appearance"
                  className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm"
                >
                  <GroupHeading id="section-appearance" title="外观" desc="主题、强调色与自定义外观包" />
                  <div className="flex flex-col divide-y divide-border border-t border-border">
                    <SettingRow label="主题" desc="深色主题跟随系统（v1.0.1+）">
                      <div
                        role="group"
                        aria-label="主题模式"
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-control bg-surface-2 p-0.5"
                      >
                        {THEME_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            aria-pressed={settings.ui.theme === opt.value}
                            onClick={() => void patchAndSave({ ui: { theme: opt.value } })}
                            className={[
                              'flex h-8 items-center justify-center rounded-[6px] px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors',
                              settings.ui.theme === opt.value
                                ? 'bg-card text-foreground shadow-sm'
                                : 'text-text-2 hover:text-foreground',
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
                    <SettingRow label="信息块背景透明度" desc="ke-note 背景不透明度（100% = 不透明）">
                      <OpacityControl
                        value={settings.editor.noteBgOpacity ?? 100}
                        ariaLabel="信息块背景透明度"
                        onChange={(v) => void patchAndSave({ editor: { noteBgOpacity: v } })}
                      />
                    </SettingRow>
                    <SettingRow label="引用块背景透明度" desc="引用块背景不透明度（100% = 不透明）">
                      <OpacityControl
                        value={settings.editor.quoteBgOpacity ?? 100}
                        ariaLabel="引用块背景透明度"
                        onChange={(v) => void patchAndSave({ editor: { quoteBgOpacity: v } })}
                      />
                    </SettingRow>
                  </div>
                </section>
                <div className="mt-4">
                  <AppearanceSection />
                </div>
              </GroupAnchor>

              {/* 快捷键：自定义动作键位（锚点 shortcuts；task-29） */}
              <GroupAnchor group="shortcuts">
                <section
                  aria-labelledby="section-shortcuts"
                  className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm"
                >
                  <GroupHeading id="section-shortcuts" title="快捷键" desc="为动作绑定自定义键位（默认沿用内置键位）" />
                  <ShortcutsSection
                    bindings={settings.editor.shortcuts ?? {}}
                    onBind={(actionId, spec) => handleShortcutBind(actionId, spec)}
                  />
                </section>
              </GroupAnchor>

              {/* 维护：索引、数据目录与应用更新（锚点 maintenance） */}
              <GroupAnchor group="maintenance">
                <section
                  aria-labelledby="section-maintenance"
                  className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm"
                >
                  <GroupHeading id="section-maintenance" title="维护" desc="索引、数据目录与应用更新" />
                  <div className="flex flex-col divide-y divide-border border-t border-border">
                    <SettingRow label="重建索引" desc="重建全文索引（搜索 / 历史恢复依据）">
                      <Button
                        onClick={() => void handleRebuildIndex()}
                        disabled={indexBusy}
                        status={indexResult ?? undefined}
                      >
                        {indexBusy ? '重建中…' : '重建索引'}
                      </Button>
                    </SettingRow>
                    <SettingRow
                      label="查看日志"
                      desc={desktop ? '打开日志目录（%APPDATA%\\KnowledgeEditor\\logs）' : '桌面版功能'}
                    >
                      <Button disabled={!desktop} onClick={() => void handleOpenDir('open_log_dir')}>查看日志</Button>
                    </SettingRow>
                    <SettingRow
                      label="打开数据目录"
                      desc={desktop ? '打开 Workspace 目录（%APPDATA%\\KnowledgeEditor\\workspace）' : '桌面版功能'}
                    >
                      <Button disabled={!desktop} onClick={() => void handleOpenDir('open_data_dir')}>打开数据目录</Button>
                    </SettingRow>
                    <SettingRow label="检查更新" desc="当前使用的应用版本">
                      <span className="text-[12.5px] font-medium text-success">已是最新</span>
                    </SettingRow>
                  </div>
                </section>
              </GroupAnchor>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 分组锚点：id / data-group 是滚动联动（task-37）与测试的契约，必须保留 */
function GroupAnchor({ group, children }: { group: Group; children: ReactNode }) {
  return (
    <div id={`settings-group-${group}`} data-group={group} className="scroll-mt-6">
      {children}
    </div>
  )
}

/** 分组卡头部：17px display 标题 + 12px text-3 说明（Focus 分组卡） */
function GroupHeading({ id, title, desc }: { id: string; title: string; desc: string }) {
  return (
    <header className="px-5 pb-2.5 pt-5">
      <h2 id={id} className="font-display text-[17px] font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-0.5 text-[12px] leading-5 text-text-3">{desc}</p>
    </header>
  )
}

/** 卡片行：左侧 14px 标题 + 12px 描述，右侧控件（Focus §6 分组卡行结构） */
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
    <div className="flex items-start justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-5 text-foreground">{label}</p>
        {desc ? <p className="mt-0.5 text-[12px] leading-4 text-text-3">{desc}</p> : null}
      </div>
      <div className="flex shrink-0 items-center pt-0.5">{children}</div>
    </div>
  )
}

/** 透明度滑杆（0-100；v1.1.5 ④ 信息块/引用块背景） */
function OpacityControl({ value, onChange, ariaLabel }: { value: number; onChange: (v: number) => void; ariaLabel: string }) {
  const pct = Math.round(value)
  return (
    <div className="flex items-center gap-2" aria-label={ariaLabel}>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-28 accent-primary"
      />
      <span className="w-9 text-right text-[12px] tabular-nums text-text-3">{pct}%</span>
      <button
        type="button"
        title="恢复默认（100%）"
        onClick={() => onChange(100)}
        className="grid h-7 w-7 place-items-center rounded-[6px] border border-border text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Icon name="undo" className="size-3" />
      </button>
    </div>
  )
}

/** 开关（44×26 圆角胶囊，开 = --primary 底白圆钮；参考稿） */
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
        'relative h-[26px] w-11 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none',
        checked ? 'bg-primary' : 'bg-surface-3',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 size-[22px] rounded-full bg-white shadow-sm transition-all duration-200 motion-reduce:transition-none',
          checked ? 'left-[20px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  )
}

/** 下拉（36px 灰底胶囊 + 右侧 chevron；参考稿 select） */
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
        className="h-9 cursor-pointer appearance-none rounded-control bg-surface-2 py-0 pl-3 pr-8 text-[13px] text-foreground outline-none transition-colors hover:bg-surface-3 focus:ring-2 focus:ring-ring/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-text-3" />
    </div>
  )
}

/** 数字输入（36px 灰底胶囊；参考稿 stepper 的数值位） */
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
      className="h-9 w-24 rounded-control bg-surface-2 px-3 text-right text-[13px] tabular-nums text-foreground outline-none transition-colors hover:bg-surface-3 focus:ring-2 focus:ring-ring/20"
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

/** 强调色控件：色板 + hex 输入 + 重置按钮（空值 = 使用主题默认）。
 * F19：色板拖动 300ms 去抖落盘——原实现每次 onchange 立即保存（写放大）。 */
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
  const debounceRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    },
    [],
  )
  const schedulePersist = (v: string) => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => onChange(v), 300)
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={current || fallback}
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value)
          schedulePersist(e.target.value)
        }}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-[6px] border border-border bg-card p-0"
      />
      <input
        type="text"
        value={current}
        placeholder={fallback}
        aria-label={`${ariaLabel} 色值`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
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
        className="w-[78px] shrink-0 rounded-control bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-foreground outline-none transition-colors hover:bg-surface-3 focus:ring-2 focus:ring-ring/20"
      />
      <button
        type="button"
        title="重置为默认"
        aria-label={`${ariaLabel} 重置`}
        disabled={!value}
        onClick={() => onChange(null)}
        className="shrink-0 rounded-[6px] p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="rebuild" className="size-3.5" />
      </button>
    </div>
  )
}

/** 维护操作按钮（36px 灰底胶囊，右侧可选 status 小字） */
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
          'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-control px-3.5 text-[12.5px] font-medium whitespace-nowrap transition-colors',
          disabled
            ? 'cursor-not-allowed bg-surface-2/50 text-text-3/50'
            : 'bg-surface-2 text-foreground hover:bg-surface-3',
        ].join(' ')}
      >
        {children}
      </button>
      {status ? <p className="max-w-[220px] truncate text-[11px] text-text-3" title={status}>{status}</p> : null}
    </div>
  )
}
