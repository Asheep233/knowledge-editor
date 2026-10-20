/**
 * Focus 知识库页（主画布页面）。
 *
 * 设计源：`AstraNota-Focus-Handoff/prototype/screens/library.html` +
 * `prototype/assets/css/screens.css`（.page-inner / .hero-card / .section-head /
 * .list-card / .doc-row / .folder-grid / .folder-card）+ `screenshots/library.png`。
 *
 * 信息架构（自上而下）：
 *   ① 页头：标题「知识库」+ 统计副标题（N 篇文档 · M 个文件夹 · K 个模块）+ 动作（导入 / 新建文档）
 *   ② 继续写作 hero 卡：最近文档的标题 / 正文摘要 / 元信息 / 「继续写作 →」
 *   ③ 最近编辑列表卡：标题 / 所属路径 / 时间；点击打开；section 头「清空」= 原侧栏最近更新清空语义
 *   ④ 标签 chips（getTags，点击就地筛选，getFilesByTag 取该标签文档）
 *   ⑤ 文件夹卡网格（由 getTree().articles 派生，点击筛选最近编辑列表）
 *   另含：加载 / 错误（可重试）/ 空态，导入（.md / .zip）后打开新文档。
 *
 * 样式纪律：只引用 index.css 的设计令牌（Tailwind 语义类 bg-card / text-text-2 /
 * border-border / bg-primary-soft / shadow-soft …），不修改 index.css。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  clearRecentDocuments,
  getArticle,
  getFilesByTag,
  getRecentDocuments,
  getTags,
  getTree,
  importMarkdown,
  importPackage,
} from '../../api/client'
import type { ArticleMeta, RecentDocument, SearchResult, TagInfo, TreePayload } from '../../types'
import { Icon } from '../icons'
import { PageShell } from './PageShell'
import type { FocusPageProps } from './pageTypes'

/** 最近编辑列表展示上限（参考稿 6 篇） */
const RECENT_LIMIT = 6
/** hero 摘要取正文前 ~120 字（task-9 契约） */
const EXCERPT_LENGTH = 120

const BTN_BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const BTN_SECONDARY = `${BTN_BASE} h-8 bg-surface-2 px-3 text-[13px] text-foreground hover:bg-surface-3`
const BTN_PRIMARY = `${BTN_BASE} h-8 bg-primary px-3 text-[13px] text-primary-foreground hover:bg-primary-hover`
const BTN_GHOST = `${BTN_BASE} h-8 bg-transparent px-2.5 text-[13px] text-text-2 hover:bg-surface-2 hover:text-foreground`
const CARD = 'rounded-[18px] bg-card shadow-soft'
const CHIP =
  'inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] text-[12.5px] font-[450] transition-colors'
const CHIP_IDLE = `${CHIP} bg-surface-2 text-text-2 hover:text-foreground`
const CHIP_ACTIVE = `${CHIP} bg-primary-soft text-accent-foreground`
const FOLDER_CARD =
  'group flex w-full flex-col rounded-[18px] bg-card p-[22px] text-left shadow-soft transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float'

// ===== 页面内联图标（通用 Icon 集没有 upload / arrow-right / arrow-up-right，
// 参考稿 core.css 的 i-upload / i-arrow-right / i-arrow-up-right 同款） =====
function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[15px]"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 8 5-5 5 5" />
      <path d="M12 3v12" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[15px]"
      aria-hidden="true"
    >
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </svg>
  )
}

function ArrowUpRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  )
}

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

