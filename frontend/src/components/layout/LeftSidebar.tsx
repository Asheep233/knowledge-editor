/** 左侧栏（Phase 4 重构）：
 * - 最近文档（4.8）：软件配置存储，点击快速重新打开
 * - 标签（4.5）：标签列表 + 点击筛选
 * - 文件树（4.2）：文件夹/文档 新建、重命名、删除（文档=单次确认+可在回收站恢复；文件夹=二次确认）、移动
 * - 模块：点击打开
 * - 附件（task-12 迁入，task-22 默认收起）：可折叠小节（默认收起，收起态只留表头）——行点击就地展开「附属情况与附属记录」
 *   （全部 referenced_by 逐条可跳转；未引用显示自身详情）+ 行右侧「打开文件」独立 <a> + 孤儿附件手动删除。
 *   数据源 = listAttachments() / listOrphans()（不再依赖 tree.attachments）。
 * - 回收站（MVP）：启用导航项，恢复 / 彻底删除 / 清空（契约 docs/design-trash-mvp.md）
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  attachmentUrl,
  clearRecentDocuments,
  createDocIn,
  createFolder,
  deleteArticle,
  deleteAttachment,
  deleteFolder,
  getFilesByTag,
  getRecentDocuments,
  getTags,
  getTree,
  listAttachments,
  listModules,
  listOrphans,
  movePath,
  rebuildIndex,
  renameDoc,
  renameFolder,
  search as searchFiles,
} from '../../api/client'
import type { FsMutation } from '../../App'
import type {
  AttachmentItem,
  OrphanItem,
  RecentDocument,
  SearchResult,
  TagInfo,
  TreePayload,
} from '../../types'
import { buildFileTree, type TreeNode } from '../../utils/tree'
import { registerActionHandlers } from '../../state/shortcuts'
import { Icon } from '../icons'
import TrashPanel from '../trash/TrashPanel'
import { askConfirm, askPrompt } from '../common/PromptDialog'
import iconLogoLight from '../../assets/astranota/astranota-icon-light-256.png'
import iconLogoDark from '../../assets/astranota/astranota-icon-dark-256.png'

interface Props {
  activeId: string | null
  onOpenArticle: (id: string) => void
  refreshKey?: number
  onFsMutation?: (m: FsMutation) => void
  /** R1-B：文件系统变更（重命名/移动/删除）执行前的钩子——返回 false 中止操作。
   * 用于先 flush 当前文档未决保存（变更后旧路径已不存在，flush 将 404）。 */
  onBeforeFsMutation?: (node: TreeNode) => Promise<boolean>
  /** 打开设置面板（DataSovereigntyFooter「设置」入口，handoff §3.2 btn-settings） */
  onOpenSettings?: () => void
  /** workspace 根路径（Footer mono 展示） */
  workspaceRoot?: string | null
  /** 回收站恢复成功（App 侧刷新文件树；恢复的是删除前的当前文档时重新打开） */
  onTrashRestored?: (restoredTo: string) => void
}

interface CtxMenu {
  x: number
  y: number
  node: TreeNode
}

const TOP_ARTICLES = 'Articles'
const TOP_MODULES = 'Modules'

function fmtSize(n?: number): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

