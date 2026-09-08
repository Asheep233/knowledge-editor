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

/** 插入文本并把光标定位到第一个槽（无槽则末尾） */
export function insertAt(latex: string, start: number, end: number, insert: string): { value: string; cursor: number } {
  const value = latex.slice(0, start) + insert + latex.slice(end)
  const idx = value.indexOf(SLOT_CHAR)
  return { value, cursor: idx >= 0 ? idx : value.length }
}
