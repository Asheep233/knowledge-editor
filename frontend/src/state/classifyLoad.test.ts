/** P2-8 回归测试：加载状态分类，失败不再被当作空。 */
import { describe, expect, it } from 'vitest'
import { classifyLoadState, isLoadError } from './classifyLoad'

describe('classifyLoadState — P2-8', () => {
  it('加载中 → loading（即使此时有旧数据也不显示为空）', () => {
    expect(classifyLoadState({ error: false, loading: true, count: 0 })).toBe('loading')
    expect(classifyLoadState({ error: false, loading: true, count: 5 })).toBe('loading')
  })

  it('加载失败 → error（而不再是 empty/ready）', () => {
    expect(classifyLoadState({ error: true, loading: false, count: 0 })).toBe('error')
  })

  it('加载成功但有数据 → ready', () => {
    expect(classifyLoadState({ error: false, loading: false, count: 3 })).toBe('ready')
  })

  it('加载成功且无数据 → empty（合法地显示暂无）', () => {
    expect(classifyLoadState({ error: false, loading: false, count: 0 })).toBe('empty')
  })

  it('isLoadError 区分 error', () => {
    expect(isLoadError(classifyLoadState({ error: true, loading: false, count: 0 }))).toBe(true)
    expect(isLoadError(classifyLoadState({ error: false, loading: false, count: 0 }))).toBe(false)
  })
})
