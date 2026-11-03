/**
 * task-75：PDF 纸张尺寸与「导出前就绪」共享模块。
 *
 * **同源约束**：纸张宽度必须与 Rust `desktop/src-tauri/src/print.rs` 用**同一个公式**：
 *   `page_w_in = (content_width + 2 × 52.9167) / 96`（`52.9167px` = 打印内边距 14mm），
 *   仅在 `200 < content_width < 4000` 时生效，否则退回 A4 宽 `8.27in`；页高恒 `11.69in`。
 * 预览页框宽度取自本模块 → 预览与真实 PDF 的**换行/分页位置**才有可比性
 * （此前预览硬编码 `210mm`，与 8.56in ≈ 217.4mm 的内容宽不一致 → 分页必然对不上）。
 */

export const CSS_PX_PER_INCH = 96
export const MM_PER_INCH = 25.4
/** 与 print.rs `PRINT_PADDING_PX` 同源：14mm × 1（单侧） */
export const PRINT_PADDING_PX = 52.9167
export const CONTENT_WIDTH_MIN_PX = 200
export const CONTENT_WIDTH_MAX_PX = 4000
/** 未提供/非法内容宽时的 A4 页宽（in） */
export const PAGE_WIDTH_FALLBACK_IN = 8.27
/** A4 页高（in）；Rust 侧同为 11.69 */
export const PAGE_HEIGHT_IN = 11.69
export const PAGE_HEIGHT_MM = PAGE_HEIGHT_IN * MM_PER_INCH

export interface PdfPageSize {
  /** 采纳的内容宽（px）；非法/缺失时为 null（已退回 A4） */
  contentWidthPx: number | null
  widthIn: number
  widthMm: number
  heightIn: number
  heightMm: number
}

export function contentWidthIsValid(w: unknown): w is number {
  return typeof w === 'number' && Number.isFinite(w) && w > CONTENT_WIDTH_MIN_PX && w < CONTENT_WIDTH_MAX_PX
}

/** 页宽（in）：与 Rust 同公式；非法内容宽 → A4 宽 */
export function pageWidthIn(contentWidthPx: number | null | undefined): number {
  return contentWidthIsValid(contentWidthPx)
    ? (contentWidthPx + PRINT_PADDING_PX * 2) / CSS_PX_PER_INCH
    : PAGE_WIDTH_FALLBACK_IN
}

/** 预览/导出共用的纸张尺寸（mm 供 CSS，in 供 Rust 参数核对） */
export function computePageSize(contentWidthPx: number | null | undefined): PdfPageSize {
  const widthIn = pageWidthIn(contentWidthPx)
  return {
    contentWidthPx: contentWidthIsValid(contentWidthPx) ? contentWidthPx : null,
    widthIn,
    widthMm: widthIn * MM_PER_INCH,
    heightIn: PAGE_HEIGHT_IN,
    heightMm: PAGE_HEIGHT_MM,
  }
}

/** CSS 长度（预览页框/测量容器用） */
export function pageWidthCss(contentWidthPx: number | null | undefined): string {
  return `${computePageSize(contentWidthPx).widthMm.toFixed(3)}mm`
}

export function pageHeightCss(): string {
  return `${PAGE_HEIGHT_MM.toFixed(3)}mm`
}

/** 页高（px，96dpi）—— 预览分页测量用 */
export const PAGE_HEIGHT_PX = PAGE_HEIGHT_IN * CSS_PX_PER_INCH

/**
 * 2026-11-03：PDF 上下页边距（mm）。与 `print.css` 的 `@page { margin: 16mm 0 }` 同源；
 * 实际可用内容高 = 页高 - 2×该值，DOM 回退预览的页数/分页位移必须用它。
 */
export const PDF_PAGE_MARGIN_MM = 16
/** 去掉上下页边距后的内容高（mm） */
export const PAGE_CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - PDF_PAGE_MARGIN_MM * 2
/** 去掉上下页边距后的内容高（px，96dpi）—— DOM 回退预览分页测量用 */
export const PAGE_CONTENT_HEIGHT_PX = (PAGE_CONTENT_HEIGHT_MM * CSS_PX_PER_INCH) / MM_PER_INCH

/** KaTeX 高字形（\sqrt 等）依赖的字族；字体未就绪时打印会退化成「一条长横线」 */
export const PRINT_FONT_SPECS = [
  '1em KaTeX_Main',
  '1em KaTeX_Size1',
  '1em KaTeX_Size2',
  '1em KaTeX_Size3',
  '1em KaTeX_Size4',
  '1em KaTeX_AMS',
] as const

/**
 * 导出前等待字体就绪（task-75 线索 B）：
 *  ① 预热 KaTeX 字族（`\sqrt` 的横线与高字形来自 Size1..4）；
 *  ② `await document.fonts.ready`；
 *  ③ 字体 API 不可用/加载失败**不阻塞**导出（返回而非抛错）。
 */
export async function waitForPrintFonts(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): Promise<void> {
  const fonts = (doc as unknown as { fonts?: { load?: (spec: string) => Promise<unknown>; ready?: Promise<unknown> } } | undefined)
    ?.fonts
  if (!fonts) return
  try {
    if (typeof fonts.load === 'function') {
      await Promise.allSettled(PRINT_FONT_SPECS.map((spec) => fonts.load!(spec)))
    }
    await fonts.ready
  } catch {
    /* 字体 API 异常不影响导出 */
  }
}

