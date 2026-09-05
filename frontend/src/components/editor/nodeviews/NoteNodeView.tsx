/**
 * 通用信息块节点视图（InfoBlock）。
 * 数据模型 { id, label, title, color } + PM 可编辑内容（content: 'inline*'，v0.7.0）。
 *
 * 视觉对齐参考稿 editor.html（§5 ke-note）：
 * - 圆角 8 圆形边框 + popover 底（非左缘色条、非彩色块背景）
 * - 顶行：徽章（rounded-[4px] 小胶囊，可自定义）+ 标题输入 + 右侧 ⋯ 块菜单
 * - ⋯ 菜单：重命名徽章 / 更换颜色（色板）/ 删除信息块
 * - 内容区 PM 可编辑（可插入脚注上标等 inline 节点）
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../icons'

/** 徽章/激活色（色板收进 ⋯ 菜单；default = primary 系而不是整块染色） */
const COLOR_OPTIONS: Array<{ key: string; cls: string; title: string }> = [
  { key: 'blue', cls: 'bg-sky-400', title: '蓝色' },
  { key: 'yellow', cls: 'bg-amber-400', title: '黄色' },
  { key: 'green', cls: 'bg-emerald-400', title: '绿色' },
  { key: 'red', cls: 'bg-rose-400', title: '红色' },
  { key: 'purple', cls: 'bg-violet-400', title: '紫色' },
]

/** 徽章底色（参考稿：--accent 淡蓝底 + --accent-foreground 深蓝字） */
const BADGE_BASE =
  'inline-flex items-center rounded-[4px] px-1.5 py-[2px] text-[12px] outline-none'

/** color 属性 → 徽章底/文字色（色板选择驱动外观；缺省沿用 accent 淡蓝） */
const COLOR_MAP: Record<string, { badge: string; fg: string }> = {
  blue: { badge: '#dbeafe', fg: '#003e8f' },
  yellow: { badge: '#fef3c7', fg: '#92400e' },
  green: { badge: '#d1fae5', fg: '#065f46' },
  red: { badge: '#fee2e2', fg: '#991b1b' },
  purple: { badge: '#ede9fe', fg: '#5b21b6' },
}
const DEFAULT_BADGE = { badge: 'var(--accent)', fg: 'var(--accent-foreground)' }

export default function NoteNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as Record<string, unknown>
  const label = (attrs.label as string) ?? ''
  const title = (attrs.title as string) ?? ''
  const isEmpty = node.content.size === 0
  const color = (attrs.color as string) || ''
  const badgeStyle = COLOR_MAP[color] ?? DEFAULT_BADGE

  // 块菜单（⋯）：重命名徽章 / 更换颜色 / 删除信息块
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const badgeRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  return (
    <NodeViewWrapper
      as="div"
      data-ke-note=""
      data-id={attrs.id ?? ''}
      data-label={attrs.label ?? ''}
      data-title={attrs.title ?? ''}
      data-color={attrs.color ?? ''}
      data-author={attrs.author ?? ''}
      data-created={attrs.created ?? ''}
      data-updated={attrs.updated ?? ''}
      className="ke-note mt-5 rounded-[8px] border px-3 pb-3 pt-2.5"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--popover)' }}
    >
      {/* 顶行：徽章 + 标题 + ⋯ 菜单 */}
      <div className="flex items-center gap-2">
        <input
          ref={badgeRef}
          contentEditable={false}
          value={label}
          placeholder="徽章"
          title="徽章文字（可自定义，空则不显示徽章）"
          onChange={(e) => updateAttributes({ label: e.target.value })}
          className={`${BADGE_BASE} w-16 shrink-0 truncate text-center text-[12px]`}
          style={{ backgroundColor: badgeStyle.badge, color: badgeStyle.fg }}
        />
        <input
          contentEditable={false}
          value={title}
          placeholder="信息块标题"
          title="信息块标题（可自定义）"
          onChange={(e) => updateAttributes({ title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
          style={{ color: 'var(--foreground)' }}
        />
        {/* 块菜单（⋯） */}
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            contentEditable={false}
            title="信息块菜单"
            aria-label="信息块菜单"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-6 w-6 place-items-center rounded-[4px] text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <Icon name="more-horizontal" className="size-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-0.5 w-36 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg">
              <button
                type="button"
                contentEditable={false}
                className="block w-full px-2.5 py-1.5 text-left text-[12px] hover:bg-accent"
                style={{ color: 'var(--foreground)' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false)
                  badgeRef.current?.focus()
                }}
              >
                重命名徽章…
              </button>
              <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-1.5">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    contentEditable={false}
                    title={c.title}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => updateAttributes({ color: c.key })}
                    className={[
                      'h-4 w-4 rounded-full transition-transform',
                      c.cls,
                      attrs.color === c.key ? 'ring-2 ring-blue-400 ring-offset-1' : 'opacity-70 hover:opacity-100',
                    ].join(' ')}
                  />
                ))}
              </div>
              <button
                type="button"
                contentEditable={false}
                className="block w-full border-t border-border px-2.5 py-1.5 text-left text-[12px] text-rose-600 hover:bg-rose-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false)
                  deleteNode()
                }}
              >
                删除信息块
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PM 可编辑内容区：块内文字可插入脚注上标等 inline 节点 */}
      <NodeViewContent
        as="div"
        className={`ke-note-content mt-1.5 px-0 text-[14px] leading-[1.7] outline-none focus:ring-0${isEmpty ? ' ke-note-content--empty' : ''}`}
        style={{ color: 'var(--foreground)' }}
      />
    </NodeViewWrapper>
  )
}
