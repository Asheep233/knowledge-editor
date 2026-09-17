/**
 * F-S1-2 / F14 / F-S1-4 回归测试：
 *  A. 切档内容快照（必须早于 flush）+ 保存内容来源裁决（绝不串写）—— F-S1-2/F14
 *  B. 大文档延迟载入的代次守卫（过期 timeout 绝不再改编辑器/UI）—— F-S1-4①（DS6 回归）
 *  C. 恢复点登记的「id 与内容同源」配对 —— F-S1-4②（DS7 回归，防跨文档污染）
 *
 * 保护的两个缺陷：
 *  1) 旧守卫 `articleRef.current?.id === prevId` **恒假**——articleRef 的同步 effect 声明更早，
 *     切档 effect 执行时它已指向新文档 → 快照从未写入 → 旧文档最后 <3s 编辑的保存分支
 *     取不到快照、静默 return（既不落盘也不登记恢复点）。
 *  2) 保存内容/恢复点若按「articleRef 说谁」而非「编辑器此刻载着谁」裁决，就会把**新文档**
 *     内容写进**旧文档路径**（串写）；恢复点错配更狠：以新文档的名字登记旧文档正文，
 *     崩溃恢复直接把 B 写回 C。
 *
 * 判别性证明见对应 describe：把旧判据/旧配对当反例跑一遍，断言产出与新实现不同 ——
 * 证明本套件在旧实现上会红（非空测试）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONTENT_SNAPSHOT_LIMIT,
  DEFERRED_LOAD_MS,
  createDeferredLoader,
  onDocumentSwitch,
  resolveRecoveryTarget,
  resolveSaveContent,
  type DeferredLoaderTimers,
  type DocumentSwitchParams,
  type DocumentSwitchResult,
} from './docSwitch'

const A = 'Articles/A.md'
const B = 'Articles/B.md'
const C = 'Articles/C.md'
const A_MD = '# A 的正文\n\n最后 3 秒的编辑'
const B_MD = '# B 的正文'
const C_MD = '# C 的正文'

/** 顺序记录桩：把「拍快照 / flush / cancel」三类事件写进同一数组，用于顺序断言 */
function recorder() {
  const events: string[] = []
  const snapshots = new Map<string, string>()
  /** flush 被调用的那一刻，快照表里有什么（顺序不变量断言用） */
  const seenAtFlush: Array<{ docId: string; snapshot: string | undefined }> = []
  return {
    events,
    snapshots,
    seenAtFlush,
    flushPending: (docId: string) => {
      events.push(`flush:${docId}`)
      seenAtFlush.push({ docId, snapshot: snapshots.get(docId) })
    },
    cancelDraftTimer: () => {
      events.push('cancel')
    },
  }
}

