/**
 * task-47 独立验证（verifier-trash）· B4（跨工作区串写）+ M4（源码态导出陈旧）
 *
 * 依据 `docs/review-v1.2.0-pre.2-full.md` §1 B4、§2 M4。
 *
 * B4 攻击面（独立推导，不照抄开发者用例）：
 *   ① 三处工作区级入口的**确认放弃**分支：确认期间继续输入 → 重新入队 → 必须在放弃时清掉，
 *      否则切档 effect / 后续 flush 会把它写进**已切换后的 root**（ws1 内容覆盖 ws2）。
 *   ② 在途保存：放弃必须触发 abort（signal.aborted），否则 PUT 仍会落到新 root。
 *   ③ 对照（证明断言有牙齿）：同一个「确认期间再入队」场景，若确认=取消，迟到的 PUT **确实**会发出。
 *   ④ 四条已修入口不得漂移的源码级核对（requestOpenArticle / closeTabById / 三处新修）。
 *
 * M4 攻击面：
 *   ⑤ 源码态三种导出载荷 = textarea 当前字符串（含 frontmatter/BOM/CRLF 口径），
 *      而非进入源码模式前的 PM 序列化结果；
 *   ⑥ 三处 handler 的 source 分支与正文分支必须都在（修 M4 不得回归正文态）；
 *   ⑦ `handleSourceChange` 必须逐键更新 `sourceValueRef`（否则导出仍会拿到旧文本）。
 *
 * ⚠️ 声明（未验证项）：M4 为 **seam + 源码接线级**验证，未在 jsdom 里真实渲染 EditorArea
 * 并点击导出菜单（EditorArea 依赖 Tiptap EditorView，渲染成本/teardown flaky 风险高，见 U4）。
 */
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSourceSavePayload } from './viewMode'
import { plainMarkdown } from '../editor/plain-export'
import { cancelPending, discardPending, enqueueSave, flushPendingAll, hasPending, pendingDocIds } from './saveQueue'

const DOC = 'Articles/a.md'
const PUT_URL = `/api/articles/${DOC}`

const CS = vi.hoisted(() => ({
  menuHandlers: new Map<string, (e?: unknown) => void>(),
  puts: [] as string[],
  confirmMessages: [] as string[],
  confirmResult: true,
  /** 确认对话框「打开期间」触发：模拟用户继续输入 → 重新入队 */
  onConfirm: null as null | (() => void),
  promptResult: '新文档' as string | null,
  picked: '/ws2' as string | null,
}))

