/**
 * 通用信息块节点视图（InfoBlock）。
 * 数据模型 { id, label, title, color } + PM 可编辑内容（content: 'inline*'，v0.7.0）。
 *
 * 视觉对齐参考稿 editor.html（§5 ke-note）：
 * - 圆角卡片 + 浅底（非左缘色条、非彩色块背景）
 * - 顶行：徽章（可自定义文字）+ 标题输入 + 右侧 ⋯ 块菜单
 * - ⋯ 菜单：重命名徽章 / 更换颜色（色板）/ 删除信息块
 * - 内容区 PM 可编辑（可插入脚注上标等 inline 节点）
 *
 * Focus（task-3）纸面语言：
 * - 9 色预设改为**低饱和**纸面色（取自 Focus 交接包 overlays §08 色板），不再使用高饱和霓虹；
 * - 信息块底色 / 徽章底色 / 徽章文字 / 边框全部由预设色与语义 token 通过 color-mix 派生，
 *   深浅主题自动适配（--surface-2 / --foreground / --border 随主题翻转）；
 * - 背景透明度仍与设置项 --note-bg-alpha 联动（100% = 不透明）；
 * - 徽章 / 操作按钮 12–13px、圆角 8（--radius-control）。
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../icons'
import { askPrompt } from '../../common/PromptDialog'

/** 徽章/激活色（色板收进 ⋯ 菜单；default = 强调色系而不是整块染色）
 * Focus：9 色预设改为低饱和纸面色板（与 prototype/overlays.html §08 一致）；
 * 第 9 色仍为「跟随强调色」，任一项都通过 color-mix 与 token 混合后使用。 */
const COLOR_OPTIONS: Array<{ key: string; swatch: string; title: string }> = [
  { key: 'blue', swatch: '#4078e8', title: '蓝色' },
  { key: 'yellow', swatch: '#8a6a2f', title: '黄色' },
  { key: 'green', swatch: '#47704f', title: '绿色' },
  { key: 'red', swatch: '#a34e62', title: '红色' },
  { key: 'purple', swatch: '#7c5a86', title: '紫色' },
  { key: 'cyan', swatch: '#4f6f73', title: '青色' },
  { key: 'orange', swatch: '#a25d2b', title: '橙色' },
  { key: 'slate', swatch: '#6b7280', title: '灰色' },
  { key: 'accent', swatch: 'var(--primary)', title: '跟随强调色' },
]

const HEX_RE = /^#?([0-9a-f]{6})$/i

