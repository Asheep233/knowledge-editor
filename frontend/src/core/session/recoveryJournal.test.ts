/** UI 工坊 P1-T10：恢复日志（recovery durable）单测。 */
import { describe, expect, it } from 'vitest'

import { MemoryRecoveryStorage, RecoveryJournal } from './recoveryJournal'

const BINDING = { contextId: 'ctx-1', epoch: 1 }

describe('RecoveryJournal（T10 recovery durable）', () => {
  it('begin 持久化记录：write 返回即可见 pending', async () => {
    const storage = new MemoryRecoveryStorage()
    const journal = new RecoveryJournal(storage)
    const rec = await journal.begin(BINDING, 'Articles/a.md', '未保存正文', 2, 'req-1')
    expect(rec.content).toBe('未保存正文')
    expect(storage.text).toContain('req-1')
    expect(journal.pending()).toHaveLength(1)
    expect(journal.pending('Articles/a.md')).toHaveLength(1)
    expect(journal.pending('Articles/b.md')).toHaveLength(0)
  })

  it('commit 后清除并删除持久化（全部提交时 storage 清空）', async () => {
    const storage = new MemoryRecoveryStorage()
    const journal = new RecoveryJournal(storage)
    await journal.begin(BINDING, 'Articles/a.md', 'x', 0, 'req-1')
    await journal.commit('req-1')
    expect(journal.pending()).toHaveLength(0)
    expect(storage.text).toBeNull()
  })

  it('模拟进程崩溃：新实例 load 后仍能读回未提交记录', async () => {
    const storage = new MemoryRecoveryStorage()
    const first = new RecoveryJournal(storage)
    await first.begin(BINDING, 'Articles/a.md', '崩溃前内容', 0, 'req-crash')
    // 新进程/新实例
    const second = new RecoveryJournal(storage)
    const recovered = await second.load()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ requestId: 'req-crash', relPath: 'Articles/a.md', content: '崩溃前内容', revision: 0 })
  })

  it('损坏日志：不抛错、视为空并记录 error（不阻断打开文档）', async () => {
    const storage = new MemoryRecoveryStorage()
    storage.text = '{ not valid json'
    const journal = new RecoveryJournal(storage)
    expect(await journal.load()).toEqual([])
    expect(journal.error()).toMatch(/恢复日志损坏/)
  })
})
