/**
 * 独立对抗验证：F-S1-2 修复的「切档缝」—— task-18（验证者所有）。
 *
 * 背景（Lead 复核 + 验证员亲读源码确认，HEAD `f1ced76` 的 `EditorArea.tsx`）：
 *  - `:111` `useEffect(() => { articleRef.current = article }, [article])` 声明更早，
 *    每次 commit 先跑 → 切档时 `articleRef.current` 已是**新文档**；
 *  - `:369` `if (editor && articleRef.current?.id === prevId)` → **恒假** → `contentSnapshotRef` 从未写入；
 *  - `:376` `flushPending(prevId)` 的 saveFn 取不到快照 → `:267-268` 直接 return → 旧文档最后 <3s 编辑静默丢弃。
 *
 * 本文件按 **task-17 §要求 2 的接口契约**编写（不依赖实现细节）：
 *  - `onDocumentSwitch({ editorDocId, prevId, newId, editorMarkdown, snapshots, flushPending, cancelDraftTimer })`
 *  - `resolveSaveContent({ docId, currentDocId, editorMarkdown, snapshots }) => string | null`
 * 判据来源：task-17/18 的验收条目 + 验证员独立推导的补充攻击面（判别性自检、矩阵串写、
 * 顺序事件记录、边界条件、驱逐归属核对）。
 *
 * ⚠️ 源码就绪前（`state/docSwitch.ts` 不存在）整组 `skipIf` 跳过：
 * 这样不会让他人的 `npx vitest run` 因缺少模块而收集失败，也不会产生假红。
 * 源码落地后无需改动本文件即可自动转为真实执行。
 *
 * task-20 追加（G/H 组）：把 task-18 证实 F-S1-4 的 `[DS6]/[DS7]` 构造固化为**组件级回归**
 * （真实 EditorArea + 真实 docSwitch/saveQueue/draftDebounce，仅 mock 编辑器门面/重组件/settings/fetch；
 * 本文件是 `.ts`，故用 `React.createElement` 而非 JSX）。
 * - G 组（3 例）在 task-19 冻结前由 `F_S1_4_LANDED=false` gate 为 skip：既不阻塞他人全量 vitest、
 *   也不写「恒真」空断言；冻结后由验证员翻 true（届时全量 skip 数回落到 1）。
 * - H 组（3 例）为常态回归（F-S1-2/登记不减少/无副作用边界），始终执行。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditorArea from '../components/layout/EditorArea'
import type { ArticleMeta } from '../types'
import { cancelPending, flushPendingAll } from './saveQueue'

// ===========================================================================
// F-S1-4 组件级轨（task-20）：把 task-18 的 out-of-tree 构造（[DS6]/[DS7]）
// 固化进仓库，长期随全量 vitest 运行。
// 真实 EditorArea + 真实 docSwitch/saveQueue/draftDebounce；
// 仅 mock 编辑器门面、三个重组件、settings 与全局 fetch。
// ===========================================================================
const CS = vi.hoisted(() => ({
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  md: '',
  onUpdate: null as null | (() => void),
  autosaveMs: 60000,
}))

vi.mock('@tiptap/react', () => ({
  EditorContext: { Provider: (props: { children?: unknown }) => props.children },
  EditorContent: () => null,
}))
vi.mock('../editor', () => ({
  useKeEditor: (opts: { onUpdate?: () => void }) => {
    CS.onUpdate = opts.onUpdate ?? null
    return {
      getMarkdown: () => CS.md,
      setEditable: () => undefined,
      isEditable: true,
      isFocused: false,
      commands: { focus: () => undefined, setContent: () => undefined, command: () => undefined },
    }
  },
  setKeContent: (_ed: unknown, md: string) => { CS.md = md },
}))
vi.mock('../settings', () => ({ getAutosaveIntervalMs: () => CS.autosaveMs }))
vi.mock('../components/editor/EditorToolbar', () => ({ default: () => null }))
vi.mock('../components/editor/TableBubbleMenu', () => ({ default: () => null }))
vi.mock('../components/editor/MathEditorModal', () => ({ default: () => null }))
vi.mock('../components/editor/nodeviews/MathNodeView', () => ({ MATH_EDIT_EVENT: 'ke:math-edit' }))

/** 组件级轨是否已可断言「修复后行为」：task-19 冻结后由验证员在第二段翻为 true。 */
const F_S1_4_LANDED = true // task-19 冻结（EditorArea 6e71d969 / docSwitch bb7bf912）→ G/I 组转实跑

let csRoot: Root | null = null
let csContainer: HTMLDivElement | null = null

function csArticle(id: string, content: string): ArticleMeta {
  return { id, path: id, title: id, content, tags: [], word_count: 1, updated_at: '2026-01-01T00:00:00Z' }
}

function csJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

function csInstallFetch() {
  const stub = async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined } catch { body = undefined }
    CS.requests.push({ method, url, body })
    if (method === 'DELETE') return csJsonResponse(undefined, 204)
    return csJsonResponse({ id: 'x', path: 'x', title: 'x', content: (body as { content?: string })?.content ?? '', tags: [], meta: {}, word_count: 0, updated_at: '' })
  }
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(stub)
}

async function csRender(article: ArticleMeta, reloadToken = 0) {
  await act(async () => {
    csRoot!.render(React.createElement(EditorArea, {
      article, loading: false, reloadToken, onNewArticle: () => undefined,
    }))
  })
}
async function csType(md: string) {
  CS.md = md
  await act(async () => { CS.onUpdate?.() })
}
async function csAdvance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
const csPuts = () => CS.requests.filter((r) => r.method === 'PUT' && r.url.includes('/api/articles/'))
const csRecovery = () => CS.requests.filter(
  (r) => r.method === 'POST' && r.url.includes('/api/drafts/recovery'),
) as Array<{ method: string; url: string; body: { doc_path?: string; content?: string } }>

