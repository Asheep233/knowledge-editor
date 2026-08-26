/** 右侧面板（Phase 4.6 / 4.7）：
 * - 大纲：占位（Phase 3 文档标题结构）
 * - 属性：文档元信息面板 —— 标题 / 标签编辑（写入 frontmatter）、路径、创建/修改时间、字数、大小
 * - 附件：全部附件列表（类型/大小/所属文档，点击打开）+ 孤儿附件检测（仅手动删除、绝不自动）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  attachmentUrl,
  deleteAttachment,
  listAttachments,
  listOrphans,
  updateArticleMeta,
} from '../../api/client'
import { extractOutline, type OutlineItem } from '../../state/outline'
import type { ArticleMeta, AttachmentItem, OrphanItem } from '../../types'

interface Props {
  article: ArticleMeta | null
  /** 元信息保存成功后回写 App 的 article（标题/标签同步到顶栏与左侧树） */
  onMetaUpdate?: (doc: ArticleMeta) => void
  /** 点击附件所属文档时打开对应文档 */
  onOpenArticle?: (id: string) => void
  /** 折叠右侧面板（收起按钮位于面板顶部 tab 栏右侧） */
  onCollapse?: () => void
}

const TABS = ['大纲', '属性', '附件'] as const
type Tab = (typeof TABS)[number]

function fmtTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

