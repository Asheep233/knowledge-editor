/**
 * R1-S：源码 no-op 回程复用判定单测（正例 + 每个失效条件各一条反例）。
 * 目标：任何「不能确定原文未变/身份未变」的情况都必须返回 false（走重解析）。
 */
import { describe, expect, it } from 'vitest'
import { canReusePmOnSourceExit, type SourceCheckpoint } from './sourceReuse'

const pmDoc = { type: 'doc', content: [] }
const cp: SourceCheckpoint = {
  docId: 'Articles/a.md',
  loadGeneration: 7,
  reloadToken: 3,
  pmDoc,
  sourceBody: '# 标题\n\n正文',
}
const state = () => ({
  docId: 'Articles/a.md',
  loadGeneration: 7,
  reloadToken: 3,
  pmDoc,
  editorDocId: 'Articles/a.md' as string | null,
  sourceBodyAtExit: '# 标题\n\n正文',
})

describe('canReusePmOnSourceExit · no-op 源码往返复用', () => {
  it('全部条件一致 → true（不重解析）', () => {
    expect(canReusePmOnSourceExit(cp, state())).toBe(true)
  })

  it('无反例：无 checkpoint（源码优先直接打开/PM 未驻留）→ false', () => {
    expect(canReusePmOnSourceExit(null, state())).toBe(false)
    expect(canReusePmOnSourceExit(undefined, state())).toBe(false)
  })

  it('反例：源码被编辑（正文不同）→ false', () => {
    expect(canReusePmOnSourceExit(cp, { ...state(), sourceBodyAtExit: '# 标题\n\n正文改了' })).toBe(false)
  })

  it('反例：切到别的文档 → false', () => {
    expect(canReusePmOnSourceExit(cp, { ...state(), docId: 'Articles/b.md', editorDocId: 'Articles/b.md' })).toBe(false)
  })

  it('反例：装载代次变化（外部 reload/恢复/重新装载）→ false', () => {
    expect(canReusePmOnSourceExit(cp, { ...state(), loadGeneration: 8 })).toBe(false)
  })

  it('反例：reloadToken 变化（同 ID 外部版本重载）→ false', () => {
    expect(canReusePmOnSourceExit(cp, { ...state(), reloadToken: 4 })).toBe(false)
  })

  it('反例：编辑器当前没载着本文档（editorDocId 失配）→ false', () => {
    expect(canReusePmOnSourceExit(cp, { ...state(), editorDocId: null })).toBe(false)
    expect(canReusePmOnSourceExit(cp, { ...state(), editorDocId: 'Articles/other.md' })).toBe(false)
  })

  it('反例：驻留 PM doc 引用已被替换（setKeContent/重建）→ false', () => {
    expect(canReusePmOnSourceExit(cp, { ...state(), pmDoc: { type: 'doc', content: [1] } })).toBe(false)
  })
})
