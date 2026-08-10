/** 应用根：单窗口三栏布局（决策点 6），右侧面板可折叠。
 *
 * Phase 4：Workspace 状态机（未打开 -> 选择页；打开后 -> 三栏主界面）、
 * 文件监听事件轮询（外部修改提示 / 文件树自动刷新）、最近文档记录、
 * Workspace 切换未保存确认。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeWorkspace,
  createArticle,
  createWorkspace,
  discardRecovery,
  getArticle,
  getFsEvents,
  getHealth,
  getRecentWorkspaces,
  getWorkspaceCurrent,
  importMarkdown,
  importPackage,
  listRecovery,
  openWorkspace,
  recordRecentDocument,
  restoreRecovery,
} from './api/client'
import EditorArea from './components/layout/EditorArea'
import LeftSidebar from './components/layout/LeftSidebar'
import RightPanel from './components/layout/RightPanel'
import WorkspacePicker from './components/layout/WorkspacePicker'
import SettingsPanel from './components/settings/SettingsPanel'
import { isDesktop, pickDirectory } from './desktop'
import { applyTheme, loadSettings } from './settings'
import { APP_VERSION } from './version'
import type { ArticleMeta, FsEvent, HealthInfo, RecoveryItem, WorkspaceState } from './types'

/** 编辑器保存状态（与 EditorArea 对齐，App 只需区分是否可安全覆盖） */
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** 文件树变更通知（来自 LeftSidebar 的文件系统操作） */
export interface FsMutation {
  type: 'create' | 'delete' | 'rename' | 'move'
  from?: string
  to?: string
}

const FS_POLL_MS = 1500

