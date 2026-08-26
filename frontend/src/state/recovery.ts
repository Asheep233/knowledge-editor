/**
 * 异常恢复检测的判定纯函数（P3-8）。
 *
 * 原缺陷：`recoveryCheckedFor` ref 一旦被赋值就挡住重试——检测失败后会话内不再重试；
 * 「稍后处理」关闭后也没有再入口。修复：catch 后重置 ref，允许下次轮询重试；
 * 「稍后处理」后提供顶栏「恢复检查…」入口重新 listRecovery。
 *
 * 本模块只做判定，副作用（listRecovery、重置 ref）由 App 执行。
 */

export interface RecoveryCheckState {
  /** recoveryCheckedFor ref 当前值（上一次已尝试过的 workspace.root） */
  checkedRoot: string | null
  /** 当前 workspace root（undefined = 无打开工作区） */
  root: string | undefined
  /** 上一次检测是否失败 */
  lastFailed: boolean
}

/**
 * 是否应当（再次）对当前工作区执行异常恢复检测。
 * - 无工作区：不检测。
 * - 上次失败：允许重试（不限次数）。
 * - checkedRoot 与 root 相同且上次成功：已在本次会话检测过，不再自动重复。
 */
export function recoveryCheckShouldRun({ checkedRoot, root, lastFailed }: RecoveryCheckState): boolean {
  if (!root) return false
  if (lastFailed) return true
  return checkedRoot !== root
}