beforeEach(() => {
  CS.requests = []
  CS.md = ''
  CS.onUpdate = null
  CS.autosaveMs = 60000 // 隔离自动保存：组件轨只观察「切档/登记」时序
  csInstallFetch()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.setSystemTime(0)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  csContainer = document.createElement('div')
  document.body.appendChild(csContainer)
  csRoot = createRoot(csContainer)
})

afterEach(async () => {
  try { vi.useRealTimers() } catch { /* ignore */ }
  await act(async () => { csRoot?.unmount() })
  await Promise.race([flushPendingAll().catch(() => undefined), new Promise((r) => setTimeout(r, 300))])
  cancelPending('Articles/a.md')
  cancelPending('Articles/b.md')
  cancelPending('Articles/c.md')
  csContainer?.remove()
  csRoot = null
  csContainer = null
})

/** 恢复点登记的配对不变量：每条登记的 doc_path 必须与其内容同源。 */
function csAssertPairing() {
  const markers: Record<string, string> = {
    'Articles/a.md': 'A-BODY',
    'Articles/b.md': 'B-BODY',
    'Articles/c.md': 'C-BODY',
  }
  for (const req of csRecovery()) {
    const doc = String(req.body?.doc_path ?? '')
    const content = String(req.body?.content ?? '')
    const foreign = Object.entries(markers)
      .filter(([id]) => id !== doc)
      .filter(([, mk]) => content.includes(mk))
      .map(([id]) => id)
    expect(foreign, `登记 ${doc} 的内容混入了 ${foreign.join(',')} 的正文（跨文档污染）`).toEqual([])
  }
}

// ===========================================================================
// G. F-S1-4 回归（过期 timeout / 恢复点配对）—— task-19 冻结前保持 skip
// ===========================================================================
describe.skipIf(!F_S1_4_LANDED)('G F-S1-4 回归：过期 timeout 不再改动编辑器/UI', () => {
  it('G1 [DS6 回归] A→B(>200KB 载入中)→C：80ms 到点后编辑器仍是 C，且 C 最终正常载入', async () => {
    const bigB = 'B-BODY-' + 'x'.repeat(200_100)
    await csRender(csArticle('Articles/a.md', '# A-disk'))
    await csRender(csArticle('Articles/b.md', bigB))   // 大文档 → 80ms 延迟分支
    await csAdvance(10)                                // 未到 80ms
    await csRender(csArticle('Articles/c.md', '# C-disk'))
    expect(CS.md, '切到 C 后编辑器应为 C 的内容').toBe('# C-disk')
    await csAdvance(200)                               // 过期 timeout 本应在此触发
    expect(CS.md, '过期 timeout 不得再把编辑器换成 B 的正文').toBe('# C-disk')
    expect(CS.md.startsWith('B-BODY-'), '编辑器被旧 timeout 覆盖（既有缺陷复现）').toBe(false)
    // UI 状态：不得停在「正在解析大文档…」占位（parsingLarge 未被旧 timeout 改动/未漏清）
    expect(document.body.textContent ?? '').not.toContain('正在解析大文档')
  })

  it('G2 [DS7 回归] 同序列 + 编辑 + 计时推进：不得出现「C 的名义 + B 的正文」登记', async () => {
    const bigB = 'B-BODY-' + 'x'.repeat(200_100)
    await csRender(csArticle('Articles/a.md', '# A-disk'))
    await csRender(csArticle('Articles/b.md', bigB))
    await csAdvance(10)
    await csRender(csArticle('Articles/c.md', '# C-disk'))
    await csAdvance(200)
    CS.requests = []
    await csType('# C-BODY-用户输入')       // 当前文档 C、编辑器载 C
    await csAdvance(3000)                    // S-1 有界年龄到点 → 应登记 C
    await csAdvance(70000)                   // 越过 autosave 防抖
    csAssertPairing()
    const cRec = csRecovery().filter((r) => r.body?.doc_path === 'Articles/c.md')
    expect(cRec.length, '破坏态下 C 的登记不得带 B 的内容；本序列修复后应登记 C 且内容同源').toBeGreaterThan(0)
    expect(String(cRec[0].body?.content ?? '')).toContain('C-BODY-用户输入')
    expect(String(cRec[0].body?.content ?? '')).not.toContain('B-BODY-')
  })

  it('G4 配对不变量矩阵（组件观测级）：多场景下每条登记 id 与内容同源', async () => {
    // 场景 1：正常编辑 → 3s 登记
    await csRender(csArticle('Articles/a.md', '# A-disk'))
    await csType('# A-BODY-1')
    await csAdvance(3000)
    csAssertPairing()
    // 场景 2：编辑 A → 切 B → 3s（切档完成，编辑器载 B）
    await csType('# A-BODY-2')
    await csRender(csArticle('Articles/b.md', '# B-disk'))
    await csType('# B-BODY-1')
    await csAdvance(3000)
    csAssertPairing()
    // 场景 3：编辑 B → 切 C(大文档，载入中)→ 3s（既有错配窗口）
    await csType('# B-BODY-2')
    await csRender(csArticle('Articles/c.md', 'C-BODY-' + 'y'.repeat(200_100)))
    await csAdvance(3000)
    csAssertPairing()
    // 场景 4：同档 reloadToken + 编辑 → 3s
    await csRender(csArticle('Articles/c.md', 'C-BODY-' + 'y'.repeat(200_100)), 1)
    await csType('# C-BODY-2')
    await csAdvance(3000)
    csAssertPairing()
    // 正常态反向断言：至少登记过 A/B/C 各一次（不得为安全而静默不登记）
    const docs = new Set(csRecovery().map((r) => String(r.body?.doc_path ?? '')))
    expect(docs.has('Articles/a.md'), '正常态 A 必须被登记（S-1 语义不得回退）').toBe(true)
    expect(docs.has('Articles/b.md'), '正常态 B 必须被登记').toBe(true)
    expect(docs.has('Articles/c.md'), '正常态 C 必须被登记').toBe(true)
  })
})

