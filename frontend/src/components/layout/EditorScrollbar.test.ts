/**
 * 自绘编辑器滚动条几何计算单测（2026-10-24 用户要求「右侧加个能上下滑动的滑块」）。
 * happy-dom 不做布局，几何计算抽成纯函数 `computeScrollbarMetrics` 覆盖边界：
 *  - 内容不溢出 → 不渲染
 *  - 顶部 scrollTop=0 → thumb 贴顶；滚到底 → thumb 贴底
 *  - thumb 高度按视口/内容比例，且不小于 36px（可拖拽下限）
 */
import { describe, expect, it } from 'vitest'
import { computeScrollbarMetrics } from './EditorScrollbar'

describe('computeScrollbarMetrics · 自绘滚动条', () => {
  it('内容不高于视口：不显示', () => {
    expect(computeScrollbarMetrics(0, 800, 800, 700).visible).toBe(false)
    expect(computeScrollbarMetrics(0, 700, 800, 700).visible).toBe(false)
    // 轨道高度为 0（未布局）也不显示
    expect(computeScrollbarMetrics(0, 5000, 800, 0).visible).toBe(false)
  })

  it('顶部/底部：thumb 贴顶/贴底且高度按比例（不小于 36px）', () => {
    const top = computeScrollbarMetrics(0, 2000, 800, 720)
    expect(top.visible).toBe(true)
    expect(top.thumbTop).toBe(0)
    // 800/2000 * 720 = 288
    expect(Math.round(top.thumbHeight)).toBe(288)
    expect(Math.round(top.thumbTop + top.thumbHeight)).toBeLessThanOrEqual(720)

    const mid = computeScrollbarMetrics((2000 - 800) / 2, 2000, 800, 720)
    expect(Math.round(mid.thumbTop)).toBe(Math.round((720 - 288) / 2))

    const bottom = computeScrollbarMetrics(1200, 2000, 800, 720)
    expect(Math.round(bottom.thumbTop + bottom.thumbHeight)).toBe(720)
  })

  it('超长内容：thumb 高度有 36px 下限；scrollTop 越界时 thumb 不越界', () => {
    const m = computeScrollbarMetrics(999999, 100000, 800, 720)
    expect(m.thumbHeight).toBe(36)
    expect(m.thumbTop).toBeLessThanOrEqual(720 - 36 + 0.5)
    const bad = computeScrollbarMetrics(-100, 2000, 800, 720)
    expect(bad.thumbTop).toBe(0)
  })
})
