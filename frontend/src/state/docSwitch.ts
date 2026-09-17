/**
 * F-S1-2 / F14 / F-S1-4：文档切换的内容快照、保存内容来源裁决、延迟载入代次守卫与
 * 恢复点配对（纯模块，无 React 依赖，便于对抗验证）。
 *
 * 背景（F-S1-2 实测缺口）：
 *  - 切档时旧文档最后 <3s 的编辑仍只在编辑器内存里；其未决防抖保存会在
 *    `setKeContent(新文档)` 之后执行。此时若经 `editorRef` 重读编辑器，会把**新文档**
 *    内容写进**旧文档路径**（跨文档串写，F14 红线）。
 *  - 正确做法有两条，缺一不可：
 *    1) 切档瞬间为「离开的文档」拍下内容快照，且必须**早于** `flushPending`；
 *    2) 保存时按「**编辑器此刻载着谁**」裁决内容来源：只有 `docId === 编辑器当前文档`
 *       才允许用实时内容，否则必须用该 docId 的快照；无快照 → 放弃保存（绝不串写）。
 *
 * 为什么守卫不能用 `articleRef.current?.id === prevId`：
 *  - `articleRef` 的同步 effect 声明在切档 effect 之前，每次 commit 先执行；切档 effect
 *    跑到时它**已经指向新文档** → 该判据恒假 → 快照从未写入 → 后续保存分支拿不到快照，
 *    只能静默 return（旧文档最后一段编辑既不落盘、也不登记恢复点）。这就是本模块要堵的洞。
 *  - 判据必须表达「编辑器此刻仍载着 prevId」这一**实际状态**（见 `editorDocId`）。
 *
 * 背景（F-S1-4，由独立验证构造证实，后果 = 跨文档内容污染）：
 *  - ① `>200KB` 文档的 80ms 延迟载入没有代次守卫：切档后过期 timeout 仍会 `setKeContent`
 *    把上一篇内容灌进编辑器 → 由 {@link createDeferredLoader} 的「清理 + 代次」双守卫拦截。
 *  - ② 恢复点登记曾用 `articleRef.id`（已指向新文档）+ `editorRef.getMarkdown()`（可能仍是
 *    旧文档）→ id 与内容不同源，崩溃恢复会把 B 的正文写回 C 的路径 → 由
 *    {@link resolveRecoveryTarget} 保证「谁的内容配谁的 id」。
 */

/** 内容快照表容积上限（超出驱逐最旧；按写入/刷新顺序 LRU） */
export const CONTENT_SNAPSHOT_LIMIT = 16

export interface DocumentSwitchParams {
  /** 编辑器此刻**实际载入**的文档 id（null = 编辑器未载入任何文档） */
  editorDocId: string | null
  /** 即将离开的文档 id（「上一文档」，首挂载时为 null） */
  prevId: string | null
  /** 新文档 id（null = 关闭文档） */
  newId: string | null
  /** 编辑器当前 Markdown；仅当 `editorDocId === prevId` 时才可信（否则调用方应传 null） */
  editorMarkdown: string | null
  /** 快照表（docId → Markdown）；本函数就地写入 */
  snapshots: Map<string, string>
  /** 触发 prevId 的未决保存 */
  flushPending: (docId: string) => void
  /** 放弃当前文档的恢复点登记计时器（**必须在 flush 之后**调用，保持 S-1 顺序） */
  cancelDraftTimer: () => void
  /** 快照上限，默认 {@link CONTENT_SNAPSHOT_LIMIT} */
  limit?: number
}

export interface DocumentSwitchResult {
  /** 是否发生了真实切档（prevId 非空且 ≠ newId）；false 时不做任何副作用 */
  switched: boolean
  /** 本次为哪个文档拍了快照（null = 未拍） */
  snapshotFor: string | null
}

/**
 * 切档编排：**拍快照 → flushPending → cancelDraftTimer**（顺序即不变量）。
 *
 * - `prevId === null`（首次挂载）或 `prevId === newId`（同一文档的外部重载）时 no-op：
 *   不拍快照、不 flush、不 cancel。
 * - 编辑器已不载 `prevId`（例如大文档 80ms 延迟分支前、或已被新文档覆盖）时不拍快照：
 *   实时 Markdown 已不属于 prevId，拍下来只会污染快照表。
 */
export function onDocumentSwitch({
  editorDocId,
  prevId,
  newId,
  editorMarkdown,
  snapshots,
  flushPending,
  cancelDraftTimer,
  limit = CONTENT_SNAPSHOT_LIMIT,
}: DocumentSwitchParams): DocumentSwitchResult {
  const switched = prevId !== null && prevId !== newId
  if (!switched) return { switched: false, snapshotFor: null }

  // 守卫语义 =「编辑器此刻仍载着 prevId」（不是 articleRef 说 prevId —— 后者在切档
  // effect 执行时已被更早的同步 effect 指向新文档，恒假）。
  let snapshotFor: string | null = null
  if (editorDocId === prevId && typeof editorMarkdown === 'string') {
    // 先删再写：命中已有键时刷新其「新鲜度」（LRU），避免刚拍的快照被当成最旧驱逐
    snapshots.delete(prevId)
    snapshots.set(prevId, editorMarkdown)
    snapshotFor = prevId
    while (snapshots.size > limit) {
      const oldest = snapshots.keys().next().value
      if (oldest === undefined) break
      snapshots.delete(oldest)
    }
  }

  // 顺序不变量：快照必须已落表，才允许触发旧文档的未决保存
  // （在途第二棒可能晚于 setKeContent 执行，届时编辑器已不载 prevId）
  flushPending(prevId)

  // S-1：flush 之后再放弃本调度器的未决登记计时器（否则它到点时会用**新文档**内容
  // 以**新文档 id** 登记，造成串档）。顺序不能颠倒。
  cancelDraftTimer()

  return { switched: true, snapshotFor }
}

