/**
 * task-54（审查报告前端·数据丢失三件套）回归套件：R02 + R11 的 **EditorArea 宿主级**验证。
 *
 *  - **R02**：源码模式恢复历史版本后，textarea 必须显示**恢复后**的原文，且随后的保存
 *    载荷 = 恢复结果（而不是把恢复结果覆盖掉）。
 *  - **R11**：取消「未知/损坏 ke-* 改动」确认后，该内容的自动保存**不得写入磁盘**；
 *    仅确认成功才登记许可，且许可绑定被确认的内容版本；内容再变化可再次询问。
 *
 * R01（保存失败不得被当成已完成）的纯函数面见 `state/saveQueue.test.ts`（R01-①…⑥）。
 * 本文件用受控 mock（假编辑器 + fetch 桩）驱动真实 EditorArea；断言只认「实际 PUT 载荷」。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import type { ArticleMeta } from '../../types'

const CS = vi.hoisted(() => ({
  md: '',
  editableCalls: [] as boolean[],
  isEditable: true,
  setKeContentCalls: [] as string[],
  confirmResult: true,
  confirmMessages: [] as string[],
  autosaveMs: 1,
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  restored: '',
}))

vi.mock('@tiptap/react', () => ({
  EditorContext: { Provider: (props: { children?: unknown }) => props.children },
  EditorContent: () => null,
}))
vi.mock('../../editor', () => ({
  useKeEditor: (opts: { onUpdate?: () => void }) => {
    void opts
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
vi.mock('../editor/EditorToolbar', () => ({
  default: (props: { viewMode?: string; onToggleViewMode?: () => void; onOpenHistory?: () => void }) => (
    <div>
      <button type="button" data-testid="toggle" data-mode={props.viewMode} onClick={props.onToggleViewMode}>
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
const { __resetViewModeForTest, getViewMode } = await import('../../state/viewMode')

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
    if (url.includes('/api/history/list')) {
      return jsonResponse({ versions: [{ id: 'v1', timestamp: '2026-01-01T00:00:00Z', size: 10 }] })
    }
    if (url.includes('/api/history/preview')) {
      return jsonResponse({ id: 'v1', content: `---\nke_version: 1\n---\n\n旧版本正文\n` })
    }
    if (url.includes('/api/history/restore')) {
      return jsonResponse({
        id: 'Articles/a.md',
        path: 'Articles/a.md',
        title: 'a',
        content: CS.restored,
        tags: [],
        meta: {},
        word_count: 1,
        updated_at: '2026-01-01T00:00:00Z',
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
      word_count: 1,
      updated_at: '2026-01-01T00:00:00Z',
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

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render(content: string): Promise<void> {
  CS.md = content
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <EditorArea
        article={article(content)}
        loading={false}
        onNewArticle={() => undefined}
        onSaved={() => undefined}
        onArticleRestored={() => undefined}
      />,
    )
  })
  await settle()
}

function textarea(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('[data-testid="source-textarea"]')
  if (!el) throw new Error('未进入源码模式（缺少 textarea）')
  return el
}

async function typeInSource(next: string): Promise<void> {
  const el = textarea()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const PUTS = () => CS.requests.filter((r) => r.method === 'PUT')

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  CS.requests = []
  CS.confirmMessages = []
  CS.confirmResult = true
  CS.editableCalls = []
  CS.setKeContentCalls = []
  CS.md = ''
  CS.restored = ''
  installFetch()
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

describe('task-54 R11：取消未知语法确认后不得写入磁盘', () => {
  const RAW = `---\nke_version: 1\ntitle: a\n---\n\n正文第一段\n`

  it('R11-① 取消 → 自动保存零 PUT；再次仅加普通正文也不写；改内容后才可再次询问', async () => {
    await render(RAW)
    await act(async () => {
      ;(container.querySelector('[data-testid="toggle"]') as HTMLButtonElement).click()
    })
    await settle()
    expect(getViewMode()).toBe('source')

    // 改写未知 ke-* 标记（未知 kind → 会被 PM 规范化）→ 触发保存 → 首次提示
    CS.confirmResult = false
    await typeInSource(`<!-- ke-unknown: {"a":1} -->\n\n正文第一段\n`)
    await settle(50)
    expect(CS.confirmMessages.length, '未知语法改动必须提示').toBe(1)
    expect(PUTS().length, '取消后不得落盘').toBe(0)

    // 用户取消后**只加普通正文**：内容变了但未知标记改动仍在 → 旧实现（已置位的 prompted）会静默写入；
    // 修复后仍必须拦住（因为许可绑定的是被确认的内容，而这份内容从未被确认）。
    await typeInSource(`<!-- ke-unknown: {"a":1} -->\n\n正文第一段\n新增一行\n`)
    await settle(50)
    expect(PUTS().length, '未确认的未知语法改动不得被自动保存写入').toBe(0)
  })

  it('R11-② 确认成功 → 写出用户原文（含未知标记）；许可绑定该内容 → 普通续写不再重复提示', async () => {
    await render(RAW)
    await act(async () => {
      ;(container.querySelector('[data-testid="toggle"]') as HTMLButtonElement).click()
    })
    await settle()

    CS.confirmResult = true
    await typeInSource(`<!-- ke-unknown: {"a":1} -->\n\n正文第一段\n`)
    await settle(50)
    expect(CS.confirmMessages.length).toBe(1)
    const first = PUTS()
    expect(first.length, '确认后应落盘').toBeGreaterThan(0)
    expect(String((first[0].body as { content?: string }).content)).toContain('<!-- ke-unknown: {"a":1} -->')

    // 已确认的内容已落盘 → 基线推进；再续写普通正文不应重复询问，且直接写入
    await typeInSource(`<!-- ke-unknown: {"a":1} -->\n\n正文第一段\n续写\n`)
    await settle(50)
    expect(CS.confirmMessages.length, '同一改动确认过就不该反复询问').toBe(1)
    const all = PUTS()
    expect(String((all[all.length - 1].body as { content?: string }).content)).toContain('续写')
  })
})

describe('task-54 R02：源码模式恢复历史版本后 textarea 必须同步', () => {
  const RAW_NEW = `---\nke_version: 1\ntitle: a\n---\n\n新版本正文\n第二段\n`
  const RAW_OLD = `---\nke_version: 1\ntitle: a\n---\n\n旧版本正文\n`

  it('R02-① 恢复后 textarea = 恢复结果（不是陈旧文本），随后保存载荷 = 恢复结果', async () => {
    await render(RAW_NEW)
    await act(async () => {
      ;(container.querySelector('[data-testid="toggle"]') as HTMLButtonElement).click()
    })
    await settle()
    expect(textarea().value).toContain('新版本正文')

    // 打开历史 → 选版本 → 恢复
    CS.restored = RAW_OLD
    await act(async () => {
      ;(container.querySelector('[data-testid="open-history"]') as HTMLButtonElement).click()
    })
    await settle()
    await settle()
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    const currentBtn = buttons.find((b) => (b.textContent ?? '').includes('当前版本'))
    const versionBtn = currentBtn?.parentElement?.querySelectorAll<HTMLButtonElement>('button')[1]
    if (!versionBtn) throw new Error('历史版本行未渲染（版本列表第 2 个按钮缺失）')
    await act(async () => {
      versionBtn.click()
    })
    await settle()
    const restoreBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => (b.textContent ?? '').trim() === '恢复此版本',
    )
    if (!restoreBtn) throw new Error('未找到「恢复此版本」按钮')
    await act(async () => {
      restoreBtn.click()
    })
    await settle(50)

    expect(textarea().value, 'textarea 必须显示恢复后的原文').toContain('旧版本正文')
    expect(textarea().value, '不得残留恢复前的文本').not.toContain('新版本正文')

    // 恢复后再次保存：载荷必须是恢复结果（旧版本），不得把新版本覆盖回去
    await typeInSource(`${textarea().value}追加一行\n`)
    await settle(50)
    const puts = PUTS()
    const last = String((puts[puts.length - 1]?.body as { content?: string })?.content ?? '')
    expect(last, '保存载荷必须基于恢复结果').toContain('旧版本正文')
    expect(last).not.toContain('新版本正文')
  })
})
