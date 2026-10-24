/**
 * 编辑器右侧竖向滚动条（2026-10-24 用户要求）。
 *
 * 背景：Focus UI 为了实现「纸面不因滚动条出现而横向位移」隐藏了正文滚动条（见 index.css
 * `.focus-main-col > main > .ke-scroll { scrollbar-width: none }`）。中文用户实测反馈
 * 「右侧需要能上下拖动的滑块」——原生滚动条在 Windows 11「自动隐藏滚动条」设置下还可能是
 * overlay 形式、常驻不可见，因此这里用**自绘滚动条**：始终可见、可拖动、可点击轨道跳转，
 * 不依赖系统滚动条策略，也不改变正文列宽度（绝对定位覆盖在右侧留白上）。
 *
 * 结构：track（绝对定位覆盖编辑器滚动视口右侧）+ thumb（按 scrollTop/scrollHeight 计算）。
 * 无溢出（内容不高于视口）时整体不渲染。拖拽用 Pointer Events；拖动期间只写
 * `scrollTop`，不产生 React 状态抖动（thumb 由 scroll 事件驱动重算）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export interface ScrollbarMetrics {
  visible: boolean
  thumbTop: number
  thumbHeight: number
  trackHeight: number
}

/** 从滚动容器实测值计算滚动条几何（导出供单测覆盖）。 */
export function computeScrollbarMetrics(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
): ScrollbarMetrics {
  if (scrollHeight <= clientHeight + 1 || trackHeight <= 0) {
    return { visible: false, thumbTop: 0, thumbHeight: 0, trackHeight }
  }
  const minThumb = Math.min(36, trackHeight)
  const thumbHeight = Math.max(minThumb, (clientHeight / scrollHeight) * trackHeight)
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const maxScroll = scrollHeight - clientHeight
  const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0
  return { visible: true, thumbTop: ratio * maxThumbTop, thumbHeight, trackHeight }
}

export interface EditorScrollbarProps {
  /** 编辑器滚动容器（`overflow-y-auto` 的 .ke-scroll） */
  scrollRef: RefObject<HTMLDivElement | null>
  /** 顶部/底部留白（默认避开浮动命令条） */
  top?: number
  bottom?: number
  /** 距窗口右缘（2026-10-24 用户要求：滚动条放在「最右边」，而不是纸面列右缘） */
  right?: number
}

export function EditorScrollbar({ scrollRef, top = 56, bottom = 8, right = 10 }: EditorScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState<ScrollbarMetrics>({ visible: false, thumbTop: 0, thumbHeight: 0, trackHeight: 0 })
  const draggingRef = useRef(false)

  const measure = useCallback(() => {
    const el = scrollRef.current
    const track = trackRef.current
    if (!el || !track) return
    setMetrics(computeScrollbarMetrics(el.scrollTop, el.scrollHeight, el.clientHeight, track.clientHeight))
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // 内容高度变化（输入/折叠/图片加载）与视口变化都要重算
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, scrollRef])

  /** 拖动 thumb：pointermove 期间按位移比例写 scrollTop（不依赖 React 状态，避免拖拽掉帧） */
  const onThumbPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current
      const track = trackRef.current
      if (!el || !track) return
      e.preventDefault()
      draggingRef.current = true
      const startY = e.clientY
      const startScrollLeft = el.scrollTop
      const trackH = track.clientHeight
      const thumbH = Math.max(36, (el.clientHeight / el.scrollHeight) * trackH)
      const maxThumbTop = Math.max(1, trackH - thumbH)
      const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight)
      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - startY
        el.scrollTop = startScrollLeft + (dy / maxThumbTop) * maxScroll
      }
      const onUp = () => {
        draggingRef.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [scrollRef],
  )

  /** 点击轨道：按点击位置翻页（居中定位） */
  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return // 点中 thumb 时由 thumb 自己处理
      const el = scrollRef.current
      const track = trackRef.current
      if (!el || !track) return
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
    },
    [scrollRef],
  )

  return (
    <div
      ref={trackRef}
      data-testid="editor-scrollbar"
      aria-hidden="true"
      onPointerDown={onTrackPointerDown}
      className="ke-editor-scrollbar fixed z-[5] w-[10px] cursor-default select-none print:hidden"
      style={{ top, bottom, right }}
    >
      {metrics.visible ? (
        <div
          data-testid="editor-scrollbar-thumb"
          onPointerDown={onThumbPointerDown}
          className="ke-editor-scrollbar-thumb absolute left-0 w-full cursor-grab rounded-full active:cursor-grabbing"
          style={{ top: metrics.thumbTop, height: metrics.thumbHeight }}
        />
      ) : null}
    </div>
  )
}
