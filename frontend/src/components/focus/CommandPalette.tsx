/**
 * Focus 命令面板（⌘K）＋「打开的文档」切换（替代常驻标签栏）。
 *
 * 设计源：
 *  - `AstraNota-Focus-Handoff/prototype/screens/editor.html` 的 `.palette` 段；
 *  - `AstraNota-Focus-Handoff/prototype/assets/css/core.css`「command palette」；
 *  - `screenshots/overlays.png`（01 文件与导航 / 03 命令面板 / 04 打开的文档）。
 *
 * 职责边界：本组件只负责浮层内部（搜索框 / 分组 / 键盘导航 / 遮罩）与数据取用
 * （最近文档）；全局 ⌘K 开关、Esc 兜底与所有业务回调均由 `App.tsx` 提供。
 *
 * 信息架构：最近文档（前 5）→ 命令（新建/导出/源码/专注/外观/设置/导航）→ 打开的文档。
 * 键盘：↑↓ 选择、Enter 执行、Esc 关闭；点击遮罩关闭。输入框自动聚焦。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { getRecentDocuments } from '../../api/client'
import type { RecentDocument } from '../../types'
import { Icon, type IconName } from '../icons'
import type { TabItem } from '../layout/TabBar'
import type { AppPage } from './pageTypes'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onNavigate: (page: AppPage) => void
  onOpenArticle: (id: string) => void
  onNewArticle: () => void
  tabs: TabItem[]
  activeId: string | null
  onActivateTab: (id: string) => void
  onCloseTab: (id: string) => void
  /** 导出（PDF 菜单） */
  onExport: () => void
  /** 切换源码/正文视图 */
  onToggleSource: () => void
  onToggleFocusMode: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
}

type GroupId = 'recent' | 'command' | 'tabs'

/** 面板中的一行（分组由 `group` 决定；键盘选择在「过滤后的扁平行」上移动） */
interface PaletteRow {
  key: string
  group: GroupId
  icon: IconName
  label: string
  /** 右侧附属信息：最近文档路径 / 命令快捷键 / 当前文档标记 */
  hint?: string
  /** 参与搜索的关键词（标题 / 别名 / 英文词） */
  keywords: string[]
  run: () => void
  /** 打开的文档行：带独立的 × 关闭按钮（关闭不退出面板） */
  tabId?: string
}

const GROUP_ORDER: ReadonlyArray<{ id: GroupId; title: string }> = [
  { id: 'recent', title: '最近文档' },
  { id: 'command', title: '命令' },
  { id: 'tabs', title: '打开的文档' },
]

const RECENT_LIMIT = 5