export interface ResolveSaveContentParams {
  /** 待保存的文档 id */
  docId: string
  /** 编辑器此刻载入的文档 id = 实时内容的**可信域**（不是 articleRef 的 id） */
  currentDocId: string | null
  /** 编辑器当前 Markdown（仅当 `docId === currentDocId` 时才可用） */
  editorMarkdown: string | null
  /** 切换时为「已离开的文档」拍下的内容快照表 */
  snapshots: Map<string, string>
}

/**
 * F14 不变量：返回该 `docId` 应当落盘的内容，或 `null`（= 放弃本次保存，绝不串写）。
 *
 * - `docId === currentDocId` 且编辑器有内容 → 用实时内容（当下即真源）；
 * - 否则（编辑器已载入别的文档）→ **只**用该 docId 的快照；
 * - 无快照 → `null`。调用方必须 `return`（不 save、不登记恢复点），
 *   宁可少一次保存，也不把 A 的内容写进 B 的路径。
 */
export function resolveSaveContent({
  docId,
  currentDocId,
  editorMarkdown,
  snapshots,
}: ResolveSaveContentParams): string | null {
  if (docId === currentDocId && typeof editorMarkdown === 'string') return editorMarkdown
  const snap = snapshots.get(docId)
  return snap === undefined ? null : snap
}

// ---------------------------------------------------------------------------
// F-S1-4① 延迟载入的代次守卫（>200KB 文档的 80ms「解析中」占位帧）
// ---------------------------------------------------------------------------

/** 大文档延迟载入时长（给 React commit + 浏览器一次 paint 的机会） */
export const DEFERRED_LOAD_MS = 80

/** 定时器注入点（单测可用假计时器或手工队列） */
export interface DeferredLoaderTimers {
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}

export interface DeferredLoader {
  /** 调度一代延迟载入；此前未决的延迟立即失效（清理 + 代次双守卫） */
  schedule: (apply: () => void) => void
  /** 放弃未决延迟并让其代次过期（卸载 / 关档 / 立即载入分支） */
  cancel: () => void
  /** 当前代次（诊断/测试） */
  generation: () => number
}

/**
 * 延迟载入调度器（F-S1-4①）：
 *  - `schedule(apply)` 自增代次并调度一次延迟执行，同时清掉此前未决的定时器；
 *  - 到点时**再比对代次**：其间若又发生切档/重载（代次已变），回调直接返回 ——
 *    绝不改编辑器内容、绝不改 UI 状态（即使 clearTimeout 未生效、回调已在队列里，
 *    代次守卫仍然拦住它）；
 *  - `cancel()` 用于卸载 / 关闭文档 / 走立即载入分支，语义同上。
 *
 * 为什么需要两层：`clearTimeout` 只能取消**尚未入队**的定时器；事件循环里已就绪的
 * 回调仍会执行。代次比对是最后一道闸，保证「切档后旧 timeout 绝不能再改编辑器或 UI」。
 */
export function createDeferredLoader(
  { delayMs = DEFERRED_LOAD_MS, timers }: { delayMs?: number; timers?: DeferredLoaderTimers } = {},
): DeferredLoader {
  const host: DeferredLoaderTimers = timers ?? {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  }
  let gen = 0
  let pending: number | null = null
  return {
    schedule(apply: () => void): void {
      const myGen = ++gen
      if (pending !== null) {
        host.clearTimeout(pending)
        pending = null
      }
      pending = host.setTimeout(() => {
        pending = null
        if (myGen !== gen) return // 过期代次：切档已发生 → 不动编辑器、不动 UI
        apply()
      }, delayMs)
    },
    cancel(): void {
      gen += 1
      if (pending !== null) {
        host.clearTimeout(pending)
        pending = null
      }
    },
    generation(): number {
      return gen
    },
  }
}

// ---------------------------------------------------------------------------
// F-S1-4② 恢复点登记的「id 与内容同源」裁决
// ---------------------------------------------------------------------------

export interface RecoveryTargetParams {
  /** 编辑器此刻**实际载入**的文档 id —— 配对依据（内容属于它） */
  editorDocId: string | null
  /** 应用层当前文档 id（`articleRef.current?.id`）；仅供一致性诊断，**不参与配对** */
  articleDocId: string | null
  /** 编辑器当前 Markdown（与 `editorDocId` 同源） */
  editorMarkdown: string | null
}

export interface RecoveryTarget {
  docId: string
  md: string
}

/**
 * 恢复点登记目标（F-S1-4②）：`{ docId, md }`，或 `null` = 放弃登记。
 *
 * 不变量：**id 与内容必须来自同一个载入快照** —— 两者都以「编辑器此刻载着谁」
 * （`editorDocId`）为准。旧实现用 `articleRef.current.id`（更早的 effect 已把它更新为
 * 新文档）配 `editorRef.getMarkdown()`（可能仍是旧文档）→ 一旦错配，恢复点会以新文档的
 * 名字保存旧文档正文，崩溃恢复即跨文档污染。
 *
 * - `editorDocId === null`（编辑器未载入任何文档）→ null（放弃）；
 * - `editorMarkdown` 不可用 → null（放弃）；
 * - `editorDocId !== articleDocId`（切档窗口）：仍按 **editorDocId** 登记 —— 内容真实
 *   属于编辑器里那篇文档，绝不挂到 `articleDocId` 名下。
 */
export function resolveRecoveryTarget(params: RecoveryTargetParams): RecoveryTarget | null {
  const { editorDocId, editorMarkdown } = params
  if (editorDocId === null || typeof editorMarkdown !== 'string') return null
  return { docId: editorDocId, md: editorMarkdown }
}
