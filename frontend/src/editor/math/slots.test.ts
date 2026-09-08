import { describe, expect, it } from 'vitest'
import { nextSlot, stripSlots, slotCount } from './slots'
import { completions } from './completions'
import { insertAt } from './slots'
import { MATH_TEMPLATES, SLOT_CHAR } from './templates'

describe('公式模板与槽位（v1.1.7 M2）', () => {
  it('nextSlot 从光标起找下一槽，可回绕', () => {
    const tpl = MATH_TEMPLATES[0].latex
    const c1 = nextSlot(tpl, 0)
    expect(tpl[c1]).toBe(SLOT_CHAR)
    const c2 = nextSlot(tpl, c1 + 1)
    expect(c2).toBeGreaterThan(c1)
    // 末尾回绕回第一槽
    const wrap = nextSlot(tpl, tpl.length)
    expect(wrap).toBe(c1)
  })
  it('stripSlots 保存前剥离槽位（存储零污染）', () => {
    const md = MATH_TEMPLATES.find((t) => t.id === 'piecewise')!.latex
    expect(stripSlots(md).includes(SLOT_CHAR)).toBe(false)
    // round-trip 语义：剥离后仍为合法 LaTeX 骨架（无 □ 残留）
    expect(stripSlots(md)).toContain('\\begin{cases}')
  })
  it('补全前缀匹配', () => {
    const hits = completions('\\fr')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].insert.startsWith('\\fr')).toBe(true)
  })
  it('insertAt 插入模板并把光标定位到第一个槽', () => {
    const r = insertAt('abc', 1, 1, '\\frac{□}{□}')
    expect(r.value).toBe('a\\frac{□}{□}bc')
    expect(r.cursor).toBe(r.value.indexOf(SLOT_CHAR))
  })
  it('slotCount 统计', () => {
    expect(slotCount('\\frac{□}{□}')).toBe(2)
  })
})