// ---------------------------------------------------------------------------
// task-75 B（订正 · 真机 A/B 证伪 CSS 路线后的 fallback）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2026-11-02（pre.8 真机复测 FAIL 处置 R1-D2）：预览与导出共享「资源就绪守卫」
//
// 复测现象：新 WebView profile 首次冷启动时，长文**真预览 431 页 / 正式导出 434 页**
// （MediaBox/内容宽/主题/DPR 均相同，规范化全文不同），冷会话可复现。
// 静态强候选：正式导出路径有 `waitForPrintFonts()`，而真预览路径应用样式后**立即** invoke
// `preview_pdf` —— 首次打印时 KaTeX 字族（Size1..4 等）尚未加载/解码，分页与最终导出一致性失守。
// 修复：两条路径共用本守卫（字体 + 图片解码 + 2 帧布局稳定）后再向原生发打印请求；
// 守卫**有界**（默认 8s，超时只告警不阻塞），失败不改变产品语义。
// ---------------------------------------------------------------------------

export const DEFAULT_PRINT_READINESS_TIMEOUT_MS = 8000

export interface PrintReadinessResult {
  ok: boolean
  timedOut: boolean
  fontsReady: boolean
  totalImages: number
  pendingImages: number
  waitedMs: number
}

/** 收集尚未完成加载的 `<img>`（无 src / 已 complete 的不算 pending）。 */
export function collectPendingPrintImages(root: ParentNode | null | undefined): HTMLImageElement[] {
  if (!root || typeof (root as ParentNode).querySelectorAll !== 'function') return []
  const nodes = Array.from((root as ParentNode).querySelectorAll('img'))
  return nodes.filter((node) => {
    const img = node as HTMLImageElement
    if (!img || typeof img !== 'object') return false
    if (!(img as { src?: string }).src) return false
    // complete=false → 仍在加载；complete=true 视为已结束（broken 图 naturalWidth=0 也不阻塞）
    return (img as { complete?: boolean }).complete === false
  }) as HTMLImageElement[]
}

/** 等待图片加载（有界）。返回 { ok, total, pending, timedOut }；不抛错。 */
export async function waitForPrintImages(
  root: ParentNode | null | undefined,
  timeoutMs: number = DEFAULT_PRINT_READINESS_TIMEOUT_MS,
): Promise<{ ok: boolean; total: number; pending: number; timedOut: boolean }> {
  const pending = collectPendingPrintImages(root)
  const total = pending.length
  if (total === 0) return { ok: true, total: 0, pending: 0, timedOut: false }
  const waits = pending.map(
    (img) =>
      new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          img.removeEventListener('load', finish)
          img.removeEventListener('error', finish)
          resolve()
        }
        img.addEventListener('load', finish, { once: true })
        img.addEventListener('error', finish, { once: true })
        try {
          // lazy 图片在后台/隐藏容器里可能永不触发加载：强制 eager 触发加载
          img.loading = 'eager'
        } catch {
          /* ignore */
        }
        // 已在本轮监听前完成（竞态兜底）
        if (img.complete) finish()
      }),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), Math.max(0, timeoutMs))
  })
  const timedOut = await Promise.race([Promise.allSettled(waits).then(() => false), timeout])
  if (timer) clearTimeout(timer)
  const stillPending = collectPendingPrintImages(root).length
  return { ok: !timedOut && stillPending === 0, total, pending: stillPending, timedOut }
}

/**
 * 打印资源就绪守卫（预览与正式导出共用）：
 * ① `waitForPrintFonts`（KaTeX 字族 + fonts.ready）；② 正文内未完成图片。
 * 打印引擎（WebView2 PrintToPdf）会自行重新布局，因此不再额外等 rAF 帧
 * （也避免测试环境/后台标签页 rAF 不触发时阻塞调用方）。
 * 全程有界（默认 8s）；字体 API 缺失/失败不阻塞，超时返回 ok=false 仅用于诊断告警。
 */
export async function waitForPrintReadiness(opts?: {
  doc?: Document | undefined
  root?: ParentNode | null
  timeoutMs?: number
}): Promise<PrintReadinessResult> {
  const doc = opts?.doc ?? (typeof document !== 'undefined' ? document : undefined)
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_PRINT_READINESS_TIMEOUT_MS
  const started = Date.now()
  const root = opts?.root ?? doc?.querySelector?.('.ke-editor-prose') ?? null

  let fontsReady = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, timeoutMs))
  })
  try {
    const fontsTask = waitForPrintFonts(doc).then(() => 'fonts' as const)
    const first = await Promise.race([fontsTask, timeoutPromise])
    fontsReady = first === 'fonts'
  } catch {
    fontsReady = false
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (fontsReady) {
    const remaining = Math.max(500, timeoutMs - (Date.now() - started))
    const images = await waitForPrintImages(root, remaining)
    const ok = images.ok
    return {
      ok,
      timedOut: images.timedOut,
      fontsReady: true,
      totalImages: images.total,
      pendingImages: images.pending,
      waitedMs: Date.now() - started,
    }
  }
  // 字体超时：仍尽量等图片（极短余量），返回诊断结果
  const images = await waitForPrintImages(root, Math.min(1000, timeoutMs))
  return {
    ok: false,
    timedOut: true,
    fontsReady: false,
    totalImages: images.total,
    pendingImages: images.pending,
    waitedMs: Date.now() - started,
  }
}

