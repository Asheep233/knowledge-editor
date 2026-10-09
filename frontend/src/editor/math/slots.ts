/**
 * 槽位引擎（v1.1.7 M2）：`□` 锚点仅存在于编辑态。
 * - nextSlot：从光标起找下一个槽位位置（含回绕）
 * - stripSlots：保存前剥离槽位字符（存储永不污染）
 */
import { SLOT_CHAR } from './templates'

export function nextSlot(latex: string, cursor: number): number {
  const from = latex.indexOf(SLOT_CHAR, cursor)
  if (from >= 0) return from
  return latex.indexOf(SLOT_CHAR) // 回绕到头
}

export function stripSlots(latex: string): string {
  return latex.split(SLOT_CHAR).join('')
}

export function slotCount(latex: string): number {
  return latex.split(SLOT_CHAR).length - 1
}

/** 插入文本并把光标定位到**本次插入片段**的第一个槽（无槽则落在插入末尾）
 *
 * task-63 A11（第三份独立审查 2026-10-09）：原实现用 `value.indexOf(SLOT_CHAR)` 查
 * **整串首个**槽 —— 只要插入点之前已有槽（例如正在编辑 `\frac{□}{2} + `），
 * 末尾插入 `\sqrt[n]{□}` 后光标会跳回**旧分式**的槽；用户接着输入 `9` 就改错公式
 * （实测得到 `\frac{9}{2} + \sqrt[n]{□}`）。同一根因还导致「插入无槽内容（如 `+`）
 * 时光标也跳回旧槽」。
 * 现在槽位查找限定在 `insert` 范围内（绝对位置 = start + insert 内的偏移）。
 * 注意：Tab 跳槽用的 `nextSlot` 仍是**整串回绕**语义——那是刻意的（切槽要能跨公式走），
 * 与「插入后的落点」是两件事，勿混。 */
export function insertAt(latex: string, start: number, end: number, insert: string): { value: string; cursor: number } {
  const value = latex.slice(0, start) + insert + latex.slice(end)
  const local = insert.indexOf(SLOT_CHAR)
  return { value, cursor: local >= 0 ? start + local : start + insert.length }
}