vi.mock('../api/client', async () => {
  const { APP_VERSION } = await import('../version')
  return {
    getHealth: async () => ({ status: 'ok', app: 'ke', version: APP_VERSION, started_at: '', workspace: '/ws1' }),
    getWorkspaceCurrent: async () => ({ open: true, root: '/ws1', stats: { document: 1, module: 0, attachment: 0 } }),
    getRecentWorkspaces: async () => ({ workspaces: [] }),
    getFsEvents: async () => ({ events: [], last_seq: 0 }),
    getRecentDocuments: async () => ({ documents: [] }),
    listRecovery: async () => ({ count: 0, items: [] }),
    listTrash: async () => ({ count: 0, items: [] }),
    restoreTrash: async () => ({ id: 'x', restored_to: 'x', renamed: false }),
    purgeTrash: async () => undefined,
    clearTrash: async () => undefined,
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
vi.mock('../components/shell/AppShell', () => ({
  AppShell: (props: { left?: unknown; main?: unknown; right?: unknown; header?: unknown }) =>
    React.createElement('div', null, props.header as never, props.left as never, props.main as never),
}))
vi.mock('../components/layout/LeftSidebar', () => ({ default: () => null }))
vi.mock('../components/layout/RightPanel', () => ({ default: () => null }))
vi.mock('../components/layout/WorkspacePicker', () => ({ default: () => null }))
vi.mock('../components/layout/EditorArea', async () => {
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
vi.mock('../components/settings/SettingsPanel', () => ({ default: () => null }))
vi.mock('../desktop', () => ({ isDesktop: () => true, pickDirectory: async () => CS.picked }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, fn: (e?: unknown) => void) => {
    CS.menuHandlers.set(name, fn)
    return () => CS.menuHandlers.delete(name)
  },
}))
vi.mock('../settings', () => ({
  loadSettings: async () => ({
    startup: { restoreLastState: true, autoOpenRecentWorkspace: false },
    ui: { theme: 'system' },
    editor: {},
  }),
  applyTheme: () => undefined,
}))
vi.mock('../components/common/PromptDialog', () => ({
  askConfirm: async (msg: string) => {
    CS.confirmMessages.push(msg)
    CS.onConfirm?.()
    return CS.confirmResult
  },
  askPrompt: async () => CS.promptResult,
  PromptRoot: (props: { children?: unknown }) => props.children,
  PromptHost: () => null,
}))

const App = (await import('../App')).default

let root: Root | null = null
let container: HTMLDivElement
let lastSignal: AbortSignal | undefined

function installFetch() {
  const stub = async (input: unknown, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'PUT') CS.puts.push(String(input))
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

/** 悬挂保存：只有 abort 才结束 → flushWithTimeout（3s）必定超时，进入「放弃」分支 */
const hungSaveFn = (signal?: AbortSignal) => {
  lastSignal = signal
  return new Promise<void>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')))
  })
}

/** 会真的发 PUT 的保存（用于「确认期间再入队」与对照） */
const putSaveFn = async () => {
  await fetch(PUT_URL, { method: 'PUT', body: 'x' })
}

beforeEach(async () => {
  CS.menuHandlers = new Map()
  CS.puts = []
  CS.confirmMessages = []
  CS.confirmResult = true
  CS.onConfirm = null
  CS.promptResult = '新文档'
  CS.picked = '/ws2'
  lastSignal = undefined
  installFetch()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  try {
    localStorage.setItem('ke.lastArticleId', DOC)
  } catch {
    /* ignore */
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(App))
  })
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
  // 必须 abort 悬挂在途（A5 的「用户取消」场景不会自行结束），否则跨用例泄漏与挂死
  discardPending(DOC)
  await Promise.race([flushPendingAll().catch(() => undefined), new Promise((r) => setTimeout(r, 50))])
  cancelPending(DOC)
  container.remove()
  root = null
})

/** 制造「在途保存」：debounce=0 → drain 立即启动 → hungSaveFn 悬挂（flushWithTimeout 必超时） */
async function seedHungPending(): Promise<void> {
  await act(async () => {
    void enqueueSave(DOC, hungSaveFn, 0)
    await Promise.resolve()
  })
  expect(hasPending(DOC), '前置条件：应有在途保存').toBe(true)
  expect(lastSignal, '前置条件：saveFn 应已拿到 AbortSignal（在途）').toBeDefined()
}

/** 确认期间继续输入 → 重新入队（防抖未到，尚未落盘） */
function reenqueueDuringConfirm(): void {
  CS.onConfirm = () => {
    void enqueueSave(DOC, putSaveFn, 60000)
  }
}

async function timeoutThenSettle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100)
  })
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function triggerSwitchWorkspace(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('ke:open-workspace-dialog'))
  })
}

// ===========================================================================
// B4
// ===========================================================================