/** 命令组固定项（图标 / 快捷键提示与参考稿 .palette-item 一致） */
const NAV_COMMANDS: ReadonlyArray<{ page: Exclude<AppPage, 'editor'>; label: string; icon: IconName; keywords: string[] }> = [
  { page: 'library', label: '知识库', icon: 'book', keywords: ['library', '知识库', '文件'] },
  { page: 'search', label: '搜索', icon: 'search', keywords: ['search', '搜索', '查找'] },
  { page: 'modules', label: '模块', icon: 'layers', keywords: ['modules', 'module', '模块'] },
  { page: 'assets', label: '资料', icon: 'paperclip', keywords: ['assets', '资料', '附件'] },
  { page: 'trash', label: '回收站', icon: 'trash', keywords: ['trash', '回收站', '删除'] },
]

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onOpenArticle,
  onNewArticle,
  tabs,
  activeId,
  onActivateTab,
  onCloseTab,
  onExport,
  onToggleSource,
  onToggleFocusMode,
  onOpenSettings,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState<RecentDocument[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 打开：重置查询/选中，聚焦输入框
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    // happy-dom 等环境下 focus 是同步的；requestAnimationFrame 在测试里不会触发 → 直接聚焦
    inputRef.current?.focus()
  }, [open])

  // 最近文档：每次打开重新取（取前 5），组件卸载/关闭后丢弃回包
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRecentLoading(true)
    getRecentDocuments()
      .then((r) => {
        if (!cancelled) setRecent(Array.isArray(r.documents) ? r.documents.slice(0, RECENT_LIMIT) : [])
      })
      .catch(() => {
        if (!cancelled) setRecent([])
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // 所有可执行行（未过滤）：最近文档 → 命令 → 打开的文档
  const allRows = useMemo<PaletteRow[]>(() => {
    const rows: PaletteRow[] = []
    for (const d of recent.slice(0, RECENT_LIMIT)) {
      rows.push({
        key: `recent:${d.rel_path}`,
        group: 'recent',
        icon: 'file-text',
        label: d.title || d.rel_path,
        hint: d.rel_path,
        keywords: [d.title, d.rel_path],
        run: () => onOpenArticle(d.rel_path),
      })
    }
    rows.push(
      {
        key: 'cmd:new',
        group: 'command',
        icon: 'plus',
        label: '新建文档',
        hint: '⌘N',
        keywords: ['new', '新建', '文档', 'create'],
        run: onNewArticle,
      },
      {
        key: 'cmd:export',
        group: 'command',
        icon: 'download',
        label: '导出 PDF…',
        hint: '⌘⇧E',
        keywords: ['export', '导出', 'pdf', '打印'],
        run: onExport,
      },
      {
        key: 'cmd:source',
        group: 'command',
        icon: 'code',
        label: '切换到源码模式',
        hint: '⌘/',
        keywords: ['source', '源码', 'markdown', '正文'],
        run: onToggleSource,
      },
      {
        key: 'cmd:focus-mode',
        group: 'command',
        icon: 'focus',
        label: '进入专注模式',
        hint: '⌘.',
        keywords: ['focus', '专注', '禅'],
        run: onToggleFocusMode,
      },
      {
        key: 'cmd:theme',
        group: 'command',
        icon: 'moon',
        label: '切换外观',
        keywords: ['theme', '外观', '深色', '浅色', '主题'],
        run: onToggleTheme,
      },
      {
        key: 'cmd:settings',
        group: 'command',
        icon: 'settings',
        label: '打开设置',
        hint: '⌘,',
        keywords: ['settings', '设置', '首选项'],
        run: onOpenSettings,
      },
      ...NAV_COMMANDS.map<PaletteRow>((n) => ({
        key: `cmd:nav:${n.page}`,
        group: 'command',
        icon: n.icon,
        label: n.label,
        keywords: n.keywords,
        run: () => onNavigate(n.page),
      })),
    )
    for (const t of tabs) {
      rows.push({
        key: `tab:${t.id}`,
        group: 'tabs',
        icon: 'file-text',
        label: t.title,
        hint: t.id === activeId ? '当前' : undefined,
        keywords: [t.title, t.id],
        run: () => onActivateTab(t.id),
        tabId: t.id,
      })
    }
    return rows
  }, [
    recent,
    tabs,
    activeId,
    onOpenArticle,
    onNewArticle,
    onExport,
    onToggleSource,
    onToggleFocusMode,
    onToggleTheme,
    onOpenSettings,
    onNavigate,
    onActivateTab,
  ])

  // 输入即过滤（标题 + 关键词，大小写不敏感）
  const rows = useMemo<PaletteRow[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => r.keywords.some((k) => String(k ?? '').toLowerCase().includes(q)))
  }, [allRows, query])

  // 过滤结果变化 / 数量收缩时校正选中项
  useEffect(() => {
    setActiveIndex((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)))
  }, [rows])

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((g) => ({
        ...g,
        rows: rows.filter((r) => r.group === g.id),
      })),
    [rows],
  )

  // 执行一行：先关面板再触发业务回调（App 侧部分回调也会关闭，幂等）
  const runRow = (row: PaletteRow) => {
    row.run()
    onClose()
  }

  // 键盘：↑↓ 选择 / Enter 执行 / Esc 关闭（面板打开时挂在 window 上，IME 组词中不劫持）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (rows.length === 0) return
        e.preventDefault()
        setActiveIndex((i) => {
          const next = e.key === 'ArrowDown' ? i + 1 : i - 1
          return (next + rows.length) % rows.length
        })
        return
      }
      if (e.key === 'Enter') {
        const row = rows[activeIndex]
        if (!row) return
        e.preventDefault()
        row.run()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, rows, activeIndex, onClose])

  if (!open) return null

  const activeKey = rows[activeIndex]?.key
  const hasQuery = query.trim().length > 0
  const emptyAll = rows.length === 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      data-testid="command-palette"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh]"
      style={{ background: 'var(--scrim)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-dialog border border-border bg-card shadow-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部大搜索输入（参考稿 .palette-input，62px 高） */}
        <div className="flex h-[62px] shrink-0 items-center gap-3 border-b border-border px-5">
          <Icon name="search" className="size-5 shrink-0 text-text-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder="搜索文档或输入命令…"
            aria-label="搜索"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-text-3"
          />
          <kbd className="shrink-0 rounded-[6px] border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-3">
            ESC
          </kbd>
        </div>

        {/* 分组列表（参考稿 .palette-body / .palette-label / .palette-item） */}
        <div className="max-h-[430px] overflow-y-auto p-2" data-ke-slot="command-palette-body">
          {emptyAll ? (
            <div className="px-3 py-10 text-center text-[13px] text-text-3">
              {hasQuery ? '没有匹配的结果' : '暂无可用的命令'}
            </div>
          ) : (
            grouped.map((g) => {
              // 空分组：无查询时对「最近文档 / 打开的文档」给出空态提示，命令组恒有内容
              if (g.rows.length === 0 && (hasQuery || g.id === 'command')) return null
              return (
                <div key={g.id}>
                  <div className="px-2.5 pb-1.5 pt-3 text-[12px] font-medium text-text-3">{g.title}</div>
                  {g.rows.length === 0 ? (
                    <div className="px-3 pb-2 text-[12px] text-text-3">
                      {g.id === 'recent'
                        ? recentLoading
                          ? '加载中…'
                          : '暂无最近文档'
                        : '暂无打开的文档'}
                    </div>
                  ) : (
                    g.rows.map((row) => {
                      const active = row.key === activeKey
                      const rowClass = [
                        'flex h-[46px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14px] transition-colors',
                        active ? 'bg-primary-soft text-primary' : 'text-foreground hover:bg-surface-2',
                      ].join(' ')
                      const iconClass = `size-[18px] shrink-0 ${active ? 'text-primary' : 'text-text-3'}`
                      if (row.tabId !== undefined) {
                        return (
                          <div key={row.key} className={`${rowClass} group`} data-active={active ? '1' : undefined}>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
                              title={row.tabId}
                              onClick={() => runRow(row)}
                              onMouseEnter={() => setActiveIndex(rows.indexOf(row))}
                            >
                              <Icon name={row.icon} className={iconClass} />
                              <span className="min-w-0 flex-1 truncate">{row.label}</span>
                              {row.hint ? <span className="shrink-0 text-[12px] text-text-3">{row.hint}</span> : null}
                            </button>
                            <button
                              type="button"
                              aria-label={`关闭 ${row.label}`}
                              title="关闭文档"
                              onClick={() => onCloseTab(row.tabId!)}
                              className="grid size-6 shrink-0 place-items-center rounded-[6px] text-text-3 transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none"
                            >
                              <Icon name="close" className="size-3.5" />
                            </button>
                          </div>
                        )
                      }
                      return (
                        <button
                          key={row.key}
                          type="button"
                          data-active={active ? '1' : undefined}
                          className={rowClass}
                          onClick={() => runRow(row)}
                          onMouseEnter={() => setActiveIndex(rows.indexOf(row))}
                        >
                          <Icon name={row.icon} className={iconClass} />
                          <span className="min-w-0 flex-1 truncate">{row.label}</span>
                          {row.hint ? (
                            <span className="ml-auto max-w-[220px] shrink-0 truncate text-[12px] text-text-3">
                              {row.hint}
                            </span>
                          ) : null}
                        </button>
                      )
                    })
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* 底部提示行（参考稿 .palette-foot） */}
        <div className="flex shrink-0 items-center gap-4 border-t border-border px-[18px] py-3 text-[12px] text-text-3">
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