/** QuickNav 导航项（参考稿：激活态 = sidebar-primary 底白字） */
function NavItem({
  active,
  disabled,
  title,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  title?: string
  icon: ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={[
        'flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
        active
          ? ''
          : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
      style={
        active
          ? { backgroundColor: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)' }
          : { color: 'var(--sidebar-foreground)' }
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export default function LeftSidebar({
  activeId,
  onOpenArticle,
  refreshKey = 0,
  onFsMutation,
  onBeforeFsMutation,
  onOpenSettings,
  workspaceRoot,
  onTrashRestored,
}: Props) {
  const [tree, setTree] = useState<TreePayload | null>(null)
  // P2-8：文件树加载失败不再是「空」，而是明确错误提示
  const [treeError, setTreeError] = useState(false)
  const [recent, setRecent] = useState<RecentDocument[]>([])
  const [tags, setTags] = useState<TagInfo[]>([])
  // 附件区（task-12：附件能力的家）——数据源为 listAttachments()/listOrphans()，不依赖 tree.attachments
  // task-22 裁决：默认收起（承接「可收起、别占太多空间」；收起态只留表头一行）
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [orphans, setOrphans] = useState<OrphanItem[]>([])
  const [attachError, setAttachError] = useState(false)
  // 已就地展开「附属情况与附属记录」的附件（同时只展开一行，点另一行 = 切换）
  const [expandedAttach, setExpandedAttach] = useState<string | null>(null)
  // 正在删除的孤儿附件路径（删除中禁用按钮，防止重复提交）
  const [deletingAttach, setDeletingAttach] = useState<string | null>(null)
  // 模块版本号（已批准 API 变更：GET /api/modules 带 version），供模块树行 hover 标题/小字
  const [moduleVersions, setModuleVersions] = useState<Record<string, number>>({})
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [tagFiles, setTagFiles] = useState<SearchResult[]>([])
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['Articles', 'Modules']))
  // Phase 6：全局搜索
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  // 搜索胶囊聚焦态：React state 驱动（inline style 优先级 > 工具类，
  // focus-within:ring-ring 会因 inline borderColor 被压制——不用工具类方案）
  const [searchFocused, setSearchFocused] = useState(false)
  // QuickNav 当前激活（参考稿：全部文档 = sidebar-primary 底白字，aria-current=page）
  const [nav, setNav] = useState<'all' | 'recent' | 'tags' | 'trash'>('all')
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Ctrl/Cmd+K：聚焦全局搜索（handoff §6）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // task-35（ADP-1 收口）：自定义快捷键 —— 本组件内部的两个动作注册为**真实闭包**
  // （搜索框 ref 与 nav 状态都封在本组件内，App 层拿不到；不改任何 UI/既有行为）。
  // `app.search.focus` 与上面的 Ctrl+K 走同一行代码；`app.trash.open` 即切到回收站视图。
  useEffect(() => {
    return registerActionHandlers({
      'app.search.focus': () => searchRef.current?.focus(),
      'app.trash.open': () => setNav('trash'),
    })
  }, [])
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
    // 模块版本号（已批准 API 变更；失败静默，不影响列表）
    listModules()
      .then((r) => setModuleVersions(Object.fromEntries(r.modules.map((m) => [m.path, m.version ?? 1]))))
      .catch(() => setModuleVersions({}))
  }, [refreshKey, workspaceRoot])

  const refreshAll = useCallback(() => {
    void loadTree()
    getRecentDocuments().then((r) => setRecent(r.documents)).catch(() => undefined)
    getTags().then((r) => setTags(r.tags)).catch(() => undefined)
  }, [loadTree])

  // ---------- 附件加载（task-12：附件列表 + 孤儿检测，仅手动删除） ----------
  const loadAttachments = useCallback(async () => {
    setAttachError(false)
    try {
      const [a, o] = await Promise.all([listAttachments(), listOrphans()])
      setAttachments(a.attachments)
      setOrphans(o.orphans)
    } catch {
      // 与文件树一致：加载失败给可见错误 + 重试入口，不当作「空」
      setAttachError(true)
    }
  }, [])

  useEffect(() => {
    void loadAttachments()
  }, [loadAttachments, refreshKey])

  const toggleAttachmentDetail = useCallback((rel: string) => {
    setExpandedAttach((prev) => (prev === rel ? null : rel))
  }, [])

  // v0.6.1 约束：孤儿附件仅手动删除、绝不自动。显式确认后 DELETE（后端会二次校验孤儿身份）
  const handleDeleteOrphan = useCallback(
    async (o: OrphanItem) => {
      if (!(await askConfirm(`确定删除孤儿附件「${o.name}」吗？\n删除后不可恢复。`))) return
      setDeletingAttach(o.path)
      try {
        await deleteAttachment(o.path)
        await loadAttachments()
      } catch (e) {
        window.alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setDeletingAttach(null)
      }
    },
    [loadAttachments],
  )

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

  // 契约 §7：文档删除改为软删（进回收站）→ 单次确认且文案含「可在回收站恢复」；
  // 文件夹删除仍为硬删（MVP 范围仅文档）→ 保留原「无法恢复」双重确认文案。
  // ⚠️ 2026-09-15：原用 `window.confirm` —— Tauri 把它替换成 async（恒返回 Promise=truthy），
  // 导致 `if (!window.confirm(...))` 永为假、**确认被静默绕过**。改用自绘 askConfirm（必须 await）。
  const confirmDeleteDoc = useCallback(async (name: string): Promise<boolean> => {
    return askConfirm(`确认删除「${name}」？\n删除后可在回收站恢复。`, {
      confirmText: '删除',
      danger: true,
    })
  }, [])

  const confirmDeleteHard = useCallback(async (name: string): Promise<boolean> => {
    if (!(await askConfirm(`确认删除「${name}」？`, { confirmText: '删除', danger: true }))) return false
    return askConfirm(`再次确认：删除「${name}」后**无法恢复**，是否继续？`, {
      confirmText: '永久删除',
      danger: true,
    })
  }, [])

  const handleNewDoc = useCallback(
    async (dir: string) => {
      const title = await askPrompt('文档标题')
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
      const name = await askPrompt('文件夹名称')
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
      const newName = await askPrompt('新名称', node.name)
      if (!newName || newName === node.name) return
      // R1-B：变更前 flush 未决保存（当前文档受此操作影响时）
      if (onBeforeFsMutation && !(await onBeforeFsMutation(node))) return
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
    [notify, onBeforeFsMutation],
  )

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      const confirmed =
        node.type === 'folder' ? await confirmDeleteHard(node.name) : await confirmDeleteDoc(node.name)
      if (!confirmed) return
      // R1-B：删除前 flush 未决保存（避免删除后的迟到保存 404 假警报/孤儿恢复点）
      if (onBeforeFsMutation && !(await onBeforeFsMutation(node))) return
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
    [confirmDeleteDoc, confirmDeleteHard, notify, onBeforeFsMutation],
  )

  const handleMove = useCallback(
    async (node: TreeNode) => {
      const target = await askPrompt(
        '移动到哪个目录？（相对工作区的完整目录路径，如 Articles/归档）',
        TOP_ARTICLES,
      )
      if (!target) return
      const dst = `${target.trim().replace(/\/+$/, '')}/${node.name}`
      // R1-B：移动前 flush 未决保存
      if (onBeforeFsMutation && !(await onBeforeFsMutation(node))) return
      try {
        const result = await movePath(node.relPath, dst)
        notify({ type: 'move', from: result.from, to: result.to })
      } catch (e) {
        window.alert(String(e))
      }
    },
    [notify, onBeforeFsMutation],
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
  /** 子树文件数（参考稿文件夹行尾部计数） */
  const countChildren = (n: TreeNode): number => {
    let c = 0
    for (const child of n.children ?? []) c += child.type === 'file' ? 1 : countChildren(child)
    return c
  }
  const renderNode = (node: TreeNode, depth: number) => {
    const indent = { paddingLeft: `${6 + depth * 14}px` }
    const isOpen = expanded.has(node.relPath)
    if (node.type === 'folder') {
      const count = countChildren(node)
      return (
        <div key={node.relPath}>
          <div
            className="group flex h-[30px] cursor-pointer items-center gap-2 rounded-[6px] px-1 py-0 text-[13px] text-foreground hover:bg-accent"
            style={indent}
            onClick={() => toggle(node.relPath)}
            onContextMenu={(e) => openCtx(e, node)}
          >
            <span className="w-3.5 text-muted-foreground">{isOpen ? <Icon name="chevron-down" className="size-3.5" /> : <Icon name="chevron-right" className="size-3.5" />}</span>
            <Icon name={isOpen ? 'folder' : 'folder'} className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{node.name}</span>
            {count > 0 ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>
            ) : null}
            <span className="hidden gap-0.5 group-hover:flex">
              <button
                title="新建文档"
                className="rounded px-1 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleNewDoc(node.relPath)
                }}
              >
                <Icon name="plus" className="size-3" />
              </button>
              <button
                title="新建文件夹"
                className="rounded px-1 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleNewFolder(node.relPath)
                }}
              >
                <Icon name="folder-plus" className="size-3" />
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
    const ver = node.relPath.startsWith('Modules/') ? moduleVersions[node.relPath] : undefined
    return (
      <div
        key={node.relPath}
        className={`flex h-[30px] cursor-pointer items-center gap-2 rounded-[6px] px-1 py-0 text-[13px] hover:bg-accent ${
          active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-foreground'
        }`}
        style={indent}
        onClick={() => handleOpenFromTree(node)}
        onContextMenu={(e) => openCtx(e, node)}
        title={node.relPath.startsWith('Modules/') ? `${node.relPath}（v${ver ?? '?'}）` : node.relPath}
      >
        <span className="w-3.5" />
        {node.relPath.startsWith('Modules/') ? (
          <Icon name="box" className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Icon name="file-text" className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 truncate">{node.name}</span>
        {ver != null ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">v{ver}</span>
        ) : null}
      </div>
    )
  }

  // P3-15: buildFileTree 依赖树数据 memo 化——每次 App 因击键重渲染时树数据未变，
  // 复用上次结果，避免每次击键都重建文件树（性能项）。
  // 视觉层级：文章区根节点「Articles」与区头语义重复——若唯一根为 Articles 则直接展示其子级，
  // 使新建文件夹/文档与区内容并列（用户反馈：新建目录应出现在文章区顶层）
  const articlesTree = useMemo(() => {
    const t = buildFileTree(tree?.articles ?? [])
    if (t.length === 1 && t[0].name === TOP_ARTICLES && t[0].children) return t[0].children
    return t
  }, [tree?.articles])
  // Phase 5：模块同样按文件夹分类展示（Modules/Math/Definition.md -> Math/Definition）
  const modulesTree = useMemo(() => {
    const t = buildFileTree(tree?.modules ?? [])
    if (t.length === 1 && t[0].name === TOP_MODULES && t[0].children) return t[0].children
    return t
  }, [tree?.modules])

  // ---------- 渲染 ----------
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* BrandBlock（handoff §3.2：KE 方块 + 名称/Alpha 两行） */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-3">
        <span className="relative block size-8 shrink-0 overflow-hidden rounded-[8px]">
          <img src={iconLogoLight} alt="AstraNota" className="an-logo-light absolute inset-0 size-full" draggable={false} />
          <img src={iconLogoDark} alt="AstraNota" className="an-logo-dark absolute inset-0 size-full" draggable={false} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold leading-tight" style={{ color: 'var(--sidebar-foreground)' }}>
            AstraNota
          </div>
          <div className="text-[11px] leading-tight" style={{ color: 'var(--muted-foreground)' }}>
            Alpha
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* GlobalSearchBox（handoff §3.2：胶囊搜索 + Ctrl K 提示 + 重建按钮） */}
        <div className="px-3 pb-2 pt-2">
          <div className="relative">
            <div
              className="flex h-9 w-full items-center gap-2 rounded-[999px] border px-2.5 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none"
              style={{
                backgroundColor: 'var(--popover)',
                borderColor: searchFocused ? 'var(--ring)' : 'var(--border)',
                boxShadow: searchFocused ? 'inset 0 0 0 1px var(--ring)' : 'none',
              }}
            >
              <Icon name="search" className="size-4 shrink-0 text-muted-foreground" />
              <input
                id="ke-global-search"
                ref={searchRef}
                value={searchQ}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="搜索全部文档…"
                className="h-full w-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none!"
                style={{ color: 'var(--foreground)' }}
              />
              <span className="shrink-0 rounded-[4px] border px-1 text-[10px] leading-4 text-muted-foreground" style={{ borderColor: 'var(--border)', fontFamily: 'var(--font-mono)' }}>
                Ctrl&nbsp;K
              </span>
              <button
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
                style={{ color: 'var(--muted-foreground)' }}
                title={rebuilding ? '重建中…' : '重建全文索引'}
                aria-label="重建全文索引"
                onClick={() => void handleRebuildIndex()}
                disabled={rebuilding}
              >
                <Icon name="rotate-ccw" className="size-3.5" />
              </button>
            </div>
          </div>
          {searching ? (
            <Empty text="搜索中…" />
          ) : searchResults !== null && searchResults.length === 0 ? (
            <Empty text="无匹配结果" />
          ) : null}
          {/* QuickNav（handoff §3.2：全部文档[默认激活] / 最近更新 / 标签 / 回收站） */}
          <nav aria-label="快捷访问" className="pt-2">
            <div className="flex flex-col gap-[6px]">
              <NavItem
                active={nav === 'all'}
                icon={<Icon name="file-text" className="size-4" />}
                label="全部文档"
                onClick={() => { setNav('all'); setActiveTag(null) }}
              />
              <NavItem
                active={nav === 'recent'}
                icon={<Icon name="history" className="size-4" />}
                label="最近更新"
                onClick={() => setNav('recent')}
              />
              <NavItem
                active={nav === 'tags'}
                icon={<Icon name="tags" className="size-4" />}
                label="标签"
                onClick={() => setNav('tags')}
              />
              <NavItem
                active={nav === 'trash'}
                icon={<Icon name="trash" className="size-4" />}
                label="回收站"
                title="回收站：删除的文档可在此恢复"
                onClick={() => setNav('trash')}
              />
            </div>
          </nav>
          {searchResults && searchResults.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {searchResults.slice(0, 20).map((r) => (
                <button
                  key={r.rel_path}
                  className={`block w-full rounded px-2 py-1 text-left hover:bg-accent ${
                    activeId === r.rel_path ? 'bg-sidebar-accent' : ''
                  }`}
                  title={r.rel_path}
                  onClick={() => onOpenArticle(r.rel_path)}
                >
                  <span className="flex items-center gap-1">
                    <span className="flex-1 truncate text-[12px] text-foreground">
                      {r.title || r.rel_path}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                      {kindLabel(r.kind)}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{r.rel_path}</span>
                  {r.snippet ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {highlightSnippet(r.snippet)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* QuickNav 联动：recent = 最近文档区；tags = 标签列表区；trash = 回收站；all = 模块 + 文档树 */}
        {nav === 'recent' ? (
          <Section title="最近" action={
            recent.length > 0 ? (
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground/80"
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
                className={`block w-full truncate rounded px-2 py-1 text-left text-[12px] hover:bg-accent ${
                  activeId === d.rel_path ? 'bg-sidebar-accent font-medium text-blue-700' : 'text-foreground'
                }`}
                title={d.rel_path}
                onClick={() => onOpenArticle(d.rel_path)}
              >
                {d.title}
              </button>
            ))}
          </Section>
        ) : nav === 'tags' ? (
          <>
            <Section title="标签">
              {tags.length === 0 && <Empty text="暂无标签" />}
              {tags.slice(0, 30).map((t) => (
                <button
                  key={t.name}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] hover:bg-accent ${
                    activeTag === t.name ? 'bg-sidebar-accent text-blue-700' : 'text-foreground'
                  }`}
                  onClick={() => (activeTag === t.name ? setActiveTag(null) : void selectTag(t.name))}
                >
                  <span className="flex-1 truncate">#{t.name}</span>
                  <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{t.count}</span>
                </button>
              ))}
            </Section>

            {/* 标签筛选结果 */}
            {activeTag && (
              <Section title={`筛选：#${activeTag}`} action={
                <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/80" onClick={() => setActiveTag(null)}>
                  <Icon name="close" className="size-3" />
                </button>
              }>
                {tagFiles.length === 0 && <Empty text="无匹配文档" />}
                {tagFiles.map((f) => (
                  <button
                    key={f.rel_path}
                    className={`block w-full truncate rounded px-2 py-1 text-left text-[12px] hover:bg-accent ${
                      activeId === f.rel_path ? 'bg-sidebar-accent font-medium text-blue-700' : 'text-foreground'
                    }`}
                    title={f.rel_path}
                    onClick={() => onOpenArticle(f.rel_path)}
                  >
                    {f.title || f.rel_path}
                  </button>
                ))}
              </Section>
            )}
          </>
        ) : nav === 'trash' ? (
          /* 回收站（MVP）：恢复成功后经 App 的 setTreeRefresh 刷新文件树 */
          <TrashPanel
            activeId={activeId}
            refreshKey={refreshKey}
            onRestored={(restoredTo) => onTrashRestored?.(restoredTo)}
          />
        ) : (
        <>
        {/* 模块（Phase 5：文件夹分类 + 文件树管理，双击/单击在编辑器打开） */}
        <Section title="模块" action={
          <button
            className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary"
            title="新建模块"
            onClick={() => void handleNewDoc('Modules')}
          >
            <Icon name="plus" className="size-3" /> 新建
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

        {/* 文件树（Phase 4.2）；「文章」Section 承担文档库标题，新建文档/文件夹入口均在此（顶层按钮，不依赖 hover） */}
        <Section title="文章" action={
          <div className="flex items-center gap-1">
            <button
              className="flex items-center gap-0.5 rounded px-1 text-[11px] text-muted-foreground hover:text-primary"
              title="新建文档"
              onClick={() => void handleNewDoc(TOP_ARTICLES)}
            >
              <Icon name="plus" className="size-3" /> 新建
            </button>
            <button
              className="flex items-center gap-0.5 rounded px-1 text-[11px] text-muted-foreground hover:text-primary"
              title="新建文件夹"
              onClick={() => void handleNewFolder(TOP_ARTICLES)}
            >
              <Icon name="folder-plus" className="size-3" /> 新建文件夹
            </button>
          </div>
        }>
          {treeError ? (
            <LoadError onRetry={() => void loadTree()} />
          ) : articlesTree.length === 0 ? (
            <Empty text="暂无文章" />
          ) : (
            articlesTree.map((n) => renderNode(n, 0))
          )}
        </Section>

        {/* 附件（task-12：附件能力的家；task-22：默认收起）—— 可折叠小节；行点击看「附属情况与附属记录」；
            行右侧独立「打开文件」<a>（不嵌套在行按钮内）；孤儿附件仅手动删除 */}
        <div className="border-b border-border py-2">
          <div className="mb-1 flex items-center justify-between gap-1 px-3">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setAttachOpen((v) => !v)}
                aria-expanded={attachOpen}
                aria-label={attachOpen ? '收起附件' : '展开附件'}
                title={attachOpen ? '收起附件' : '展开附件'}
                data-testid="attachments-toggle"
                className="flex items-center gap-1 text-[12px] font-normal text-sidebar-foreground transition-colors hover:text-foreground/80"
              >
                <Icon name={attachOpen ? 'chevron-down' : 'chevron-right'} className="size-3.5" />
                附件{' '}{attachments.length}
                {/* 收起后孤儿信号不能丢：徽章常驻表头（在折叠按钮内 → 点它即展开） */}
                {orphans.length > 0 && (
                  <span
                    data-testid="orphan-badge"
                    title={`${orphans.length} 个孤儿附件未被任何 Markdown 引用（展开附件可处理）`}
                    className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-amber-600"
                  >
                    <Icon name="alert" className="size-3" />
                    孤儿附件 {orphans.length}
                  </span>
                )}
              </button>
            </div>
            <button
              type="button"
              aria-label="刷新附件"
              title="刷新附件"
              onClick={() => void loadAttachments()}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon name="rotate-ccw" className="size-3.5" />
            </button>
          </div>

          {/* 收起态只留一行表头：行 / 详情 / 孤儿区块均不渲染 */}
          {attachOpen && (
            <div className="px-1.5">
              {attachError ? (
                <LoadError onRetry={() => void loadAttachments()} />
              ) : attachments.length === 0 ? (
                <Empty text="暂无附件" />
              ) : null}
              {/* 每行 = 触发按钮 + 独立「打开文件」<a> + 可选就地详情（详情内引用文档也是按钮） */}
              {attachments.map((a) => {
                const cited = a.referenced_by.length > 0
                const catIcon = a.category === 'images' ? 'image' : a.category === 'videos' ? 'video' : 'file-text'
                const detailOpen = expandedAttach === a.rel_path
                return (
                  <div key={a.rel_path} data-attachment={a.rel_path} className="mb-0.5">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        data-attachment-row={a.rel_path}
                        aria-expanded={detailOpen}
                        onClick={() => toggleAttachmentDetail(a.rel_path)}
                        title={cited ? `已被 ${a.referenced_by.length} 篇文档引用 · ${a.rel_path}` : `未被引用 · ${a.rel_path}`}
                        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-left text-[12px] transition-colors hover:bg-accent focus-visible:outline-none"
                      >
                        <Icon name={catIcon as 'image'} className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-foreground">{a.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{fmtSize(a.size)}</span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 text-[10px] ${
                            cited ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {cited ? '已引用' : '未引用'}
                        </span>
                      </button>
                      {/* 原有「打开文件」能力保留：独立 <a>，禁止嵌套在行按钮内 */}
                      <a
                        href={attachmentUrl(a.rel_path)}
                        target="_blank"
                        rel="noreferrer"
                        title="打开附件"
                        aria-label={`打开附件 ${a.name}`}
                        data-attachment-open={a.rel_path}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Icon name="export" className="size-3.5" />
                      </a>
                    </div>

                    {/* 附属情况与附属记录（就地展开，只读展示） */}
                    {detailOpen && (
                      <div
                        data-attachment-detail={a.rel_path}
                        data-ref-count={a.referenced_by.length}
                        className="mx-1 mb-1 rounded-[6px] border border-border bg-muted/50 px-2 py-1.5"
                      >
                        <div className="text-[11px] font-medium text-foreground">附属情况与附属记录</div>
                        <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                          <span className="text-muted-foreground">引用篇数</span>
                          <span className="text-foreground">{a.referenced_by.length}</span>
                        </div>
                        {cited ? (
                          // 全部引用文档（不是只取 referenced_by[0]），逐条点击 → onOpenArticle 跳转
                          <ul className="mt-0.5 space-y-0.5">
                            {a.referenced_by.map((docRel) => (
                              <li key={docRel}>
                                <button
                                  type="button"
                                  data-ref-doc={docRel}
                                  onClick={() => onOpenArticle(docRel)}
                                  title={`打开文档：${docRel}`}
                                  className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-primary hover:bg-accent hover:underline"
                                >
                                  <Icon name="file-text" className="mr-1 inline size-3 align-[-2px] text-muted-foreground" />
                                  {docRel}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                            <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                              未被引用
                            </span>
                            <span className="text-muted-foreground">未被任何文档引用</span>
                          </div>
                        )}
                        {/* 附件自身详情（未被引用时的主要信息；已引用时同样保留全路径） */}
                        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                          <span className="text-muted-foreground">路径</span>
                          <span className="break-all font-mono text-foreground">{a.rel_path}</span>
                          <span className="text-muted-foreground">大小</span>
                          <span className="text-foreground">{fmtSize(a.size)}</span>
                          <span className="text-muted-foreground">修改时间</span>
                          <span className="text-foreground">{fmtTime(a.mtime)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {attachments.length > 0 && (
                <p className="px-1.5 pb-0.5 pt-0.5 text-[11px] text-muted-foreground">
                  孤儿附件仅支持手动删除，不随笔记回滚。
                </p>
              )}

              {/* 孤儿附件（仅手动删除、绝不自动）——随展开态；收缩后信号由表头琥珀徽章承载 */}
              {orphans.length > 0 && (
                <div data-testid="orphans-block" className="mx-1 mb-1 mt-1 rounded border border-amber-100 bg-amber-50/50 p-2">
                  <div className="mb-1 text-[11px] font-medium text-amber-600">孤儿附件（{orphans.length}）</div>
                  <p className="mb-2 text-[10px] leading-4 text-muted-foreground">
                    未被任何 Markdown 引用。仅手动删除，绝不自动；被引用附件后端会拒绝删除。
                  </p>
                  {orphans.map((o) => (
                    <div key={o.path} className="mb-1 flex items-start justify-between gap-1">
                      <div className="truncate font-mono text-[10px] text-foreground" title={o.path}>
                        {o.name}
                        <span className="ml-1.5 text-[10px] text-muted-foreground">{fmtSize(o.size)}</span>
                      </div>
                      <button
                        type="button"
                        disabled={deletingAttach === o.path}
                        onClick={() => void handleDeleteOrphan(o)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {deletingAttach === o.path ? '删除中…' : '删除'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* 底部设置按钮（handoff §3.2 / 参考稿：整行 h-8 大按钮 + settings 图标） */}
      <div className="shrink-0 border-t border-sidebar-border px-2.5 py-2">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="打开设置"
          title="设置"
          className="flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px] transition-[background-color,color,transform] duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
          style={{ color: 'var(--sidebar-foreground)' }}
        >
          <Icon name="settings" className="size-4" />
          <span>设置</span>
        </button>
      </div>

      {/* 上下文菜单 */}
      {ctx && (
        <div
          ref={menuRef}
          className="fixed z-50 w-44 rounded-md border border-border bg-white py-1 text-xs shadow-lg"
          style={{ left: Math.min(ctx.x, window.innerWidth - 190), top: Math.min(ctx.y, window.innerHeight - 220) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
            {ctx.node.type === 'folder' ? `目录：${ctx.node.relPath}` : ctx.node.relPath}
          </div>
          {ctx.node.type === 'folder' && (
            <>
              <MenuItem label="新建文档" onClick={() => { setCtx(null); void handleNewDoc(ctx.node.relPath) }} />
              <MenuItem label="新建文件夹" onClick={() => { setCtx(null); void handleNewFolder(ctx.node.relPath) }} />
              <div className="my-1 border-t border-border" />
            </>
          )}
          <MenuItem label="重命名" onClick={() => { setCtx(null); void handleRename(ctx.node) }} />
          <MenuItem label="移动到…" onClick={() => { setCtx(null); void handleMove(ctx.node) }} />
          <div className="my-1 border-t border-border" />
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
    <div className="border-b border-border py-2">
      <div className="mb-1 flex items-center justify-between px-3">
        <span className="text-[12px] font-normal text-sidebar-foreground">{title}</span>
        {action}
      </div>
      <div className="px-1.5">{children}</div>
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="block w-full px-3 py-1.5 text-left text-foreground hover:bg-accent" onClick={onClick}>
      {label}
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="px-3 py-1 text-[11px] text-muted-foreground">{text}</div>
}

/** P2-8：加载失败不再当作「空」显示，而是给出明确错误 + 重试入口 */
function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-2 py-1 text-[11px] text-rose-500">
      加载失败，请重试
      <button
        type="button"
        onClick={onRetry}
        className="ml-1 text-primary hover:underline"
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