describe('B4-A 三处工作区级入口：确认放弃必须清掉「确认期间再入队」的未决保存', () => {
  it('B4-A1 switchWorkspace：放弃后零迟到 PUT，且随后 flushPendingAll 也零 PUT', async () => {
    await seedHungPending()
    reenqueueDuringConfirm()
    await triggerSwitchWorkspace()
    await timeoutThenSettle()

    expect(CS.confirmMessages.some((m) => m.includes('切换工作区将放弃'))).toBe(true)
    expect(hasPending(DOC), '放弃后仍有未决条目 → 会被切档 effect 落盘').toBe(false)
    expect(pendingDocIds()).not.toContain(DOC)

    await act(async () => {
      await flushPendingAll()
    })
    expect(CS.puts, `在 root 已切换到 /ws2 后仍发生 PUT: ${CS.puts.join(',')}`).toEqual([])
  })

  it('B4-A2 handleCloseWorkspace：放弃后零迟到 PUT', async () => {
    await seedHungPending()
    reenqueueDuringConfirm()
    await act(async () => {
      CS.menuHandlers.get('ke-menu:close-workspace')?.()
    })
    await timeoutThenSettle()

    expect(CS.confirmMessages.some((m) => m.includes('关闭工作区将放弃'))).toBe(true)
    expect(hasPending(DOC)).toBe(false)
    await act(async () => {
      await flushPendingAll()
    })
    expect(CS.puts).toEqual([])
  })

  it('B4-A3 handleNewArticle：放弃后零迟到 PUT', async () => {
    await seedHungPending()
    reenqueueDuringConfirm()
    await act(async () => {
      CS.menuHandlers.get('ke-menu:new-document')?.()
    })
    await timeoutThenSettle()

    expect(CS.confirmMessages.some((m) => m.includes('新建将放弃'))).toBe(true)
    expect(hasPending(DOC)).toBe(false)
    await act(async () => {
      await flushPendingAll()
    })
    expect(CS.puts).toEqual([])
  })

  it('B4-A4 在途保存必须被 abort（signal.aborted = true）', async () => {
    await seedHungPending()
    expect(lastSignal).toBeDefined()
    expect(lastSignal!.aborted, '前置条件：abort 前不应已 abort').toBe(false)
    reenqueueDuringConfirm()
    await triggerSwitchWorkspace()
    await timeoutThenSettle()
    expect(lastSignal!.aborted, '放弃分支未 abort 在途保存 → 迟到 PUT 仍可能落盘').toBe(true)
  })

  it('B4-A5 对照：用户取消（不放弃）→ 未决保留、未发 PUT（丢弃是有条件的）', async () => {
    CS.confirmResult = false
    await seedHungPending()
    reenqueueDuringConfirm()
    await triggerSwitchWorkspace()
    await timeoutThenSettle()

    expect(
      CS.confirmMessages.some((m) => m.includes('切换工作区将放弃')),
      '取消场景也应先弹出确认',
    ).toBe(true)
    expect(hasPending(DOC), '用户取消 → 未决必须保留（不得被丢弃）').toBe(true)
    expect(CS.puts, '确认阶段尚未落盘').toEqual([])
  })

  it('B4-A6 对照（证明「零迟到 PUT」有牙齿）：同一 saveFn 未被丢弃时确实会发出 PUT', async () => {
    await act(async () => {
      void enqueueSave(DOC, putSaveFn, 60000)
    })
    expect(CS.puts, '防抖未到：不应立即落盘').toEqual([])
    await act(async () => {
      await flushPendingAll()
    })
    expect(CS.puts, '未被丢弃的重新入队保存会落盘 → A1-A3 的「零 PUT」断言可被违反').toEqual([
      PUT_URL,
    ])
  })
})

