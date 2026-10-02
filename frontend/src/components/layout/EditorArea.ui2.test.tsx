/**
 * task-56 UI-2 专项：**跨档保存不得串档**（高危机理用例）。
 *
 * 修前：`buildSaveFn` 的 `isCurrent` 在 `await` **之前**捕获，await 之后仍用它做门控。
 * 若保存期间用户切档 A→B，A 的回包会走 `captureTraits + setKeContent(ed, savedBody)`
 * ——把 **A 的正文写进此刻显示 B 的编辑器**；404 提示也会按陈旧门控弹出。
 *
 * 本套件用受控 fetch 桩把 PUT **挂起**，在同一保存的生命周期内切换 `article` prop，
 * 再放行回包，断言：
 *   ① 陈旧回包**不写内容**（编辑器仍是 B 的正文）；
 *   ② 陈旧 404 **不弹提示**；
 *   ③ 当前文档（B）内容不被覆盖。
 * 末尾附**对照**：仍为当前文档的保存回包 404 时必须弹提示（证明 ② 不是恒真断言）。
 *
 * 对照「修前会红」：在 HEAD（无本修）上跑本文件，① 的 `CS.md` 会变成 A 的落盘正文
 * （红）；修后为绿 —— 见回报中的 before/after 实测输出。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import type { ArticleMeta } from '../../types'

const CS = vi.hoisted(() => ({
  md: '',
  onUpdate: null as null | (() => void),
  setKeContentCalls: [] as string[],
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  /** 挂起的 PUT resolver（按请求顺序） */
  pendingPuts: [] as Array<(r: Response) => void>,
  /** window.alert 记录（本环境 window.alert 未定义，直接注入） */
  alerts: [] as string[],
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
      setEditable: () => undefined,
      get isEditable() {
        return true
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
vi.mock('../../settings', () => ({ getAutosaveIntervalMs: () => 1 }))
vi.mock('../editor/EditorToolbar', () => ({
  default: (props: { onOpenHistory?: () => void; onToggleViewMode?: () => void }) => (
    <div>
      <button type="button" data-testid="toggle" onClick={props.onToggleViewMode}>
        toggle
      </button>
      <button type="button" data-testid="open-history" onClick={props.onOpenHistory}>
        history
      </button>
    </div>
  ),
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

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

const doc = (id: string, content: string): ArticleMeta => ({
  id,
  path: id,
  title: id,
  content,
  tags: [],
  word_count: 1,
  updated_at: '2026-01-01T00:00:00Z',
})

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
    if (url.includes('/api/articles/') && method === 'PUT') {
      // 关键：PUT 挂起，交由用例决定何时返回（模拟「保存期间用户切档」的窗口）
      return await new Promise<Response>((resolve) => CS.pendingPuts.push(resolve))
    }
    if (url.includes('/api/articles/Articles/b.md') && method === 'GET') {
      return jsonResponse({
        id: 'Articles/b.md',
        path: 'Articles/b.md',
        title: 'b',
        content: 'B 的正文',
        meta: {},
        tags: [],
      })
    }
    return jsonResponse({})
  }
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(stub)
}

const PUTS = () => CS.requests.filter((r) => r.method === 'PUT')

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render(a: ArticleMeta): Promise<void> {
  CS.md = a.content
  await act(async () => {
    root!.render(
      <EditorArea
        article={a}
        loading={false}
        onNewArticle={() => undefined}
        onSaved={() => undefined}
        onArticleRestored={() => undefined}
      />,
    )
  })
  await settle()
}

/** 模拟一次编辑并等待自动保存发出（PUT 挂起） */
async function editAndWaitForPut(next: string): Promise<void> {
  CS.md = next
  await act(async () => {
    CS.onUpdate?.()
  })
  await settle(10)
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  CS.requests = []
  CS.setKeContentCalls = []
  CS.pendingPuts = []
  CS.md = ''
  CS.onUpdate = null
  installFetch()
  CS.alerts = []
  ;(globalThis as { alert?: (m?: unknown) => void }).alert = (m?: unknown) => {
    CS.alerts.push(String(m))
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

describe('task-56 UI-2：跨档保存竞态', () => {
  it('①③ 保存期间切档 → 陈旧回包不写入编辑器、当前文档内容不被覆盖', async () => {
    root = createRoot(container)
    await render(doc('Articles/a.md', 'A 的正文'))
    await editAndWaitForPut('A 的编辑后正文')
    expect(PUTS().length, 'A 的保存应已发出并挂起').toBe(1)

    // A→B：切换 prop（B 的载入 effect 会把 B 的正文写进编辑器）
    await act(async () => {
      root!.render(
        <EditorArea
          article={doc('Articles/b.md', 'B 的正文')}
          loading={false}
          onNewArticle={() => undefined}
          onSaved={() => undefined}
          onArticleRestored={() => undefined}
        />,
      )
    })
    await settle()
    const bLoaded = CS.md
    expect(bLoaded).toContain('B 的正文')

    // 放行 A 的回包（内容 = A 的落盘正文）
    await act(async () => {
      CS.pendingPuts[0](
        jsonResponse({
          id: 'Articles/a.md',
          path: 'Articles/a.md',
          title: 'a',
          content: 'A 的落盘正文',
          meta: {},
          tags: [],
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await settle(20)

    // ① 陈旧回包不得写内容；③ 当前（B）内容不被覆盖
    expect(CS.setKeContentCalls).not.toContain('A 的落盘正文')
    expect(CS.md).toBe(bLoaded)
  })

  it('② 切档后旧文档 404 不弹提示；仍为当前文档的 404 必须弹（对照，防恒真）', async () => {
    root = createRoot(container)
    await render(doc('Articles/a.md', 'A 的正文'))
    await editAndWaitForPut('A 的编辑')
    expect(PUTS().length).toBe(1)

    // 切到 B 后 A 的 PUT 返回 404 → 不得弹提示
    await act(async () => {
      root!.render(
        <EditorArea
          article={doc('Articles/b.md', 'B 的正文')}
          loading={false}
          onNewArticle={() => undefined}
          onSaved={() => undefined}
          onArticleRestored={() => undefined}
        />,
      )
    })
    await settle()
    await act(async () => {
      CS.pendingPuts[0](jsonResponse({ detail: '文章不存在' }, 404))
      await Promise.resolve()
      await Promise.resolve()
    })
    await settle(20)
    expect(CS.alerts, '已切档的旧文档 404 不应打扰用户').toEqual([])

    // 对照：当前文档（B）自己的保存 404 → 必须提示（证明上面的 not-called 非恒真）
    CS.alerts = []
    await editAndWaitForPut('B 的编辑')
    const puts = PUTS()
    expect(puts.length).toBe(2)
    await act(async () => {
      CS.pendingPuts[1](jsonResponse({ detail: '文章不存在' }, 404))
      await Promise.resolve()
      await Promise.resolve()
    })
    await settle(20)
    expect(CS.alerts.length, '当前文档 404 必须明确提示').toBe(1)
    expect(CS.alerts[0]).toContain('404')
  })
})
