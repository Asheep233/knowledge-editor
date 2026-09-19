/**
 * 中间编辑区（Phase 2）：Tiptap 编辑器接入。
 * 数据流（约束 1）：Markdown -> Document Model（Tiptap）-> Markdown Serializer -> 保存
 * 保存链路（约束 p2f）：3s 防抖自动保存 + Ctrl+S 立即保存 + 原子写入（后端）。
 */
import { EditorContent, EditorContext, type Editor } from '@tiptap/react'
import { type MarkdownExtensionStorage } from '@tiptap/markdown'
import { TextSelection } from '@tiptap/pm/state'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  discardRecovery,
  getArticle,
  getModule,
  listHistory,
  listModules,
  previewHistory,
  registerRecovery,
  renameDoc,
  restoreHistory,
  saveArticle,
  updateArticleMeta,
  uploadAttachment,
} from '../../api/client'
import { openMathEditorById, setKeContent, useKeEditor } from '../../editor'
import { keExportPayload, packageExportAndSave, plainExportPayload, runExport } from '../../editor/export-actions'
import { applyDocTraits, captureDocTraits, frontmatterBlockOf, KE_VERSION, newId, stripFrontmatter, withFrontmatter, type DocTraits } from '../../editor/ke'
import { attachmentNode } from '../../editor/upload'
import { applyMathDeleteCursor, applyMathSaveCursor, isMathNode, locateMathById } from '../../editor/math/cursor'
import { getAutosaveIntervalMs } from '../../settings'
import { enqueueSave, flushPending, flushWithTimeout, type SaveFn } from '../../state/saveQueue'
import { createDraftDebounce, type DraftDebounce } from '../../state/draftDebounce'
import { createDeferredLoader, onDocumentSwitch, resolveRecoveryTarget, resolveSaveContent, type DeferredLoader } from '../../state/docSwitch'
import {
  buildSourceDraft,
  buildSourceSavePayload,
  getViewMode,
  hasUnknownKeMarkers,
  setViewMode as persistViewMode,
  sourceBodyOf,
  subscribeViewMode,
  unknownMarkersChanged,
  type ViewMode,
} from '../../state/viewMode'
import SourceModeView from '../editor/SourceModeView'
import { registerActionHandlers } from '../../state/shortcuts'
import { filenameFromTitle } from '../../utils/slug'
import type { ArticleMeta, HistoryVersion } from '../../types'
import { Icon } from '../icons'
import MathEditorModal from '../editor/MathEditorModal'
import { MATH_EDIT_EVENT, type MathEditRequest } from '../editor/nodeviews/MathNodeView'
import EditorToolbar, { stripModuleTitle } from '../editor/EditorToolbar'
import TableBubbleMenu from '../editor/TableBubbleMenu'
import { askConfirm, askPrompt } from '../common/PromptDialog'

/** 文件特征缺省值：UTF-8 无 BOM + LF（磁盘原文未捕获到时使用，等价于既有行为） */
const DEFAULT_DOC_TRAITS: DocTraits = { bom: false, eol: '\n' }

/**
 * F-5 接线：保存后「对齐比较」前的归一化 —— 去 BOM、CRLF→LF（规范 document-format.md §2.6）。
 *
 * 编辑器侧正文恒为 LF（`editor.getMarkdown()`），而服务端回包是**磁盘原样**（可能带 BOM/CRLF）。
 * 不归一化 → 每次保存都判「不一致」→ 反复 `setKeContent` 重载编辑器（F15 分支被误触发）。
 * 导出供 `docTraits-wiring.test.ts` 直接断言。
 */
