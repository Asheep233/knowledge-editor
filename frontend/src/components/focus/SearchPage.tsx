/**
 * Focus 搜索页（主画布页面）。
 *
 * 设计源：`AstraNota-Focus-Handoff/prototype/screens/search.html` +
 * `prototype/assets/css/screens.css`（.search-hero / .search-filters / .chip /
 * .result-list / .result-group-title / .result-item / .search-footnote）。
 *
 * 交互契约（task-9）：
 *   - 大搜索框自动聚焦；输入 300ms 防抖 + Enter 立即检索，Esc 清空；
 *   - 调用 `search(q)`（后端全文索引：文档 / 模块 / 附件）；
 *   - 筛选 chips：全部 / 文档 / 模块 / 附件（按返回 kind 过滤）；
 *   - 右侧「重建索引」调用 `rebuildIndex()`，完成后重跑当前查询；
 *   - 结果：分组标题 + 标题/路径/高亮摘要/类型；文档点击 `onOpenArticle`，模块/附件只读展示；
 *   - 底部说明行：结果数与单次上限（20 条）；
 *   - 空态（未输入）/ 无结果 / 加载 / 错误（可重试）各自独立。
 *
 * 样式纪律：只引用 index.css 的设计令牌（Tailwind 语义类），不修改 index.css。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { rebuildIndex, search } from '../../api/client'
import type { SearchPayload, SearchResult } from '../../types'
import { Icon } from '../icons'
import { PageShell } from './PageShell'
import type { FocusPageProps } from './pageTypes'

const DEBOUNCE_MS = 300
const MAX_RESULTS = 20

type KindFilter = 'all' | 'document' | 'module' | 'attachment'

const KIND_TABS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'document', label: '文档' },
  { id: 'module', label: '模块' },
  { id: 'attachment', label: '附件' },
]

const KIND_LABEL: Record<string, string> = {
  document: '文档',
  module: '模块',
  attachment: '附件',
}

const BTN_BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const BTN_GHOST = `${BTN_BASE} h-8 bg-transparent px-2.5 text-[13px] text-text-2 hover:bg-surface-2 hover:text-foreground`
const CARD = 'rounded-[18px] bg-card shadow-soft'
const CHIP =
  'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-[450] transition-colors'
const CHIP_IDLE = `${CHIP} border-border bg-card text-text-2 hover:text-foreground`
const CHIP_ACTIVE = `${CHIP} border-transparent bg-foreground text-background`

// ===== 纯函数工具 =====
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** ISO 时间 → 参考稿风格（今天 14:06 / 昨天 / 10-14 / 2025-10-14） */
export function formatWhen(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/** 索引摘要 → 纯文本：剥 frontmatter / HTML 注释 / Markdown 标记与块级公式（行内公式保留原文），压缩空白 */
export function cleanSnippet(raw?: string): string {
  if (!raw) return ''
  return raw
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    // 行内公式：去掉 $...$ 与常见 LaTeX 命令，保留可读文本（避免结果里出现 \mathrm{p} 这类残渣）
    .replace(/\$([^$]{1,120})\$/g, (_m, tex: string) =>
      tex
        .replace(/\\[a-zA-Z]+\*?/g, '')
        .replace(/[{}^_\\]/g, '')
        .trim(),
    )
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 结果路径 → 分组标题（参考稿：「普通物理学（上）」/「理论力学 · 模块」） */
export function resultGroupLabel(relPath: string): string {
  const parts = relPath.split('/')
  parts.pop()
  if (parts.length === 0) return '根目录'
  if (parts[0] === 'Articles') return parts.length > 1 ? parts.slice(1).join(' / ') : 'Articles'
  if (parts[0] === 'Modules') return `${parts.length > 1 ? parts.slice(1).join(' / ') : '模块'} · 模块`
  if (parts[0] === 'Attachments') return `${parts.length > 1 ? parts.slice(1).join(' / ') : '附件'} · 附件`
  return parts.join(' / ')
}

interface ResultGroup {
  label: string
  items: SearchResult[]
}

/** 按父目录分组（保持后端返回顺序），参考稿 .result-group-title */
export function groupResults(results: SearchResult[]): ResultGroup[] {
  const groups: ResultGroup[] = []
  const index = new Map<string, ResultGroup>()
  for (const item of results) {
    const label = resultGroupLabel(item.rel_path)
    let group = index.get(label)
    if (!group) {
      group = { label, items: [] }
      index.set(label, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

/** 查询词高亮（大小写不敏感；query 为空时原样输出） */
export function Highlight({ text, query, markClassName }: { text: string; query: string; markClassName: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const lowerText = text.toLowerCase()
  const lowerQuery = q.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let key = 0
  while (from < text.length) {
    const at = lowerText.indexOf(lowerQuery, from)
    if (at < 0) {
      parts.push(text.slice(from))
      break
    }
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={key++} className={markClassName}>
        {text.slice(at, at + q.length)}
      </mark>,
    )
    from = at + q.length
  }
  return <>{parts}</>
}

// ===== 本页私有子组件 =====
function StateCard({
  title,
  detail,
  action,
  testId,
}: {
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  testId?: string
}) {
  return (
    <div
      role={action ? 'alert' : undefined}
      data-testid={testId}
      className={`${CARD} px-9 py-12 text-center`}
    >
      <div className="text-[15px] font-medium text-foreground">{title}</div>
      {detail ? <div className="mt-1.5 break-all text-[13px] leading-[1.6] text-text-3">{detail}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

function ResultRow({ item, query, onOpen }: { item: SearchResult; query: string; onOpen: (id: string) => void }) {
  const kindLabel = KIND_LABEL[item.kind] ?? item.kind
  const snippet = cleanSnippet(item.snippet)
  const content = (
    <>
      <div className="text-[16px] font-[550] leading-[1.45] text-foreground">
        <Highlight
          text={item.title}
          query={query}
          markClassName="bg-transparent font-semibold text-accent-foreground"
        />
      </div>
      {snippet ? (
        <div className="mt-[5px] line-clamp-2 text-[14px] leading-[1.6] text-text-2">
          <Highlight
            text={snippet}
            query={query}
            markClassName="rounded-[4px] bg-primary-soft px-[3px] text-accent-foreground"
          />
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-text-3">
        <span
          data-testid="result-kind"
          className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-text-2"
        >
          {kindLabel}
        </span>
        <span className="truncate">{item.rel_path}</span>
        {item.updated_at ? <span className="shrink-0">{formatWhen(item.updated_at)}</span> : null}
      </div>
    </>
  )

  // 文档可打开；模块 / 附件只读展示（当前没有独立查看页，按 task-9 契约不跳转）
  if (item.kind === 'document') {
    return (
      <button
        type="button"
        data-testid="search-result"
        data-kind={item.kind}
        onClick={() => onOpen(item.rel_path)}
        className="block w-full border-t border-border px-[22px] py-[18px] text-left transition-colors hover:bg-surface-2"
      >
        {content}
      </button>
    )
  }
  return (
    <div
      data-testid="search-result"
      data-kind={item.kind}
      className="block w-full border-t border-border px-[22px] py-[18px] text-left"
    >
      {content}
    </div>
  )
}

// ===== 页面组件 =====
export function SearchPage({ onOpenArticle, refreshToken }: FocusPageProps) {
  const [query, setQuery] = useState('')
  /** payload 与「它对应的查询词」：高亮/底部说明用 lastQuery，避免输入中途用半截词高亮旧结果 */
  const [payload, setPayload] = useState<SearchPayload | null>(null)
  const [lastQuery, setLastQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<KindFilter>('all')
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<number | null>(null)
  /** 搜索请求序号：慢响应不得覆盖后发查询的结果 */
  const seqRef = useRef(0)
  const refreshRef = useRef(refreshToken)

  // 大搜索框自动聚焦（参考稿 search-hero）
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q) {
      setPayload(null)
      setLastQuery('')
      setError(null)
      setLoading(false)
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await search(q)
      if (seq !== seqRef.current) return
      setPayload(result)
      setLastQuery(q)
    } catch (err) {
      if (seq !== seqRef.current) return
      setPayload(null)
      setError(errorMessage(err))
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [])

  // 300ms 防抖（清空输入时立即回到空态并作废在途请求）
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      seqRef.current += 1
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setPayload(null)
      setLastQuery('')
      setError(null)
      setLoading(false)
      return
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void runSearch(q)
    }, DEBOUNCE_MS)
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [query, runSearch])

  // 文件系统变更（refreshToken）后：当前查询立即重跑，保证结果与索引一致
  useEffect(() => {
    if (refreshRef.current === refreshToken) return
    refreshRef.current = refreshToken
    const q = query.trim()
    if (q) void runSearch(q)
  }, [refreshToken, query, runSearch])

  /** Enter / 重试：跳过防抖立即检索 */
  const submitNow = useCallback(() => {
    const q = query.trim()
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!q) return
    void runSearch(q)
  }, [query, runSearch])

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleRebuild = useCallback(async () => {
    if (rebuilding) return
    setRebuilding(true)
    setRebuildError(null)
    setRebuildStatus(null)
    try {
      const result = await rebuildIndex()
      setRebuildStatus(
        `索引已重建：${result.stats.document} 篇文档 · ${result.stats.module} 个模块 · ${result.stats.attachment} 个附件`,
      )
      const q = query.trim()
      if (q) await runSearch(q)
    } catch (err) {
      setRebuildError(`重建索引失败：${errorMessage(err)}`)
    } finally {
      setRebuilding(false)
    }
  }, [query, rebuilding, runSearch])

  // ---------- 派生数据 ----------
  const results = payload?.results ?? []
  const counts = useMemo(() => {
    const next: Record<KindFilter, number> = { all: results.length, document: 0, module: 0, attachment: 0 }
    for (const item of results) {
      if (item.kind === 'document' || item.kind === 'module' || item.kind === 'attachment') next[item.kind] += 1
    }
    return next
  }, [results])
  const visibleResults = useMemo(
    () => (kind === 'all' ? results : results.filter((item) => item.kind === kind)).slice(0, MAX_RESULTS),
    [results, kind],
  )
  const groups = useMemo(() => groupResults(visibleResults), [visibleResults])
  const trimmed = query.trim()
  const totalCount = payload ? Math.max(payload.count, results.length) : 0
  const hasResults = results.length > 0
  const kindMiss = hasResults && visibleResults.length === 0

  const filtersRow = (
    <div className="mb-[26px] mt-[22px] flex flex-wrap items-center gap-2">
      {KIND_TABS.map((tab) => {
        const active = kind === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            data-testid="kind-chip"
            data-kind={tab.id}
            aria-pressed={active}
            className={active ? CHIP_ACTIVE : CHIP_IDLE}
            onClick={() => setKind(tab.id)}
          >
            {tab.label}
            {hasResults ? <span className="tabular-nums text-[12px] text-text-3">{counts[tab.id]}</span> : null}
          </button>
        )
      })}
      <div className="ml-auto">
        <button
          type="button"
          className={BTN_GHOST}
          disabled={rebuilding}
          onClick={() => void handleRebuild()}
        >
          <Icon name="rebuild" className="size-[15px]" />
          {rebuilding ? '重建中…' : '重建索引'}
        </button>
      </div>
    </div>
  )

  return (
    <PageShell title="搜索" subtitle="在文档、模块与附件中全文检索" narrow>
      {/* 大搜索框（参考稿 .search-hero，60px 高 / 18px 输入） */}
      <div className="flex h-[60px] items-center gap-3.5 rounded-[18px] bg-card px-5 shadow-float">
        <Icon name="search" className="size-[22px] shrink-0 text-text-3" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') {
              e.preventDefault()
              submitNow()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelPending()
              setQuery('')
            }
          }}
          placeholder="搜索标题、正文、模块与附件…"
          aria-label="搜索"
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-[18px] font-[450] text-foreground outline-none placeholder:text-text-3"
        />
        <kbd className="shrink-0 rounded-[6px] border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-3">
          ESC
        </kbd>
      </div>

      {filtersRow}

      {rebuildStatus ? (
        <div
          role="status"
          className="mb-4 rounded-control bg-primary-soft px-3.5 py-2 text-[12.5px] text-accent-foreground"
        >
          {rebuildStatus}
        </div>
      ) : null}
      {rebuildError ? (
        <div role="alert" className="mb-4 rounded-control border border-border bg-card px-3.5 py-2 text-[12.5px] text-danger">
          {rebuildError}
        </div>
      ) : null}

      {/* 状态分离：加载 / 错误 / 空态（未输入）/ 无结果 / 结果 */}
      {loading ? (
        <div
          aria-busy="true"
          data-testid="search-loading"
          className={`${CARD} px-9 py-12 text-center text-[13px] text-text-3`}
        >
          正在搜索「{trimmed}」…
        </div>
      ) : error ? (
        <StateCard
          title="搜索失败"
          detail={error}
          testId="search-error"
          action={
            <button type="button" className={BTN_GHOST} onClick={submitNow}>
              重试
            </button>
          }
        />
      ) : !trimmed ? (
        <StateCard
          title="输入关键词开始搜索"
          detail="支持标题与正文全文检索 · Enter 立即搜索 · Esc 清空"
          testId="search-idle"
        />
      ) : payload && payload.results.length === 0 ? (
        <StateCard
          title={
            <>
              没有找到与「<span className="text-foreground">{lastQuery || trimmed}</span>」相关的内容
            </>
          }
          detail="试试更短的关键词，或点击「重建索引」更新全文索引后重试。"
          testId="search-empty"
        />
      ) : (
        <>
          {kindMiss ? (
            <div className={`${CARD} mb-3 px-5 py-6 text-center text-[13px] text-text-3`}>
              该类型下没有结果，试试「全部」。
            </div>
          ) : null}
          {groups.length > 0 ? (
            <div className={`${CARD} overflow-hidden`} data-testid="search-results">
              {groups.map((group) => (
                <div key={group.label}>
                  <div className="px-[22px] pb-1.5 pt-4 text-[13px] font-medium text-text-3">{group.label}</div>
                  {group.items.map((item) => (
                    <ResultRow
                      key={`${item.kind}:${item.rel_path}:${item.id}`}
                      item={item}
                      query={lastQuery || trimmed}
                      onOpen={onOpenArticle}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {payload ? (
            <div className="mt-5 flex items-center justify-between gap-3 text-[13px] text-text-3" data-testid="search-footnote">
              <span>
                {totalCount > MAX_RESULTS || totalCount > visibleResults.length
                  ? `显示前 ${visibleResults.length} 条 · 共 ${totalCount} 条`
                  : `共 ${visibleResults.length} 条`}
              </span>
              <span>单次上限 {MAX_RESULTS} 条</span>
            </div>
          ) : null}
        </>
      )}
    </PageShell>
  )
}
