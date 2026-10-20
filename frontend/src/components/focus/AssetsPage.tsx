/**
 * Focus 资料页（主画布页面）。
 *
 * 设计源：AstraNota-Focus-Handoff/prototype/screens/assets.html +
 *   assets/css/screens.css（.page-* / .assets-grid / .asset-card / .asset-thumb /
 *   .asset-info / .asset-meta / .badge-ok / .badge-warn / .chip / .info-note）。
 * 数据源：listAttachments()（类型/大小/引用列表，referenced_by 为空 = 未被引用）。
 * 操作：
 *   - 上传附件 → uploadAttachment（<input type=file multiple>）后刷新列表
 *   - 打开附件 → attachmentUrl(rel) 新窗口（图片/视频在网格里给缩略图）
 *   - 删除 → deleteAttachment（后端仅允许孤儿附件；被引用的附件受保护）
 *
 * 约束（v0.6.1）：孤儿附件仅手动删除、软件绝不自动清理。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  attachmentUrl,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
} from '../../api/client'
import type { AttachmentItem } from '../../types'
import { askConfirm } from '../common/PromptDialog'
import { Icon } from '../icons'
import { PageShell } from './PageShell'
import type { FocusPageProps } from './pageTypes'

type Category = 'all' | 'images' | 'videos' | 'files'
type Status = { kind: 'ok' | 'err'; text: string }

/** 字节 → 展示串（B / KB / MB） */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return 'FILE'
  return name.slice(i + 1).toUpperCase()
}

const BTN_PRIMARY =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40'
const BTN_SECONDARY =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40'
const BTN_SECONDARY_ON =
  'bg-foreground text-background hover:bg-foreground hover:text-background'
const CHIP =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-3.5 text-[13px] text-text-2 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:text-foreground'
const CHIP_ACTIVE = 'bg-foreground text-background shadow-none hover:text-background'

