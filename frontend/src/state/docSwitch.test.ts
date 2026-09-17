/**
 * F-S1-2 / F14 回归测试：切档内容快照（必须早于 flush）+ 保存内容来源裁决（绝不串写）。
 *
 * 保护的两个缺陷：
 *  1) 旧守卫 `articleRef.current?.id === prevId` **恒假**——articleRef 的同步 effect 声明更早，
 *     切档 effect 执行时它已指向新文档 → 快照从未写入 → 旧文档最后 <3s 编辑的保存分支
 *     取不到快照、静默 return（既不落盘也不登记恢复点）。
 *  2) 保存内容来源若按「articleRef 说谁」而非「编辑器此刻载着谁」裁决，会经 editorRef 重读
 *     把**新文档**内容写进**旧文档路径**（跨文档串写）。
 *
 * 判别性证明见最后一个 describe：把旧判据当反例跑一遍，断言其产出「无快照 → 保存被放弃」，
 * 且与新实现结果不同 —— 证明本套件在旧实现上会红（非空测试）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CONTENT_SNAPSHOT_LIMIT,
  onDocumentSwitch,
  resolveSaveContent,
  type DocumentSwitchParams,
  type DocumentSwitchResult,
} from './docSwitch'

const A = 'Articles/A.md'
const B = 'Articles/B.md'
const A_MD = '# A 的正文\n\n最后 3 秒的编辑'
const B_MD = '# B 的正文'

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
