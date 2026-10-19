/** T26 G3：产品 guest Broker 后端 print.snapshot —— 真实管线接线/能力过滤/失败如实。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Broker, type BrokerConnection } from '../../core/broker/broker'
import { resetPrintTokensForTests, lookupPrintToken } from '../../core/print/printTokenRegistry'
import type { PrintRenderer, PrintTransport } from '../../core/print/printJob'
import { ProductBrokerBackend, normalizeGuestPrintRelPath, type ProductBrokerBackendOptions } from './productBrokerBackend'

const REL = 'Articles/a.md'
const CONTENT = '---\ntitle: a\n---\n\n# 标题\n\n正文段落\n'
const TARGET = 'C:\\ke-tmp\\uiws-t26-g3g4\\appdata\\com.astranota.uiws.e2e\\print-a-r4.pdf'

interface FakeRoute {
  snapshotStatus?: number
  snapshotRevision?: number
  articleStatus?: number
  articleContent?: string
  failSnapshot?: boolean
}

function fakeFetch(route: FakeRoute = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const reply = (status: number, body: unknown) =>
      ({ status, json: async () => body }) as unknown as Response
    if (url.endsWith('/api/context/snapshot')) {
      if (route.failSnapshot) throw new Error('ECONNREFUSED')
      const status = route.snapshotStatus ?? 200
      return reply(status, status === 200 ? { rel_path: REL, revision: route.snapshotRevision ?? 4, disk_hash: 'h-4' } : {})
    }
    if (url.includes('/api/articles/')) {
      const status = route.articleStatus ?? 200
      return reply(status, status === 200 ? { content: route.articleContent ?? CONTENT } : {})
    }
    return reply(404, {})
  })
  return { fetchImpl, calls }
}

function makeRenderer(pages: number | null = null): PrintRenderer {
  return { render: vi.fn(async () => ({ html: '<html>snapshot</html>', pages })) }
}

function makeTransport(pages: number | null = null): PrintTransport {
  return {
    print: vi.fn(async (_rendered, target) => ({ pdfPath: target, pages, bytes: 0 })),
  }
}

function conn(capabilities: string[] = ['print.request']): BrokerConnection {
  return {
    connectionId: 'conn-1',
    packId: 'com.probe.t26g3g4',
    packVersion: '1.0.0',
    role: 'guest',
    capabilities,
    contextId: 'ke-default',
    epoch: 1,
    declaredCommands: [],
  }
}

function makeBackend(overrides: {
  route?: FakeRoute
  renderer?: PrintRenderer
  transport?: PrintTransport
  target?: string
  targetSeq?: boolean
} = {}) {
  const { fetchImpl, calls } = fakeFetch(overrides.route)
  const renderer = overrides.renderer ?? makeRenderer()
  const transport = overrides.transport ?? makeTransport()
  let seq = 0
  const resolvePrintTarget = vi.fn(async (_req: { relPath: string; revision: number }) => {
    if (!overrides.targetSeq) return overrides.target ?? TARGET
    seq += 1
    return `C:\\ke-tmp\\out\\print-${seq}.pdf`
  })
  const options: ProductBrokerBackendOptions = {
    baseUrl: '',
    context: async () => ({ contextId: 'ke-default', epoch: 1 }),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    printRenderer: renderer,
    printTransport: transport,
    resolvePrintTarget,
  }
  return { backend: new ProductBrokerBackend(options), renderer, transport, fetchImpl, calls, resolvePrintTarget }
}

afterEach(() => {
  resetPrintTokensForTests()
})

describe('T26 G3 ProductBrokerBackend.print.snapshot', () => {
  it('能力过滤：经过真实 Broker 时缺 print.request → E_CAPABILITY，后端不执行', async () => {
    const { backend, fetchImpl } = makeBackend()
    const broker = new Broker(backend, {})
    await expect(broker.handle('print.snapshot', { relPath: REL }, conn([]))).rejects.toMatchObject({
      code: 'E_CAPABILITY',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('能力过滤（后端第二道防线）：直调 print 缺能力 → E_CAPABILITY', async () => {
    const { backend, fetchImpl } = makeBackend()
    await expect(backend.print({ relPath: REL }, conn([]))).rejects.toMatchObject({ code: 'E_CAPABILITY' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('参数校验：绝对路径/穿越/非 Markdown → E_BAD_PAYLOAD（不进入打印）', async () => {
    const codeOf = (fn: () => unknown): string | undefined => {
      try {
        fn()
        return undefined
      } catch (e) {
        return (e as { code?: string }).code
      }
    }
    expect(codeOf(() => normalizeGuestPrintRelPath('C:\\secret.md'))).toBe('E_BAD_PAYLOAD')
    expect(codeOf(() => normalizeGuestPrintRelPath('../escape.md'))).toBe('E_BAD_PAYLOAD')
    expect(codeOf(() => normalizeGuestPrintRelPath('Attachments/a.png'))).toBe('E_BAD_PAYLOAD')
    expect(codeOf(() => normalizeGuestPrintRelPath(42))).toBe('E_BAD_PAYLOAD')
    expect(normalizeGuestPrintRelPath('Articles/a.md')).toBe('Articles/a.md')
    expect(normalizeGuestPrintRelPath('Articles\\sub\\b.MD')).toBe('Articles/sub/b.MD')
    const { backend, renderer } = makeBackend()
    await expect(backend.print({ relPath: '../escape.md' }, conn())).rejects.toMatchObject({ code: 'E_BAD_PAYLOAD' })
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('真实成功：后端读快照 → 渲染 → 打印 → 返回真实 pdfToken（宿主可反查真实路径），pages=null 不伪造', async () => {
    const { backend, transport, calls, resolvePrintTarget } = makeBackend()
    const result = await backend.print({ relPath: REL }, conn())
    expect(result.pdfToken).toMatch(/^pdf-/)
    expect(result.pdfToken).not.toBe(REL)
    expect(result.pages).toBeNull()
    const entry = lookupPrintToken(result.pdfToken)
    expect(entry?.pdfPath).toBe(TARGET)
    expect(entry?.relPath).toBe(REL)
    expect(entry?.revision).toBe(4)
    expect(transport.print).toHaveBeenCalledWith(expect.objectContaining({ pages: null }), TARGET, expect.anything())
    expect(resolvePrintTarget).toHaveBeenCalledWith({ relPath: REL, revision: 4 })
    const snapshotCall = calls.find((c) => c.url.endsWith('/api/context/snapshot'))
    expect(snapshotCall?.body).toMatchObject({ rel_path: REL })
  })

  it('渲染器给出真实页数时原样返回', async () => {
    const renderer = makeRenderer(3)
    const transport = makeTransport(3)
    const { backend } = makeBackend({ renderer, transport })
    const result = await backend.print({ relPath: REL }, conn())
    expect(result.pages).toBe(3)
  })

  it('后端读不到正文 → E_INTERNAL（E_PRINT_SNAPSHOT），不产生 token', async () => {
    const { backend, transport } = makeBackend({ route: { articleStatus: 404 } })
    const err = (await backend.print({ relPath: REL }, conn()).catch((e) => e)) as { code: string; message: string }
    expect(err.code).toBe('E_INTERNAL')
    expect(err.message).toContain('E_PRINT_SNAPSHOT')
    expect(transport.print).not.toHaveBeenCalled()
  })

  it('渲染器失败（如产品编辑器未就绪）→ E_INTERNAL 带真实原因，不返回假 token', async () => {
    const renderer: PrintRenderer = {
      render: async () => {
        throw new Error('E_PRINT_RENDERER: 产品编辑器渲染器未就绪（EditorArea 未挂载）')
      },
    }
    const { backend } = makeBackend({ renderer })
    const err = (await backend.print({ relPath: REL }, conn()).catch((e) => e)) as { code: string; message: string }
    expect(err.code).toBe('E_INTERNAL')
    expect(err.message).toContain('E_PRINT_RENDERER')
    expect(err.message).toContain('E_PRINT:')
  })

  it('打印传输失败（Rust 拒绝/渲染超时）→ E_INTERNAL 带真实原因', async () => {
    const transport: PrintTransport = {
      print: async () => {
        throw new Error('E_PATH: 打印输出必须是绝对路径')
      },
    }
    const { backend } = makeBackend({ transport })
    const err = (await backend.print({ relPath: REL }, conn()).catch((e) => e)) as { code: string; message: string }
    expect(err.code).toBe('E_INTERNAL')
    expect(err.message).toContain('E_PATH')
  })

  it('连续两次打印 → 不同 token/目标（不覆盖语义）', async () => {
    const { backend } = makeBackend({ targetSeq: true })
    const a = await backend.print({ relPath: REL }, conn())
    const b = await backend.print({ relPath: REL }, conn())
    expect(a.pdfToken).not.toBe(b.pdfToken)
    expect(lookupPrintToken(a.pdfToken)?.pdfPath).not.toBe(lookupPrintToken(b.pdfToken)?.pdfPath)
  })
})
