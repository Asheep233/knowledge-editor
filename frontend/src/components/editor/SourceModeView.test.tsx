/**
 * task-41（v1.2.0-pre.2）· 源码模式组件与接线测试。
 *
 * A 组：`SourceModeView` 受控组件（值/onChange/只读/提示条）。
 * B 组：**真实 EditorArea** 的源码通道集成 —— 沿用 `state/docSwitch.verify.test.ts` 的组件轨做法
 *      （真实 EditorArea + 真实 saveQueue/viewMode，仅 mock 编辑器门面与重组件 + fetch 桩）：
 *      切换按钮 → textarea 初值（frontmatter 隐藏、逐字节）→ 编辑 → 防抖保存
 *      → **断言 PUT 载荷逐字节 = 用户原文 + 原 frontmatter + ke_version 更新**（不经 PM）→ 切回正文重新解析。
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourceModeView from './SourceModeView'
import { __resetViewModeForTest, getViewMode } from '../../state/viewMode'
import { flushPendingAll, cancelPending } from '../../state/saveQueue'
import type { ArticleMeta } from '../../types'

// ─────────────────────────────────────────────────────────── A 组：组件

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

async function renderView(props: Partial<React.ComponentProps<typeof SourceModeView>> = {}) {
  const full = { value: '正文', onChange: vi.fn(), ...props }
  if (!root) root = createRoot(container)
  await act(async () => {
    root!.render(<SourceModeView {...full} />)
  })
  return full
}


/** React 值跟踪器会忽略直接赋 `.value`；用原生 setter 再派发 input 才能触发 onChange */
async function typeInto(ta: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const textarea = (): HTMLTextAreaElement => container.querySelector<HTMLTextAreaElement>('[data-testid="source-textarea"]')!

describe('A. SourceModeView（受控 textarea）', () => {
  it('A1 渲染 textarea，值为传入原文（等宽、说明条含 frontmatter 已隐藏）', async () => {
    await renderView({ value: '- [x] 完成\n' })
    expect(textarea().value).toBe('- [x] 完成\n')
    expect(container.querySelector('[data-testid="source-mode-banner"]')!.textContent).toContain('frontmatter 已隐藏')
  })

  it('A2 输入触发 onChange（受控：值由宿主提供）', async () => {
    const onChange = vi.fn()
    await renderView({ value: 'a', onChange })
    await typeInto(textarea(), 'a\nb')
    expect(onChange).toHaveBeenCalledWith('a\nb')
  })

  it('A3 只读态：textarea disabled/readOnly + 展示原因', async () => {
    await renderView({ readOnly: true, readOnlyReason: '版本预览中' })
    const ta = textarea()
    expect(ta.disabled).toBe(true)
    expect(ta.readOnly).toBe(true)
    expect(container.textContent).toContain('版本预览中')
  })

  it('A4 notice 提示条可见（未知语法改动提示位）', async () => {
    await renderView({ notice: '你修改了非标准语法' })
    expect(container.querySelector('[data-testid="source-mode-notice"]')!.textContent).toContain('你修改了非标准语法')
  })
})

// ─────────────────────────────────────────────────── B 组：EditorArea 集成

const CS = vi.hoisted(() => ({
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  md: '',
  onUpdate: null as null | (() => void),
  autosaveMs: 10,
  editableCalls: [] as boolean[],
  isEditable: true,
  setKeContentCalls: [] as string[],
  confirmResult: true,
  confirmMessages: [] as string[],
  exported: [] as Array<{ text: string; filename: string }>,
  zipped: [] as string[],
}))

vi.mock('@tiptap/react', () => ({
  EditorContext: { Provider: (props: { children?: unknown }) => props.children },
  EditorContent: () => null,
}))
vi.mock('../../editor', () => ({
  useKeEditor: (opts: { onUpdate?: () => void }) => {
    CS.onUpdate = opts.onUpdate ?? null
    return {
      getMarkdown: () => CS.md,
      setEditable: (v: boolean) => {
        CS.editableCalls.push(v)
        CS.isEditable = v
      },
      get isEditable() {
        return CS.isEditable
      },
      isFocused: false,
      commands: { focus: () => undefined, setContent: () => undefined, command: () => undefined },
    }
  },
  setKeContent: (_ed: unknown, md: string) => {
    CS.md = md
    CS.setKeContentCalls.push(md)
  },
}))
vi.mock('../../settings', () => ({ getAutosaveIntervalMs: () => CS.autosaveMs }))
vi.mock('./EditorToolbar', () => ({
  default: (props: {
    viewMode?: string
    viewModeDisabledReason?: string
    onToggleViewMode?: () => void
    exportButton?: unknown
  }) => (
    <>
      <button
        type="button"
        data-testid="toggle"
        data-mode={props.viewMode}
        disabled={!!props.viewModeDisabledReason}
        onClick={props.onToggleViewMode}
      >
        toggle
      </button>
      {(props as { exportButton?: React.ReactNode }).exportButton}
    </>
  ),
}))
vi.mock('./TableBubbleMenu', () => ({ default: () => null }))
vi.mock('./MathEditorModal', () => ({ default: () => null }))
vi.mock('./nodeviews/MathNodeView', () => ({ MATH_EDIT_EVENT: 'ke:math-edit' }))
vi.mock('../../editor/export-actions', () => ({
  runExport: async (t: { blob: Blob; filename: string }) => {
    CS.exported.push({ text: await t.blob.text(), filename: t.filename })
  },
  packageExportAndSave: async (_title: string, md: string) => {
    CS.zipped.push(md)
  },
  keExportPayload: () => ({ blob: new Blob(['KE-WYSIWYG']), filename: 'ke.md' }),
  plainExportPayload: () => ({ blob: new Blob(['PLAIN-WYSIWYG']), filename: 'plain.md' }),
}))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: async (msg: string) => {
    CS.confirmMessages.push(msg)
    return CS.confirmResult
  },
  askPrompt: async () => null,
  PromptRoot: (props: { children?: unknown }) => props.children,
  PromptHost: () => null,
  usePrompt: () => async () => null,
}))

