/** UI 工坊 T24/T23：LocalTrustStore 持久化（注入 storage）。 */
import { describe, expect, it } from 'vitest'

import { LocalTrustStore, MemoryKeyValueStorage } from './localTrustStore'

describe('LocalTrustStore（过渡持久化）', () => {
  it('默认 community；grant/revoke 持久化并可跨实例读取', async () => {
    const storage = new MemoryKeyValueStorage()
    const store = new LocalTrustStore(storage)
    expect(await store.tierOf('com.demo.a')).toBe('community')
    await store.grant('com.demo.a', 'trusted')
    const again = new LocalTrustStore(storage)
    expect(await again.tierOf('com.demo.a')).toBe('trusted')
    expect(await again.list()).toEqual([{ packId: 'com.demo.a', tier: 'trusted' }])
    await again.revoke('com.demo.a')
    expect(await new LocalTrustStore(storage).tierOf('com.demo.a')).toBe('community')
    expect(storage.getItem('ke.workshop.trust')).toBeNull()
  })

  it('损坏 JSON 视为空（不阻断）', async () => {
    const storage = new MemoryKeyValueStorage()
    storage.setItem('ke.workshop.trust', '{bad json')
    const store = new LocalTrustStore(storage)
    expect(await store.tierOf('x')).toBe('community')
    await store.grant('x', 'trusted')
    expect(await store.tierOf('x')).toBe('trusted')
  })

  it('非法等级被忽略', async () => {
    const storage = new MemoryKeyValueStorage()
    storage.setItem('ke.workshop.trust', JSON.stringify({ a: 'root', b: 'trusted' }))
    const store = new LocalTrustStore(storage)
    expect(await store.tierOf('a')).toBe('community')
    expect(await store.tierOf('b')).toBe('trusted')
  })
})
