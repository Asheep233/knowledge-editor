/** UI 工坊 T18：Broker 能力/上下文/命令白名单/有界代理（Core 单测）。 */
import { describe, expect, it } from 'vitest'

import { Broker, connectionHasCapability, type BrokerBackend, type BrokerConnection } from './broker'
import type { ProtocolMethods } from '../protocol/types'

const CONN: BrokerConnection = {
  connectionId: 'conn-1',
  packId: 'com.demo.hello',
  packVersion: '1.0.0',
  role: 'guest',
  capabilities: ['context.read', 'print.request', 'ui.shell'],
  contextId: 'ctx-A',
  epoch: 3,
  declaredCommands: ['demo.hello'],
}

function conn(overrides: Partial<BrokerConnection> = {}): BrokerConnection {
  return { ...CONN, ...overrides }
}

class FakeBackend implements BrokerBackend {
  epoch: number | null = 3
  writes: Array<{ relPath: string; content: string }> = []
  blocking = false
  pending: Array<(value: ProtocolMethods['context.write']['result']) => void> = []
  throwOnWrite: Error | null = null

  currentEpoch(): number | null {
    return this.epoch
  }

  async snapshot(params: ProtocolMethods['context.snapshot']['params']) {
    return { relPath: params.relPath, revision: 1, diskHash: 'hash-1' }
  }

  write(params: ProtocolMethods['context.write']['params']): Promise<ProtocolMethods['context.write']['result']> {
    if (this.throwOnWrite) return Promise.reject(this.throwOnWrite)
    this.writes.push({ relPath: params.relPath, content: params.content })
    if (!this.blocking) {
      return Promise.resolve({ requestId: params.requestId ?? 'auto', status: 'completed', revision: 1, fileDurable: true })
    }
    return new Promise((resolve) => {
      this.pending.push(resolve)
    })
  }

  async print(params: ProtocolMethods['print.snapshot']['params']) {
    return { pdfToken: `tok-${params.relPath}`, pages: 1 }
  }

  async invokeCommand(params: ProtocolMethods['command.invoke']['params']) {
    return { ok: true, value: params.name }
  }
}

const WRITE_PARAMS = { relPath: 'Articles/a.md', content: '正文', expectedRevision: 1 }

