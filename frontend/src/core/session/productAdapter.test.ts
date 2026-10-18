/** UI 工坊 P2-T14：Core ↔ 产品 UI 适配层（无 React/DOM 测试）。 */
import { describe, expect, it } from 'vitest'

import { MemoryTransport } from './memoryTransport'
import { createCoreSaveFn, createEditHook, createSaveStateReporter, hasDirtyDocument, switchDocument, CoreSaveError } from './productAdapter'
import { SaveCoordinator, hashContent } from './saveCoordinator'
import type { DocumentSnapshot } from './types'

const REL = 'Articles/note.md'
const snap = (revision = 0, content = '初始'): DocumentSnapshot => ({ relPath: REL, content, revision, diskHash: hashContent(content) })

function setup(transport = new MemoryTransport()) {
  const coord = new SaveCoordinator({ transport, binding: { contextId: 'ctx-A', epoch: 1 } })
  coord.registerSnapshot(snap())
  return { coord, transport }
}

describe('T14 适配层：既有 SaveFn/onUpdate/状态回调 → Core', () => {
  it('产品 SaveFn 只在 saved 后 resolve，并返回 revision', async () => {
    const { coord } = setup()
    const save = createCoreSaveFn(coord, REL)
    createEditHook(coord, REL)('新内容')
    const result = (await save()) as { status: string; revision: number }
    expect(result).toEqual({ status: 'saved', revision: 1 })
  })

  it('产品 SaveFn 在 revision 冲突时抛类型化错误（旧 UI 可显示 dirty/错误）', async () => {
    const transport = new MemoryTransport({
      resultFor: (req) => ({ requestId: req.requestId, contextId: req.contextId, relPath: req.relPath, status: 'conflict', kind: 'revision', currentRevision: 3 }),
    })
    const { coord } = setup(transport)
    const save = createCoreSaveFn(coord, REL)
    createEditHook(coord, REL)('x')
    const err = (await save().catch((e) => e)) as CoreSaveError
    expect(err).toBeInstanceOf(CoreSaveError)
    expect(err.code).toBe('E_CONFLICT')
    expect(err.status).toBe('conflict_revision')
  })

  it('AbortSignal 已取消 → 抛 AbortError，且不发起保存', async () => {
    const { coord, transport } = setup()
    const save = createCoreSaveFn(coord, REL)
    const controller = new AbortController()
    controller.abort()
    await expect(save(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport.calls).toHaveLength(0)
  })

  it('状态回调：saving → saved（旧 UI 状态条可用）', async () => {
    const { coord } = setup()
    const events: string[] = []
    createSaveStateReporter(coord, REL, {
      onSaving: () => events.push('saving'),
      onSaved: (rev) => events.push(`saved:${rev}`),
    })
    const save = createCoreSaveFn(coord, REL)
    createEditHook(coord, REL)('内容')
    await save()
    expect(events).toEqual(['saving', 'saved:1'])
  })

  it('切档登记新快照 + dirty 判定（切档前 flush 依据）', async () => {
    const { coord } = setup()
    expect(hasDirtyDocument(coord, REL)).toBe(false)
    createEditHook(coord, REL)('未保存')
    expect(hasDirtyDocument(coord, REL)).toBe(true)
    switchDocument(coord, { ...snap(5, '新档'), relPath: 'Articles/other.md' })
    expect(coord.snapshot('Articles/other.md').revision).toBe(5)
    expect(coord.state('Articles/other.md').status).toBe('idle')
  })

  it('适配层无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/session/productAdapter.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
