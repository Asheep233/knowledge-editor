/**
 * task-63 A11（第三份独立审查 2026-10-09 · P3）：**模板插入后光标跳到旧槽位**。
 *
 * 审查复现（真实 Chromium）：编辑 `\frac{□}{2} + `，在**末尾**插入根式模板 →
 * 选中的却是**旧分式**的槽（selection 6..7），输入 `9` 得到
 * `\frac{9}{2} + \sqrt[n]{□}`（改错了公式部分）。
 *
 * 根因：`insertAt` 用 `value.indexOf(SLOT_CHAR)` 查**整串首个**槽 —— 只要插入点之前
 * 已有槽，光标就必然跳回旧槽。同一根因还导致「插入无槽内容（如 `+`）时光标也跳到旧槽」。
 * 修法：槽位查找**限定在本次插入范围** `[start, start + insert.length)`。
 */
import { describe, expect, it } from 'vitest'
import { insertAt, nextSlot, stripSlots } from './slots'
import { SLOT_CHAR } from './templates'

describe('task-63 A11：insertAt 的槽位查找限定在本次插入范围', () => {
  it('A11-1 末尾插入含槽模板：光标必须落在**新模板**的槽（不得跳回旧分式槽）', () => {
    const before = `\\frac{${SLOT_CHAR}}{2} + `
    const r = insertAt(before, before.length, before.length, `\\sqrt[n]{${SLOT_CHAR}}`)
    expect(r.value).toBe(`\\frac{${SLOT_CHAR}}{2} + \\sqrt[n]{${SLOT_CHAR}}`)

    const newSlot = before.length + `\\sqrt[n]{`.length // 新模板内槽的绝对位置
    expect(r.cursor).toBe(newSlot)
    // 守护：不得指回旧分式槽
    expect(r.cursor).not.toBe(before.indexOf(SLOT_CHAR))
    expect(r.cursor).toBeGreaterThan(before.length)

    // 端到端语义：输入 9 应填进**根式**，而不是把旧分式改成 \frac{9}{2}
    const typed = r.value.slice(0, r.cursor) + '9' + r.value.slice(r.cursor + 1)
    expect(typed).toBe(`\\frac{${SLOT_CHAR}}{2} + \\sqrt[n]{9}`)
    expect(typed).not.toContain(`\\frac{9}{2}`)
  })

  it('A11-2 中间插入含槽模板：光标落在新模板槽，而非其之前的旧槽', () => {
    const before = `${SLOT_CHAR} + \\frac{${SLOT_CHAR}}{2} +`
    const at = `${SLOT_CHAR} + `.length // 在分式之后插入
    const r = insertAt(before, at, at, `\\sqrt{${SLOT_CHAR}}`)
    expect(r.cursor).toBe(at + `\\sqrt{`.length)
    expect(r.value[r.cursor]).toBe(SLOT_CHAR)
    // 不是串首那个旧槽
    expect(r.cursor).not.toBe(0)
  })

  it('A11-3 插入**无槽**内容：光标留在插入片段末尾（不得跳到任何已有槽）', () => {
    const before = `\\frac{${SLOT_CHAR}}{2}`
    const r = insertAt(before, before.length, before.length, ' + ')
    expect(r.cursor).toBe(before.length + 3)
    expect(r.cursor).toBe(r.value.length)
  })

  it('A11-4 替换选区插入含槽模板：槽位以**替换后的插入片段**为基准', () => {
    const value = `\\frac{${SLOT_CHAR}}{2}`
    // 选中整个分式（0..len）替换为根式
    const r = insertAt(value, 0, value.length, `\\sqrt{${SLOT_CHAR}}`)
    expect(r.value).toBe(`\\sqrt{${SLOT_CHAR}}`)
    expect(r.cursor).toBe(`\\sqrt{`.length)
  })

  it('A11-5 既有契约不回归：空串插入模板 → 首槽；无槽插入空串 → 末尾', () => {
    const r1 = insertAt('', 0, 0, `\\frac{${SLOT_CHAR}}{${SLOT_CHAR}}`)
    expect(r1.cursor).toBe(`\\frac{`.length)
    const r2 = insertAt('abc', 1, 1, '')
    expect(r2.cursor).toBe(1)
  })

  it('A11-6 既有契约不回归：Tab 跳槽仍是**整串**回绕（与插入定位解耦）', () => {
    const tpl = `\\frac{${SLOT_CHAR}}{${SLOT_CHAR}}`
    const first = nextSlot(tpl, 0)
    const second = nextSlot(tpl, first + 1)
    expect(second).toBeGreaterThan(first)
    expect(nextSlot(tpl, tpl.length)).toBe(first) // 回绕
    expect(stripSlots(tpl)).toBe('\\frac{}{}')
  })
})
