/**
 * B4（审查 BLOCKER）· 工作区级三处「放弃」分支必须丢弃未决/在途写入。
 *
 * 修前：`switchWorkspace` / `handleCloseWorkspace` / `handleNewArticle` 在
 * `flushWithTimeout` 超时 → 用户确认放弃后**没有** `discardPending` → 确认期间重新入队的
 * latest（以及切档 effect 的 flushPending）会在 root 已切换后才落盘 → **ws1 内容覆盖 ws2**。
 * 本套件对三处入口各构造一例：flush 超时 → 确认放弃 → 断言零迟到 PUT / 未决条目已清。
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueSave, hasPending, pendingDocIds, cancelPending, flushPendingAll } from './state/saveQueue'

const CS = vi.hoisted(() => ({
  menuHandlers: new Map<string, (e?: unknown) => void>(),
  requests: [] as Array<{ method: string; url: string }>,
  confirmMessages: [] as string[],
  confirmResult: true,
  promptResult: '新文档' as string | null,
  picked: '/ws2' as string | null,
}))

vi.mock('./api/client', async () => {
  const { APP_VERSION } = await import('./version')
  return {
    getHealth: async () => ({ status: 'ok', app: 'ke', version: APP_VERSION, started_at: '', workspace: '/ws1' }),
    getWorkspaceCurrent: async () => ({ open: true, root: '/ws1', stats: { document: 1, module: 0, attachment: 0 } }),
    getRecentWorkspaces: async () => ({ workspaces: [] }),
    getFsEvents: async () => ({ events: [], last_seq: 0 }),
    getRecentDocuments: async () => ({ documents: [] }),
    listRecovery: async () => ({ count: 0, items: [] }),
    openWorkspace: async (path: string) => ({ open: true, root: path }),
    createWorkspace: async (path: string) => ({ open: true, root: path }),
    closeWorkspace: async () => ({ open: false }),
    createArticle: async (title: string) => ({ id: 'Articles/new.md', path: 'Articles/new.md', title, content: '' }),
    getArticle: async (id: string) => ({ id, path: id, title: id, content: '' }),
    saveArticle: async () => ({ id: 'x', path: 'x', title: 'x', content: '' }),
    recordRecentDocument: async () => undefined,
    discardRecovery: async () => undefined,
    restoreRecovery: async () => ({ id: 'x', path: 'x', title: 'x', content: '' }),
    importMarkdown: async () => ({ id: 'x', path: 'x', title: 'x', created: false }),
    importPackage: async () => ({ id: 'x', path: 'x', title: 'x', created: false }),
    getRecentDocumentsAll: async () => ({ documents: [] }),
  }
})
vi.mock('./components/shell/AppShell', () => ({
  AppShell: (props: { left?: unknown; main?: unknown; right?: unknown; header?: unknown; statusBar?: unknown }) =>
    React.createElement('div', null, props.header as never, props.left as never, props.main as never),
}))
vi.mock('./components/layout/LeftSidebar', () => ({ default: () => null }))
vi.mock('./components/layout/RightPanel', () => ({ default: () => null }))
vi.mock('./components/layout/WorkspacePicker', () => ({ default: () => null }))
vi.mock('./components/layout/EditorArea', async () => {
  const ReactMod = await import('react')
  return {
    default: (props: { onSaveStateChange?: (s: string) => void }) => {
      ReactMod.useEffect(() => {
        props.onSaveStateChange?.('dirty')
      }, [])
      return null
    },
  }
})
vi.mock('./components/settings/SettingsPanel', () => ({ default: () => null }))
vi.mock('./desktop', () => ({
  isDesktop: () => true,
  pickDirectory: async () => CS.picked,
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, fn: (e?: unknown) => void) => {
    CS.menuHandlers.set(name, fn)
    return () => CS.menuHandlers.delete(name)
  },
}))
vi.mock('./settings', () => ({
  loadSettings: async () => ({
    startup: { restoreLastState: true, autoOpenRecentWorkspace: false },
    ui: { theme: 'system' },
    editor: {},
  }),
  applyTheme: () => undefined,
}))
vi.mock('./components/common/PromptDialog', () => ({
  askConfirm: async (msg: string) => {
    CS.confirmMessages.push(msg)
    return CS.confirmResult
  },
  askPrompt: async () => CS.promptResult,
  PromptRoot: (props: { children?: unknown }) => props.children,
  PromptHost: () => null,
}))

const App = (await import('./App')).default

let root: Root | null = null
let container: HTMLDivElement

function installFetch() {
  const stub = async (input: unknown, init?: RequestInit) => {
    CS.requests.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input) })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
      text: async () => '{}',
    } as unknown as Response
  }
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(stub)
}

/** 悬挂的 saveFn：只有 abort 才会结束 → flushWithTimeout 必定超时 */
const hungSaveFn = (signal?: AbortSignal) =>
  new Promise<void>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')))
  })