describe('onDocumentSwitch — 切档快照（F-S1-2 核心）', () => {
  it('切档 A→B：为 A 拍快照（payload 是 A 的 markdown）且**在 flush 之前**', () => {
    const r = recorder()

    const res = onDocumentSwitch({
      editorDocId: A,
      prevId: A,
      newId: B,
      editorMarkdown: A_MD,
      snapshots: r.snapshots,
      flushPending: r.flushPending,
      cancelDraftTimer: r.cancelDraftTimer,
    })

    expect(res).toEqual<DocumentSwitchResult>({ switched: true, snapshotFor: A })
    expect(r.snapshots.get(A)).toBe(A_MD)
    // 顺序不变量：flush 触发时快照必须已经在表里（在途第二棒可能晚于 setKeContent 执行）
    expect(r.seenAtFlush).toEqual([{ docId: A, snapshot: A_MD }])
    // S-1 顺序不变：cancel 在 flush 之后
    expect(r.events).toEqual([`flush:${A}`, 'cancel'])
  })

  it('关闭文档（A→null）同样先拍快照再 flush', () => {
    const r = recorder()

    const res = onDocumentSwitch({
      editorDocId: A,
      prevId: A,
      newId: null,
      editorMarkdown: A_MD,
      snapshots: r.snapshots,
      flushPending: r.flushPending,
      cancelDraftTimer: r.cancelDraftTimer,
    })

    expect(res.snapshotFor).toBe(A)
    expect(r.seenAtFlush[0]?.snapshot).toBe(A_MD)
    expect(r.events).toEqual([`flush:${A}`, 'cancel'])
  })

  it('编辑器已不载 prevId（例如它已载入新文档）→ 不拍快照，但仍 flush + cancel', () => {
    const r = recorder()

    const res = onDocumentSwitch({
      editorDocId: B,
      prevId: A,
      newId: B,
      editorMarkdown: B_MD, // 这其实是 B 的内容，绝不能被记到 A 名下
      snapshots: r.snapshots,
      flushPending: r.flushPending,
      cancelDraftTimer: r.cancelDraftTimer,
    })

    expect(res).toEqual<DocumentSwitchResult>({ switched: true, snapshotFor: null })
    expect(r.snapshots.size).toBe(0)
    expect(r.snapshots.has(A)).toBe(false)
    expect(r.seenAtFlush).toEqual([{ docId: A, snapshot: undefined }])
    expect(r.events).toEqual([`flush:${A}`, 'cancel'])
  })

  it('editorMarkdown 为 null（editor 尚未就绪）→ 不拍快照，仍 flush + cancel', () => {
    const r = recorder()

    const res = onDocumentSwitch({
      editorDocId: A,
      prevId: A,
      newId: B,
      editorMarkdown: null,
      snapshots: r.snapshots,
      flushPending: r.flushPending,
      cancelDraftTimer: r.cancelDraftTimer,
    })

    expect(res.snapshotFor).toBeNull()
    expect(r.snapshots.size).toBe(0)
    expect(r.events).toEqual([`flush:${A}`, 'cancel'])
  })

  it('首挂载（prevId=null）→ 不拍、不 flush、不 cancel', () => {
    const r = recorder()

    const res = onDocumentSwitch({
      editorDocId: null,
      prevId: null,
      newId: A,
      editorMarkdown: null,
      snapshots: r.snapshots,
      flushPending: r.flushPending,
      cancelDraftTimer: r.cancelDraftTimer,
    })

    expect(res).toEqual<DocumentSwitchResult>({ switched: false, snapshotFor: null })
    expect(r.snapshots.size).toBe(0)
    expect(r.events).toEqual([])
  })

  it('同一文档外部重载（prevId === newId，reloadToken）→ 不拍、不 flush、不 cancel', () => {
    const r = recorder()

    const res = onDocumentSwitch({
      editorDocId: A,
      prevId: A,
      newId: A,
      editorMarkdown: A_MD,
      snapshots: r.snapshots,
      flushPending: r.flushPending,
      cancelDraftTimer: r.cancelDraftTimer,
    })

    expect(res).toEqual<DocumentSwitchResult>({ switched: false, snapshotFor: null })
    expect(r.snapshots.size).toBe(0)
    expect(r.events).toEqual([])
  })
})

describe('onDocumentSwitch — 快照容积（上限 16，驱逐最旧）', () => {
  it(`最多保留 ${CONTENT_SNAPSHOT_LIMIT} 条：第 17 个文档写入时驱逐最旧`, () => {
    const snapshots = new Map<string, string>()
    const flushPending = vi.fn()
    const cancelDraftTimer = vi.fn()

    for (let i = 0; i < 17; i++) {
      const id = `Articles/doc${i}.md`
      onDocumentSwitch({
        editorDocId: id,
        prevId: id,
        newId: `Articles/doc${i}.md.next`,
        editorMarkdown: `md-${i}`,
        snapshots,
        flushPending,
        cancelDraftTimer,
      })
    }

    expect(snapshots.size).toBe(CONTENT_SNAPSHOT_LIMIT)
    expect(snapshots.has('Articles/doc0.md'), '最旧应被驱逐').toBe(false)
    expect(snapshots.has('Articles/doc16.md'), '最新必须保留').toBe(true)
    expect(snapshots.get('Articles/doc16.md')).toBe('md-16')
  })

  it('重复切出同一文档：内容取最新且刷新新鲜度（不被当成最旧驱逐）', () => {
    const snapshots = new Map<string, string>()
    const noop = () => undefined
    const limit = CONTENT_SNAPSHOT_LIMIT

    for (let i = 0; i < limit; i++) {
      snapshots.set(`d${i}`, `v0-${i}`)
    }
    expect(snapshots.size).toBe(limit)

    // 再次切出 d0（旧键）→ 内容更新为 v1，且刷新为「最新」
    onDocumentSwitch({
      editorDocId: 'd0',
      prevId: 'd0',
      newId: 'next',
      editorMarkdown: 'v1-0',
      snapshots,
      flushPending: noop,
      cancelDraftTimer: noop,
    })
    expect(snapshots.get('d0')).toBe('v1-0')
    expect(snapshots.size).toBe(limit)

    // 再写一个新文档 → 应驱逐 d1（此时的真正最旧），而不是刚刷新过的 d0
    onDocumentSwitch({
      editorDocId: 'dN',
      prevId: 'dN',
      newId: 'next',
      editorMarkdown: 'vN',
      snapshots,
      flushPending: noop,
      cancelDraftTimer: noop,
    })
    expect(snapshots.has('d0'), '刚刷新的快照不得被驱逐').toBe(true)
    expect(snapshots.has('d1'), '真正的最旧应被驱逐').toBe(false)
    expect(snapshots.size).toBe(limit)
  })
})

