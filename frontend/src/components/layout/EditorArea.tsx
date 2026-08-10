/**
 * 中间编辑区（Phase 2）：Tiptap 编辑器接入。
 * 数据流（约束 1）：Markdown -> Document Model（Tiptap）-> Markdown Serializer -> 保存
 * 保存链路（约束 p2f）：3s 防抖自动保存 + Ctrl+S 立即保存 + 原子写入（后端）。
 */
import { EditorContent, EditorContext, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  discardRecovery,
  exportPackage,
  listHistory,
  previewHistory,
  registerRecovery,
  restoreHistory,
  saveArticle,
} from '../../api/client'
import { setKeContent, useKeEditor } from '../../editor'
import { downloadBlob, extractAttachmentRefs, slugForDownload } from '../../editor/import-export'
import { KE_VERSION, stripFrontmatter, withFrontmatter } from '../../editor/ke'
import { getAutosaveIntervalMs } from '../../settings'
import type { ArticleMeta, HistoryVersion } from '../../types'
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
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const SAVE_LABEL: Record<SaveState, { text: string; cls: string }> = {
  idle: { text: '', cls: '' },
  dirty: { text: '未保存…', cls: 'text-gray-500' },
  saving: { text: '保存中…', cls: 'text-gray-500' },
  saved: { text: '已保存', cls: 'text-emerald-600' },
  error: { text: '保存失败', cls: 'text-rose-600' },
}