describe('T18 Broker — 能力/上下文/命令/有界代理', () => {
  it('能力矩阵：guest 缺 context.write 被拒，snapshot/print 放行', async () => {
    const broker = new Broker(new FakeBackend())
    await expect(broker.handle('context.snapshot', { relPath: 'x' }, conn())).resolves.toMatchObject({ revision: 1 })
    await expect(broker.handle('context.write', WRITE_PARAMS, conn())).rejects.toMatchObject({ code: 'E_CAPABILITY' })
    await expect(broker.handle('print.snapshot', { relPath: 'x' }, conn())).resolves.toMatchObject({ pages: 1 })
  })

  it('guest 声明 context.write 能力后放行（T26 G2 能力过滤）', async () => {
    const broker = new Broker(new FakeBackend())
    const result = await broker.handle('context.write', WRITE_PARAMS, conn({ capabilities: ['context.read', 'context.write'] }))
    expect(result.status).toBe('completed')
  })

  it('connectionHasCapability：guest 按声明、official 在 fullAccess 下全能力', () => {
    expect(connectionHasCapability(conn(), 'context.read')).toBe(true)
    expect(connectionHasCapability(conn(), 'context.write')).toBe(false)
    expect(connectionHasCapability(conn({ role: 'official', capabilities: [] }), 'context.write')).toBe(true)
    expect(connectionHasCapability(conn({ role: 'official', capabilities: [] }), 'context.write', false)).toBe(false)
  })

  it('official 角色拥有全能力（含 context.write）', async () => {
    const broker = new Broker(new FakeBackend())
    const result = await broker.handle('context.write', WRITE_PARAMS, conn({ role: 'official', capabilities: [] }))
    expect(result.status).toBe('completed')
  })

  it('连接 epoch 过期 → E_STALE_CONTEXT（retryable）且不触达后端', async () => {
    const backend = new FakeBackend()
    backend.epoch = 4
    const broker = new Broker(backend)
    const err = await broker.handle('context.snapshot', { relPath: 'x' }, conn({ epoch: 3 })).catch((e) => e)
    expect(err.code).toBe('E_STALE_CONTEXT')
    expect(err.retryable).toBe(true)
    expect(err.details).toMatchObject({ expected: 4, received: 3 })
  })

  it('上下文已关闭（currentEpoch null）→ E_STALE_CONTEXT', async () => {
    const backend = new FakeBackend()
    backend.epoch = null
    const broker = new Broker(backend)
    await expect(broker.handle('context.snapshot', { relPath: 'x' }, conn())).rejects.toMatchObject({ code: 'E_STALE_CONTEXT' })
  })

  it('声明式命令白名单：已声明放行，未声明 E_FORBIDDEN，缺 name E_BAD_PAYLOAD', async () => {
    const broker = new Broker(new FakeBackend())
    await expect(broker.handle('command.invoke', { name: 'demo.hello', args: { x: 1 } }, conn())).resolves.toEqual({ ok: true, value: 'demo.hello' })
    await expect(broker.handle('command.invoke', { name: 'system.exec' }, conn())).rejects.toMatchObject({ code: 'E_FORBIDDEN' })
    await expect(broker.handle('command.invoke', {} as never, conn())).rejects.toMatchObject({ code: 'E_BAD_PAYLOAD' })
  })

  it('payload 上限：超限 → E_BAD_PAYLOAD 且带 limit', async () => {
    const broker = new Broker(new FakeBackend(), { maxPayloadBytes: 64 })
    const err = await broker.handle('context.write', { ...WRITE_PARAMS, content: 'x'.repeat(256) }, conn({ role: 'official' })).catch((e) => e)
    expect(err.code).toBe('E_BAD_PAYLOAD')
    expect(err.details).toMatchObject({ limit: 64 })
  })

  it('在途上限：maxInflight=1 时第二个请求 E_BUSY，释放后可继续', async () => {
    const backend = new FakeBackend()
    backend.blocking = true
    const broker = new Broker(backend, { maxInflight: 1 })
    const first = broker.handle('context.write', WRITE_PARAMS, conn({ role: 'official' }))
    await new Promise((r) => setTimeout(r, 10))
    await expect(broker.handle('context.write', { ...WRITE_PARAMS, relPath: 'b.md' }, conn({ role: 'official' }))).rejects.toMatchObject({ code: 'E_BUSY', retryable: true })
    const resolver = backend.pending.shift()
    resolver?.({ requestId: 'auto', status: 'completed', revision: 1, fileDurable: true })
    await first
    backend.blocking = false
    await expect(broker.handle('context.write', { ...WRITE_PARAMS, relPath: 'c.md' }, conn({ role: 'official' }))).resolves.toMatchObject({ status: 'completed' })
  })

  it('protocol.capabilities 不需要能力（握手期可用）', async () => {
    const broker = new Broker(new FakeBackend())
    expect(broker.authorize('protocol.capabilities' as never, {}, conn({ capabilities: [] }))).toEqual({ ok: true })
  })

  it('后端异常原样冒泡为类型化错误（不吞掉）', async () => {
    const backend = new FakeBackend()
    backend.throwOnWrite = Object.assign(new Error('磁盘错误'), { code: 'E_INTERNAL', message: '磁盘错误', retryable: false })
    const broker = new Broker(backend)
    await expect(broker.handle('context.write', WRITE_PARAMS, conn({ role: 'official' }))).rejects.toMatchObject({ code: 'E_INTERNAL' })
  })

  it('Broker 无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/broker/broker.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