export default function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  /** Phase 5E：前后端版本不一致（仅提示，不阻塞） */
  const [versionMismatch, setVersionMismatch] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [workspaceChecked, setWorkspaceChecked] = useState(false)
  /** Phase 7 M4：首启引导（桌面首次使用：默认 workspace 为空且无最近记录） */
  const [firstRun, setFirstRun] = useState(false)
  // 右侧面板折叠状态：初始值从 localStorage 恢复（折叠后释放编辑区宽度）
  const [rightOpen, setRightOpen] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('ke.rightOpen') !== '0' : true),
  )
  const [article, setArticle] = useState<ArticleMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [treeRefresh, setTreeRefresh] = useState(0)
  const [extModal, setExtModal] = useState<FsEvent | null>(null)
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  /** Phase 7 M3：设置面板开关 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Phase 6.2：启动时检测到的未恢复内容 */
  const [recoveryModal, setRecoveryModal] = useState<RecoveryItem[] | null>(null)
  const recoveryCheckedFor = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eventCursor = useRef(0)
  const lastSavedAt = useRef(new Map<string, number>())
  const treeRefreshTimer = useRef<number | null>(null)

  const hasUnsaved = saveState === 'dirty' || saveState === 'saving' || saveState === 'error'

  // ---------- 后端健康检查 ----------
  useEffect(() => {
    let alive = true
    const ping = () => {
      getHealth()
        .then((h) => {
          if (!alive) return
          setHealth(h)
          setBackendDown(false)
          // Phase 5E 版本一致性：与本地前端版本比对，不一致仅警告
          setVersionMismatch(h.version !== APP_VERSION)
        })
        .catch(() => alive && setBackendDown(true))
    }
    ping()
    const timer = setInterval(ping, 10000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // ---------- 启动：应用设置（Phase 7 M3，加载即应用主题） ----------
  useEffect(() => {
    let alive = true
    loadSettings()
      .then((s) => {
        if (alive) applyTheme(s.ui.theme)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // ---------- 启动：恢复上次工作区（Phase 4.1） ----------
  useEffect(() => {
    let alive = true
    getWorkspaceCurrent()
      .then((ws) => {
        if (!alive) return
        setWorkspace(ws)
        setWorkspaceChecked(true)
      })
      .catch(() => {
        if (!alive) return
        setBackendDown(true)
        setWorkspaceChecked(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // ---------- 启动：首启引导判定（Phase 7 M4） ----------
  // 桌面版后端启动即激活默认 workspace（可能为空）；仅当 workspace 已打开、
  // 无任何文档且无最近工作区记录时视为「首次使用」，显示两选项引导。
  useEffect(() => {
    if (!workspaceChecked || !workspace?.open || !workspace.root) return
    if ((workspace.stats?.document ?? 0) > 0) return
    let alive = true
    getRecentWorkspaces()
      .then((r) => {
        if (!alive) return
        if (r.workspaces.length === 0) setFirstRun(true)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [workspaceChecked, workspace?.open, workspace?.root, workspace?.stats?.document])

  // ---------- 启动：异常退出恢复检测（Phase 6.2） ----------
  // 每个工作区打开时检测一次未恢复的编辑内容；用户可恢复/丢弃/稍后处理
  useEffect(() => {
    if (!workspace?.open || !workspace.root) return
    if (recoveryCheckedFor.current === workspace.root) return
    recoveryCheckedFor.current = workspace.root
    listRecovery()
      .then((payload) => {
        if (payload.count > 0) setRecoveryModal(payload.items)
      })
      .catch(() => undefined)
  }, [workspace?.open, workspace?.root])

  // ---------- 文件监听轮询（Phase 4.3） ----------
  useEffect(() => {
    if (!workspace?.open) return
    const poll = async () => {
      try {
        const payload = await getFsEvents(eventCursor.current)
        eventCursor.current = payload.last_seq
        for (const ev of payload.events) handleFsEvent(ev)
      } catch {
        /* 网络抖动忽略，下一轮重试 */
      }
    }
    const timer = setInterval(() => void poll(), FS_POLL_MS)
    return () => {
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.open, workspace?.root])

  const handleFsEvent = useCallback(
    (ev: FsEvent) => {
      // 树刷新（防抖合并；自身操作导致的事件也安全，刷新幂等）
      if (ev.type !== 'modified') {
        if (treeRefreshTimer.current) window.clearTimeout(treeRefreshTimer.current)
        treeRefreshTimer.current = window.setTimeout(() => setTreeRefresh((n) => n + 1), 300)
      }
      // 外部修改提示：仅针对当前打开的文档；自身保存写入被后端标记抑制，前端再兜底一次
      const cur = article?.id
      if (ev.type === 'modified' && cur && ev.rel === cur) {
        const last = lastSavedAt.current.get(cur) ?? 0
        if (Date.now() - last < 2500) return
        setExtModal(ev)
      }
    },
    [article?.id],
  )

  const openArticle = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const doc = await getArticle(id)
      setArticle(doc)
      recordRecentDocument(id, doc.title).catch(() => undefined)
    } catch (e) {
      console.error('打开文档失败', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // ---------- 异常恢复动作（Phase 6.2） ----------
  const handleRecoveryRestore = useCallback(
    async (item: RecoveryItem) => {
      try {
        const doc = await restoreRecovery(item.doc_path)
        setRecoveryModal((prev) => (prev ? prev.filter((i) => i.doc_path !== item.doc_path) : null))
        setTreeRefresh((n) => n + 1)
        await openArticle(doc.id)
      } catch (e) {
        window.alert(`恢复失败：${e instanceof Error ? e.message : String(e)}`)
        // 记录可能已清除，刷新弹窗列表
        listRecovery()
          .then((p) => setRecoveryModal(p.count > 0 ? p.items : null))
          .catch(() => undefined)
      }
    },
    [openArticle],
  )

  const handleRecoveryDiscard = useCallback(async (docPath: string) => {
    try {
      await discardRecovery(docPath)
      setRecoveryModal((prev) => (prev ? prev.filter((i) => i.doc_path !== docPath) : null))
      setTreeRefresh((n) => n + 1)
    } catch {
      /* 忽略网络抖动 */
    }
  }, [])

  const handleRecoveryDiscardAll = useCallback(async () => {
    const items = recoveryModal ?? []
    await Promise.all(items.map((i) => discardRecovery(i.doc_path).catch(() => undefined)))
    setRecoveryModal(null)
    setTreeRefresh((n) => n + 1)
  }, [recoveryModal])

  // 编辑器自身保存完成回调：记录时间用于兜底抑制 + 同步最新文档状态
  // （Phase 6E：保存成功后更新 article，避免历史面板/元信息显示陈旧内容）
  const handleSaved = useCallback((id: string, doc?: ArticleMeta) => {
    lastSavedAt.current.set(id, Date.now())
    if (doc) setArticle(doc)
  }, [])

  // 右侧面板折叠/展开（持久化到 localStorage，刷新后保持）
  const toggleRight = useCallback((v: boolean) => {
    setRightOpen(v)
    try {
      localStorage.setItem('ke.rightOpen', v ? '1' : '0')
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, [])

  // 外部修改弹窗：重新加载 / 保留当前编辑
  const handleReloadExternal = useCallback(async () => {
    const rel = extModal?.rel
    setExtModal(null)
    if (!rel) return
    if (hasUnsaved && !window.confirm('当前有未保存修改，重新加载将丢失这些修改，是否继续？')) {
      return
    }
    await openArticle(rel)
    setSaveState('saved')
  }, [extModal, hasUnsaved, openArticle])

  const handleKeepLocal = useCallback(() => {
    setExtModal(null)
  }, [])

  // ---------- Workspace 切换（未保存确认，Phase 4 补充约束 1） ----------
  const switchWorkspace = useCallback(
    async (path: string, mode: 'open' | 'create') => {
      if (hasUnsaved && !window.confirm('当前文档有未保存修改，切换工作区将放弃这些修改，是否继续？')) {
        return
      }
      try {
        const state = mode === 'create' ? await createWorkspace(path) : await openWorkspace(path)
        applyWorkspace(state)
      } catch (e) {
        window.alert(`${mode === 'create' ? '创建' : '打开'}失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [hasUnsaved],
  )

  const applyWorkspace = useCallback((state: WorkspaceState) => {
    setWorkspace(state)
    setArticle(null)
    setSaveState('idle')
    setTreeRefresh((n) => n + 1)
    eventCursor.current = 0
    lastSavedAt.current.clear()
    setFirstRun(false)
  }, [])

  /** 顶栏「打开工作区…」：桌面用原生目录选择器，Web 回退手动输入（M4） */
  const handleOpenWorkspaceMenu = useCallback(async () => {
    setWsMenuOpen(false)
    const dir = await pickDirectory('选择工作区目录')
    if (dir) void switchWorkspace(dir, 'open')
    else if (!isDesktop()) {
      const p = window.prompt('打开工作区路径')
      if (p) void switchWorkspace(p, 'open')
    }
  }, [switchWorkspace])

  /** 顶栏「新建工作区…」：桌面用原生目录选择器（目标需为空目录），Web 回退手动输入（M4） */
  const handleCreateWorkspaceMenu = useCallback(async () => {
    setWsMenuOpen(false)
    const dir = await pickDirectory('选择新建工作区目录（需为空）')
    if (dir) void switchWorkspace(dir, 'create')
    else if (!isDesktop()) {
      const p = window.prompt('新建工作区路径')
      if (p) void switchWorkspace(p, 'create')
    }
  }, [switchWorkspace])

  /** 首启引导「创建新工作区」：沿用默认（空）workspace（M4）。
   * 重新打开一次默认 workspace：后端幂等（ensure 结构 + 更新索引），
   * 并写入最近列表，使下次启动不再进入首启引导。 */
  const handleUseDefaultWorkspace = useCallback(async () => {
    if (!workspace?.root) return
    try {
      const state = await openWorkspace(workspace.root)
      applyWorkspace(state)
    } catch {
      setFirstRun(false)
    }
  }, [workspace?.root, applyWorkspace])

  const handleCloseWorkspace = useCallback(async () => {
    if (hasUnsaved && !window.confirm('当前文档有未保存修改，关闭工作区将放弃这些修改，是否继续？')) {
      return
    }
    await closeWorkspace()
    applyWorkspace({ open: false })
  }, [hasUnsaved, applyWorkspace])

  const handleNewArticle = useCallback(async () => {
    const title = window.prompt('文档标题', `新文档 ${new Date().toLocaleDateString()}`)
    if (!title) return
    try {
      const created = await createArticle(title)
      setArticle(created)
      setTreeRefresh((n) => n + 1)
    } catch (e) {
      console.error('新建文档失败', e)
      window.alert(String(e))
    }
  }, [])

  // ---------- 导入（Phase 3E）：未保存确认 ----------
  const handleImportFile = useCallback(
    async (file: File) => {
      if (hasUnsaved) {
        const ok = window.confirm('当前内容未保存，导入将覆盖，是否继续？')
        if (!ok) return
      }
      try {
        const lower = file.name.toLowerCase()
        const result = lower.endsWith('.zip') ? await importPackage(file) : await importMarkdown(file)
        setTreeRefresh((n) => n + 1)
        await openArticle(result.id)
        window.alert(`导入成功：${result.title}`)
      } catch (e) {
        console.error('导入失败', e)
        window.alert(`导入失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [hasUnsaved, openArticle],
  )

  // ---------- 文件树变更联动（Phase 4.2） ----------
  const handleFsMutation = useCallback(
    async (m: FsMutation) => {
      setTreeRefresh((n) => n + 1)
      if (!article) return
      if (m.type === 'delete' && m.from === article.id) {
        setArticle(null)
        setSaveState('idle')
        window.alert('当前文档已被删除')
      } else if ((m.type === 'rename' || m.type === 'move') && m.from === article.id && m.to) {
        await openArticle(m.to)
      }
    },
    [article, openArticle],
  )

  // ---------- 桌面原生菜单事件（M5）：菜单项 → 复用既有动作 ----------
  useEffect(() => {
    if (!isDesktop()) return
    let disposed = false
    const unlisteners: Array<() => void> = []
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      if (disposed) return
      const un = await Promise.all([
        listen('ke-menu:new-document', () => void handleNewArticle()),
        listen('ke-menu:open-workspace', () => void handleOpenWorkspaceMenu()),
        listen<{ path: string }>('ke-menu:open-recent', (e) => {
          const p = e.payload?.path
          if (p) void switchWorkspace(p, 'open')
        }),
      ])
      if (disposed) un.forEach((f) => f())
      else unlisteners.push(...un)
    })
    return () => {
      disposed = true
      unlisteners.forEach((f) => f())
    }
  }, [handleNewArticle, handleOpenWorkspaceMenu, switchWorkspace])

  // ---------- 渲染 ----------
  if (workspaceChecked && (!workspace?.open || firstRun)) {
    return (
      <>
        <WorkspacePicker
          onOpened={applyWorkspace}
          guide={!!workspace?.open && firstRun}
          onUseDefault={handleUseDefaultWorkspace}
        />
        {backendDown && (
          <div className="fixed inset-x-0 top-0 z-50 bg-red-100 px-4 py-1 text-center text-xs text-red-700">
            后端服务未连接，请启动 backend（uvicorn app.main:app）
          </div>
        )}
      </>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-[#f6f7f9]">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
            KE
          </span>
          <span className="text-sm font-semibold text-gray-800">KnowledgeEditor</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
            Alpha
          </span>
          <div className="relative ml-1">
            <button
              type="button"
              onClick={() => setWsMenuOpen((v) => !v)}
              title="工作区管理"
              className="flex max-w-[280px] items-center gap-1 rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 transition-colors hover:bg-gray-50"
            >
              <span className="max-w-[220px] truncate font-mono">{workspace?.root ?? '—'}</span>
              <span className="text-gray-400">▾</span>
            </button>
            {wsMenuOpen && (
              <div className="absolute right-0 top-7 z-30 w-64 rounded-md border border-gray-200 bg-white py-1 text-xs shadow-lg">
                <div className="border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-400">
                  当前工作区：{workspace?.root}
                </div>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                  onClick={() => void handleOpenWorkspaceMenu()}
                >
                  打开工作区…
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                  onClick={() => void handleCreateWorkspaceMenu()}
                >
                  新建工作区…
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setWsMenuOpen(false)
                    void handleCloseWorkspace()
                  }}
                >
                  关闭工作区
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="设置"
            className="rounded border border-gray-200 bg-white px-2.5 py-1 text-[12px] text-gray-700 transition-colors hover:bg-gray-50"
          >
            ⚙ 设置
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-gray-200 bg-white px-2.5 py-1 text-[12px] text-gray-700 transition-colors hover:bg-gray-50"
          >
            导入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImportFile(f)
            }}
          />
          <span
            className={[
              'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
              backendDown ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600',
            ].join(' ')}
          >
            <span
              className={[
                'size-1.5 rounded-full',
                backendDown ? 'bg-red-500' : 'bg-emerald-500',
              ].join(' ')}
            />
            {backendDown ? '后端未连接' : `后端 v${health?.version ?? ''}`}
          </span>
          {!backendDown && versionMismatch && health ? (
            <span
              className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
              title="前后端版本不一致，可能运行的是旧代码；建议执行 .\scripts\start.ps1 重启"
            >
              ⚠ 版本不一致（前端 v{APP_VERSION} / 后端 v{health.version}）
            </span>
          ) : null}
        </div>
      </header>

      {/* 三栏主体 */}
      <div className="flex min-h-0 flex-1">
        <LeftSidebar
          activeId={article?.id ?? null}
          onOpenArticle={openArticle}
          refreshKey={treeRefresh}
          onFsMutation={handleFsMutation}
        />

        <EditorArea
          article={article}
          loading={loading}
          onNewArticle={handleNewArticle}
          onSaveStateChange={setSaveState}
          onSaved={handleSaved}
          onArticleRestored={setArticle}
        />

        {rightOpen ? (
          <RightPanel
            article={article}
            onMetaUpdate={setArticle}
            onOpenArticle={openArticle}
            onCollapse={() => toggleRight(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => toggleRight(true)}
            title="展开右侧面板（大纲 / 属性 / 附件）"
            className="flex w-6 shrink-0 items-center justify-center self-stretch border-l border-gray-200 bg-white text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            ‹
          </button>
        )}
      </div>

      {/* 设置面板（Phase 7 M3） */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 外部修改提示（Phase 4.3） */}
      {extModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25" onClick={handleKeepLocal}>
          <div
            className="w-[420px] rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-semibold text-gray-800">文档已被外部修改</h3>
            <p className="mb-4 break-all text-xs text-gray-500">
              {extModal.rel}
              <br />
              该文件在工作区外被修改（例如其他编辑器）。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleKeepLocal}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                保留当前编辑内容
              </button>
              <button
                type="button"
                onClick={() => void handleReloadExternal()}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              >
                重新加载外部版本
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 异常退出恢复提示（Phase 6.2） */}
      {recoveryModal && recoveryModal.length > 0 && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25">
          <div className="w-[460px] rounded-lg bg-white p-5 shadow-xl">
            <h3 className="mb-1 text-sm font-semibold text-gray-800">检测到未恢复的编辑内容</h3>
            <p className="mb-3 text-xs text-gray-500">
              上次退出时以下文档存在未保存修改，是否恢复？
            </p>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {recoveryModal.map((item) => (
                <div key={item.doc_path} className="rounded border border-gray-100 bg-gray-50 p-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-gray-700">
                        {item.doc_path}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        保存于 {formatTime(item.saved_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRecoveryRestore(item)}
                      className="rounded bg-blue-600 px-2.5 py-1 text-[11px] text-white hover:bg-blue-700"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRecoveryDiscard(item.doc_path)}
                      className="rounded border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
                    >
                      丢弃
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => void handleRecoveryDiscardAll()}
                className="text-[11px] text-gray-400 hover:text-rose-500"
              >
                全部丢弃
              </button>
              <button
                type="button"
                onClick={() => setRecoveryModal(null)}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                稍后处理
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}
