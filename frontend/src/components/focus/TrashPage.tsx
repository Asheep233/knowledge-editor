/**
 * Focus 回收站页（主画布页面）。
 *
 * 设计源：AstraNota-Focus-Handoff/prototype/screens/trash.html +
 *   assets/css/screens.css（.page-* / .trash-list / .trash-row / .tr-*）。
 * 数据源：listTrash()（GET /api/trash，清单由后端从 <ws>/Trash 目录结构派生）。
 * 操作：恢复（restoreTrash，目标已存在时后端自动改名）/ 彻底删除（purgeTrash）/
 *       清空（clearTrash）；删除类操作一律先走自绘 askConfirm 二次确认。
 * 范围（MVP）：仅文档进入回收站；文件夹删除是永久操作，附件删除不可恢复。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearTrash, listTrash, purgeTrash, restoreTrash } from '../../api/client'
import type { TrashItem } from '../../types'
import { askConfirm } from '../common/PromptDialog'
import { baseName, formatBytes } from '../trash/TrashPanel'
import { Icon } from '../icons'
import { PageShell } from './PageShell'
import type { FocusPageProps } from './pageTypes'

type Status = { kind: 'ok' | 'err'; text: string }

/** 删除时间 → 「今天 11:02 / 昨天 19:44 / 10 月 14 日」（参考稿 tr-meta 风格） */
function formatTrashTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const now = new Date()
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (days === 0) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (days === 1) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 原相对路径 → 所在文件夹（不含文件名；根目录给空串） */
function folderOf(relPath: string): string {
  const parts = relPath.split('/')
  return parts.slice(0, -1).join('/')
}

const BTN_SECONDARY =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40'
const BTN_DANGER =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-[var(--danger-soft)] px-3 text-[13px] font-medium text-danger transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40'
const IBTN =
  'grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'

export function TrashPage({ refreshToken, onFsChanged }: FocusPageProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const genRef = useRef(0)

  const load = useCallback(async () => {
    const gen = ++genRef.current
    setLoading(true)
    setError(false)
    try {
      const payload = await listTrash()
      if (gen !== genRef.current) return
      setItems(payload.items ?? [])
    } catch {
      if (gen !== genRef.current) return
      setError(true)
    } finally {
      if (gen === genRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  const handleRestore = useCallback(
    async (item: TrashItem) => {
      setBusyId(item.id)
      setStatus(null)
      try {
        const result = await restoreTrash(item.id)
        onFsChanged?.()
        setStatus({
          kind: 'ok',
          text: result.renamed
            ? `已恢复为 ${baseName(result.restored_to)}（原路径已有同名文件，已自动改名）`
            : `已恢复：${result.restored_to}`,
        })
        await load()
      } catch (e) {
        setStatus({ kind: 'err', text: `恢复失败：${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const handlePurge = useCallback(
    async (item: TrashItem) => {
      const ok = await askConfirm(`彻底删除「${item.name}」？\n删除后无法恢复。`, {
        confirmText: '永久删除',
        danger: true,
      })
      if (!ok) return
      setBusyId(item.id)
      setStatus(null)
      try {
        await purgeTrash(item.id)
        setStatus({ kind: 'ok', text: `已彻底删除：${item.name}` })
        await load()
      } catch (e) {
        setStatus({ kind: 'err', text: `彻底删除失败：${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const handleClear = useCallback(async () => {
    const count = items.length
    if (count === 0) return
    const ok = await askConfirm(`确认清空回收站？共 ${count} 项，清空后无法恢复。`, {
      confirmText: '清空',
      danger: true,
    })
    if (!ok) return
    setClearing(true)
    setStatus(null)
    try {
      await clearTrash()
      setStatus({ kind: 'ok', text: '回收站已清空' })
      await load()
    } catch (e) {
      setStatus({ kind: 'err', text: `清空回收站失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setClearing(false)
    }
  }, [items.length, load])

  const busy = busyId !== null || clearing
  const subtitle =
    items.length === 0 ? '已删除的文档会显示在这里，可随时恢复' : `${items.length} 篇已删除文档 · 可随时恢复`

  const actions = (
    <>
      <button type="button" className={BTN_SECONDARY} onClick={() => void load()} disabled={loading || busy}>
        <Icon name="rotate-ccw" className="size-4" />
        刷新
      </button>
      <button
        type="button"
        className={BTN_DANGER}
        onClick={() => void handleClear()}
        disabled={busy || items.length === 0}
        data-testid="clear-trash"
      >
        <Icon name="trash" className="size-4" />
        {clearing ? '清空中…' : '清空回收站'}
      </button>
    </>
  )

  return (
    <PageShell title="回收站" subtitle={subtitle} actions={actions} narrow>
      {status ? (
        <div
          role="status"
          data-testid="page-status"
          className={`mb-4 flex items-start gap-2 rounded-[var(--radius-md)] px-4 py-3 text-[13px] leading-[1.55] ${
            status.kind === 'ok'
              ? 'bg-[var(--success-soft)] text-success'
              : 'bg-[var(--danger-soft)] text-danger'
          }`}
        >
          <Icon name={status.kind === 'ok' ? 'circle-check' : 'alert'} className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{status.text}</span>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div data-testid="loading-state" className="py-16 text-center text-[13px] text-text-3">
          加载中…
        </div>
      ) : error && items.length === 0 ? (
        <div data-testid="error-state" className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-[13px] text-danger">
            回收站加载失败
            <span className="text-text-3">（后端未就绪或工作区未打开）</span>
          </div>
          <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
            <Icon name="rotate-ccw" className="size-3.5" />
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div data-testid="empty-state" className="flex flex-col items-center px-8 py-20 text-center text-text-2">
          <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-surface-2 text-text-3">
            <Icon name="trash" className="size-7" />
          </span>
          <div className="mb-1.5 font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">回收站为空</div>
          <div className="max-w-[360px] text-[14px] leading-[1.6] text-text-2">
            删除的文档会先移动到这里（原路径可恢复），确认不再需要后再清空。
          </div>
        </div>
      ) : (
        <div data-testid="trash-list" className="overflow-hidden rounded-[18px] bg-card shadow-sm">
          {items.map((item) => {
            const folder = folderOf(item.rel_path)
            const rowBusy = busyId === item.id
            return (
              <div
                key={item.id}
                data-testid={`trash-row-${item.id}`}
                className="flex items-center gap-4 border-b border-border px-[22px] py-[17px] last:border-b-0"
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-surface-2 text-text-3">
                  <Icon name="file-text" className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-foreground" title={item.name}>
                    {item.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-text-3" title={item.rel_path}>
                    {folder || '根目录'}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[13px] text-text-3">
                  {formatTrashTime(item.deleted_at)} · {formatBytes(item.size)}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    disabled={busy}
                    onClick={() => void handleRestore(item)}
                    data-testid={`trash-restore-${item.id}`}
                  >
                    {rowBusy ? '处理中…' : '恢复'}
                  </button>
                  <button
                    type="button"
                    className={`${IBTN} hover:text-danger`}
                    title="永久删除"
                    aria-label={`彻底删除 ${item.name}`}
                    disabled={busy}
                    onClick={() => void handlePurge(item)}
                    data-testid={`trash-purge-${item.id}`}
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3.5 text-[13px] leading-[1.55] text-text-2">
        <Icon name="bulb" className="mt-0.5 size-4 shrink-0 text-text-3" />
        <span>
          只有文档会进入回收站。文件夹删除是永久操作（需要二次确认）；附件删除不可恢复，被引用的附件受保护。
        </span>
      </div>
    </PageShell>
  )
}
