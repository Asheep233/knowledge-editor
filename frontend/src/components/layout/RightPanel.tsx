/** 右侧面板（Phase 4.6 / 4.7）：
 * - 大纲：占位（Phase 3 文档标题结构）
 * - 属性：文档元信息面板 —— 标题 / 标签编辑（写入 frontmatter）、路径、创建/修改时间、字数、大小
 * - 附件：全部附件列表（类型/大小/所属文档，点击打开）+ 孤儿附件检测（仅手动删除、绝不自动）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteAttachment,
  listAttachments,
  listOrphans,
  updateArticleMeta,
} from '../../api/client'
import { extractOutline, type OutlineItem } from '../../state/outline'
import type { ArticleMeta, AttachmentItem, OrphanItem } from '../../types'
import { Icon } from '../icons'

interface Props {
  article: ArticleMeta | null
  /** 元信息保存成功后回写 App 的 article（标题/标签同步到顶栏与左侧树） */
  onMetaUpdate?: (doc: ArticleMeta) => void
  /** 点击附件所属文档时打开对应文档 */
  onOpenArticle?: (id: string) => void
  /** 折叠右侧面板（收起按钮位于面板顶部 tab 栏右侧） */
  onCollapse?: () => void
  /** 查看历史快照（参考稿 HistorySnapshotsCard「查看历史」按钮） */
  onOpenHistory?: () => void
  /** 最近快照时间（参考稿展示；缺省用 article.updated_at 兜底） */
  lastSnapshotAt?: string
}

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

