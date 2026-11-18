/** 2026-11-18：退出/重载确认框必须列出「哪几篇」文档。 */
import { describe, expect, it } from 'vitest'
import { formatUnsafeDocsMessage } from './desktop'

describe('formatUnsafeDocsMessage', () => {
  it('exit：列出文档标题与个数', () => {
    const msg = formatUnsafeDocsMessage(
      [
        { docId: 'Articles/高等代数 Week 9.md', label: '高等代数 Week 9' },
        { docId: 'Articles/高等代数 Week 10.md', label: '高等代数 Week 10' },
      ],
      'exit',
    )
    expect(msg).toContain('有 2 篇文档未保存成功')
    expect(msg).toContain('高等代数 Week 9')
    expect(msg).toContain('高等代数 Week 10')
    expect(msg).toContain('立即退出将丢失这些修改')
  })

  it('reload：动作文案不同', () => {
    const msg = formatUnsafeDocsMessage([{ docId: 'x', label: '某文档' }], 'reload')
    expect(msg).toContain('重新加载将丢失这些修改')
  })

  it('无标题回退 docId；超过 5 篇截断提示', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ docId: `Articles/d${i}.md` }))
    const msg = formatUnsafeDocsMessage(items, 'exit')
    expect(msg).toContain('Articles/d0.md')
    expect(msg).toContain('等 7 篇')
  })

  it('空列表也不崩（兜底 1 篇文案）', () => {
    expect(formatUnsafeDocsMessage([], 'exit')).toContain('有 1 篇文档未保存成功')
  })
})
