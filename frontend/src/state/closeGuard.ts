/**
 * 关窗/卸载拦截判定（P0-2 的 beforeunload 核心逻辑）。
 * 浏览器行为无法直接自动化测试，抽成纯函数以单测锁定判定。
 */
export function shouldBlockUnload(pendingSavings: number, hasUnsaved: boolean): boolean {
  return pendingSavings > 0 || hasUnsaved
}