const EditorArea = (await import('../layout/EditorArea')).default

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

function installFetch() {
  const stub = async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined
    } catch {
      body = undefined
    }
    CS.requests.push({ method, url, body })
    if (method === 'DELETE') return jsonResponse(undefined, 204)
    return jsonResponse({
      id: 'Articles/a.md',
      path: 'Articles/a.md',
      title: 'a',
      // 回包 = 磁盘原样：echo 请求里的 content（源码通道的载荷）
      content: (body as { content?: string })?.content ?? '',
      tags: [],
      meta: {},
      word_count: 0,
      updated_at: '',
    })
  }
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(stub)
}

const article = (content: string): ArticleMeta => ({
  id: 'Articles/a.md',
  path: 'Articles/a.md',
  title: 'a',
  content,
  tags: [],
  word_count: 1,
  updated_at: '2026-01-01T00:00:00Z',
})

async function renderEditor(raw: string) {
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(EditorArea, { article: article(raw), loading: false, onNewArticle: () => undefined }))
  })
}

const toggle = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!
const findButton = (label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)
async function clickExportItem(label: string): Promise<void> {
  await act(async () => {
    findButton('导出')?.click()
  })
  await act(async () => {
    findButton(label)?.click()
  })
}
const puts = () => CS.requests.filter((r) => r.method === 'PUT' && r.url.includes('/api/articles/'))
const putPayload = (): string => (puts().at(-1)?.body as { content?: string })?.content ?? ''

beforeEach(() => {
  CS.requests = []
  CS.md = ''
  CS.onUpdate = null
  CS.autosaveMs = 10
  CS.editableCalls = []
  CS.isEditable = true
  CS.setKeContentCalls = []
  CS.confirmResult = true
  CS.confirmMessages = []
  CS.exported = []
  CS.zipped = []
  __resetViewModeForTest('wysiwyg')
  installFetch()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.setSystemTime(0)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  try {
    vi.useRealTimers()
  } catch {
    /* ignore */
  }
  await act(async () => {
    root?.unmount()
  })
  await Promise.race([flushPendingAll().catch(() => undefined), new Promise((r) => setTimeout(r, 300))])
  cancelPending('Articles/a.md')
  container.remove()
  root = null
})

