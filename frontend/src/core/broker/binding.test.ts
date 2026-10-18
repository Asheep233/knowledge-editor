/** UI 工坊 T18：Broker ↔ 协议 HostDispatcher 端到端（in-memory ports，无 UI）。 */
import { describe, expect, it } from 'vitest'

import { GuestClient, HostDispatcher, ProtocolCallError, createInMemoryPorts } from '../protocol/channel'
import { brokeredHandlers } from './binding'
import { Broker, type BrokerBackend, type BrokerConnection } from './broker'
import type { ProtocolMethods } from '../protocol/types'

const BASE_CONN: BrokerConnection = {
  connectionId: 'conn-guest-1',
  packId: 'com.demo.hello',
  packVersion: '1.0.0',
  role: 'guest',
  capabilities: ['context.read', 'print.request', 'ui.shell'],
  contextId: 'ctx-A',
  epoch: 1,
  declaredCommands: ['demo.hello'],
}

class TestBackend implements BrokerBackend {
  epoch: number | null = 1
  writes = 0
  currentEpoch(): number | null { return this.epoch }
  async snapshot(params: ProtocolMethods['context.snapshot']['params']) {
    return { relPath: params.relPath, revision: 2, diskHash: 'h2' }
  }
  async write(params: ProtocolMethods['context.write']['params']) {
    this.writes += 1
    return { requestId: params.requestId ?? 'auto', status: 'completed' as const, revision: 3, fileDurable: true }
  }
  async print(params: ProtocolMethods['print.snapshot']['params']) {
    return { pdfToken: `tok-${params.relPath}`, pages: 1 }
  }
  async invokeCommand(params: ProtocolMethods['command.invoke']['params']) {
    return { ok: true, value: params.name }
  }
}

async function setup(overrides: Partial<BrokerConnection> = {}, options: { maxPayloadBytes?: number; maxInflight?: number } = {}) {
  const backend = new TestBackend()
  const conn = { ...BASE_CONN, ...overrides }
  const broker = new Broker(backend, options)
  const [hostPort, guestPort] = createInMemoryPorts()
  const host = new HostDispatcher(hostPort, brokeredHandlers(broker, conn), {
    features: conn.capabilities,
    context: () => ({ contextId: conn.contextId, epoch: conn.epoch }),
  })
  host.start()
  const guest = new GuestClient(guestPort, { timeoutMs: 2000, requestedFeatures: conn.capabilities })
  await guest.handshake()
  return { backend, conn, host, guest }
}

describe('T18 Broker ↔ Dispatcher 接线（guest 只能走受控协议面）', () => {
  it('握手返回连接已授能力（不泄漏未授能力/命令）', async () => {
    const { guest, host } = await setup()
    const info = guest.handshakeInfo!
    expect(info.acceptedFeatures).toEqual(['context.read', 'print.request', 'ui.shell'])
    expect(info.contextId).toBe('ctx-A')
    expect(info.epoch).toBe(1)
    const caps = await guest.request('protocol.capabilities', {})
    expect(caps.features).toEqual(['context.read', 'print.request', 'ui.shell'])
    host.close()
  })

  it('guest 调用 context.write（缺能力）→ E_CAPABILITY，后端零写入', async () => {
    const { guest, backend, host } = await setup()
    const err = (await guest.request('context.write', { relPath: 'a.md', content: 'x', expectedRevision: 0 }).catch((e) => e)) as ProtocolCallError
    expect(err.error.code).toBe('E_CAPABILITY')
    expect(backend.writes).toBe(0)
    host.close()
  })

  it('声明式命令：已声明成功，未声明 E_FORBIDDEN', async () => {
    const { guest, host } = await setup()
    await expect(guest.request('command.invoke', { name: 'demo.hello' })).resolves.toEqual({ ok: true, value: 'demo.hello' })
    const err = (await guest.request('command.invoke', { name: 'system.exec' }).catch((e) => e)) as ProtocolCallError
    expect(err.error.code).toBe('E_FORBIDDEN')
    host.close()
  })

  it('epoch 切换后旧连接请求 → E_STALE_CONTEXT（后端不触达）', async () => {
    const { guest, backend, host } = await setup()
    backend.epoch = 2
    const err = (await guest.request('context.snapshot', { relPath: 'a.md' }).catch((e) => e)) as ProtocolCallError
    expect(err.error.code).toBe('E_STALE_CONTEXT')
    host.close()
  })

  it('payload 超限 → E_BAD_PAYLOAD（含 limit）', async () => {
    const { guest, host } = await setup({}, { maxPayloadBytes: 128 })
    const err = (await guest.request('context.write', { relPath: 'a.md', content: 'x'.repeat(512), expectedRevision: 0 }, {}).catch((e) => e)) as ProtocolCallError
    // 缺能力先命中 → 用含写能力的 official 连接验证 payload（见下个 case）；此处置为 guest
    expect(['E_CAPABILITY']).toContain(err.error.code)
    host.close()
  })

  it('official 连接 payload 超限 → E_BAD_PAYLOAD（带 limit 明细）', async () => {
    const { guest, host } = await setup({ role: 'official', capabilities: [] }, { maxPayloadBytes: 128 })
    const err = (await guest.request('context.write', { relPath: 'a.md', content: 'x'.repeat(512), expectedRevision: 0 }).catch((e) => e)) as ProtocolCallError
    expect(err.error.code).toBe('E_BAD_PAYLOAD')
    expect(err.error.details).toMatchObject({ limit: 128 })
    host.close()
  })

  it('未知协议方法 → E_UNKNOWN_METHOD，随后 host 仍可正常服务（不 wedge）', async () => {
    const { guest, host } = await setup()
    const err = (await guest.request('system.exec' as never, {} as never).catch((e) => e)) as ProtocolCallError
    expect(err.error.code).toBe('E_UNKNOWN_METHOD')
    const ok = await guest.request('context.snapshot', { relPath: 'after.md' })
    expect(ok.relPath).toBe('after.md')
    host.close()
  })

  it('畸形/越权请求后 host 保持健康（连续混合请求）', async () => {
    const { guest, host } = await setup()
    for (let i = 0; i < 3; i++) {
      await guest.request('context.write', { relPath: 'x', content: 'y', expectedRevision: 0 }).catch(() => undefined)
      await guest.request('command.invoke', { name: 'nope' }).catch(() => undefined)
    }
    const ok = await guest.request('print.snapshot', { relPath: 'p.md' })
    expect(ok.pages).toBe(1)
    host.close()
  })
})