/** 任意 hex（# 可省）→ 规范化 #rrggbb；非 hex 返回 null */
function normalizeHex(color: string | undefined): string | null {
  if (typeof color !== 'string') return null
  const m = HEX_RE.exec(color.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

/** 预设色 / 自定义色与语义 token 混合 —— 深浅主题下都保持低饱和纸面感 */
function mix(color: string, pct: number, base: string): string {
  return `color-mix(in srgb, ${color} ${pct}%, ${base})`
}

/** 信息块背景透明度：与设置项 --note-bg-alpha 联动（沿用 v1.1.5 ④ 契约） */
function withNoteAlpha(color: string): string {
  return `color-mix(in srgb, ${color} calc(var(--note-bg-alpha, 1) * 100%), transparent)`
}

interface NoteTone {
  /** 色板圆点颜色 */
  dot: string
  /** 信息块底色（含透明度联动） */
  blockBg: string
  /** 信息块边框（预设色轻混合） */
  border: string
  /** 徽章底 / 文字 / 边框 */
  badgeBg: string
  badgeFg: string
  badgeBorder: string
}

/** 解析 color 属性 → Focus 纸面配色（缺省/未知值 = 强调色系，与旧 DEFAULT_BADGE 行为一致） */
function resolveTone(color: string | undefined): NoteTone {
  const hex = normalizeHex(color)
  const key = hex ? '' : (color ?? '')
  const preset = hex ? null : COLOR_OPTIONS.find((o) => o.key === key)
  if (!hex && (key === '' || key === 'accent' || !preset)) {
    const accent = COLOR_OPTIONS.find((o) => o.key === 'accent')!.swatch
    return {
      dot: accent,
      blockBg: withNoteAlpha('var(--primary-soft)'),
      border: mix(accent, 18, 'var(--border)'),
      badgeBg: 'var(--primary-soft)',
      badgeFg: 'var(--accent-foreground)',
      badgeBorder: mix(accent, 26, 'var(--border)'),
    }
  }
  const base = hex ?? preset!.swatch
  return {
    dot: base,
    blockBg: withNoteAlpha(mix(base, 9, 'var(--surface-2)')),
    border: mix(base, 18, 'var(--border)'),
    badgeBg: mix(base, 14, 'var(--surface-2)'),
    // 与前景色混合 → 亮色主题得深字、深色主题得浅字（自动取对比色）
    badgeFg: mix(base, 62, 'var(--foreground)'),
    badgeBorder: mix(base, 26, 'var(--border)'),
  }
}

export default function NoteNodeView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  // v1.1.6：占位符隐藏不能用 :focus-within——PM 焦点在编辑器根（note 是后代），
  // 反向不匹配。改用 PM 选区判定：光标落在本 note 内容范围即视为「输入中」。
  const [contentFocused, setContentFocused] = useState(false)
  useEffect(() => {
    const update = () => {
      const pos = getPos?.() ?? -1
      if (pos < 0) return
      const { from } = editor.state.selection
      // 光标在信息块内 → 聚焦；光标在【紧邻其后的空段落】（编辑器托尾空段，
      // 视觉上像信息块的第二行）→ 同样视为聚焦（用户点击该行占位符也应隐藏）
      let inNote = from > pos + 1 && from <= pos + node.nodeSize
      if (!inNote) {
        const after = pos + node.nodeSize
        const sibling = editor.state.doc.nodeAt(after)
        if (sibling && sibling.type.name === 'paragraph' && sibling.textContent === '') {
          inNote = from > after && from <= after + sibling.nodeSize
        }
      }
      setContentFocused(inNote)
    }
    update()
    editor.on('selectionUpdate', update)
    return () => {
      editor.off('selectionUpdate', update)
    }
  }, [editor, getPos, node])
  const attrs = node.attrs as Record<string, unknown>
  const label = (attrs.label as string) ?? ''
  const title = (attrs.title as string) ?? ''
  // v1.1.7（A）：block+ 后空信息块 = 单个空段落（size>0）——空判定改为「无任何非空白文本」
  const isEmpty =
    node.content.size === 0 ||
    (node.content.childCount <= 1 && node.textContent.trim() === '')
  const color = (attrs.color as string) || ''
  const tone = resolveTone(color)

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
      className="ke-note mt-5 rounded-menu border px-3.5 pb-3 pt-2.5"
      style={{ borderColor: tone.border, backgroundColor: tone.blockBg }}
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
          className="inline-flex h-5 w-16 shrink-0 items-center justify-center truncate rounded-control border px-1.5 text-center text-[12px] font-medium leading-none outline-none transition-colors placeholder:font-normal placeholder:text-text-3"
          style={{ backgroundColor: tone.badgeBg, color: tone.badgeFg, borderColor: tone.badgeBorder }}
        />
        <input
          contentEditable={false}
          value={title}
          placeholder="信息块标题"
          title="信息块标题（可自定义）"
          onChange={(e) => updateAttributes({ title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-text-3"
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
            className="grid h-6 w-6 place-items-center rounded-control text-text-3 transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-foreground active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none"
          >
            <Icon name="more-horizontal" className="size-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-menu border border-border bg-card py-1 shadow-float">
              <button
                type="button"
                contentEditable={false}
                className="block w-full px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-surface-2"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false)
                  badgeRef.current?.focus()
                }}
              >
                重命名徽章…
              </button>
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
                {COLOR_OPTIONS.map((c) => {
                  const active = attrs.color === c.key
                  return (
                    <button
                      key={c.key}
                      type="button"
                      contentEditable={false}
                      title={c.title}
                      aria-label={`信息块颜色：${c.title}`}
                      aria-pressed={active}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => updateAttributes({ color: c.key })}
                      className={[
                        'h-[18px] w-[18px] rounded-full transition-transform',
                        active ? '' : 'opacity-75 hover:scale-105 hover:opacity-100',
                      ].join(' ')}
                      style={{
                        backgroundColor: c.swatch,
                        outline: active ? '2px solid var(--text-3)' : undefined,
                        outlineOffset: active ? '2px' : undefined,
                      }}
                    />
                  )
                })}
                <button
                  type="button"
                  contentEditable={false}
                  title="自定义颜色（输入色号）"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    void (async () => {
                      setMenuOpen(false)
                      const curColor = (attrs.color as string | undefined) ?? ''
                      const hex = await askPrompt('徽标颜色（色号，如 #e11d48）', curColor.startsWith('#') ? curColor : '')
                      if (hex === null) return
                      const v = hex.trim()
                      if (!/^#?[0-9a-fA-F]{6}$/.test(v)) {
                        window.alert('请输入 6 位十六进制色号（如 #e11d48）')
                        return
                      }
                      updateAttributes({ color: v.startsWith('#') ? v : `#${v}` })
                    })()
                  }}
                  className="flex w-full items-center justify-center gap-1 rounded-control border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-2 transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                  <Icon name="paint" className="size-3" />
                  自定义颜色…
                </button>
              </div>
              <button
                type="button"
                contentEditable={false}
                className="block w-full border-t border-border px-3 py-1.5 text-left text-[12px] text-danger transition-colors hover:bg-[var(--danger-soft)]"
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
        className={`ke-note-content mt-2 px-0 text-[15px] leading-[1.7] outline-none focus:ring-0${isEmpty ? ' ke-note-content--empty' : ''}${isEmpty && contentFocused ? ' ke-note-content--focused' : ''}`}
        data-note-content-area
        onMouseDown={() => setContentFocused(true)}
        style={{ color: 'var(--foreground)' }}
      />
    </NodeViewWrapper>
  )
}
