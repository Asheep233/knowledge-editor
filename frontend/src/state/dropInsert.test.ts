/** P3-20 回归测试：多文件拖拽插入判定。 */
import { describe, expect, it } from 'vitest'
import { shouldInsertDroppedFiles } from './dropInsert'

describe('shouldInsertDroppedFiles — P3-20', () => {
  it('文档未切换：插入当前 selection 位置', () => {
    const d = shouldInsertDroppedFiles({
      docIdAtDrop: 'Articles/a.md',
      currentDocId: 'Articles/a.md',
      currentPos: 42,
      docEndPos: 100,
    })
    expect(d).toEqual({ insert: true, pos: 42 })
  })

  it('上传期间文档已切换：丢弃插入（避免写入错误文档）', () => {
    const d = shouldInsertDroppedFiles({
      docIdAtDrop: 'Articles/a.md',
      currentDocId: 'Articles/b.md',
      currentPos: 42,
      docEndPos: 100,
    })
    expect(d.insert).toBe(false)
  })

  it('drop 时无文档打开：丢弃插入', () => {
    const d = shouldInsertDroppedFiles({
      docIdAtDrop: null,
      currentDocId: 'Articles/a.md',
      currentPos: 42,
      docEndPos: 100,
    })
    expect(d.insert).toBe(false)
  })

  it('编辑器已失焦（无 selection）：追加到文档末尾', () => {
    const d = shouldInsertDroppedFiles({
      docIdAtDrop: 'Articles/a.md',
      currentDocId: 'Articles/a.md',
      currentPos: null,
      docEndPos: 88,
    })
    expect(d).toEqual({ insert: true, pos: 88 })
  })
})
