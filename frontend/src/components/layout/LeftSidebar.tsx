/** 左侧栏（Focus 最终版 · 设计交接包 HANDOFF.md §3）：
 * - 工作区头 + 头像 + « 收起；「新建文档」主按钮
 * - 导航 5 项：知识库(book) / 搜索(search) / 模块(layers) / 资料(paperclip) / 回收站(trash)
 *   —— 点击只调用 props `onNavigate(page)`，激活态由 props `activePage` 决定（editor 页由 App 传 'library'）
 * - 固定内容：「文件」label（12px/600 text-3）+ 新建文档/新建文件夹图标按钮 + 文章文件树
 * - footer 三段：设置 / 专注模式 / 切换外观（图标依主题 moon/sun）
 * - 文件树保留全部既有行为：新建文档/文件夹、重命名、删除（文档=单次确认+可在回收站恢复；文件夹=二次确认）、
 *   移动、右键菜单、aria/加载/错误/空态
 * - 侧栏内部不再渲染 搜索/模块/资料/回收站/最近/标签 视图（这些已迁到主画布页面，task-9/10/11）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDocIn,
  createFolder,
  deleteArticle,
  deleteFolder,
  getTree,
  movePath,
  renameDoc,
  renameFolder,
} from '../../api/client'
import type { FsMutation } from '../../App'
import type { TreePayload } from '../../types'
import { buildFileTree, type TreeNode } from '../../utils/tree'
import { Icon, type IconName } from '../icons'
import { askConfirm, askPrompt } from '../common/PromptDialog'

/** 侧栏导航目标页面（与 AppPage 去掉 editor 后一致；由 App 的 page 状态派生） */
export type NavPage = 'library' | 'search' | 'modules' | 'assets' | 'trash'

interface Props {
  activeId: string | null
  onOpenArticle: (id: string) => void
  refreshKey?: number
  onFsMutation?: (m: FsMutation) => void
  /** R1-B：文件系统变更（重命名/移动/删除）执行前的钩子——返回 false 中止操作。
   * 用于先 flush 当前文档未决保存（变更后旧路径已不存在，flush 将 404）。 */
  onBeforeFsMutation?: (node: TreeNode) => Promise<boolean>
  /** 打开设置面板（footer「设置」入口） */
  onOpenSettings?: () => void
  /** workspace 根路径（工作区头展示目录名） */
  workspaceRoot?: string | null
  /** 兼容保留：回收站已迁主画布页面（task-11），App 仍会传；侧栏不再使用 */
  onTrashRestored?: (restoredTo: string) => void
  /** Focus 壳层：收起浮动侧栏 */
  onCollapse?: () => void
  /** Focus footer：切换专注模式（App 侧 toggleFocusMode） */
  onToggleFocusMode?: () => void
  /** Focus footer：切换浅色/深色外观（App 侧 toggleTheme） */
  onToggleTheme?: () => void
  /** 当前是否为深色主题 —— 决定 footer「切换外观」图标显示 moon（浅色）还是 sun（深色） */
  themeIsDark?: boolean
  /** Focus 页面路由：当前主画布页面（editor 时 App 传 'library'） */
  activePage?: NavPage
  /** Focus 页面路由：导航点击 → 切换主画布页面 */
  onNavigate?: (page: NavPage) => void
}

interface CtxMenu {
  x: number
  y: number
  node: TreeNode
}

const TOP_ARTICLES = 'Articles'

/** 主设计交接包 §3：导航 5 项（知识库默认激活） */
const NAV_ITEMS: ReadonlyArray<{ id: NavPage; label: string; icon: IconName }> = [
  { id: 'library', label: '知识库', icon: 'book' },
  { id: 'search', label: '搜索', icon: 'search' },
  { id: 'modules', label: '模块', icon: 'layers' },
  { id: 'assets', label: '资料', icon: 'paperclip' },
  { id: 'trash', label: '回收站', icon: 'trash' },
]

/** 主导航项（参考稿 .fb-nav-item：34px 行 / 17px 图标 / 激活 = accent-soft 底 + accent 字 + 550 字重） */
function NavItem({
  active,
  label,
  icon,
  onClick,
}: {
  active?: boolean
  label: string
  icon: IconName
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={[
        'flex h-[34px] w-full items-center gap-[9px] rounded-[8px] px-[9px] text-[13px] transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-text-2 hover:bg-surface-2 hover:text-foreground',
      ].join(' ')}
      style={active ? { color: 'var(--sidebar-accent-foreground)', fontWeight: 550 } : undefined}
    >
      <Icon name={icon} className={`size-[17px] shrink-0 ${active ? 'text-primary' : 'text-text-3'}`} />
      <span>{label}</span>
    </button>
  )
}