export function AssetsPage({ refreshToken }: FocusPageProps) {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [category, setCategory] = useState<Category>('all')
  const [orphansOnly, setOrphansOnly] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const genRef = useRef(0)

  const load = useCallback(async () => {
    const gen = ++genRef.current
    setLoading(true)
    setError(false)
    try {
      const payload = await listAttachments()
      if (gen !== genRef.current) return
      setItems(payload.attachments ?? [])
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

  const counts = useMemo(() => {
    const c = { all: items.length, images: 0, videos: 0, files: 0, orphan: 0 }
    for (const a of items) {
      if (a.category === 'images') c.images += 1
      else if (a.category === 'videos') c.videos += 1
      else c.files += 1
      if (a.referenced_by.length === 0) c.orphan += 1
    }
    return c
  }, [items])

  const totalSize = useMemo(() => items.reduce((sum, a) => sum + (a.size || 0), 0), [items])

  const filtered = useMemo(
    () =>
      items.filter((a) => {
        if (category !== 'all' && a.category !== category) return false
        if (orphansOnly && a.referenced_by.length > 0) return false
        return true
      }),
    [items, category, orphansOnly],
  )

  const handleUpload = useCallback(
    async (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : []
      if (list.length === 0) return
      setUploading(true)
      setStatus(null)
      try {
        const results = await Promise.allSettled(list.map((f) => uploadAttachment(f)))
        const ok = results.filter((r) => r.status === 'fulfilled').length
        const failed = results.length - ok
        setStatus(
          failed === 0
            ? { kind: 'ok', text: ok === 1 ? `已上传：${list[0].name}` : `已上传 ${ok} 个附件` }
            : { kind: 'err', text: `上传完成：成功 ${ok} 个，失败 ${failed} 个（单文件上限 512 MB）` },
        )
        await load()
      } catch (e) {
        setStatus({ kind: 'err', text: `上传失败：${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [load],
  )

  const handleDelete = useCallback(
    async (item: AttachmentItem) => {
      const ok = await askConfirm(`确定删除未引用附件「${item.name}」？\n删除后不可恢复。被引用的附件受保护，需先移除引用。`, {
        confirmText: '删除',
        danger: true,
      })
      if (!ok) return
      setDeleting(item.rel_path)
      setStatus(null)
      try {
        await deleteAttachment(item.rel_path)
        setStatus({ kind: 'ok', text: `已删除附件：${item.name}` })
        await load()
      } catch (e) {
        setStatus({ kind: 'err', text: `删除失败：${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setDeleting(null)
      }
    },
    [load],
  )

  const subtitle =
    items.length === 0
      ? '附件集中管理 · 被引用的附件受保护'
      : `${items.length} 个附件 · ${formatBytes(totalSize)} · ${counts.orphan} 个未被引用`

  const actions = (
    <>
      <button
        type="button"
        className={`${BTN_SECONDARY} ${orphansOnly ? BTN_SECONDARY_ON : ''}`}
        aria-pressed={orphansOnly}
        onClick={() => setOrphansOnly((v) => !v)}
        data-testid="orphans-only"
      >
        <Icon name="alert" className="size-4" />
        仅看未引用
      </button>
      <button
        type="button"
        className={BTN_PRIMARY}
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        data-testid="upload-attachment"
      >
        <Icon name="paperclip" className="size-4" />
        {uploading ? '上传中…' : '上传附件'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="asset-upload-input"
        onChange={(e) => void handleUpload(e.target.files)}
      />
    </>
  )

  return (
    <PageShell title="资料" subtitle={subtitle} actions={actions}>
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

      {/* 未引用提示条（仅在有未引用附件时出现） */}
      {counts.orphan > 0 ? (
        <div
          data-testid="orphan-note"
          className="mb-5 flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--warn-soft)] px-4 py-3.5 text-[13px] leading-[1.55] text-warn"
        >
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">
            有 {counts.orphan} 个附件未被任何文档引用，可手动删除（软件不会自动清理）。
            <button
              type="button"
              className="ml-1 underline decoration-dotted underline-offset-2 hover:opacity-80"
              onClick={() => setOrphansOnly(true)}
            >
              只看未引用
            </button>
          </span>
        </div>
      ) : null}

      {/* 类型筛选 chips（参考稿 .search-filters / .chip） */}
      <div className="mb-[26px] flex flex-wrap items-center gap-2">
        {(
          [
            ['all', '全部', counts.all],
            ['images', '图片', counts.images],
            ['videos', '视频', counts.videos],
            ['files', '文件', counts.files],
          ] as const
        ).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            className={`${CHIP} ${category === key ? CHIP_ACTIVE : ''}`}
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            {label} <span className="tabular-nums opacity-55">{n}</span>
          </button>
        ))}
        <div className="ml-auto hidden text-[13.5px] text-text-3 min-[760px]:block">上传后自动按图片 / 视频 / 文件归类</div>
      </div>

      {loading && items.length === 0 ? (
        <div data-testid="loading-state" className="py-16 text-center text-[13px] text-text-3">
          加载中…
        </div>
      ) : error && items.length === 0 ? (
        <div data-testid="error-state" className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-[13px] text-danger">
            附件加载失败
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
            <Icon name="paperclip" className="size-7" />
          </span>
          <div className="mb-1.5 font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">还没有附件</div>
          <div className="max-w-[360px] text-[14px] leading-[1.6] text-text-2">
            上传图片、视频或其它文件；被文档引用后会显示引用数量，未被引用的可手动删除。
          </div>
          <div className="mt-5">
            <button type="button" className={BTN_PRIMARY} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Icon name="paperclip" className="size-4" />
              上传附件
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div data-testid="empty-state" className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="font-display text-[18px] font-semibold text-foreground">没有匹配的附件</div>
          <div className="text-[13.5px] text-text-2">清除筛选后重试。</div>
          <button
            type="button"
            className={`${BTN_SECONDARY} mt-2`}
            onClick={() => {
              setCategory('all')
              setOrphansOnly(false)
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
        <div
          data-testid="assets-grid"
          className="grid grid-cols-1 gap-3.5 min-[761px]:grid-cols-3 min-[1101px]:grid-cols-4"
        >
          {filtered.map((a) => {
            const url = attachmentUrl(a.rel_path)
            const cited = a.referenced_by.length > 0
            const isImage = a.category === 'images'
            const isVideo = a.category === 'videos'
            return (
              <div
                key={a.rel_path}
                data-testid={`asset-card-${a.rel_path}`}
                className="group relative overflow-hidden rounded-lg bg-card text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={`打开附件：${a.rel_path}`}
                  data-testid={`asset-open-${a.rel_path}`}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-[124px] items-center justify-center overflow-hidden bg-surface-2 text-text-3">
                    {isImage ? (
                      <img
                        src={url}
                        alt={a.name}
                        loading="lazy"
                        data-testid={`asset-thumb-img-${a.rel_path}`}
                        className="h-full w-full object-cover"
                      />
                    ) : isVideo ? (
                      <video
                        src={url}
                        muted
                        preload="metadata"
                        data-testid={`asset-thumb-video-${a.rel_path}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-mono text-[12px] font-medium tracking-[0.04em]">{extOf(a.name)}</span>
                    )}
                  </span>
                  <span className="block px-3.5 pb-[15px] pt-[13px]">
                    <span className="block truncate text-[13px] font-medium text-foreground" title={a.rel_path}>
                      {a.name}
                    </span>
                    <span className="mt-[5px] flex items-center gap-2 text-[12.5px] text-text-3">
                      {cited ? (
                        <span className="text-success" data-testid={`asset-ref-${a.rel_path}`}>
                          已引用 {a.referenced_by.length}
                        </span>
                      ) : (
                        <span className="text-warn" data-testid={`asset-unref-${a.rel_path}`}>
                          未引用
                        </span>
                      )}
                      <span className="tabular-nums">{formatBytes(a.size)}</span>
                    </span>
                  </span>
                </a>
                {!cited ? (
                  <button
                    type="button"
                    title="删除未引用附件"
                    aria-label={`删除未引用附件 ${a.name}`}
                    data-testid={`asset-delete-${a.rel_path}`}
                    disabled={deleting === a.rel_path}
                    onClick={() => void handleDelete(a)}
                    className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-card/90 text-text-3 opacity-70 shadow-sm transition hover:text-danger hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                  >
                    <Icon name="trash" className="size-3.5" />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3.5 text-[13px] leading-[1.55] text-text-2">
        <Icon name="bulb" className="mt-0.5 size-4 shrink-0 text-text-3" />
        <span>
          被引用的附件受保护，需要先移除引用才能删除。未被引用的附件可以手动删除，软件不会自动清理。
        </span>
      </div>
    </PageShell>
  )
}