export default function RightPanel({ article, onMetaUpdate, onOpenArticle, onCollapse, onOpenHistory, lastSnapshotAt }: Props) {
  // 参考稿无 tab：三卡堆叠（属性 / 大纲[可折叠] / 附件+孤儿 / 历史快照）
  const [outlineOpen, setOutlineOpen] = useState(true)
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
    void loadAttachments()
  }, [loadAttachments, article?.id])

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
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between px-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[14px] font-semibold" style={{ color: 'var(--foreground)' }}>文档属性</span>
        <button
          type="button"
          onClick={onCollapse}
          title="收起属性栏"
          aria-label="收起属性栏"
          className="grid h-8 w-8 place-items-center rounded-[6px] text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <Icon name="panel-right-close" className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {/* ============ DocPropertiesCard（参考稿字段行堆叠） ============ */}
        <div className="rounded-[8px] border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
          {!article ? (
            <div className="px-3.5 py-2.5 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>未打开文档</div>
          ) : (
            <>
              {/* 标题编辑（保留功能，顶部） */}
              <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>标题</div>
                <input
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setDirty(true) }}
                  className="mt-0.5 w-full bg-transparent text-[13px] outline-none"
                  style={{ color: 'var(--foreground)' }}
                />
              </div>
              {/* 标签编辑（保留功能） */}
              <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>标签</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {tags.map((t) => (
                    <span key={t} className="group inline-flex items-center gap-1 rounded-[999px] px-2 py-[1px] text-[11px]" style={{ backgroundColor: 'var(--secondary)', color: 'var(--accent-foreground)' }}>
                      #{t}
                      <button type="button" title="移除标签" className="opacity-60 hover:opacity-100" onClick={() => removeTag(t)}>
                        <Icon name="close" className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    placeholder="+ 标签"
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addTag() }
                      else if (e.key === 'Backspace' && !tagInput && tags.length > 0) { removeTag(tags[tags.length - 1]) }
                    }}
                    className="min-w-[50px] flex-1 bg-transparent text-[12px] outline-none"
                    style={{ color: 'var(--foreground)' }}
                  />
                </div>
              </div>
              {dirty && (
                <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => void handleSaveMeta()}
                    disabled={saving}
                    className="h-7 rounded-[6px] px-3 text-[12px] font-medium text-primary-foreground transition-all hover:brightness-95 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--primary)' }}
                  >
                    {saving ? '保存中…' : '保存属性'}
                  </button>
                </div>
              )}
              {/* 字段行（参考稿顺序：类型/字数/创建/修改/大小/保存位置/KE 版本） */}
              <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>类型</div>
                <div className="mt-0.5 text-[13px]" style={{ color: 'var(--foreground)' }}>{article.path.startsWith('Modules/') ? '模块' : '文档'}</div>
              </div>
              <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>字数</div>
                <div className="mt-0.5 text-[13px]" style={{ color: 'var(--foreground)' }}>{article.word_count ?? '—'}</div>
              </div>
              <div className="flex gap-4 border-b px-3.5 py-2.5" style={{ borderColor: 'var(--border)' }}>
                <div className="flex-1">
                  <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>创建时间</div>
                  <div className="mt-0.5 text-[13px]" style={{ color: 'var(--foreground)' }}>{fmtTime(article.created_at)}</div>
                </div>
                <div className="flex-1">
                  <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>修改时间</div>
                  <div className="mt-0.5 text-[13px]" style={{ color: 'var(--foreground)' }}>{fmtTime(article.updated_at)}</div>
                </div>
              </div>
              <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>大小</div>
                <div className="mt-0.5 text-[13px]" style={{ color: 'var(--foreground)' }}>{fmtSize(article.size)}</div>
              </div>
              <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>保存位置</div>
                <div className="mt-0.5 break-all text-[12px] leading-[1.6]" style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>{article.path}</div>
              </div>
              <div className="px-3.5 py-2.5">
                <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>KE 版本</div>
                <div className="mt-0.5 text-[13px]" style={{ color: 'var(--foreground)' }}>v{typeof article.meta?.ke_version === 'number' ? article.meta.ke_version : '—'}</div>
              </div>
              {article.meta && Object.keys(article.meta).length > 0 && (
                <div className="px-3.5 py-2.5" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>frontmatter</div>
                  <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.6]" style={{ color: 'var(--muted-foreground)' }}>
                    {JSON.stringify(article.meta, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* ============ 大纲（可折叠小节，原有功能保留） ============ */}
        <div>
          <div className="flex items-center px-1">
            <button
              type="button"
              onClick={() => setOutlineOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[13px] font-semibold"
              style={{ color: 'var(--foreground)' }}
            >
              <Icon name={outlineOpen ? 'chevron-down' : 'chevron-right'} className="size-3.5 text-muted-foreground" />
              大纲
            </button>
            <span className="ml-1 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>{outline.length}</span>
          </div>
          {outlineOpen && (
            <div className="mt-1.5">
              {outline.length === 0 ? (
                <p className="px-1 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>暂无标题（使用 # / ## / ###）</p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setCollapseDepth((d) => (d > 0 ? 0 : 1))}
                    className="mb-1 px-1 text-[11px] text-primary hover:underline"
                  >
                    {collapseDepth > 0 ? '展开全部' : '收缩至一级'}
                  </button>
                  <ul className="space-y-0.5">
                    {visibleOutline.map((it, idx) => (
                      <li key={`${it.offset}-${idx}`}>
                        <button
                          type="button"
                          onClick={() => handleOutlineClick(it)}
                          className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[12px] hover:bg-accent"
                          style={{ paddingLeft: `${(it.level - 1) * 12 + 6}px`, color: 'var(--foreground)' }}
                          title={it.text}
                        >
                          <span className="mr-1 text-[10px] text-muted-foreground">{'#'.repeat(it.level)}</span>
                          {it.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        {/* ============ AttachmentsSection（参考稿：图标行 + 大小 + 已引用/未引用徽章 + 孤儿注释） ============ */}
        <div>
          <div className="flex items-center px-1">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--foreground)' }}>附件</span>
            <span className="ml-1 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>{attachments.length}</span>
            <button
              type="button"
              aria-label="添加附件"
              title="添加附件"
              onClick={() => void loadAttachments()}
              className="ml-auto grid h-7 w-7 place-items-center rounded-[6px] text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <Icon name="plus" className="size-4" />
            </button>
          </div>
          {attachError && <p className="mt-1 px-1 text-[12px] text-rose-500">{attachError}</p>}
          <div className="mt-1.5 flex flex-col">
            {attachments.length === 0 && !attachError && (
              <p className="px-1 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>暂无附件</p>
            )}
            {attachments.map((a) => {
              const cited = a.referenced_by.length > 0
              const catIcon = a.category === 'images' ? 'image' : a.category === 'videos' ? 'video' : 'file-text'
              return (
                <button
                  key={a.rel_path}
                  type="button"
                  onClick={() => (cited && a.referenced_by[0] ? onOpenArticle?.(a.referenced_by[0]) : undefined)}
                  title={a.referenced_by[0] ? `所属文档：${a.referenced_by[0]}` : a.rel_path}
                  className="flex h-8 w-full items-center gap-2 rounded-[6px] px-1.5 text-left transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none"
                  style={{ color: 'var(--foreground)' }}
                >
                  <Icon name={catIcon as 'image'} className="size-4 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{a.name}</span>
                  <span className="shrink-0 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>{fmtSize(a.size)}</span>
                  <span
                    className="inline-flex shrink-0 items-center rounded-[999px] px-1.5 py-[1px] text-[11px]"
                    style={cited ? { backgroundColor: 'var(--secondary)', color: 'var(--accent-foreground)' } : { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                  >
                    {cited ? '已引用' : '未引用'}
                  </span>
                </button>
              )
            })}
            <p className="px-1.5 pb-0.5 pt-0.5 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
              孤儿附件仅支持手动删除，不随笔记回滚。
            </p>
          </div>

          {/* 孤儿附件（仅手动删除、绝不自动） */}
          {orphans.length > 0 && (
            <div className="mt-2 rounded border border-amber-100 bg-amber-50/50 p-2">
              <div className="mb-1 text-[12px] font-medium text-amber-600">孤儿附件（{orphans.length}）</div>
              <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
                未被任何 Markdown 引用。仅手动删除，绝不自动；被引用附件后端会拒绝删除。
              </p>
              {orphans.map((o) => (
                <div key={o.path} className="mb-1 flex items-start justify-between gap-1">
                  <div className="truncate font-mono text-[11px] text-foreground" title={o.path}>
                    {o.name}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{fmtSize(o.size)}</span>
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
              ))}
            </div>
          )}
        </div>

        {/* ============ HistorySnapshotsCard（参考稿） ============ */}
        {article && onOpenHistory ? (
          <div>
            <div className="flex items-center px-1">
              <span className="text-[13px] font-semibold" style={{ color: 'var(--foreground)' }}>历史快照</span>
              <span className="ml-1 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>auto-save</span>
            </div>
            <div className="mt-1.5 rounded-[8px] border px-3 py-2.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--popover)' }}>
              <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--foreground)' }}>
                <Icon name="clock" className="size-4 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                <span className="truncate">{fmtTime(lastSnapshotAt ?? article.updated_at)} 自动保存</span>
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="ml-auto h-7 shrink-0 rounded-[6px] px-2 text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  查看历史
                </button>
              </div>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                已保存 30 份快照，存放于笔记旁
              </p>
            </div>
          </div>
        ) : null}

        {/* 底部：Markdown 为唯一事实源 */}
        <div className="mt-auto px-1 pb-1">
          <p className="text-center text-[12px] leading-[1.7]" style={{ color: 'var(--muted-foreground)' }}>
            Markdown 为唯一事实源
            <br />
            索引可整体重建
          </p>
        </div>
      </div>
    </aside>
  )
}
