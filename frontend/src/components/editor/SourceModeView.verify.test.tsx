/**
 * 源码模式 —— 独立对抗验证套件 ②：组件与宿主集成（task-42 · verifier-attach）
 *
 * 规范：`docs/document-format.md` §6.2；实施契约：`docs/design-1.2.0-source-mode.md`
 *
 * 分组：
 *   A  SourceModeView（受控 textarea）组件语义
 *   B  EditorArea 集成：切换/flush/取消、未知 ke-* 提示、既有 PUT 链（mark_internal 所依托）、
 *      全局视图态、以及 dev 报备的残余风险（外部重载后源码保存仍取 textarea 原文）
 *   C  源码级不变量与回归面
 *
 * 本套件用自己的 mock 组合与断言（mock 只是脚手架，证据是断言）；纯函数面见 `state/viewMode.verify.test.ts`。
 *
 * 写入边界（task-42）：不得修改任何源码。
 */
import * as React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import SourceModeView from './SourceModeView'
import type { ArticleMeta } from '../../types'

const CS = vi.hoisted(() => ({
  md: '',
  onUpdate: null as null | (() => void),
  editableCalls: [] as boolean[],
  isEditable: true,
  setKeContentCalls: [] as string[],
  confirmResult: true,
  confirmMessages: [] as string[],
  autosaveMs: 10,
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  hangPut: false,
  hangReleases: [] as Array<() => void>,
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
  }) => (
    <button
      type="button"
      data-testid="toggle"
      data-mode={props.viewMode}
      disabled={!!props.viewModeDisabledReason}
      data-reason={props.viewModeDisabledReason ?? ''}
      onClick={props.onToggleViewMode}
    >
      toggle
    </button>
  ),
}))
vi.mock('./TableBubbleMenu', () => ({ default: () => null }))
vi.mock('./MathEditorModal', () => ({ default: () => null }))
vi.mock('./nodeviews/MathNodeView', () => ({ MATH_EDIT_EVENT: 'ke:math-edit' }))
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
const { __resetViewModeForTest, getViewMode, VIEW_MODE_STORAGE_KEY } = await import('../../state/viewMode')
const { flushPendingAll, cancelPending } = await import('../../state/saveQueue')

let root: Root | null = null
let container: HTMLDivElement

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

function installFetch(): void {
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
    if (method === 'PUT' && CS.hangPut) {
      // 永不返回 → flush 超时；测试结束时释放，避免挂起的 running 污染后续用例
      return new Promise<Response>((resolve) => {
        CS.hangReleases.push(() => resolve(jsonResponse({ id: 'Articles/a.md', path: 'Articles/a.md', title: 'a', content: String((body as { content?: string })?.content ?? ''), tags: [], meta: {}, word_count: 0, updated_at: '' })))
      })
    }
    if (method === 'DELETE') return jsonResponse(undefined, 204)
    return jsonResponse({
      id: 'Articles/a.md',
      path: 'Articles/a.md',
      title: 'a',
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

async function flushTimers(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** App 式宿主：article 为状态、onSaved 回写（与真实 App 一致，避免"无 App"造成的假象） */
let harnessApi: { setArticle: (a: ArticleMeta) => void; setReloadToken: (n: number) => void } | null = null

function Harness({ initial }: { initial: ArticleMeta }) {
  const [art, setArt] = React.useState<ArticleMeta>(initial)
  const [tok, setTok] = React.useState(0)
  React.useEffect(() => {
    harnessApi = { setArticle: setArt, setReloadToken: setTok }
  }, [])
  return React.createElement(EditorArea, {
    article: art,
    loading: false,
    onNewArticle: () => undefined,
    reloadToken: tok,
    onSaved: (_id: string, doc?: ArticleMeta) => {
      if (doc) setArt(doc as ArticleMeta)
    },
  })
}

async function renderEditor(raw: string): Promise<void> {
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(Harness, { initial: article(raw) }))
  })
  await flushTimers(0)
}

async function externalReload(next: ArticleMeta): Promise<void> {
  await act(async () => {
    harnessApi!.setArticle(next)
    harnessApi!.setReloadToken(1)
  })
  await flushTimers(0)
}

const toggle = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!
const textarea = (): HTMLTextAreaElement | null =>
  container.querySelector<HTMLTextAreaElement>('[data-testid="source-textarea"]')
const puts = (): Array<{ method: string; url: string; body: unknown }> =>
  CS.requests.filter((r) => r.method === 'PUT' && r.url.includes('/api/articles/'))
const putPayload = (): string => String((puts().at(-1)?.body as { content?: string })?.content ?? '')

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await flushTimers(0)
}

