/** H-2 回归：删除文件夹时按前缀关闭其下全部标签（2026-10-17 独立审查）。 */
import { describe, expect, it } from 'vitest'
import { closeTabPrefix, type TabItem } from './TabBar'

const tabs: TabItem[] = [
  { id: 'Articles/A.md', title: 'A' },
  { id: 'Articles/Sub/b.md', title: 'B' },
  { id: 'Articles/Sub/c.md', title: 'C' },
  { id: 'Articles/D.md', title: 'D' },
]

describe('closeTabPrefix — H-2 删除文件夹清标签', () => {
  it('删除非激活文件夹 → 移除其下全部标签，激活项不变', () => {
    const r = closeTabPrefix(tabs, 'Articles/Sub', 'Articles/D.md')
    expect(r.tabs.map((t) => t.id)).toEqual(['Articles/A.md', 'Articles/D.md'])
    expect(r.activeId).toBe('Articles/D.md')
  })

  it('激活项在文件夹内 → 按原位置左邻优先激活', () => {
    const r = closeTabPrefix(tabs, 'Articles/Sub', 'Articles/Sub/c.md')
    expect(r.tabs.map((t) => t.id)).toEqual(['Articles/A.md', 'Articles/D.md'])
    expect(r.activeId).toBe('Articles/A.md')
  })

  it('标签全在文件夹内 → 回空态（activeId=null）', () => {
    const r = closeTabPrefix(tabs.slice(1, 3), 'Articles/Sub', 'Articles/Sub/b.md')
    expect(r.tabs).toEqual([])
    expect(r.activeId).toBeNull()
  })

  it('前缀相似但不是祖先（SubX）→ 不误删', () => {
    const only: TabItem[] = [{ id: 'Articles/SubX/a.md', title: 'x' }]
    const r = closeTabPrefix(only, 'Articles/Sub', 'Articles/SubX/a.md')
    expect(r.tabs).toEqual(only)
    expect(r.activeId).toBe('Articles/SubX/a.md')
  })

  it('文件夹本身作为标签（理论上不会出现）也一并移除', () => {
    const withFolder: TabItem[] = [
      { id: 'Articles/Sub', title: 'Sub' },
      { id: 'Articles/Sub/a.md', title: 'A' },
    ]
    const r = closeTabPrefix(withFolder, 'Articles/Sub', 'Articles/Sub')
    expect(r.tabs).toEqual([])
    expect(r.activeId).toBeNull()
  })
})
