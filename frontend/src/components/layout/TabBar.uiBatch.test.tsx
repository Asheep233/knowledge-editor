/**
 * task-56 UI-1：**文件夹** rename/move 的标签前缀替换。
 *
 * 修前：App.handleFsMutation 对文件夹也调用精确匹配的 `replaceTab` →
 * `Articles/Sub/a.md` 这类子文档标签与激活路径留在旧前缀（保存 PUT 404、
 * 标签点击静默失败）。本套件锁死 `replaceTabPrefix` 的前缀语义与边界。
 */
import { describe, expect, it } from 'vitest'
import { replaceTab, replaceTabPrefix, type TabItem } from './TabBar'

const tabs = (): TabItem[] => [
  { id: 'Articles/Sub/a.md', title: 'A' },
  { id: 'Articles/b.md', title: 'B' },
  { id: 'Modules/Sub/c.md', title: 'C' },
]

describe('replaceTabPrefix — UI-1 文件夹前缀替换', () => {
  it('文件夹重命名：自身与全部子文档标签整体搬到新前缀（顺序/标题不变）', () => {
    const out = replaceTabPrefix(tabs(), 'Articles/Sub', 'Articles/Renamed')
    expect(out.map((t) => t.id)).toEqual([
      'Articles/Renamed/a.md',
      'Articles/b.md',
      'Modules/Sub/c.md',
    ])
    expect(out.map((t) => t.title)).toEqual(['A', 'B', 'C'])
  })

  it('文件夹移动：前缀换父目录，子层级保持', () => {
    const out = replaceTabPrefix(tabs(), 'Articles/Sub', 'Articles/Nested/Sub')
    expect(out[0].id).toBe('Articles/Nested/Sub/a.md')
  })

  it('精确 id（文件重命名）同样适用，且可只更新该标签标题', () => {
    const out = replaceTabPrefix(tabs(), 'Articles/b.md', 'Articles/b2.md', 'B2')
    expect(out[1]).toEqual({ id: 'Articles/b2.md', title: 'B2' })
  })

  it('前缀必须落在路径分隔符边界：`Articles/Sub` 不得命中 `Articles/Sub2`', () => {
    const src: TabItem[] = [{ id: 'Articles/Sub2/x.md', title: 'X' }]
    expect(replaceTabPrefix(src, 'Articles/Sub', 'Articles/Y')).toEqual(src)
  })

  it('无匹配（空文件夹）不新增标签、返回原引用', () => {
    const src = tabs()
    expect(replaceTabPrefix(src, 'Articles/Empty', 'Articles/Empty2')).toBe(src)
  })

  it('对照：精确替换 replaceTab 不处理子文档（UI-1 修的就是这个差异）', () => {
    const out = replaceTab(tabs(), 'Articles/Sub', 'Articles/Renamed')
    expect(out[0].id).toBe('Articles/Sub/a.md')
  })
})
