/** P3-8 回归测试：恢复检测重试 + 「稍后处理」再入口的判定。 */
import { describe, expect, it } from 'vitest'
import { recoveryCheckShouldRun } from './recovery'

describe('recoveryCheckShouldRun — P3-8', () => {
  it('无工作区时不检测', () => {
    expect(recoveryCheckShouldRun({ checkedRoot: null, root: undefined, lastFailed: false })).toBe(false)
  })

  it('未检测过该工作区 → 应检测', () => {
    expect(recoveryCheckShouldRun({ checkedRoot: null, root: '/ws', lastFailed: false })).toBe(true)
  })

  it('已成功检测过同一工作区 → 不再自动重复', () => {
    expect(recoveryCheckShouldRun({ checkedRoot: '/ws', root: '/ws', lastFailed: false })).toBe(false)
  })

  it('切换到新工作区 → 应重新检测', () => {
    expect(recoveryCheckShouldRun({ checkedRoot: '/ws', root: '/ws2', lastFailed: false })).toBe(true)
  })

  it('上次检测失败 → 允许重试（即使 checkedRoot 已是该 root）', () => {
    expect(recoveryCheckShouldRun({ checkedRoot: '/ws', root: '/ws', lastFailed: true })).toBe(true)
  })
})
