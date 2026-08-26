/** P1-7 回归测试：打开/保存响应带请求序号（经 ref 读最新 id）。 */
import { describe, expect, it } from 'vitest'
import { createLatestRef } from './fsEvent'
import { createRequestSeq, openWithSeq, shouldAcceptSave } from './requestSeq'

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('openWithSeq — 快速点 A→B，A 响应后到不覆盖 B', () => {
  it('先请求 A（慢）、再请求 B（快），最终应用的是 B，A 被丢弃', async () => {
    const seq = createRequestSeq()
    const applied: string[] = []
    const stale: string[] = []

    const a = openWithSeq('Articles/a.md', {
      fetchFn: async (id) => {
        await delay(100)
        return id
      },
      seq,
      apply: (id) => applied.push(`applied:${id}`),
      onStale: () => stale.push('a-stale'),
    })
    const b = openWithSeq('Articles/b.md', {
      fetchFn: async (id) => {
        await delay(10)
        return id
      },
      seq,
      apply: (id) => applied.push(`applied:${id}`),
      onStale: () => stale.push('b-stale'),
    })

    await Promise.all([a, b])
    expect(applied).toEqual(['applied:Articles/b.md'])
    expect(stale).toContain('a-stale')
    expect(stale).not.toContain('b-stale')
  })

  it('串行请求（B 在 A 之后开始）则两次都应用', async () => {
    const seq = createRequestSeq()
    const applied: string[] = []
    await openWithSeq('Articles/a.md', {
      fetchFn: async () => {
        await delay(10)
        return 'a'
      },
      seq,
      apply: (id) => applied.push(id),
    })
    await openWithSeq('Articles/b.md', {
      fetchFn: async () => {
        await delay(10)
        return 'b'
      },
      seq,
      apply: (id) => applied.push(id),
    })
    expect(applied).toEqual(['a', 'b'])
  })
})

describe('shouldAcceptSave — 保存响应仅当 doc.id 等于当前文档才应用', () => {
  it('当前文档为 B 时，A 的保存响应被丢弃，B 的保存响应被接受', () => {
    const ref = createLatestRef<string | null>('Articles/b.md')
    expect(shouldAcceptSave('Articles/a.md', ref)).toBe(false)
    expect(shouldAcceptSave('Articles/b.md', ref)).toBe(true)
  })

  it('无文档打开（ref=null）时任何保存响应都不更新当前文档', () => {
    const ref = createLatestRef<string | null>(null)
    expect(shouldAcceptSave('Articles/a.md', ref)).toBe(false)
  })

  it('ref 更新到新文档后，旧文档保存响应被丢弃（模拟打开新文档）', () => {
    const ref = createLatestRef<string | null>('Articles/a.md')
    expect(shouldAcceptSave('Articles/a.md', ref)).toBe(true)
    ref.current = 'Articles/c.md'
    expect(shouldAcceptSave('Articles/a.md', ref)).toBe(false)
    expect(shouldAcceptSave('Articles/c.md', ref)).toBe(true)
  })
})