function fmtSize(n?: number): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function RightPanel({ article, onMetaUpdate, onOpenArticle, onCollapse }: Props) {
  const [tab, setTab] = useState<Tab>('属性')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [orphans, setOrphans] = useState<OrphanItem[]>([])
  const [attachError, setAttachError] = useState('')
  // 正在删除的孤儿附件路径（删除中禁用按钮，防止重复提交）
  const [deletingPath, setDeletingPath] = useState<string | null>(null)

  // P4-13：大纲（解析 #/##/### 标题，点击展开/收缩 + 定位）
  const [collapseDepth, setCollapseDepth] = useState(0) // 0 = 全部展开
  const outline = useMemo(() => (article?.content ? extractOutline(article.content) : []), [article?.content])
  const visibleOutline = useMemo(
    () => (collapseDepth > 0 ? outline.filter((i) => i.level <= collapseDepth) : outline),
    [outline, collapseDepth],
  )
  const handleOutlineClick = useCallback((item: OutlineItem) => {
    // 尽力在编辑器 DOM 中按标题文本定位并滚动；找不到则提示
    const editorEl = document.querySelector('.ke-editor-prose')
    if (editorEl) {
      const headings = Array.from(editorEl.querySelectorAll('h1, h2, h3'))
      const target = headings.find((h) => h.textContent?.trim() === item.text)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
    window.alert(`跳转到标题：${item.text}`)
  }, [])

  // 切换文档时同步元信息表单
  useEffect(() => {
    setTitle(article?.title ?? '')
    setTags(article?.tags ?? [])
    setTagInput('')
    setDirty(false)
  }, [article?.id, article?.title, article?.tags])

  // ---------- 属性保存（Phase 4.6：标题/标签写入 frontmatter，由后端 set_meta 完成） ----------
  const handleSaveMeta = useCallback(async () => {
    if (!article) return
    setSaving(true)
    try {
      const doc = await updateArticleMeta(article.id, {
        title: title.trim() || article.title,
        tags,
      })
      onMetaUpdate?.(doc)
      setDirty(false)
    } catch (e) {
      window.alert(`保存属性失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }, [article, title, tags, onMetaUpdate])

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '')
    if (!t) return
    if (!tags.includes(t)) {
      setTags([...tags, t])
      setDirty(true)
    }
    setTagInput('')
  }

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t))
    setDirty(true)
  }

  // ---------- 附件加载（Phase 4.7：列表 + 孤儿检测，仅展示不删除） ----------
  const loadAttachments = useCallback(async () => {
    setAttachError('')
    try {
      const [a, o] = await Promise.all([listAttachments(), listOrphans()])
      setAttachments(a.attachments)
      setOrphans(o.orphans)
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (tab === '附件') void loadAttachments()
  }, [tab, loadAttachments, article?.id])

  // v0.6.1 约束升级：孤儿附件仅手动删除、绝不自动。
  // 显式确认后调用 DELETE（后端会二次校验孤儿身份，被引用附件返回 409）。
  const handleDeleteOrphan = async (o: OrphanItem) => {
    if (!window.confirm(`确定删除孤儿附件「${o.name}」吗？\n删除后不可恢复。`)) return
    setDeletingPath(o.path)
    try {
      await deleteAttachment(o.path)
      await loadAttachments()
    } catch (err) {
      window.alert(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeletingPath(null)
    }
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center border-b border-gray-100">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              'flex-1 py-2 text-[13px] transition-colors',
              tab === t
                ? 'border-b-2 border-blue-600 font-medium text-blue-700'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          onClick={onCollapse}
          title="折叠右侧面板（释放编辑区宽度）"
          className="shrink-0 self-stretch px-2.5 text-[13px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          »
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 text-[13px] text-gray-600">
        {tab === '大纲' && (
          <div>
            {!article ? (
              <p className="text-xs text-gray-400">未打开文档</p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    文档标题结构（{outline.length}）
                  </span>
                  <button
                    type="button"
                    onClick={() => setCollapseDepth((d) => (d > 0 ? 0 : 1))}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    {collapseDepth > 0 ? '展开全部' : '收缩至一级'}
                  </button>
                </div>
                {visibleOutline.length === 0 ? (
                  <p className="text-xs text-gray-400">暂无标题（使用 # / ## / ###）</p>
                ) : (
                  <ul className="space-y-0.5">
                    {visibleOutline.map((it, idx) => (
                      <li key={`${it.offset}-${idx}`}>
                        <button
                          type="button"
                          onClick={() => handleOutlineClick(it)}
                          className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[12px] text-gray-700 hover:bg-gray-100"
                          style={{ paddingLeft: `${(it.level - 1) * 12 + 6}px` }}
                          title={it.text}
                        >
                          <span className="mr-1 text-[10px] text-gray-400">{'#'.repeat(it.level)}</span>
                          {it.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {tab === '属性' && (
          <div className="space-y-4">
            {!article ? (
              <p className="text-xs text-gray-400">未打开文档</p>
            ) : (
              <>
                {/* 标题编辑 */}
                <div>
                  <label className="mb-1 block text-xs text-gray-400">标题</label>
                  <input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value)
                      setDirty(true)
                    }}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-[13px] text-gray-800 outline-none focus:border-blue-400"
                  />
                </div>

                {/* 标签编辑（写回 frontmatter tags） */}
                <div>
                  <label className="mb-1 block text-xs text-gray-400">标签</label>
                  <div className="flex flex-wrap items-center gap-1">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="group flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
                      >
                        #{t}
                        <button
                          type="button"
                          title="移除标签"
                          className="text-blue-400 hover:text-red-500"
                          onClick={() => removeTag(t)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      placeholder={tags.length === 0 ? '输入后回车添加' : ''}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag()
                        } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                          removeTag(tags[tags.length - 1])
                        }
                      }}
                      className="min-w-[90px] flex-1 rounded border border-gray-200 px-2 py-0.5 text-[12px] text-gray-800 outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                {dirty && (
                  <button
                    type="button"
                    onClick={() => void handleSaveMeta()}
                    disabled={saving}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '保存中…' : '保存属性'}
                  </button>
                )}

                {/* 静态元信息 */}
                <dl className="space-y-2 border-t border-gray-100 pt-3 text-xs">
                  <div>
                    <dt className="text-gray-400">路径</dt>
                    <dd className="mt-0.5 break-all font-mono text-gray-700">{article.path}</dd>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <dt className="text-gray-400">创建时间</dt>
                      <dd className="mt-0.5 text-gray-700">{fmtTime(article.created_at)}</dd>
                    </div>
                    <div className="flex-1">
                      <dt className="text-gray-400">修改时间</dt>
                      <dd className="mt-0.5 text-gray-700">{fmtTime(article.updated_at)}</dd>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <dt className="text-gray-400">字数</dt>
                      <dd className="mt-0.5 text-gray-700">{article.word_count ?? '—'}</dd>
                    </div>
                    <div className="flex-1">
                      <dt className="text-gray-400">大小</dt>
                      <dd className="mt-0.5 text-gray-700">{fmtSize(article.size)}</dd>
                    </div>
                  </div>
                  {article.meta && Object.keys(article.meta).length > 0 && (
                    <div>
                      <dt className="text-gray-400">frontmatter 元信息</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-all rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-500">
                        {JSON.stringify(article.meta, null, 2)}
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            )}
          </div>
        )}

        {tab === '附件' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                全部附件（{attachments.length}）
              </span>
              <button
                type="button"
                onClick={() => void loadAttachments()}
                className="text-[11px] text-gray-400 hover:text-blue-600"
              >
                刷新
              </button>
            </div>
            {attachError && <p className="text-xs text-red-500">{attachError}</p>}
            {attachments.length === 0 && !attachError && (
              <p className="text-xs text-gray-400">暂无附件</p>
            )}
            {attachments.map((a) => (
              <div key={a.rel_path} className="rounded border border-gray-100 p-2">
                <a
                  href={attachmentUrl(a.rel_path)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-[12px] text-gray-700 hover:text-blue-600"
                  title={a.rel_path}
                >
                  {a.name}
                </a>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="rounded bg-gray-100 px-1 py-px">{a.category}</span>
                  <span>{fmtSize(a.size)}</span>
                  <span>{fmtTime(a.mtime)}</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {a.referenced_by.length > 0 ? (
                    <>
                      所属文档：
                      {a.referenced_by.map((r) => (
                        <button
                          key={r}
                          type="button"
                          className="block max-w-full truncate text-blue-600 hover:underline"
                          title={r}
                          onClick={() => onOpenArticle?.(r)}
                        >
                          {r}
                        </button>
                      ))}
                    </>
                  ) : (
                    <span className="text-amber-500">未在任何文档中引用</span>
                  )}
                </div>
              </div>
            ))}

            {/* 孤儿附件：v0.6.1 起仅手动删除、绝不自动（后端 DELETE 只允许孤儿） */}
            {orphans.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-amber-600">
                    孤儿附件（{orphans.length}）
                  </span>
                </div>
                <p className="mb-2 text-[11px] leading-4 text-gray-400">
                  未被任何 Markdown 引用。仅手动删除，绝不自动；被引用附件后端会拒绝删除。
                </p>
                {orphans.map((o) => (
                  <div key={o.path} className="mb-1 rounded border border-amber-100 bg-amber-50/50 p-1.5">
                    <div className="flex items-start justify-between gap-1">
                      <div className="truncate font-mono text-[11px] text-gray-700" title={o.path}>
                        {o.name}
                      </div>
                      <button
                        type="button"
                        disabled={deletingPath === o.path}
                        onClick={() => void handleDeleteOrphan(o)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {deletingPath === o.path ? '删除中…' : '删除'}
                      </button>
                    </div>
                    <div className="mt-0.5 flex gap-2 text-[10px] text-gray-400">
                      <span>{fmtSize(o.size)}</span>
                      <span>{fmtTime(o.mtime)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