/** 列表行时间（参考稿 doc-row：今天只显示 14:06，昨天显示「昨天」，更早 MM-DD） */
export function formatWhenCompact(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return hm
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/** 正文 → 纯文本摘要：剥 frontmatter / HTML 注释 / 代码块 / 公式 / Markdown 标记，取前 max 字 */
export function toExcerpt(content: string | undefined, max = EXCERPT_LENGTH): string {
  if (!content) return ''
  const text = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*`_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 字数估计：CJK 字符按 1 字，其余按空白分词（后端未返回 word_count 时兜底） */
export function estimateWords(content: string | undefined): number {
  if (!content) return 0
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const cjk = body.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
  const latin = body.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9]+/g)?.length ?? 0
  return cjk + latin
}

/** 文章路径 → 所属文件夹（Articles 下一级目录）；根目录文章返回 null */
export function folderOf(relPath: string): string | null {
  const parts = relPath.split('/')
  if (parts[0] !== 'Articles' || parts.length < 3) return null
  return parts[1]
}

/** 文章路径 → 列表行副标题（文件夹名；根目录文章给「根目录」） */
export function folderLabelOf(relPath: string): string {
  const folder = folderOf(relPath)
  if (folder) return folder
  const parts = relPath.split('/')
  if (parts.length <= 2) return '根目录'
  return parts.slice(0, -1).join(' / ')
}

interface FolderEntry {
  name: string
  count: number
  /** 卡片副标题里的「最近标题」（参考稿 fc-meta：N 篇 · 最近文档） */
  latestTitle: string
}

/** 由文件树派生文件夹（顶层目录）与文档数；最近标题优先取最近文档记录 */
export function collectFolders(tree: TreePayload | null, recent: RecentDocument[]): FolderEntry[] {
  if (!tree) return []
  const map = new Map<string, FolderEntry>()
  for (const relPath of tree.articles) {
    const folder = folderOf(relPath)
    if (!folder) continue
    const entry = map.get(folder) ?? { name: folder, count: 0, latestTitle: '' }
    entry.count += 1
    map.set(folder, entry)
  }
  for (const doc of recent) {
    if (!doc.rel_path) continue
    const folder = folderOf(doc.rel_path)
    if (!folder) continue
    const entry = map.get(folder)
    if (entry && !entry.latestTitle) entry.latestTitle = doc.title
  }
  for (const entry of map.values()) {
    if (entry.latestTitle) continue
    const first = tree.articles.find((p) => folderOf(p) === entry.name)
    if (first) entry.latestTitle = first.split('/').pop()!.replace(/\.md$/i, '')
  }
  return [...map.values()]
}

// ===== 本页私有子组件 =====
function SectionHead({ title, count, right }: { title: string; count?: string; right?: ReactNode }) {
  return (
    <div className="mb-3.5 mt-10 flex items-baseline gap-3">
      <h2 className="m-0 font-display text-[20px] font-[640] tracking-[-0.025em] text-foreground">{title}</h2>
      {count ? <span className="text-[14px] text-text-3">{count}</span> : null}
      {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  )
}

/** 最近编辑 / 标签筛选共用的一行（参考稿 .doc-row） */
function DocRow({ title, sub, meta, onOpen }: { title: string; sub: string; meta: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid="doc-row"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 border-b border-border px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-surface-2"
    >
      <span className="grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-surface-2 text-text-3">
        <Icon name="file-text" className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-text-3">{sub}</span>
      </span>
      <span className="shrink-0 text-[13px] text-text-3">{meta}</span>
      <span className="shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100">
        <ArrowUpRightIcon />
      </span>
    </button>
  )
}

function StateCard({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div role="alert" className={`${CARD} px-9 py-12 text-center`}>
      <div className="text-[15px] font-medium text-foreground">{title}</div>
      {detail ? <div className="mt-1.5 break-all text-[13px] text-text-3">{detail}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

function HeroEmpty({ onNewArticle }: { onNewArticle: () => void }) {
  return (
    <div className={`${CARD} px-9 py-10`}>
      <div className="flex items-center gap-2 text-[14px] font-[550] text-accent-foreground">
        <Icon name="edit" className="size-4" />
        继续写作
      </div>
      <div className="mt-3.5 font-display text-[31px] font-[650] leading-[1.2] tracking-[-0.035em] text-foreground">
        还没有最近文档
      </div>
      <p className="mt-2.5 max-w-[720px] text-[15.5px] leading-[1.65] text-text-2">
        新建一篇文档开始写作，或从顶部的「导入」打开已有的 Markdown / 文档包。
      </p>
      <div className="mt-6 flex items-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={onNewArticle}>
          <Icon name="plus" className="size-[15px]" />
          新建文档
        </button>
      </div>
    </div>
  )
}

/** 空工作区：没有文档、没有最近记录时的整页空态 */
function EmptyLibrary({ onNewArticle, onImport }: { onNewArticle: () => void; onImport: () => void }) {
  return (
    <div className={`${CARD} px-9 py-16 text-center`} data-testid="library-empty">
      <div className="mx-auto grid size-12 place-items-center rounded-[14px] bg-primary-soft text-primary">
        <Icon name="book" className="size-6" />
      </div>
      <div className="mt-4 font-display text-[24px] font-[640] tracking-[-0.02em] text-foreground">还没有文档</div>
      <p className="mx-auto mt-2 max-w-[420px] text-[14px] leading-[1.6] text-text-2">
        新建一篇文档，或导入 Markdown / AstraNota 文档包，知识库会自动统计文档、文件夹与模块。
      </p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={onNewArticle}>
          <Icon name="plus" className="size-[15px]" />
          新建文档
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onImport}>
          <UploadIcon />
          导入
        </button>
      </div>
    </div>
  )
}

// ===== 页面组件 =====
export function LibraryPage({
  onNavigate,
  onOpenArticle,
  onNewArticle,
  refreshToken,
}: FocusPageProps) {
  const [tree, setTree] = useState<TreePayload | null>(null)
  const [recent, setRecent] = useState<RecentDocument[]>([])
  const [tags, setTags] = useState<TagInfo[]>([])
  const [hero, setHero] = useState<ArticleMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [recentError, setRecentError] = useState<string | null>(null)
  const [tagsError, setTagsError] = useState<string | null>(null)
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [tagFiles, setTagFiles] = useState<SearchResult[]>([])
  const [tagLoading, setTagLoading] = useState(false)
  const [tagFilesError, setTagFilesError] = useState<string | null>(null)
  const [clearingRecent, setClearingRecent] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ---------- 取数（页面自行取数；App 通过 refreshToken 通知文件系统变更） ----------
  const loadTree = useCallback(async () => {
    try {
      const payload = await getTree()
      setTree(payload)
      setTreeError(null)
    } catch (err) {
      setTreeError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRecent = useCallback(async () => {
    try {
      const payload = await getRecentDocuments()
      setRecent(Array.isArray(payload.documents) ? payload.documents : [])
      setRecentError(null)
    } catch (err) {
      setRecentError(errorMessage(err))
    }
  }, [])

  const loadTags = useCallback(async () => {
    try {
      const payload = await getTags()
      setTags(Array.isArray(payload.tags) ? payload.tags : [])
      setTagsError(null)
    } catch (err) {
      setTagsError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree, refreshToken])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent, refreshToken])

  useEffect(() => {
    void loadTags()
  }, [loadTags, refreshToken])

  const heroDoc = recent[0]
  const heroId = heroDoc?.rel_path

  // hero 摘要需要正文：对最近打开的那篇取一次 getArticle（失败只损失摘要，不阻塞页面）
  useEffect(() => {
    if (!heroId) {
      setHero(null)
      return
    }
    let alive = true
    setHero(null)
    getArticle(heroId)
      .then((article) => {
        if (alive) setHero(article)
      })
      .catch(() => {
        if (alive) setHero(null)
      })
    return () => {
      alive = false
    }
  }, [heroId, refreshToken])

  // 标签筛选：激活标签后取该标签下的文档（失败给可见提示）
  useEffect(() => {
    if (!activeTag) {
      setTagFiles([])
      setTagFilesError(null)
      setTagLoading(false)
      return
    }
    let alive = true
    setTagLoading(true)
    setTagFilesError(null)
    getFilesByTag(activeTag)
      .then((payload) => {
        if (alive) setTagFiles(Array.isArray(payload.files) ? payload.files : [])
      })
      .catch((err) => {
        if (alive) {
          setTagFiles([])
          setTagFilesError(errorMessage(err))
        }
      })
      .finally(() => {
        if (alive) setTagLoading(false)
      })
    return () => {
      alive = false
    }
  }, [activeTag, refreshToken])

  // ---------- 动作 ----------
  const handleImportFile = useCallback(
    async (file: File) => {
      setImporting(true)
      setImportError(null)
      try {
        const lower = file.name.toLowerCase()
        const result = lower.endsWith('.zip') ? await importPackage(file) : await importMarkdown(file)
        // 导入成功后刷新统计/最近，并打开新文档（App 切回编辑器页 + 自增 refreshToken）
        void loadTree()
        void loadRecent()
        onOpenArticle(result.id)
      } catch (err) {
        setImportError(`导入失败：${errorMessage(err)}`)
      } finally {
        setImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [loadRecent, loadTree, onOpenArticle],
  )

  const handleImportChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleImportFile(file)
  }

  // 「清空」= 原侧栏「最近更新 → 清空」语义；失败不产生未处理 rejection，给可见提示
  const handleClearRecent = useCallback(async () => {
    setClearingRecent(true)
    setRecentError(null)
    try {
      await clearRecentDocuments()
      await loadRecent()
    } catch (err) {
      setRecentError(`清空最近文档失败：${errorMessage(err)}`)
    } finally {
      setClearingRecent(false)
    }
  }, [loadRecent])

  // ---------- 派生数据 ----------
  const folders = useMemo(() => collectFolders(tree, recent), [tree, recent])
  const visibleRecent = useMemo(
    () => (activeFolder ? recent.filter((doc) => folderOf(doc.rel_path) === activeFolder) : recent),
    [recent, activeFolder],
  )
  const shownRecent = visibleRecent.slice(0, RECENT_LIMIT)
  const subtitle = tree
    ? `${tree.articles.length} 篇文档 · ${folders.length} 个文件夹 · ${tree.modules.length} 个模块`
    : undefined
  const isEmpty = tree !== null && tree.articles.length === 0 && recent.length === 0

  const heroTitle = hero?.title ?? heroDoc?.title ?? ''
  const heroExcerpt = hero ? toExcerpt(hero.content) : ''
  const heroTime = formatWhen(hero?.updated_at ?? heroDoc?.opened_at)
  const heroWords = hero?.word_count ?? (hero ? estimateWords(hero.content) : 0)
  const heroTags = hero?.tags ?? []

  const tocActions = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.zip"
        className="hidden"
        aria-label="选择要导入的 Markdown 或文档包"
        data-testid="library-import-input"
        onChange={handleImportChange}
      />
      <button
        type="button"
        className={BTN_SECONDARY}
        disabled={importing}
        onClick={() => {
          setImportError(null)
          fileInputRef.current?.click()
        }}
      >
        <UploadIcon />
        {importing ? '导入中…' : '导入'}
      </button>
      <button type="button" className={BTN_PRIMARY} onClick={onNewArticle}>
        <Icon name="plus" className="size-[15px]" />
        新建文档
      </button>
    </>
  )

  return (
    <PageShell title="知识库" subtitle={subtitle} actions={tocActions}>
      {treeError ? (
        <StateCard
          title="知识库加载失败"
          detail={treeError}
          action={
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => {
                setLoading(true)
                setTreeError(null)
                void loadTree()
              }}
            >
              重试
            </button>
          }
        />
      ) : loading && !tree ? (
        <div
          aria-busy="true"
          data-testid="library-loading"
          className={`${CARD} px-9 py-14 text-center text-[13px] text-text-3`}
        >
          正在加载知识库…
        </div>
      ) : isEmpty ? (
        <EmptyLibrary onNewArticle={onNewArticle} onImport={() => fileInputRef.current?.click()} />
      ) : (
        <>
          {importError ? (
            <div
              role="alert"
              className="mb-4 rounded-control border border-border bg-card px-3.5 py-2 text-[12.5px] text-danger"
            >
              {importError}
            </div>
          ) : null}

          {/* ② 继续写作 hero 卡（参考稿 .hero-card） */}
          {heroDoc ? (
            <div
              data-testid="library-hero"
              onClick={() => onOpenArticle(heroDoc.rel_path)}
              className="cursor-pointer rounded-[24px] bg-card px-9 py-8 shadow-float transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-overlay max-[760px]:p-6"
            >
              <div className="flex items-center gap-2 text-[14px] font-[550] text-accent-foreground">
                <Icon name="edit" className="size-4" />
                继续写作
              </div>
              <div className="mt-3.5 line-clamp-2 font-display text-[31px] font-[650] leading-[1.2] tracking-[-0.035em] text-foreground max-[760px]:text-[25px]">
                {heroTitle}
              </div>
              {heroExcerpt ? (
                <p className="mt-2.5 line-clamp-2 max-w-[720px] text-[15.5px] leading-[1.65] text-text-2">{heroExcerpt}</p>
              ) : null}
              <div className="mt-[26px] flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13.5px] text-text-3">
                {heroTime ? <span>{heroTime}</span> : null}
                {heroTime && heroWords > 0 ? <span className="text-line-2">·</span> : null}
                {heroWords > 0 ? <span>{heroWords.toLocaleString('zh-CN')} 字</span> : null}
                {heroTags.length > 0 ? <span className="text-line-2">·</span> : null}
                {heroTags.length > 0 ? <span>{heroTags.join(' / ')}</span> : null}
                <button
                  type="button"
                  className={`${BTN_PRIMARY} ml-auto`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenArticle(heroDoc.rel_path)
                  }}
                >
                  继续写作
                  <ArrowRightIcon />
                </button>
              </div>
            </div>
          ) : (
            <HeroEmpty onNewArticle={onNewArticle} />
          )}

          {/* ③ 最近编辑（参考稿 .section-head + .list-card / .doc-row） */}
          <SectionHead
            title={activeFolder ? `最近编辑 · ${activeFolder}` : '最近编辑'}
            count={`${shownRecent.length} 篇`}
            right={
              <>
                {activeFolder ? (
                  <button type="button" className={BTN_GHOST} onClick={() => setActiveFolder(null)}>
                    显示全部
                  </button>
                ) : (
                  <span className="text-[13.5px] text-text-3">按修改时间</span>
                )}
                <button
                  type="button"
                  className={BTN_GHOST}
                  disabled={clearingRecent || recent.length === 0}
                  onClick={() => void handleClearRecent()}
                >
                  {clearingRecent ? '清空中…' : '清空'}
                </button>
              </>
            }
          />
          <div className={CARD} data-testid="library-recent-card">
            {recentError ? (
              <div role="alert" className="px-5 py-6 text-center text-[13px]">
                <div className="text-danger">{recentError}</div>
                <button type="button" className={`${BTN_GHOST} mt-2`} onClick={() => void loadRecent()}>
                  重试
                </button>
              </div>
            ) : shownRecent.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-text-3">
                {activeFolder ? `「${activeFolder}」暂无最近编辑的文档` : '暂无最近编辑的文档'}
              </div>
            ) : (
              shownRecent.map((doc) => (
                <DocRow
                  key={doc.rel_path}
                  title={doc.title}
                  sub={folderLabelOf(doc.rel_path)}
                  meta={formatWhenCompact(doc.opened_at)}
                  onOpen={() => onOpenArticle(doc.rel_path)}
                />
              ))
            )}
          </div>

          {/* ④ 标签（保留原侧栏「标签」入口；点击就地筛选该标签下的文档） */}
          {tags.length > 0 || tagsError ? (
            <>
              <SectionHead title="标签" count={tags.length > 0 ? `${tags.length} 个` : undefined} />
              {tagsError ? (
                <div role="alert" className={`${CARD} px-5 py-6 text-center text-[13px] text-text-3`}>
                  标签加载失败：<span className="text-danger">{tagsError}</span>
                  <button type="button" className={`${BTN_GHOST} mt-2`} onClick={() => void loadTags()}>
                    重试
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <button
                      key={tag.name}
                      type="button"
                      data-testid="tag-chip"
                      aria-pressed={activeTag === tag.name}
                      className={activeTag === tag.name ? CHIP_ACTIVE : CHIP_IDLE}
                      onClick={() => setActiveTag((prev) => (prev === tag.name ? null : tag.name))}
                    >
                      {tag.name}
                      <span className="tabular-nums text-[12px] text-text-3">{tag.count}</span>
                    </button>
                  ))}
                </div>
              )}
              {activeTag ? (
                <div className={`${CARD} mt-3`} data-testid="library-tag-card">
                  {tagLoading ? (
                    <div className="px-5 py-6 text-center text-[13px] text-text-3">正在加载标签「{activeTag}」…</div>
                  ) : tagFilesError ? (
                    <div role="alert" className="px-5 py-6 text-center text-[13px] text-danger">
                      {tagFilesError}
                    </div>
                  ) : tagFiles.length === 0 ? (
                    <div className="px-5 py-8 text-center text-[13px] text-text-3">该标签下暂无文档</div>
                  ) : (
                    tagFiles.map((file) => (
                      <DocRow
                        key={`${file.kind}:${file.rel_path}`}
                        title={file.title}
                        sub={folderLabelOf(file.rel_path)}
                        meta={formatWhenCompact(file.updated_at)}
                        onOpen={() => onOpenArticle(file.rel_path)}
                      />
                    ))
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          {/* ⑤ 文件夹（由文件树派生；点击筛选最近编辑列表 —— task-9 可选交互） */}
          <SectionHead
            title="文件夹"
            count={`${folders.length} 个`}
            right={
              <button type="button" className={BTN_GHOST} onClick={() => onNavigate('search')}>
                全部文档
              </button>
            }
          />
          {folders.length === 0 ? (
            <div className={`${CARD} px-5 py-8 text-center text-[13px] text-text-3`}>
              暂无文件夹；文档都在 Articles 根目录下。
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3.5 max-[1100px]:grid-cols-2 max-[760px]:grid-cols-1">
              {folders.map((folder) => {
                const active = activeFolder === folder.name
                return (
                  <button
                    key={folder.name}
                    type="button"
                    data-testid="folder-card"
                    aria-pressed={active}
                    className={`${FOLDER_CARD}${active ? ' ring-2 ring-primary' : ''}`}
                    onClick={() => setActiveFolder((prev) => (prev === folder.name ? null : folder.name))}
                  >
                    <span className="grid size-[42px] place-items-center rounded-[12px] bg-primary-soft text-primary">
                      <Icon name="folder" className="size-5" />
                    </span>
                    <span className="mt-3.5 block text-[15.5px] font-semibold text-foreground">{folder.name}</span>
                    <span className="mt-[3px] block truncate text-[13px] text-text-3">
                      {folder.count} 篇{folder.latestTitle ? ` · ${folder.latestTitle}` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
