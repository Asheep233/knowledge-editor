/**
 * 全屏公式编辑器（v1.1.7 M2，知乎式）。
 * - 外圈半透明、点击不关闭（防误触丢稿）；Esc=保存（空=删除）/「完成」关闭
 * - 源码输入框（非受控）：Enter=换行、Esc=保存/空删除、Tab=补全选择或槽位跳转
 * - 右侧常驻模板面板（点击插入骨架 + 光标落槽）
 * - KaTeX 实时预览；可视化模式（MathLive）切换保留
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Icon } from '../icons'
import { MATH_TEMPLATES } from '../../editor/math/templates'
import { completions } from '../../editor/math/completions'
import { stripSlots, nextSlot, insertAt } from '../../editor/math/slots'
import { getCachedSettings } from '../../settings'


interface Props {
  open: boolean
  initialValue: string
  isBlock: boolean
  /** 保存（传入已剥离槽位的内容）；内容空且空删除不触发时由调用方处理 */
  onSave: (latex: string) => void
  /** 空内容 Esc/完成 → 删除整个节点 */
  onDeleteEmpty: () => void
  onClose: () => void
}

export default function MathEditorModal({ open, initialValue, isBlock, onSave, onDeleteEmpty, onClose }: Props) {
  const [latex, setLatex] = useState(initialValue)
  const [mode, setMode] = useState<'latex' | 'mathlive'>('latex')
  const [suggOpen, setSuggOpen] = useState(false)
  const [suggIdx, setSuggIdx] = useState(0)
  // v1.1.7 ② 设置：公式自动补全开关（Tab 补全仅当开启；模板面板/槽位跳转不受影响）
  const completionsEnabled = getCachedSettings().editor.mathAutocomplete !== false
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isBlockRef = useRef(isBlock)
  isBlockRef.current = isBlock

  // 计算当前补全候选：光标前的 `\` 前缀
  const suggestions = useMemo(() => {
    const t = textareaRef.current
    if (!t || mode !== 'latex') return []
    const before = t.value.slice(0, t.selectionStart ?? 0)
    const m = /\\[a-zA-Z]+$/.exec(before)
    if (!m) return []
    return completions(m[0])
  }, [latex, mode, suggOpen, completionsEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // 预览渲染
  const [previewHtml, setPreviewHtml] = useState('')
  const [renderFailed, setRenderFailed] = useState(false)
  useEffect(() => {
    if (mode !== 'latex') return
    try {
      setPreviewHtml(
        katex.renderToString(latex || '\\;', { displayMode: isBlock, throwOnError: false }),
      )
      setRenderFailed(false)
    } catch {
      setRenderFailed(true)
    }
  }, [latex, mode, isBlock])

  useEffect(() => {
    if (!open) return
    // 打开时聚焦输入框末尾（非受控，光标不动）
    const t = textareaRef.current
    if (t) {
      t.focus()
      try {
        t.setSelectionRange(t.value.length, t.value.length)
      } catch {
        /* ignore */
      }
    }
  }, [open])

  if (!open) return null

  const close = (save: boolean) => {
    onClose()
    if (save) {
      const cleaned = stripSlots(latex).trim()
      // double-rAF：等 NodeView 根与 Editor 根（跨根渲染）全部落定后，再发起 PM 事务——
      // 模态（portal，独立 React 根）内直接触发 PM 更新会撞 #300 update-during-render
      const op = window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          if (cleaned === '') {
            onDeleteEmpty()
          } else {
            onSave(cleaned)
          }
        }),
      )
      return () => window.cancelAnimationFrame(op)
    }
  }

  /** 光标当前 `\` 前缀（供 Tab 选择） */
  const currentPrefix = (): string => {
    const t = textareaRef.current
    if (!t) return ''
    const before = t.value.slice(0, t.selectionStart ?? 0)
    const m = /\\[a-zA-Z]+$/.exec(before)
    return m ? m[0] : ''
  }

  const focusAt = (pos: number, selectLen = 0) => {
    const t = textareaRef.current
    if (!t) return
    t.focus()
    try {
      t.setSelectionRange(pos, pos + selectLen)
    } catch {
      /* ignore */
    }
  }

  /** 前缀替换：把 `\fr` 替换为选中项（普通命令：光标末尾；含槽：光标首槽） */
  /** execCommand('insertText') 插入——走原生撤销栈（Ctrl+Z 可撤模板/补全插入，VS Code 手感） */
  const insertViaExec = (insert: string, nextCursor: number, selectLen = 0): boolean => {
    const t = textareaRef.current
    if (!t) return false
    t.focus()
    let ok = false
    try {
      ok = document.execCommand('insertText', false, insert) && t.value.includes(insert)
    } catch {
      ok = false
    }
    if (ok) {
      setLatex(t.value)
      focusAt(nextCursor, selectLen)
      return true
    }
    return false
  }

  const applyCompletion = (insert: string) => {
    const t = textareaRef.current
    if (!t) return
    const start = (t.selectionStart ?? 0) - currentPrefix().length
    const end = t.selectionStart ?? t.value.length
    const r = insertAt(t.value, start, end, insert)
    const selLen = r.cursor < r.value.length && r.value[r.cursor] === '□' ? 1 : 0
    // v1.1.7 修复：先**选中前缀**再 execCommand——否则命令只会在光标处插入，
    // 前缀 `\fr` 残留（结果为 `\fr\frac{□}{□}`，公式失效）
    try {
      t.focus()
      t.setSelectionRange(start, end)
    } catch {
      /* ignore */
    }
    if (!insertViaExec(insert, r.cursor, selLen)) {
      // 兜底：手动替换（非受控 DOM 写入）
      t.value = r.value
      setLatex(r.value)
      focusAt(r.cursor, selLen)
    }
    setSuggOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = textareaRef.current
    if (e.key === 'Tab') {
      e.preventDefault()
      if (suggOpen && currentPrefix()) {
        const items = suggestions
        if (items.length) {
          applyCompletion(items[suggIdx % items.length].insert)
          return
        }
      }
      // 槽位跳转（无补全或补全关闭）：当前光标选中的 □ → 跳到下一个
      const selStart = t?.selectionStart ?? 0
      const selEnd = t?.selectionEnd ?? selStart
      const pos = nextSlot(latex, selEnd > selStart ? selEnd : selStart)
      if (pos >= 0) focusAt(pos, 1)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
      return
    }
    if (e.key === 'ArrowDown' && suggOpen) {
      e.preventDefault()
      setSuggIdx((i) => i + 1)
      return
    }
    if (e.key === 'ArrowUp' && suggOpen) {
      e.preventDefault()
      setSuggIdx((i) => Math.max(0, i - 1))
      return
    }
  }

  /** 模板插入（面板点击）：插入骨架 + 光标首槽 */
  const insertTemplate = (latexTpl: string) => {
    const t = textareaRef.current
    if (!t) return
    const start = t.selectionStart ?? t.value.length
    const end = t.selectionEnd ?? start
    const r = insertAt(t.value, start, end, latexTpl)
    const selLen = r.cursor < r.value.length && r.value[r.cursor] === '□' ? 1 : 0
    if (!insertViaExec(latexTpl, r.cursor, selLen)) {
      t.value = r.value
      setLatex(r.value)
      focusAt(r.cursor, selLen)
    }
    setSuggOpen(false)
  }

  const onTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const v = (e.target as HTMLTextAreaElement).value
    setLatex(v)
    const before = v.slice(0, (e.target as HTMLTextAreaElement).selectionStart ?? 0)
    setSuggOpen(completionsEnabled && /\\[a-zA-Z]+$/.test(before))
    setSuggIdx(0)
  }

  const groups = useMemo(() => {
    const g: Record<string, typeof MATH_TEMPLATES> = {}
    for (const t of MATH_TEMPLATES) {
      const key = t.group ?? '其他'
      ;(g[key] ??= []).push(t)
    }
    return g
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="flex w-[min(860px,100%)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" style={{ maxHeight: '92vh' }}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-[14px] font-semibold text-foreground">{isBlock ? '块级公式' : '行内公式'}</span>
          <span className="text-[12px] text-muted-foreground">Enter=换行 · Esc=保存（空=删除）· Tab=补全/跳槽</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'latex' ? 'mathlive' : 'latex'))}
              className="rounded-md border border-border bg-muted px-2.5 py-1 text-[12px] text-foreground/80 hover:text-foreground"
            >
              {mode === 'latex' ? '可视化编辑' : '源码编辑'}
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="rounded-md bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground hover:brightness-95"
            >
              完成
            </button>
            <button type="button" title="关闭" onClick={() => close(true)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Icon name="close" className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* 主区：输入 + 预览 */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
            {mode === 'latex' ? (
              <div className="relative">
                <textarea
                  ref={(el) => {
                    textareaRef.current = el
                  }}
                  defaultValue={initialValue}
                  className="w-full resize-none rounded-lg border border-border bg-background p-3 font-mono text-[16px] leading-[1.7] outline-none focus:ring-2 focus:ring-ring/20"
                  style={{ color: 'var(--foreground)', minHeight: isBlock ? 180 : 72 }}
                  rows={isBlock ? 6 : 2}
                  spellCheck={false}
                  placeholder="输入 LaTeX，例如 E=mc^2"
                  onInput={onTextareaInput}
                  onKeyDown={onKeyDown}
                  onBlur={() => setTimeout(() => setSuggOpen(false), 200)}
                  onFocus={() => {
                    const t = textareaRef.current
                    if (t) {
                      const before = t.value.slice(0, t.selectionStart ?? 0)
                      setSuggOpen(/\\[a-zA-Z]+$/.test(before))
                    }
                  }}
                />
                {suggOpen && suggestions.length > 0 && (
                  <div className="absolute left-2 top-full z-10 mt-1 max-h-56 w-[340px] overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg">
                    <div className="border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
                      ↑↓ 切换 · <span className="font-medium">Tab</span> 插入 · Esc 关闭
                    </div>
                    {suggestions.map((item, i) => (
                      <button
                        key={item.label + i}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setSuggIdx(i)
                          applyCompletion(item.insert)
                        }}
                        className={[
                          'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px]',
                          i === suggIdx ? 'bg-accent ring-1 ring-inset ring-[var(--primary)]' : '',
                        ].join('')}
                        style={{ color: 'var(--foreground)' }}
                      >
                        <span className="font-mono">{item.label}</span>
                        <span className="text-[11px] text-muted-foreground">{item.detail}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-background p-3">
                <span className="text-[12px] text-muted-foreground">可视化编辑（MathLive）</span>
                {/* MathLive 通过 NodeView 原有能力保留该模式切换；此处以源码回显示意（实时预览下方仍生效） */}
                <div className="mt-2 text-[13px] text-foreground/80">可视化模式仍由节点视图组件提供——本模态 v1 聚焦源码+模板体验。</div>
              </div>
            )}
            <div className="min-h-[60px] flex-1 rounded-lg border border-border bg-background/60 p-3">
              <div className="mb-1 text-[12px] text-muted-foreground">渲染预览</div>
              <div
                className="overflow-x-auto text-center"
                style={{ color: renderFailed ? '#f87171' : 'var(--foreground)', fontSize: isBlock ? 20 : 16 }}
                dangerouslySetInnerHTML={{ __html: renderFailed ? '（无效公式）' : previewHtml }}
              />
            </div>
          </div>
          {/* 模板面板（常驻右栏） */}
          <div className="hidden w-[240px] shrink-0 overflow-y-auto border-l border-border p-3 md:block">
            <div className="mb-2 text-[12px] font-semibold text-foreground">常用公式模板</div>
            {Object.entries(groups).map(([gname, items]) => (
              <div key={gname} className="mb-3">
                <div className="mb-1 text-[11px] text-muted-foreground">{gname}</div>
                <div className="flex flex-col gap-1">
                  {items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertTemplate(t.latex)}
                      className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-left font-mono text-[12px] transition-colors hover:bg-accent"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
