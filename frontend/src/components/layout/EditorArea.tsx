/**
 * 中间编辑区（Phase 2）：Tiptap 编辑器接入。
 * 数据流（约束 1）：Markdown -> Document Model（Tiptap）-> Markdown Serializer -> 保存
 * 保存链路（约束 p2f）：3s 防抖自动保存 + Ctrl+S 立即保存 + 原子写入（后端）。
 */
import { EditorContent, EditorContext, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  discardRecovery,
  listHistory,
  previewHistory,
  registerRecovery,
  renameDoc,
  restoreHistory,
  saveArticle,
  updateArticleMeta,
} from '../../api/client'
import { setKeContent, useKeEditor } from '../../editor'
import { keExportPayload, packageExportAndSave, plainExportPayload, runExport } from '../../editor/export-actions'
import { KE_VERSION, stripFrontmatter, withFrontmatter } from '../../editor/ke'
import { getAutosaveIntervalMs } from '../../settings'
import { enqueueSave, flushPending, flushWithTimeout, type SaveFn } from '../../state/saveQueue'
import { slugify } from '../../utils/slug'
import type { ArticleMeta, HistoryVersion } from '../../types'
import { Icon } from '../icons'
import EditorToolbar from '../editor/EditorToolbar'
import TableBubbleMenu from '../editor/TableBubbleMenu'

interface Props {
  article: ArticleMeta | null
  loading: boolean
  onNewArticle: () => void
  onSaveStateChange?: (state: SaveState) => void
  /** 保存成功回调（App 用于记录时间戳 + 同步最新文档状态，兜底抑制外部修改误报） */
  onSaved?: (id: string, doc?: ArticleMeta) => void
  /** Phase 6.3：历史版本恢复后更新 App 层文档（标题/元信息等） */
  onArticleRestored?: (doc: ArticleMeta) => void
  /** 页眉标题重命名成功（文件名 + frontmatter 均已更新）：App 同步树/激活态 */
  onRenamed?: (from: string, to: string, newTitle: string) => void
  /** R2：外部版本重载令牌。App 调 handleReloadExternal 后 +1，同一文档 id
   * 下强制编辑器重载磁盘内容（id 变化之外的显式 reload 触发源）。 */
  reloadToken?: number
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const SAVE_LABEL: Record<SaveState, { text: string; cls: string; kind: SaveState }> = {
  idle: { text: '', cls: '', kind: 'idle' },
  dirty: { text: '未保存…', cls: 'text-amber-600 font-medium', kind: 'dirty' },
  saving: { text: '保存中…', cls: 'text-blue-600 font-medium', kind: 'saving' },
  saved: { text: '已保存', cls: 'text-emerald-600', kind: 'saved' },
  error: { text: '保存失败', cls: 'text-rose-600 font-medium', kind: 'error' },
}

export default function EditorArea({ article, loading, onNewArticle, onSaveStateChange, onSaved, onArticleRestored, onRenamed, reloadToken = 0 }: Props) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 拖拽附件悬停遮罩（实际插入由 editorProps.handleDrop 完成）
  const [dragOver, setDragOver] = useState(false)
  // Phase 6.3：历史版本面板
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<HistoryVersion[]>([])
  // P2-8：历史加载失败不再是「空列表」，而是明确错误提示
  const [historyError, setHistoryError] = useState('')
  const [previewing, setPreviewing] = useState<HistoryVersion | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  // 是否正在查看「当前版本」（只读预览当前文档正文）
  const [showCurrent, setShowCurrent] = useState(false)
  // 编辑序号：每次内容变更递增。保存完成时与触发时的序号比对，
  // 若保存期间有新编辑则保持「未保存」，否则判定为「已保存」。
  const editSeqRef = useRef(0)
  // Phase 6.4：ref 版本，供防抖保存回调在任意时刻拿到最新 editor/article
  const editorRef = useRef<Editor | null>(null)
  const articleRef = useRef(article)
  // P0-2：切换文档时记住「上一文档 id」，以便把其未决防抖保存 flush 掉，不静默丢失输入。
  const prevArticleIdRef = useRef<string | null>(null)

  useEffect(() => {
    articleRef.current = article
  }, [article])