export default function EditorArea({ article, loading, onNewArticle, onSaveStateChange, onSaved, onArticleRestored }: Props) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 拖拽附件悬停遮罩（实际插入由 editorProps.handleDrop 完成）
  const [dragOver, setDragOver] = useState(false)
  // Phase 6.3：历史版本面板
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<HistoryVersion[]>([])
  const [previewing, setPreviewing] = useState<HistoryVersion | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  // 是否正在查看「当前版本」（只读预览当前文档正文）
  const [showCurrent, setShowCurrent] = useState(false)
  const debounceRef = useRef<number | null>(null)
  // 编辑序号：每次内容变更递增。保存完成时与触发时的序号比对，
  // 若保存期间有新编辑则保持「未保存」，否则判定为「已保存」。
  const editSeqRef = useRef(0)
  // Phase 6.4：ref 版本，供防抖保存回调在任意时刻拿到最新 editor/article
  const editorRef = useRef<Editor | null>(null)
  const articleRef = useRef(article)

  useEffect(() => {
    articleRef.current = article
  }, [article])

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

  const handleUpdate = useCallback(() => {
    if (!articleRef.current) return
    editSeqRef.current += 1
    const seq = editSeqRef.current
    setSaveState('dirty')
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    // M3：自动保存间隔由应用设置驱动（默认 3000ms），设置面板改动后即时生效
    debounceRef.current = window.setTimeout(async () => {
      const ed = editorRef.current
      const doc = articleRef.current
      if (!ed || !doc) return
      try {
        setSaveState('saving')
        const md = withFrontmatter(ed.getMarkdown(), KE_VERSION)
        await registerRecoveryPoint(doc.id, md)
        const saved = await saveArticle(doc.id, md)
        setSaveState(editSeqRef.current === seq ? 'saved' : 'dirty')
        onSaved?.(doc.id, saved)
        void clearRecoveryPoint(doc.id)
      } catch {
        setSaveState('error')
      }
    }, getAutosaveIntervalMs())
  }, [onSaved, registerRecoveryPoint, clearRecoveryPoint])

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

  // 文档切换：清理未决防抖并重载内容
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    setSaveState('idle')
    if (editor && article) setKeContent(editor, stripFrontmatter(article.content).content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id])

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

  // Ctrl+S / 保存按钮：立即保存
  const saveNow = useCallback(async () => {
    if (!editor || !article) return
    // 手动保存覆盖了未决的防抖自动保存：清掉定时器，避免保存后
    // 又触发一次冗余自动保存（内容已是最新，无需二次提交）。
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const seq = editSeqRef.current
    const md = withFrontmatter(editor.getMarkdown(), KE_VERSION)
    try {
      setSaveState('saving')
      await registerRecoveryPoint(article.id, md)
      const saved = await saveArticle(article.id, md)
      setSaveState(editSeqRef.current === seq ? 'saved' : 'dirty')
      onSaved?.(article.id, saved)
      void clearRecoveryPoint(article.id)
    } catch {
      setSaveState('error')
    }
  }, [editor, article, onSaved, registerRecoveryPoint, clearRecoveryPoint])

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
    const md = withFrontmatter(editor.getMarkdown(), KE_VERSION)
    downloadBlob(new Blob([md], { type: 'text/markdown' }), `${slugForDownload(article.title)}.md`)
  }, [editor, article])

  // 导出文档包 .zip（序列化 + 收集附件引用 → 后端打包）
  const handleExportPackage = useCallback(async () => {
    if (!editor || !article || exporting) return
    setExporting(true)
    setExportOpen(false)
    try {
      const md = withFrontmatter(editor.getMarkdown(), KE_VERSION)
      const refs = extractAttachmentRefs(md)
      const { blob, filename } = await exportPackage({ title: article.title, md, refs })
      downloadBlob(blob, filename)
    } catch (e) {
      window.alert(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }, [editor, article, exporting])

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [])

  // ---------- 历史版本（Phase 6.3） ----------
  const loadHistory = useCallback(async () => {
    if (!article) return
    try {
      const payload = await listHistory(article.id)
      setVersions(payload.versions)
    } catch {
      setVersions([])
    }
  }, [article])

  const handleOpenHistory = useCallback(() => {
    setHistoryOpen(true)
    setPreviewing(null)
    setPreviewContent(null)
    setShowCurrent(false)
    void loadHistory()
  }, [loadHistory])

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

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-white">
      {/* 文档标签栏 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3">
        <span className="max-w-[300px] truncate text-[13px] font-medium text-gray-800">
          {article?.title ?? '未打开文档'}
        </span>
        <span className={`ml-auto text-[11px] ${saveInfo.cls}`}>{saveInfo.text}</span>
        {article && editor ? (
          <div className="relative ml-1">
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              disabled={exporting}
              className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {exporting ? '打包中…' : '导出 ▾'}
            </button>
            {exportOpen ? (
              <>
                {/* 点击外部关闭 */}
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-md">
                  <button
                    type="button"
                    onClick={() => {
                      setExportOpen(false)
                      handleExportMarkdown()
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[12px] text-gray-700 hover:bg-gray-50"
                  >
                    导出 Markdown (.md)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportPackage()}
                    className="block w-full px-3 py-1.5 text-left text-[12px] text-gray-700 hover:bg-gray-50"
                  >
                    导出文档包 (.zip)
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void saveNow()}
          disabled={!article || loading}
          className="ml-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          保存
        </button>
        {article && editor ? (
          <button
            type="button"
            onClick={handleOpenHistory}
            title="历史版本（最近 30 份自动快照）"
            className="ml-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
          >
            历史
          </button>
        ) : null}
        {saveState === 'error' ? (
          <button
            type="button"
            onClick={() => void saveNow()}
            className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-100"
          >
            重试
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
          加载中…
        </div>
      ) : article && editor ? (
        <EditorContext.Provider value={{ editor }}>
          <EditorToolbar />
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
            <EditorContent editor={editor} />
          </div>
        </EditorContext.Provider>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-gray-500">从左侧选择一篇文档，或新建一篇开始创作</p>
          <button
            type="button"
            onClick={onNewArticle}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
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
                {versions.length === 0 ? (
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
                          className="rounded bg-blue-600 px-3 py-1 text-[11px] text-white hover:bg-blue-700"
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