describe('resolveSaveContent — F14 内容来源裁决（绝不串写）', () => {
  interface Case {
    name: string
    docId: string
    currentDocId: string | null
    editorMarkdown: string | null
    snapshots: Array<[string, string]>
    expected: string | null
  }

  const cases: Case[] = [
    {
      name: 'B 待保存 / 编辑器载着 A / 只有 A 的快照 → 放弃（绝不把 A 内容写进 B）',
      docId: B,
      currentDocId: A,
      editorMarkdown: A_MD,
      snapshots: [[A, `snap:${A}`]],
      expected: null,
    },
    {
      name: 'B 待保存 / 编辑器载着 A / 无快照 → 放弃',
      docId: B,
      currentDocId: A,
      editorMarkdown: A_MD,
      snapshots: [],
      expected: null,
    },
    {
      name: 'B 待保存 / 编辑器载着 A / 有 B 的快照 → 用 B 的快照',
      docId: B,
      currentDocId: A,
      editorMarkdown: A_MD,
      snapshots: [[B, `snap:${B}`]],
      expected: `snap:${B}`,
    },
    {
      name: 'B 待保存 / 编辑器载着 B → 用实时内容（当下即真源）',
      docId: B,
      currentDocId: B,
      editorMarkdown: B_MD,
      snapshots: [[A, `snap:${A}`]],
      expected: B_MD,
    },
    {
      name: 'B 待保存 / 编辑器载着 B 但序列化不可用 → 退回 B 的快照',
      docId: B,
      currentDocId: B,
      editorMarkdown: null,
      snapshots: [[B, `snap:${B}`]],
      expected: `snap:${B}`,
    },
    {
      name: 'B 待保存 / 编辑器载着 B 但序列化不可用且无快照 → 放弃',
      docId: B,
      currentDocId: B,
      editorMarkdown: null,
      snapshots: [],
      expected: null,
    },
    {
      name: 'B 待保存 / 编辑器未载任何文档（currentDocId=null）→ 放弃，不得用旧实时内容',
      docId: B,
      currentDocId: null,
      editorMarkdown: A_MD,
      snapshots: [],
      expected: null,
    },
    {
      name: 'A 待保存（旧文档）/ 编辑器载着 A → 用实时内容',
      docId: A,
      currentDocId: A,
      editorMarkdown: A_MD,
      snapshots: [],
      expected: A_MD,
    },
    {
      name: 'A 待保存（旧文档）/ 编辑器已载 B / 有 A 快照 → 用 A 的快照（最后编辑落盘）',
      docId: A,
      currentDocId: B,
      editorMarkdown: B_MD,
      snapshots: [[A, `snap:${A}`]],
      expected: `snap:${A}`,
    },
    {
      name: 'A 待保存（旧文档）/ 编辑器已载 B / 无快照 → 放弃（不得把 B 内容写进 A）',
      docId: A,
      currentDocId: B,
      editorMarkdown: B_MD,
      snapshots: [],
      expected: null,
    },
  ]

  it.each(cases)('$name', ({ docId, currentDocId, editorMarkdown, snapshots, expected }) => {
    const md = resolveSaveContent({
      docId,
      currentDocId,
      editorMarkdown,
      snapshots: new Map(snapshots),
    })
    expect(md).toBe(expected)
  })

  it('矩阵反向断言：docId ≠ 编辑器当前文档时，任何组合都不返回编辑器实时内容', () => {
    const docIds = [A, B]
    const currentIds: Array<string | null> = [A, B, null]
    const editorMarkdowns: Array<string | null> = [A_MD, B_MD, null]
    const snapshotVariants: Array<Array<[string, string]>> = [
      [],
      [[A, `snap:${A}`]],
      [[B, `snap:${B}`]],
      [
        [A, `snap:${A}`],
        [B, `snap:${B}`],
      ],
    ]

    let checked = 0
    for (const docId of docIds) {
      for (const currentDocId of currentIds) {
        for (const editorMarkdown of editorMarkdowns) {
          for (const pairs of snapshotVariants) {
            const snapshots = new Map(pairs)
            const md = resolveSaveContent({ docId, currentDocId, editorMarkdown, snapshots })
            const label = `docId=${docId} current=${currentDocId} editor=${editorMarkdown} snaps=${JSON.stringify(pairs)}`
            checked++
            if (docId === currentDocId) {
              // 编辑器正是该文档 → 实时内容可用（不可用时退回快照）
              expect(md, label).toBe(editorMarkdown ?? snapshots.get(docId) ?? null)
            } else {
              // F14：绝不使用实时内容；只能用该 docId 的快照，无快照则放弃
              if (editorMarkdown !== null) {
                expect(md, `串写风险：${label}`).not.toBe(editorMarkdown)
              }
              expect(md, label).toBe(snapshots.get(docId) ?? null)
            }
          }
        }
      }
    }
    // 非空证明：矩阵确实遍历了组合
    expect(checked).toBe(docIds.length * currentIds.length * editorMarkdowns.length * snapshotVariants.length)
  })
})

