/** SD-01 回归：侧车重启后工作区一致性判定（纯函数）。 */
import { describe, expect, it } from 'vitest'
import { decideWorkspaceReconcile } from './workspaceReconcile'

describe('decideWorkspaceReconcile — SD-01 侧车重启工作区对齐', () => {
  it('后端与 UI 工作区一致 → none（不打扰用户）', () => {
    expect(decideWorkspaceReconcile('C:/ws/B', { open: true, root: 'C:/ws/B' })).toBe('none')
  })

  it('后端重启回到默认 A 而 UI 在 B → reopen（否则保存会写进 A）', () => {
    expect(decideWorkspaceReconcile('C:/ws/B', { open: true, root: 'C:/ws/A' })).toBe('reopen')
  })

  it('后端未打开工作区 → reopen', () => {
    expect(decideWorkspaceReconcile('C:/ws/B', { open: false })).toBe('reopen')
  })

  it('UI 未打开工作区 → none（无需对齐）', () => {
    expect(decideWorkspaceReconcile(null, { open: true, root: 'C:/ws/A' })).toBe('none')
  })
})
