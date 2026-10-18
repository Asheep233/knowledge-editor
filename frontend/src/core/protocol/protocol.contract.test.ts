/**
 * UI 工坊 P1-T11 契约测试：host↔guest 类型化协议（版本/能力/方法/错误码/取消/超时/事件）。
 *
 * 破坏性变更（方法/错误码/事件/消息类型/协议版本）会让本文件失败 —— 必须显式评审后更新
 * types.ts 的 PROTOCOL_CONTRACT 快照。
 */
import { describe, expect, it } from 'vitest'

import { GuestClient, HostDispatcher, ProtocolCallError, createInMemoryPorts, fail, type HostHandlers } from './channel'
import { PROTOCOL_CONTRACT, PROTOCOL_VERSION, protocolError, type HostEvent } from './types'

function setup(overrides: HostHandlers = {}) {
  const [hostPort, guestPort] = createInMemoryPorts()
  const events: HostEvent[] = []
  let epoch = 1
  const defaults: HostHandlers = {
    'protocol.capabilities': () => ({ protocolVersion: PROTOCOL_VERSION, features: ['write', 'print'], contextId: 'ctx-A', epoch }),
    'context.snapshot': (params) => ({ relPath: (params as { relPath: string }).relPath, revision: epoch, diskHash: 'sha-x' }),
    'context.write': async (params) => ({
      requestId: (params as { requestId?: string }).requestId ?? 'auto',
      status: 'completed',
      revision: ++epoch,
      accepted: true,
      recoveryDurable: true,
      fileDurable: true,
    }),
    'print.snapshot': (params) => ({ pdfToken: `tok-${(params as { relPath: string }).relPath}`, pages: 1 }),
    ...overrides,
  }
  const host = new HostDispatcher(hostPort, defaults, { features: ['write', 'print'], context: () => ({ contextId: 'ctx-A', epoch }) })
  host.start()
  const guest = new GuestClient(guestPort, { sdkVersion: 'test-sdk', requestedFeatures: ['write', 'unknown-cap'], timeoutMs: 200 })
  guest.onEvent((e) => events.push(e))
  return { host, guest, events, setEpoch: (n: number) => (epoch = n) }
}