/** footer 行（参考稿 .fb-foot a：32px 行 / 13px / 17px 图标 / text-2） */
function FootItem({
  icon,
  label,
  ariaLabel,
  title,
  onClick,
}: {
  icon: IconName
  label: string
  ariaLabel?: string
  title?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title ?? label}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-[9px] rounded-[8px] px-[9px] text-left text-[13px] text-text-2 transition-[background-color,color] duration-150 hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
    >
      <span className="grid size-[17px] shrink-0 place-items-center text-text-3">
        <Icon name={icon} className="size-[17px]" />
      </span>
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
  onCollapse,
  onToggleFocusMode,
  onToggleTheme,
  themeIsDark = false,
  activePage,
  onNavigate,
}: Props) {
  /** Focus 页面路由：当前主画布页面（editor 页当 knowledge/library 高亮） */
  const currentPage = activePage ?? 'library'
  const [tree, setTree] = useState<TreePayload | null>(null)
  /** Focus 工作区头：展示工作区目录名 */
  const workspaceName = (() => {
    const seg = (workspaceRoot ?? '').split(/[\\/]/).filter(Boolean)
    return seg[seg.length - 1] ?? '工作区'
  })()
  // P2-8：文件树加载失败不再是「空」，而是明确错误提示
  const [treeError, setTreeError] = useState(false)
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set([TOP_ARTICLES]))
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

  // ---------- 文件系统操作（Phase 4.2） ----------
  const notify = useCallback(
    (m: FsMutation) => {
      void loadTree()
      onFsMutation?.(m)
    },
    [loadTree, onFsMutation],
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
      // 打开文档：App 会切回编辑器页
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
    // 参考稿 .fb-tree .tree-row：单级缩进 14px（10 + depth*14），行高 30，圆角 7，字号 12.5
    const indent = { paddingLeft: `${10 + depth * 14}px` }
    const isOpen = expanded.has(node.relPath)
    if (node.type === 'folder') {
      const count = countChildren(node)
      return (
        <div key={node.relPath}>
          <div
            className="group flex h-[30px] cursor-pointer items-center gap-[7px] rounded-[7px] pr-1.5 text-[12.5px] text-text-2 transition-colors hover:bg-surface-2 focus-visible:outline-none"
            style={indent}
            onClick={() => toggle(node.relPath)}
            onContextMenu={(e) => openCtx(e, node)}
          >
            <span className="grid w-3.5 shrink-0 place-items-center text-text-3">
              {isOpen ? <Icon name="chevron-down" className="size-[11px]" /> : <Icon name="chevron-right" className="size-[11px]" />}
            </span>
            <span className="flex-1 overflow-visible whitespace-nowrap font-medium">{node.name}</span>
            {count > 0 ? (
              <span className="shrink-0 text-[11.5px] text-text-3">
                {count}
              </span>
            ) : null}
            <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              <button
                type="button"
                title="新建文档"
                aria-label={`在「${node.name}」下新建文档`}
                className="grid size-5 place-items-center rounded-[4px] text-text-3 transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleNewDoc(node.relPath)
                }}
              >
                <Icon name="plus" className="size-[13px]" />
              </button>
              <button
                type="button"
                title="新建文件夹"
                aria-label={`在「${node.name}」下新建文件夹`}
                className="grid size-5 place-items-center rounded-[4px] text-text-3 transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleNewFolder(node.relPath)
                }}
              >
                <Icon name="folder-plus" className="size-[13px]" />
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
        className={`flex h-[30px] cursor-pointer items-center gap-[7px] rounded-[7px] pr-1.5 text-[12.5px] transition-colors ${
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-text-2 hover:bg-surface-2 hover:text-foreground'
        }`}
        style={indent}
        onClick={() => handleOpenFromTree(node)}
        onContextMenu={(e) => openCtx(e, node)}
        title={node.relPath}
      >
        <span className="w-3.5 shrink-0" />
        <span
          className={`grid size-3.5 shrink-0 place-items-center ${active ? 'text-primary' : 'text-text-3'}`}
          style={{ opacity: active ? 1 : 0.8 }}
        >
          <Icon name="file-text" className="size-[13px]" />
        </span>
        <span className="flex-1 whitespace-nowrap">{node.name}</span>
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

  // ---------- 渲染 ----------
  return (
    <aside
      className="flex h-full w-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar"
      data-sidebar-page={currentPage}
    >
      {/* 工作区头（Focus §3：30px 头像 + 工作区名 + 副标题 + « 收起） */}
      <div className="flex h-[54px] shrink-0 items-center gap-2.5 px-3">
        <span
          className="grid size-[30px] shrink-0 place-items-center rounded-[8px] text-[13px] font-semibold text-white"
          style={{ backgroundColor: 'var(--foreground)' }}
          aria-hidden="true"
        >
          研
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold leading-tight" style={{ color: 'var(--foreground)' }}>
            {workspaceName}
          </div>
          <div className="text-[12px] leading-tight text-text-3">本地工作区</div>
        </div>
        {onCollapse ? (
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded-[6px] transition-colors hover:bg-surface-2"
            style={{ color: 'var(--text-2)' }}
            title="收起文件侧栏（Ctrl/Cmd+\）"
            aria-label="收起文件侧栏"
            onClick={onCollapse}
          >
            <Icon name="chevron-left" className="size-4" />
          </button>
        ) : null}
      </div>

      {/* 新建文档主按钮（Focus §3：全宽蓝色主按钮，高 38） */}
      <div className="shrink-0 px-3 pb-1 pt-1">
        <button
          type="button"
          className="flex h-[38px] w-full items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium text-white transition-[filter] duration-150 hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ backgroundColor: 'var(--primary)', outlineColor: 'var(--ring)' }}
          onClick={() => void handleNewDoc(TOP_ARTICLES)}
        >
          <Icon name="plus" className="size-4" />
          <span>新建文档</span>
        </button>
      </div>

      {/* Focus §3：5 项主导航（34px 行 / 17px 图标 / 激活 accent 底；导航底部 border-bottom）
          点击只切主画布页面（onNavigate），侧栏内容不随导航切换 */}
      <nav aria-label="主导航" className="shrink-0 px-2 pt-0.5">
        <div className="flex flex-col gap-px border-b border-border pb-2">
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.id}
              active={item.id === currentPage}
              label={item.label}
              icon={item.icon}
              onClick={() => onNavigate?.(item.id)}
            />
          ))}
        </div>
      </nav>

      {/* 文件区标题：「文件」+ 新建文档 / 新建文件夹 图标按钮（参考稿 .fb-label） */}
      <div className="flex shrink-0 items-center justify-between pb-1 pl-3 pr-2 pt-1.5">
        <span className="text-[12px] font-semibold text-text-3">文件</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新建文档"
            aria-label="新建文档"
            onClick={() => void handleNewDoc(TOP_ARTICLES)}
            className="grid size-[22px] place-items-center rounded-[6px] text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon name="plus" className="size-[15px]" />
          </button>
          <button
            type="button"
            title="新建文件夹"
            aria-label="新建文件夹"
            onClick={() => void handleNewFolder(TOP_ARTICLES)}
            className="grid size-[22px] place-items-center rounded-[6px] text-text-3 transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon name="folder-plus" className="size-[15px]" />
          </button>
        </div>
      </div>

      {/* 文章文件树（固定展示；文件名不省略 = nowrap + 容器横向滚动；加载失败给可见错误 + 重试） */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto px-2 pb-2">
        {treeError ? (
          <LoadError onRetry={() => void loadTree()} />
        ) : articlesTree.length === 0 ? (
          <Empty text="暂无文章" />
        ) : (
          articlesTree.map((n) => renderNode(n, 0))
        )}
      </div>

      {/* 底部 footer 三段（Focus §3 / 参考稿 .fb-foot：32px 行、13px、17px 图标、顶部 border-top） */}
      <div className="shrink-0 border-t border-border px-2 pb-2 pt-2">
        <FootItem icon="settings" label="设置" ariaLabel="打开设置" onClick={onOpenSettings} />
        <FootItem icon="focus" label="专注模式" onClick={onToggleFocusMode} />
        <button
          type="button"
          aria-label="切换外观"
          title="切换外观"
          onClick={onToggleTheme}
          className="flex h-8 w-full items-center gap-[9px] rounded-[8px] px-[9px] text-left text-[13px] text-text-2 transition-[background-color,color] duration-150 hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
        >
          <span
            className="grid size-[17px] shrink-0 place-items-center text-text-3"
            data-appearance-icon={themeIsDark ? 'sun' : 'moon'}
          >
            <Icon name={themeIsDark ? 'sun' : 'moon'} className="size-[17px]" />
          </span>
          <span>切换外观</span>
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

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="block w-full px-3 py-1.5 text-left text-foreground hover:bg-surface-2" onClick={onClick}>
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
