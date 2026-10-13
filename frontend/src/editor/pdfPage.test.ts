/**
 * task-75 线索 A/B 单测：
 *  - 纸张尺寸函数与 Rust `print.rs` **同源**（同一公式与常量），预览不再硬编码 210mm；
 *  - 导出前等待字体就绪（KaTeX `\sqrt` 的高字形与横线来自 KaTeX_Size1..4）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computePageSize,
  CONTENT_WIDTH_MAX_PX,
  CONTENT_WIDTH_MIN_PX,
  PAGE_HEIGHT_IN,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_FALLBACK_IN,
  pageHeightCss,
  pageWidthCss,
  pageWidthIn,
  PRINT_FONT_SPECS,
  PRINT_PADDING_PX,
  waitForPrintFonts,
} from './pdfPage'

describe('task-75 A：纸张尺寸与 Rust 同源', () => {
  it('页宽公式 = (content + 2×52.9167)/96（与 print.rs 逐字一致）', () => {
    for (const w of [201, 716, 1200, 3999]) {
      expect(pageWidthIn(w), `contentWidth=${w}`).toBeCloseTo((w + PRINT_PADDING_PX * 2) / 96, 12)
    }
    // 主理人实测 716px → ≈8.56in ≈217.4mm（旧预览硬编码 210mm，故分页对不上）
    expect(pageWidthIn(716)).toBeCloseTo(8.5608, 3)
    expect(computePageSize(716).widthMm).toBeCloseTo(217.44, 1)
  })

  it('非法/缺失内容宽 → 退回 A4 宽 8.27in（与 Rust 分支一致）', () => {
    for (const bad of [undefined, null, 0, 199, CONTENT_WIDTH_MIN_PX, CONTENT_WIDTH_MAX_PX, 4001, Number.NaN]) {
      expect(pageWidthIn(bad as number | null | undefined), `bad=${String(bad)}`).toBe(PAGE_WIDTH_FALLBACK_IN)
    }
    expect(pageWidthIn(CONTENT_WIDTH_MIN_PX + 1)).toBeCloseTo((201 + PRINT_PADDING_PX * 2) / 96, 12)
  })

  it('页高恒 11.69in / 297.03mm（与 Rust SetPageHeight(11.69) 一致）', () => {
    const s = computePageSize(716)
    expect(s.heightIn).toBe(PAGE_HEIGHT_IN)
    expect(s.heightMm).toBeCloseTo(PAGE_HEIGHT_MM, 9)
    expect(PAGE_HEIGHT_MM).toBeCloseTo(296.926, 3)
  })

  it('CSS 长度取自同一函数（预览页框/测量容器用），不再硬编码 210mm', () => {
    expect(pageWidthCss(716)).toBe(`${computePageSize(716).widthMm.toFixed(3)}mm`)
    expect(pageWidthCss(716)).not.toBe('210mm')
    expect(pageWidthCss(null)).toBe(`${(PAGE_WIDTH_FALLBACK_IN * 25.4).toFixed(3)}mm`)
    expect(pageHeightCss()).toBe(`${PAGE_HEIGHT_MM.toFixed(3)}mm`)
  })
})

describe('task-75 B：导出前等待字体就绪', () => {
  const original = Object.getOwnPropertyDescriptor(document, 'fonts')

  afterEach(() => {
    if (original) Object.defineProperty(document, 'fonts', original)
    else delete (document as unknown as { fonts?: unknown }).fonts
    vi.restoreAllMocks()
  })

  it('预热 KaTeX 字族并 await fonts.ready（run 必须发生在 ready 之后）', async () => {
    const loaded: string[] = []
    let releaseReady!: () => void
    const ready = new Promise<void>((r) => {
      releaseReady = r
    })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        load: (spec: string) => {
          loaded.push(spec)
          return Promise.resolve()
        },
        ready,
      },
    })
    let runCalled = false
    const p = waitForPrintFonts().then(() => {
      runCalled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(loaded.length, '必须预热 KaTeX 字族（含 Size1..4）').toBe(PRINT_FONT_SPECS.length)
    expect(loaded.some((s) => s.includes('KaTeX_Size1'))).toBe(true)
    expect(runCalled, 'ready 未完成前不得继续').toBe(false)
    releaseReady()
    await p
    expect(runCalled).toBe(true)
  })

  it('字体 API 不可用 / load 抛错 → 不阻塞导出（不抛）', async () => {
    delete (document as unknown as { fonts?: unknown }).fonts
    await expect(waitForPrintFonts()).resolves.toBeUndefined()

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        load: () => Promise.reject(new Error('no font')),
        ready: Promise.reject(new Error('ready failed')),
      },
    })
    await expect(waitForPrintFonts()).resolves.toBeUndefined()
  })
})
