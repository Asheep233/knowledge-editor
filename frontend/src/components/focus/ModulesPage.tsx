/**
 * Focus 模块页（主画布页面）。
 *
 * 设计源：AstraNota-Focus-Handoff/prototype/screens/modules.html +
 *   assets/css/screens.css（.page-* / .modules-grid / .module-card / .mc-* / .chip / .field）。
 * 数据源：
 *   - listModules()   模块名/路径/标题/标签/版本（GET /api/modules）
 *   - getTree()       文件夹数（含空文件夹，Modules/ 下目录以尾缀 "/" 表示）
 *   - getArticle(path) 更新时间和摘要（尽力而为：失败时卡片仍展示基础信息）
 * 操作：
 *   - 新建模块   → createDocIn('Modules', title) 创建 Modules/ 下 Markdown 后刷新
 *   - 新建文件夹 → createFolder('Modules/<name>') 后刷新
 *   - 双击/点击卡片 → getModule(path) 只读预览弹层，可再跳转编辑器
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
  createDocIn,
  createFolder,
  getArticle,
  getModule,
  getTree,
  listModules,
  type ModuleInfo,
} from '../../api/client'
import { askPrompt } from '../common/PromptDialog'
import { Icon } from '../icons'
import { PageShell } from './PageShell'
import type { FocusPageProps } from './pageTypes'

interface ModuleRow extends ModuleInfo {
  /** 相对 Modules/ 的父目录路径（根目录为空串） */
  folder: string
  updatedAt?: string
  size?: number
  excerpt?: string
}

interface PreviewState {
  path: string
  title: string
  content: string | null
  error: boolean
}

type Status = { kind: 'ok' | 'err'; text: string }

/** 卡片/列表里的完整路径只存 tooltip，这里给「Modules/子目录/文件.md」→「子目录」 */
function folderOf(path: string): string {
  const parts = path.split('/')
  // ["Modules", ...子目录, "x.md"]；根目录模块 = ["Modules", "x.md"]
  const dirs = parts.slice(1, -1)
  return dirs.join('/')
}

/** 字节 → 展示串（B / KB / MB），与附件/回收站展示量级一致 */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** ISO 时间 → 「10 月 12 日」（跨年补年份；无效值返回空串） */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()} 年 ${md}`
}

/**
 * 去掉 frontmatter 与常见 Markdown 标记，取前 ~120 字作为卡片摘要。
 * 数学片段（$...$ / $$...$$）**原样保留**（下划线/星号是 LaTeX 语法，不能当 Markdown 清理），
 * 由卡片交给 KaTeX 渲染。
 */
export function excerptOf(content: string, limit = 120): string {
  let body = content.replace(/^\uFEFF/, '')
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3)
    if (end >= 0) body = body.slice(end + 4)
  }
  const cleaned = splitMath(body.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))
    .map((part) => {
      if (part.math) return `$${part.text}$`
      return part.text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`>~]/g, '')
        .replace(/\s+/g, ' ')
    })
    .join('')
  let out = cleaned.replace(/\s+/g, ' ').trim()
  if (out.length > limit) {
    out = out.slice(0, limit)
    // 截断可能切在数学片段中间 → 丢弃末尾未闭合的 '$' 之后的内容
    if ((out.match(/\$/g)?.length ?? 0) % 2 === 1) out = out.slice(0, out.lastIndexOf('$'))
  }
  return out
}

interface MathPart {
  math: boolean
  text: string
}

/** 把含 $...$ / $$...$$ 的纯文本切分为「普通文本 / 数学片段」 */
export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0
    if (index > last) parts.push({ math: false, text: text.slice(last, index) })
    parts.push({ math: true, text: (m[2] ?? m[1] ?? '').trim() })
    last = index + m[0].length
  }
  if (last < text.length) parts.push({ math: false, text: text.slice(last) })
  return parts
}

