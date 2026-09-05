/**
 * Workspace 选择页 / LauncherPage（handoff §3.7 + 参考稿 launcher.html）：
 * - 品牌 Hero（KE 标 + 名称 + Alpha + 定位语）
 * - 两操作卡：打开已有工作区（主）/ 创建新工作区（次）
 * - 最近工作区（最多 3 条：名称 + mono 路径截断 + 失效置灰可移除）
 * - 底部声明（程序与数据分离 / 版本 / Markdown 为唯一事实源）
 */
import { useCallback, useEffect, useState } from 'react'
import {
  createWorkspace,
  getRecentWorkspaces,
  openWorkspace,
} from '../../api/client'
import { isDesktop, pickDirectory } from '../../desktop'
import { removeRecentWorkspace } from '../../state/workspaceRecent'
import type { RecentWorkspace, WorkspaceState } from '../../types'
import { Icon } from '../icons'

interface Props {
  onOpened: (ws: WorkspaceState) => void
  /** 首启引导模式：桌面版首次使用（默认 workspace 为空且无最近记录）时，
   * 显示「使用已有工作区」与「创建新工作区」引导 */
  guide?: boolean
  /** 引导模式「创建新工作区」：沿用默认（空）workspace 开始 */
  onUseDefault?: () => void
}

const APP_VERSION = 'v1.0.2'

/** 路径尾段作为工作区名 */
function wsName(path: string): string {
  const seg = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
  return seg || path
}

export default function WorkspacePicker({ onOpened, guide = false, onUseDefault }: Props) {
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
      const p = window.prompt('打开已有工作区路径')
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
    <div className="flex h-full min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-[760px] max-w-full">
          {/* BrandHero */}
          <div className="mb-10 flex flex-col items-center text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-[12px] text-lg font-bold" style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
              KE
            </div>
            <h1 className="text-[22px] font-semibold" style={{ color: 'var(--foreground)' }}>KnowledgeEditor</h1>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--muted-foreground)' }}>Alpha</p>
            <p className="mt-3 max-w-[420px] text-[13px] leading-[1.6]" style={{ color: 'var(--muted-foreground)' }}>
              {guide
                ? '以 Markdown 为唯一事实源的本地知识编辑器——选择一个工作区开始'
                : '选择已有 workspace 文件夹，或在指定位置初始化空白知识库'}
            </p>
          </div>

          {/* 两操作卡 */}
          {guide ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              <ActionCard
                icon={<Icon name="folder" className="size-4" />}
                title="打开已有工作区"
                desc="选择已有 workspace 文件夹继续写作"
                primary
                disabled={busy}
                onClick={() => void browseAndOpen()}
              />
              <ActionCard
                icon={<Icon name="plus" className="size-4" />}
                title="创建新工作区"
                desc="在指定位置初始化空白知识库"
                disabled={busy}
                onClick={() => (onUseDefault ? onUseDefault() : setCreating(true))}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row">
              <ActionCard
                icon={<Icon name="folder" className="size-4" />}
                title="打开已有工作区"
                desc="选择已有 workspace 文件夹继续写作"
                primary
                disabled={busy}
                onClick={() => void browseAndOpen()}
              />
              <ActionCard
                icon={<Icon name="plus" className="size-4" />}
                title="创建新工作区"
                desc="在指定位置初始化空白知识库"
                disabled={busy}
                onClick={() => setCreating((v) => !v)}
              />
            </div>
          )}

          {/* 手动路径输入（打开失败/新建时展开） */}
          {error || creating ? (
            <div className="mx-auto mt-4 flex max-w-[560px] items-center gap-2 rounded-lg border border-border bg-card p-3">
              <input
                type="text"
                placeholder="工作区目录路径，例如 D:\MyKnowledge"
                value={path}
                onChange={(e) => { setPath(e.target.value); setError('') }}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
              />
              {isDesktop() && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void browse()}
                  title="打开系统目录选择器"
                  className="h-8 shrink-0 rounded-md border border-border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
                >
                  浏览…
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void create()}
                className="h-8 shrink-0 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-all hover:brightness-95 active:scale-[.97] disabled:opacity-50"
              >
                新建
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void open(path.trim())}
                className="h-8 shrink-0 rounded-md border border-border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
              >
                打开
              </button>
            </div>
          ) : null}
          {error && !creating && (
            <p className="mx-auto mt-2 max-w-[560px] text-[12px] text-rose-600">{error}</p>
          )}

          {/* 最近工作区（最多 3 条） */}
          {recent.length > 0 ? (
            <div className="mx-auto mt-10 max-w-[560px]">
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--foreground)' }}>最近工作区</span>
                <span className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>仅保存在本机</span>
              </div>
              <div className="flex flex-col gap-2">
                {recent.slice(0, 3).map((w) =>
                  w.exists ? (
                    <button
                      key={w.path}
                      type="button"
                      disabled={busy}
                      onClick={() => void open(w.path)}
                      title={w.path}
                      className="flex h-12 w-full items-center gap-3 rounded-[8px] border px-3.5 text-left transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--foreground)' }}
                    >
                      <Icon name="folder" className="size-4 shrink-0" style={{ color: 'var(--primary)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{wsName(w.path)}</div>
                        <div className="truncate text-[11px]" style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
                          {w.path}
                        </div>
                      </div>
                      <Icon name="chevron-right" className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ) : (
                    <div
                      key={w.path}
                      className="flex h-12 w-full items-center gap-3 rounded-[8px] border px-3.5"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)/40' }}
                    >
                      <Icon name="folder" className="size-4 shrink-0 text-muted-foreground/40" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-muted-foreground/60 line-through">
                          {wsName(w.path)}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground/50" style={{ fontFamily: 'var(--font-mono)' }}>
                          {w.path}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ backgroundColor: 'var(--secondary)', color: 'var(--accent-foreground)' }}>
                        路径已失效
                      </span>
                      <button
                        type="button"
                        title="移除该记录"
                        aria-label={`移除 ${w.path}`}
                        onClick={(e) => void removeRecent(w.path, e)}
                        className="shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-rose-100 hover:text-rose-600"
                      >
                        <Icon name="close" className="size-3.5" />
                      </button>
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* 底部声明 */}
      <footer className="flex h-[52px] shrink-0 items-center justify-between px-6 text-[12px]" style={{ color: 'var(--muted-foreground)', borderTop: '1px solid var(--border)' }}>
        <span>程序与数据分离 · 卸载软件不删除数据</span>
        <span>{APP_VERSION} · Markdown 为唯一事实源 · 索引可整体重建</span>
      </footer>
    </div>
  )
}

/** 操作卡（参考稿 launcher：主 = --primary 底白字） */
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
        'flex flex-1 flex-col items-start gap-1.5 rounded-[12px] border p-5 text-left transition-[background-color,color,transform,border-color] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none',
        primary ? 'border-transparent hover:brightness-95' : 'hover:bg-muted',
      ].join(' ')}
      style={
        primary
          ? { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
          : { backgroundColor: 'var(--card)', color: 'var(--foreground)', borderColor: 'var(--border)' }
      }
    >
      <span className="flex items-center gap-2 text-[14px] font-semibold">
        {icon}
        {title}
      </span>
      <span className="text-[12px] opacity-75">{desc}</span>
    </button>
  )
}
