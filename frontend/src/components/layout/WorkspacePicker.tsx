/**
 * Workspace 选择页 / LauncherPage（handoff §3.7）：
 * 居中 WelcomeCard（BrandHero + WorkspaceActions + RecentWorkspaces 最近 3 条）。
 * - 手动输入：新建 / 打开已有；桌面版提供「浏览…」原生目录选择器
 * - 首启引导模式（guide）：桌面版首次使用（默认 workspace 为空且无最近记录）时，
 *   显示「使用已有工作区」（原生目录选择）与「创建新工作区」（沿用默认 workspace）
 * - 最近工作区列表：打开/创建成功后自动记录（存软件配置文件，不写入 Markdown）；
 *   路径仍存在的条目点击直接打开；已失效（目录被删除/移动）的条目置灰标记，
 *   可单独移除记录。
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
import './workspace-picker.css'

interface Props {
  onOpened: (ws: WorkspaceState) => void
  /** 首启引导模式：桌面首次使用（空 workspace 且无最近记录）时的两选项引导 */
  guide?: boolean
  /** 引导模式「创建新工作区」：沿用默认（空）workspace 开始 */
  onUseDefault?: () => void
}

/** 相对时间占位：后端 recent_workspaces 无时间戳字段（保持 API 范围），
 * 未来扩展后此处接入 opened_at 即可。 */
function relTimeInfo(_w: RecentWorkspace): string {
  return ''
}

/** 路径尾段作为工作区名（mono 路径截断展示） */
function wsName(path: string): string {
  const seg = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
  return seg || path
}

export default function WorkspacePicker({ onOpened, guide = false, onUseDefault }: Props) {
  const [path, setPath] = useState('')
  const [recent, setRecent] = useState<RecentWorkspace[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  /** 引导模式：选择已有工作区并打开 */
  const browseAndOpen = useCallback(async () => {
    const dir = await pickDirectory('选择已有工作区目录')
    if (dir) void open(dir)
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
    <div className="ws-picker flex h-full min-h-screen items-center justify-center bg-background p-6">
      <div className="ws-picker-card w-[520px] max-w-full rounded-2xl border border-border bg-card p-9 text-center shadow-sm">
        {/* BrandHero（handoff §3.7）：KE 标 + 名称 + Alpha + 一句定位 */}
        <div className="mb-3 flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            KE
          </span>
          <span className="text-xl font-semibold text-foreground">KnowledgeEditor</span>
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary">Alpha</span>
        </div>
        <p className="mb-6 text-[13px] text-muted-foreground">
          {guide
            ? '欢迎使用！选择一个已有工作区，或创建新的工作区开始创作'
            : '以 Markdown 为唯一事实源的本地知识编辑器——选择一个工作区开始'}
        </p>

        {guide ? (
          <div className="ws-picker-guide">
            <button
              type="button"
              className="ws-picker-guide-primary h-8 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-all hover:brightness-95 active:scale-[.97]"
              disabled={busy}
              onClick={() => void browseAndOpen()}
            >
              使用已有工作区
            </button>
            <button
              type="button"
              className="ws-picker-guide-secondary h-8 rounded-lg border border-border bg-background text-sm text-foreground/80 transition-all hover:border-ring/50 hover:bg-muted active:scale-[.97]"
              disabled={busy}
              onClick={() => onUseDefault?.()}
            >
              创建新工作区
            </button>
          </div>
        ) : (
          <>
            <div className="ws-picker-input flex gap-2">
              <input
                placeholder="工作区目录路径，例如 D:\MyKnowledge"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground/80 outline-none transition-colors focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
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
                disabled={busy}
                onClick={() => void create()}
                className="h-8 shrink-0 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-all hover:brightness-95 active:scale-[.97] disabled:opacity-50"
              >
                新建工作区
              </button>
              <button
                disabled={busy}
                onClick={() => void open(path.trim())}
                className="h-8 shrink-0 rounded-md border border-border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
              >
                打开已有
              </button>
            </div>

            {error && <p className="mt-2.5 text-left text-[12px] text-rose-600">{error}</p>}

            {recent.length > 0 && (
              <div className="ws-picker-recent mt-6 text-left">
                <div className="mb-2 text-[12px] font-medium text-muted-foreground">
                  最近工作区（点击打开）
                </div>
                {recent.slice(0, 3).map((w) =>
                  w.exists ? (
                    <button
                      key={w.path}
                      className="ws-picker-recent-item mb-1.5 flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted"
                      disabled={busy}
                      onClick={() => void open(w.path)}
                      title={w.path}
                    >
                      <Icon name="folder" className="size-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
                        {wsName(w.path)}
                      </span>
                      <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-muted-foreground/70">
                        {w.path}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground/60">
                        {relTimeInfo(w)}
                      </span>
                    </button>
                  ) : (
                    <div
                      key={w.path}
                      className="ws-picker-recent-item mb-1.5 flex w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-left"
                    >
                      <Icon name="folder" className="size-3.5 shrink-0 text-muted-foreground/40" />
                      <span
                        className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground/60 line-through"
                        title={w.path}
                      >
                        {wsName(w.path)}
                      </span>
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        路径已失效
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-rose-100 hover:text-rose-600"
                        title="移除该记录"
                        onClick={(e) => void removeRecent(w.path, e)}
                      >
                        <Icon name="close" className="size-3" />
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
