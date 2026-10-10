/**
 * task-64 A13（第三份审查 P1）· App 宿主级回归：草稿恢复成功后必须**强制两条编辑通道从磁盘重载**，
 * 并作废该文档的未决/在途保存 —— 否则陈旧的界面会再次保存、把刚恢复的内容覆盖掉。
 *
 * 修前：`handleRecoveryRestore` 只 `requestOpenArticle(doc.id)`，而 EditorArea 装载 effect 依赖
 * `article.id`/`reloadToken`（同一 id 恢复 → 不重载）；编辑器仍持旧正文，用户随后保存即覆盖恢复结果。
 * 修后：`discardPending(doc.id)` + `setReloadToken(n => n + 1)` + 重新拉盘（`getArticle`）。
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueSave, hasPending, pendingDocIds } from './state/saveQueue'
import { DEFAULT_DEBOUNCE_MS } from './state/saveQueue'

const CS = vi.hoisted(() => ({
  menuHandlers: new Map<string, (e?: unknown) => void>(),
  callOrder: [] as string[],
  recovered: `---\nke_version: 1\ntitle: a\n---\n\n恢复校验正文甲乙\n`,
  baseline: `---\nke_version: 1\ntitle: a\n---\n\nRECOVERY_BASELINE\n`,
  /** 磁盘当前内容（启动时 = 基线；restoreRecovery 后 = 恢复内容）——忠实复现审计时序 */
  diskContent: `---\nke_version: 1\ntitle: a\n---\n\nRECOVERY_BASELINE\n`,
  editorProps: [] as Array<{ reloadToken?: number; articleId?: string | null; content?: string | null }>,
}))

vi.mock('./api/client', async () => {
  const { APP_VERSION } = await import('./version')
  const meta = (content: string, id = 'Articles/a.md') => ({
    id,
    path: id,
    title: 'a',
    content,
    tags: [],
    meta: {},
    word_count: 1,
    updated_at: '2026-01-01T00:00:00Z',
  })
  return {
    getHealth: async () => ({ status: 'ok', app: 'ke', version: APP_VERSION, started_at: '', workspace: '/ws1' }),
    getWorkspaceCurrent: async () => ({ open: true, root: '/ws1', stats: { document: 1, module: 0, attachment: 0 } }),
    getRecentWorkspaces: async () => ({ workspaces: [] }),
    getFsEvents: async () => ({ events: [], last_seq: 0 }),
    getRecentDocuments: async () => ({ documents: [] }),
    listRecovery: async () => ({
      count: 1,
      items: [{ doc_path: 'Articles/a.md', title: 'a', saved_at: '2026-01-01T00:00:00Z', size: 12 }],
    }),
    restoreRecovery: async (docPath: string) => {
      CS.callOrder.push('restoreRecovery')
      CS.diskContent = CS.recovered // 恢复接口把草稿写回磁盘
      return meta(CS.recovered, docPath)
    },
    getArticle: async (id: string) => {
      CS.callOrder.push('getArticle')
      return meta(CS.diskContent, id) // 读盘：启动时是基线，恢复后是恢复内容
    },
    saveArticle: async (id: string, content: string) => {
      CS.callOrder.push('saveArticle')
      return meta(content, id)
    },
    discardRecovery: async () => undefined,
    recordRecentDocument: async () => undefined,
    openWorkspace: async () => ({ open: true, root: '/ws1' }),
    createWorkspace: async () => ({ open: true, root: '/ws1' }),
    closeWorkspace: async () => ({ open: false }),
    createArticle: async () => meta('', 'Articles/new.md'),
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
    default: (props: { article?: { id?: string; content?: string } | null; reloadToken?: number }) => {
      ReactMod.useEffect(() => {
        CS.editorProps.push({
          reloadToken: props.reloadToken,
          articleId: props.article?.id ?? null,
          content: props.article?.content ?? null,
        })
      })
      return null
    },
  }
})
vi.mock('./components/settings/SettingsPanel', () => ({ default: () => null }))
vi.mock('./desktop', () => ({ isDesktop: () => false, pickDirectory: async () => null }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, fn: (e?: unknown) => void) => {
    CS.menuHandlers.set(name, fn)
    return () => CS.menuHandlers.delete(name)
  },
}))
vi.mock('./settings', () => ({
  loadSettings: async () => ({
    // 审计时序：启动 restoreLastState → 自动打开上次文档（基线），再点「恢复」
    startup: { restoreLastState: true, autoOpenRecentWorkspace: false },
    ui: { theme: 'system' },
    editor: {},
  }),
  applyTheme: () => undefined,
}))
vi.mock('./components/common/PromptDialog', () => ({
  askConfirm: async () => true,
  askPrompt: async () => null,
  PromptRoot: (props: { children?: unknown }) => props.children,
  PromptHost: () => null,
}))

