/**
 * Workspace 选择页 / LauncherPage（handoff §3.7 + 参考稿 launcher.html）：
 * - 品牌 Hero（KE 标 + 名称 + Alpha + 定位语）
 * - 两操作卡：打开已有工作区（主）/ 创建新工作区（次）
 * - 最近工作区（最多 3 条：名称 + mono 路径截断 + 失效置灰可移除）
 */
import { useCallback, useEffect, useState } from 'react'
import {
  createWorkspace,
  getRecentWorkspaces,
  openWorkspace,
} from '../../api/client'
import { isDesktop, pickDirectory } from '../../desktop'
import { shouldIgnoreReactKeyEvent } from '../../state/shortcuts'
import { removeRecentWorkspace } from '../../state/workspaceRecent'
import type { RecentWorkspace, WorkspaceState } from '../../types'
import { Icon } from '../icons'
import brandIconLight from '../../assets/astranota/astranota-icon-light-256.png'
import brandIconDark from '../../assets/astranota/astranota-icon-dark-256.png'
import { askPrompt } from '../common/PromptDialog'

interface Props {
  onOpened: (ws: WorkspaceState) => void
  /** Focus launcher：右上切换外观 */
  onToggleTheme?: () => void
  /** Focus launcher：当前是否深色（决定 moon/sun 图标） */
  themeIsDark?: boolean
  /** Focus launcher：右上帮助（打开设置/关于） */
  onOpenHelp?: () => void
  /** 首启引导模式：桌面版首次使用（默认 workspace 为空且无最近记录）时，
   * 显示「使用已有工作区」与「创建新工作区」引导 */
  guide?: boolean
  /** 引导模式「创建新工作区」：沿用默认（空）workspace 开始 */
  onUseDefault?: () => void
}



/** 路径尾段作为工作区名 */
function wsName(path: string): string {
  const seg = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
  return seg || path
}

