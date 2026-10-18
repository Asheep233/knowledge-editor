/** UI 工坊 P1-T11：带标签/方向传输适配器 + 背压（DOM-free 核心）测试。 */
import { describe, expect, it } from 'vitest'

import { GuestClient, HostDispatcher, ProtocolCallError, createInMemoryPorts } from './channel'
import { createMemoryWirePair, createWireTransport } from './transport'
import type { HostEvent } from './types'

async function setupWire(channelId = 'ch-1') {
  const [hostEndpoint, guestEndpoint] = createMemoryWirePair()
  const hostWire = createWireTransport(hostEndpoint, { channelId, role: 'host' })
  const guestWire = createWireTransport(guestEndpoint, { channelId, role: 'guest' })
  const host = new HostDispatcher(hostWire.port, {
    'protocol.capabilities': () => ({ protocolVersion: 1, features: ['write'], contextId: 'ctx-w', epoch: 1 }),
    'context.write': (params) => {
      const p = params as { content: string; requestId?: string }
      host.emit({ type: 'theme-changed', theme: 'dark' })
      return {
        requestId: p.requestId ?? 'auto',
        status: 'completed' as const,
        revision: 1,
        accepted: true,
        recoveryDurable: true,
        fileDurable: true,
        // 回显内容长度（大消息验证）
        ...({ contentLength: p.content.length } as object),
      }
    },
    'context.snapshot': (params) => ({ relPath: (params as { relPath: string }).relPath, revision: 0, diskHash: 'h' }),
    'print.snapshot': () => ({ pdfToken: 't', pages: 1 }),
  }, { features: ['write'], context: () => ({ contextId: 'ctx-w', epoch: 1 }) })
  host.start()
  const guest = new GuestClient(guestWire.port, { timeoutMs: 2000 })
  const events: HostEvent[] = []
  guest.onEvent((e) => events.push(e))
  await guest.handshake()
  return { host, guest, events, hostWire, guestWire }
}

describe('T11 wire transport（iframe postMessage JSON 桥核心）', () => {
  it('握手 + 类型化请求经 wire 传输往返（同一协议实现）', async () => {
    const { host, guest, events } = await setupWire()
    const result = await guest.request('context.write', { relPath: 'a.md', content: '正文', expectedRevision: 0, requestId: 'w1' })
    expect(result.status).toBe('completed')
    expect(result.fileDurable).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(events.map((e) => e.type)).toContain('theme-changed')
    host.close()
  })

  it('大消息（256KB）经结构化 clone wire 完整送达', async () => {
    const { host, guest } = await setupWire()
    const big = 'x'.repeat(256 * 1024)
    const result = (await guest.request('context.write', { relPath: 'big.md', content: big, expectedRevision: 0 })) as unknown as { contentLength: number }
    expect(result.contentLength).toBe(big.length)
    host.close()
  })

  it('channelId 隔离：其它 channel 的消息被丢弃并计数', async () => {
    const [hostEndpoint, guestEndpoint] = createMemoryWirePair()
    const hostWire = createWireTransport(hostEndpoint, { channelId: 'ch-A', role: 'host' })
    const otherWire = createWireTransport(guestEndpoint, { channelId: 'ch-B', role: 'guest' })
    otherWire.port.postMessage({ type: 'request', requestId: 'x', method: 'nope', params: {} })
    await new Promise((r) => setTimeout(r, 20))
    expect(hostWire.stats.droppedOtherChannel).toBe(1)
    expect(hostWire.stats.received).toBe(0)
  })

  it('畸形信封被丢弃计数，不抛错', async () => {
    const [hostEndpoint, guestEndpoint] = createMemoryWirePair()
    const hostWire = createWireTransport(hostEndpoint, { channelId: 'ch-C', role: 'host' })
    guestEndpoint.send({ broken: true } as never)
    await new Promise((r) => setTimeout(r, 10))
    expect(hostWire.stats.malformed).toBe(1)
  })

  it('背压：在途请求超过 maxInflight → E_BUSY（retryable），完成后可继续', async () => {
    const [hostPort, guestPort] = createInMemoryPorts()
    let release: (() => void) | null = null
    let calls = 0
    const host = new HostDispatcher(hostPort, {
      'protocol.capabilities': () => ({ protocolVersion: 1, features: ['write'], contextId: 'c', epoch: 1 }),
      'context.write': () => {
        calls += 1
        if (calls === 1) {
          return new Promise((resolve) => {
            release = () => resolve({ requestId: 'r', status: 'completed' as const, revision: 1, fileDurable: true })
          })
        }
        return { requestId: 'r', status: 'completed' as const, revision: 1, fileDurable: true }
      },
    }, { features: ['write'], context: () => ({ contextId: 'c', epoch: 1 }) })
    host.start()
    const guest = new GuestClient(guestPort, { maxInflight: 1, timeoutMs: 2000 })
    await guest.handshake()
    const first = guest.request('context.write', { relPath: 'a', content: 'x', expectedRevision: 0 })
    await new Promise((r) => setTimeout(r, 20))
    await expect(guest.request('context.write', { relPath: 'a', content: 'y', expectedRevision: 0 })).rejects.toMatchObject({ error: { code: 'E_BUSY', retryable: true } })
    release!()
    await first
    const third = await guest.request('context.write', { relPath: 'a', content: 'z', expectedRevision: 0 })
    expect(third.status).toBe('completed')
    host.close()
  })

  it('错误：返回 ProtocolCallError 且 code 可判（不依赖字符串）', async () => {
    const [, guestPort] = createInMemoryPorts()
    const guest = new GuestClient(guestPort)
    await expect(guest.request('context.snapshot', { relPath: 'x' })).rejects.toMatchObject({ error: { code: 'E_VERSION' } })
    expect(new ProtocolCallError({ code: 'E_VERSION', message: 'x', retryable: false }).error.code).toBe('E_VERSION')
  })
})