const App = (await import('./App')).default

let root: Root | null = null
let container: HTMLDivElement

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(async () => {
  CS.menuHandlers = new Map()
  CS.callOrder = []
  CS.editorProps = []
  CS.diskContent = CS.baseline
  try {
    localStorage.setItem('ke.lastArticleId', 'Articles/a.md')
  } catch {
    /* ignore */
  }
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    text: async () => '{}',
  })) as unknown as typeof fetch
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(App))
  })
  await settle()
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

describe('task-64 A13：草稿恢复后界面必须重载，且不得被旧界面覆盖', () => {
  it('A13-① 恢复：作废未决保存 + 推进装载代次 + 从磁盘重新拉取恢复内容', async () => {
    // 前置①：启动 restoreLastState 已把**基线**文档载入界面（审计时序）
    expect(
      CS.editorProps.some((p) => String(p.content ?? '').includes('RECOVERY_BASELINE')),
      `启动未载入基线文档：${JSON.stringify(CS.editorProps)}`,
    ).toBe(true)
    // 前置②：该文档存在未决保存（模拟「最后输入仍在防抖窗口内」）
    enqueueSave('Articles/a.md', async () => undefined, DEFAULT_DEBOUNCE_MS)
    expect(hasPending('Articles/a.md'), '前置：确有未决保存').toBe(true)

    const reloadBefore = CS.editorProps.at(-1)?.reloadToken ?? 0
    const restoreBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => (b.textContent ?? '').trim() === '恢复',
    )
    if (!restoreBtn) throw new Error('未找到恢复面板的「恢复」按钮')
    await act(async () => {
      restoreBtn.click()
    })
    await settle()

    // ① 未决/在途保存被作废（不再有陈旧内容可写）
    expect(pendingDocIds(), '恢复必须作废该文档的未决保存').not.toContain('Articles/a.md')
    expect(hasPending('Articles/a.md')).toBe(false)

    // ② 装载代次推进（强制 EditorArea 重载两条编辑通道）
    const reloadAfter = CS.editorProps.at(-1)?.reloadToken ?? 0
    expect(reloadAfter, '恢复必须推进 reloadToken 强制重载').toBeGreaterThan(reloadBefore)

    // ③ 界面拿到的是**恢复后**的磁盘内容（而不是恢复前的旧正文）
    const restoreAt = CS.callOrder.indexOf('restoreRecovery')
    expect(restoreAt, '未调用恢复接口').toBeGreaterThanOrEqual(0)
    expect(
      CS.callOrder.slice(restoreAt),
      '恢复之后必须重新拉盘（getArticle）',
    ).toContain('getArticle')
    expect(String(CS.editorProps.at(-1)?.content ?? ''), '编辑器必须被喂入恢复后的正文').toContain('恢复校验正文甲乙')

    // ④ U01 竞态判据：**不得**出现「装载代次已推进、但 article 还是旧正文」的中间态 ——
    // 那一次 effect 会用旧正文重载编辑器；随后 setArticle 落地时文档 id 未变、reloadToken 也未再变，
    // 装载 effect 不会重跑 → 编辑器永远停在旧正文（审计 U01「restored UI retains old content」）。
    const bad = CS.editorProps.filter(
      (p) =>
        (p.reloadToken ?? 0) > reloadBefore &&
        p.articleId === 'Articles/a.md' &&
        !String(p.content ?? '').includes('恢复校验正文甲乙'),
    )
    expect(
      bad,
      `存在「代次已推进但 article 仍旧文」的中间态（UI 会停在旧正文）：${JSON.stringify(bad)}`,
    ).toEqual([])
  })

  it('A13-② 反例（断言非空）：恢复内容确实与恢复前不同 —— 未重载时界面会停在旧正文', async () => {
    // 该用例固定「恢复前界面内容 ≠ 恢复内容」这一前提，证明 A13-① 的 ③ 断言有判别力
    expect(CS.recovered).toContain('恢复校验正文甲乙')
    expect(CS.editorProps.every((p) => !String(p.content ?? '').includes('恢复校验正文甲乙'))).toBe(true)
  })
})