describe('判别性证明 — 旧恒假判据 vs 新判据（证明测试非空）', () => {
  /**
   * 旧实现编排（只保留与缺陷相关的判据）：
   * `if (editor && articleRef.current?.id === prevId) { 拍快照 }`。
   * articleRef 的同步 effect（EditorArea.tsx:110-112）声明更早 → 切档 effect 执行时
   * `articleRef.current.id` 已经是 newId → 该判据**恒假**。
   */
  function legacyOnDocumentSwitch({
    articleRefId,
    prevId,
    newId,
    editorMarkdown,
    snapshots,
    flushPending,
    cancelDraftTimer,
  }: {
    articleRefId: string | null
    prevId: string | null
    newId: string | null
    editorMarkdown: string | null
    snapshots: Map<string, string>
    flushPending: (docId: string) => void
    cancelDraftTimer: () => void
  }): DocumentSwitchResult {
    const switched = prevId !== null && prevId !== newId
    if (!switched) return { switched, snapshotFor: null }
    if (articleRefId === prevId && typeof editorMarkdown === 'string') {
      snapshots.set(prevId, editorMarkdown)
    }
    flushPending(prevId)
    cancelDraftTimer()
    return { switched, snapshotFor: null }
  }

  it('旧判据恒假 → 无快照 → 旧文档未决保存被放弃（丢字）；新判据拍到快照 → 同一保存成功', () => {
    // 切档 A→B 的时刻：articleRef 已被更早的 effect 指向 B（这就是「恒假」的来源）。
    // 显式标 string：真实实现里二者都是运行期字符串，避免 TS 把字面量当成无交集类型优化掉比较。
    const articleRefId: string = B
    const prevId: string = A
    const newId: string = B

    // —— 旧实现 ——
    const legacySnapshots = new Map<string, string>()
    legacyOnDocumentSwitch({
      articleRefId,
      prevId,
      newId,
      editorMarkdown: A_MD,
      snapshots: legacySnapshots,
      flushPending: vi.fn(),
      cancelDraftTimer: vi.fn(),
    })
    expect(articleRefId === prevId, '旧判据 articleRef.id === prevId 恒假').toBe(false)
    expect(legacySnapshots.has(A), '旧实现从未写入快照').toBe(false)
    // 旧 saveFn 在 flush 时的处境：articleRef 说 B，编辑器此刻还载着 A，但旧代码用的是
    // articleRef 的 isCurrent=false → 走快照分支 → 无快照 → return（静默丢弃）
    const legacyMd = resolveSaveContent({
      docId: A,
      currentDocId: B,
      editorMarkdown: A_MD,
      snapshots: legacySnapshots,
    })
    expect(legacyMd, '旧实现：无快照 → 放弃保存（既不落盘也不登记恢复点）').toBeNull()

    // —— 新实现 ——
    const newSnapshots = new Map<string, string>()
    const newRes = onDocumentSwitch({
      editorDocId: A, // 编辑器此刻确实还载着 A（旧判据看不见的事实）
      prevId,
      newId,
      editorMarkdown: A_MD,
      snapshots: newSnapshots,
      flushPending: vi.fn(),
      cancelDraftTimer: vi.fn(),
    })
    const newMd = resolveSaveContent({
      docId: A,
      currentDocId: newId, // 编辑器随后载入 B
      editorMarkdown: B_MD,
      snapshots: newSnapshots,
    })

    expect(newRes.snapshotFor).toBe(A)
    expect(newMd, '新实现：旧文档最后 3 秒编辑应落盘').toBe(A_MD)
    expect(newMd, '且绝不写入 B 的内容').not.toBe(B_MD)

    // 判别性：同一场景下新旧产出不同 → 本套件在旧实现上必然失败（测试非空）
    expect(newMd).not.toBe(legacyMd)
    expect(legacyMd).toBeNull()
  })

  it('新编排在「编辑器已载新文档」时也不会拍出污染快照（判据两者都覆盖）', () => {
    const r = recorder()
    const params: DocumentSwitchParams = {
      editorDocId: B, // 编辑器已载入 B
      prevId: A,
      newId: B,
      editorMarkdown: B_MD,
      snapshots: r.snapshots,
      flushPending: r.flushPending,
      cancelDraftTimer: r.cancelDraftTimer,
    }
    const res = onDocumentSwitch(params)
    expect(res.snapshotFor).toBeNull()
    expect(r.snapshots.size).toBe(0)
    expect(r.events).toEqual([`flush:${A}`, 'cancel'])
  })
})