describe('B4-B 四条入口不得漂移（源码级核对）', () => {
  const appSrc = (): string => readFileSync('src/App.tsx', 'utf8')

  /** 粗粒度提取一个 useCallback handler 的函数体（按下一个顶层 const 截断） */
  function handlerBody(src: string, name: string): string {
    const start = src.indexOf(`const ${name} = useCallback(`)
    expect(start, `App.tsx 未找到 ${name}`).toBeGreaterThan(-1)
    const next = src.indexOf('\n  const ', start + 10)
    return src.slice(start, next === -1 ? undefined : next)
  }

  const entries = ['requestOpenArticle', 'closeTabById', 'switchWorkspace', 'handleCloseWorkspace', 'handleNewArticle']

  for (const name of entries) {
    it(`B4-B1 ${name} 的放弃分支含 discardPending`, () => {
      const body = handlerBody(appSrc(), name)
      expect(body, `${name} 缺少 flushWithTimeout+确认`).toContain('flushWithTimeout(')
      expect(body, `${name} 放弃分支未调用 discardPending`).toContain('discardPending(')
    })
  }

  it('B4-B2 discardPending 必须出现在 !flushed 分支内（不得退化成无条件丢弃）', () => {
    for (const name of entries) {
      const body = handlerBody(appSrc(), name)
      const idxIf = body.indexOf('if (!flushed)')
      const idxDiscard = body.indexOf('discardPending(')
      expect(idxIf, `${name} 未找到 if (!flushed)`).toBeGreaterThan(-1)
      expect(idxDiscard, `${name} 的 discardPending 不在放弃分支内`).toBeGreaterThan(idxIf)
    }
  })

  it('B4-B3 取消分支必须 return（用户取消后不得继续切换工作区）', () => {
    for (const name of ['switchWorkspace', 'handleCloseWorkspace', 'handleNewArticle']) {
      const body = handlerBody(appSrc(), name)
      expect(body, `${name} 取消分支缺少 return`).toMatch(/askConfirm\([\s\S]{0,200}?return/)
    }
  })
})

// ===========================================================================
// M4
// ===========================================================================

describe('M4 源码态导出载荷 = textarea 当前内容', () => {
  const RAW = '---\ntitle: T\nke_version: 1\n---\n\n进入源码前的旧正文\n'
  const TEXTAREA = '进入源码前的旧正文\n\n源码模式里新写的一段\n'
  const RAW_CRLF_BOM = '\ufeff---\r\ntitle: T\r\nke_version: 1\r\n---\r\n\r\n旧正文\r\n'

  it('M4-1 KE / zip 载荷（buildSourceSavePayload）= 源码字符串内容 + frontmatter 口径', () => {
    const ke = buildSourceSavePayload(RAW, TEXTAREA)
    expect(ke, 'KE 载荷必须包含 textarea 最新内容').toContain('源码模式里新写的一段')
    expect(ke, '源 frontmatter 键必须保留').toContain('title: T')
    expect(ke, 'ke_version 必须更新为 KE 版本').toContain('ke_version:')
  })

  it('M4-2 plain 载荷（plainMarkdown(textarea)）= textarea 内容，且不含 ke 方言', () => {
    const plain = plainMarkdown(TEXTAREA, { title: 'T' })
    expect(plain, 'plain 载荷必须包含 textarea 最新内容').toContain('源码模式里新写的一段')
    expect(plain, 'plain 载荷不得含 ke_version').not.toContain('ke_version')
  })

  it('M4-3 源码载荷必须还原磁盘原文的 BOM/CRLF 特征（与保存同口径）', () => {
    const ke = buildSourceSavePayload(RAW_CRLF_BOM, '新正文\n')
    expect(ke.startsWith('\ufeff'), 'BOM 未还原').toBe(true)
    expect(ke.includes('\r\n'), 'CRLF 未还原').toBe(true)
    expect(ke).toContain('新正文')
  })

  it('M4-4 三种导出的源码分支均已接线（源码级：viewModeRef === source + 对应构造函数）', () => {
    const src = readFileSync('src/components/layout/EditorArea.tsx', 'utf8')
    const slice = (name: string): string => {
      const start = src.indexOf(`const ${name} = useCallback(`)
      expect(start, `未找到 ${name}`).toBeGreaterThan(-1)
      const next = src.indexOf('\n  const ', start + 10)
      return src.slice(start, next === -1 ? undefined : next)
    }
    const keH = slice('handleExportMarkdown')
    expect(keH, 'KE 导出缺源码分支').toContain("viewModeRef.current === 'source'")
    expect(keH).toContain('buildSourceSavePayload(sourceBaseRawRef.current, sourceValueRef.current)')
    expect(keH, '正文态分支不得被移除（回归）').toContain('keExportPayload(')

    const plainH = slice('handleExportPlainMarkdown')
    expect(plainH, 'plain 导出缺源码分支').toContain("viewModeRef.current === 'source'")
    expect(plainH).toContain('plainMarkdown(sourceValueRef.current')
    expect(plainH, '正文态分支不得被移除（回归）').toContain('plainExportPayload(')

    const zipH = slice('handleExportPackage')
    expect(zipH, 'zip 导出缺源码分支').toContain("viewModeRef.current === 'source'")
    expect(zipH).toContain('buildSourceSavePayload(sourceBaseRawRef.current, sourceValueRef.current)')
    expect(zipH, '正文态分支不得被移除（回归）').toContain('frontmatterBlockOf(article.content)')
  })

  it('M4-5 源码逐键更新 sourceValueRef（否则导出仍是旧文本）', () => {
    const src = readFileSync('src/components/layout/EditorArea.tsx', 'utf8')
    const start = src.indexOf('const handleSourceChange = useCallback(')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, start + 600)
    expect(body, 'handleSourceChange 未同步 sourceValueRef').toContain('sourceValueRef.current = next')
  })

  it('M4-6 viewModeRef 必须在 viewMode 变化时同步（导出分支读的是 ref）', () => {
    const src = readFileSync('src/components/layout/EditorArea.tsx', 'utf8')
    expect(src).toContain('const viewModeRef = useRef<ViewMode>(viewMode)')
    expect(src, 'viewModeRef 未随 viewMode 同步').toMatch(/viewModeRef\.current = viewMode/)
  })
})
