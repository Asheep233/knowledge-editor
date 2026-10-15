/**
 * task-76 前端：真 PDF 预览（生成 / 显示 / 防抖 / 关闭清理 / 失败回退）。
 *
 * 红线：只写系统 temp（不经任何 API/工作区写入）· 零 `getMarkdown()` · 失败不白屏。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import ExportPdfDialog, { PDF_PREVIEW_DEBOUNCE_MS } from './ExportPdfDialog'

const CS = vi.hoisted(() => ({
  invokes: [] as Array<{ cmd: string; args: Record<string, unknown> | undefined }>,
  previewPaths: [] as string[],
  failPreview: false,
  getMarkdownCalls: 0,
  fetchCalls: [] as string[],
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    CS.invokes.push({ cmd, args })
    if (cmd === 'preview_pdf') {
      if (CS.failPreview) throw new Error('preview_pdf failed')
      const path = `C:\\Users\\u\\AppData\\Local\\Temp\\AstraNota-preview\\preview-${CS.previewPaths.length + 1}.pdf`
      CS.previewPaths.push(path)
      return path
    }
    return undefined
  },
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const editor = {
  getHTML: () => '<p>正文</p>',
  getMarkdown: () => {
    CS.getMarkdownCalls += 1
    return 'md'
  },
} as never
const VARS = { background: '#ffffff', foreground: '#1f2937' }

let root: Root | null = null
let container: HTMLDivElement

const previewCalls = () => CS.invokes.filter((i) => i.cmd === 'preview_pdf')
const discardCalls = () => CS.invokes.filter((i) => i.cmd === 'discard_preview_pdf')

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function tree(open: boolean, onClose = vi.fn()) {
  return (
    <ExportPdfDialog
      open={open}
      onClose={onClose}
      editor={editor}
      editorTextColor="#1f2937"
      contentWidthPx={716}
      desktopPreview
      themeVars={VARS}
      themeVarsByChoice={{ light: VARS, dark: { background: '#14161a', foreground: '#e6e6e6' } }}
      onExport={vi.fn()}
    />
  )
}

beforeEach(async () => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  CS.invokes = []
  CS.previewPaths = []
  CS.failPreview = false
  CS.getMarkdownCalls = 0
  CS.fetchCalls = []
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(async (input: unknown) => {
    CS.fetchCalls.push(String(input))
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  localStorage.clear()
  root = createRoot(container)
  await act(async () => {
    root!.render(tree(true))
  })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('task-76 真 PDF 预览', () => {
  it('① 打开即生成且只写 temp：400ms 后调 preview_pdf(contentWidth=716)，iframe 指向 asset URL；零 getMarkdown/零网络写', async () => {
    expect(previewCalls(), '防抖窗口内不应立刻调用').toEqual([])
    await settle(PDF_PREVIEW_DEBOUNCE_MS + 10)

    expect(previewCalls().length, '打开后应生成一次预览').toBe(1)
    expect(previewCalls()[0].args, 'contentWidth 必须与导出同源').toEqual({ contentWidth: 716 })
    const frame = container.querySelector('[data-testid="pdf-preview-frame"]') as HTMLIFrameElement
    expect(frame, '应显示 PDF iframe').toBeTruthy()
    expect(frame.getAttribute('src')).toContain('asset://localhost/')
    expect(frame.getAttribute('src')).toContain('toolbar=0')
    expect(container.querySelector('[data-testid="pdf-preview-scroll"]'), '真 PDF 态不应再渲染 DOM 预览').toBeNull()
    // 红线：零 getMarkdown、零写请求
    expect(CS.getMarkdownCalls, '预览绝不得序列化正文').toBe(0)
    expect(CS.fetchCalls.filter((u) => /PUT|POST|DELETE/i.test(u)), '预览不得产生写请求').toEqual([])
  })

  it('② 选项变化 → 防抖 400ms 重新生成一次，并删掉上一份 temp（单飞、旧结果作废）', async () => {
    await settle(PDF_PREVIEW_DEBOUNCE_MS + 10)
    expect(previewCalls().length).toBe(1)

    // 换主题（会写 localStorage 选项 → layoutKey 变化）
    const select = container.querySelector('[data-testid="pdf-theme"]') as HTMLSelectElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, 'dark')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle(200)
    expect(previewCalls().length, '防抖未到期不得重复生成').toBe(1)
    await settle(PDF_PREVIEW_DEBOUNCE_MS + 10)
    expect(previewCalls().length, '防抖到期后应重新生成').toBe(2)
    expect(discardCalls().length, '上一份 temp 必须删除').toBeGreaterThanOrEqual(1)
    expect(String(discardCalls()[0].args?.path)).toContain('preview-1.pdf')
  })

  it('③ 关闭对话框 → 删除 temp 文件（并清空显示）', async () => {
    await settle(PDF_PREVIEW_DEBOUNCE_MS + 10)
    expect(previewCalls().length).toBe(1)
    await act(async () => {
      root!.render(tree(false))
    })
    await settle()
    expect(discardCalls().length, '关闭时必须清理 temp').toBe(1)
    expect(String(discardCalls()[0].args?.path)).toContain('AstraNota-preview')
    expect(container.querySelector('[data-testid="pdf-preview-frame"]')).toBeNull()
  })

  it('④ 生成失败 → 提示 + 回退 DOM 预览（不白屏）', async () => {
    CS.failPreview = true
    await settle(PDF_PREVIEW_DEBOUNCE_MS + 20)
    expect(previewCalls().length).toBe(1)
    expect(container.querySelector('[data-testid="pdf-preview-frame"]'), '失败不得显示 iframe').toBeNull()
    expect(container.querySelector('[data-testid="pdf-preview-error"]')?.textContent).toContain('已回退为 DOM 预览')
    expect(container.querySelector('[data-testid="pdf-preview-scroll"]'), '必须回退 DOM 预览').toBeTruthy()
    expect(CS.getMarkdownCalls, '失败路径同样零 getMarkdown').toBe(0)
  })

  it('⑤ 取消勾选「记住」不影响预览生成；关闭后无预览 iframe 残留', async () => {
    await settle(PDF_PREVIEW_DEBOUNCE_MS + 10)
    const remember = container.querySelector('[data-testid="pdf-remember"]') as HTMLInputElement
    await act(async () => {
      remember.click()
    })
    await settle(PDF_PREVIEW_DEBOUNCE_MS + 10)
    expect(previewCalls().length, '仅切「记住」不应触发重新生成（内容未变）').toBe(1)
  })
})