// ============================================================================
// F-S1-4① 大文档延迟载入的代次守卫（DS6 回归）
// ============================================================================
describe('createDeferredLoader — F-S1-4① 过期 timeout 绝不再改编辑器/UI', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** 假「编辑器内容 + UI 状态」，模拟 EditorArea 大文档延迟载入分支会碰的两样东西 */
  function harness() {
    const state = { editorBody: '', parsingLarge: false }
    const loader = createDeferredLoader()
    return { state, loader }
  }

  it('DS6 回归：切档后 80ms 到点，过期回调不得改编辑器内容或「解析中」状态', () => {
    const { state, loader } = harness()

    // 切到 >200KB 文档 C：立「解析中」占位，并调度代次 N 的延迟载入
    state.parsingLarge = true
    loader.schedule(() => {
      state.editorBody = 'C-BODY'
      state.parsingLarge = false
    })

    // 80ms 未到用户又切到 B（立即载入分支：cancel + 直接 setKeContent）
    loader.cancel()
    state.parsingLarge = false
    state.editorBody = 'B-BODY'

    vi.advanceTimersByTime(DEFERRED_LOAD_MS)
    expect(state.editorBody, '过期回调不得把上一篇内容灌进编辑器').toBe('B-BODY')
    expect(state.parsingLarge, '过期回调不得改动 UI 状态').toBe(false)

    // 反向证明 apply 本身有效（不是「永远不执行」的假绿）
    loader.schedule(() => {
      state.editorBody = 'C-BODY-2'
    })
    vi.advanceTimersByTime(DEFERRED_LOAD_MS)
    expect(state.editorBody).toBe('C-BODY-2')
  })

  it('连续 schedule：只有最新代次生效（先到的过期回调被丢弃）', () => {
    const { state, loader } = harness()

    loader.schedule(() => {
      state.editorBody = 'A-BODY'
    })
    loader.schedule(() => {
      state.editorBody = 'B-BODY'
    })

    vi.advanceTimersByTime(DEFERRED_LOAD_MS)
    expect(state.editorBody).toBe('B-BODY')
  })

  it('即使 clearTimeout 未生效（回调已在队列中），代次守卫仍拦下过期回调', () => {
    const queue: Array<() => void> = []
    // 故意不清理：模拟「回调已入队、clearTimeout 来不及」的最坏情形
    const timers: DeferredLoaderTimers = {
      setTimeout: (fn) => {
        queue.push(fn)
        return queue.length
      },
      clearTimeout: () => undefined,
    }
    const applied: string[] = []
    const loader = createDeferredLoader({ timers })

    loader.schedule(() => applied.push('A'))
    loader.schedule(() => applied.push('B'))
    expect(queue).toHaveLength(2)

    for (const fn of queue) fn() // 两个回调都执行
    expect(applied, '只有最新代次允许执行').toEqual(['B'])
    expect(loader.generation()).toBe(2)
  })

  it('cancel() 后到点：不执行（卸载 / 关档场景）', () => {
    const { state, loader } = harness()

    loader.schedule(() => {
      state.editorBody = 'C-BODY'
    })
    loader.cancel()

    vi.advanceTimersByTime(DEFERRED_LOAD_MS * 3)
    expect(state.editorBody).toBe('')
  })
})