beforeEach(async () => {
  CS.menuHandlers = new Map()
  CS.requests = []
  CS.confirmMessages = []
  CS.confirmResult = true
  CS.promptResult = '新文档'
  CS.picked = '/ws2'
  installFetch()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  try {
    localStorage.setItem('ke.lastArticleId', 'Articles/a.md')
  } catch {
    /* ignore */
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(App))
  })
  // 让启动 effect（健康/工作区/设置/静默恢复上次文档/菜单监听）全部落定
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
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
  await Promise.race([flushPendingAll().catch(() => undefined), new Promise((r) => setTimeout(r, 50))])
  cancelPending('Articles/a.md')
  container.remove()
  root = null
})

/** 造一个「无待落盘后的迟到 PUT」场景：未决 entry + 悬挂在途 → flush 超时 */
async function seedPending(): Promise<void> {
  await act(async () => {
    void enqueueSave('Articles/a.md', hungSaveFn, 60000)
    await Promise.resolve()
  })
  expect(hasPending('Articles/a.md')).toBe(true)
}

async function timeoutAndConfirm(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100) // flushWithTimeout = 3s
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const puts = (): string[] => CS.requests.filter((r) => r.method === 'PUT').map((r) => r.url)

describe('B4 · 三处工作区级入口：放弃分支必须丢弃未决/在途写入', () => {
  it('B4-1 switchWorkspace：flush 超时 → 确认放弃 → 未决清零 + 零迟到 PUT', async () => {
    await seedPending()
    await act(async () => {
      window.dispatchEvent(new Event('ke:open-workspace-dialog'))
    })
    await timeoutAndConfirm()
    expect(CS.confirmMessages.some((m) => m.includes('切换工作区将放弃'))).toBe(true)
    expect(hasPending('Articles/a.md')).toBe(false)
    expect(pendingDocIds()).not.toContain('Articles/a.md')
    expect(puts()).toEqual([])
  })

  it('B4-2 handleCloseWorkspace：flush 超时 → 确认放弃 → 未决清零 + 零迟到 PUT', async () => {
    await seedPending()
    await act(async () => {
      CS.menuHandlers.get('ke-menu:close-workspace')?.()
    })
    await timeoutAndConfirm()
    expect(CS.confirmMessages.some((m) => m.includes('关闭工作区将放弃'))).toBe(true)
    expect(hasPending('Articles/a.md')).toBe(false)
    expect(puts()).toEqual([])
  })

  it('B4-3 handleNewArticle：flush 超时 → 确认放弃 → 未决清零 + 零迟到 PUT', async () => {
    await seedPending()
    await act(async () => {
      CS.menuHandlers.get('ke-menu:new-document')?.()
    })
    await timeoutAndConfirm()
    expect(CS.confirmMessages.some((m) => m.includes('新建将放弃'))).toBe(true)
    expect(hasPending('Articles/a.md')).toBe(false)
    expect(puts()).toEqual([])
  })

  it('B4-4 反例（证明断言非空）：不确认（取消）→ 未决保留，不得被丢弃', async () => {
    CS.confirmResult = false
    await seedPending()
    await act(async () => {
      window.dispatchEvent(new Event('ke:open-workspace-dialog'))
    })
    await timeoutAndConfirm()
    expect(hasPending('Articles/a.md')).toBe(true)
  })
})