describe('T11 协议契约（host↔guest）', () => {
  it('契约快照：版本/方法/错误码/事件/消息类型完全一致（破坏性变更守卫）', () => {
    expect(PROTOCOL_CONTRACT.protocolVersion).toBe(PROTOCOL_VERSION)
    expect([...PROTOCOL_CONTRACT.methods]).toEqual(['protocol.capabilities', 'context.snapshot', 'context.write', 'print.snapshot'])
    expect([...PROTOCOL_CONTRACT.errorCodes].sort()).toEqual(
      ['E_BAD_PAYLOAD', 'E_CANCELED', 'E_CAPABILITY', 'E_CONFLICT', 'E_FORBIDDEN', 'E_INTERNAL', 'E_STALE_CONTEXT', 'E_TIMEOUT', 'E_UNKNOWN_METHOD', 'E_VERSION'],
    )
    expect([...PROTOCOL_CONTRACT.events]).toEqual(['context-changed', 'theme-changed', 'selection-changed', 'document-saved', 'host-shutdown'])
    expect([...PROTOCOL_CONTRACT.messageTypes].sort()).toEqual(['cancel', 'event', 'handshake', 'handshake.response', 'request', 'response'])
  })

  it('握手：版本一致 → 能力取交集，返回 context/epoch', async () => {
    const { guest } = setup()
    const info = await guest.handshake()
    expect(info.ok).toBe(true)
    expect(info.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(info.acceptedFeatures).toEqual(['write'])
    expect(info.contextId).toBe('ctx-A')
    expect(info.epoch).toBe(1)
  })

  it('握手：协议版本不兼容 → E_VERSION（不可重试）', async () => {
    const [hostPort, guestPort] = createInMemoryPorts()
    const host = new HostDispatcher(hostPort, {}, { context: () => ({ contextId: null, epoch: null }) })
    host.start()
    const results: unknown[] = []
    guestPort.onMessage((m: unknown) => results.push(m))
    // guest → host：从 guest 端口发；声明更高的协议版本
    guestPort.postMessage({ type: 'handshake', protocolVersion: PROTOCOL_VERSION + 1, sdkVersion: 'bad', requestedFeatures: [] })
    await new Promise((r) => setTimeout(r, 30))
    const failure = results.find((m) => (m as { type?: string }).type === 'handshake.response') as { ok: boolean; error: { code: string; retryable: boolean } } | undefined
    expect(failure?.ok).toBe(false)
    expect(failure?.error.code).toBe('E_VERSION')
    expect(failure?.error.retryable).toBe(false)
    host.close()
  })

  it('请求/响应：类型化方法往返（context.write → completed/fileDurable）', async () => {
    const { guest, host } = setup()
    await guest.handshake()
    const result = await guest.request('context.write', { relPath: 'Articles/a.md', content: '正文', expectedRevision: 0, requestId: 'w-1' })
    expect(result.status).toBe('completed')
    expect(result.fileDurable).toBe(true)
    expect(result.revision).toBe(2)
    host.close()
  })

  it('未知方法 → E_UNKNOWN_METHOD（不是字符串错误）', async () => {
    const { guest, host } = setup()
    await guest.handshake()
    await expect(guest.request('nope.method' as never, {} as never)).rejects.toMatchObject({ error: { code: 'E_UNKNOWN_METHOD' } })
    host.close()
  })

  it('host 业务错误保真：fail(code) 原样返回（E_STALE_CONTEXT + retryable）', async () => {
    const { guest, host } = setup({
      'context.write': () => {
        throw fail('E_STALE_CONTEXT', '上下文已切换', { expectedEpoch: 3 }, true)
      },
    })
    await guest.handshake()
    const err2 = (await guest.request('context.write', { relPath: 'x', content: 'c', expectedRevision: 0 }).catch((e) => e)) as ProtocolCallError
    expect(err2).toBeInstanceOf(ProtocolCallError)
    expect(err2.error.code).toBe('E_STALE_CONTEXT')
    expect(err2.error.retryable).toBe(true)
    expect(err2.error.details).toEqual({ expectedEpoch: 3 })
    host.close()
  })

  it('host 未捕获异常 → E_INTERNAL（有 code，不泄漏为裸字符串）', async () => {
    const { guest, host } = setup({
      'context.snapshot': () => {
        throw new Error('boom')
      },
    })
    await guest.handshake()
    await expect(guest.request('context.snapshot', { relPath: 'x' })).rejects.toMatchObject({ error: { code: 'E_INTERNAL', message: 'boom' } })
    host.close()
  })

  it('取消：AbortSignal 触发 → guest 收 E_CANCELED，host handler 收到 abort', async () => {
    let observedAbort = false
    const { guest, host } = setup({
      'context.write': (_params, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            observedAbort = true
            resolve({ requestId: 'aborted', status: 'failed' })
          })
        }),
    })
    await guest.handshake()
    const controller = new AbortController()
    const pending = guest.request('context.write', { relPath: 'x', content: 'c', expectedRevision: 0 }, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ error: { code: 'E_CANCELED' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(observedAbort).toBe(true)
    host.close()
  })

  it('超时：E_TIMEOUT（retryable）且发送 cancel 给 host', async () => {
    let aborted = false
    const { guest, host } = setup({
      'context.write': (_p, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true
            resolve({ requestId: 'x', status: 'failed' })
          })
        }),
    })
    await guest.handshake()
    let caught: unknown
    try {
      await guest.request('context.write', { relPath: 'x', content: 'c', expectedRevision: 0 }, { timeoutMs: 25 })
    } catch (e) {
      caught = e
    }
    const err = caught as ProtocolCallError
    expect(err).toBeInstanceOf(ProtocolCallError)
    expect(err.error.code).toBe('E_TIMEOUT')
    expect(err.error.retryable).toBe(true)
    await new Promise((r) => setTimeout(r, 30))
    expect(aborted).toBe(true)
    host.close()
  })

  it('事件：host.emit → guest onEvent 收到类型化事件', async () => {
    const { guest, host, events } = setup()
    await guest.handshake()
    host.emit({ type: 'theme-changed', theme: 'dark' })
    host.emit({ type: 'context-changed', contextId: 'ctx-B', epoch: 2 })
    await new Promise((r) => setTimeout(r, 20))
    expect(events).toEqual([
      { type: 'theme-changed', theme: 'dark' },
      { type: 'context-changed', contextId: 'ctx-B', epoch: 2 },
    ])
    host.close()
  })

  it('畸形请求（无 method）→ E_BAD_PAYLOAD 响应', async () => {
    const [hostPort, guestPort] = createInMemoryPorts()
    const host = new HostDispatcher(hostPort, {}, { features: [], context: () => ({ contextId: null, epoch: null }) })
    host.start()
    const replies: unknown[] = []
    guestPort.onMessage((m: unknown) => replies.push(m))
    guestPort.postMessage({ type: 'request', requestId: 'bad-1' })
    await new Promise((r) => setTimeout(r, 20))
    const resp = replies.find((m) => (m as { requestId?: string }).requestId === 'bad-1') as { ok: boolean; error: { code: string } } | undefined
    expect(resp?.ok).toBe(false)
    expect(resp?.error.code).toBe('E_BAD_PAYLOAD')
    host.close()
  })

  it('协议层无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    for (const f of ['types.ts', 'channel.ts']) {
      const raw = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(src).not.toMatch(/document\./)
      expect(src).not.toMatch(/window\./)
      expect(src).not.toMatch(/from ['"]react['"]/)
    }
    // ProtocolError 为结构化对象而非仅字符串
    const sample = protocolError('E_CONFLICT', 'x', { currentRevision: 3 })
    expect(typeof sample).toBe('object')
    expect(sample.code).toBe('E_CONFLICT')
  })
})