describe('H 组件级常态回归（当前实现即应通过；F-S1-4 修复后必须仍通过）', () => {
  it('H1 正常登记不减少：连续编辑 + 有界年龄 → 每个 3s 窗口登记一次且 payload 属当前文档', async () => {
    await csRender(csArticle('Articles/a.md', '# A-disk'))
    await csType('# A-BODY-1')
    await csAdvance(2999)
    expect(csRecovery().length, '未到 3s 不得登记').toBe(0)
    await csAdvance(1)
    expect(csRecovery().length, '3s 到点必须登记一次（S-1 有界年龄）').toBe(1)
    expect(csRecovery()[0].body?.doc_path).toBe('Articles/a.md')
    expect(String(csRecovery()[0].body?.content ?? '')).toContain('A-BODY-1')
    await csType('# A-BODY-2')
    await csAdvance(3000)
    expect(csRecovery().length, '第二窗口继续登记（不因实现变更而减少）').toBe(2)
    expect(String(csRecovery()[1].body?.content ?? '')).toContain('A-BODY-2')
    csAssertPairing()
  })

  it('H2 切档 F-S1-2 语义不回归：A 编辑 → 切 B，A 的编辑落到 A 的路径', async () => {
    await csRender(csArticle('Articles/a.md', '# A-disk'))
    await csType('# A-BODY-切档前')
    await csRender(csArticle('Articles/b.md', '# B-disk'))
    await csAdvance(5000)
    const aPuts = csPuts().filter((r) => decodeURIComponent(r.url).includes('Articles/a.md'))
    expect(aPuts.length, 'A 的未决编辑必须落盘（F-S1-2）').toBeGreaterThan(0)
    const payload = String((aPuts[0].body as { content?: string })?.content ?? '')
    expect(payload).toContain('A-BODY-切档前')
    expect(payload).not.toContain('B-BODY')
  })

  it('H3 无副作用边界：首挂载 / 同档 reloadToken / 无编辑切档 → 零 PUT', async () => {
    await csRender(csArticle('Articles/a.md', '# A-disk'))
    await csAdvance(1000)
    expect(csPuts().length, '首挂载不应产生 PUT').toBe(0)
    await csRender(csArticle('Articles/a.md', '# A-disk'), 1)
    await csAdvance(1000)
    expect(csPuts().length, '同档 reloadToken 不应产生 PUT').toBe(0)
    await csRender(csArticle('Articles/b.md', '# B-disk'))
    await csAdvance(5000)
    expect(csPuts().length, '无未决编辑的切档不应产生 PUT').toBe(0)
    csAssertPairing()
  })
})

// 变量化 specifier：避免源码就绪前 TS2307 / Vite 静态解析失败
const MODULE_SPECIFIER = './docSwitch'

/** vite/vitest 下 import.meta.url 可能是 http://localhost/… → 退回 cwd 解析。 */
function docSwitchPath(): string {
  const url = import.meta.url
  if (url.startsWith('file:')) return fileURLToPath(new URL('./docSwitch.ts', url))
  return resolve(process.cwd(), 'src/state/docSwitch.ts')
}
const MODULE_READY = existsSync(docSwitchPath())

type Snapshots = Map<string, string>

interface ResolveArgs {
  docId: string
  currentDocId: string | null
  editorMarkdown: string
  snapshots: Snapshots
}

interface SwitchArgs {
  editorDocId: string | null
  prevId: string | null
  newId: string | null
  editorMarkdown: string
  snapshots: Snapshots
  flushPending: (docId: string) => void
  cancelDraftTimer: () => void
}

interface DocSwitchModule {
  resolveSaveContent: (args: ResolveArgs) => string | null
  onDocumentSwitch: (args: SwitchArgs) => void
}

async function seam(): Promise<DocSwitchModule> {
  const mod = (await import(MODULE_SPECIFIER)) as Record<string, unknown>
  const resolve = mod.resolveSaveContent
  const onSwitch = mod.onDocumentSwitch
  expect(typeof resolve, 'docSwitch.resolveSaveContent 必须是函数（接口契约）').toBe('function')
  expect(typeof onSwitch, 'docSwitch.onDocumentSwitch 必须是函数（接口契约）').toBe('function')
  return { resolveSaveContent: resolve as DocSwitchModule['resolveSaveContent'], onDocumentSwitch: onSwitch as DocSwitchModule['onDocumentSwitch'] }
}

/** 事件记录器：用于断言调用顺序与「flush 时快照已就绪」。 */
function recorder(snapshots: Snapshots) {
  const events: string[] = []
  const flushCalls: Array<{ docId: string; sawSnapshot: string | undefined }> = []
  const args = {
    snapshots,
    flushPending: (docId: string) => {
      events.push(`flush:${docId}`)
      flushCalls.push({ docId, sawSnapshot: snapshots.get(docId) })
    },
    cancelDraftTimer: () => {
      events.push('cancelDraftTimer')
    },
  }
  return { events, flushCalls, args }
}

