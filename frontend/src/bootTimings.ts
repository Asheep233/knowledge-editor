/**
 * 启动性能埋点（v1.1.7 M1）：记录各阶段完成时刻（相对模块加载的 performance.now）。
 * 挂 window.__bootTimings 供测量分析；品牌页（App.tsx）按阶段事件驱动进度显示。
 */
const T0 = performance.now()
const marks: Record<string, number> = { t0: 0 }
export function bootMark(name: string): void {
  marks[name] = Math.round(performance.now() - T0)
  ;(window as unknown as Record<string, unknown>).__bootTimings = { ...marks }
  window.dispatchEvent(new CustomEvent('ke:boot-mark', { detail: name }))
}
// 提前挂载空对象
;(window as unknown as Record<string, unknown>).__bootTimings = { ...marks }
export function bootMarks(): Record<string, number> {
  return (window as unknown as Record<string, unknown>).__bootTimings as Record<string, number>
}
export const BOOT_PHASE = {
  service: 'service',
  workspace: 'workspace',
  article: 'article',
  tree: 'tree',
  ready: 'ready',
} as const
export type BootPhase = (typeof BOOT_PHASE)[keyof typeof BOOT_PHASE]