export function normalizeForCompare(md: string): string {
  return applyDocTraits(md, DEFAULT_DOC_TRAITS)
}

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
  // v1.1.7 M2：全屏公式模态（编辑器根持有——PM 事务从根组件发起，nodeview 根会 #300）
  const [mathEdit, setMathEdit] = useState<(MathEditRequest & { open: boolean }) | null>(null)
  const [versions, setVersions] = useState<HistoryVersion[]>([])
  // P2-8：历史加载失败不再是「空列表」，而是明确错误提示
  const [historyError, setHistoryError] = useState('')
  const [previewing, setPreviewing] = useState<HistoryVersion | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  // 是否正在查看「当前版本」（只读预览当前文档正文）
  const [showCurrent, setShowCurrent] = useState(false)
  // 编辑序号：每次内容变更递增。保存完成时与触发时的序号比对，
  // 若保存期间有新编辑则保持「未保存」，否则判定为「已保存」。
  // F21：序号按文档隔离——原实现单一共享序号，切到 B 后 A 的在途保存
  // 判定 latest=false，恢复点永不清除、下次启动对 A 误报「未恢复编辑」。
  const editSeqRef = useRef(new Map<string, number>())
  const docSeq = useCallback((docId: string): number => editSeqRef.current.get(docId) ?? 0, [])
  const bumpSeq = useCallback((docId: string): number => {
    const next = (editSeqRef.current.get(docId) ?? 0) + 1
    if (editSeqRef.current.size > 32) {
      const oldest = editSeqRef.current.keys().next().value
      if (oldest !== undefined) editSeqRef.current.delete(oldest)
    }
    editSeqRef.current.set(docId, next)
    return next
  }, [])
  // Phase 6.4：ref 版本，供防抖保存回调在任意时刻拿到最新 editor/article
  const editorRef = useRef<Editor | null>(null)
  const articleRef = useRef(article)
  // P0-2：切换文档时记住「上一文档 id」，以便把其未决防抖保存 flush 掉，不静默丢失输入。
  const prevArticleIdRef = useRef<string | null>(null)
  // F14：文档内容快照（docId → 序列化 Markdown）。切换文档瞬间为「离开的文档」
  // 拍下最终内容，供其在途/后续保存使用（避免经 editorRef 重读新文档内容串写）。
  const contentSnapshotRef = useRef(new Map<string, string>())
  // F-4/F-5（规范 §2.6）：文档级文件特征（BOM / 换行风格）按 docId 记录 —— 载入**磁盘原文**时
  // 捕获（article.content / saved.content / 历史恢复回包），保存写入前还原，确保 CRLF 文档
  // 保存后仍 CRLF、带 BOM 文档保存后仍带 BOM、无 BOM 文档不新增 BOM。
  const docTraitsRef = useRef(new Map<string, DocTraits>())
  const captureTraits = useCallback((docId: string | null | undefined, raw: string | null | undefined) => {
    if (!docId || typeof raw !== 'string') return
    docTraitsRef.current.set(docId, captureDocTraits(raw))
  }, [])
  /** 该文档的保存特征；从未捕获（新建文档等）→ 缺省 LF/无 BOM */
  const traitsFor = useCallback(
    (docId: string): DocTraits => docTraitsRef.current.get(docId) ?? DEFAULT_DOC_TRAITS,
    [],
  )

  // ---------- task-41 源码模式（规范 document-format.md §6） ----------
  /** 全局视图通道（不写入文档、不按文档记忆） */
  const [viewMode, setViewModeState] = useState<ViewMode>(() => getViewMode())
  useEffect(() => subscribeViewMode(() => setViewModeState(getViewMode())), [])
  const viewModeRef = useRef<ViewMode>(viewMode)
  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])
  /** 源码通道：textarea 值（不含 frontmatter）；raw=进入时的磁盘原文（frontmatter 来源）；initial=diff 基线 */
  const [sourceValue, setSourceValue] = useState('')
  const sourceValueRef = useRef('')
  const sourceBaseRawRef = useRef('')
  const sourceInitialRef = useRef('')
  const sourceDirtyRef = useRef(false)
  const sourceUnknownPromptedRef = useRef(false)
  /** 最近一次「已保存」的磁盘原文（源码初值取保存后的内容，而非旧盘面） */
  const lastSavedRawRef = useRef(new Map<string, string>())
  // F-S1-2：编辑器**此刻实际载入**的文档 id（实时内容的可信域）。切档快照的守卫必须用它，
  // 而不是 articleRef —— 后者的同步 effect 声明更早，切档 effect 跑到时它已指向新文档，
  // 导致 `articleRef.current?.id === prevId` 恒假、快照从未写入（旧文档最后 <3s 编辑静默丢弃）。
  // 更新点覆盖每一处把内容载入编辑器的地方：首载 / 常规 setKeContent / 大文档 80ms 延迟分支 /
  // reloadToken 外部重载。
  const editorDocIdRef = useRef<string | null>(null)
  // F-S1-4①：大文档（>200KB）延迟载入的代次守卫 —— 切档后旧 timeout 绝不能再改编辑器/UI。
  // 惰性初始化（只建一次；不依赖 window 之外的副作用）。
  const deferredLoadRef = useRef<DeferredLoader | null>(null)
  if (deferredLoadRef.current === null) deferredLoadRef.current = createDeferredLoader()
  // S-1：编辑期恢复点登记（「有界年龄」调度）。
  // saveQueue.enqueueSave 是纯尾沿防抖且无 maxWait——连续输入时计时器被反复重置、
  // 永不触发，于是既不自动保存也不登记恢复点，硬崩溃的丢失窗口**无界**（不是「一个
  // autosave 周期」）。本调度把登记节奏与保存防抖解耦：自首笔未登记编辑起至多
  // RECOVERY_MAX_AGE_MS 内必登记一次，且不因后续编辑重置。
  const draftRegRef = useRef<DraftDebounce | null>(null)
  // F22：大文档首开解析提示——@tiptap/markdown 对 256KB 级文档首次解析需 12-17s，
  // 用一帧「正在解析大文档…」占位告知用户进程未死（解析仍同步，但不再无声卡死）。
  const [parsingLarge, setParsingLarge] = useState(false)

  useEffect(() => {
    articleRef.current = article
  }, [article])

  // 页眉标题编辑（dual-title 修复）：编辑态 → blur 时同步 frontmatter title；
  // 文件名同步：仅当 slug 变化时重命名（409 时保留 meta title 并提示）。
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  // 拖选回收（v1.1.5）：标题输入框内按下并拖出（非空选区），在框外松开时
  // 焦点被页面其他部分（编辑器）抢走 → 原生收起输入框选区。
  // 松开瞬间若输入框仍有非空选区 → 自动归还焦点 + 恢复选区（高亮保持）；
  // 此后任意一次正常点击即可离开（flag 在下次 mousedown 清除）。
  const titleDragStartRef = useRef(false)
  useEffect(() => {
    const onWinMouseUp = () => {
      const i = document.querySelector('input[aria-label="文档标题"]') as HTMLInputElement | null
      if (!i || !titleDragStartRef.current) return
      const a = i.selectionStart ?? 0
      const b = i.selectionEnd ?? 0
      if (a === b) {
        titleDragStartRef.current = false
        return
      }
      setTimeout(() => {
        if (document.activeElement !== i) {
          i.focus()
          i.setSelectionRange(a, b)
        }
        titleDragStartRef.current = false
      }, 0)
    }
    window.addEventListener('mouseup', onWinMouseUp, true)
    const onWinMouseDown = () => {
      titleDragStartRef.current = false
    }
    window.addEventListener('mousedown', onWinMouseDown, true)
    return () => {
      window.removeEventListener('mouseup', onWinMouseUp, true)
      window.removeEventListener('mousedown', onWinMouseDown, true)
    }
  }, [])
  useEffect(() => {
    setTitleDraft(null)
  }, [article?.id])
  // 非受控输入（v1.1.5）：React 不写 value → 任何重渲染都不会重置选区/光标
  const handleTitleBlur = useCallback(async (value?: string) => {
    if (!article) return
    const next = (value ?? titleDraft ?? '').trim()
    setTitleDraft(null)
    if (!next || next === article.title) return
    const docId = article.id
    try {
      // R1：改名是「路径变更」——先 flush 未决防抖保存（否则改名后旧路径
      // PUT 404 被吞、editor 被陈旧 article.content 快照重置，输入静默抹掉）。
      // 与 requestOpenArticle 同款 3s 超时兜底：超时则让用户显式确认。
      if (!(await flushWithTimeout(docId))) {
        if (!(await askConfirm('当前有未保存修改且保存超时，继续改名将丢弃这些修改，是否继续？'))) return
      }
      // 1) frontmatter/meta title（展示与列表立即同步）
      await updateArticleMeta(docId, { title: next })
      // 2) 文件名同步（slug 变化时重命名；失败不阻塞已完成的 meta 更新）
      // F11：oldSlug 取文件名基线（含子目录文档）；旧实现 replace(/^Articles\//)
      // 对「Articles/Sub/note.md」得「Sub/note」，与 slugify 输出永不相等，
      // 导致子目录文档每次改标题都触发 rename 撞自身 409 误报。
      const base = docId.split('/').pop() ?? docId
      const oldSlug = base.replace(/\.(md|markdown)$/i, '')
      // v1.1.8：文件名保留原标题（大小写/空格）——仅替换文件系统非法字符
      const newSlug = filenameFromTitle(next)
      if (newSlug && newSlug !== oldSlug) {
        const res = await renameDoc(docId, `${newSlug}.md`)
        onRenamed?.(res.from, res.to, next)
        return
      }
      onRenamed?.(docId, docId, next)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // F18：rename 409 = 目标文件名已存在（同名文档/文件）——
      // frontmatter 标题已更新但文件名未变；回填磁盘标题使 UI==磁盘，
      // 并明确提示文件名冲突（原实现只弹 409 且 UI 与磁盘标题永久分叉）。
      if (/^409\b/.test(msg)) {
        try {
          const fresh = await getArticle(docId)
          onArticleRestored?.(fresh)
        } catch {
          /* 回填失败：保持现状（下一帧以磁盘为准） */
        }
        window.alert('标题已保存，但存在同名文档/文件，文件名未变更')
        return
      }
      window.alert(`标题保存失败：${msg}`)
    }
  }, [article, titleDraft, onRenamed, onArticleRestored])

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

  // S-1：登记回调。序列化**只在该时机执行一次**（不在每次击键），因此不引入输入卡顿。
  // F-S1-4②：id 与内容必须同源 —— 旧实现取 `articleRef.current.id`（更早的 effect 已把它
  // 更新为新文档）+ `editorRef.getMarkdown()`（编辑器里可能还是旧文档）→ 错配登记会把
  // 旧文档正文挂到新文档名下（崩溃恢复即跨文档污染）。配对规则抽到 resolveRecoveryTarget，
  // 统一以 editorDocIdRef（编辑器此刻载着谁）同时决定 id 与内容。
  const flushDraftRecovery = useCallback(() => {
    // task-41：源码通道的恢复点内容 = 源码字符串 + frontmatter（绝不取 PM 序列化结果，
    // 否则崩溃恢复会把正文通道的规范化内容挂到源码编辑之上）
    if (viewModeRef.current === 'source') {
      const docId = articleRef.current?.id
      if (!docId || !sourceDirtyRef.current) return
      void registerRecoveryPoint(docId, buildSourceDraft(sourceBaseRawRef.current, sourceValueRef.current))
      return
    }
    const ed = editorRef.current
    const target = resolveRecoveryTarget({
      editorDocId: editorDocIdRef.current,
      articleDocId: articleRef.current?.id ?? null,
      editorMarkdown: ed ? withFrontmatter(ed.getMarkdown(), KE_VERSION) : null,
    })
    if (!target) return
    void registerRecoveryPoint(target.docId, target.md)
  }, [registerRecoveryPoint])

  const ensureDraftReg = useCallback((): DraftDebounce => {
    if (!draftRegRef.current) {
      draftRegRef.current = createDraftDebounce({ onFlush: flushDraftRecovery })
    }
    return draftRegRef.current
  }, [flushDraftRecovery])

  // S-1：卸载时清理登记计时器。
  useEffect(() => () => { draftRegRef.current?.dispose() }, [])

  // F-S1-4①：卸载时放弃未决的大文档延迟载入（代次过期 → 回调绝不再 setKeContent/setState）。
  useEffect(() => () => { deferredLoadRef.current?.cancel() }, [])

  // 保存函数构造：读取当前编辑器正文、登记/清除恢复点、更新 saveState 与 onSaved。
  // 经 saveQueue 串行化（P1-6：同一 doc 至多一个在途保存，latest-wins），
  // 并仅在「本次保存对应序号仍为最新」时判定已保存/清除恢复点（P0-2/P1-6）。
  // R2 残余：saveFn 接收 AbortSignal（abortPending 中止在途 PUT）；此处负责
  // 被中止后的清理（恢复点/保存状态复位）。
  const buildSaveFn = useCallback(
    (docId: string): SaveFn => {
      return async (signal?: AbortSignal) => {
        const ed = editorRef.current
        const seq = docSeq(docId)
        const isCurrent = articleRef.current?.id === docId
        // F14 / F-S1-2：保存内容来源按「**编辑器此刻载着谁**」裁决（editorDocId），
        // 而不是 articleRef —— 后者在切档窗口里已指向新文档，会把新文档内容写进旧路径。
        // 只有编辑器仍载着 docId 时才允许实时序列化；否则必须用切档快照；
        // 无快照 → resolveSaveContent 返回 null → 放弃本次保存（不 save、不登记恢复点）。
        const editorDocId = editorDocIdRef.current
        const editorMarkdown =
          ed && editorDocId === docId ? withFrontmatter(ed.getMarkdown(), KE_VERSION) : null
        const md = resolveSaveContent({
          docId,
          currentDocId: editorDocId,
          editorMarkdown,
          snapshots: contentSnapshotRef.current,
        })
        if (md === null) return
        try {
          if (isCurrent) setSaveState('saving')
          // 草稿/恢复点：内部数据，恒 LF、无 BOM —— 不套 traits（规范 §2.6 只约束文档写入）
          await registerRecoveryPoint(docId, md)
          // F-4/F-5：文档写入前还原该文档的 BOM/换行特征（编辑器内部一律 LF）
          const saved = await saveArticle(docId, applyDocTraits(md, traitsFor(docId)), signal)
          const latest = docSeq(docId) === seq
          if (isCurrent) setSaveState(latest ? 'saved' : 'dirty')
          onSaved?.(docId, saved)
          if (latest) {
            void clearRecoveryPoint(docId)
            // S-1：该次保存覆盖了最新编辑、且该文档仍是当前文档 → 清除「未保存」标记，
            // 避免登记调度器在保存已清除恢复点之后又登记一条孤儿草稿
            // （否则下次启动会误弹「检测到未恢复的编辑内容」）。
            // 反例（必须不清）：保存期间用户切到别的文档并在新文档输入——此时
            // articleRef.current?.id !== docId，旧文档的保存完成不得影响新文档的未保存状态。
            if (articleRef.current?.id === docId) draftRegRef.current?.markSaved(true)
          }
          // F15：A→B→A 回退竞态——GET 先于在途 PUT 返回旧内容时，保存完成后
          // 若正文与编辑器不一致（且期间无新编辑），用保存结果对齐编辑器。
          if (isCurrent && latest && ed) {
            // F-4/F-5：服务端回包 = 磁盘原样（可能带 BOM/CRLF）→ 捕获为该文档当前特征
            captureTraits(docId, saved.content)
            const savedBody = stripFrontmatter(saved.content).content
            // F-5 陷阱：编辑器侧恒 LF，回包可能 CRLF/BOM —— 比较前两侧归一化，
            // 否则每次保存都判「不一致」而反复重载编辑器。重载内容同样归一到 LF 后载入。
            const savedNorm = normalizeForCompare(savedBody)
            if (normalizeForCompare(stripFrontmatter(md).content) !== savedNorm) {
              setKeContent(ed, savedNorm)
              // F-S1-2：此处把 docId 的内容载入了编辑器 → 同步「编辑器载着谁」，
              // 否则后续保存会误判内容来源（可能再经实时分支串写）。
              editorDocIdRef.current = docId
            }
          }
        } catch (e) {
          if (signal?.aborted) {
            // R2：主动中止（重新加载外部版本）——放弃本次内容并清理恢复点
            if (isCurrent) setSaveState('idle')
            void clearRecoveryPoint(docId)
            // S-1：本次编辑已被放弃（编辑器随后由外部版本重载覆盖），必须**一并放弃未决的
            // 恢复点登记**。否则 3s 后调度器会用重载后的磁盘内容再登记一条「孤儿草稿」——
            // 保存路径刚 clearRecoveryPoint，草稿又出现，下次启动误弹「检测到未恢复的编辑内容」。
            // （对抗验证用例 T3 实测复现：POST → PUT → DELETE → 又 POST）
            // 注意必须门控「**中止时刻**仍为当前文档」：clearRecoveryPoint 按 docId 精确
            // 作用于被中止的文档，而本调度器只有**一个**实例、服务的是**当前**编辑器内容。
            // 用起始时快照的 isCurrent 不够——保存可能在「A 尚为当前」时启动、用户随后切到 B
            // 才发生中止，此时 isCurrent 已过期；若据此 cancel()，会把当前文档 B 尚未登记的
            // 编辑一并丢弃（对抗验证用例 T8：B 的登记数 = 0）。故此处重读 articleRef。
            if (articleRef.current?.id === docId) draftRegRef.current?.cancel()
            return
          }
          if (isCurrent) setSaveState('error')
          // P3-7：保存时 404 说明文档已被外部删除，明确提示而非静默失败
          // F19：404 提示门控 isCurrent——后台文档（已切走的旧文档）404
          // 对当前无关文档弹窗、且可能双弹窗（旧实现不门控）
          if (is404Error(e) && isCurrent) window.alert('保存失败：文档已被删除（404）')
        }
      }
    },
    [onSaved, registerRecoveryPoint, clearRecoveryPoint, docSeq, captureTraits, traitsFor],
  )

  const handleUpdate = useCallback(() => {
    if (!articleRef.current) return
    const docId = articleRef.current.id
    bumpSeq(docId)
    setSaveState('dirty')
    // M3：自动保存间隔由应用设置驱动（默认 3000ms）。统一走 saveQueue：
    // 同一 doc 防抖合并；在途时 latest-wins；完成后若有新内容再补一次。
    enqueueSave(docId, buildSaveFn(docId), getAutosaveIntervalMs())
    // S-1：同时喂给恢复点登记调度器（O(1)，不序列化）。它的计时器**不因后续编辑重置**，
    // 因此在 saveQueue 的尾沿防抖被连续输入无限推迟时，恢复点仍至多 3s 登记一次。
    ensureDraftReg().touch()
  }, [buildSaveFn, bumpSeq, ensureDraftReg])

  // ---------- task-41：源码通道（字符串直存，绝不经过 ProseMirror） ----------

  /**
   * 源码通道保存函数：`frontmatterBlockOf(raw) + editedBody` → `withFrontmatter(..., {stripCaretArtifacts:false})`
   * → `applyDocTraits(captureDocTraits(raw))` → 既有 `saveArticle` 链（saveQueue / 恢复点 / 自写抑制）。
   */
  const buildSourceSaveFn = useCallback(
    (docId: string): SaveFn => {
      return async (signal?: AbortSignal) => {
        const raw = sourceBaseRawRef.current
        const body = sourceValueRef.current
        const seq = docSeq(docId)
        const isCurrent = articleRef.current?.id === docId
        // §6.2-4：未知/损坏 ke-* 被改动 → 首次保存必须显式提示，不得静默覆盖
        if (!sourceUnknownPromptedRef.current && unknownMarkersChanged(sourceInitialRef.current, body)) {
          sourceUnknownPromptedRef.current = true
          const ok = await askConfirm(
            '你修改了非标准语法（未知/损坏的 ke-* 标记）；保存后将以这段原文为准。是否继续保存？',
          )
          if (!ok) return
        }
        const md = buildSourceSavePayload(raw, body)
        try {
          if (isCurrent) setSaveState('saving')
          // 恢复点：草稿恒 LF/无 BOM（S-1 口径），内容同样取自源码字符串
          await registerRecoveryPoint(docId, buildSourceDraft(raw, body))
          const saved = await saveArticle(docId, md, signal)
          const latest = docSeq(docId) === seq
          if (isCurrent) setSaveState(latest ? 'saved' : 'dirty')
          if (latest) {
            lastSavedRawRef.current.set(docId, saved.content)
            if (articleRef.current?.id === docId) sourceDirtyRef.current = false
            void clearRecoveryPoint(docId)
            if (articleRef.current?.id === docId) draftRegRef.current?.markSaved(true)
          }
          onSaved?.(docId, saved)
        } catch (e) {
          if (signal?.aborted) {
            if (isCurrent) setSaveState('idle')
            void clearRecoveryPoint(docId)
            return
          }
          if (isCurrent) setSaveState('error')
          if (is404Error(e) && isCurrent) window.alert('保存失败：文档已被删除（404）')
        }
      }
    },
    [onSaved, registerRecoveryPoint, clearRecoveryPoint, docSeq],
  )

  /** 源码编辑：沿用既有防抖/恢复点节奏，内容是 textarea 字符串 */
  const handleSourceChange = useCallback(
    (next: string) => {
      const docId = articleRef.current?.id
      if (!docId) return
      sourceValueRef.current = next
      setSourceValue(next)
      sourceDirtyRef.current = true
      bumpSeq(docId)
      setSaveState('dirty')
      enqueueSave(docId, buildSourceSaveFn(docId), getAutosaveIntervalMs())
      ensureDraftReg().touch()
    },
    [buildSourceSaveFn, bumpSeq, ensureDraftReg],
  )

  /** 进入源码模式：切视图前先 flush（§6.2-2），失败给确认；初值 = **保存后**的磁盘原文 */
  const enterSourceMode = useCallback(async () => {
    const ed = editorRef.current
    const doc = articleRef.current
    if (!ed || !doc) return
    const unsaved = saveState === 'dirty' || saveState === 'saving' || saveState === 'error'
    if (unsaved) {
      const flushed = await flushWithTimeout(doc.id)
      if (!flushed && !(await askConfirm('未保存修改可能丢失，仍要切换到源码模式？'))) return
    }
    const raw = lastSavedRawRef.current.get(doc.id) ?? doc.content
    sourceBaseRawRef.current = raw
    const body = sourceBodyOf(raw)
    sourceInitialRef.current = body
    sourceValueRef.current = body
    sourceDirtyRef.current = false
    sourceUnknownPromptedRef.current = false
    setSourceValue(body)
    setViewModeState('source')
    persistViewMode('source')
    // 单视图排他：源码态正文编辑器不可写
    ed.setEditable(false, false)
  }, [saveState])

  /** 切回正文：先保存源码改动，再按已保存原文重新解析（§6.2-5：提示未知语法可能被规范化） */
  const exitSourceMode = useCallback(async () => {
    const ed = editorRef.current
    const doc = articleRef.current
    if (!ed || !doc) return
    const body = sourceValueRef.current
    if (sourceDirtyRef.current) {
      const flushed = await flushWithTimeout(doc.id)
      if (!flushed && !(await askConfirm('源码改动尚未保存，仍要切回正文？未知语法可能被规范化。'))) return
    } else if (hasUnknownKeMarkers(body)) {
      if (!(await askConfirm('切回正文将重新解析 Markdown：未知语法可能被规范化。是否继续？'))) return
    }
    const raw = lastSavedRawRef.current.get(doc.id) ?? sourceBaseRawRef.current
    setViewModeState('wysiwyg')
    persistViewMode('wysiwyg')
    ed.setEditable(true, false)
    // 重新解析（既有链路）；内容取「保存后」的原文
    setKeContent(ed, sourceBodyOf(raw))
    editorDocIdRef.current = doc.id
    setSaveState('idle')
  }, [])

  const toggleViewMode = useCallback(() => {
    if (viewModeRef.current === 'source') void exitSourceMode()
    else void enterSourceMode()
  }, [enterSourceMode, exitSourceMode])

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

  // v1.1.7 M2：公式节点请求编辑 → 打开根级模态
  useEffect(() => {
    const onReq = (ev: Event) => {
      const req = (ev as CustomEvent<MathEditRequest>).detail
      setMathEdit({ ...req, open: true })
    }
    window.addEventListener(MATH_EDIT_EVENT, onReq)
    return () => window.removeEventListener(MATH_EDIT_EVENT, onReq)
  }, [])

  // 文档切换：flush 上一文档的未决防抖保存（P0-2，不再丢弃输入），再重载内容。
  // R2：reloadToken 变化（同一文档的外部版本重载）也触发重载，但跳过 flush
  // （id 未变，无「上一文档」；未决保存已由 App.handleReloadExternal 取消）。
  useEffect(() => {
    const newId = article?.id ?? null
    const prevId = prevArticleIdRef.current
    if (prevId && prevId !== newId) {
      // F14 / F-S1-2：先为离开的文档拍下内容快照（含其最新编辑），再触发其未决保存
      // （在途第二棒可能晚于 setKeContent 执行）。守卫语义 =「编辑器此刻仍载着 prevId」，
      // 由 docSwitch 模块承载（旧实现用 articleRef 判据 → 恒假 → 快照从未写入）。
      onDocumentSwitch({
        editorDocId: editorDocIdRef.current,
        prevId,
        newId,
        editorMarkdown:
          editor && editorDocIdRef.current === prevId
            ? withFrontmatter(editor.getMarkdown(), KE_VERSION)
            : null,
        snapshots: contentSnapshotRef.current,
        // 切换离开旧文档：立即触发其未决保存，避免防抖窗口内输入静默丢失
        flushPending: (id) => {
          void flushPending(id)
        },
        // S-1：旧文档的恢复点已由上面的保存路径登记；必须放弃本调度器的未决计时器，
        // 否则它到点时会用**新文档**的编辑器内容（且以新文档 id）登记，造成串档。
        // 注意：该回调在 flush **之后**被调用（顺序由 docSwitch 保证）。
        cancelDraftTimer: () => draftRegRef.current?.cancel(),
      })
    }
    prevArticleIdRef.current = newId
    setSaveState('idle')
    // F-4/F-5：载入磁盘原文前先捕获该文档的文件特征（必须先于下面的 setKeContent）
    if (article) {
      captureTraits(article.id, article.content)
      lastSavedRawRef.current.set(article.id, article.content)
    }
    // task-41：源码态下**不解析进 PM**（单视图排他 + 不触发 PM 规范化），只刷新 textarea 初值
    if (viewModeRef.current === 'source' && article) {
      deferredLoadRef.current?.cancel()
      setParsingLarge(false)
      const raw = lastSavedRawRef.current.get(article.id) ?? article.content
      sourceBaseRawRef.current = raw
      const srcBody = sourceBodyOf(raw)
      sourceInitialRef.current = srcBody
      sourceValueRef.current = srcBody
      sourceDirtyRef.current = false
      sourceUnknownPromptedRef.current = false
      setSourceValue(srcBody)
      editorDocIdRef.current = article.id
      return
    }
    const body = article ? stripFrontmatter(article.content).content : ''
    const large = body.length > 200_000
    if (editor && article) {
      if (large) {
        // 先让一帧「解析中」占位绘制（同步解析会阻塞渲染，抢占一个渲染帧）
        setParsingLarge(true)
        // 80ms：给 React commit + 浏览器一次 paint 的时间，占位帧先可见再阻塞解析。
        // F-S1-4①：经代次守卫调度 —— 期间又切档/重载时，该回调到点即被丢弃，
        // 绝不再 setKeContent（旧实现会把上一篇内容灌进编辑器）或 setParsingLarge。
        deferredLoadRef.current?.schedule(() => {
          setKeContent(editor, body)
          // 内容此刻才真正载入编辑器 → 同步「编辑器载着谁」（延迟分支也必须覆盖）
          editorDocIdRef.current = article.id
          setParsingLarge(false)
        })
      } else {
        // 立即载入分支：先让此前未决的延迟载入失效（含上一篇大文档的 80ms 回调）
        deferredLoadRef.current?.cancel()
        setParsingLarge(false)
        setKeContent(editor, body)
        // 常规分支：内容已同步载入
        editorDocIdRef.current = article.id
      }
    } else {
      deferredLoadRef.current?.cancel()
      setParsingLarge(false)
    }
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
    // task-41 单视图排他：源码态下正文编辑器不可写（唯一可写通道 = textarea）
    const next = !!article && viewMode !== 'source'
    if (editor.isEditable !== next) editor.setEditable(next, false)
  }, [editor, article, viewMode])

  // Ctrl+S / 保存按钮：立即保存（覆盖未决防抖，经 saveQueue 串行化）
  const saveNow = useCallback(async () => {
    const doc = articleRef.current
    if (!editor || !doc) return
    // 手动保存覆盖未决的防抖自动保存：以 debounce=0 立即入队并串行化；
    // 内容已在 in-flight 时则 latest-wins，保存后不会二次提交冗余内容。
    // task-41：源码态用字符串直存通道
    await enqueueSave(doc.id, viewModeRef.current === 'source' ? buildSourceSaveFn(doc.id) : buildSaveFn(doc.id), 0)
  }, [editor, buildSaveFn, buildSourceSaveFn])

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
    // F-4/F-5：KE 导出按磁盘原文还原 BOM/换行（与「导出 vs 源文档 diff=0」口径一致）
    void runExport(keExportPayload(editor, article.title, article.content))
  }, [editor, article])

  // 导出「普通 Markdown」（朴素降级版）：KE 方言 → 标准 Markdown，
  // 不含 ke_version 与任何 ke-* 注释（见 docs/knowledge-editor-plain-export-design.md）
  const handleExportPlainMarkdown = useCallback(() => {
    if (!editor || !article) return
    void runExport(plainExportPayload(editor, article))
  }, [editor, article])

  // 导出文档包 .zip（序列化 + 收集附件引用 → 后端打包）
  // K10/K11（2026-09-18 独立验证）：zip 载荷必须与单文件路径（keExportPayload）**同口径**保留
  // 源 frontmatter 的其余键（title / tags / 自定义键）——把原文 frontmatter 区块拼回正文前，
  // 再让 withFrontmatter 只更新 ke_version，并按磁盘原文还原 BOM/换行风格。
  // 修前这里只产出 `ke_version: 1`，源键全部丢失。
  const handleExportPackage = useCallback(async () => {
    if (!editor || !article || exporting) return
    setExporting(true)
    setExportOpen(false)
    try {
      const fmBlock = frontmatterBlockOf(article.content)
      const md = applyDocTraits(
        withFrontmatter(fmBlock ? fmBlock + editor.getMarkdown() : editor.getMarkdown(), KE_VERSION),
        captureDocTraits(article.content),
      )
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

  // ---------------------------------------------------------------------------
  // task-35（ADP-1 收口）：自定义快捷键 → **真实 handler 闭包**（不再走 DOM 过渡适配层）
  // ---------------------------------------------------------------------------
  // 编辑器类动作直接调用 `editor.chain()...`；`doc.save` / `app.history.open` 复用本组件既有回调。
  // 注册表按 action id 覆盖，卸载或依赖变化时统一注销（闭包不会过期）。
  // 应用级动作（新建 / 设置 / 右栏 / 工作区 / doc.next|prev|close）在 App.tsx 注册。
  useEffect(() => {
    if (!editor) return

    /** 插入行内/块级公式：有选区时折叠到末尾（不吞文本），随后按 id 打开全屏公式编辑 */
    const insertMath = (kind: 'math' | 'mathBlock') => {
      const id = newId()
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          if (!tr.selection.empty) tr.setSelection(TextSelection.create(tr.doc, tr.selection.to))
          return true
        })
        .insertContent({ type: kind, attrs: { id, latex: '' } })
        .run()
      openMathEditorById(editor, id)
    }

    /** 插入链接：与工具栏同款（askPrompt 输入地址；空串 = 取消链接） */
    const insertLink = async () => {
      const prev = editor.getAttributes('link').href as string | undefined
      const url = await askPrompt('链接地址：', prev ?? 'https://')
      if (url === null) return
      if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
      else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }

    /** 插入图片/附件：与工具栏同款（uploadAttachment + attachmentNode，含视频/文件节点） */
    const insertAttachment = () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*,video/*,.pdf,.zip,.txt,.csv,.xlsx,.docx,.pptx,.epub,.json'
      input.style.display = 'none'
      document.body.appendChild(input)
      const cleanup = () => input.remove()
      input.onchange = () => {
        const file = input.files?.[0]
        cleanup()
        if (!file) return
        void (async () => {
          try {
            const res = await uploadAttachment(file)
            const node = attachmentNode(editor.schema, res, file.name)
            editor.chain().focus().insertContent(node).run()
          } catch (err) {
            window.alert(`附件上传失败：${String(err)}`)
          }
        })()
      }
      input.click()
    }

    /**
     * 插入模块（键盘路径）：先拉模块列表；唯一模块直接插入，多模块用 askPrompt 选择序号/路径。
     * 插入文本与工具栏按钮完全一致（ke-module 来源标记 + stripModuleTitle），避免两处漂移。
     */
    const insertModule = async () => {
      try {
        const { modules } = await listModules()
        if (modules.length === 0) {
          window.alert('暂无模块（在左侧 Modules 目录创建后重试）')
          return
        }
        let target = modules[0]
        if (modules.length > 1) {
          const list = modules.map((m, i) => `${i + 1}) ${m.path}`).join('\n')
          const answer = await askPrompt(`插入模块（输入序号或路径）：\n${list}`, '1')
          if (answer === null) return
          const trimmed = answer.trim()
          const idx = Number(trimmed)
          const byIndex =
            Number.isInteger(idx) && idx >= 1 && idx <= modules.length ? modules[idx - 1] : undefined
          const byPath = modules.find((m) => m.path === trimmed)
          const picked = byIndex ?? byPath
          if (!picked) {
            window.alert(`未找到模块：${trimmed}`)
            return
          }
          target = picked
        }
        const mod = await getModule(target.path)
        const body = stripModuleTitle(mod.content)
        const marker = `<!-- ke-module: ${JSON.stringify({ source: target.path })} -->`
        const manager = (editor.storage.markdown as MarkdownExtensionStorage).manager
        editor.chain().focus().insertContent(manager.parse(`${marker}\n\n${body}`)).run()
      } catch (e) {
        window.alert(`插入模块失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }

    const off = registerActionHandlers({
      'editor.bold': () => { editor.chain().focus().toggleBold().run() },
      'editor.italic': () => { editor.chain().focus().toggleItalic().run() },
      'editor.underline': () => { editor.chain().focus().toggleUnderline().run() },
      'editor.strike': () => { editor.chain().focus().toggleStrike().run() },
      'editor.heading.1': () => { editor.chain().focus().toggleHeading({ level: 1 }).run() },
      'editor.heading.2': () => { editor.chain().focus().toggleHeading({ level: 2 }).run() },
      'editor.heading.3': () => { editor.chain().focus().toggleHeading({ level: 3 }).run() },
      'editor.list.bullet': () => { editor.chain().focus().toggleBulletList().run() },
      'editor.list.ordered': () => { editor.chain().focus().toggleOrderedList().run() },
      'editor.blockquote': () => { editor.chain().focus().toggleBlockquote().run() },
      'editor.code.inline': () => { editor.chain().focus().toggleCode().run() },
      'editor.codeBlock': () => { editor.chain().focus().toggleCodeBlock().run() },
      'editor.link.insert': () => { void insertLink() },
      'editor.image.insert': () => insertAttachment(),
      'editor.math.inline': () => insertMath('math'),
      'editor.math.block': () => insertMath('mathBlock'),
      'editor.module.insert': () => { void insertModule() },
      'editor.footnote.insert': () => { editor.chain().focus().insertFootnote('').run() },
      'editor.note.insert': () => { editor.chain().focus().insertNote('', 'blue').run() },
      // 快捷键路径没有网格选择器 → 默认插入 3×3 带表头表格（工具栏按钮仍保留 1–8 网格选择）
      'editor.table.insert': () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      'editor.undo': () => { editor.chain().focus().undo().run() },
      'editor.redo': () => { editor.chain().focus().redo().run() },
      'doc.save': () => { void saveNow() },
      'app.history.open': () => handleOpenHistory(),
    })
    return off
  }, [editor, saveNow, handleOpenHistory])

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
        if (!(await askConfirm('当前有未保存修改，恢复历史版本将丢失这些修改，是否继续？'))) return
      }
      if (!(await askConfirm('恢复此版本将替换当前文档内容，是否继续？'))) return
      try {
        setSaveState('saving')
        const doc = await restoreHistory(article.id, v.id)
        // F-4/F-5：服务端已把历史版本写回磁盘 → 文件特征随快照变化，捕获回包原文。
        // （只读预览路径不捕获：预览不写盘，若用旧快照特征覆盖会让下一次保存改写现有换行）
        captureTraits(article.id, doc.content)
        // 刷新编辑器内容（Document Model）；编辑器内部一律 LF
        setKeContent(editor, normalizeForCompare(stripFrontmatter(doc.content).content))
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
      {loading || parsingLarge ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>{loading ? '加载中…' : '正在解析大文档…'}</span>
          {parsingLarge && (
            <span className="text-xs opacity-70">首次打开大文档解析较慢，请稍候（再次打开走缓存）</span>
          )}
        </div>
      ) : article && editor ? (
        <EditorContext.Provider value={{ editor }}>
          <EditorToolbar
            saveLabel={saveLabel}
            onSave={() => void saveNow()}
            onOpenHistory={handleOpenHistory}
            exportButton={exportButton}
            // task-41：视图通道切换（只读/无文档时禁用并给出原因，规范 §6.2-8）
            viewMode={viewMode}
            onToggleViewMode={article ? toggleViewMode : undefined}
            viewModeDisabledReason={!article ? '打开文档后可切换到源码模式' : undefined}
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
                key={article.id}
                defaultValue={article.title}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={(e) => void handleTitleBlur(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  else if (e.key === 'Escape') {
                    setTitleDraft(null)
                    ;(e.target as HTMLInputElement).value = article.title
                  }
                }}
                title="标题（编辑后回车/失焦保存，同步文件名）"
                aria-label="文档标题"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  titleDragStartRef.current = true
                }}
                onMouseUp={(e) => e.stopPropagation()}
                onSelect={(e) => e.stopPropagation()}
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
            {/* task-41：单视图排他 —— 源码态渲染 textarea（唯一可写通道），正文态渲染 ProseMirror */}
            {viewMode === 'source' && article ? (
              <SourceModeView
                value={sourceValue}
                onChange={handleSourceChange}
                saveLabel={saveLabel}
                title={article.title}
              />
            ) : (
              <EditorContent editor={editor} />
            )}
            {/* v1.1.7 M2：全屏公式模态（编辑器根——PM 事务安全；nodeview 独立 React 根会 #300） */}
            {mathEdit?.open && (
              <MathEditorModal
                open={mathEdit.open}
                initialValue={mathEdit.latex}
                isBlock={mathEdit.isBlock}
                onSave={(v) => {
                  const ed = editorRef.current
                  // 只读闸门：实测 isEditable=false 时 PM 命令仍会改文档，必须显式拦截（规范 §3.2）
                  if (ed && ed.isEditable && mathEdit) {
                    const target = locateMathById(ed.state.doc, mathEdit.id, mathEdit.pos)
                    // 目标失效（公式已被删除/文档已改写）→ 不进 chain：tiptap 在无命令可执行时
                    // 仍会派发一个空事务（chain/focus plumbing），这里保持严格 0 事务
                    if (isMathNode(ed.state.doc.nodeAt(target))) {
                      // 保存事务在编辑器根（本组件）发起：模态已卸载、NodeView 是独立 React 根（#300）
                      // 同一事务内完成「改 latex + 块级必要时新起一行 + 落光标」→ 一次撤销即回编辑前
                      ed.chain()
                        .command(({ tr }) => applyMathSaveCursor(tr, target, mathEdit.isBlock, v))
                        .focus() // 焦点交还编辑器（光标落点由事务内 setSelection 决定）
                        .run()
                    }
                  }
                  setMathEdit(null)
                }}
                onDeleteEmpty={() => {
                  const ed = editorRef.current
                  if (ed && ed.isEditable && mathEdit) {
                    const target = locateMathById(ed.state.doc, mathEdit.id, mathEdit.pos)
                    if (isMathNode(ed.state.doc.nodeAt(target))) {
                      ed.chain().command(({ tr }) => applyMathDeleteCursor(tr, target)).focus().run()
                    }
                  }
                  setMathEdit(null)
                }}
                onClose={() => setMathEdit(null)}
              />
            )}
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
