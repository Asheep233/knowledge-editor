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