/** 卡片摘要里的行内公式用 KaTeX 渲染（与参考稿 auto-render 后的效果一致） */
function MathText({ text }: { text: string }) {
  const parts = useMemo(() => splitMath(text), [text])
  if (parts.every((part) => !part.math)) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        part.math ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(part.text || '\;', { displayMode: false, throwOnError: false }),
            }}
          />
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

/** 模块标签（后端 tags 可能是 YAML 字符串或列表）→ 字符串数组 */
export function parseTags(raw: unknown): string[] {
  if (raw == null) return []
  const list = Array.isArray(raw) ? raw : String(raw).replace(/^\[|\]$/g, '').split(/[,，、\s]+/)
  return list
    .map((t) => String(t).trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

const BTN_PRIMARY =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40'
const BTN_SECONDARY =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40'
const CHIP =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-3.5 text-[13px] text-text-2 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:text-foreground'
const CHIP_ACTIVE = 'bg-foreground text-background shadow-none hover:text-background'

export function ModulesPage({ onOpenArticle, refreshToken }: FocusPageProps) {
  const [rows, setRows] = useState<ModuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [folderCount, setFolderCount] = useState(0)
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<'module' | 'folder' | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  // 刷新竞态保护：只采纳最后一次加载的结果
  const genRef = useRef(0)

  const load = useCallback(async () => {
    const gen = ++genRef.current
    setLoading(true)
    setError(false)
    try {
      // 树用于文件夹数（含空文件夹）；失败不影响模块列表
      const [payload, tree] = await Promise.all([listModules(), getTree().catch(() => null)])
      if (gen !== genRef.current) return
      const modules = payload.modules ?? []
      const derivedFolders = new Set(modules.map((m) => folderOf(m.path)).filter(Boolean)).size
      setFolderCount(
        tree
          ? tree.modules.filter((p) => p.endsWith('/')).length
          : derivedFolders,
      )
      setRows(modules.map((m) => ({ ...m, folder: folderOf(m.path) })))
      setLoading(false)

      // 第二阶段：补更新时间/大小/摘要（逐模块尽力而为；失败保留基础卡片）
      if (modules.length === 0) return
      const details = await Promise.allSettled(modules.map((m) => getArticle(m.path)))
      if (gen !== genRef.current) return
      const byPath = new Map<string, { updatedAt?: string; size?: number; excerpt?: string }>()
      details.forEach((r, i) => {
        if (r.status !== 'fulfilled') return
        byPath.set(modules[i].path, {
          updatedAt: r.value.updated_at,
          size: r.value.size,
          excerpt: excerptOf(r.value.content ?? ''),
        })
      })
      setRows((prev) =>
        prev.map((row) => {
          const detail = byPath.get(row.path)
          return detail ? { ...row, ...detail } : row
        }),
      )
    } catch {
      if (gen !== genRef.current) return
      setError(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  const tagList = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) for (const tag of parseTags(row.tags)) set.add(tag)
    return Array.from(set)
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (activeTag && !parseTags(row.tags).includes(activeTag)) return false
      if (!q) return true
      const hay = `${row.title ?? ''} ${row.name} ${row.path} ${row.folder} ${parseTags(row.tags).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, activeTag, query])

  const handleNewModule = useCallback(async () => {
    const input = await askPrompt('新建模块名称', '新模块')
    const title = (input ?? '').trim()
    if (!title) return
    setBusy('module')
    setStatus(null)
    try {
      await createDocIn('Modules', title)
      setStatus({ kind: 'ok', text: `已创建模块：${title}` })
      await load()
    } catch (e) {
      setStatus({ kind: 'err', text: `新建模块失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }, [load])

  const handleNewFolder = useCallback(async () => {
    const input = await askPrompt('新建文件夹名称', '新文件夹')
    const name = (input ?? '').trim()
    if (!name) return
    if (/[\\/]/.test(name)) {
      setStatus({ kind: 'err', text: '文件夹名称不能包含 / 或 \\' })
      return
    }
    setBusy('folder')
    setStatus(null)
    try {
      await createFolder(`Modules/${name}`)
      setStatus({ kind: 'ok', text: `已创建文件夹：Modules/${name}` })
      await load()
    } catch (e) {
      setStatus({ kind: 'err', text: `新建文件夹失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }, [load])

  const openPreview = useCallback(async (row: ModuleRow) => {
    const title = row.title || row.name
    setPreview({ path: row.path, title, content: null, error: false })
    try {
      const mod = await getModule(row.path)
      setPreview((prev) => (prev && prev.path === row.path ? { ...prev, content: mod.content } : prev))
    } catch {
      setPreview((prev) => (prev && prev.path === row.path ? { ...prev, error: true } : prev))
    }
  }, [])

  // Esc 关闭只读预览
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  const subtitle =
    rows.length === 0
      ? '可复用的内容块 · 插入时会复制内容，并保留来源'
      : `${rows.length} 个模块 · ${folderCount} 个文件夹 · 插入时会复制内容，并保留来源`

  const actions = (
    <>
      <button
        type="button"
        className={BTN_SECONDARY}
        onClick={() => void handleNewFolder()}
        disabled={busy !== null}
      >
        <Icon name="folder-plus" className="size-4" />
        新建文件夹
      </button>
      <button
        type="button"
        className={BTN_PRIMARY}
        onClick={() => void handleNewModule()}
        disabled={busy !== null}
        data-testid="new-module"
      >
        <Icon name="plus" className="size-4" />
        {busy === 'module' ? '创建中…' : '新建模块'}
      </button>
    </>
  )

  return (
    <PageShell title="模块" subtitle={subtitle} actions={actions}>
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

      {/* 筛选条：全部/标签 chips + 搜索框（参考稿 .search-filters / .chip / .field） */}
      <div className="mb-[26px] flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${CHIP} ${activeTag === null ? CHIP_ACTIVE : ''}`}
          onClick={() => setActiveTag(null)}
          aria-pressed={activeTag === null}
        >
          全部 <span className="tabular-nums opacity-55">{rows.length}</span>
        </button>
        {tagList.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`${CHIP} ${activeTag === tag ? CHIP_ACTIVE : ''}`}
            onClick={() => setActiveTag((prev) => (prev === tag ? null : tag))}
            aria-pressed={activeTag === tag}
          >
            {tag}
          </button>
        ))}
        <div className="ml-auto flex h-[38px] w-full items-center gap-2.5 rounded-control bg-surface-2 px-3 text-text-3 transition-colors focus-within:bg-card focus-within:shadow-[0_0_0_3px_var(--primary-soft),inset_0_0_0_1px_var(--primary)] min-[640px]:w-[240px]">
          <Icon name="search" className="size-4 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模块"
            aria-label="搜索模块"
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-text-3"
          />
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div data-testid="loading-state" className="py-16 text-center text-[13px] text-text-3">
          加载中…
        </div>
      ) : error && rows.length === 0 ? (
        <div data-testid="error-state" className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-[13px] text-danger">
            模块加载失败
            <span className="text-text-3">（后端未就绪或工作区未打开）</span>
          </div>
          <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
            <Icon name="rotate-ccw" className="size-3.5" />
            重试
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="empty-state" className="flex flex-col items-center px-8 py-20 text-center text-text-2">
          <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-surface-2 text-text-3">
            <Icon name="layers" className="size-7" />
          </span>
          <div className="mb-1.5 font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            还没有模块
          </div>
          <div className="max-w-[360px] text-[14px] leading-[1.6] text-text-2">
            模块是可复用的内容块（定义/公式/定理/模板），插入时会复制内容并保留来源。新建一个试试。
          </div>
          <div className="mt-5 flex gap-2">
            <button type="button" className={BTN_PRIMARY} onClick={() => void handleNewModule()}>
              <Icon name="plus" className="size-4" />
              新建模块
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div data-testid="empty-state" className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="font-display text-[18px] font-semibold text-foreground">没有匹配的模块</div>
          <div className="text-[13.5px] text-text-2">换个关键词，或清除筛选后重试。</div>
          <button
            type="button"
            className={`${BTN_SECONDARY} mt-2`}
            onClick={() => {
              setQuery('')
              setActiveTag(null)
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
        <div data-testid="modules-grid" className="grid grid-cols-1 gap-3.5 min-[761px]:grid-cols-2 min-[1101px]:grid-cols-3">
          {filtered.map((row) => {
            const title = row.title || row.name
            const tags = parseTags(row.tags)
            const date = row.updatedAt ? shortDate(row.updatedAt) : ''
            const topLabel = [row.folder || '模块', date].filter(Boolean).join(' · ')
            const version = row.version ?? 1
            return (
              <div
                key={row.path}
                role="button"
                tabIndex={0}
                aria-label={`预览模块 ${title}`}
                data-testid={`module-card-${row.path}`}
                onClick={() => void openPreview(row)}
                onKeyDown={(e) => {
                  // 只在卡片自身获得焦点时响应；内部按钮的 Enter/Space 交给按钮
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void openPreview(row)
                  }
                }}
                className="group flex cursor-pointer flex-col rounded-xl bg-card p-[22px] text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex min-h-6 items-center gap-2 text-[13px] text-text-3">
                  <span className="min-w-0 truncate">{topLabel}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">v{version}</span>
                    {tags[0] ? (
                      <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-[12.5px] text-text-2">{tags[0]}</span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-3 truncate font-display text-[18px] font-[640] tracking-[-0.025em] text-foreground">
                  {title}
                </div>
                <div className="mt-[7px] line-clamp-3 min-h-[67px] text-[13.5px] leading-[1.65] text-text-2">
                  {row.excerpt ? <MathText text={row.excerpt} /> : row.path}
                </div>
                <div className="mt-[18px] flex items-center gap-2 text-[13px] text-text-3">
                  <span className="tabular-nums">{row.size != null ? formatBytes(row.size) : '—'}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={row.path}>
                    {row.path}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="预览"
                      aria-label={`预览 ${title}`}
                      className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openPreview(row)
                      }}
                    >
                      <Icon name="file-text" className="size-4" />
                    </button>
                    <button
                      type="button"
                      title="在编辑器中打开"
                      aria-label={`在编辑器中打开 ${title}`}
                      className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenArticle(row.path)
                      }}
                    >
                      <Icon name="export" className="size-4" />
                    </button>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 只读预览弹层：双击/点击卡片 → getModule 原文 */}
      {preview ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] p-6"
          data-testid="module-preview"
          onClick={() => setPreview(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`模块预览 ${preview.title}`}
            className="flex max-h-[78vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[var(--radius-dialog)] bg-card shadow-[var(--elev-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-border px-6 py-5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[19px] font-semibold tracking-[-0.02em] text-foreground">
                  {preview.title}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-text-3">
                  <span className="truncate font-mono" title={preview.path}>
                    {preview.path}
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[11px] leading-[18px]">原文 · 只读</span>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭预览"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground"
                onClick={() => setPreview(null)}
              >
                <Icon name="close" className="size-4" />
              </button>
            </div>
            <div className="min-h-[120px] flex-1 overflow-y-auto px-6 py-5">
              {preview.error ? (
                <div className="text-[13px] text-danger">模块内容加载失败（文件可能已被移动或删除）。</div>
              ) : preview.content === null ? (
                <div className="text-[13px] text-text-3">加载中…</div>
              ) : (
                <div className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.75] text-text-2">
                  {preview.content ? <MathText text={preview.content} /> : '（空模块）'}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <button type="button" className={BTN_SECONDARY} onClick={() => setPreview(null)}>
                关闭
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => {
                  const path = preview.path
                  setPreview(null)
                  onOpenArticle(path)
                }}
              >
                <Icon name="export" className="size-4" />
                在编辑器中打开
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  )
}

/** 供测试/其它页面复用（本文件内也使用） */
export { folderOf, formatBytes }