describe('B. EditorArea 源码通道（字符串直存）', () => {
  it('B1 点切换 → 源码态：textarea 初值 = 正文原文（frontmatter 隐藏、含敏感方言逐字节）', async () => {
    const raw = '---\ntitle: x\nke_version: 1\n---\n\n- [x] 完成\n\n前 <span style="color:red">红</span> &copy; 后\n'
    await renderEditor(raw)
    await act(async () => {
      toggle().click()
    })
    expect(getViewMode()).toBe('source')
    expect(toggle().getAttribute('data-mode')).toBe('source')
    expect(textarea().value).toBe('- [x] 完成\n\n前 <span style="color:red">红</span> &copy; 后\n')
    // 单视图排他：正文编辑器被置为不可写
    expect(CS.editableCalls).toContain(false)
  })

  it('B2 编辑 → 防抖保存：PUT 载荷逐字节 = 用户原文 + 原 frontmatter + ke_version（不经 PM）', async () => {
    const raw = '---\ntitle: 我的文档\ntags:\n  - a\nke_version: 1\n---\n\n旧正文\n'
    await renderEditor(raw)
    await act(async () => {
      toggle().click()
    })
    const edited = '- [x] 新正文\n\n&copy; 2026 <mark>高亮</mark>\n'
    await typeInto(textarea(), edited)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(puts().length).toBeGreaterThan(0)
    expect(putPayload()).toBe(
      '---\ntitle: 我的文档\ntags:\n  - a\nke_version: 1\n---\n\n' + edited,
    )
    // 载荷里不得出现 PM 规范化痕迹（正文通道会做这些）
    expect(putPayload()).toContain('- [x] 新正文')
    expect(putPayload()).toContain('<mark>高亮</mark>')
    expect(putPayload()).toContain('&copy; 2026')
    expect(putPayload()).not.toContain('\\[x\\]')
  })

  it('B3 CRLF 文档：textarea 的 LF 被 traits 还原为 CRLF（非换行字节不变）', async () => {
    const raw = '---\r\nke_version: 1\r\n---\r\n\r\nA\r\nB\r\n'
    await renderEditor(raw)
    await act(async () => {
      toggle().click()
    })
    expect(textarea().value).toBe('A\r\nB\r\n') // 初值是磁盘原文（含 CRLF）
    await typeInto(textarea(), 'A\nB\nC\n') // DOM 会把换行规范化为 LF
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(putPayload()).toBe('---\r\nke_version: 1\r\n---\r\n\r\nA\r\nB\r\nC\r\n')
    expect(putPayload()).not.toMatch(/(^|[^\r])\n/)
  })

  it('B4 切回正文：先 flush 源码改动，再以已保存原文重新解析（setKeContent 一次）', async () => {
    const raw = '---\nke_version: 1\n---\n\nA\n'
    await renderEditor(raw)
    await act(async () => {
      toggle().click()
    })
    await typeInto(textarea(), 'A\nB\n')
    await act(async () => {
      toggle().click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(getViewMode()).toBe('wysiwyg')
    expect(puts().length).toBeGreaterThan(0)
    // 重新解析：内容取「保存后」的原文正文（不含 frontmatter）
    expect(CS.setKeContentCalls).toContain('A\nB\n')
    expect(CS.editableCalls).toContain(true)
  })

  it('B5 未知 ke-* 被改动 → 首次保存显式提示（不得静默覆盖）；仅改普通正文不提示', async () => {
    const raw = '---\nke_version: 1\n---\n\n<!-- ke-unknown: {"a":1} -->\n\n正文\n'
    await renderEditor(raw)
    await act(async () => {
      toggle().click()
    })
    await typeInto(textarea(), '<!-- ke-unknown: {"a":2} -->\n\n正文\n')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(CS.confirmMessages.some((m) => m.includes('非标准语法'))).toBe(true)
    // 提示后仍保存（用户确认）
    expect(puts().length).toBeGreaterThan(0)
  })


  it('M4 源码态三种导出均取 textarea 原文（不是进源码前的旧正文）', async () => {
    const raw = '---\nke_version: 1\n---\n\n旧正文\n'
    await renderEditor(raw)
    await act(async () => {
      toggle().click()
    })
    await typeInto(textarea(), '源码态新正文\n')

    await clickExportItem('导出 Markdown（KE 格式）')
    expect(CS.exported.at(-1)?.text).toContain('源码态新正文')
    expect(CS.exported.at(-1)?.text).not.toContain('旧正文')

    await clickExportItem('导出普通 Markdown (.md)')
    expect(CS.exported.at(-1)?.text).toContain('源码态新正文')

    await clickExportItem('导出文档包 (.zip)')
    expect(CS.zipped.at(-1)).toContain('源码态新正文')
    expect(CS.zipped.at(-1)).not.toContain('旧正文')
  })

  it('M4 对照：正文态导出仍走既有 PM 载荷（既有行为不回归）', async () => {
    await renderEditor('---\nke_version: 1\n---\n\n正文\n')
    await clickExportItem('导出 Markdown（KE 格式）')
    expect(CS.exported.at(-1)?.text).toBe('KE-WYSIWYG')
  })

  it('B6 无文档：切换按钮禁用（只读/版本预览态不提供源码编辑）', async () => {
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(EditorArea, { article: null, loading: false, onNewArticle: () => undefined }))
    })
    expect(container.querySelector('[data-testid="toggle"]')).toBeNull() // 无文档：工具栏不渲染，源码入口不可达
  })
})
