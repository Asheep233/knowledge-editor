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
import { AppShell } from './components/shell/AppShell'
import { Icon } from './components/icons'
import { StatusBar, StatusBarPath } from './components/shell/StatusBar'
import { isDesktop, pickDirectory } from './desktop'
import { applyTheme, loadSettings, type AppSettings } from './settings'
import { shouldBlockUnload } from './state/closeGuard'
import { classifyFsEvent } from './state/fsEvent'
import { createRequestSeq, openWithSeq, shouldAcceptSave } from './state/requestSeq'
import { recoveryCheckShouldRun } from './state/recovery'
import { abortPending, flushPending, flushPendingAll, flushWithTimeout, pendingDocIds } from './state/saveQueue'
import { planStartup } from './state/settingsGates'
import { APP_VERSION } from './version'
import type { ArticleMeta, FsEvent, HealthInfo, RecoveryItem, WorkspaceState } from './types'
import type { TreeNode } from './utils/tree'

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
  /** P2-7：设置已加载（供启动时 restoreLastState / autoOpenRecentWorkspace 接线） */
  const [settingsReady, setSettingsReady] = useState(false)
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
  // 原生菜单 refresh-recent 事件：历史遗留 → 保留状态以防 future 重新接线（当前无 UI 消费）。
  const [, setWsMenuOpen] = useState(false)
  /** Phase 7 M3：设置面板开关 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Phase 6.2：启动时检测到的未恢复内容 */
  const [recoveryModal, setRecoveryModal] = useState<RecoveryItem[] | null>(null)
  const recoveryCheckedFor = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eventCursor = useRef(0)
  const lastSavedAt = useRef(new Map<string, number>())
  const treeRefreshTimer = useRef<number | null>(null)
  // P0-2/P1-7：当前打开文档 id 的 ref（供事件/保存回调读最新，规避 stale closure）
  const articleIdRef = useRef<string | null>(null)
  useEffect(() => {
    articleIdRef.current = article?.id ?? null
  }, [article?.id])
  // P1-7：打开请求序号，防止旧响应覆盖后发起的请求
  const openSeqRef = useRef(createRequestSeq())
  // R2：外部版本重载令牌（同 id 下强制编辑器重载磁盘内容）
  const [reloadToken, setReloadToken] = useState(0)
  // P3-8：恢复检测失败标记（允许重试）
  const recoveryLastFailedRef = useRef(false)
  // P1-7：loading 计数（多请求并发时不误清空 spinner）
  const loadingCountRef = useRef(0)
  // P2-7：启动时读取的设置快照（供 restoreLastState / autoOpenRecentWorkspace 接线）
  const settingsRef = useRef<AppSettings | null>(null)

  const hasUnsaved = saveState === 'dirty' || saveState === 'saving' || saveState === 'error'
  const saveStateLabel =
    saveState === 'dirty'
      ? '未保存'
      : saveState === 'saving'
        ? '保存中…'
        : saveState === 'saved'
          ? '已保存'
          : saveState === 'error'
            ? '保存失败'
            : ''

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
        if (!alive) return
        applyTheme(s.ui.theme, s.ui.accentColor)
        settingsRef.current = s
        // 主题变化后通知下游（若有依赖设置的组件需要重读设置缓存）。
        setSettingsReady(true)
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
  // 每个工作区打开时检测一次未恢复的编辑内容；用户可恢复/丢弃/稍后处理。
  // P3-8：检测失败后重置 ref 允许下次重试；「稍后处理」后有顶栏「恢复检查…」再入口。
  useEffect(() => {
    if (!workspace?.open || !workspace.root) return
    if (
      !recoveryCheckShouldRun({
        checkedRoot: recoveryCheckedFor.current,
        root: workspace.root,
        lastFailed: recoveryLastFailedRef.current,
      })
    )
      return
    recoveryCheckedFor.current = workspace.root
    listRecovery()
      .then((payload) => {
        recoveryLastFailedRef.current = false
        if (payload.count > 0) setRecoveryModal(payload.items)
      })
      .catch(() => {
        // P3-8：失败后保留 ref 状态 + 标记失败，允许下一次（用户手动「恢复检查…」/重建根）重试
        recoveryLastFailedRef.current = true
        recoveryCheckedFor.current = null
      })
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

  const handleFsEvent = useCallback((ev: FsEvent) => {
    // 读最新 id 而非闭包捕获的旧 article（P1-8 stale closure）
    const currentId = articleIdRef.current
    const lastSaved = currentId ? (lastSavedAt.current.get(currentId) ?? 0) : 0
    const decision = classifyFsEvent(ev, { currentId, lastSavedAt: lastSaved })
    // 树刷新（防抖合并；自身操作导致的事件也安全，刷新幂等）
    if (decision.refreshTree) {
      if (treeRefreshTimer.current) window.clearTimeout(treeRefreshTimer.current)
      treeRefreshTimer.current = window.setTimeout(() => setTreeRefresh((n) => n + 1), 300)
    }
    if (decision.surface === 'modified') {
      setExtModal(ev)
    } else if (decision.surface === 'deleted') {
      // P3-7：当前文档被外部删除了 → 提示 + 清空当前编辑
      setArticle(null)
      setSaveState('idle')
      window.alert('当前文档已被外部删除')
    }
  }, [])

  const openArticle = useCallback(async (id: string) => {
    loadingCountRef.current += 1
    setLoading(true)
    try {
      await openWithSeq(id, {
        fetchFn: async (docId) => {
          const doc = await getArticle(docId)
          recordRecentDocument(docId, doc.title).catch(() => undefined)
          return doc
        },
        seq: openSeqRef.current,
        apply: (doc) => {
          setArticle(doc)
          // P2-7：记住上次打开的文档，供 restoreLastState 启动恢复
          try {
            localStorage.setItem('ke.lastArticleId', doc.id)
          } catch {
            /* localStorage 不可用忽略 */
          }
        },
      })
    } catch (e) {
      console.error('打开文档失败', e)
    } finally {
      loadingCountRef.current -= 1
      if (loadingCountRef.current <= 0) {
        loadingCountRef.current = 0
        setLoading(false)
      }
    }
  }, [])

  // P0-2：统一的「替换当前文档」入口。存在未保存/保存中/错误时先 flushPending
  // （带 3s 超时再强切），并用 confirm 兜底，避免防抖窗口内切换静默丢失输入。
  const requestOpenArticle = useCallback(
    async (id: string) => {
      if (hasUnsaved && articleIdRef.current) {
        const flushed = await flushWithTimeout(articleIdRef.current)
        if (!flushed && !window.confirm('当前有未保存修改，切换将放弃这些修改，是否继续？')) {
          return
        }
      }
      await openArticle(id)
    },
    [hasUnsaved, openArticle],
  )

  // ---------- 异常恢复动作（Phase 6.2） ----------
  const handleRecoveryRestore = useCallback(
    async (item: RecoveryItem) => {
      try {
        const doc = await restoreRecovery(item.doc_path)
        setRecoveryModal((prev) => (prev ? prev.filter((i) => i.doc_path !== item.doc_path) : null))
        setTreeRefresh((n) => n + 1)
        await requestOpenArticle(doc.id)
      } catch (e) {
        window.alert(`恢复失败：${e instanceof Error ? e.message : String(e)}`)
        // 记录可能已清除，刷新弹窗列表
        listRecovery()
          .then((p) => setRecoveryModal(p.count > 0 ? p.items : null))
          .catch(() => undefined)
      }
    },
    [requestOpenArticle],
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
  // P1-7：仅当保存的 doc.id 仍等于「当前打开文档」时才 setArticle（经 ref 读最新 id）
  const handleSaved = useCallback((id: string, doc?: ArticleMeta) => {
    lastSavedAt.current.set(id, Date.now())
    if (doc && shouldAcceptSave(id, articleIdRef)) setArticle(doc)
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
  // R2：用户选择「重新加载外部版本」= 以磁盘内容为准。
  // 1) abortPending 取消未决**并中止在途**保存（否则自动保存把本地旧内容写回、覆盖外部版本）；
  // 2) 等待保存链收尾（保证重载看到的 = 最终落盘内容，无乱序）；
  // 3) openArticle 拉取磁盘版本 + reloadToken 强制编辑器重载
  //    （id 相同导致 [article?.id] effect 不触发的旧缺陷）。
  const handleReloadExternal = useCallback(async () => {
    const rel = extModal?.rel
    setExtModal(null)
    if (!rel) return
    if (hasUnsaved && !window.confirm('当前有未保存修改，重新加载将丢失这些修改，是否继续？')) {
      return
    }
    abortPending(rel)
    await flushPending(rel)
    await openArticle(rel)
    setReloadToken((t) => t + 1)
  }, [extModal, hasUnsaved, openArticle])

  const handleKeepLocal = useCallback(() => {
    setExtModal(null)
  }, [])

  const applyWorkspace = useCallback((state: WorkspaceState) => {
    // F04：切换工作区推进打开序号——旧工作区的迟到 GET 不得渗入新工作区
    openSeqRef.current.next()
    setWorkspace(state)
    setArticle(null)
    setSaveState('idle')
    setTreeRefresh((n) => n + 1)
    eventCursor.current = 0
    lastSavedAt.current.clear()
    setFirstRun(false)
  }, [])

  // ---------- Workspace 切换（未保存确认，Phase 4 补充约束 1） ----------
  // F02：切换前先 flush 未决保存（内容落到旧 workspace root），
  // 避免后端 root 已切换后保存回调把 ws1 内容写入 ws2 同相对路径文件。
  const switchWorkspace = useCallback(
    async (path: string, mode: 'open' | 'create') => {
      if (hasUnsaved && articleIdRef.current) {
        const flushed = await flushWithTimeout(articleIdRef.current)
        if (!flushed && !window.confirm('当前文档有未保存修改，切换工作区将放弃这些修改，是否继续？')) {
          return
        }
      }
      try {
        const state = mode === 'create' ? await createWorkspace(path) : await openWorkspace(path)
        applyWorkspace(state)
      } catch (e) {
        window.alert(`${mode === 'create' ? '创建' : '打开'}失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [hasUnsaved, applyWorkspace],
  )

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
    if (hasUnsaved && articleIdRef.current) {
      // F02：关闭前先 flush 未决保存（与 switchWorkspace 同款），防跨工作区串写
      const flushed = await flushWithTimeout(articleIdRef.current)
      if (!flushed && !window.confirm('当前文档有未保存修改，关闭工作区将放弃这些修改，是否继续？')) {
        return
      }
    }
    await closeWorkspace()
    applyWorkspace({ open: false })
  }, [hasUnsaved, applyWorkspace])

  const handleNewArticle = useCallback(async () => {
    // P0-2：新建会替换当前文档，先处理未保存修改（flush + confirm 兜底）
    if (hasUnsaved && articleIdRef.current) {
      const flushed = await flushWithTimeout(articleIdRef.current)
      if (!flushed && !window.confirm('当前有未保存修改，新建将放弃这些修改，是否继续？')) return
    }
    const title = window.prompt('文档标题', `新文档 ${new Date().toLocaleDateString()}`)
    if (!title) return
    try {
      // F04：新建文档推进打开序号——迟到在途 GET 不得覆盖新建文档视图
      openSeqRef.current.next()
      const created = await createArticle(title)
      setArticle(created)
      setTreeRefresh((n) => n + 1)
    } catch (e) {
      console.error('新建文档失败', e)
      window.alert(String(e))
    }
  }, [hasUnsaved])

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
        await requestOpenArticle(result.id)
        window.alert(`导入成功：${result.title}`)
      } catch (e) {
        console.error('导入失败', e)
        window.alert(`导入失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [hasUnsaved, requestOpenArticle],
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
        await requestOpenArticle(m.to)
      }
    },
    [article, requestOpenArticle],
  )

  // R1-B：文件树重命名/移动/删除当前文档（或其所在目录）前，先 flush 未决保存。
  // 必须在后端执行变更前调用——变更后旧路径已不存在，flush 会 404 且编辑器
  // 被磁盘内容覆盖，未保存输入静默丢失。
  const handleBeforeFsMutation = useCallback(async (node: TreeNode): Promise<boolean> => {
    const curId = articleIdRef.current
    if (!curId) return true
    const affected =
      node.type === 'folder' ? curId.startsWith(node.relPath + '/') : curId === node.relPath
    if (!affected) return true
    const flushed = await flushWithTimeout(curId)
    if (!flushed) {
      return window.confirm('当前文档有未保存修改，此操作将放弃这些修改，是否继续？')
    }
    return true
  }, [])

  // ---------- P3-8：「恢复检查…」再入口（稍后处理后可手动重新检测） ----------
  const runRecoveryCheck = useCallback(async () => {
    if (!workspace?.root) return
    try {
      const payload = await listRecovery()
      recoveryLastFailedRef.current = false
      recoveryCheckedFor.current = workspace.root
      setRecoveryModal(payload.count > 0 ? payload.items : null)
    } catch {
      recoveryLastFailedRef.current = true
    }
  }, [workspace?.root])

  // ---------- P0-2：beforeunload 防静默丢失（浏览器仅显示确认） ----------
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (shouldBlockUnload(pendingDocIds().length, hasUnsaved)) {
        // 尽力 flush 未决保存（真正的兜底由桌面 close-requested 握手完成）
        void flushPendingAll()
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsaved])

  // ---------- P2-7：启动时接线 restoreLastState / autoOpenRecentWorkspace ----------
  const startupAppliedRef = useRef(false)
  useEffect(() => {
    if (!settingsReady || !settingsRef.current || !workspaceChecked) return
    if (startupAppliedRef.current) return
    const s = settingsRef.current
    let lastArticleId: string | null = null
    try {
      lastArticleId = localStorage.getItem('ke.lastArticleId')
    } catch {
      /* ignore */
    }
    const decide = (hasRecentWorkspace: boolean) => {
      const plan = planStartup({
        autoOpenRecentWorkspace: s.startup.autoOpenRecentWorkspace,
        restoreLastState: s.startup.restoreLastState,
        hasRecentWorkspace,
        hasLastArticle: lastArticleId !== null,
      })
      if (plan.restoreLastArticle && lastArticleId) void openArticle(lastArticleId)
      if (plan.autoOpenRecentWorkspace && workspace?.open) {
        getRecentWorkspaces()
          .then((r) => {
            const valid = r.workspaces.find((w) => w.exists)
            if (valid && valid.path !== workspace?.root) void switchWorkspace(valid.path, 'open')
          })
          .catch(() => undefined)
      }
    }
    if (s.startup.autoOpenRecentWorkspace) {
      getRecentWorkspaces()
        .then((r) => decide(!!r.workspaces.find((w) => w.exists)))
        .catch(() => decide(false))
    } else {
      decide(false)
    }
    startupAppliedRef.current = true
  }, [settingsReady, settingsRef, workspaceChecked, workspace?.open, workspace?.root, openArticle, switchWorkspace])

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
        listen('ke-menu:new-workspace', () => void handleCreateWorkspaceMenu()),
        listen('ke-menu:close-workspace', () => void handleCloseWorkspace()),
        listen('ke-menu:recovery-check', () => void runRecoveryCheck()),
        listen('ke-menu:settings', () => setSettingsOpen(true)),
        listen<{ path: string }>('ke-menu:open-recent', (e) => {
          const p = e.payload?.path
          if (p) void switchWorkspace(p, 'open')
        }),
        // P3-21：Rust 不再静态构建最近列表、也不 emit open-recent；改为 emit
        // refresh-recent（无 payload）。前端收到后打开工作区菜单（复用 switchWorkspace，
        // 展示当前工作区与打开/新建/关闭/恢复检查入口）。若后续需要真正展示最近列表，
        // 可在此处从 /api/workspace/recent 拉取后注入菜单。
        listen('ke-menu:refresh-recent', () => {
          setWsMenuOpen(true)
        }),
      ])
      if (disposed) un.forEach((f) => f())
      else unlisteners.push(...un)
    })
    return () => {
      disposed = true
      unlisteners.forEach((f) => f())
    }
  }, [handleNewArticle, handleOpenWorkspaceMenu, handleCreateWorkspaceMenu, handleCloseWorkspace, runRecoveryCheck, switchWorkspace])

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
    <>
    <AppShell
      header={
        <>
        {/* 菜单栏由桌面壳 Tauri 原生菜单（menu.rs）提供，前端不再 mock，避免重复 */}
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
        </>
      }
      left={
        <LeftSidebar
          activeId={article?.id ?? null}
          onOpenArticle={requestOpenArticle}
          refreshKey={treeRefresh}
          onFsMutation={handleFsMutation}
          onBeforeFsMutation={handleBeforeFsMutation}
          onOpenSettings={() => setSettingsOpen(true)}
          workspaceRoot={workspace?.root ?? null}
        />

      }
      main={
        <EditorArea
          article={article}
          loading={loading}
          reloadToken={reloadToken}
          onNewArticle={handleNewArticle}
          onSaveStateChange={setSaveState}
          onSaved={handleSaved}
          onArticleRestored={setArticle}
          onRenamed={(from, to, newTitle) => {
            // 页眉标题重命名成功：刷新树 + 更新当前文章（路径/标题已变）
            setArticle((prev) => (prev && prev.id === from ? { ...prev, id: to, path: to, title: newTitle } : prev))
            setTreeRefresh((n) => n + 1)
          }}
        />
      }
      right={
        rightOpen ? (
          <RightPanel
            article={article}
            onMetaUpdate={setArticle}
            onOpenArticle={requestOpenArticle}
            onCollapse={() => toggleRight(false)}
            onOpenHistory={() => window.dispatchEvent(new CustomEvent('ke:open-history'))}
            lastSnapshotAt={article ? new Date(lastSavedAt.current.get(article.id) ?? Date.now()).toISOString() : undefined}
          />
        ) : (
          <button
            type="button"
            onClick={() => toggleRight(true)}
            title="展开右侧面板（大纲 / 属性 / 附件）"
            className="flex w-6 shrink-0 items-center justify-center self-stretch border-l border-gray-200 bg-white text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <Icon name="chevron-left" className="size-4" />
          </button>
        )
      }
      statusBar={
        <StatusBar>
          <span>{article ? `${article.title} · ${article.word_count ?? 0} 字` : '未打开文档'}</span>
          <span>本地存储 · 自动保存已开启</span>
          <span className="text-muted-foreground/80">{saveStateLabel}</span>
          {backendDown ? (
            <span className="flex items-center gap-1 text-rose-600">
              <span className="size-1.5 rounded-full bg-red-500" /> 后端未连接
            </span>
          ) : (
            <>
              {versionMismatch && health ? (
                <span className="flex items-center gap-1 text-amber-700" title="前后端版本不一致，可能运行的是旧代码；建议执行 .\scripts\start.ps1 重启">
                  <Icon name="alert" className="size-3" />
                  版本不一致（前端 v{APP_VERSION} / 后端 v{health.version}）
                </span>
              ) : null}
              <span className="opacity-70">后端 v{health?.version ?? ''}</span>
            </>
          )}
          <StatusBarPath path={workspace?.root ?? ''} />
        </StatusBar>
      }
    />

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
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:brightness-95"
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
                      className="rounded bg-primary px-2.5 py-1 text-[11px] text-primary-foreground hover:brightness-95"
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
    </>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}
