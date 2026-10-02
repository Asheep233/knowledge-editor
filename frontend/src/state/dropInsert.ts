/**
 * 多文件拖拽插入的判定纯函数（P3-20）。
 *
 * 原缺陷：
 *  1) handleDrop 的异步上传循环在 upload 前只记录一次 pos，多文件全部插入同一位置；
 *  2) 上传回调返回时若用户已切换文档，仍会插进“旧视图”，把内容写到错误文档；
 *  3) 若编辑器已失焦，固定 pos 插入会落在错误处。
 *
 * 修复策略：每次文件上传前重新计算插入点并且校验「当前文档是否仍是 drop 时的那篇」。
 * 本模块把判定抽成 `shouldInsertDroppedFiles`（纯函数，可单测）。
 * 注：真正的 handleDrop 实现在 src/editor/index.ts（本仓库约定禁止修改），
 * 判定逻辑已在此沉淀，供后续 drop 接线直接调用。
 */

export interface DropInsertCtx {
  /** 触发 drop 时打开的文档 id（null = drop 时无文档打开） */
  docIdAtDrop: string | null
  /** 上传回调时的「当前打开文档 id」（经 ref 读最新） */
  currentDocId: string | null
  /** 编辑器当前 selection 位置（null = 已失焦 / 无有效 selection） */
  currentPos: number | null
  /** 文档末尾位置（失焦时插入于此，避免落在无效处） */
  docEndPos: number
}

export interface DropDecision {
  /** 是否应插入（文档已切换则丢弃） */
  insert: boolean
  /** 插入位置（editor pos） */
  pos: number
}

export function shouldInsertDroppedFiles(ctx: DropInsertCtx): DropDecision {
  // 文档已切换（或 drop 时根本没文档）：丢弃，避免写入错误文档
  if (!ctx.docIdAtDrop || ctx.docIdAtDrop !== ctx.currentDocId) {
    return { insert: false, pos: 0 }
  }
  // 每次插入前重算位置：编辑器有焦点用当前 selection，否则追加到文档末尾
  const pos = ctx.currentPos != null ? ctx.currentPos : ctx.docEndPos
  return { insert: true, pos }
}

// ---------------------------------------------------------------------------
// F2 接线：文档身份令牌 + 多文件 drop 编排
// ---------------------------------------------------------------------------

/**
 * 文档身份令牌（F2 接线用）。
 *
 * 编辑器侧拿不到「文档 id」（doc id 由 EditorArea 的 ref 持有，且本批次不得改 EditorArea），
 * 因此用**载入代次令牌**表达同一件事：编辑器每次「内容被整篇替换」（切档 / 外部重载 /
 * 保存回包 / 历史恢复）就换发一个新令牌。drop 时记下令牌，每个文件上传完成后比对：
 * 不同 = 上传期间编辑器已换了内容 → 该结果与后续文件全部过期，必须丢弃。
 */
let docTokenSeq = 0
let activeDocToken: string | null = null

/** 载入新内容时换发令牌（由 editor/index.ts 的 setKeContent 调用——唯一生产载入入口） */
export function rotateDropDocToken(): string {
  docTokenSeq += 1
  activeDocToken = `ke-doc-${docTokenSeq}`
  return activeDocToken
}

/** 当前文档身份令牌（null = 编辑器尚未载入任何文档） */
export function currentDropDocToken(): string | null {
  return activeDocToken
}

/** 测试钩子：重置令牌状态（生产不使用） */
export function __resetDropDocTokenForTests(): void {
  docTokenSeq = 0
  activeDocToken = null
}

export interface RunDropInsertParams<T> {
  /** drop 发生时的文档身份令牌（null = 当时无文档 → 全部丢弃，连上传都不发起） */
  docIdAtDrop: string | null
  /** 待插入文件（已过滤目录项） */
  files: readonly T[]
  /** 每个文件上传完成后再读一次当前令牌（经 ref 读最新） */
  readCurrentDocId: () => string | null
  /** **每个文件插入前**重新读取插入点（生产 = `view.posAtCoords(...)?.pos`）；null = 失焦/无效 */
  readCurrentPos: (file: T, index: number) => number | null
  /** 文档末尾位置（失焦时插入于此） */
  readDocEndPos: () => number
  /** 上传（异步；返回值原样交给 insert） */
  upload: (file: T, index: number) => Promise<unknown>
  /** 按判定结果插入 */
  insert: (pos: number, uploaded: unknown, file: T, index: number) => void
  /** 上传/插入失败（回调内自行提示；不中断后续文件） */
  onError?: (err: unknown, file: T, index: number) => void
}

export interface RunDropInsertResult {
  /** 实际插入的文件数 */
  inserted: number
  /** 因「文档身份已变」被丢弃的文件数（含守卫触发后未再尝试的剩余文件） */
  discarded: number
  /** 上传/插入失败的文件数 */
  failed: number
}

/**
 * 多文件 drop 编排（F2 的接线实现）：
 *  对每个文件：`await upload` → **重新**读取「当前文档令牌 + 当前插入点」→ 经
 *  {@link shouldInsertDroppedFiles} 判定 → 应插入才插入。
 *
 * 与原缺陷对应：
 *  1. 旧实现只在循环外取一次 pos → 多文件全部插到同一处（后插的还会反插到先插的之前）；
 *  2. 旧实现上传返回后照插 → 上传期间切档会把附件写进另一篇文档；
 *  3. 令牌一变即判定「后续文件同样过期」并停止（否则只会继续产生孤儿附件）。
 */
export async function runDropInsert<T>({
  docIdAtDrop,
  files,
  readCurrentDocId,
  readCurrentPos,
  readDocEndPos,
  upload,
  insert,
  onError,
}: RunDropInsertParams<T>): Promise<RunDropInsertResult> {
  const result: RunDropInsertResult = { inserted: 0, discarded: 0, failed: 0 }
  // drop 时就没有文档：直接丢弃（不发起上传，避免产生无人引用的附件）
  if (!docIdAtDrop) {
    result.discarded = files.length
    return result
  }

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    let uploaded: unknown
    try {
      uploaded = await upload(file, i)
    } catch (err) {
      result.failed += 1
      onError?.(err, file, i)
      continue
    }

    // 上传期间编辑器可能已换内容：令牌过期时连插入点都不必再算（也不再触碰视图）。
    // 判定出口仍只有 shouldInsertDroppedFiles（令牌不同 → insert=false → 丢弃）。
    const currentDocId = readCurrentDocId()
    const stillSameDoc = docIdAtDrop === currentDocId
    const decision = shouldInsertDroppedFiles({
      docIdAtDrop,
      currentDocId,
      currentPos: stillSameDoc ? readCurrentPos(file, i) : null,
      docEndPos: stillSameDoc ? readDocEndPos() : 0,
    })
    if (!decision.insert) {
      result.discarded += files.length - i
      break
    }
    try {
      insert(decision.pos, uploaded, file, i)
      result.inserted += 1
    } catch (err) {
      result.failed += 1
      onError?.(err, file, i)
    }
  }
  return result
}
