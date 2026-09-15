/** 右侧面板（Phase 4.6 / 4.7）—— **只放文档属性**（task-12：其它能力已迁至左栏 LeftSidebar 对应小节）：
 * - 大纲：占位（Phase 3 文档标题结构）
 * - 属性：文档元信息面板 —— 标题 / 标签编辑（写入 frontmatter）、路径、创建/修改时间、字数、大小
 * - 历史快照卡片 + 收起右栏能力
 * 只读展示：本组件不写回任何文档内容（引用重写属 D 层红线，本期排除）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { updateArticleMeta } from '../../api/client'
import { extractOutline, type OutlineItem } from '../../state/outline'
import type { ArticleMeta } from '../../types'
import { Icon } from '../icons'

interface Props {
  article: ArticleMeta | null
  /** 元信息保存成功后回写 App 的 article（标题/标签同步到顶栏与左侧树） */
  onMetaUpdate?: (doc: ArticleMeta) => void
  /** 打开文档回调（保留 prop 以兼容 App 调用；右栏当前无跳转入口） */
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

export default function RightPanel({ article, onMetaUpdate, onCollapse, onOpenHistory, lastSnapshotAt }: Props) {
  // 参考稿无 tab：三卡堆叠（属性 / 大纲[可折叠] / 历史快照）
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

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
