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
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
