/** P2-7 回归测试：设置死开关的接线决策。 */
import { describe, expect, it } from 'vitest'
import { planStartup } from './settingsGates'

describe('planStartup — P2-7（restoreLastState / autoOpenRecentWorkspace 接线）', () => {
  it('开关开启且数据存在 → 执行', () => {
    expect(
      planStartup({ autoOpenRecentWorkspace: true, restoreLastState: true, hasRecentWorkspace: true, hasLastArticle: true }),
    ).toEqual({ autoOpenRecentWorkspace: true, restoreLastArticle: true })
  })

  it('开关关闭 → 即使数据存在也不执行', () => {
    expect(
      planStartup({ autoOpenRecentWorkspace: false, restoreLastState: false, hasRecentWorkspace: true, hasLastArticle: true }),
    ).toEqual({ autoOpenRecentWorkspace: false, restoreLastArticle: false })
  })

  it('开关开启但无数据 → 不执行', () => {
    expect(
      planStartup({ autoOpenRecentWorkspace: true, restoreLastState: true, hasRecentWorkspace: false, hasLastArticle: false }),
    ).toEqual({ autoOpenRecentWorkspace: false, restoreLastArticle: false })
  })
})
