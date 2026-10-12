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
  buildPrintOverrideCss,
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
    const css = buildPrintOverrideCss({ theme: 'dark', background: '#123456', foreground: 'theme', remember: true })
    expect(css).toContain('@media print')
    expect(css).toContain('--background: #123456 !important;')
    expect(css).toContain('color-scheme: dark')
    expect(css).not.toContain('--foreground')
  })

  it('自定义文字色 → 必须写真实 color 声明（仅改变量对编辑器正文不生效）', () => {
    const css = buildPrintOverrideCss({ theme: 'current', background: 'theme', foreground: '#ff0000', remember: true })
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
    const opts = { theme: 'dark' as const, background: '#101010', foreground: 'theme' as const, remember: true }
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
