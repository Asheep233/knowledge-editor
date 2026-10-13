/**
 * task-72 验收用例：① 选项→覆盖样式 ② 预览/打印规则逐条一致 ③ 导出后 overrides 已移除（含失败路径）
 * ④ localStorage 记忆与恢复 ⑤ 取消零写盘。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import ExportPdfDialog, {
  A4_PAGE_HEIGHT_PX,
  buildPrintOverrideCss,
  computePageCount,
  exportPdfWithOverrides,
  loadPdfOptions,
  normalizePdfOptions,
  PDF_OPTIONS_STORAGE_KEY,
  PRINT_OVERRIDES_STYLE_ID,
  savePdfOptions,
  DEFAULT_PDF_OPTIONS,
} from './ExportPdfDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fakeEditor = { getHTML: () => '<p>正文</p>' } as never
const VARS = { background: '#ffffff', foreground: '#1f2937' }

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  localStorage.clear()
  document.getElementById(PRINT_OVERRIDES_STYLE_ID)?.remove()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  document.getElementById(PRINT_OVERRIDES_STYLE_ID)?.remove()
  vi.restoreAllMocks()
})

async function renderDialog(onExport = vi.fn()): Promise<{ onClose: ReturnType<typeof vi.fn> }> {
  const onClose = vi.fn()
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <ExportPdfDialog
        open
        onClose={onClose}
        editor={fakeEditor}
        editorTextColor="#1f2937"
        themeVars={VARS}
        themeVarsByChoice={{ light: VARS, dark: { background: '#14161a', foreground: '#e6e6e6' } }}
        onExport={onExport}
      />,
    )
  })
  return { onClose }
}

function fire(el: Element | null, type: 'click' | 'change' | 'input' = 'click'): void {
  if (!el) throw new Error('元素不存在')
  act(() => {
    el.dispatchEvent(new Event(type, { bubbles: true }))
  })
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('task-72 ① 选项 → 覆盖样式内容', () => {
  it('默认（主题/底色主题/文字主题）→ 不产生任何覆盖样式', () => {
    expect(buildPrintOverrideCss(DEFAULT_PDF_OPTIONS)).toBe('')
  })

  it('深色主题 + 自定义底色 → @media print 内覆盖 --background 与 color-scheme', () => {
    const css = buildPrintOverrideCss({  theme: 'dark', background: '#123456', foreground: 'theme', remember: true , accent: 'theme' })
    // 自定义强调色 → 生成标题/链接/引用条三类规则，且变量写入
    const cssAccent = buildPrintOverrideCss({
      theme: 'current', background: 'theme', foreground: 'theme', accent: '#ff00aa', remember: true,
    })
    expect(cssAccent).toContain('--ke-pdf-accent: #ff00aa')
    expect(cssAccent).toContain(':is(h1,h2,h3,h4,h5,h6)')
    expect(cssAccent).toContain('.ke-editor-prose a')
    expect(cssAccent).toContain('blockquote { border-left-color: #ff00aa !important; }')
    // 强调色未自定义时，不得出现任何强调色规则（默认零影响）
    expect(css).not.toContain('--ke-pdf-accent')
    expect(css).not.toContain('border-left-color')
    expect(css).toContain('@media print')
    expect(css).toContain('--background: #123456 !important;')
    expect(css).toContain('color-scheme: dark')
    expect(css).not.toContain('--foreground')
  })

  it('自定义文字色 → 必须写真实 color 声明（仅改变量对编辑器正文不生效）', () => {
    const css = buildPrintOverrideCss({  theme: 'current', background: 'theme', foreground: '#ff0000', remember: true , accent: 'theme' })
    expect(css).toContain('.ke-editor-prose')
    expect(css).toContain('color: #ff0000 !important')
  })

  it('非法色值被拒绝（不注入任意字符串到 <style>）', () => {
    expect(normalizePdfOptions({ background: 'red; } body { display:none' }).background).toBe('theme')
    expect(normalizePdfOptions({ background: '#abcd' }).background).toBe('theme')
    expect(normalizePdfOptions({ background: '#abc' }).background).toBe('#abc')
  })
})

describe('task-72 ② 预览与打印规则逐条一致（防「预览好看、导出不一样」）', () => {
  it('print.css 的 @ke-print-shared 与 @ke-print-preview 两段声明逐条相同', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/print.css'), 'utf8')
    const pick = (start: string, end: string): string[] => {
      const i = css.indexOf(start)
      const j = css.indexOf(end)
      expect(i >= 0 && j > i, `缺少标记块 ${start}`).toBe(true)
      const block = css.slice(i + start.length, j).replace(/\/\*[\s\S]*?\*\//g, '')
      // 只取声明体（{...} 内部），归一化空白 —— 选择器可不同（预览多一层作用域）
      return Array.from(block.matchAll(/\{([^{}]*)\}/g)).map((m) =>
        m[1]
          .split(';')
          .map((d) => d.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join('; '),
      )
    }
    const shared = pick('@ke-print-shared:start', '@ke-print-shared:end')
    const preview = pick('@ke-print-preview:start', '@ke-print-preview:end')
    expect(shared.length, '共享段为空').toBeGreaterThan(3)
    expect(preview, '预览块与打印块的声明不一致（逐条比对）').toEqual(shared)
  })
})

describe('task-72 ③ 导出后 overrides 必须移除（含失败路径）', () => {
  it('成功路径：执行期间存在、结束后移除', async () => {
    let seen: string | null = null
    await exportPdfWithOverrides({ ...DEFAULT_PDF_OPTIONS, background: '#123456' }, () => {
      seen = document.getElementById(PRINT_OVERRIDES_STYLE_ID)?.textContent ?? null
    })
    expect(seen, '导出期间必须有覆盖样式').toContain('--background: #123456')
    expect(document.getElementById(PRINT_OVERRIDES_STYLE_ID), '导出后必须移除').toBeNull()
  })

  it('失败路径：抛错也必须移除', async () => {
    await expect(
      exportPdfWithOverrides({ ...DEFAULT_PDF_OPTIONS, foreground: '#ff0000' }, () => {
        throw new Error('invoke failed')
      }),
    ).rejects.toThrow('invoke failed')
    expect(document.getElementById(PRINT_OVERRIDES_STYLE_ID), '失败后必须移除').toBeNull()
  })

  it('默认选项（无覆盖）不写样式元素', async () => {
    await exportPdfWithOverrides(DEFAULT_PDF_OPTIONS, () => undefined)
    expect(document.getElementById(PRINT_OVERRIDES_STYLE_ID)).toBeNull()
  })
})

describe('task-72 ④ localStorage 记忆与恢复', () => {
  it('记住开启 → 往返一致；关闭 → 清除记忆', () => {
    const opts = { theme: 'dark' as const, background: '#101010', foreground: 'theme' as const, accent: 'theme' as const, remember: true }
    savePdfOptions(opts)
    expect(loadPdfOptions()).toEqual(opts)
    savePdfOptions({ ...opts, remember: false })
    expect(localStorage.getItem(PDF_OPTIONS_STORAGE_KEY)).toBeNull()
    expect(loadPdfOptions()).toEqual(DEFAULT_PDF_OPTIONS)
  })

  it('对话框改动选项后导出 → 写入记忆（下次打开恢复）', async () => {
    const onExport = vi.fn()
    await renderDialog(onExport)
    setValue(container.querySelector('[data-testid="pdf-theme"]') as HTMLSelectElement, 'dark')
    fire(container.querySelector('[data-testid="pdf-bg-color"]') as HTMLInputElement, 'change')
    await act(async () => {
      ;(container.querySelector('[data-testid="pdf-export"]') as HTMLButtonElement).click()
    })
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(loadPdfOptions().theme).toBe('dark')
  })
})

describe('task-72 ⑤ 取消零写盘', () => {
  it('点取消：只关对话框，不导出、不写覆盖样式、不写存储', async () => {
    const onExport = vi.fn()
    const { onClose } = await renderDialog(onExport)
    fire(container.querySelector('[data-testid="pdf-cancel"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onExport).not.toHaveBeenCalled()
    expect(document.getElementById(PRINT_OVERRIDES_STYLE_ID)).toBeNull()
    expect(localStorage.getItem(PDF_OPTIONS_STORAGE_KEY)).toBeNull()
  })
})

describe('task-73 预览分页 / 滚动 / 只读', () => {
  it('① 页数 = ceil(内容总高/页高)（纯函数）', () => {
    expect(computePageCount(0)).toBe(1)
    expect(computePageCount(A4_PAGE_HEIGHT_PX * 0.2)).toBe(1)
    expect(computePageCount(A4_PAGE_HEIGHT_PX)).toBe(1)
    expect(computePageCount(A4_PAGE_HEIGHT_PX * 1.01)).toBe(2)
    expect(computePageCount(A4_PAGE_HEIGHT_PX * 3.4)).toBe(4)
    expect(computePageCount(Number.NaN)).toBe(1)
  })

  it('① 长文档 → 预览渲染出多张 A4 页（每页 overflow:hidden，页内位移递增）', async () => {
    await renderDialog()
    const measure = container.querySelector('[data-testid="pdf-measure"]') as HTMLElement
    // happy-dom 无排版：直接给定实测总高（3.4 页）→ 切选项触发重新测量
    Object.defineProperty(measure, 'scrollHeight', { value: A4_PAGE_HEIGHT_PX * 3.4, configurable: true })
    setValue(container.querySelector('[data-testid="pdf-theme"]') as HTMLSelectElement, 'dark')

    const pages = container.querySelectorAll('[data-testid="pdf-preview-page"]')
    expect(pages.length, '长文档必须分页').toBe(4)
    expect(container.querySelector('[data-testid="pdf-page-label-0"]')?.textContent).toContain('第 1 / 4 页')
    expect(container.querySelector('[data-testid="pdf-page-label-3"]')?.textContent).toContain('第 4 / 4 页')
    // 页内位移：第 i 页 translateY(-i × 页高 mm)
    const shifted = (pages[2] as HTMLElement).querySelector('div[style*="translateY"]') as HTMLElement
    expect(shifted.style.transform).toBe('translateY(-594mm)')
    for (const page of Array.from(pages)) {
      expect((page as HTMLElement).style.overflow).toBe('hidden')
    }
  })

  it('② 打开/切换选项后预览滚动位置归零', async () => {
    await renderDialog()
    const scroll = container.querySelector('[data-testid="pdf-preview-scroll"]') as HTMLElement
    scroll.scrollTop = 500
    setValue(container.querySelector('[data-testid="pdf-theme"]') as HTMLSelectElement, 'dark')
    expect(scroll.scrollTop, '切换选项后必须回到顶部').toBe(0)
    scroll.scrollTop = 300
    // 换纸张底色（color input 的 change 一定触发选项更新）
    setValue(container.querySelector('[data-testid="pdf-bg-color"]') as HTMLInputElement, '#112233')
    expect(scroll.scrollTop, '切换颜色后也必须回到顶部').toBe(0)
  })

  it('③④ 预览含 KaTeX（克隆实时 DOM）且不改动真实编辑器节点', async () => {
    // 造一个「真实编辑器」节点（含 KaTeX 与 contenteditable）
    const src = document.createElement('div')
    src.className = 'ke-editor-prose'
    src.innerHTML =
      '<p>正文<span class="katex"><span class="katex-html">x</span></span></p><p contenteditable="true">可编辑</p><button>工具栏按钮</button>'
    document.body.appendChild(src)
    const before = src.outerHTML

    try {
      await renderDialog()
      expect(container.querySelectorAll('.katex').length, '预览必须保留 KaTeX 渲染（.katex > 0）').toBeGreaterThan(0)
      expect(container.querySelectorAll('[contenteditable="false"]').length, '克隆体应只读').toBeGreaterThan(0)
      expect(container.querySelectorAll('.ke-editor-prose button').length, '交互按钮不该进预览').toBe(0)
      expect(src.outerHTML, '预览绝不得改动真实编辑器 DOM').toBe(before)
    } finally {
      src.remove()
    }
  })
})

describe('task-73 追加：首屏即正确 / 深色残留清零 / 关闭无残留', () => {
  it('① 首屏即正确（不做任何切换）：打开哪一刻就按真实内容高分页', async () => {
    // 模拟「布局已稳定」：在渲染前给定测量高度（2.2 页 → 3 页）
    const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset?.testid === 'pdf-measure' ? A4_PAGE_HEIGHT_PX * 2.2 : 0
      },
    })
    try {
      await renderDialog()
      expect(
        container.querySelectorAll('[data-testid="pdf-preview-page"]').length,
        '首屏（未切换任何选项）就必须是多页，而不是靠切换主题复位',
      ).toBe(3)
      expect(container.querySelector('[data-testid="pdf-page-label-2"]')?.textContent).toContain('第 3 / 3 页')
    } finally {
      if (proto) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', proto)
    }
  })

  it('② 浅色首屏：预览整体浅色、无任何深色残留', async () => {
    localStorage.setItem(
      PDF_OPTIONS_STORAGE_KEY,
      JSON.stringify({ theme: 'light', background: 'theme', foreground: 'theme', accent: 'theme', remember: true }),
    )
    await renderDialog()
    const page = container.querySelector('[data-testid="pdf-preview-page"]') as HTMLElement
    expect(page, '未渲染预览页').toBeTruthy()
    expect(page.style.backgroundColor, '浅色首屏底色必须是浅色令牌').toBe(VARS.background)
    expect(page.style.backgroundColor).not.toBe('#14161a')
    // 预览树里不得出现深色值（残留覆盖层的最小可测形式）
    const html = container.innerHTML
    expect(html, '预览树里出现深色底色残留').not.toContain('#14161a')
    expect(document.getElementById(PRINT_OVERRIDES_STYLE_ID), '首屏不得有导出覆盖样式').toBeNull()
  })

  it('③ 切换主题时旧预览面必须**卸载**（钉死「旧面未卸载」路径）', async () => {
    await renderDialog()
    const oldPage = container.querySelector('[data-testid="pdf-preview-page"]') as HTMLElement
    expect(oldPage.isConnected).toBe(true)
    setValue(container.querySelector('[data-testid="pdf-theme"]') as HTMLSelectElement, 'dark')
    expect(oldPage.isConnected, '切换主题后旧预览面必须已卸载（key 重挂）').toBe(false)
    const fresh = container.querySelector('[data-testid="pdf-preview-page"]') as HTMLElement
    expect(fresh).toBeTruthy()
    expect(fresh.isConnected).toBe(true)
  })

  it('④ 关闭对话框后无残留：对话框/预览/覆盖样式全部移除，真实编辑器未被改动', async () => {
    const src = document.createElement('div')
    src.className = 'ke-editor-prose'
    src.innerHTML = '<p>正文</p>'
    document.body.appendChild(src)
    const before = src.outerHTML
    try {
      const onClose = vi.fn()
      root = createRoot(container)
      const tree = (open: boolean) => (
        <ExportPdfDialog
          open={open}
          onClose={onClose}
          editor={fakeEditor}
          editorTextColor="#1f2937"
          themeVars={VARS}
          themeVarsByChoice={{ light: VARS, dark: { background: '#14161a', foreground: '#e6e6e6' } }}
          onExport={vi.fn()}
        />
      )
      await act(async () => {
        root!.render(tree(true))
      })
      expect(container.querySelector('[data-testid="export-pdf-dialog"]')).toBeTruthy()
      await act(async () => {
        root!.render(tree(false))
      })
      expect(container.querySelector('[data-testid="export-pdf-dialog"]'), '对话框必须卸载').toBeNull()
      expect(container.querySelectorAll('[data-ke-pdf-preview]').length, '预览面必须移除').toBe(0)
      expect(document.getElementById(PRINT_OVERRIDES_STYLE_ID), '不得残留覆盖样式').toBeNull()
      expect(src.outerHTML, '真实编辑器 DOM 未被改动').toBe(before)
    } finally {
      src.remove()
    }
  })
})
