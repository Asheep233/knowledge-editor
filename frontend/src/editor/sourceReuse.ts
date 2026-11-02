/**
 * 源码模式「原文未改」回程复用判定（2026-11-02 Codex 性能审查 R1-S）。
 *
 * 现状问题：`exitSourceMode` 无条件 `setKeContent(editor, 保存后原文)` → `@tiptap/markdown`
 * 整篇重新解析。实测 20MiB 文档「进入源码 → 不编辑 → 返回正文」仍花 169.35s，其中 re-parse
 * 156.73s（92.55%）；5MiB 也占 81%。既然进入源码前 PM 模型已驻留且源码未改，就可以直接复用
 * 驻留 PM 文档、只切回可编辑态并清空 undo/redo 历史（保持既有「源码返回清历史」策略）。
 *
 * 本模块只做**纯判定**（可在单测中穷举反例），实际执行/清历史在 EditorArea。
 * 必须在下列任一情况失效（否则会把旧模型当新内容，造成串档/丢编辑）：
 *  - 文档身份变化（docId）；
 *  - 装载代次变化（切档 / 外部 reload / 恢复 / 重新装载）；
 *  - reloadToken 变化（同 ID 外部版本重载）；
 *  - 编辑器当前载着的文档不是本文档（editorDocId 失配）；
 *  - 驻留 PM doc 引用已替换（setKeContent/重建编辑器）；
 *  - 退出时源码正文与进入时快照不一致（用户改了源码——即使改回/保存，也走重解析更稳）。
 */
export interface SourceCheckpoint {
  docId: string
  /** EditorArea 的装载代次（docLoadGenRef） */
  loadGeneration: number
  /** 同 ID 外部重载令牌（reloadToken prop） */
  reloadToken: number
  /** 进入源码前驻留的 ProseMirror doc 引用（只做身份比较） */
  pmDoc: unknown
  /** 进入源码时 textarea 正文（已剥离 frontmatter 的内容体） */
  sourceBody: string
}

export interface SourceExitState {
  docId: string
  loadGeneration: number
  reloadToken: number
  pmDoc: unknown
  editorDocId: string | null
  /** 退出时 textarea 当前正文 */
  sourceBodyAtExit: string
}

/** 是否可复用驻留 PM 文档（true = 不需要重新解析 Markdown）。 */
export function canReusePmOnSourceExit(
  checkpoint: SourceCheckpoint | null | undefined,
  state: SourceExitState,
): boolean {
  if (!checkpoint) return false
  if (checkpoint.docId !== state.docId) return false
  if (checkpoint.loadGeneration !== state.loadGeneration) return false
  if (checkpoint.reloadToken !== state.reloadToken) return false
  if (state.editorDocId !== state.docId) return false
  if (checkpoint.pmDoc !== state.pmDoc) return false
  if (checkpoint.sourceBody !== state.sourceBodyAtExit) return false
  return true
}
