/** 左侧栏（Phase 4 重构）：
 * - 最近文档（4.8）：软件配置存储，点击快速重新打开
 * - 标签（4.5）：标签列表 + 点击筛选
 * - 文件树（4.2）：文件夹/文档 新建、重命名、删除（二次确认）、移动
 * - 模块 / 附件：点击打开
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  attachmentUrl,
  clearRecentDocuments,
  createDocIn,
  createFolder,
  deleteArticle,
  deleteFolder,
  getFilesByTag,
  getRecentDocuments,
  getTags,
  getTree,
  movePath,
  rebuildIndex,
  renameDoc,
  renameFolder,
  search as searchFiles,
} from '../../api/client'
import type { FsMutation } from '../../App'
import type {
  RecentDocument,
  SearchResult,
  TagInfo,
  TreePayload,
} from '../../types'
import { buildFileTree, type TreeNode } from '../../utils/tree'

interface Props {
  activeId: string | null
  onOpenArticle: (id: string) => void
  refreshKey?: number
  onFsMutation?: (m: FsMutation) => void
}

interface CtxMenu {
  x: number
  y: number
  node: TreeNode
}

const TOP_ARTICLES = 'Articles'

export default function LeftSidebar({ activeId, onOpenArticle, refreshKey = 0, onFsMutation }: Props) {
  const [tree, setTree] = useState<TreePayload | null>(null)
  // P2-8：文件树加载失败不再是「空」，而是明确错误提示
  const [treeError, setTreeError] = useState(false)
  const [recent, setRecent] = useState<RecentDocument[]>([])
  const [tags, setTags] = useState<TagInfo[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [tagFiles, setTagFiles] = useState<SearchResult[]>([])
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['Articles', 'Modules']))
  // Phase 6：全局搜索
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const searchTimer = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // ---------- 数据加载 ----------
  const loadTree = useCallback(async () => {
    setTreeError(false)
    try {
      setTree(await getTree())
    } catch {
      // P2-8：workspace 未打开等情况由 App 兜底；此处区分「加载失败」而非显示为空
      setTreeError(true)
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree, refreshKey])

  useEffect(() => {
    getRecentDocuments()
      .then((r) => setRecent(r.documents))
      .catch(() => setRecent([]))
    getTags()
      .then((r) => setTags(r.tags))
      .catch(() => setTags([]))
  }, [refreshKey])

  const refreshAll = useCallback(() => {
    void loadTree()
    getRecentDocuments().then((r) => setRecent(r.documents)).catch(() => undefined)
    getTags().then((r) => setTags(r.tags)).catch(() => undefined)
  }, [loadTree])

  // ---------- 全局搜索（Phase 6.1） ----------
  const doSearch = useCallback(async (q: string) => {
    const query = q.trim()
    if (!query) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const payload = await searchFiles(query)
      setSearchResults(payload.results)
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  // 输入防抖（300ms），回车立即确认
  const handleSearchChange = useCallback(
    (v: string) => {
      setSearchQ(v)
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
      searchTimer.current = window.setTimeout(() => void doSearch(v), 300)
    },
    [doSearch],
  )

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
      void doSearch(searchQ)
    },
    [doSearch, searchQ],
  )

  const handleRebuildIndex = useCallback(async () => {
    if (rebuilding) return
    setRebuilding(true)
    try {
      const payload = await rebuildIndex()
      window.alert(
        `索引重建完成：文档 ${payload.stats.document} · 模块 ${payload.stats.module} · 附件 ${payload.stats.attachment}`,
      )
      if (searchQ.trim()) void doSearch(searchQ)
    } catch (e) {
      window.alert(`重建索引失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRebuilding(false)
    }
  }, [rebuilding, searchQ, doSearch])

  // 卸载时清理防抖定时器
  useEffect(() => {
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [])

  // ---------- 标签筛选 ----------
  const selectTag = useCallback(async (tag: string) => {
    setActiveTag(tag)
    try {
      const payload = await getFilesByTag(tag)
      setTagFiles(payload.files)
    } catch {
      setTagFiles([])
    }
  }, [])

  // ---------- 文件系统操作（Phase 4.2） ----------
  const notify = useCallback(
    (m: FsMutation) => {
      refreshAll()
      onFsMutation?.(m)
    },
    [refreshAll, onFsMutation],
  )

  const confirmDelete = useCallback((name: string): boolean => {
    if (!window.confirm(`确认删除「${name}」？`)) return false
    return window.confirm(`再次确认：删除「${name}」后无法恢复，是否继续？`)
  }, [])

  const handleNewDoc = useCallback(
    async (dir: string) => {
      const title = window.prompt('文档标题')
      if (!title) return
      try {
        await createDocIn(dir, title)
        notify({ type: 'create' })
      } catch (e) {
        window.alert(String(e))
      }
    },
    [notify],
  )

  const handleNewFolder = useCallback(
    async (parent: string) => {
      const name = window.prompt('文件夹名称')
      if (!name) return
      try {
        await createFolder(parent === TOP_ARTICLES ? `${TOP_ARTICLES}/${name}` : `${parent}/${name}`)
        notify({ type: 'create' })
      } catch (e) {
        window.alert(String(e))
      }
    },
    [notify],
  )

  const handleRename = useCallback(
    async (node: TreeNode) => {
      const newName = window.prompt('新名称', node.name)
      if (!newName || newName === node.name) return
      try {
        const result =
          node.type === 'folder'
            ? await renameFolder(node.relPath, newName)
            : await renameDoc(node.relPath, newName)
        notify({ type: 'rename', from: result.from, to: result.to })
      } catch (e) {
        window.alert(String(e))
      }
    },
    [notify],
  )

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      if (!confirmDelete(node.name)) return
      try {
        if (node.type === 'folder') {
          await deleteFolder(node.relPath)
        } else {
          await deleteArticle(node.relPath)
        }
        notify({ type: 'delete', from: node.relPath })
      } catch (e) {
        window.alert(String(e))
      }
    },
    [confirmDelete, notify],
  )

  const handleMove = useCallback(
    async (node: TreeNode) => {
      const target = window.prompt(
        '移动到哪个目录？（相对工作区的完整目录路径，如 Articles/归档）',
        TOP_ARTICLES,
      )
      if (!target) return
      const dst = `${target.trim().replace(/\/+$/, '')}/${node.name}`
      try {
        const result = await movePath(node.relPath, dst)
        notify({ type: 'move', from: result.from, to: result.to })
      } catch (e) {
        window.alert(String(e))
      }
    },
    [notify],
  )

  const handleOpenFromTree = useCallback(
    (node: TreeNode) => {
      if (node.type === 'folder') return
      onOpenArticle(node.relPath)
    },
    [onOpenArticle],
  )

  // ---------- 上下文菜单 ----------
  const openCtx = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, node })
  }, [])

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [ctx])

  // ---------- 折叠 ----------
  const toggle = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }, [])

  // ---------- 渲染：文件树 ----------
  const renderNode = (node: TreeNode, depth: number) => {
    const indent = { paddingLeft: `${8 + depth * 14}px` }
    const isOpen = expanded.has(node.relPath)
    if (node.type === 'folder') {
      return (
        <div key={node.relPath}>
          <div
            className="group flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-[12px] text-gray-700 hover:bg-gray-100"
            style={indent}
            onClick={() => toggle(node.relPath)}
            onContextMenu={(e) => openCtx(e, node)}
          >
            <span className="w-3 text-[10px] text-gray-400">{isOpen ? '▾' : '▸'}</span>
            <span className="flex-1 truncate">{node.name}</span>
            <span className="hidden gap-0.5 group-hover:flex">
              <button
                title="新建文档"
                className="rounded px-1 text-[11px] text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleNewDoc(node.relPath)
                }}
              >
                ＋
              </button>
              <button
                title="新建文件夹"
                className="rounded px-1 text-[11px] text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleNewFolder(node.relPath)
                }}
              >
                ▤
              </button>
            </span>
          </div>
          {isOpen && node.children && (
            <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>
          )}
        </div>
      )
    }
    const active = activeId === node.relPath
    return (
      <div
        key={node.relPath}
        className={`flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-[12px] hover:bg-gray-100 ${
          active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700'
        }`}
        style={indent}
        onClick={() => handleOpenFromTree(node)}
        onContextMenu={(e) => openCtx(e, node)}
      >
        <span className="w-3" />
        <span className="flex-1 truncate">{node.name}</span>
      </div>
    )
  }

  // P3-15: buildFileTree 依赖树数据 memo 化——每次 App 因击键重渲染时树数据未变，
  // 复用上次结果，避免每次击键都重建文件树（性能项）。
  const articlesTree = useMemo(() => buildFileTree(tree?.articles ?? []), [tree?.articles])
  // Phase 5：模块同样按文件夹分类展示（Modules/Math/Definition.md -> Math/Definition）
  const modulesTree = useMemo(() => buildFileTree(tree?.modules ?? []), [tree?.modules])

  // ---------- 渲染 ----------
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex-1 overflow-y-auto">
        {/* 全局搜索（Phase 6.1） */}
        <Section
          title="搜索"
          action={
            <button
              className="text-[11px] text-gray-400 hover:text-blue-600"
              title="重建全文索引（索引可随时从 Markdown 重建）"
              onClick={() => void handleRebuildIndex()}
              disabled={rebuilding}
            >
              {rebuilding ? '重建中…' : '重建索引'}
            </button>
          }
        >
          <div className="px-1.5">
            <input
              value={searchQ}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索文档内容…（回车确认）"
              className="w-full rounded border border-gray-200 px-2 py-1 text-[12px] text-gray-700 outline-none placeholder:text-gray-300 focus:border-blue-300"
            />
          </div>
          {searching ? (
            <Empty text="搜索中…" />
          ) : searchResults !== null && searchResults.length === 0 ? (
            <Empty text="无匹配结果" />
          ) : null}
          {searchResults && searchResults.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {searchResults.slice(0, 20).map((r) => (
                <button
                  key={r.rel_path}
                  className={`block w-full rounded px-2 py-1 text-left hover:bg-gray-100 ${
                    activeId === r.rel_path ? 'bg-blue-50' : ''
                  }`}
                  title={r.rel_path}
                  onClick={() => onOpenArticle(r.rel_path)}
                >
                  <span className="flex items-center gap-1">
                    <span className="flex-1 truncate text-[12px] text-gray-700">
                      {r.title || r.rel_path}
                    </span>
                    <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] text-gray-400">
                      {kindLabel(r.kind)}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-gray-400">{r.rel_path}</span>
                  {r.snippet ? (
                    <span className="block truncate text-[11px] text-gray-500">
                      {highlightSnippet(r.snippet)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </Section>

        {/* 最近文档（Phase 4.8） */}
        <Section title="最近" action={
          recent.length > 0 ? (
            <button
              className="text-[11px] text-gray-400 hover:text-gray-600"
              onClick={() => {
                void clearRecentDocuments().then(refreshAll)
              }}
            >
              清空
            </button>
          ) : undefined
        }>
          {recent.length === 0 && <Empty text="暂无最近文档" />}
          {recent.slice(0, 8).map((d) => (
            <button
              key={d.rel_path}
              className={`block w-full truncate rounded px-2 py-1 text-left text-[12px] hover:bg-gray-100 ${
                activeId === d.rel_path ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700'
              }`}
              title={d.rel_path}
              onClick={() => onOpenArticle(d.rel_path)}
            >
              {d.title}
            </button>
          ))}
        </Section>

        {/* 标签（Phase 4.5） */}
        <Section title="标签">
          {tags.length === 0 && <Empty text="暂无标签" />}
          {tags.slice(0, 30).map((t) => (
            <button
              key={t.name}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] hover:bg-gray-100 ${
                activeTag === t.name ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
              }`}
              onClick={() => (activeTag === t.name ? setActiveTag(null) : void selectTag(t.name))}
            >
              <span className="flex-1 truncate">#{t.name}</span>
              <span className="rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-400">{t.count}</span>
            </button>
          ))}
        </Section>

        {/* 标签筛选结果 */}
        {activeTag && (
          <Section title={`筛选：#${activeTag}`} action={
            <button className="text-[11px] text-gray-400 hover:text-gray-600" onClick={() => setActiveTag(null)}>
              ✕
            </button>
          }>
            {tagFiles.length === 0 && <Empty text="无匹配文档" />}
            {tagFiles.map((f) => (
              <button
                key={f.rel_path}
                className={`block w-full truncate rounded px-2 py-1 text-left text-[12px] hover:bg-gray-100 ${
                  activeId === f.rel_path ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700'
                }`}
                title={f.rel_path}
                onClick={() => onOpenArticle(f.rel_path)}
              >
                {f.title || f.rel_path}
              </button>
            ))}
          </Section>
        )}

        {/* 文件树（Phase 4.2） */}
        <Section title="文章" action={
          <button
            className="text-[11px] text-gray-400 hover:text-blue-600"
            title="新建文档"
            onClick={() => void handleNewDoc(TOP_ARTICLES)}
          >
            ＋ 新建
          </button>
        }>
          {treeError ? (
            <LoadError onRetry={() => void loadTree()} />
          ) : articlesTree.length === 0 ? (
            <Empty text="暂无文章" />
          ) : (
            articlesTree.map((n) => renderNode(n, 0))
          )}
        </Section>

        {/* 模块（Phase 5：文件夹分类 + 文件树管理，双击/单击在编辑器打开） */}
        <Section title="模块" action={
          <button
            className="text-[11px] text-gray-400 hover:text-blue-600"
            title="新建模块"
            onClick={() => void handleNewDoc('Modules')}
          >
            ＋ 新建
          </button>
        }>
          {treeError ? (
            <LoadError onRetry={() => void loadTree()} />
          ) : modulesTree.length === 0 ? (
            <Empty text="暂无模块" />
          ) : (
            modulesTree.map((n) => renderNode(n, 0))
          )}
        </Section>

        {/* 附件（点击打开） */}
        <Section title="附件">
          {!tree?.attachments || Object.values(tree.attachments).every((v) => v.length === 0) ? (
            <Empty text="暂无附件" />
          ) : (
            ['images', 'videos', 'files'].map((cat) =>
              (tree?.attachments[cat as keyof typeof tree.attachments] ?? []).map((a) => (
                <a
                  key={a}
                  href={attachmentUrl(a)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate rounded px-2 py-1 text-left text-[12px] text-gray-600 hover:bg-gray-100"
                  title={a}
                >
                  {a.replace(/^Attachments\//, '')}
                </a>
              )),
            )
          )}
        </Section>
      </div>

      {/* 上下文菜单 */}
      {ctx && (
        <div
          ref={menuRef}
          className="fixed z-50 w-44 rounded-md border border-gray-200 bg-white py-1 text-xs shadow-lg"
          style={{ left: Math.min(ctx.x, window.innerWidth - 190), top: Math.min(ctx.y, window.innerHeight - 220) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-gray-100 px-3 py-1 text-[11px] text-gray-400">
            {ctx.node.type === 'folder' ? `目录：${ctx.node.relPath}` : ctx.node.relPath}
          </div>
          {ctx.node.type === 'folder' && (
            <>
              <MenuItem label="新建文档" onClick={() => { setCtx(null); void handleNewDoc(ctx.node.relPath) }} />
              <MenuItem label="新建文件夹" onClick={() => { setCtx(null); void handleNewFolder(ctx.node.relPath) }} />
              <div className="my-1 border-t border-gray-100" />
            </>
          )}
          <MenuItem label="重命名" onClick={() => { setCtx(null); void handleRename(ctx.node) }} />
          <MenuItem label="移动到…" onClick={() => { setCtx(null); void handleMove(ctx.node) }} />
          <div className="my-1 border-t border-gray-100" />
          <button
            className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              const node = ctx.node
              setCtx(null)
              void handleDelete(node)
            }}
          >
            删除…
          </button>
        </div>
      )}
    </aside>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-gray-100 py-2">
      <div className="mb-1 flex items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</span>
        {action}
      </div>
      <div className="px-1.5">{children}</div>
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50" onClick={onClick}>
      {label}
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="px-3 py-1 text-[11px] text-gray-300">{text}</div>
}

/** P2-8：加载失败不再当作「空」显示，而是给出明确错误 + 重试入口 */
function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-2 py-1 text-[11px] text-rose-500">
      加载失败，请重试
      <button
        type="button"
        onClick={onRetry}
        className="ml-1 text-blue-600 hover:underline"
      >
        重试
      </button>
    </div>
  )
}

function kindLabel(kind: string): string {
  if (kind === 'module') return '模块'
  if (kind === 'attachment') return '附件'
  return '文档'
}

/** 后端 snippet 用 `[` `]` 包裹匹配关键词（见 store/db.py search），此处拆分为高亮片段 */
function highlightSnippet(snippet: string) {
  const parts = snippet.split(/(\[[^\]]*\])/g)
  return parts.map((p, i) =>
    p.startsWith('[') && p.endsWith(']') && p.length > 2 ? (
      <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-inherit">
        {p.slice(1, -1)}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}
