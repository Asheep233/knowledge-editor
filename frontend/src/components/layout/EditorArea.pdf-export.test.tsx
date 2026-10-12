/**
 * task-70 ❶：导出 PDF 入口（只读 DOM 的打印路径）回归。
 *
 * 红线（主理人要求）：
 *  - 导出路径**不得**触碰保存链：零 PUT / 零写盘请求、零 `getMarkdown()` 调用、零 flush；
 *  - 源码模式不参与导出（提示后不打印）；
 *  - 打印隐藏外壳依赖 `print.css` 的**真实**选择器（`[data-ke-toolbar]` 等），
 *    原稿按命名推断的 `.ke-toolbar` / `.ke-sidebar` / `.ke-status-bar` 在真实 DOM 中不存在。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import type { ArticleMeta } from '../../types'

const CS = vi.hoisted(() => ({
  md: '',
  getMarkdownCalls: 0,
  requests: [] as Array<{ method: string; url: string }>,
  alerts: [] as string[],
  printCalls: 0,
  autosaveMs: 1,
}))

// 浏览器态：isDesktop()=false → 走 window.print() 兜底（桌面静默导出路径见文件末尾的用例）
vi.mock('../../desktop', () => ({
  isDesktop: () => false,
  onCloseRequested: () => () => {},
  flushPendingAll: async () => undefined,
  installDesktopFlush: () => () => {},
}))
vi.mock('@tiptap/react', () => ({
  EditorContext: { Provider: (props: { children?: unknown }) => props.children },
  EditorContent: () => null,
}))
vi.mock('../../editor', () => ({
  useKeEditor: (opts: { onUpdate?: () => void }) => {
    void opts
    return {
      getMarkdown: () => {
        CS.getMarkdownCalls += 1
        return CS.md
      },
      setEditable: () => undefined,
      get isEditable() {
        return true
      },
      isFocused: false,
      schema: {},
      commands: { focus: () => undefined, setContent: () => undefined, command: () => undefined },
      chain: () => {
        const c = { focus: () => c, insertContent: () => c, run: () => true }
        return c
      },
    }
  },
  setKeContent: (_ed: unknown, md: string) => {
    CS.md = md
  },
}))
vi.mock('../../settings', () => ({ getAutosaveIntervalMs: () => CS.autosaveMs }))
vi.mock('../editor/EditorToolbar', () => ({
  // 导出按钮由 EditorArea 构造并作为 prop 传入 —— mock 必须把它渲染出来
  default: (props: { exportButton?: unknown }) => <div data-testid="toolbar-mock">{props.exportButton as never}</div>,
  stripModuleTitle: (s: string) => s,
}))
vi.mock('../editor/TableBubbleMenu', () => ({ default: () => null }))
vi.mock('../editor/MathEditorModal', () => ({ default: () => null }))
vi.mock('../editor/nodeviews/MathNodeView', () => ({ MATH_EDIT_EVENT: 'ke:math-edit' }))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: async () => true,
  askPrompt: async () => null,
  PromptRoot: (props: { children?: unknown }) => props.children,
  PromptHost: () => null,
  usePrompt: () => async () => null,
}))

const EditorArea = (await import('./EditorArea')).default
const { __resetViewModeForTest } = await import('../../state/viewMode')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement

const article = (content: string): ArticleMeta => ({
  id: 'Articles/a.md',
  path: 'Articles/a.md',
  title: 'a',
  content,
  tags: [],
  word_count: 1,
  updated_at: '2026-01-01T00:00:00Z',
})

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render(content = '---\nke_version: 1\n---\n\n正文\n'): Promise<void> {
  CS.md = content
  root = createRoot(container)
  await act(async () => {
    root!.render(<EditorArea article={article(content)} loading={false} onNewArticle={() => undefined} onSaved={() => undefined} />)
  })
  await settle()
}

function byText(text: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  )
  if (!el) throw new Error(`未找到按钮：${text}`)
  return el
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  CS.getMarkdownCalls = 0
  CS.requests = []
  CS.alerts = []
  CS.printCalls = 0
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    CS.requests.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input) })
    return { ok: true, status: 200, statusText: '200', json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  ;(window as unknown as { alert: (m?: unknown) => void }).alert = (m?: unknown) => CS.alerts.push(String(m ?? ''))
  ;(window as unknown as { print: () => void }).print = () => {
    CS.printCalls += 1
  }
  localStorage.clear()
  __resetViewModeForTest('wysiwyg')
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

describe('task-70 ❶ 导出 PDF 入口（只读 DOM）', () => {
  it('下拉里有「导出 PDF」项；点击只调 window.print，零写盘请求、零 getMarkdown', async () => {
    await render()
    await act(async () => {
      byText('导出').click()
    })
    await settle()
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes('导出 PDF'),
    )
    expect(item, '导出下拉缺少「导出 PDF」入口').toBeTruthy()

    const mdBefore = CS.getMarkdownCalls
    const writesBefore = CS.requests.filter((r) => r.method !== 'GET').length
    await act(async () => {
      item!.click()
    })
    await settle()

    expect(CS.printCalls, '必须调用 window.print()').toBe(1)
    expect(CS.getMarkdownCalls, '导出 PDF 不得序列化正文（不碰 PM）').toBe(mdBefore)
    expect(
      CS.requests.filter((r) => r.method !== 'GET').length,
      `导出 PDF 不得产生写盘请求：${JSON.stringify(CS.requests)}`,
    ).toBe(writesBefore)
  })

  it('源码模式：不打印，只提示（源码不参与 PDF 导出）', async () => {
    __resetViewModeForTest('source')
    await render()
    await act(async () => {
      byText('导出').click()
    })
    await settle()
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes('导出 PDF'),
    )
    await act(async () => {
      item!.click()
    })
    await settle()
    expect(CS.printCalls, '源码模式不得触发打印').toBe(0)
    expect(CS.alerts.join('\n')).toContain('源码模式')
  })

  it('打印隐藏外壳依赖真实选择器：print.css 用 [data-ke-toolbar]，且不含三个不存在的推断类名', () => {
    // 只核对**规则文本**（注释里会提到旧类名，属说明性文字）
    const css = readFileSync(resolve(process.cwd(), 'src/print.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css, '工具栏钩子缺失 → 工具栏会被打进 PDF').toContain('[data-ke-toolbar]')
    expect(css, '状态栏无稳定类名 → 必须用外壳规则隐藏').toContain(':not(:has(main))')
    expect(css, '信息块真实钩子是 data-ke-note').toContain('[data-ke-note]')
    for (const bogus of ['.ke-toolbar', '.ke-sidebar', '.ke-status-bar']) {
      expect(css, `print.css 仍含不存在的选择器 ${bogus}`).not.toContain(bogus)
    }
    const area = readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8')
    expect(area, 'EditorArea 未渲染工具栏钩子（规则不会生效）').toContain('data-ke-toolbar')
  })
})
