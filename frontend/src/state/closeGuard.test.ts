/** P0-2 回归测试：beforeunload 关窗拦截判定（浏览器实际行为无法自动化，测核心判定）。 */
import { describe, expect, it } from 'vitest'
import { shouldBlockUnload } from './closeGuard'

describe('shouldBlockUnload — P0-2', () => {
  it('有未决保存（防抖中/在途待补）→ 拦截关窗', () => {
    expect(shouldBlockUnload(1, false)).toBe(true)
  })

  it('有未保存状态（dirty/saving/error）→ 拦截关窗', () => {
    expect(shouldBlockUnload(0, true)).toBe(true)
  })

  it('两者皆无 → 不拦截（可安全关窗）', () => {
    expect(shouldBlockUnload(0, false)).toBe(false)
  })
})
