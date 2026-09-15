/** 回收站面板（MVP，接口契约 docs/design-trash-mvp.md）。
 *
 * 范围：仅文档（文件夹/附件为硬删，不进回收站）。
 * 数据源：GET /api/trash（清单由后端从 <ws>/Trash 目录结构派生，前端不引入第二事实源）。
 * 操作：恢复（冲突时后端自动改名 → 提示新文件名）、彻底删除（确认）、清空（确认）。
 *
 * 注意（交接文档坑 1 / React #300）：本组件挂在 LeftSidebar（普通 React 树），
 * 不位于 tiptap NodeView 的独立 React 根内、也不触发 ProseMirror 事务，故不受
 * update-during-render 崩溃影响。
 */
import { useCallback, useEffect, useState } from 'react'
import { clearTrash, listTrash, purgeTrash, restoreTrash } from '../../api/client'
import type { TrashItem } from '../../types'
import { Icon } from '../icons'

interface Props {
  /** 当前打开的文档 id（恢复的正是当前文档时给出明确提示，坑 3） */
  activeId?: string | null
  /** 恢复成功回调（App 侧刷新文件树 / 按需重新打开） */
  onRestored?: (restoredTo: string) => void
  /** 外部刷新令牌（LeftSidebar 的 refreshKey：删除/恢复文档后联动刷新） */
  refreshKey?: number
}

/** 字节 → 展示串（与附件列表量级一致：B / KB / MB） */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** ISO8601 → 本地时间（无效值原样展示，不抛错） */
export function formatDeletedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 取路径末段文件名（恢复冲突时提示「已恢复为 xxx-1.md」） */
export function baseName(rel: string): string {
  const parts = rel.split('/')
  return parts[parts.length - 1] || rel
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function TrashPanel({ activeId, onRestored, refreshKey = 0 }: Props) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const payload = await listTrash()
      setItems(payload.items ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const handleRestore = useCallback(
    async (item: TrashItem) => {
      setBusyId(item.id)
      try {
        const result = await restoreTrash(item.id)
        // 坑 3：恢复的若正是当前打开的文档，提示需重开以载入磁盘版本
        const isCurrent = !!activeId && (activeId === item.rel_path || activeId === result.restored_to)
        const suffix = isCurrent ? '。该文档正是当前打开的文档，如需载入磁盘版本请重新打开' : ''
        window.alert(
          result.renamed
            ? `已恢复为 ${baseName(result.restored_to)}（原路径已有同名文件，已自动改名）${suffix}`
            : `已恢复：${result.restored_to}${suffix}`,
        )
        onRestored?.(result.restored_to)
        await reload()
      } catch (e) {
        window.alert(`恢复失败：${errText(e)}`)
      } finally {
        setBusyId(null)
      }
    },
    [activeId, onRestored, reload],
  )

  const handlePurge = useCallback(
    async (item: TrashItem) => {
      if (!window.confirm(`彻底删除「${item.name}」？删除后无法恢复。`)) return
      setBusyId(item.id)
      try {
        await purgeTrash(item.id)
        await reload()
      } catch (e) {
        window.alert(`彻底删除失败：${errText(e)}`)
      } finally {
        setBusyId(null)
      }
    },
    [reload],
  )

  const handleClear = useCallback(async () => {
    const count = items?.length ?? 0
    if (!window.confirm(`确认清空回收站？共 ${count} 项，清空后无法恢复。`)) return
    setClearing(true)
    try {
      await clearTrash()
      await reload()
    } catch (e) {
      window.alert(`清空回收站失败：${errText(e)}`)
    } finally {
      setClearing(false)
    }
  }, [items, reload])

  const busy = busyId !== null || clearing
  const count = items?.length ?? 0

  return (
    <div className="border-b border-border py-2">
      <div className="mb-1 flex items-center justify-between px-3">
        <span className="text-[12px] font-normal text-sidebar-foreground">回收站</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            title="刷新回收站"
            aria-label="刷新回收站"
            className="rounded px-1 text-muted-foreground hover:bg-sidebar-accent hover:text-primary"
            onClick={() => void reload()}
            disabled={loading}
          >
            <Icon name="rotate-ccw" className="size-3" />
          </button>
          {count > 0 ? (
            <button
              type="button"
              className="text-[11px] text-rose-500 hover:underline disabled:opacity-50"
              onClick={() => void handleClear()}
              disabled={busy}
            >
              清空
            </button>
          ) : null}
        </div>
      </div>
      <div className="px-3 pb-1 text-[11px] text-muted-foreground">
        删除的文档保留在此，可恢复或彻底删除
      </div>
      <div className="px-1.5">
        {loading && items === null ? (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="px-2 py-1 text-[11px] text-rose-500">
            加载失败，请重试
            <button type="button" onClick={() => void reload()} className="ml-1 text-primary hover:underline">
              重试
            </button>
          </div>
        ) : count === 0 ? (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">回收站为空</div>
        ) : (
          <div className="space-y-0.5">
            {(items ?? []).map((item) => (
              <div
                key={item.id}
                data-trash-id={item.id}
                className="rounded px-2 py-1.5 hover:bg-accent"
              >
                <div className="flex items-center gap-1.5">
                  <Icon name="file-text" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={item.rel_path}>
                    {item.name}
                  </span>
                </div>
                <div className="truncate text-[11px] text-muted-foreground" title={item.rel_path}>
                  {item.rel_path}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {formatDeletedAt(item.deleted_at)} · {formatBytes(item.size)}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-[1px] text-[11px] text-foreground/80 hover:bg-sidebar-accent disabled:opacity-50"
                    onClick={() => void handleRestore(item)}
                    disabled={busy}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-[1px] text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    onClick={() => void handlePurge(item)}
                    disabled={busy}
                  >
                    彻底删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
