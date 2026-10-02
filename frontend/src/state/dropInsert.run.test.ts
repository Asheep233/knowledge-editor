/**
 * F2 编排级回归：`runDropInsert` = drop 流程（判定 → 上传 → **重新取插入点** → 插入）。
 *
 * 为什么另建文件：`state/dropInsert.test.ts` 的既有 4 条纯函数用例保持原样不动
 * （并发队友可能覆写该文件）；本文件只新增编排层用例，互不干扰。
 *
 * 原缺陷（P3-20 未接线）：handleDrop 在**上传循环之前**只取一次 `posAtCoords`，
 * 循环里所有文件都插入同一个 pos；上传期间切档后仍照插（写进错误文档）。
 * 这里用注入依赖把「每个文件重新判定/重新取位」与「过期结果丢弃」钉死。
 */
import { describe, expect, it, vi } from 'vitest'
import { runDropInsert, shouldInsertDroppedFiles } from './dropInsert'

interface Fake {
  name: string
}

function harness(over: Partial<Parameters<typeof runDropInsert<Fake>>[0]> = {}) {
  const inserts: Array<{ pos: number; res: unknown; file: Fake }> = []
  const positions = [3, 4]
  const params: Parameters<typeof runDropInsert<Fake>>[0] = {
    docIdAtDrop: 'doc-1',
    files: [{ name: 'a.txt' }, { name: 'b.txt' }],
    readCurrentDocId: () => 'doc-1',
    // 每个文件上传完成后重新取一次（模拟 view.posAtCoords）
    readCurrentPos: vi.fn(() => positions.shift() ?? 9),
    readDocEndPos: () => 99,
    upload: vi.fn(async (f: Fake) => ({ path: `p/${f.name}` })),
    insert: (pos, res, file) => inserts.push({ pos, res, file }),
    onError: vi.fn(),
    ...over,
  }
  return { params, inserts }
}

describe('F2 runDropInsert — 多文件插入点逐个重取 + 过期结果丢弃', () => {
  it('两个文件 → 两次取位、两次插入各自的位置（旧实现：同一个 pos 插两次）', async () => {
    const { params, inserts } = harness()

    const result = await runDropInsert(params)

    expect(result).toEqual({ inserted: 2, discarded: 0, failed: 0 })
    expect(params.readCurrentPos).toHaveBeenCalledTimes(2)
    expect(inserts.map((i) => i.pos)).toEqual([3, 4])
    expect(inserts.map((i) => i.file.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('上传期间文档已切换：在途结果丢弃，绝不写进新文档', async () => {
    let currentDocId = 'doc-1'
    const { params, inserts } = harness({
      readCurrentDocId: () => currentDocId,
      upload: vi.fn(async (f: Fake) => {
        currentDocId = 'doc-2' // 上传期间用户切档
        return { path: `p/${f.name}` }
      }),
    })

    const result = await runDropInsert(params)

    // 文档已切换：在途结果 + 其后所有文件一并丢弃（discarded 计「因身份守卫未插入的文件数」）
    expect(result).toEqual({ inserted: 0, discarded: 2, failed: 0 })
    expect(inserts).toEqual([])
    expect(params.readCurrentPos, '过期后不应再触碰视图取位').not.toHaveBeenCalled()
  })

  it('第一个已插入、第二个上传期间切档：只保留第一个，其后全部丢弃', async () => {
    let currentDocId = 'doc-1'
    const { params, inserts } = harness({
      files: [{ name: 'a.txt' }, { name: 'b.txt' }, { name: 'c.txt' }],
      readCurrentDocId: () => currentDocId,
      upload: vi.fn(async (f: Fake) => {
        if (f.name === 'b.txt') currentDocId = 'doc-2'
        return { path: `p/${f.name}` }
      }),
    })

    const result = await runDropInsert(params)

    expect(inserts.map((i) => i.file.name)).toEqual(['a.txt'])
    expect(result).toEqual({ inserted: 1, discarded: 2, failed: 0 })
  })

  it('drop 时无文档（docIdAtDrop=null）：全部丢弃、连上传都不发起', async () => {
    const { params, inserts } = harness({
      docIdAtDrop: null,
      files: [{ name: 'a.txt' }, { name: 'b.txt' }],
      readCurrentDocId: () => 'doc-1',
    })

    const result = await runDropInsert(params)

    expect(result).toEqual({ inserted: 0, discarded: 2, failed: 0 })
    expect(inserts).toEqual([])
    expect(params.upload).not.toHaveBeenCalled()
  })

  it('编辑器失焦（currentPos=null）：回退到文档末尾', async () => {
    const { params, inserts } = harness({
      files: [{ name: 'a.txt' }],
      readCurrentPos: vi.fn(() => null),
      readDocEndPos: () => 77,
    })

    const result = await runDropInsert(params)

    expect(result.inserted).toBe(1)
    expect(inserts[0].pos).toBe(77)
  })

  it('上传失败：onError 收到错误，后续文件继续', async () => {
    const err = new Error('boom')
    const { params, inserts } = harness({
      upload: vi.fn(async (f: Fake) => {
        if (f.name === 'a.txt') throw err
        return { path: `p/${f.name}` }
      }),
    })

    const result = await runDropInsert(params)

    expect(result).toEqual({ inserted: 1, discarded: 0, failed: 1 })
    expect(params.onError).toHaveBeenCalledWith(err, { name: 'a.txt' }, 0)
    expect(inserts.map((i) => i.file.name)).toEqual(['b.txt'])
  })

  it('插入抛错（视图已销毁等）：onError 兜底，不产生未处理拒绝', async () => {
    const { params } = harness({
      files: [{ name: 'a.txt' }],
      insert: () => {
        throw new Error('view destroyed')
      },
    })

    const result = await runDropInsert(params)

    expect(result).toEqual({ inserted: 0, discarded: 0, failed: 1 })
    expect(params.onError).toHaveBeenCalledTimes(1)
  })

  it('判定仍由 shouldInsertDroppedFiles 唯一裁决（编排不得绕过它）', () => {
    // 反向证明：编排层的行为与纯函数判定一致（同令牌 + 有位置 → 插入该位置）
    expect(
      shouldInsertDroppedFiles({ docIdAtDrop: 'doc-1', currentDocId: 'doc-1', currentPos: 5, docEndPos: 9 }),
    ).toEqual({ insert: true, pos: 5 })
  })
})