// ============================================================================
// F-S1-4② 恢复点「id 与内容同源」配对（DS7 回归）
// ============================================================================
describe('resolveRecoveryTarget — F-S1-4② 配对矩阵（绝不产生错配登记）', () => {
  it('正常编辑（编辑器载着当前文档）→ 照旧登记，payload 属于该 doc', () => {
    expect(resolveRecoveryTarget({ editorDocId: A, articleDocId: A, editorMarkdown: A_MD })).toEqual({
      docId: A,
      md: A_MD,
    })
  })

  it('编辑器未载入任何文档 / 取不到正文 → 放弃登记（null）', () => {
    expect(resolveRecoveryTarget({ editorDocId: null, articleDocId: A, editorMarkdown: A_MD })).toBeNull()
    expect(resolveRecoveryTarget({ editorDocId: A, articleDocId: A, editorMarkdown: null })).toBeNull()
    expect(resolveRecoveryTarget({ editorDocId: null, articleDocId: null, editorMarkdown: null })).toBeNull()
  })

  it('DS7 回归：切档窗口（编辑器载 B / 应用已切 C）→ 绝不登记「C 的 id + B 的内容」', () => {
    const target = resolveRecoveryTarget({ editorDocId: B, articleDocId: C, editorMarkdown: B_MD })
    expect(target, '编辑器里真实存在的 B 正文应记在 B 名下（同源）').toEqual({ docId: B, md: B_MD })
    expect(target!.docId, '绝不挂到 articleDocId 名下').not.toBe(C)
  })

  it('矩阵反向断言：result 要么 null，要么 docId === editorDocId 且 md === editorMarkdown', () => {
    const editorIds: Array<string | null> = [A, B, null]
    const articleIds: Array<string | null> = [A, B, C, null]
    const markdowns: Array<string | null> = [A_MD, B_MD, null]

    let checked = 0
    for (const editorDocId of editorIds) {
      for (const articleDocId of articleIds) {
        for (const editorMarkdown of markdowns) {
          const t = resolveRecoveryTarget({ editorDocId, articleDocId, editorMarkdown })
          checked++
          if (editorDocId === null || editorMarkdown === null) {
            expect(t, `editorDocId=${editorDocId} editorMarkdown=${editorMarkdown}`).toBeNull()
            continue
          }
          expect(t).toEqual({ docId: editorDocId, md: editorMarkdown })
          // 核心不变量：编辑器与应用层不一致时，绝不出现「articleDoc 的 id + 编辑器内容」
          if (editorDocId !== articleDocId) {
            expect(t!.docId, `错配风险：articleDocId=${articleDocId}`).not.toBe(articleDocId)
          }
        }
      }
    }
    expect(checked).toBe(editorIds.length * articleIds.length * markdowns.length)
  })

  it('不减少登记：正常编辑路径连续 3 个登记周期逐次产出目标（S-1 语义不变）', () => {
    const targets = [1, 2, 3].map((i) =>
      resolveRecoveryTarget({ editorDocId: A, articleDocId: A, editorMarkdown: `A-EDIT-${i}` }),
    )
    expect(targets.every((t) => t !== null), '正常路径不得减少任何一次登记').toBe(true)
    expect(targets.map((t) => t!.md)).toEqual(['A-EDIT-1', 'A-EDIT-2', 'A-EDIT-3'])
    expect(targets.map((t) => t!.docId)).toEqual([A, A, A])
  })

  it('articleDocId 不参与配对：同一编辑器内容在任何 articleDocId 下都归 editorDocId', () => {
    for (const articleDocId of [A, B, C, null]) {
      expect(resolveRecoveryTarget({ editorDocId: B, articleDocId, editorMarkdown: B_MD })).toEqual({
        docId: B,
        md: B_MD,
      })
    }
  })
})