// ---------------------------------------------------------------------------
// A. 判别性 / 非空性（最高优先）：旧恒假判据 vs 新语义必须可区分
// ---------------------------------------------------------------------------
describe.skipIf(!MODULE_READY)('A 判别性：旧恒假判据 vs 新语义（可区分性自检）', () => {
  it('A1 旧语义（articleRef 已指向新文档）→ 不拍快照 → resolveSaveContent 返回 null（保存被放弃）', async () => {
    const { resolveSaveContent } = await seam()
    const prevId: string = 'Articles/A.md'
    const newId: string = 'Articles/B.md'
    const snapshots: Snapshots = new Map()

    // 旧判据：articleRef.current.id === prevId；切档时 articleRef 已是 B → false
    const legacyGuard = newId === prevId // false（这就是旧实现恒假的来源）
    if (legacyGuard) snapshots.set(prevId, 'A-BODY')

    expect(snapshots.size, '旧语义下不应产生快照（前置）').toBe(0)
    const legacyResult = resolveSaveContent({
      docId: prevId, currentDocId: newId, editorMarkdown: 'B-BODY', snapshots,
    })
    expect(legacyResult, '旧语义下 A 的保存必须被放弃（null）').toBeNull()
  })

  it('A2 新语义（editorDocId === prevId）→ 拍到 A 的内容 → A 的保存拿到 A 内容', async () => {
    const { resolveSaveContent, onDocumentSwitch } = await seam()
    const prevId: string = 'Articles/A.md'
    const newId: string = 'Articles/B.md'
    const snapshots: Snapshots = new Map()
    const rec = recorder(snapshots)

    onDocumentSwitch({
      editorDocId: prevId,           // 编辑器此刻仍载着 A（新判据）
      prevId, newId,
      editorMarkdown: 'A-BODY',
      snapshots,
      flushPending: rec.args.flushPending,
      cancelDraftTimer: rec.args.cancelDraftTimer,
    })

    expect(snapshots.get(prevId), '新语义必须为 A 拍到快照').toBe('A-BODY')
    const result = resolveSaveContent({
      docId: prevId, currentDocId: newId, editorMarkdown: 'B-BODY', snapshots,
    })
    expect(result, 'A 的保存必须用 A 的内容').toBe('A-BODY')
  })

  it('A3 判别性自检：同一组输入下旧语义结果 ≠ 新语义结果（两边等价 → 测试是空的 → FAIL）', async () => {
    const { resolveSaveContent, onDocumentSwitch } = await seam()
    const prevId: string = 'Articles/A.md'
    const newId: string = 'Articles/B.md'

    const legacySnapshots: Snapshots = new Map()
    if (newId === prevId) legacySnapshots.set(prevId, 'A-BODY')
    const legacy = resolveSaveContent({
      docId: prevId, currentDocId: newId, editorMarkdown: 'B-BODY', snapshots: legacySnapshots,
    })

    const newSnapshots: Snapshots = new Map()
    const rec = recorder(newSnapshots)
    onDocumentSwitch({
      editorDocId: prevId, prevId, newId, editorMarkdown: 'A-BODY',
      snapshots: newSnapshots,
      flushPending: rec.args.flushPending,
      cancelDraftTimer: rec.args.cancelDraftTimer,
    })
    const neu = resolveSaveContent({
      docId: prevId, currentDocId: newId, editorMarkdown: 'B-BODY', snapshots: newSnapshots,
    })

    expect(legacy, '旧语义必须被放弃').toBeNull()
    expect(neu, '新语义必须成功').toBe('A-BODY')
    expect(neu === legacy, '旧/新语义不可区分 → 本测试无效（FAIL）').toBe(false)
  })
})

// ---------------------------------------------------------------------------
// B. 串写不变量（F14 原意）：docId ≠ currentDocId 时绝不用当前编辑器内容
// ---------------------------------------------------------------------------
describe.skipIf(!MODULE_READY)('B 串写不变量：路径与内容一一对应', () => {
  it('B1 矩阵：docId ∈ {A,B} × currentDocId ∈ {A,B} × 快照 ∈ {∅,{A},{B}}', async () => {
    const { resolveSaveContent } = await seam()
    const A = 'Articles/A.md'
    const B = 'Articles/B.md'
    const cases: Array<{ docId: string; currentDocId: string; snaps: Snapshots; expect: string | null }> = []
    for (const docId of [A, B]) {
      for (const currentDocId of [A, B]) {
        for (const snap of [new Map(), new Map([[A, 'SNAP-A']]), new Map([[B, 'SNAP-B']])] as Snapshots[]) {
          const hasSnap = snap.has(docId)
          const expected = docId === currentDocId ? 'EDITOR-BODY' : (hasSnap ? snap.get(docId)! : null)
          cases.push({ docId, currentDocId, snaps: snap, expect: expected })
        }
      }
    }
    for (const c of cases) {
      const got = resolveSaveContent({
        docId: c.docId, currentDocId: c.currentDocId, editorMarkdown: 'EDITOR-BODY', snapshots: c.snaps,
      })
      expect(got, `docId=${c.docId} current=${c.currentDocId} snaps=${[...c.snaps.keys()]}`).toBe(c.expect)
      if (c.docId !== c.currentDocId) {
        expect(got, 'docId≠currentDocId 时绝不能返回当前编辑器内容（串写）').not.toBe('EDITOR-BODY')
      }
    }
  })

  it('B2 A→B→A 快速切换：每次写盘的 (docId, payload) 一一对应', async () => {
    const { resolveSaveContent, onDocumentSwitch } = await seam()
    const A = 'Articles/A.md'
    const B = 'Articles/B.md'
    const snapshots: Snapshots = new Map()
    const writes: Array<{ docId: string; payload: string | null }> = []
    const rec = recorder(snapshots)
    const flushPending = (docId: string) => {
      rec.args.flushPending(docId)
      writes.push({
        docId,
        payload: resolveSaveContent({ docId, currentDocId: null, editorMarkdown: '<当前编辑器>', snapshots }),
      })
    }

    // A 编辑中 → 切到 B（编辑器仍载 A）
    onDocumentSwitch({ editorDocId: A, prevId: A, newId: B, editorMarkdown: 'A-BODY', snapshots, flushPending, cancelDraftTimer: rec.args.cancelDraftTimer })
    // B 编辑中 → 切回 A（编辑器仍载 B）
    onDocumentSwitch({ editorDocId: B, prevId: B, newId: A, editorMarkdown: 'B-BODY', snapshots, flushPending, cancelDraftTimer: rec.args.cancelDraftTimer })
    // A 再次编辑 → 切到 B（编辑器载 A）
    onDocumentSwitch({ editorDocId: A, prevId: A, newId: B, editorMarkdown: 'A-BODY-2', snapshots, flushPending, cancelDraftTimer: rec.args.cancelDraftTimer })

    expect(writes).toEqual([
      { docId: A, payload: 'A-BODY' },
      { docId: B, payload: 'B-BODY' },
      { docId: A, payload: 'A-BODY-2' },
    ])
  })

  it('B3 连续切 3 篇 A→B→C：三次 flush 各用各自快照', async () => {
    const { resolveSaveContent, onDocumentSwitch } = await seam()
    const snapshots: Snapshots = new Map()
    const writes: Array<{ docId: string; payload: string | null }> = []
    const rec = recorder(snapshots)
    const flushPending = (docId: string) => {
      writes.push({ docId, payload: resolveSaveContent({ docId, currentDocId: null, editorMarkdown: '<当前编辑器>', snapshots }) })
    }
    const seq: Array<[string, string]> = [
      ['Articles/a.md', 'Articles/b.md'],
      ['Articles/b.md', 'Articles/c.md'],
      ['Articles/c.md', 'Articles/d.md'],
    ]
    for (const [prevId, newId] of seq) {
      onDocumentSwitch({
        editorDocId: prevId, prevId, newId, editorMarkdown: `BODY-${prevId}`, snapshots,
        flushPending, cancelDraftTimer: rec.args.cancelDraftTimer,
      })
    }
    expect(writes).toEqual([
      { docId: 'Articles/a.md', payload: 'BODY-Articles/a.md' },
      { docId: 'Articles/b.md', payload: 'BODY-Articles/b.md' },
      { docId: 'Articles/c.md', payload: 'BODY-Articles/c.md' },
    ])
  })

  it('B4 无快照 + 非当前文档 → null（绝不串写）；有旧快照 → 用旧快照', async () => {
    const { resolveSaveContent } = await seam()
    const got = resolveSaveContent({
      docId: 'Articles/A.md', currentDocId: 'Articles/B.md', editorMarkdown: 'B-BODY', snapshots: new Map(),
    })
    expect(got).toBeNull()
    expect(got).not.toBe('B-BODY')

    const got2 = resolveSaveContent({
      docId: 'Articles/A.md', currentDocId: 'Articles/B.md', editorMarkdown: 'B-BODY',
      snapshots: new Map([['Articles/A.md', 'OLD-A-SNAP']]),
    })
    expect(got2).toBe('OLD-A-SNAP')
    expect(got2).not.toBe('B-BODY')
  })
})

