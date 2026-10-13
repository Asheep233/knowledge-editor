/**
 * task-72：导出 PDF 对话框（选项 + A4 缩略预览）。
 *
 * 硬约束：
 *  - **预览不得移动真实正文节点**：用独立渲染容器 + `editor.getHTML()`（只读快照）；
 *  - **预览与打印同一套排版规则**：预览容器 `.ke-print-surface`，其声明与 `print.css`
 *    的 `@media print` 共享块**逐条一致**（`print-css.test.ts` 有断言防漂移）；
 *  - **颜色只走 CSS 变量覆盖**：预览用容器内联变量；导出临时写 `<style id="ke-print-overrides">`
 *    并在结束（成功/失败）后**立即移除**；
 *  - 不碰保存链、不调 `getMarkdown()`、不写工作区文件。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Icon } from '../icons'

export type PdfThemeChoice = 'current' | 'light' | 'dark'
/** 颜色项：'theme' = 用主题默认值；否则为具体色值（#rgb/#rrggbb） */
export type PdfColorChoice = 'theme' | string

export interface PdfExportOptions {
  theme: PdfThemeChoice
  background: PdfColorChoice
  foreground: PdfColorChoice
  /** 强调色（标题 / 链接 / 引用条） */
  accent: PdfColorChoice
  /** 记住我的选择（localStorage） */
  remember: boolean
}

export const PDF_OPTIONS_STORAGE_KEY = 'ke.exportPdf.options'
export const PRINT_OVERRIDES_STYLE_ID = 'ke-print-overrides'

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  theme: 'current',
  background: 'theme',
  foreground: 'theme',
  accent: 'theme',
  remember: true,
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** 只有合法十六进制色值才会被采纳（防注入到 <style> 的任意字符串） */
export function sanitizeColor(v: unknown): PdfColorChoice {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : 'theme'
}

export function normalizePdfOptions(raw: unknown): PdfExportOptions {
  const o = (raw ?? {}) as Partial<PdfExportOptions>
  const theme: PdfThemeChoice = o.theme === 'light' || o.theme === 'dark' ? o.theme : 'current'
  return {
    theme,
    background: sanitizeColor(o.background),
    foreground: sanitizeColor(o.foreground),
    accent: sanitizeColor(o.accent),
    remember: o.remember !== false,
  }
}

export function loadPdfOptions(): PdfExportOptions {
  try {
    const raw = localStorage.getItem(PDF_OPTIONS_STORAGE_KEY)
    return raw ? normalizePdfOptions(JSON.parse(raw)) : DEFAULT_PDF_OPTIONS
  } catch {
    return DEFAULT_PDF_OPTIONS
  }
}

