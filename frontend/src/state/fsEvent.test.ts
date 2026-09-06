/** P1-8 / P3-7 回归测试：文件系统事件判定纯函数。 */
import { describe, expect, it } from 'vitest'
import type { FsEvent } from '../types'
import {
  createLatestRef,
  classifyFsEvent,
  isCurrentDocEvent,
  makeFsEventReader,
  SELF_WRITE_COOLDOWN_MS,
} from './fsEvent'

function ev(type: FsEvent['type'], rel: string): FsEvent {
  return { seq: 0, type, rel }
}

describe('classifyFsEvent — P1-8 外部修改检测', () => {
  it('modified 事件且匹配当前 id → 弹窗（surface=modified）', () => {
    const d = classifyFsEvent(ev('modified', 'Articles/a.md'), {
      currentId: 'Articles/a.md',
      lastSavedAt: 0,
      nowMs: 100000,
    })
    expect(d.surface).toBe('modified')
    expect(d.refreshTree).toBe(false)
  })

  it('自身保存后 2.5s 内的 modified 事件 → 不弹窗（自写抑制）', () => {
    const d = classifyFsEvent(ev('modified', 'Articles/a.md'), {
      currentId: 'Articles/a.md',
      lastSavedAt: 90000,
      nowMs: 90000 + SELF_WRITE_COOLDOWN_MS - 100,
    })
    expect(d.surface).toBe('none')
  })

  it('F10：冷却窗 600ms，保存后 1.5s 的真实外部修改仍弹窗（不再被吞）', () => {
    const d = classifyFsEvent(
      { type: 'modified', rel: 'Articles/a.md' } as never,
      { currentId: 'Articles/a.md', lastSavedAt: 90000, nowMs: 90000 + 1500 },
    )
    expect(d.surface).toBe('modified')
  })

  it('超过 2.5s 的 modified 事件 → 恢复弹窗', () => {
    const d = classifyFsEvent(ev('modified', 'Articles/a.md'), {
      currentId: 'Articles/a.md',
      lastSavedAt: 90000,
      nowMs: 90000 + SELF_WRITE_COOLDOWN_MS + 1,
    })
    expect(d.surface).toBe('modified')
  })

  it('不匹配当前 id 的 modified 事件 → 不弹窗、不刷新树', () => {
    const d = classifyFsEvent(ev('modified', 'Articles/b.md'), {
      currentId: 'Articles/a.md',
      lastSavedAt: 0,
      nowMs: 100000,
    })
    expect(d.surface).toBe('none')
    expect(d.refreshTree).toBe(false)
  })

  it('无文档打开时任何事件都不弹窗', () => {
    expect(classifyFsEvent(ev('modified', 'a'), { currentId: null, lastSavedAt: 0 }).surface).toBe('none')
    expect(classifyFsEvent(ev('deleted', 'a'), { currentId: null, lastSavedAt: 0 }).surface).toBe('none')
  })
})

describe('classifyFsEvent — P3-7 外部删除当前文档', () => {
  it('deleted 事件且匹配当前 id → surface=deleted 且刷新树', () => {
    const d = classifyFsEvent(ev('deleted', 'Articles/a.md'), {
      currentId: 'Articles/a.md',
      lastSavedAt: 0,
    })
    expect(d.surface).toBe('deleted')
    expect(d.refreshTree).toBe(true)
  })

  it('deleted 事件但不匹配当前 id → 仅刷新树，不提示', () => {
    const d = classifyFsEvent(ev('deleted', 'Articles/c.md'), {
      currentId: 'Articles/a.md',
      lastSavedAt: 0,
    })
    expect(d.surface).toBe('none')
    expect(d.refreshTree).toBe(true)
  })

  it('created 事件 → 仅刷新树，不弹窗（即使匹配当前 id 也只是树变化）', () => {
    const d = classifyFsEvent(ev('created', 'Articles/a.md'), {
      currentId: 'Articles/a.md',
      lastSavedAt: 0,
    })
    expect(d.surface).toBe('none')
    expect(d.refreshTree).toBe(true)
  })
})

describe('makeFsEventReader — 打开文档后能读到最新 id（ref 修复）', () => {
  it('模拟 ref：更新 current 后，事件处理器读到的是最新 id，而非闭包捕获的旧值', () => {
    const ref = createLatestRef<string | null>(null)
    const read = makeFsEventReader(ref)
    expect(read()).toBeNull()

    // 首次打开 A
    ref.current = 'Articles/a.md'
    expect(read()).toBe('Articles/a.md')

    // 切换到 B
    ref.current = 'Articles/b.md'
    expect(read()).toBe('Articles/b.md')

    // 用读到的 id 判定：只有 B 会命中
    expect(isCurrentDocEvent(ev('modified', 'Articles/a.md'), { currentId: read(), lastSavedAt: 0 })).toBe(false)
    expect(isCurrentDocEvent(ev('modified', 'Articles/b.md'), { currentId: read(), lastSavedAt: 0 })).toBe(true)
  })
})
