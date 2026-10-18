/** UI 工坊 T14 运行时入口：flag/单例/每文档 SaveFn 缓存（注入 fake bridge）。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __setCoreBridgeFactoryForTests,
  coreSaveEnabled,
  resetCoreSaveRuntimeForTests,
  saveViaCore,
} from './coreSaveRuntime'

afterEach(() => resetCoreSaveRuntimeForTests())

describe('T14 coreSaveRuntime（ADR-002 步骤2 入口）', () => {
  it('flag 默认关闭（VITE_KE_CORE_SAVE 未设置）', () => {
    expect(coreSaveEnabled()).toBe(false)
  })

  it('saveViaCore：每文档创建一次 SaveFn，内容 provider 取最新内容', async () => {
    const seen: string[] = []
    let revision = 0
    const saveFn = vi.fn(async (signal?: AbortSignal) => {
      expect(signal?.aborted).toBeFalsy()
      revision += 1
      return { status: 'saved', revision }
    })
    const createSaveFn = vi.fn(async (relPath: string, getContent: () => string) => {
      return async (signal?: AbortSignal) => {
        seen.push(`${relPath}:${getContent()}`)
        return await saveFn(signal)
      }
    })
    __setCoreBridgeFactoryForTests(() => ({ createSaveFn }))
    const r1 = await saveViaCore('Articles/a.md', '第一版')
    const r2 = await saveViaCore('Articles/a.md', '第二版')
    expect(r1).toEqual({ status: 'saved', revision: 1 })
    expect(r2).toEqual({ status: 'saved', revision: 2 })
    expect(createSaveFn).toHaveBeenCalledTimes(1) // 每文档缓存
    expect(seen).toEqual(['Articles/a.md:第一版', 'Articles/a.md:第二版'])
  })

  it('saveViaCore：不同文档各自创建 SaveFn', async () => {
    const createSaveFn = vi.fn(async () => async () => ({ status: 'saved', revision: 1 }))
    __setCoreBridgeFactoryForTests(() => ({ createSaveFn }))
    await saveViaCore('Articles/a.md', 'a')
    await saveViaCore('Articles/b.md', 'b')
    expect(createSaveFn).toHaveBeenCalledTimes(2)
  })

  it('reset 后重建桥并重新创建 SaveFn', async () => {
    const createSaveFn = vi.fn(async () => async () => ({ status: 'saved', revision: 1 }))
    __setCoreBridgeFactoryForTests(() => ({ createSaveFn }))
    await saveViaCore('Articles/a.md', 'x')
    resetCoreSaveRuntimeForTests()
    __setCoreBridgeFactoryForTests(() => ({ createSaveFn }))
    await saveViaCore('Articles/a.md', 'y')
    expect(createSaveFn).toHaveBeenCalledTimes(2)
  })
})