async function typeInto(ta: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flushTimers(0)
}

beforeEach(() => {
  CS.md = ''
  CS.onUpdate = null
  CS.autosaveMs = 10
  CS.editableCalls = []
  CS.isEditable = true
  CS.setKeContentCalls = []
  CS.confirmResult = true
  CS.confirmMessages = []
  CS.requests = []
  CS.hangPut = false
  CS.hangReleases = []
  __resetViewModeForTest('wysiwyg')
  installFetch()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.setSystemTime(0)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  // 释放挂起的 PUT，避免 saveQueue 的 running 链跨用例污染
  CS.hangReleases.forEach((r) => r())
  CS.hangReleases = []
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
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ============================================================================
// A. SourceModeView（受控组件）
// ============================================================================
describe('A SourceModeView 组件语义', () => {
  async function renderView(props: Partial<React.ComponentProps<typeof SourceModeView>>): Promise<void> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<SourceModeView value="" onChange={() => undefined} {...props} />)
    })
  }

  it('A1 初值逐字节 = 传入原文；说明条声明 frontmatter 已隐藏；等宽字体', async () => {
    const value = `- [x] 完成\n\n正文 <span style="color:red">红</span> &copy;\n\n<!-- ke-future: {"x":1} -->\n`
    await renderView({ value })
    const ta = textarea()!
    expect(ta.value, 'textarea 初值必须逐字节等于传入原文').toBe(value)
    expect(container.querySelector('[data-testid="source-mode-banner"]')!.textContent).toContain('frontmatter 已隐藏')
    expect(ta.className).toContain('font-mono')
    expect(ta.getAttribute('aria-label')).toBe('Markdown 原文')
  })

  it('A2 受控：输入触发 onChange（值仍由宿主提供，组件不自持状态）', async () => {
    const onChange = vi.fn()
    await renderView({ value: '旧', onChange })
    await typeInto(textarea()!, '新内容')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('新内容')
    expect(textarea()!.value, '受控组件不得自行改值').toBe('旧')
  })

  it('A3 只读态：textarea disabled + readOnly，并展示原因', async () => {
    await renderView({ value: 'x', readOnly: true, readOnlyReason: '版本预览中' })
    const ta = textarea()!
    expect(ta.disabled).toBe(true)
    expect(ta.readOnly).toBe(true)
    expect(container.textContent).toContain('版本预览中')
  })

  it('A4 notice 提示条：未知语法改动提示位可见', async () => {
    await renderView({ value: 'x', notice: '你修改了非标准语法；保存后将以原文为准' })
    expect(container.querySelector('[data-testid="source-mode-notice"]')!.textContent).toContain('非标准语法')
  })

  it('A5 DOM 合法性：无嵌套交互元素；保存状态与标题展示在说明条', async () => {
    await renderView({ value: 'x', saveLabel: '未保存…', title: '文档 a' })
    expect(container.querySelectorAll('button button').length).toBe(0)
    expect(container.querySelectorAll('button a').length).toBe(0)
    expect(container.textContent).toContain('未保存…')
    expect(container.textContent).toContain('文档 a')
  })
})