  // 页眉标题编辑（dual-title 修复）：编辑态 → blur 时同步 frontmatter title；
  // 文件名同步：仅当 slug 变化时重命名（409 时保留 meta title 并提示）。
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  useEffect(() => {
    setTitleDraft(null)
  }, [article?.id])
  const handleTitleBlur = useCallback(async () => {
    if (!article || titleDraft === null) return
    const next = titleDraft.trim()
    setTitleDraft(null)
    if (!next || next === article.title) return
    try {
      // R1：改名是「路径变更」——先 flush 未决防抖保存（否则改名后旧路径
      // PUT 404 被吞、editor 被陈旧 article.content 快照重置，输入静默抹掉）。
      // 与 requestOpenArticle 同款 3s 超时兜底：超时则让用户显式确认。
      const docId = article.id
      if (!(await flushWithTimeout(docId))) {
        if (!window.confirm('当前有未保存修改且保存超时，继续改名将丢弃这些修改，是否继续？')) return
      }
      // 1) frontmatter/meta title（展示与列表立即同步）
      await updateArticleMeta(docId, { title: next })
      // 2) 文件名同步（slug 变化时重命名；失败不阻塞已完成的 meta 更新）
      // F11：oldSlug 取文件名基线（含子目录文档）；旧实现 replace(/^Articles\//)
      // 对「Articles/Sub/note.md」得「Sub/note」，与 slugify 输出永不相等，
      // 导致子目录文档每次改标题都触发 rename 撞自身 409 误报。
      const base = docId.split('/').pop() ?? docId
      const oldSlug = base.replace(/\.(md|markdown)$/i, '')
      const newSlug = slugify(next)
      if (newSlug && newSlug !== oldSlug) {
        const res = await renameDoc(docId, `${newSlug}.md`)
        onRenamed?.(res.from, res.to, next)
        return
      }
      onRenamed?.(docId, docId, next)
    } catch (e) {
      window.alert(`标题保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [article, titleDraft, onRenamed])

  // 保存状态上报（App 导入前检查是否有未保存修改）
  useEffect(() => {
    onSaveStateChange?.(saveState)
  }, [saveState, onSaveStateChange])

  // 加载时剥离 frontmatter（仅正文进入 Document Model）；保存时写回版本头。
  // 版本信息随 Markdown 文件本身存储，文档移动/复制后仍然存在。
  // Phase 6.4：击键时只标记 dirty 并防抖，序列化延迟到保存那一刻执行
  // （ed.getMarkdown()），避免大文档每次击键都全量序列化导致输入卡顿。
  // 恢复点登记/清除（Phase 6.2 契约：保存前登记草稿，保存成功后清除；
  // 保存中断/异常退出时恢复点保留，下次启动由 App 检测弹窗）。
  // 登记/清除失败不阻断保存主流程：登记失败仅失去崩溃恢复能力，
  // 清除失败则留待下次启动由用户选择丢弃。
  const registerRecoveryPoint = useCallback(async (docId: string, md: string) => {
    try {
      await registerRecovery(docId, md)
    } catch {
      /* 忽略：恢复点登记为辅助能力 */
    }
  }, [])

  const clearRecoveryPoint = useCallback(async (docId: string) => {
    try {
      await discardRecovery(docId)
    } catch {
      /* 忽略：幂等清除失败可下次启动处理 */
    }
  }, [])

  // 保存函数构造：读取当前编辑器正文、登记/清除恢复点、更新 saveState 与 onSaved。
  // 经 saveQueue 串行化（P1-6：同一 doc 至多一个在途保存，latest-wins），
  // 并仅在「本次保存对应序号仍为最新」时判定已保存/清除恢复点（P0-2/P1-6）。
  const buildSaveFn = useCallback(
    (docId: string): SaveFn => {
      return async () => {
        const ed = editorRef.current
        if (!ed) return
        const seq = editSeqRef.current
        const isCurrent = articleRef.current?.id === docId
        const md = withFrontmatter(ed.getMarkdown(), KE_VERSION)
        try {
          if (isCurrent) setSaveState('saving')
          await registerRecoveryPoint(docId, md)
          const saved = await saveArticle(docId, md)
          const latest = editSeqRef.current === seq
          if (isCurrent) setSaveState(latest ? 'saved' : 'dirty')
          onSaved?.(docId, saved)
          if (latest) void clearRecoveryPoint(docId)
        } catch (e) {
          if (isCurrent) setSaveState('error')
          // P3-7：保存时 404 说明文档已被外部删除，明确提示而非静默失败
          if (is404Error(e)) window.alert('保存失败：文档已被删除（404）')
        }
      }
    },
    [onSaved, registerRecoveryPoint, clearRecoveryPoint],
  )

  const handleUpdate = useCallback(() => {
    if (!articleRef.current) return
    editSeqRef.current += 1
    setSaveState('dirty')
    // M3：自动保存间隔由应用设置驱动（默认 3000ms）。统一走 saveQueue：
    // 同一 doc 防抖合并；在途时 latest-wins；完成后若有新内容再补一次。
    const docId = articleRef.current.id
    enqueueSave(docId, buildSaveFn(docId), getAutosaveIntervalMs())
  }, [buildSaveFn])

  // Phase 6.4：content 固定为空，文档内容统一由下方 useEffect 的
  // setKeContent 加载一次，避免初始化与切换时重复解析大文档（Document Model）。
  const editor = useKeEditor({
    content: '',
    onUpdate: handleUpdate,
    editable: !!article,
  })

  // 编辑器实例同步到 ref（防抖保存回调使用）
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // 文档切换：flush 上一文档的未决防抖保存（P0-2，不再丢弃输入），再重载内容。
  // R2：reloadToken 变化（同一文档的外部版本重载）也触发重载，但跳过 flush
  // （id 未变，无「上一文档」；未决保存已由 App.handleReloadExternal 取消）。
  useEffect(() => {
    const newId = article?.id ?? null
    const prevId = prevArticleIdRef.current
    if (prevId && prevId !== newId) {
      // 切换离开旧文档：立即触发其未决保存，避免防抖窗口内输入静默丢失
      void flushPending(prevId)
    }
    prevArticleIdRef.current = newId
    setSaveState('idle')
    if (editor && article) setKeContent(editor, stripFrontmatter(article.content).content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id, reloadToken])

  // 可编辑状态跟随文档打开状态：
  // useEditor 的 editable 仅在创建时生效（挂载时 article=null 会以只读创建），
  // 打开/关闭文档时必须显式 setEditable 同步。
  // 注意：Tiptap setEditable 默认 emitUpdate=true 会派发 update 事件，
  // 若保存后 setArticle 触发的重渲染无条件调用它，会把刚判定的「已保存」
  // 又刷回「未保存」。因此仅在状态真正变化时调用，并传 emitUpdate=false 抑制事件。
  useEffect(() => {
    if (!editor) return
    const next = !!article
    if (editor.isEditable !== next) editor.setEditable(next, false)
  }, [editor, article])

  // Ctrl+S / 保存按钮：立即保存（覆盖未决防抖，经 saveQueue 串行化）
  const saveNow = useCallback(async () => {
    const doc = articleRef.current
    if (!editor || !doc) return
    // 手动保存覆盖未决的防抖自动保存：以 debounce=0 立即入队并串行化；
    // 内容已在 in-flight 时则 latest-wins，保存后不会二次提交冗余内容。
    await enqueueSave(doc.id, buildSaveFn(doc.id), 0)
  }, [editor, buildSaveFn])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow])

  // 导出 Markdown 单文件（内容来自 Markdown Serializer，不修改原文件）
  const handleExportMarkdown = useCallback(() => {
    if (!editor || !article) return
    void runExport(keExportPayload(editor, article.title))
  }, [editor, article])

  // 导出「普通 Markdown」（朴素降级版）：KE 方言 → 标准 Markdown，
  // 不含 ke_version 与任何 ke-* 注释（见 docs/knowledge-editor-plain-export-design.md）
  const handleExportPlainMarkdown = useCallback(() => {
    if (!editor || !article) return
    void runExport(plainExportPayload(editor, article))
  }, [editor, article])

  // 导出文档包 .zip（序列化 + 收集附件引用 → 后端打包）
  const handleExportPackage = useCallback(async () => {
    if (!editor || !article || exporting) return
    setExporting(true)
    setExportOpen(false)
    try {
      const md = withFrontmatter(editor.getMarkdown(), KE_VERSION)
      await packageExportAndSave(article.title, md)
    } catch (e) {
      window.alert(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }, [editor, article, exporting])

  // 未决自动保存交由模块级 saveQueue 持有一律下发到后端；EditorArea 卸载时
  // 不再丢失 pending（关闭窗口的 flush 握手由 App 的 beforeunload / close-requested 处理）。

  // ---------- 历史版本（Phase 6.3） ----------
  const loadHistory = useCallback(async () => {
    if (!article) return
    setHistoryError('')
    try {
      const payload = await listHistory(article.id)
      setVersions(payload.versions)
    } catch (e) {
      // P2-8：区分「暂无版本」与「加载失败」
      setVersions([])
      setHistoryError(e instanceof Error ? e.message : String(e))
    }
  }, [article])

  const handleOpenHistory = useCallback(() => {
    setHistoryOpen(true)
    setPreviewing(null)
    setPreviewContent(null)
    setShowCurrent(false)
    void loadHistory()
  }, [loadHistory])

  // 右栏 HistorySnapshotsCard「查看历史」桥：监听全局事件（App 层转发）
  useEffect(() => {
    const onOpen = () => handleOpenHistory()
    window.addEventListener('ke:open-history', onOpen)
    return () => window.removeEventListener('ke:open-history', onOpen)
  }, [handleOpenHistory])

  const handlePreviewCurrent = useCallback(() => {
    if (!article || !editor) return
    setPreviewing(null)
    setShowCurrent(true)
    // 实时取编辑器当前正文（与所见一致）；不依赖 article.content，
    // 避免保存成功后 article 状态未刷新导致预览陈旧（Phase 6E 修复）。
    setPreviewContent(editor.getMarkdown())
  }, [article, editor])

  const handlePreviewVersion = useCallback(
    async (v: HistoryVersion) => {
      if (!article) return
      setPreviewing(v)
      setShowCurrent(false)
      setPreviewContent(null)
      try {
        const payload = await previewHistory(article.id, v.id)
        // 只读预览：剥离 frontmatter 版本头，展示正文
        const body = stripFrontmatter(payload.content).content || payload.content
        setPreviewContent(body)
      } catch {
        setPreviewContent('（预览加载失败）')
      }
    },
    [article],
  )

  const handleRestoreVersion = useCallback(
    async (v: HistoryVersion) => {
      if (!article || !editor) return
      // 边界处理（规格 6.3.4）：存在未保存修改时先提醒
      if (saveState === 'dirty' || saveState === 'saving' || saveState === 'error') {
        if (!window.confirm('当前有未保存修改，恢复历史版本将丢失这些修改，是否继续？')) return
      }
      if (!window.confirm('恢复此版本将替换当前文档内容，是否继续？')) return
      try {
        setSaveState('saving')
        const doc = await restoreHistory(article.id, v.id)
        // 刷新编辑器内容（Document Model）
        setKeContent(editor, stripFrontmatter(doc.content).content)
        setSaveState('saved')
        onSaved?.(article.id)
        onArticleRestored?.(doc)
        setHistoryOpen(false)
        void loadHistory()
      } catch (e) {
        window.alert(`恢复失败：${e instanceof Error ? e.message : String(e)}`)
        setSaveState('error')
      }
    },
    [article, editor, saveState, onSaved, onArticleRestored, loadHistory],
  )

  const saveInfo = SAVE_LABEL[saveState]

  // 参考稿工具栏右侧「导出 ▾」主按钮（--primary 底白字）
  const exportButton = article && editor ? (
    <div className="relative ml-1">
      <button
        type="button"
        onClick={() => setExportOpen((o) => !o)}
        disabled={exporting}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium text-primary-foreground transition-[filter,color,transform] duration-150 hover:brightness-95 active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40"
        style={{ backgroundColor: 'var(--primary)' }}
      >
        <Icon name="download" className="size-4" />
        <span>{exporting ? '打包中…' : '导出'}</span>
        <Icon name="chevron-down" className="size-3.5" />
      </button>
      {exportOpen ? (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-border bg-card py-1 shadow-md">
            <button
              type="button"
              onClick={() => {
                setExportOpen(false)
                handleExportMarkdown()
              }}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-accent"
            >
              导出 Markdown（KE 格式）
            </button>
            <button
              type="button"
              onClick={() => {
                setExportOpen(false)
                handleExportPlainMarkdown()
              }}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-accent"
            >
              导出普通 Markdown (.md)
            </button>
            <button
              type="button"
              onClick={() => void handleExportPackage()}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-accent"
            >
              导出文档包 (.zip)
            </button>
          </div>
        </>
      ) : null}
    </div>
  ) : null

  // 保存状态文字（参考稿「已保存」区）
  const saveLabel = saveInfo.text ? (
    <>
      {saveInfo.cls.includes('emerald') ? (
        <Icon name="circle-check" className="size-4" style={{ color: 'var(--chart-5)' }} />
      ) : saveInfo.kind === 'dirty' ? (
        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
      ) : saveInfo.kind === 'saving' ? (
        <span className="inline-block size-2 animate-pulse rounded-full" style={{ backgroundColor: 'var(--primary)' }} />
      ) : null}
      <span className={saveInfo.cls}>{saveInfo.text}</span>
    </>
  ) : null

  // 正文页眉（参考稿 §3.4：面包屑 + H1 + 元信息行 —— 只读展示，不进入 Markdown）
  const breadcrumb = useMemo(() => {
    if (!article) return []
    const seg = article.id.split('/').filter(Boolean)
    return seg
  }, [article])
  const docMeta = useMemo(() => {
    if (!article) return null
    const words = article.word_count ?? 0
    const tags = article.tags
    return {
      words: words >= 1000 ? `${words.toLocaleString('zh-CN')} 字` : `${words} 字`,
      tags: Array.isArray(tags) ? tags : typeof tags === 'string' && tags ? [tags] : [],
      updatedAt: article.updated_at ?? '',
    }
  }, [article])

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : article && editor ? (
        <EditorContext.Provider value={{ editor }}>
          <EditorToolbar
            saveLabel={saveLabel}
            onSave={() => void saveNow()}
            onOpenHistory={handleOpenHistory}
            exportButton={exportButton}
          />
          <TableBubbleMenu />
          <div
            className="ke-scroll relative flex-1 overflow-y-auto"
            onDragOver={(e) => {
              // 必须 preventDefault 才允许 drop；遮罩仅作视觉反馈，
              // 实际文件插入由 editorProps.handleDrop（PM 层）完成
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={(e) => {
              // 子元素进出会频繁触发 dragleave，仅当真正离开容器时清除
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
            }}
            onDrop={() => setDragOver(false)}
            onClick={(e) => {
              // 点击正文区域即聚焦可输入（正文字体）；
              // 但 NodeView 内部交互控件（公式 textarea、math-field、信息块输入等）
              // 不得抢占焦点，否则点击它们时光标会被强制移走。
              const t = e.target as HTMLElement
              if (t.closest('[contenteditable="false"], textarea, input, select, button, math-field')) return
              if (!editor.isFocused) editor.commands.focus()
            }}
          >
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-blue-400 bg-blue-50/70 text-sm font-medium text-blue-600">
                释放以添加附件（图片 / 视频 / 文件）
              </div>
            )}
            {/* 正文页眉：面包屑 + 元信息行（参考稿 §3.4；不序列化进 Markdown）
                与 EditorContent 的 ke-editor-prose 同一列宽/内边距（780px / 32px），保证标题与正文对齐 */}
            <article className="mx-auto w-full max-w-[780px] px-[32px] pb-2 pt-10">
              <div className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                <Icon name="folder" className="size-3.5" />
                {breadcrumb.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 ? <Icon name="chevron-right" className="size-3 opacity-70" /> : null}
                    <span>{seg.replace(/\.md$/, '')}</span>
                  </span>
                ))}
              </div>
              {/* 页眉标题：可编辑，blur 同步 frontmatter title + 文件名（dual-title 修复） */}
              <input
                value={titleDraft ?? article.title}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void handleTitleBlur()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  else if (e.key === 'Escape') setTitleDraft(null)
                }}
                title="标题（编辑后回车/失焦保存，同步文件名）"
                aria-label="文档标题"
                className="mt-4 block w-full bg-transparent text-[28px] font-bold leading-[1.25] outline-none"
                style={{ color: 'var(--foreground)' }}
              />
              {docMeta ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                  {docMeta.updatedAt ? (
                    <>
                      <span>更新于 {formatTime(docMeta.updatedAt)}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  ) : null}
                  <span>{docMeta.words}</span>
                  <span aria-hidden="true">·</span>
                  <span>KE v{KE_VERSION}</span>
                  {docMeta.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-[999px] px-2 py-[2px] text-[12px]"
                      style={{ backgroundColor: 'var(--secondary)', color: 'var(--accent-foreground)' }}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
            <EditorContent editor={editor} />
          </div>
        </EditorContext.Provider>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          {/* 空态线性图形：文档 + 编辑笔（纯装饰描边，非 emoji/占位图） */}
          <svg
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground/40"
            aria-hidden="true"
          >
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h6" />
            <path d="M9 17h4" />
            <path d="M15.5 3.5 18 6l-6 6-3 .5.5-3z" fill="currentColor" stroke="none" opacity="0.9" />
          </svg>
          <div>
            <p className="text-sm font-medium text-foreground/90">从左侧选择一篇文档，或新建一篇开始创作</p>
            <p className="mt-1 text-xs text-muted-foreground">Markdown 为唯一事实源，所有内容本地存储</p>
          </div>
          <button
            type="button"
            onClick={onNewArticle}
            className="mt-1 rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:brightness-95 active:scale-[0.97]"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            + 新建文档
          </button>
        </div>
      )}

      {/* 历史版本面板（Phase 6.3） */}
      {historyOpen && article && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25">
          <div className="flex h-[480px] w-[680px] flex-col rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">历史版本</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadHistory()}
                  className="text-[11px] text-gray-400 hover:text-gray-600"
                >
                  刷新
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 gap-3">
              {/* 版本列表 */}
              <div className="w-56 shrink-0 overflow-y-auto rounded border border-gray-100">
                <button
                  type="button"
                  onClick={handlePreviewCurrent}
                  className={`block w-full border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50 ${
                    showCurrent && !previewing ? 'bg-blue-50' : ''
                  }`}
                >
                  <span className="text-[11px] font-medium text-gray-700">当前版本</span>
                  <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                    当前
                  </span>
                  <div className="mt-0.5 text-[11px] text-gray-400">
                    {formatTime(article.updated_at ?? '')}
                  </div>
                </button>
                {historyError ? (
                  <div className="px-3 py-2 text-[11px] text-rose-500">
                    加载失败：{historyError}
                    <button
                      type="button"
                      className="ml-1 text-blue-600 hover:underline"
                      onClick={() => void loadHistory()}
                    >
                      重试
                    </button>
                  </div>
                ) : versions.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-gray-300">暂无历史版本</div>
                ) : (
                  versions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => void handlePreviewVersion(v)}
                      className={`block w-full border-b border-gray-50 px-3 py-2 text-left hover:bg-gray-50 ${
                        previewing?.id === v.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="text-[12px] text-gray-700">{formatTime(v.timestamp)}</div>
                      <div className="text-[10px] text-gray-400">{formatSize(v.size)}</div>
                    </button>
                  ))
                )}
              </div>
              {/* 只读预览 */}
              <div className="flex min-h-0 flex-1 flex-col">
                {previewing || showCurrent ? (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">
                        {showCurrent
                          ? '当前版本内容（只读）'
                          : `${formatTime(previewing?.timestamp ?? '')} 的历史内容（只读）`}
                      </span>
                      {previewing && !showCurrent && (
                        <button
                          type="button"
                          onClick={() => void handleRestoreVersion(previewing)}
                          className="rounded bg-primary px-3 py-1 text-[11px] text-primary-foreground hover:brightness-95"
                        >
                          恢复此版本
                        </button>
                      )}
                    </div>
                    <pre className="ke-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded border border-gray-100 bg-gray-50 p-3 text-[12px] leading-relaxed text-gray-700">
                      {previewContent ?? '加载中…'}
                    </pre>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-[12px] text-gray-300">
                    点击左侧版本查看内容预览
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 判定错误是否为「资源不存在」（用于保存 404 时提示文档已被外部删除）。 */
function is404Error(e: unknown): boolean {
  return e instanceof Error && /^404\b/.test(e.message.trim())
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
