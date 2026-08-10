/** Workspace 选择页（Phase 4.1 增强 + Phase 7 M4）：
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
import type { RecentWorkspace, WorkspaceState } from '../../types'
import './workspace-picker.css'

interface Props {
  onOpened: (ws: WorkspaceState) => void
  /** 首启引导模式：桌面首次使用（空 workspace 且无最近记录）时的两选项引导 */
  guide?: boolean
  /** 引导模式「创建新工作区」：沿用默认（空）workspace 开始 */
  onUseDefault?: () => void
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
        const res = await fetch(`/api/workspace/recent?path=${encodeURIComponent(p)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(res.statusText)
        setRecent((prev) => prev.filter((w) => w.path !== p))
      } catch {
        /* 删除失败不阻塞 */
      }
    },
    [],
  )

  return (
    <div className="ws-picker">
      <div className="ws-picker-card">
        <h1>KnowledgeEditor</h1>
        <p className="ws-picker-sub">
          {guide ? '欢迎使用！选择一个已有工作区，或创建新的工作区开始创作' : '选择一个工作区开始创作（Markdown 为唯一事实源）'}
        </p>

        {guide ? (
          <div className="ws-picker-guide">
            <button
              type="button"
              className="ws-picker-guide-primary"
              disabled={busy}
              onClick={() => void browseAndOpen()}
            >
              使用已有工作区
            </button>
            <button
              type="button"
              className="ws-picker-guide-secondary"
              disabled={busy}
              onClick={() => onUseDefault?.()}
            >
              创建新工作区
            </button>
          </div>
        ) : (
          <>
            <div className="ws-picker-input">
              <input
                placeholder="工作区目录路径，例如 D:\MyKnowledge"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
              />
              {isDesktop() && (
                <button type="button" disabled={busy} onClick={() => void browse()} title="打开系统目录选择器">
                  浏览…
                </button>
              )}
              <button disabled={busy} onClick={() => void create()}>
                新建工作区
              </button>
              <button disabled={busy} onClick={() => void open(path.trim())}>
                打开已有
              </button>
            </div>

            {error && <p className="ws-picker-error">{error}</p>}

            {recent.length > 0 && (
              <div className="ws-picker-recent">
                <div className="ws-picker-recent-title">最近工作区（点击打开）</div>
                {recent.map((w) =>
                  w.exists ? (
                    <button
                      key={w.path}
                      className="ws-picker-recent-item"
                      disabled={busy}
                      onClick={() => void open(w.path)}
                      title={w.path}
                    >
                      {w.path}
                    </button>
                  ) : (
                    <div key={w.path} className="ws-picker-recent-item ws-picker-recent-stale">
                      <span className="ws-picker-recent-stale-path" title={w.path}>
                        {w.path}
                      </span>
                      <span className="ws-picker-recent-stale-badge">路径已失效</span>
                      <button
                        type="button"
                        className="ws-picker-recent-remove"
                        title="移除该记录"
                        onClick={(e) => void removeRecent(w.path, e)}
                      >
                        ×
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
