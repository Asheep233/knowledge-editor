/** UI 工坊 W02：表单交接（Core，无 DOM）。 */
import { describe, expect, it, vi } from 'vitest'

import { createFormHandoff } from './formHandoff'

describe('W02 FormHandoff', () => {
  it('begin/setField/submit → 宿主原子提交，提交后关闭且旧值不可再改', async () => {
    const onCommit = vi.fn(async () => undefined)
    const form = createFormHandoff({ onCommit })
    form.begin({ title: '旧标题', tags: ['a'] })
    form.setField('title', '新标题')
    form.setField('tags', ['a', 'b'])
    const result = await form.submit('req-1')
    expect(result.status).toBe('committed')
    expect(onCommit).toHaveBeenCalledWith({ title: '新标题', tags: ['a', 'b'], draft: undefined }, 'req-1')
    expect(form.isOpen).toBe(false)
    form.setField('title', '关闭后修改') // 无效
    expect(form.current.title).toBe('新标题')
  })

  it('提交失败 → 旧会话保留，可继续编辑后重试', async () => {
    let fail = true
    const onCommit = vi.fn(async () => {
      if (fail) throw new Error('E_COMMIT: disk busy')
    })
    const form = createFormHandoff({ onCommit })
    form.begin({ title: 'T' })
    const first = await form.submit('r1')
    expect(first.status).toBe('rejected')
    expect(first.reason).toContain('disk busy')
    expect(form.isOpen).toBe(true) // 失败不丢
    fail = false
    form.setField('title', 'T2')
    expect((await form.submit('r2')).status).toBe('committed')
  })

  it('重复 requestId 幂等（不重复 commit）', async () => {
    const onCommit = vi.fn(async () => undefined)
    const form = createFormHandoff({ onCommit })
    form.begin({ title: 'T' })
    await form.submit('same')
    const again = await form.submit('same')
    expect(again.status).toBe('duplicate')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('迟到/已关闭后的提交被丢弃（不影响旧会话）', async () => {
    const form = createFormHandoff({ onCommit: vi.fn(async () => undefined) })
    form.begin({ title: 'T' })
    form.cancel()
    const late = await form.submit('late')
    expect(late.status).toBe('closed')
  })

  it('连接失效 → 拒绝提交并保留旧会话（原子切写资格）', async () => {
    let can = false
    const form = createFormHandoff({ onCommit: vi.fn(async () => undefined), canCommit: () => can })
    form.begin({ title: 'T' })
    const res = await form.submit('r')
    expect(res.status).toBe('rejected')
    expect(res.reason).toContain('E_STALE_CONNECTION')
    can = true
    expect((await form.submit('r2')).status).toBe('committed')
  })

  it('drain 等待在途提交；isCommitting 反映状态', async () => {
    let release: (() => void) | null = null
    const form = createFormHandoff({
      onCommit: () => new Promise<void>((resolve) => { release = resolve }),
    })
    form.begin({ title: 'T' })
    const p = form.submit('inflight')
    expect(form.isCommitting).toBe(true)
    const drainP = form.drain()
    release!()
    expect((await p).status).toBe('committed')
    await drainP
    expect(form.isCommitting).toBe(false)
  })
})
