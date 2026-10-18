/** UI 工坊 P2-T16：打印 Job 队列/状态机/取消/超时/快照绑定（无 DOM）。 */
import { describe, expect, it, vi } from 'vitest'

import { PrintJobManager, type PrintRenderer, type PrintTransport, type PrintSnapshot } from './printJob'

const SNAP: PrintSnapshot = { relPath: 'Articles/a.md', revision: 7, content: '# 标题\n\n正文' }
const TARGET = 'C:/tmp/out.pdf'

function make(overrides: { renderer?: Partial<PrintRenderer>; transport?: Partial<PrintTransport>; timeoutMs?: number } = {}) {
  const states: string[] = []
  const renderer: PrintRenderer = {
    render: vi.fn(async () => ({ html: '<html>snapshot</html>', pages: 2 })),
    ...overrides.renderer,
  }
  const transport: PrintTransport = {
    print: vi.fn(async (_r, target) => ({ pdfPath: target, pages: 2, bytes: 1234 })),
    ...overrides.transport,
  }
  const manager = new PrintJobManager({
    renderer,
    transport,
    timeoutMs: overrides.timeoutMs ?? 5000,
    validateTargetPath: (p) => {
      if (!p.endsWith('.pdf') || p.includes('..')) throw new Error('E_PATH: 非法打印输出路径')
    },
    onStateChange: (j) => states.push(j.state),
  })
  return { manager, renderer, transport, states }
}

describe('T16 打印 Job（Core）', () => {
  it('成功：queued→rendering→printing→done，输出 pages/pdfPath', async () => {
    const { manager, renderer, transport } = make()
    const job = await manager.enqueue(SNAP, TARGET)
    expect(job.state).toBe('done')
    expect(job.pages).toBe(2)
    expect(job.pdfPath).toBe(TARGET)
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({ relPath: SNAP.relPath, revision: 7, content: SNAP.content }),
      expect.anything(),
    )
    expect(transport.print).toHaveBeenCalledWith(expect.objectContaining({ pages: 2 }), TARGET, expect.anything())
  })

  it('状态序列完整（含中间状态）', async () => {
    const { manager, states } = make()
    await manager.enqueue(SNAP, TARGET)
    expect(states).toEqual(['queued', 'rendering', 'printing', 'done'])
  })

  it('串行：maxConcurrent=1 时第二个 Job 等第一个完成', async () => {
    let releaseFirst: (() => void) | null = null
    const order: string[] = []
    const manager = new PrintJobManager({
      renderer: {
        render: async (snap) => {
          order.push(`start:${snap.content}`)
          if (snap.content === 'first') {
            await new Promise<void>((r) => (releaseFirst = r))
          }
          order.push(`rendered:${snap.content}`)
          return { html: '<p/>', pages: 1 }
        },
      },
      transport: { print: async (_r, t) => ({ pdfPath: t, pages: 1, bytes: 1 }) },
    })
    const a = manager.enqueue({ ...SNAP, content: 'first' }, TARGET)
    const b = manager.enqueue({ ...SNAP, content: 'second' }, TARGET)
    await new Promise((r) => setTimeout(r, 20))
    expect(order).toEqual(['start:first'])
    releaseFirst!()
    await a
    await b
    expect(order).toEqual(['start:first', 'rendered:first', 'start:second', 'rendered:second'])
  })

  it('取消 queued Job：renderer 不被调用', async () => {
    const { manager, renderer } = make()
    const first = manager.enqueue(SNAP, TARGET)
    const jobId = manager.list()[0].jobId
    const second = manager.enqueue(SNAP, TARGET)
    expect(manager.cancel(manager.list()[1].jobId)).toBe(true)
    await first
    await expect(second).rejects.toThrow(/E_CANCELED/)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    void jobId
  })

  it('取消 rendering 中的 Job：signal abort，状态 canceled', async () => {
    const manager = new PrintJobManager({
      renderer: {
        render: (_s, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      },
      transport: { print: async (_r, t) => ({ pdfPath: t, pages: 1, bytes: 1 }) },
    })
    const pending = manager.enqueue(SNAP, TARGET)
    await new Promise((r) => setTimeout(r, 10))
    const jobId = manager.list()[0].jobId
    expect(manager.cancel(jobId)).toBe(true)
    await expect(pending).rejects.toThrow(/E_CANCELED/)
  })

  it('渲染失败 → failed（错误保留）', async () => {
    const { manager } = make({ renderer: { render: async () => { throw new Error('E_RENDER: boom') } } })
    const err = (await manager.enqueue(SNAP, TARGET).catch((e) => e)) as Error
    expect(err.message).toMatch(/E_RENDER/)
    expect(manager.list()[0].state).toBe('failed')
  })

  it('打印传输失败 → failed', async () => {
    const { manager } = make({ transport: { print: async () => { throw new Error('E_PRINT: disk full') } } })
    await expect(manager.enqueue(SNAP, TARGET)).rejects.toThrow(/E_PRINT/)
    expect(manager.list()[0].state).toBe('failed')
  })

  it('快照 revision 与内容绑定：renderer 收到的是入队时的快照副本', async () => {
    const { manager, renderer } = make()
    const snapshot = { ...SNAP }
    const p = manager.enqueue(snapshot, TARGET)
    snapshot.content = '后来编辑的内容（不得进入打印）'
    await p
    const received = (renderer.render as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as PrintSnapshot
    expect(received.revision).toBe(7)
    expect(received.content).toBe('# 标题\n\n正文')
  })

  it('目标路径校验失败 → 拒绝入队（不创建 Job）', async () => {
    const { manager } = make()
    await expect(manager.enqueue(SNAP, 'C:/tmp/evil.txt')).rejects.toThrow(/E_PATH/)
    expect(manager.list()).toHaveLength(0)
  })

  it('超时 → failed(E_TIMEOUT)', async () => {
    const { manager } = make({
      timeoutMs: 25,
      renderer: { render: (_s, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) },
    })
    await expect(manager.enqueue(SNAP, TARGET)).rejects.toThrow()
    expect(manager.list()[0].state).toBe('failed')
    expect(manager.list()[0].error).toMatch(/E_TIMEOUT/)
  })

  it('非法快照（revision 非整数）→ 直接拒绝', async () => {
    const { manager } = make()
    await expect(manager.enqueue({ ...SNAP, revision: -1 }, TARGET)).rejects.toThrow(/E_SNAPSHOT/)
  })

  it('无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync('src/core/print/printJob.ts', 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/document\./)
    expect(src).not.toMatch(/window\./)
    expect(src).not.toMatch(/from ['"]react['"]/)
  })
})
