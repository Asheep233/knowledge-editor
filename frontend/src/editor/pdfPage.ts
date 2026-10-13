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

/**
 * Chromium PDF 后端缺陷（Lead 沙箱 A/B 实测）：KaTeX `.hide-tail` 内 `<svg width="400em"
 * preserveAspectRatio="xMinYMin slice">` 在**屏幕态**被父级 `overflow:hidden` 正常裁剪（渲染宽 51px），
 * 但在 `Page.printToPDF` 与 WebView2 `PrintToPdf` **两条导出路径**里都会把整条 400em 路径画出来
 * （横线宽 5208.3pt ≈ 页宽 8.8 倍；注入 `overflow/clip-path/contain/max-width/width` 五种 CSS 全部无效）。
 *
 * 因此采用**打印窗口期 DOM 替换**（仅装饰性 svg）：
 *  - 把每个 `.katex .hide-tail > svg` 隐藏，并在同一 `.hide-tail` 盒内补一条**宽度 = 盒宽**的
 *    `border-top` 上横线（√ 字形来自 `.sqrt > .root` 文本节点，不受影响）；
 *  - 导出结束（成功/失败/异常）**立即还原**：只回写该 svg 的 `style` 属性（原本没有 style 属性则移除），
 *    并移除插入的线 —— 还原后 DOM 必须**逐字符**与替换前一致。
 *
 * 只碰装饰性 svg 的显示状态：不改文本节点、不改 `data-latex`、不改任何其它属性。
 */
const SQRT_BAR_ATTR = 'data-ke-pdf-sqrt-bar'

export interface SqrtPatchHandle {
  /** 实际替换的尾巴数量 */
  patched: number
  /** 还原（幂等；成功/失败/异常都必须调用） */
  restore: () => void
}

interface SqrtPatchRecord {
  svg: Element
  tail: Element
  bar: Element
  /** 原 style 属性；null = 原本没有 style 属性（还原时必须 removeAttribute，保证 outerHTML 逐字符一致） */
  originalStyle: string | null
}

/** 替换 KaTeX 根号「可延伸上横线」的 svg 尾巴（装饰性）；返回还原句柄 */
export function patchSqrtTails(root: ParentNode | undefined = typeof document !== 'undefined' ? document : undefined): SqrtPatchHandle {
  const records: SqrtPatchRecord[] = []
  const tails = root?.querySelectorAll?.('.katex .hide-tail') ?? []
  tails.forEach((tail) => {
    const svg = tail.querySelector(':scope > svg')
    if (!svg) return
    // 盒宽：优先布局值；无排版环境（测试/隐藏）时退回 100%
    const rect = (tail as HTMLElement).getBoundingClientRect?.()
    const boxWidth = Math.round(rect?.width ?? 0) || (tail as HTMLElement).clientWidth || 0
    const bar = (tail.ownerDocument ?? document).createElement('span')
    bar.setAttribute(SQRT_BAR_ATTR, '')
    bar.setAttribute(
      'style',
      [
        'position:absolute',
        'left:0',
        'top:0',
        `width:${boxWidth > 0 ? `${boxWidth}px` : '100%'}`,
        'height:0',
        'border-top:0.04em solid currentColor',
        'pointer-events:none',
      ].join(';'),
    )
    const originalStyle = svg.getAttribute('style')
    ;(svg as HTMLElement).style.display = 'none'
    tail.appendChild(bar)
    records.push({ svg, tail, bar, originalStyle })
  })

  let done = false
  return {
    patched: records.length,
    restore: () => {
      if (done) return
      done = true
      for (const r of records) {
        r.bar.remove()
        if (r.originalStyle === null) r.svg.removeAttribute('style')
        else r.svg.setAttribute('style', r.originalStyle)
      }
    },
  }
}