export function savePdfOptions(opts: PdfExportOptions): void {
  try {
    if (opts.remember) localStorage.setItem(PDF_OPTIONS_STORAGE_KEY, JSON.stringify(opts))
    else localStorage.removeItem(PDF_OPTIONS_STORAGE_KEY)
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 该选项下要覆盖的 CSS 变量（只含显式自定义项） */
export function cssVarsOf(opts: PdfExportOptions): Record<string, string> {
  const vars: Record<string, string> = {}
  if (opts.background !== 'theme') vars['--background'] = opts.background
  if (opts.foreground !== 'theme') vars['--foreground'] = opts.foreground
  if (opts.accent !== 'theme') vars['--ke-pdf-accent'] = opts.accent
  return vars
}

/**
 * 导出用覆盖样式内容：`@media print{ html,body{ --background:…; --foreground:… } }`。
 * 主题选择通过 `data-theme` 属性表达（浅/深），"跟随当前" 不写属性。
 */
export function buildPrintOverrideCss(opts: PdfExportOptions): string {
  const vars = cssVarsOf(opts)
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join(' ')
  const themeRule =
    opts.theme === 'light' || opts.theme === 'dark' ? `html { color-scheme: ${opts.theme}; }` : ''
  // 自定义文字色必须写成真实 `color` 声明：编辑器正文自身有更高的优先级，仅改变量不生效
  const fgRule =
    opts.foreground !== 'theme' ? `.ke-editor-prose, .ke-editor-prose * { color: ${opts.foreground} !important; }` : ''
  // 强调色：标题 / 链接 / 引用条（仅在自定义时生效；默认不改变任何颜色）
  const accent = opts.accent !== 'theme' ? opts.accent : ''
  const accentRule = accent
    ? `.ke-editor-prose :is(h1,h2,h3,h4,h5,h6), .ke-editor-prose a { color: ${accent} !important; }` +
      ` .ke-editor-prose blockquote { border-left-color: ${accent} !important; }`
    : ''
  if (!body && !themeRule && !fgRule && !accentRule) return ''
  return `@media print { ${themeRule} html, body { ${body} } ${fgRule} ${accentRule} }`
}

/** 写入/移除导出覆盖样式（幂等；导出结束必须移除） */
export function applyPrintOverrides(css: string): () => void {
  if (typeof document === 'undefined') return () => undefined
  document.getElementById(PRINT_OVERRIDES_STYLE_ID)?.remove()
  if (!css) return () => undefined
  const el = document.createElement('style')
  el.id = PRINT_OVERRIDES_STYLE_ID
  el.textContent = css
  document.head.appendChild(el)
  return () => document.getElementById(PRINT_OVERRIDES_STYLE_ID)?.remove()
}

/**
 * 导出执行器：**写 overrides → 执行导出 → 无论成功/失败立即移除**。
 * 产品路径（EditorArea::runPdfExport）直接调用本函数，保证「不留副作用」这条是被测单元。
 */
export async function exportPdfWithOverrides(
  opts: PdfExportOptions,
  run: () => Promise<void> | void,
): Promise<void> {
  const remove = applyPrintOverrides(buildPrintOverrideCss(opts))
  try {
    await run()
  } finally {
    remove()
  }
}

export interface ExportPdfDialogProps {
  open: boolean
  onClose: () => void
  /** 只读快照来源（**只调 getHTML()**，绝不 getMarkdown()/setContent） */
  editor: Editor | null
  /** 主题变量解析器：'跟随当前' 时用当前有效值（由宿主传入计算好的值） */
  themeVars: { background: string; foreground: string }
  /** 编辑器正文**实际**文字色（默认文字色基线；不得用 --foreground 代替） */
  editorTextColor: string
  /** 深色/浅色主题下的有效变量（用于预览切换） */
  themeVarsByChoice: { light: { background: string; foreground: string }; dark: { background: string; foreground: string } }
  /** 执行导出（宿主负责：写 overrides → invoke/window.print → 移除 overrides） */
  onExport: (opts: PdfExportOptions) => void | Promise<void>
}

export default function ExportPdfDialog({
  open,
  onClose,
  editor,
  themeVars,
  editorTextColor,
  themeVarsByChoice,
  onExport,
}: ExportPdfDialogProps) {
  const [opts, setOpts] = useState<PdfExportOptions>(() => loadPdfOptions())
  const [busy, setBusy] = useState(false)

  // 每次打开重新读取（含记忆开关关闭后的重置）
  useEffect(() => {
    if (open) setOpts(loadPdfOptions())
  }, [open])

  const update = useCallback((patch: Partial<PdfExportOptions>) => {
    setOpts((prev) => normalizePdfOptions({ ...prev, ...patch }))
  }, [])

  /** 预览只读快照：内容在打开时取一次（预览期间正文不会变，且绝不改动真实节点） */
  const previewHtml = useMemo(() => (open && editor ? editor.getHTML() : ''), [open, editor])

  const previewVars = useMemo(() => {
    const base =
      opts.theme === 'light' ? themeVarsByChoice.light : opts.theme === 'dark' ? themeVarsByChoice.dark : themeVars
    const vars: Record<string, string> = { ...base, ...cssVarsOf(opts) }
    return vars as Record<string, string>
  }, [opts, themeVars, themeVarsByChoice])

  const handleExport = useCallback(async () => {
    savePdfOptions(opts)
    setBusy(true)
    try {
      await onExport(opts)
    } finally {
      setBusy(false)
    }
  }, [opts, onExport])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="export-pdf-dialog">
      <div className="flex max-h-[86vh] w-[900px] max-w-[94vw] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        {/* 左：选项 */}
        <div className="ke-scroll flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-4">
          <h3 className="text-[14px] font-semibold text-foreground">导出 PDF</h3>

          <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            主题
            <select
              data-testid="pdf-theme"
              className="rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground"
              value={opts.theme}
              onChange={(e) => update({ theme: e.target.value as PdfThemeChoice })}
            >
              <option value="current">跟随当前主题</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>

          <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            纸张底色
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="pdf-bg"
                  data-testid="pdf-bg-theme"
                  checked={opts.background === 'theme'}
                  onChange={() => update({ background: 'theme' })}
                />
                主题默认
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="pdf-bg"
                  data-testid="pdf-bg-custom"
                  checked={opts.background !== 'theme'}
                  onChange={() => update({ background: opts.background === 'theme' ? '#ffffff' : opts.background })}
                />
                自定义
              </label>
              <input
                type="color"
                aria-label="纸张底色"
                data-testid="pdf-bg-color"
                className="h-6 w-10 rounded border border-border bg-transparent"
                value={opts.background === 'theme' ? previewVars['--background'] : opts.background}
                onChange={(e) => update({ background: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            强调色（标题 / 链接 / 引用条）
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="pdf-accent"
                  data-testid="pdf-accent-theme"
                  checked={opts.accent === 'theme'}
                  onChange={() => update({ accent: 'theme' })}
                />
                主题默认
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="pdf-accent"
                  data-testid="pdf-accent-custom"
                  checked={opts.accent !== 'theme'}
                  onChange={() => update({ accent: opts.accent === 'theme' ? '#2563eb' : opts.accent })}
                />
                自定义
              </label>
              <input
                type="color"
                aria-label="强调色"
                data-testid="pdf-accent-color"
                className="h-6 w-10 rounded border border-border bg-transparent"
                value={opts.accent === 'theme' ? previewVars['--primary'] ?? '#2563eb' : opts.accent}
                onChange={(e) => update({ accent: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            正文文字色
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="pdf-fg"
                  data-testid="pdf-fg-theme"
                  checked={opts.foreground === 'theme'}
                  onChange={() => update({ foreground: 'theme' })}
                />
                主题默认
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="pdf-fg"
                  data-testid="pdf-fg-custom"
                  checked={opts.foreground !== 'theme'}
                  onChange={() => update({ foreground: opts.foreground === 'theme' ? '#111111' : opts.foreground })}
                />
                自定义
              </label>
              <input
                type="color"
                aria-label="正文文字色"
                data-testid="pdf-fg-color"
                className="h-6 w-10 rounded border border-border bg-transparent"
                value={opts.foreground === 'theme' ? previewVars['--foreground'] : opts.foreground}
                onChange={(e) => update({ foreground: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              data-testid="pdf-remember"
              checked={opts.remember}
              onChange={(e) => update({ remember: e.target.checked })}
            />
            记住我的选择
          </label>

          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            预览与导出使用<strong>同一套打印排版</strong>；导出只读当前渲染结果，不修改文档、不触发保存。
          </p>
        </div>

        {/* 右：A4 缩略预览（独立渲染容器，绝不移动真实节点） */}
        <div className="flex min-w-0 flex-1 flex-col bg-muted/40">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>A4 预览（按纸张比例缩放）</span>
            <span className="opacity-70">所见即所得</span>
          </div>
          <div className="ke-scroll flex min-h-0 flex-1 justify-center overflow-auto p-4">
            <div
              data-testid="pdf-preview-page"
              className="ke-print-surface shadow-lg"
              {...(opts.accent !== 'theme' ? { 'data-ke-pdf-accent': '' } : {})}
              style={{
                ...previewVars,
                // 直接落 backgroundColor：`.ke-print-surface` 的 `background: var(--background)`
                // 在预览上下文里会被主题底色抢先（实测预览恒为主题色），显式内联才与导出真正一致
                backgroundColor: previewVars['--background'] ?? 'var(--background)',
                // 文字色：自定义优先，否则用编辑器实际文字色（与 PDF 一致；不强制 --foreground）
                color: opts.foreground !== 'theme' ? opts.foreground : editorTextColor,
                width: '210mm',
                minHeight: '297mm',
                // 用 `zoom` 而非 `transform: scale()`：Chromium 的 zoom 会**按缩放后尺寸重新排版/栅格化**，
                // 文字保持清晰；transform 缩放会让小字号预览发虚（主理人反馈「糊」）。
                zoom: 0.52,
              }}
              inert
            >
              {/* eslint-disable-next-line react/no-danger */}
              <div className="ke-editor-prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
            <button
              type="button"
              data-testid="pdf-cancel"
              className="rounded border border-border px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              data-testid="pdf-export"
              disabled={busy}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
              onClick={() => void handleExport()}
            >
              <Icon name="download" className="size-3.5" />
              {busy ? '导出中…' : '导出 PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
