/**
 * SD-01（2026-10-17 独立审查）：后端 sidecar 自动重启后的**工作区一致性**判定。
 *
 * 背景：sidecar 每次 spawn 都读进程启动时的 `KE_WORKSPACE`（或默认工作区）；
 * 运行期通过 `/api/workspace/open` 切换的工作区只存在于 Python 进程状态里。
 * 后端崩溃/被杀后自动重启 → 回到默认工作区 A，而前端 UI 仍显示用户选中的 B
 * → 之后所有保存按**相对路径**写进 A（跨库串写；同相对路径的文档被静默改写）。
 *
 * 修复口径：恢复后的首次健康轮询核对后端当前 root；与 UI 期望不一致时先在
 * 前端冻结未触发的防抖保存，再用 UI 期望 root 重新 `/api/workspace/open`，
 * 确保后续保存落到正确的库。本模块只承载判定（纯函数，可单测）。
 */
import type { WorkspaceState } from '../types'

export type ReconcileAction = 'none' | 'reopen'

/**
 * 判定是否需要把后端重新对齐到 UI 期望的工作区。
 *
 * - UI 未打开工作区（null）→ 无事可做 `none`；
 * - 后端打开且 root 与 UI 相同 → 一致 `none`；
 * - 其余（后端回到默认 A / 未打开）→ `reopen`。
 */
export function decideWorkspaceReconcile(
  uiRoot: string | null,
  backend: Pick<WorkspaceState, 'open' | 'root'>,
): ReconcileAction {
  if (!uiRoot) return 'none'
  if (backend.open && backend.root === uiRoot) return 'none'
  return 'reopen'
}