// ---------------------------------------------------------------------------
// C. 顺序不变量：快照 → flush → cancelDraftTimer
// ---------------------------------------------------------------------------
describe.skipIf(!MODULE_READY)('C 顺序不变量', () => {
  it('C1 事件顺序必须为 [snapshot(写入快照), flush:prevId, cancelDraftTimer]', async () => {
    const { onDocumentSwitch } = await seam()
    const prevId = 'Articles/A.md'
    const snapshots: Snapshots = new Map()
    const events: string[] = []
    const rec = recorder(snapshots)
    const flushPending = (docId: string) => { events.push(`flush:${docId}`); rec.args.flushPending(docId) }
    const cancelDraftTimer = () => { events.push('cancelDraftTimer'); rec.args.cancelDraftTimer() }

    onDocumentSwitch({
      editorDocId: prevId, prevId, newId: 'Articles/B.md', editorMarkdown: 'A-BODY',
      snapshots, flushPending, cancelDraftTimer,
    })
    // 快照是「写入 snapshots」这一事实，用 flush 时刻的可见性校验（C2）；此处校验 flush 与 cancel 的相对序
    expect(events).toEqual([`flush:${prevId}`, 'cancelDraftTimer'])
  })

  it('C2 flush 被调用时，prevId 的快照必须已写入（顺序颠倒即暴露）', async () => {
    const { onDocumentSwitch } = await seam()
    const prevId = 'Articles/A.md'
    const snapshots: Snapshots = new Map()
    const seenAtFlush: Array<string | undefined> = []
    const rec = recorder(snapshots)
    const order: string[] = []

    onDocumentSwitch({
      editorDocId: prevId, prevId, newId: 'Articles/B.md', editorMarkdown: 'A-BODY',
      snapshots,
      flushPending: (docId) => {
        order.push('flush')
        seenAtFlush.push(snapshots.get(prevId))
        rec.args.flushPending(docId)
      },
      cancelDraftTimer: () => { order.push('cancel'); rec.args.cancelDraftTimer() },
    })

    expect(seenAtFlush, 'flush 时快照必须已就绪（快照必须在 flush 之前）').toEqual(['A-BODY'])
    expect(order, 'cancelDraftTimer 必须在 flush 之后（S-1 语义）').toEqual(['flush', 'cancel'])
  })

  it('C3 cancelDraftTimer 在 flush 之后：flush 回调内 cancel 尚未发生', async () => {
    const { onDocumentSwitch } = await seam()
    const prevId = 'Articles/A.md'
    const snapshots: Snapshots = new Map()
    let cancelled = false
    let cancelSeenDuringFlush: boolean | null = null
    const rec = recorder(snapshots)

    onDocumentSwitch({
      editorDocId: prevId, prevId, newId: 'Articles/B.md', editorMarkdown: 'A-BODY',
      snapshots,
      flushPending: (docId) => {
        cancelSeenDuringFlush = cancelled
        rec.args.flushPending(docId)
      },
      cancelDraftTimer: () => { cancelled = true; rec.args.cancelDraftTimer() },
    })
    expect(cancelSeenDuringFlush, 'flush 期间不得已 cancel（顺序颠倒）').toBe(false)
    expect(cancelled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// D. 不拍快照的条件：prevId=null / prevId===newId / 编辑器未载 prevId
// ---------------------------------------------------------------------------
describe.skipIf(!MODULE_READY)('D 不拍快照的边界条件', () => {
  it('D1 prevId=null（首挂载）→ 不写快照、不 flush、不 cancel', async () => {
    const { onDocumentSwitch } = await seam()
    const snapshots: Snapshots = new Map()
    const calls: string[] = []
    onDocumentSwitch({
      editorDocId: null, prevId: null, newId: 'Articles/A.md', editorMarkdown: '',
      snapshots,
      flushPending: (d) => calls.push(`flush:${d}`),
      cancelDraftTimer: () => calls.push('cancel'),
    })
    expect(snapshots.size).toBe(0)
    expect(calls).toEqual([])
  })

  it('D2 prevId === newId（同档 reloadToken 重载）→ 不拍、不 flush、不 cancel', async () => {
    const { onDocumentSwitch } = await seam()
    const doc = 'Articles/A.md'
    const snapshots: Snapshots = new Map()
    const calls: string[] = []
    onDocumentSwitch({
      editorDocId: doc, prevId: doc, newId: doc, editorMarkdown: 'A-BODY',
      snapshots,
      flushPending: (d) => calls.push(`flush:${d}`),
      cancelDraftTimer: () => calls.push('cancel'),
    })
    expect(snapshots.size, 'prevId===newId 不得拍快照').toBe(0)
    expect(calls, 'prevId===newId 不得 flush/cancel').toEqual([])
  })

  it('D3 editorDocId ≠ prevId（编辑器未载 prevId，如外部重载路径）→ 不拍快照；且绝不串写', async () => {
    const { resolveSaveContent, onDocumentSwitch } = await seam()
    const prevId: string = 'Articles/A.md'
    const newId: string = 'Articles/B.md'
    const snapshots: Snapshots = new Map()
    const rec = recorder(snapshots)
    let flushDocs: string[] = []
    onDocumentSwitch({
      editorDocId: newId,        // 编辑器已载 B（不是 prevId）
      prevId, newId, editorMarkdown: 'B-BODY', snapshots,
      flushPending: (d) => { flushDocs.push(d); rec.args.flushPending(d) },
      cancelDraftTimer: rec.args.cancelDraftTimer,
    })
    expect(snapshots.size, '编辑器未载 prevId 时不得拍快照').toBe(0)
    // 若实现仍 flush prevId，则其取内容时不得拿到当前编辑器内容
    if (flushDocs.includes(prevId)) {
      const got = resolveSaveContent({ docId: prevId, currentDocId: newId, editorMarkdown: 'B-BODY', snapshots })
      expect(got).not.toBe('B-BODY')
      expect(got).toBeNull()
    }
  })

  it('D4 首挂载 prevId=null 但后续切档 → 第二次起才拍快照', async () => {
    const { onDocumentSwitch } = await seam()
    const snapshots: Snapshots = new Map()
    const rec = recorder(snapshots)
    onDocumentSwitch({ editorDocId: null, prevId: null, newId: 'Articles/A.md', editorMarkdown: '', snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer })
    expect(snapshots.size).toBe(0)
    onDocumentSwitch({ editorDocId: 'Articles/A.md', prevId: 'Articles/A.md', newId: 'Articles/B.md', editorMarkdown: 'A-BODY', snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer })
    expect(snapshots.get('Articles/A.md')).toBe('A-BODY')
  })
})

// ---------------------------------------------------------------------------
// E. 快照容积（>16 驱逐最旧；LRU 刷新）—— 实现归属已核对：由 docSwitch 承担
// ---------------------------------------------------------------------------
describe.skipIf(!MODULE_READY)('E 快照容积上限', () => {
  it('E1 连续 17 次切档：容积 ≤16 且最旧被驱逐、最新保留', async () => {
    const { onDocumentSwitch } = await seam()
    const snapshots: Snapshots = new Map()
    const rec = recorder(snapshots)
    for (let i = 0; i < 17; i++) {
      const prev = `Articles/d${String(i).padStart(2, '0')}.md`
      const next = `Articles/d${String(i + 1).padStart(2, '0')}.md`
      onDocumentSwitch({
        editorDocId: prev, prevId: prev, newId: next, editorMarkdown: `BODY-${i}`,
        snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer,
      })
    }
    expect(snapshots.size, `快照表无界增长（size=${snapshots.size}）`).toBeLessThanOrEqual(16)
    expect(snapshots.has('Articles/d00.md'), '超过上限时应驱逐最旧快照').toBe(false)
    expect(snapshots.has('Articles/d16.md'), '最新快照必须保留').toBe(true)
  })

  it('E2 LRU 刷新：再次离开同一文档时，其快照不应被当成最旧驱逐', async () => {
    const { onDocumentSwitch } = await seam()
    const snapshots: Snapshots = new Map()
    const rec = recorder(snapshots)
    const key = (i: number) => `Articles/l${String(i).padStart(2, '0')}.md`
    for (let i = 0; i < 16; i++) {
      onDocumentSwitch({
        editorDocId: key(i), prevId: key(i), newId: key(i + 1), editorMarkdown: `B-${i}`,
        snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer,
      })
    }
    expect(snapshots.size).toBe(16)
    // 再次离开 l00（刷新其新鲜度，内容更新为 B-0-NEW）
    onDocumentSwitch({
      editorDocId: key(0), prevId: key(0), newId: 'Articles/other.md', editorMarkdown: 'B-0-NEW',
      snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer,
    })
    // 新增一条触发驱逐：被驱逐的应是 l01（最旧），而非刚刷新的 l00
    onDocumentSwitch({
      editorDocId: 'Articles/newest.md', prevId: 'Articles/newest.md', newId: 'Articles/x.md',
      editorMarkdown: 'B-NEW', snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer,
    })
    expect(snapshots.size).toBeLessThanOrEqual(16)
    expect(snapshots.get(key(0)), '刷新过的快照内容应为最新值且未被驱逐').toBe('B-0-NEW')
    expect(snapshots.has(key(1)), '驱逐的应是最旧（l01），而非被刷新的 l00').toBe(false)
  })

  it('E3 残余演示：快照被 LRU 驱逐后，对旧 doc 的延迟 flush 会拿到 null（可达性另见报告）', async () => {
    const { resolveSaveContent, onDocumentSwitch } = await seam()
    const X = 'Articles/x-old.md'
    const snapshots: Snapshots = new Map()
    const rec = recorder(snapshots)
    const step = (prev: string, next: string) =>
      onDocumentSwitch({ editorDocId: prev, prevId: prev, newId: next, editorMarkdown: `BODY-${prev}`, snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer })
    step(X, 'Articles/n1.md')
    expect(snapshots.has(X), '前置：X 的快照已存在').toBe(true)
    for (let i = 1; i <= 16; i++) step(`Articles/n${i}.md`, `Articles/n${i + 1}.md`)

    expect(snapshots.has(X), 'X 的快照已被 LRU 驱逐（>16 次切档）').toBe(false)
    const delayed = resolveSaveContent({ docId: X, currentDocId: 'Articles/n17.md', editorMarkdown: 'CUR-BODY', snapshots })
    expect(delayed, '驱逐后延迟 flush 的旧 doc → null（放弃保存）').toBeNull()
    expect(delayed).not.toBe('CUR-BODY')
  })
})

// ---------------------------------------------------------------------------
// F. 接口自检
// ---------------------------------------------------------------------------
describe.skipIf(!MODULE_READY)('F 接口自检', () => {
  it('F1 模块导出两个函数且签名可用（不做多余副作用）', async () => {
    const { resolveSaveContent, onDocumentSwitch } = await seam()
    expect(resolveSaveContent.length).toBeGreaterThanOrEqual(1)
    expect(onDocumentSwitch.length).toBeGreaterThanOrEqual(1)
    const snapshots: Snapshots = new Map()
    const rec = recorder(snapshots)
    onDocumentSwitch({ editorDocId: null, prevId: null, newId: null, editorMarkdown: '', snapshots, flushPending: rec.args.flushPending, cancelDraftTimer: rec.args.cancelDraftTimer })
    expect(rec.events).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// I. F-S1-4 缝级配对矩阵（task-19 §要求 3 的 `resolveRecoveryTarget`）
//    与 G4 的组件观测级矩阵互为交叉验证；冻结前与 G 组一同 gate。
// ---------------------------------------------------------------------------
interface RecoveryParams {
  editorDocId: string | null
  articleDocId: string | null
  editorMarkdown: string | null
}
interface RecoveryTarget {
  docId: string
  md: string
}

async function recoverySeam(): Promise<(p: RecoveryParams) => RecoveryTarget | null> {
  const mod = (await import(MODULE_SPECIFIER)) as Record<string, unknown>
  const fn = mod.resolveRecoveryTarget
  expect(typeof fn, 'docSwitch.resolveRecoveryTarget 必须是函数（F-S1-4 缝契约）').toBe('function')
  return fn as (p: RecoveryParams) => RecoveryTarget | null
}

describe.skipIf(!MODULE_READY || !F_S1_4_LANDED)('I F-S1-4 缝级配对矩阵：id 与内容永远同源', () => {
  it('I1 矩阵：editorDocId × articleDocId × 有/无内容（18 组）→ 永不产出「articleDocId + 编辑器内容」', async () => {
    const resolve = await recoverySeam()
    const ids: Array<string | null> = [null, 'Articles/A.md', 'Articles/B.md']
    const contents: Array<string | null> = [null, 'MD-EDITOR']
    let checked = 0
    for (const editorDocId of ids) {
      for (const articleDocId of ids) {
        for (const md of contents) {
          const got = resolve({ editorDocId, articleDocId, editorMarkdown: md })
          checked++
          const label = `editor=${editorDocId} article=${articleDocId} md=${md}`
          if (editorDocId === null || md === null) {
            expect(got, `${label} 应放弃登记（null）`).toBeNull()
            continue
          }
          expect(got, label).toEqual({ docId: editorDocId, md })
          if (editorDocId !== articleDocId) {
            // 错配窗口：绝不把内容挂到 articleDocId 名下
            expect(got!.docId, `${label} 登记到了 articleDocId（错配）`).not.toBe(articleDocId)
          }
        }
      }
    }
    expect(checked, '矩阵完整性（3×3×2）').toBe(18)
  })

  it('I2 判别性：修复前组合（articleDocId + 编辑器内容）与新实现可区分（非空测试）', async () => {
    const resolve = await recoverySeam()
    const editorDocId = 'Articles/B.md'   // 编辑器此刻仍载 B
    const articleDocId = 'Articles/C.md'  // articleRef 已指向 C（既有错配窗口）
    const md = 'B-BODY'
    const legacy = { docId: articleDocId, md } // 修复前：articleRef 的 id + 编辑器内容
    const neu = resolve({ editorDocId, articleDocId, editorMarkdown: md })
    expect(neu).toEqual({ docId: 'Articles/B.md', md: 'B-BODY' })
    expect(neu!.docId === legacy.docId, '旧/新组合不可区分 → 测试是空的（FAIL）').toBe(false)
  })

  it('I3 错配窗口仍登记（同源）；未载入才放弃 —— 不得为安全而静默不登记', async () => {
    const resolve = await recoverySeam()
    expect(resolve({ editorDocId: 'Articles/A.md', articleDocId: 'Articles/B.md', editorMarkdown: 'A-EDIT' }),
      '切档中：按编辑器实际载入的 A 登记（内容同源）').toEqual({ docId: 'Articles/A.md', md: 'A-EDIT' })
    expect(resolve({ editorDocId: 'Articles/A.md', articleDocId: 'Articles/A.md', editorMarkdown: 'A-EDIT' }),
      '正常态：照旧登记').toEqual({ docId: 'Articles/A.md', md: 'A-EDIT' })
    expect(resolve({ editorDocId: null, articleDocId: 'Articles/A.md', editorMarkdown: null }),
      '编辑器未载入任何文档 → 放弃').toBeNull()
    expect(resolve({ editorDocId: 'Articles/A.md', articleDocId: 'Articles/A.md', editorMarkdown: null }),
      '内容不可用 → 放弃').toBeNull()
  })
})

// ---------------------------------------------------------------------------
// J. F-S1-4① 缝级：createDeferredLoader 的代次/定时器语义（lead 指定四类）
// ---------------------------------------------------------------------------
interface DeferredTimersLike {
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}
interface DeferredLoaderLike {
  schedule: (apply: () => void) => void
  cancel: () => void
  generation: () => number
}

/** 手工定时器队列：可精确控制「回调是否真的被清掉 / 是否仍会到点」。 */
function manualTimers(opts: { reallyClear?: boolean } = {}) {
  const queue = new Map<number, () => void>()
  const cleared: number[] = []
  const delays: number[] = []
  let nextId = 1
  const timers: DeferredTimersLike = {
    setTimeout(fn, ms) {
      const id = nextId++
      delays.push(ms)
      queue.set(id, fn)
      return id
    },
    clearTimeout(id) {
      cleared.push(id)
      if (opts.reallyClear !== false) queue.delete(id)
    },
  }
  /** 执行全部**仍留在队列**的回调（模拟「已入队 → 到点」）。 */
  const fireAll = () => { for (const fn of [...queue.values()]) fn() }
  return { timers, queue, cleared, delays, fireAll }
}

async function deferredSeam() {
  const mod = (await import(MODULE_SPECIFIER)) as Record<string, unknown>
  const create = mod.createDeferredLoader
  expect(typeof create, 'docSwitch.createDeferredLoader 必须是函数（F-S1-4 缝契约）').toBe('function')
  return {
    create: create as (o?: { delayMs?: number; timers?: DeferredTimersLike }) => DeferredLoaderLike,
    defaultDelayMs: mod.DEFERRED_LOAD_MS as number,
  }
}

describe.skipIf(!MODULE_READY)('J F-S1-4① createDeferredLoader 代次语义', () => {
  it('J1 clearTimeout 失效（注入不真清）→ 过期回调靠代次被拦下，绝不动编辑器', async () => {
    const { create } = await deferredSeam()
    const t = manualTimers({ reallyClear: false }) // 故意不真清：回调仍会到点
    const loader = create({ delayMs: 80, timers: t.timers })
    const applied: string[] = []
    loader.schedule(() => applied.push('A'))
    loader.schedule(() => applied.push('B'))
    t.fireAll() // 两个回调都到点（A 本应被 clearTimeout 清掉）
    expect(applied, '只有最新一代可执行（旧代次被守卫拦下）').toEqual(['B'])
  })

  it('J2 cancel 后回调仍到点 → 不得执行（卸载/关档/立即载入分支安全）', async () => {
    const { create } = await deferredSeam()
    const t = manualTimers({ reallyClear: false })
    const loader = create({ delayMs: 80, timers: t.timers })
    const applied: string[] = []
    const genBefore = loader.generation()
    loader.schedule(() => applied.push('X'))
    loader.cancel()
    t.fireAll()
    expect(applied, 'cancel 之后到点的回调必须无效').toEqual([])
    expect(loader.generation(), 'cancel 必须推进代次').toBeGreaterThan(genBefore + 1)
  })

  it('J3 连续 schedule 只有最新生效（恰好一次）', async () => {
    const { create } = await deferredSeam()
    const t = manualTimers({ reallyClear: false })
    const loader = create({ delayMs: 80, timers: t.timers })
    const applied: string[] = []
    loader.schedule(() => applied.push('1'))
    loader.schedule(() => applied.push('2'))
    loader.schedule(() => applied.push('3'))
    t.fireAll()
    expect(applied).toEqual(['3'])
  })

  it('J4 正常路径：delayMs 传给宿主定时器、到点执行一次、代次自增', async () => {
    const { create, defaultDelayMs } = await deferredSeam()
    const t = manualTimers()
    const loader = create({ delayMs: 123, timers: t.timers })
    const genBefore = loader.generation()
    const applied: string[] = []
    loader.schedule(() => applied.push('ok'))
    expect(t.delays, '自定义 delayMs 应传给宿主').toEqual([123])
    t.fireAll()
    expect(applied).toEqual(['ok'])
    expect(loader.generation()).toBe(genBefore + 1)

    const t2 = manualTimers()
    const loader2 = create({ timers: t2.timers })
    loader2.schedule(() => undefined)
    expect(t2.delays, `默认延迟应为 DEFERRED_LOAD_MS=${defaultDelayMs}`).toEqual([defaultDelayMs])
  })

  it('J5 卸载清理：cancel 对未决定时器发出 clearTimeout 且队列清空', async () => {
    const { create } = await deferredSeam()
    const t = manualTimers()
    const loader = create({ delayMs: 80, timers: t.timers })
    loader.schedule(() => undefined)
    expect(t.queue.size).toBe(1)
    loader.cancel() // 等价于组件卸载 effect 的清理
    expect(t.cleared.length, '必须调用 clearTimeout').toBeGreaterThan(0)
    expect(t.queue.size, '未决定时器应被清掉').toBe(0)
  })

  it('J6 cancel 之后仍可重新 schedule（不永久禁用），且新代次正常执行', async () => {
    const { create } = await deferredSeam()
    const t = manualTimers()
    const loader = create({ delayMs: 80, timers: t.timers })
    const applied: string[] = []
    loader.cancel()
    loader.schedule(() => applied.push('after-cancel'))
    t.fireAll()
    expect(applied).toEqual(['after-cancel'])
  })

  it('J7 schedule 覆盖前一代时，前一代回调即使到点也不执行（防「上一篇覆盖编辑器」）', async () => {
    const { create } = await deferredSeam()
    const t = manualTimers({ reallyClear: false })
    const loader = create({ delayMs: 80, timers: t.timers })
    const editorState: string[] = []
    loader.schedule(() => editorState.push('B-BODY')) // 上一篇
    loader.schedule(() => editorState.push('C-BODY')) // 切到 C 后的新载入
    t.fireAll()
    expect(editorState, '编辑器最终内容只能是最后一次调度的结果').toEqual(['C-BODY'])
  })
})