// ============================================================================
// F-S1-4 判别性证明：旧配对组合 vs 新配对（证明测试非空）
// ============================================================================
describe('F-S1-4 判别性证明 — 旧配对组合会产生跨文档污染，新实现不会', () => {
  /** 修复前的组合：docId 取 articleRef（更早的 effect 已指向新文档），md 取编辑器（可能仍旧文档） */
  function legacyRecoveryTarget({
    articleDocId,
    editorMarkdown,
  }: {
    articleDocId: string | null
    editorMarkdown: string | null
  }): { docId: string; md: string } | null {
    if (!articleDocId || editorMarkdown === null) return null
    return { docId: articleDocId, md: editorMarkdown }
  }

  it('切档窗口（编辑器载 B / articleRef 已是 C）：旧组合 = 以 C 登记 B 正文；新实现 = 同源登记', () => {
    const legacy = legacyRecoveryTarget({ articleDocId: C, editorMarkdown: B_MD })
    const modern = resolveRecoveryTarget({ editorDocId: B, articleDocId: C, editorMarkdown: B_MD })

    expect(legacy, '旧实现：恢复点会以 C 的名字保存 B 的正文（崩溃恢复即污染）').toEqual({
      docId: C,
      md: B_MD,
    })
    expect(modern, '新实现：id 与内容同源').toEqual({ docId: B, md: B_MD })
    // 判别性：同一输入下新旧产出不同 → 本套件在旧实现上必然失败
    expect(modern).not.toEqual(legacy)
    expect(modern!.docId).not.toBe(legacy!.docId)
  })

  it('DS6+DS7 组合：旧世界「过期 timeout 灌内容 → 错配登记」；新世界链式失效', () => {
    // ---- 旧世界：直接 setTimeout，无代次、无清理；登记用 articleRef.id + 编辑器内容 ----
    let legacyBody = C_MD
    const legacyStaleTimeout = () => {
      legacyBody = B_MD // 80ms 过期回调照跑，把上一篇 B 灌进编辑器
    }
    legacyStaleTimeout()
    const legacyTarget = legacyRecoveryTarget({ articleDocId: C, editorMarkdown: legacyBody })
    expect(legacyTarget, '旧世界：C 的恢复点里装着 B 的正文').toEqual({ docId: C, md: B_MD })

    // ---- 新世界：同一个过期回调被代次守卫丢弃 → 编辑器仍是 C → 登记也同源 ----
    const queue: Array<() => void> = []
    const timers: DeferredLoaderTimers = {
      setTimeout: (fn) => {
        queue.push(fn)
        return queue.length
      },
      clearTimeout: () => undefined, // 最坏情形：连 clearTimeout 都没拦住
    }
    const loader = createDeferredLoader({ timers })
    let body = C_MD
    loader.schedule(() => {
      body = B_MD // 这篇 B 的延迟载入已经过期
    })
    loader.cancel() // 切到 C（立即载入分支）
    for (const fn of queue) fn() // 过期回调执行
    expect(body, '新世界：过期回调不改编辑器').toBe(C_MD)

    const modernTarget = resolveRecoveryTarget({ editorDocId: C, articleDocId: C, editorMarkdown: body })
    expect(modernTarget).toEqual({ docId: C, md: C_MD })
    expect(modernTarget, '新世界不再有错配/污染').not.toEqual(legacyTarget)
  })
})