export default function WorkspacePicker({
  onOpened,
  guide = false,
  onUseDefault,
  onToggleTheme,
  themeIsDark = false,
  onOpenHelp,
}: Props) {
  const [path, setPath] = useState('')
  const [recent, setRecent] = useState<RecentWorkspace[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const refreshRecent = useCallback(() => {
    getRecentWorkspaces()
      .then((r) => setRecent(r.workspaces))
      .catch(() => setRecent([]))
  }, [])

  useEffect(() => {
    refreshRecent()
  }, [refreshRecent])

  const open = useCallback(
    async (p: string) => {
      setBusy(true)
      setError('')
      try {
        const state = await openWorkspace(p)
        onOpened(state)
      } catch (e) {
        setError(`打开失败：${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [onOpened],
  )

  const create = useCallback(async () => {
    const p = path.trim()
    if (!p) {
      setError('请输入工作区路径')
      return
    }
    setBusy(true)
    setError('')
    try {
      const state = await createWorkspace(p)
      onOpened(state)
    } catch (e) {
      setError(`创建失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
      setCreating(false)
    }
  }, [path, onOpened])

  /** 桌面：原生目录选择器填路径（M4） */
  const browse = useCallback(async () => {
    const dir = await pickDirectory('选择工作区目录')
    if (dir) {
      setPath(dir)
      setError('')
    }
  }, [])

  /** 打开已有：桌面用原生选择器；Web 回退手动输入 */
  const browseAndOpen = useCallback(async () => {
    const dir = await pickDirectory('选择已有工作区目录')
    if (dir) void open(dir)
    else if (!isDesktop()) {
      const p = await askPrompt('打开已有工作区路径')
      if (p) void open(p)
    }
  }, [open])

  /** 移除失效（或任意）最近记录 */
  const removeRecent = useCallback(
    async (p: string, e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        // P2-9：经 client.ts 的 apiBase 拼接地址，绕过裸 fetch 丢失前缀的问题
        await removeRecentWorkspace(p)
        setRecent((prev) => prev.filter((w) => w.path !== p))
      } catch {
        /* 删除失败不阻塞 */
      }
    },
    [],
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 顶部品牌条（无整宽顶栏，只有一条极简品牌行） */}
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 px-6">
        <img src={brandIconLight} alt="" aria-hidden="true" className="an-logo-light size-[26px] shrink-0" draggable={false} />
        <img src={brandIconDark} alt="" aria-hidden="true" className="an-logo-dark size-[26px] shrink-0" draggable={false} />
        <span className="text-[15px] font-[650] tracking-[-0.02em]" style={{ color: 'var(--foreground)' }}>
          AstraNota
        </span>
        <div className="ml-auto flex items-center gap-1">
          {onToggleTheme ? (
            <button
              type="button"
              onClick={onToggleTheme}
              title={themeIsDark ? '切换到浅色' : '切换到深色'}
              aria-label={themeIsDark ? '切换到浅色外观' : '切换到深色外观'}
              className="grid size-8 place-items-center rounded-[8px] transition-colors hover:bg-surface-2"
              style={{ color: 'var(--text-3)' }}
            >
              <Icon name={themeIsDark ? 'sun' : 'moon'} className="size-[18px]" />
            </button>
          ) : null}
          {onOpenHelp ? (
            <button
              type="button"
              onClick={onOpenHelp}
              title="关于 / 设置"
              aria-label="关于与设置"
              className="grid size-8 place-items-center rounded-[8px] transition-colors hover:bg-surface-2"
              style={{ color: 'var(--text-3)' }}
            >
              <Icon name="help" className="size-[18px]" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1 items-start justify-center px-6 pb-16 pt-[6vh]">
        <div className="w-[720px] max-w-full">
          {/* Hero（对齐设计 launcher-hero：品牌图标 84px + 46px 标题） */}
          <div className="mb-11 flex flex-col items-center text-center">
            <img
              src={brandIconLight}
              alt="AstraNota"
              className="an-logo-light mb-[26px] size-[84px]"
              draggable={false}
            />
            <img
              src={brandIconDark}
              alt="AstraNota"
              className="an-logo-dark mb-[26px] size-[84px]"
              draggable={false}
            />
            <h1
              className="text-[46px] font-[680] leading-[1.08] tracking-[-0.05em]"
              style={{ color: 'var(--foreground)', fontFamily: 'var(--font-family-display)' }}
            >
              让写作回到本地
            </h1>
          </div>

          {/* 两操作卡（主 = 蓝底白字；次 = 白底描边） */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <ActionCard
              icon={<Icon name="folder" className="size-4" />}
              title="打开已有工作区"
              desc="选择一个包含 Markdown 的文件夹"
              primary
              disabled={busy}
              onClick={() => void browseAndOpen()}
            />
            <ActionCard
              icon={<Icon name="plus" className="size-4" />}
              title="创建新工作区"
              desc="从空白文件夹开始"
              disabled={busy}
              onClick={() => (guide && onUseDefault ? onUseDefault() : setCreating((v) => !v))}
            />
          </div>

          {/* 常驻路径条（参考稿 launcher .path-hint：硬盘图标 + 路径输入 + 浏览…） */}
          <div
            className="mt-3 flex h-11 items-center gap-2.5 rounded-[13px] border px-3.5"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', boxShadow: 'var(--elev-sm)' }}
          >
            <Icon name="hard-drive" className="size-4 shrink-0" style={{ color: 'var(--text-3)' }} />
            <input
              type="text"
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => {
                if (shouldIgnoreReactKeyEvent(e)) return
                if (e.key === 'Enter' && path.trim()) void open(path.trim())
              }}
              placeholder="输入工作区路径，或点击「浏览…」选择文件夹"
              aria-label="工作区路径"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-3"
              style={{ color: 'var(--foreground)' }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void (isDesktop() ? browse() : browseAndOpen())}
              className="h-7 shrink-0 rounded-[7px] px-2 text-[12.5px] font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
              style={{ color: 'var(--text-3)' }}
            >
              浏览…
            </button>
            <button
              type="button"
              disabled={busy || !path.trim()}
              onClick={() => void open(path.trim())}
              className="h-7 shrink-0 rounded-[7px] px-2 text-[12.5px] font-medium transition-colors hover:bg-surface-2 disabled:opacity-40"
              style={{ color: 'var(--accent-foreground)' }}
            >
              打开
            </button>
          </div>

          {/* 手动路径输入（打开失败/新建时展开） */}
          {error || creating ? (
            <div
              className="mt-3 flex items-center gap-2 rounded-[13px] border p-2"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}
            >
              <input
                type="text"
                placeholder="工作区目录路径，例如 D:\MyKnowledge"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value)
                  setError('')
                }}
                onKeyDown={(e) => {
                  // M-13（2026-10-17 审查）：中文输入法组词回车 = 上屏候选词，
                  // 不能当成「确认 → 创建知识库目录」（会按半截路径建库，写盘副作用）。
                  if (shouldIgnoreReactKeyEvent(e)) return
                  if (e.key === 'Enter') void create()
                }}
                className="h-8 min-w-0 flex-1 rounded-[8px] bg-transparent px-2 text-[13px] text-foreground outline-none placeholder:text-text-3"
              />
              {isDesktop() && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void browse()}
                  title="打开系统目录选择器"
                  className="h-8 shrink-0 rounded-[8px] border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-surface-2 disabled:opacity-50"
                  style={{ borderColor: 'var(--border)' }}
                >
                  浏览…
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void create()}
                className="h-8 shrink-0 rounded-[8px] px-3 text-[13px] font-medium text-white transition-[filter] hover:brightness-105 active:scale-[.97] disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                新建
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void open(path.trim())}
                className="h-8 shrink-0 rounded-[8px] border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-surface-2 disabled:opacity-50"
                style={{ borderColor: 'var(--border)' }}
              >
                打开
              </button>
            </div>
          ) : null}
          {error && !creating && (
            <p className="mt-2 text-[12px] text-rose-600">{error}</p>
          )}

          {/* 最近工作区卡片（最多 3 条） */}
          {recent.length > 0 ? (
            <div
              className="mt-6 overflow-hidden rounded-[18px] border"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', boxShadow: 'var(--elev-sm)' }}
            >
              <div className="flex items-center justify-between px-4 py-3 text-[12px]" style={{ color: 'var(--text-3)' }}>
                <span>最近使用</span>
                <span>仅保存在本机</span>
              </div>
              {recent.slice(0, 3).map((w) =>
                w.exists ? (
                  <button
                    key={w.path}
                    type="button"
                    disabled={busy}
                    onClick={() => void open(w.path)}
                    title={w.path}
                    className="flex h-[56px] w-full items-center gap-3 border-t px-4 text-left transition-[background-color] duration-150 hover:bg-surface-2 focus-visible:outline-none motion-reduce:transition-none"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <Icon name="folder" className="size-4 shrink-0" style={{ color: 'var(--text-3)' }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{wsName(w.path)}</div>
                      <div
                        className="truncate text-[11px]"
                        style={{ color: 'var(--text-3)', fontFamily: 'var(--font-family-mono)' }}
                      >
                        {w.path}
                      </div>
                    </div>
                    <Icon name="chevron-right" className="size-4 shrink-0" style={{ color: 'var(--text-3)' }} />
                  </button>
                ) : (
                  <div
                    key={w.path}
                    className="flex h-[56px] w-full items-center gap-3 border-t px-4"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <Icon name="folder" className="size-4 shrink-0" style={{ color: 'var(--text-3)' }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] line-through" style={{ color: 'var(--text-3)' }}>
                        {wsName(w.path)}
                      </div>
                      <div
                        className="truncate text-[11px]"
                        style={{ color: 'var(--text-3)', fontFamily: 'var(--font-family-mono)' }}
                      >
                        {w.path}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                      style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
                    >
                      路径已失效
                    </span>
                    <button
                      type="button"
                      title="移除该记录"
                      aria-label={`移除 ${w.path}`}
                      onClick={(e) => void removeRecent(w.path, e)}
                      className="shrink-0 rounded p-1 transition-colors hover:bg-rose-100 hover:text-rose-600"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <Icon name="close" className="size-3.5" />
                    </button>
                  </div>
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 操作卡（Focus launcher：主 = 蓝底白字 + 右侧箭头；次 = 白底描边 + 右侧箭头） */
function ActionCard({
  icon,
  title,
  desc,
  primary,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  primary?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'group flex flex-1 items-center gap-3 rounded-[18px] border px-4 py-4 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] focus-visible:outline-none motion-reduce:transition-none',
        primary ? 'border-transparent hover:brightness-105' : 'hover:bg-surface-2',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
      style={
        primary
          ? { backgroundColor: 'var(--primary)', color: '#ffffff' }
          : { backgroundColor: 'var(--card)', color: 'var(--foreground)', borderColor: 'var(--border)' }
      }
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[10px]"
        style={primary ? { backgroundColor: 'rgba(255,255,255,0.16)', color: '#fff' } : { backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[12px] opacity-70">{desc}</span>
      </span>
      <Icon name="chevron-right" className="size-4 shrink-0 opacity-60 transition-transform duration-150 group-hover:translate-x-0.5" />
    </button>
  )
}