// ============================================================================
// B. EditorArea 集成
// ============================================================================
describe('B EditorArea 源码通道集成', () => {
  it('B1 切到源码：**先 flush 后切换**，textarea 初值 = 保存后的正文（frontmatter 隐藏 + 排他）', async () => {
    CS.md = '旧正文\n'
    await renderEditor(`---\nke_version: 1\ntitle: 标题\n---\n\n旧正文\n`)

    await act(async () => {
      CS.md = '- [x] 完成\n\n正文 <span style="color:red">红</span> &copy;\n'
      CS.onUpdate?.()
    })
    await flushTimers(0)
    const putsBefore = puts().length

    await click(toggle())

    expect(getViewMode()).toBe('source')
    expect(puts().length, '切入源码前必须 flush 未决保存（PUT 出现）').toBeGreaterThan(putsBefore)
    const ta = textarea()
    expect(ta, '源码态必须渲染 textarea').toBeTruthy()
    expect(ta!.value, 'textarea 初值必须是保存后的正文（含敏感方言逐字节）').toBe(CS.md)
    expect(ta!.value, 'frontmatter 必须隐藏').not.toContain('ke_version')
    expect(CS.editableCalls, '单视图排他：正文编辑器不可写').toContain(false)
  })

  it('B1b 【数据丢失路径】切到源码后若初值落后于刚 flush 的编辑，紧接着的源码保存会覆盖该编辑', async () => {
    CS.md = '旧正文\n'
    await renderEditor(`---\nke_version: 1\n---\n\n旧正文\n`)

    const flushedEdit = 'WYSIWYG 里刚写的正文\n'
    await act(async () => {
      CS.md = flushedEdit
      CS.onUpdate?.()
    })
    await flushTimers(0)
    await click(toggle()) // 切入源码（内部先 flush → 磁盘上已是 flushedEdit）
    expect(textarea(), '前置：已进入源码态').toBeTruthy()

    // 用户在源码里再加一行并保存
    await typeInto(textarea()!, `${textarea()!.value}源码追加\n`)
    await flushTimers(50)

    const payload = putPayload()
    expect(payload, '刚 flush 的 WYSIWYG 编辑必须仍在最终载荷里（不得被旧盘面覆盖）').toContain(flushedEdit.trimEnd())
  })

  it('B2 flush 超时 → 确认框；取消 → 留在正文且内容不丢（不进入源码）', async () => {
    CS.md = '正文一\n'
    await renderEditor('# 标题\n\n正文一\n')
    await act(async () => {
      CS.md = '正文一改\n'
      CS.onUpdate?.()
    })
    await flushTimers(0)

    CS.hangPut = true
    CS.confirmResult = false
    await click(toggle())
    await flushTimers(3100)
    await flushTimers(0)

    expect(CS.confirmMessages.some((m) => m.includes('未保存修改可能丢失')), '必须弹确认框').toBe(true)
    expect(getViewMode(), '取消后必须留在正文').toBe('wysiwyg')
    expect(textarea(), '取消后不得渲染 textarea').toBeNull()
    expect(CS.md, '取消后正文内容不得被清空').toBe('正文一改\n')
    expect(CS.editableCalls).not.toContain(false)
  })

  it('B3 源码编辑 → 防抖保存：PUT 载荷逐字节 = 用户原文 + 原 frontmatter + ke_version', async () => {
    await renderEditor(`---\n# 注释\nke_version: 1\ntitle: 标题\n---\n\n旧\n`)
    await click(toggle())
    const edited = `- [x] 完成\n\n<span style="color:red">红</span> &copy;\n\n<!-- ke-future: {"x":1} -->\n`
    await typeInto(textarea()!, edited)
    await flushTimers(50)

    const payload = putPayload()
    expect(payload, 'frontmatter 区块逐字节保留').toContain('# 注释')
    expect(payload).toContain('title: 标题')
    expect(payload.match(/ke_version/g)?.length, 'ke_version 只出现一次').toBe(1)
    expect(payload, '用户正文逐字节落盘').toContain(edited)
    expect(payload, '复选框不得被规范化').toContain('- [x] 完成')
    expect(payload, '行内 HTML 不得被剥离').toContain('<span style="color:red">红</span>')
    expect(payload, '实体不得二次转义').toContain('&copy;')
    expect(payload.endsWith(edited)).toBe(true)
  })

  it('B4 未知/损坏 ke-* 被改动 → 首次保存必须提示；未改动不提示；已提示过不重复', async () => {
    const base = `---\nke_version: 1\n---\n\n正文\n\n<!-- ke-future: {"x":1} -->\n`
    await renderEditor(base)
    await click(toggle())

    await typeInto(textarea()!, '正文改了\n\n<!-- ke-future: {"x":1} -->\n')
    await flushTimers(50)
    expect(CS.confirmMessages, '未改动未知标记不得弹提示').toEqual([])

    await typeInto(textarea()!, '正文改了\n\n<!-- ke-future: {"x":2} -->\n')
    await flushTimers(50)
    const first = CS.confirmMessages.filter((m) => /非标准|未知/.test(m))
    expect(first.length, '改动未知标记必须显式提示（不得静默覆盖）').toBeGreaterThanOrEqual(1)

    const before = CS.confirmMessages.length
    await typeInto(textarea()!, '正文改了\n\n<!-- ke-future: {"x":3} -->\n')
    await flushTimers(50)
    expect(CS.confirmMessages.length, '同一文档内提示只弹一次').toBe(before)
  })

  it('B5 源码保存复用既有 PUT 链（mark_internal 所依托）：URL/方法与正文通道一致，无新端点', async () => {
    await renderEditor(`---\nke_version: 1\n---\n\n旧\n`)
    await click(toggle())
    await typeInto(textarea()!, '新正文\n')
    await flushTimers(50)

    const p = puts().at(-1)!
    expect(p.method).toBe('PUT')
    expect(p.url).toMatch(/\/api\/articles\//)
    expect(CS.requests.every((r) => r.url.startsWith('/api/')), '不得出现非既有 API 的请求').toBe(true)
    expect(CS.requests.filter((r) => /source|raw/i.test(r.url)), '不得新增源码专用端点').toEqual([])
  })

  it('B6 全局视图态：切文档后仍为源码（不按文档记忆）', async () => {
    await renderEditor(`---\nke_version: 1\n---\n\n旧\n`)
    await click(toggle())
    expect(getViewMode()).toBe('source')

    await externalReload({ ...article('# 另一篇\n'), id: 'Articles/b.md', path: 'Articles/b.md', title: 'b' })

    expect(getViewMode(), '视图态为全局偏好：切文档后仍为 source').toBe('source')
    expect(textarea(), '仍渲染源码 textarea').toBeTruthy()
    expect(VIEW_MODE_STORAGE_KEY).toBe('ke.viewMode')
  })

  it('B7 残余风险：源态遇外部重载 → textarea 被刷成磁盘内容（未保存源码输入丢弃），后续保存与所见自洽', async () => {
    await renderEditor(`---\nke_version: 1\n---\n\n旧正文\n`)
    await click(toggle())

    const userText = '用户在源码里写的正文\n\n<!-- ke-future: {"x":1} -->\n'
    await typeInto(textarea()!, userText)
    expect(textarea()!.value, '前置：用户输入已在 textarea').toBe(userText)

    // 外部修改 → App 重取 article 并 +1 reloadToken（R2 显式重载）
    const externalBody = '外部磁盘上的新内容\n'
    CS.md = externalBody
    await externalReload(article(`---\nke_version: 1\n---\n\n${externalBody}`))

    // 记录型断言：显式重载会以磁盘内容刷新 textarea（未保存的源码输入被丢弃）
    expect(textarea()!.value, '显式重载后 textarea = 磁盘内容（已声明行为）').toBe(externalBody)

    // 关键不变量：之后的源码保存必须与用户**当前所见**一致（不得掺入旧 base / 外部内容之外的陈旧字节）
    await typeInto(textarea()!, `${externalBody}用户追加\n`)
    await flushTimers(50)
    const payload = putPayload()
    expect(payload, '保存载荷 = 原 frontmatter + 当前 textarea 内容').toContain(`${externalBody}用户追加`)
    expect(payload.trimEnd().endsWith('用户追加'), '载荷尾部应与 textarea 一致（无陈旧 base 残留）').toBe(true)
  })
})

// ============================================================================
// C. 源码级不变量与回归面
// ============================================================================
describe('C 源码级不变量与回归面', () => {
  it('C1 源码保存路径不经过 ProseMirror：静态断言组装函数不使用 serialize/parse', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/components/layout/EditorArea.tsx', 'utf8')
    expect(src).toContain('buildSourceSavePayload')
    const start = src.indexOf('const buildSourceSaveFn')
    const body = src.slice(start, src.indexOf('const enterSourceMode'))
    expect(body.length).toBeGreaterThan(0)
    expect(body, '源码保存函数不得调用编辑器序列化').not.toMatch(/getMarkdown\(\)/)
    expect(body, '源码保存函数不得 parse').not.toMatch(/setContent\(/)
  })

  it('C2 回归面文件在位（docSwitch / saveQueue / draftDebounce / 保真面由全量套件覆盖）', async () => {
    const { existsSync } = await import('node:fs')
    for (const rel of [
      'src/state/docSwitch.ts',
      'src/state/docSwitch.verify.test.ts',
      'src/state/saveQueue.ts',
      'src/state/draftDebounce.ts',
      'src/editor/fidelity-regression.test.ts',
      'src/editor/markdown-roundtrip.test.ts',
      'src/editor/plain-export.test.ts',
    ]) {
      expect(existsSync(rel), `${rel} 缺失`).toBe(true)
    }
  })
})
