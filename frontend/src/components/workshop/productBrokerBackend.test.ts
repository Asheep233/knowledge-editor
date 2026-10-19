/** T26 G3：产品 guest Broker 后端 print.snapshot —— 真实管线接线/能力过滤/失败如实。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Broker, type BrokerConnection } from '../../core/broker/broker'
import { brokeredHandlers } from '../../core/broker/binding'
import { GuestClient, HostDispatcher, ProtocolCallError, createInMemoryPorts } from '../../core/protocol/channel'
import { resetPrintTokensForTests, lookupPrintToken } from '../../core/print/printTokenRegistry'
import { validateManifest } from '../../core/packs/manifest'
import type { PrintRenderer, PrintTransport } from '../../core/print/printJob'
import {
  ProductBrokerBackend,
  WORKSHOP_COMMAND_PROTOCOL_NAMES,
  WORKSHOP_EDITOR_ACTION_WHITELIST,
  WORKSHOP_EDITOR_PARAM_COMMANDS,
  WORKSHOP_EDITOR_PARAM_KEY,
  WORKSHOP_EDITOR_COMMAND_WHITELIST,
  WORKSHOP_EDITOR_PROTOCOL_NAMES,
  getWorkshopEditorExecutor,
  isWorkshopEditorInvokeName,
  normalizeGuestPrintRelPath,
  resetGuestContextBridgeForTests,
  isWorkshopEditorActionName,
  isWorkshopEditorParamName,
  resolveWorkshopEditorCommand,
  validateWorkshopEditorArgs,
  type ProductBrokerBackendOptions,
} from './productBrokerBackend'
import { __clearActionHandlers, registerActionHandler } from '../../state/shortcuts'
import { WORKSHOP_EDITOR_EXECUTORS, WORKSHOP_EDITOR_PARAM_EXECUTORS, createWorkshopEditorExecutor } from '../layout/EditorArea'

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


// ---------------- W07 B-6/A-10：sidecar 重启后上下文重建重试 + 超时语义 ----------------

type Step = 'ok' | '404' | '409' | '500'

interface RetryPlan {
  snapshot?: Step[]
  write?: Step[]
  openEpochs?: number[]
}

/**
 * 有状态假后端：按调用序号模拟 sidecar 重启后的「上下文丢失(404) → 重建后可读」序列。
 * 覆盖 /api/workspace/info、/api/context/open、/api/context/snapshot、/api/context/write、/api/articles/*。
 */
function statefulFetch(plan: RetryPlan = {}) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
  let snapshotCalls = 0
  let writeCalls = 0
  let openCalls = 0
  const reply = (status: number, body: unknown) =>
    ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ url, method, body })
    if (url.endsWith('/api/workspace/info')) return reply(200, { root: 'C:\\ke-tmp\\ws' })
    if (url.endsWith('/api/context/open')) {
      openCalls += 1
      const epochs = plan.openEpochs ?? [1]
      return reply(200, { id: 'ke-default', epoch: epochs[Math.min(openCalls - 1, epochs.length - 1)] })
    }
    if (url.endsWith('/api/context/snapshot')) {
      snapshotCalls += 1
      const step = (plan.snapshot ?? ['ok']).at(Math.min(snapshotCalls - 1, (plan.snapshot ?? ['ok']).length - 1)) ?? 'ok'
      if (step === 'ok') return reply(200, { rel_path: REL, revision: 5, disk_hash: 'h-5' })
      if (step === '409') return reply(409, { detail: '上下文 epoch 已过期: 期望 2, 收到 1' })
      if (step === '500') return reply(500, { detail: 'boom' })
      return reply(404, { detail: '上下文不存在或已关闭: ke-default' })
    }
    if (url.endsWith('/api/context/write')) {
      writeCalls += 1
      const seq = plan.write ?? ['ok']
      const step = seq[Math.min(writeCalls - 1, seq.length - 1)]
      if (step === 'ok') {
        return reply(200, {
          request_id: 'rid-server',
          context_id: 'ke-default',
          rel_path: REL,
          status: 'completed',
          revision: 2,
          accepted: true,
          recovery_durable: true,
          file_durable: true,
        })
      }
      if (step === '500') return reply(500, { detail: 'boom' })
      return reply(404, { detail: '上下文不存在或已关闭: ke-default' })
    }
    if (url.includes('/api/articles/')) return reply(200, { content: CONTENT })
    return reply(404, {})
  })
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls,
    counts: () => ({ snapshotCalls, writeCalls, openCalls }),
  }
}

/** 上下文解析注入替身：每次 resolve 返回 epoch 递增，模拟「失效后重建绑定拿到新 epoch」。 */
function incrementingContext() {
  const state = { resolves: 0 }
  const context = async () => {
    state.resolves += 1
    return { contextId: 'ke-default', epoch: state.resolves }
  }
  return { state, context }
}

function abortError(): Error {
  const e = new Error('signal is aborted without reason')
  e.name = 'AbortError'
  return e
}

/** 永不自行完成的 fetch：仅在 AbortSignal abort 时以 AbortError 拒绝（模拟宿主 fetch 超时）。 */
function hangingAbortFetch(): typeof fetch {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(abortError())
          return
        }
        signal?.addEventListener('abort', () => reject(abortError()), { once: true })
      }),
  ) as unknown as typeof fetch
}

describe('W07 B-6：上下文丢失(404)/epoch 失效(409) → 重建绑定重试一次', () => {
  it('snapshot：404 一次后重建上下文重试成功（重试用新 epoch，快照读真实结果）', async () => {
    const { fetchImpl, calls, counts } = statefulFetch({ snapshot: ['404', 'ok'] })
    const { state, context } = incrementingContext()
    const backend = new ProductBrokerBackend({ baseUrl: '', fetchImpl, context })
    const snap = await backend.snapshot({ relPath: REL }, conn(['context.read']))
    expect(snap).toMatchObject({ relPath: REL, revision: 5, diskHash: 'h-5' })
    expect(counts().snapshotCalls).toBe(2)
    expect(state.resolves).toBe(2) // 首次绑定 + invalidate 后重建
    const bodies = calls.filter((c) => c.url.endsWith('/api/context/snapshot')).map((c) => c.body)
    expect(bodies[0]).toMatchObject({ context_id: 'ke-default', epoch: 1, rel_path: REL })
    expect(bodies[1]).toMatchObject({ context_id: 'ke-default', epoch: 2, rel_path: REL })
  })

  it('snapshot：仍失败 → 如实抛 E_SNAPSHOT HTTP 404，且只重试一次（不无限循环/不吞错）', async () => {
    const { fetchImpl, counts } = statefulFetch({ snapshot: ['404'] })
    const { state, context } = incrementingContext()
    const backend = new ProductBrokerBackend({ baseUrl: '', fetchImpl, context })
    const err = (await backend.snapshot({ relPath: REL }, conn(['context.read'])).catch((e) => e)) as Error
    expect(String(err.message)).toContain('E_SNAPSHOT: HTTP 404')
    expect(counts().snapshotCalls).toBe(2)
    expect(state.resolves).toBe(2)
  })

  it('snapshot：非上下文错误（HTTP 500）→ 不重试、直接如实抛错', async () => {
    const { fetchImpl, counts } = statefulFetch({ snapshot: ['500'] })
    const { state, context } = incrementingContext()
    const backend = new ProductBrokerBackend({ baseUrl: '', fetchImpl, context })
    const err = (await backend.snapshot({ relPath: REL }, conn(['context.read'])).catch((e) => e)) as Error
    expect(String(err.message)).toContain('E_SNAPSHOT: HTTP 500')
    expect(counts().snapshotCalls).toBe(1)
    expect(state.resolves).toBe(1)
  })

  it('snapshot：409 epoch 失效 → 重建绑定重试成功（既有语义保持）', async () => {
    const { fetchImpl, counts } = statefulFetch({ snapshot: ['409', 'ok'] })
    const { context } = incrementingContext()
    const backend = new ProductBrokerBackend({ baseUrl: '', fetchImpl, context })
    const snap = await backend.snapshot({ relPath: REL }, conn(['context.read']))
    expect(snap.revision).toBe(5)
    expect(counts().snapshotCalls).toBe(2)
  })

  it('集成：默认 contextInfo/CoreSaveBridge 路径被 invalidate 后重新 context/open（bind 重建真实生效）', async () => {
    resetGuestContextBridgeForTests()
    const { fetchImpl, calls, counts } = statefulFetch({ snapshot: ['404', 'ok'], openEpochs: [1, 2] })
    vi.stubGlobal('fetch', fetchImpl)
    try {
      // 不注入 context：走真实 contextInfo()（CoreSaveBridge.ensureContext）→ refreshGuestContext 清缓存
      const backend = new ProductBrokerBackend({ baseUrl: '' })
      const snap = await backend.snapshot({ relPath: REL }, conn(['context.read']))
      expect(snap.revision).toBe(5)
      expect(counts().openCalls).toBe(2) // 首次 open + 404 后 invalidate → 重新 open
      const bodies = calls.filter((c) => c.url.endsWith('/api/context/snapshot')).map((c) => c.body)
      expect(bodies[1]).toMatchObject({ context_id: 'ke-default', epoch: 2 }) // 重试携带重建后的新 epoch
    } finally {
      vi.unstubAllGlobals()
      resetGuestContextBridgeForTests()
    }
  })

  it('write：404 一次后重建上下文重试成功，且重试复用同一 requestId（幂等）', async () => {
    const { fetchImpl, calls, counts } = statefulFetch({ write: ['404', 'ok'] })
    const { state, context } = incrementingContext()
    const backend = new ProductBrokerBackend({ baseUrl: '', fetchImpl, context })
    const result = await backend.write({ relPath: REL, content: '新正文', expectedRevision: 1, requestId: 'guest-rid-1' }, conn())
    expect(result).toMatchObject({ status: 'completed', revision: 2, fileDurable: true })
    expect(counts().writeCalls).toBe(2)
    expect(state.resolves).toBe(2)
    const writeBodies = calls.filter((c) => c.url.endsWith('/api/context/write')).map((c) => c.body)
    expect(writeBodies).toHaveLength(2)
    expect(writeBodies[0]?.request_id).toBe('guest-rid-1')
    expect(writeBodies[1]?.request_id).toBe('guest-rid-1') // 重试复用同一幂等键
    expect(writeBodies[1]).toMatchObject({ epoch: 2, expected_revision: 1 })
  })

  it('write：重试仍失败 → 如实返回 status=failed（不伪造 revision/fileDurable）', async () => {
    const { fetchImpl, counts } = statefulFetch({ write: ['404'] })
    const { context } = incrementingContext()
    const backend = new ProductBrokerBackend({ baseUrl: '', fetchImpl, context })
    const result = await backend.write({ relPath: REL, content: 'x', expectedRevision: 1, requestId: 'guest-rid-2' }, conn())
    expect(result.status).toBe('failed')
    expect(result.requestId).toBe('guest-rid-2')
    expect(result.revision).toBeUndefined()
    expect(result.fileDurable).toBeUndefined()
    expect(counts().writeCalls).toBe(2)
  })

  it('write：非上下文错误（HTTP 500）→ 不重试，返回 failed', async () => {
    const { fetchImpl, counts } = statefulFetch({ write: ['500'] })
    const { state, context } = incrementingContext()
    const backend = new ProductBrokerBackend({ baseUrl: '', fetchImpl, context })
    const result = await backend.write({ relPath: REL, content: 'x', expectedRevision: 1 }, conn())
    expect(result.status).toBe('failed')
    expect(counts().writeCalls).toBe(1)
    expect(state.resolves).toBe(1)
  })

  it('print：快照读取 404 一次后经重建绑定重试，仍能产出真实 token（打印读取路径同样恢复）', async () => {
    const { fetchImpl, counts } = statefulFetch({ snapshot: ['404', 'ok'] })
    const { context } = incrementingContext()
    const renderer = makeRenderer(null)
    const transport = makeTransport(null)
    const backend = new ProductBrokerBackend({
      baseUrl: '',
      fetchImpl,
      context,
      printRenderer: renderer,
      printTransport: transport,
      resolvePrintTarget: async () => TARGET,
    })
    const result = await backend.print({ relPath: REL }, conn())
    expect(result.pdfToken).toMatch(/^pdf-/)
    expect(counts().snapshotCalls).toBe(2)
    expect(transport.print).toHaveBeenCalledTimes(1)
  })
})

describe('W07 A-10：超时 E_TIMEOUT 经 Broker/HostDispatcher 映射到 guest', () => {
  it('guest 收到 ProtocolCallError(code=E_TIMEOUT, retryable=true) 而非 E_INTERNAL', async () => {
    const [hostPort, guestPort] = createInMemoryPorts()
    const backend = new ProductBrokerBackend({
      baseUrl: '',
      context: async () => ({ contextId: 'ke-default', epoch: 1 }),
      fetchImpl: hangingAbortFetch(),
      requestTimeoutMs: 20,
    })
    const broker = new Broker(backend, {})
    const dispatcher = new HostDispatcher(hostPort, brokeredHandlers(broker, conn(['context.read'])), {
      context: () => ({ contextId: 'ke-default', epoch: 1 }),
    })
    dispatcher.start()
    const guest = new GuestClient(guestPort, { sdkVersion: 'w07-test', requestedFeatures: ['context.read'], timeoutMs: 2000 })
    try {
      await guest.handshake()
      const err = (await guest.request('context.snapshot', { relPath: REL }).catch((e) => e)) as ProtocolCallError
      expect(err).toBeInstanceOf(ProtocolCallError)
      expect(err.error.code).toBe('E_TIMEOUT')
      expect(err.error.retryable).toBe(true)
      expect(err.error.details).toMatchObject({ path: '/api/context/snapshot' })
    } finally {
      guest.close()
      dispatcher.close()
    }
  })
})

// ---------------- T26 F03：受控 guest 编辑器命令桥（editor.*） ----------------

type FakeExecutor = { execute: ReturnType<typeof vi.fn> }

function installExecutor(impl?: (name: string) => { ok: boolean; error?: string }): FakeExecutor {
  const executor = { execute: vi.fn(impl ?? (() => ({ ok: true }))) }
  ;(window as unknown as { __KE_WORKSHOP_EDITOR__?: FakeExecutor }).__KE_WORKSHOP_EDITOR__ = executor
  return executor
}

function editorConn(capabilities: string[] = ['ui.shell', 'editor.commands.readonly']): BrokerConnection {
  return { ...conn(capabilities) }
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; message?: string }> {
  return (await promise.catch((e) => e)) as { code?: string; message?: string }
}

describe('T26 F03 受控 guest 编辑器命令桥（command.invoke editor.*）', () => {
  afterEach(() => {
    delete (window as unknown as { __KE_WORKSHOP_EDITOR__?: FakeExecutor }).__KE_WORKSHOP_EDITOR__
  })

  it('白名单契约为 14 条最小集（不含任意命令）；协议名大小写敏感', () => {
    expect([...WORKSHOP_EDITOR_COMMAND_WHITELIST]).toEqual([
      'bold', 'italic', 'underline', 'strike', 'code',
      'heading1', 'heading2', 'heading3',
      'bulletList', 'orderedList', 'blockquote', 'codeBlock',
      'undo', 'redo',
    ])
    expect(isWorkshopEditorInvokeName('editor.bold')).toBe(true)
    expect(isWorkshopEditorInvokeName('editor.heading3')).toBe(true)
    expect(isWorkshopEditorInvokeName('editor.BOLD')).toBe(false)
    expect(isWorkshopEditorInvokeName('editor.clearContent')).toBe(false)
    expect(isWorkshopEditorInvokeName('article.set-title')).toBe(false)
    expect(isWorkshopEditorInvokeName(42)).toBe(false)
  })

  it('白名单内命令 → 调执行器并返回 {ok:true,value:{name,executed:true}}', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    for (const name of ['editor.bold', 'editor.heading1', 'editor.blockquote', 'editor.undo', 'editor.redo']) {
      const result = await backend.invokeCommand({ name }, editorConn())
      expect(result).toEqual({ ok: true, value: { name, executed: true } })
    }
    expect(executor.execute.mock.calls.map((call) => call[0])).toEqual(['bold', 'heading1', 'blockquote', 'undo', 'redo'])
  })

  it('白名单外 editor.* → E_COMMAND_NOT_ALLOWED（协议码 E_FORBIDDEN），执行器零调用', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    for (const name of ['editor.clearContent', 'editor.insertText', 'editor.BOLD', 'editor.deleteSelection', 'editor.bold.x']) {
      const err = await rejection(backend.invokeCommand({ name }, editorConn()))
      expect(err.code).toBe('E_FORBIDDEN')
      expect(String(err.message)).toContain('E_COMMAND_NOT_ALLOWED')
    }
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('连接缺少 editor.commands.readonly 能力 → E_CAPABILITY，执行器零调用', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    const err = await rejection(backend.invokeCommand({ name: 'editor.bold' }, editorConn(['ui.shell'])))
    expect(err.code).toBe('E_CAPABILITY')
    expect(String(err.message)).toContain('editor.commands.readonly')
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('执行器缺失（编辑器未挂载）→ E_INTERNAL + E_EDITOR_NOT_READY（不假成功）', async () => {
    delete (window as unknown as { __KE_WORKSHOP_EDITOR__?: FakeExecutor }).__KE_WORKSHOP_EDITOR__
    expect(getWorkshopEditorExecutor()).toBeNull()
    const { backend } = makeBackend()
    const err = await rejection(backend.invokeCommand({ name: 'editor.bold' }, editorConn()))
    expect(err.code).toBe('E_INTERNAL')
    expect(String(err.message)).toContain('E_EDITOR_NOT_READY')
  })

  it('执行器返回失败/抛错 → 如实 E_INTERNAL（E_COMMAND_EXECUTION_FAILED），不假成功', async () => {
    installExecutor(() => ({ ok: false, error: 'E_EDITOR_NOT_READY' }))
    const { backend } = makeBackend()
    const reject = await rejection(backend.invokeCommand({ name: 'editor.bold' }, editorConn()))
    expect(reject.code).toBe('E_INTERNAL')
    expect(String(reject.message)).toContain('E_COMMAND_EXECUTION_FAILED')
    expect(String(reject.message)).toContain('E_EDITOR_NOT_READY')

    installExecutor(() => {
      throw new Error('boom')
    })
    const thrown = await rejection(backend.invokeCommand({ name: 'editor.italic' }, editorConn()))
    expect(thrown.code).toBe('E_INTERNAL')
    expect(String(thrown.message)).toContain('boom')
  })

  it('真实 Broker 链路：manifest 未声明命令 → 声明式白名单先行拒绝（E_FORBIDDEN）', async () => {
    installExecutor()
    const { backend } = makeBackend()
    const broker = new Broker(backend, {})
    const connNoDeclare = { ...editorConn(), declaredCommands: [] as string[] }
    const err = await rejection(broker.handle('command.invoke', { name: 'editor.bold' }, connNoDeclare))
    expect(err.code).toBe('E_FORBIDDEN')
  })

  it('真实 Broker 链路：声明命令 + 能力 + 执行器齐备 → 成功返回', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    const broker = new Broker(backend, {})
    const declared = { ...editorConn(), declaredCommands: ['editor.bold'] }
    const result = await broker.handle('command.invoke', { name: 'editor.bold' }, declared)
    expect(result).toEqual({ ok: true, value: { name: 'editor.bold', executed: true } })
    expect(executor.execute).toHaveBeenCalledWith('bold')
  })

  it('非 editor.* 名称仍走既有 article meta 白名单（未被编辑器桥截获）', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    const err = await rejection(backend.invokeCommand({ name: 'article.unknown' }, editorConn()))
    expect(String(err.message)).toMatch(/E_COMMAND_NOT_ALLOWED|未授权命令/)
    expect(executor.execute).not.toHaveBeenCalled()
  })
})

describe('T26 F03 EditorArea 受控执行器（白名单映射/边角）', () => {
  function fakeEditor(runResult = true) {
    const calls: string[] = []
    const chain: Record<string, unknown> = {}
    for (const method of [
      'focus', 'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike', 'toggleCode',
      'toggleHeading', 'toggleBulletList', 'toggleOrderedList', 'toggleBlockquote', 'toggleCodeBlock',
      'undo', 'redo',
    ]) {
      chain[method] = (...args: unknown[]) => {
        calls.push(args.length > 0 ? `${method}:${JSON.stringify(args)}` : method)
        return chain
      }
    }
    chain.run = () => runResult
    return { calls, editor: { isDestroyed: false, chain: () => chain } }
  }

  it('白名单 14 条与执行器映射键完全一致（编译期 Record 穷尽 + 运行期守卫）', () => {
    expect(Object.keys(WORKSHOP_EDITOR_EXECUTORS).sort()).toEqual([...WORKSHOP_EDITOR_COMMAND_WHITELIST].sort())
  })

  it('每条白名单命令映射到正确 chain 方法（heading 带 level、含 focus）', () => {
    const expectations: Array<[string, string]> = [
      ['bold', 'toggleBold'],
      ['italic', 'toggleItalic'],
      ['underline', 'toggleUnderline'],
      ['strike', 'toggleStrike'],
      ['code', 'toggleCode'],
      ['heading1', 'toggleHeading:[{"level":1}]'],
      ['heading2', 'toggleHeading:[{"level":2}]'],
      ['heading3', 'toggleHeading:[{"level":3}]'],
      ['bulletList', 'toggleBulletList'],
      ['orderedList', 'toggleOrderedList'],
      ['blockquote', 'toggleBlockquote'],
      ['codeBlock', 'toggleCodeBlock'],
      ['undo', 'undo'],
      ['redo', 'redo'],
    ]
    for (const [command, expectedCall] of expectations) {
      const { calls, editor } = fakeEditor(true)
      const executor = createWorkshopEditorExecutor(() => editor as never)
      expect(executor.execute(command)).toEqual({ ok: true })
      expect(calls, `${command} 应调用 ${expectedCall}`).toContain(expectedCall)
      expect(calls[0], '命令必须经 chain().focus() 执行').toBe('focus')
    }
  })

  it('未知命令 → E_COMMAND_NOT_ALLOWED 且不触发任何编辑器调用（不暴露任意命令）', () => {
    const { calls, editor } = fakeEditor(true)
    const executor = createWorkshopEditorExecutor(() => editor as never)
    expect(executor.execute('clearContent')).toEqual({ ok: false, error: 'E_COMMAND_NOT_ALLOWED' })
    expect(executor.execute('insertText')).toEqual({ ok: false, error: 'E_COMMAND_NOT_ALLOWED' })
    expect(calls).toHaveLength(0)
  })

  it('编辑器未就绪（getEditor 为 null / destroyed）→ E_EDITOR_NOT_READY（不假成功）', () => {
    expect(createWorkshopEditorExecutor(() => null).execute('bold')).toEqual({
      ok: false,
      error: 'E_EDITOR_NOT_READY',
    })
    const { calls, editor } = fakeEditor(true)
    ;(editor as { isDestroyed?: boolean }).isDestroyed = true
    expect(createWorkshopEditorExecutor(() => editor as never).execute('bold')).toEqual({
      ok: false,
      error: 'E_EDITOR_NOT_READY',
    })
    expect(calls).toHaveLength(0)
  })

  it('chain.run 返回 false（命令未生效）→ E_COMMAND_EXECUTION_FAILED 如实失败', () => {
    const { editor } = fakeEditor(false)
    expect(createWorkshopEditorExecutor(() => editor as never).execute('undo')).toEqual({
      ok: false,
      error: 'E_COMMAND_EXECUTION_FAILED',
    })
  })
})

// ---------------- W07 task-27：kebab 协议名映射（manifest schema 可声明） ----------------

describe('W07 task-27 editor.* 协议名（kebab）映射修复', () => {
  afterEach(() => {
    delete (window as unknown as { __KE_WORKSHOP_EDITOR__?: FakeExecutor }).__KE_WORKSHOP_EDITOR__
  })

  it('三 kebab 命令被接受并映射到正确执行器键（bulletList/orderedList/codeBlock）', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    const cases: Array<[string, string]> = [
      ['editor.bullet-list', 'bulletList'],
      ['editor.ordered-list', 'orderedList'],
      ['editor.code-block', 'codeBlock'],
    ]
    for (const [name] of cases) {
      const result = await backend.invokeCommand({ name }, editorConn())
      expect(result).toEqual({ ok: true, value: { name, executed: true } })
    }
    expect(executor.execute.mock.calls.map((call) => call[0])).toEqual(['bulletList', 'orderedList', 'codeBlock'])
  })

  it('14 条规范协议名全部合法（匹配 manifest.commands[].name 正则），且 kebab 三命令在列', () => {
    expect(WORKSHOP_EDITOR_PROTOCOL_NAMES).toHaveLength(14)
    for (const name of WORKSHOP_EDITOR_PROTOCOL_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9.-]{1,80}$/)
    }
    expect(WORKSHOP_EDITOR_PROTOCOL_NAMES).toEqual(
      expect.arrayContaining(['editor.bullet-list', 'editor.ordered-list', 'editor.code-block']),
    )
    expect(WORKSHOP_EDITOR_PROTOCOL_NAMES).not.toContain('editor.bulletList')
  })

  it('manifest 校验：kebab 协议名可声明；camelCase 多词名被 schema 拒绝（修复动机）', () => {
    const base = {
      id: 'com.probe.t27',
      name: 'T27 Pack',
      version: '1.0.0',
      apiVersion: 1,
      capabilities: ['ui.shell', 'editor.commands.readonly'],
      entry: { html: 'index.html' },
      assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
    }
    expect(() =>
      validateManifest({ ...base, commands: [{ name: 'editor.bullet-list', handler: 'noop' }] }),
    ).not.toThrow()
    expect(() =>
      validateManifest({ ...base, commands: [{ name: 'editor.bulletList', handler: 'noop' }] }),
    ).toThrow(/非法命令名/)
  })

  it('旧 camelCase 兼容接受并正确映射（显式 legacy；manifest 不可声明）', async () => {
    const resolved = resolveWorkshopEditorCommand('editor.bulletList')
    expect(resolved).toEqual({ command: 'bulletList', protocolName: 'editor.bullet-list', legacy: true })
    expect(isWorkshopEditorInvokeName('editor.bulletList')).toBe(true)
    const executor = installExecutor()
    const { backend } = makeBackend()
    const result = await backend.invokeCommand({ name: 'editor.bulletList' }, editorConn())
    expect(result).toEqual({ ok: true, value: { name: 'editor.bulletList', executed: true } })
    expect(executor.execute).toHaveBeenCalledWith('bulletList')
  })

  it('未知/非法 kebab 名 → E_COMMAND_NOT_ALLOWED（E_FORBIDDEN），执行器零调用', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    for (const name of ['editor.clear-content', 'editor.bulletlist', 'editor.bullet_list', 'editor.BOLD']) {
      const err = await rejection(backend.invokeCommand({ name }, editorConn()))
      expect(err.code).toBe('E_FORBIDDEN')
      expect(String(err.message)).toContain('E_COMMAND_NOT_ALLOWED')
    }
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('kebab 命令能力缺失 → E_CAPABILITY，执行器零调用', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    const err = await rejection(backend.invokeCommand({ name: 'editor.code-block' }, editorConn(['ui.shell'])))
    expect(err.code).toBe('E_CAPABILITY')
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('真实 Broker 链路：manifest 声明 kebab 命令后可调用；未声明仍 E_FORBIDDEN', async () => {
    const executor = installExecutor()
    const { backend } = makeBackend()
    const broker = new Broker(backend, {})
    const declared = { ...editorConn(), declaredCommands: ['editor.bullet-list'] }
    const result = await broker.handle('command.invoke', { name: 'editor.bullet-list' }, declared)
    expect(result).toEqual({ ok: true, value: { name: 'editor.bullet-list', executed: true } })
    expect(executor.execute).toHaveBeenCalledWith('bulletList')

    const undeclared = { ...editorConn(), declaredCommands: [] as string[] }
    const err = await rejection(broker.handle('command.invoke', { name: 'editor.ordered-list' }, undeclared))
    expect(err.code).toBe('E_FORBIDDEN')
  })
})

// ---------------- W07 task-29：可无头产品动作（table/footnote/note/doc.save） ----------------

describe('W07 task-29 可无头产品动作接入 command.invoke', () => {
  // task-33 起 `editor.table.insert` 升级为参数化命令（走执行器 insertTable），不再是无参 action
  const ACTIONS = ['editor.footnote.insert', 'editor.note.insert', 'doc.save'] as const

  afterEach(() => {
    __clearActionHandlers()
  })

  it('3 条无参 action 协议名合法、全部匹配 manifest 正则；不接对话框类动作', () => {
    expect([...WORKSHOP_EDITOR_ACTION_WHITELIST]).toEqual([...ACTIONS])
    expect(WORKSHOP_COMMAND_PROTOCOL_NAMES).toHaveLength(21)
    for (const name of [...WORKSHOP_COMMAND_PROTOCOL_NAMES]) {
      expect(name).toMatch(/^[a-z][a-z0-9.-]{1,80}$/)
    }
    // task-33 起 link/math 升级为参数化无头命令；仍不暴露的是文件选择/模块选择类动作
    expect(WORKSHOP_COMMAND_PROTOCOL_NAMES).toEqual(
      expect.arrayContaining(['editor.link.insert', 'editor.math.inline', 'editor.math.block']),
    )
    for (const dialogAction of ['editor.image.insert', 'editor.module.insert']) {
      expect(WORKSHOP_COMMAND_PROTOCOL_NAMES).not.toContain(dialogAction)
      expect(isWorkshopEditorActionName(dialogAction)).toBe(false)
    }
  })

  it('manifest 可逐条声明 21 条协议命令（kebab/点分均合法）', () => {
    expect(() =>
      validateManifest({
        id: 'com.probe.t29',
        name: 'T29 Pack',
        version: '1.0.0',
        apiVersion: 1,
        capabilities: ['ui.shell', 'editor.commands.readonly'],
        entry: { html: 'index.html' },
        commands: WORKSHOP_COMMAND_PROTOCOL_NAMES.map((name) => ({ name, handler: 'noop' })),
        assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
      }),
    ).not.toThrow()
  })

  it('3 条动作成功：runAction 调用真实 handler，返回 {ok:true,value:{name,executed:true}}', async () => {
    const { backend } = makeBackend()
    for (const name of ACTIONS) {
      const handler = vi.fn()
      const off = registerActionHandler(name, handler)
      const result = await backend.invokeCommand({ name }, editorConn())
      expect(result).toEqual({ ok: true, value: { name, executed: true } })
      expect(handler).toHaveBeenCalledTimes(1)
      off()
      __clearActionHandlers()
    }
  })

  it('handler 未注册（编辑器/应用未就绪）→ E_EDITOR_NOT_READY 如实失败，不假成功', async () => {
    __clearActionHandlers()
    const { backend } = makeBackend()
    for (const name of ACTIONS) {
      const err = await rejection(backend.invokeCommand({ name }, editorConn()))
      expect(err.code).toBe('E_INTERNAL')
      expect(String(err.message)).toContain('E_EDITOR_NOT_READY')
    }
  })

  it('handler 抛错 → E_COMMAND_EXECUTION_FAILED 如实失败', async () => {
    registerActionHandler('doc.save', () => {
      throw new Error('save boom')
    })
    const { backend } = makeBackend()
    const err = await rejection(backend.invokeCommand({ name: 'doc.save' }, editorConn()))
    expect(err.code).toBe('E_INTERNAL')
    expect(String(err.message)).toContain('E_COMMAND_EXECUTION_FAILED')
    expect(String(err.message)).toContain('save boom')
  })

  it('能力缺失（无 editor.commands.readonly）→ E_CAPABILITY，handler 不执行', async () => {
    const handler = vi.fn()
    registerActionHandler('editor.footnote.insert', handler)
    const { backend } = makeBackend()
    const err = await rejection(backend.invokeCommand({ name: 'editor.footnote.insert' }, editorConn(['ui.shell'])))
    expect(err.code).toBe('E_CAPABILITY')
    expect(handler).not.toHaveBeenCalled()
  })

  it('对话框类动作（link/image/math/module）明确拒绝 E_COMMAND_NOT_ALLOWED，不暴露不可无头动作', async () => {
    const { backend } = makeBackend()
    for (const name of ['editor.image.insert', 'editor.module.insert']) {
      const err = await rejection(backend.invokeCommand({ name }, editorConn()))
      expect(err.code).toBe('E_FORBIDDEN')
      expect(String(err.message)).toContain('E_COMMAND_NOT_ALLOWED')
    }
  })

  it('未声明的 doc.* 命令明确拒绝（E_FORBIDDEN），不落到 article meta 处理器', async () => {
    const { backend } = makeBackend()
    for (const name of ['doc.delete', 'doc.next', 'doc.close']) {
      const err = await rejection(backend.invokeCommand({ name }, editorConn()))
      expect(err.code).toBe('E_FORBIDDEN')
      expect(String(err.message)).toContain('E_COMMAND_NOT_ALLOWED')
    }
  })

  it('真实 Broker 链路：manifest 声明 doc.save 后可调用成功；未声明仍 E_FORBIDDEN', async () => {
    const handler = vi.fn()
    registerActionHandler('doc.save', handler)
    const { backend } = makeBackend()
    const broker = new Broker(backend, {})
    const declared = { ...editorConn(), declaredCommands: ['doc.save'] }
    const result = await broker.handle('command.invoke', { name: 'doc.save' }, declared)
    expect(result).toEqual({ ok: true, value: { name: 'doc.save', executed: true } })
    expect(handler).toHaveBeenCalledTimes(1)

    const undeclared = { ...editorConn(), declaredCommands: [] as string[] }
    const err = await rejection(broker.handle('command.invoke', { name: 'doc.save' }, undeclared))
    expect(err.code).toBe('E_FORBIDDEN')
  })

  it('14 条切换命令路径不受影响（仍走 EditorArea executor，不经 runAction）', async () => {
    const executor = installExecutor()
    const runSpy = vi.fn()
    registerActionHandler('editor.table.insert', runSpy)
    const { backend } = makeBackend()
    const result = await backend.invokeCommand({ name: 'editor.bold' }, editorConn())
    expect(result).toEqual({ ok: true, value: { name: 'editor.bold', executed: true } })
    expect(executor.execute).toHaveBeenCalledWith('bold')
    expect(runSpy).not.toHaveBeenCalled()
  })
})

// ---------------- W07 task-33：参数化无头命令（link/math/table，严格 args 校验） ----------------

function paramExecutor() {
  const executor = {
    execute: vi.fn((_name: string, _args?: Record<string, unknown>) => ({ ok: true })),
  }
  ;(window as unknown as { __KE_WORKSHOP_EDITOR__?: typeof executor }).__KE_WORKSHOP_EDITOR__ = executor
  return executor
}

const HREF_2048 = 'https://' + 'a'.repeat(2048 - 'https://'.length)

describe('W07 task-33 参数化无头命令（协议层校验 + 执行器传参）', () => {
  afterEach(() => {
    delete (window as unknown as { __KE_WORKSHOP_EDITOR__?: ReturnType<typeof paramExecutor> }).__KE_WORKSHOP_EDITOR__
  })

  it('4 条参数化协议名合法且映射内部键固定；link 变体不在白名单', async () => {
    expect([...WORKSHOP_EDITOR_PARAM_COMMANDS]).toEqual([
      'editor.link.insert',
      'editor.math.inline',
      'editor.math.block',
      'editor.table.insert',
    ])
    for (const name of WORKSHOP_EDITOR_PARAM_COMMANDS) {
      expect(name).toMatch(/^[a-z][a-z0-9.-]{1,80}$/)
      expect(isWorkshopEditorParamName(name)).toBe(true)
    }
    expect(WORKSHOP_EDITOR_PARAM_KEY).toEqual({
      'editor.link.insert': 'linkInsert',
      'editor.math.inline': 'mathInline',
      'editor.math.block': 'mathBlock',
      'editor.table.insert': 'tableInsert',
    })
    const executor = paramExecutor()
    const { backend } = makeBackend()
    const err = await rejection(backend.invokeCommand({ name: 'editor.link.remove', args: { href: 'https://x' } }, editorConn()))
    expect(err.code).toBe('E_FORBIDDEN')
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('link.insert 成功：http/https/mailto 通过（scheme 大小写不敏感），href 去首尾空白后传执行器', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ href: 'https://example.com/a', text: '标签' }, { href: 'https://example.com/a', text: '标签' }],
      [{ href: 'http://example.com' }, { href: 'http://example.com' }],
      [{ href: '  mailto:user@example.com  ' }, { href: 'mailto:user@example.com' }],
      [{ href: 'HTTPS://EXAMPLE.COM/X', text: '大写 scheme' }, { href: 'HTTPS://EXAMPLE.COM/X', text: '大写 scheme' }],
      [{ href: 'https://example.com/a', text: '' }, { href: 'https://example.com/a' }],
    ]
    for (const [args] of cases) {
      const result = await backend.invokeCommand({ name: 'editor.link.insert', args }, editorConn())
      expect(result).toEqual({ ok: true, value: { name: 'editor.link.insert', executed: true } })
    }
    expect(executor.execute.mock.calls.map((call) => [call[0], call[1]])).toEqual(
      cases.map(([, expected]) => ['linkInsert', expected]),
    )
  })

  it('link.insert 危险/不合法 href 拒绝 E_BAD_PAYLOAD 且不执行（含相对路径/其它 scheme）', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<b>x</b>',
      'file:///C:/Windows/win.ini',
      '/relative/path',
      'relative/path',
      'ftp://example.com/x',
      '//example.com/x',
      'https://',
      'mailto:',
      '  ',
      'https://example.com/a b',
    ]) {
      const err = await rejection(backend.invokeCommand({ name: 'editor.link.insert', args: { href } }, editorConn()))
      expect(err.code, `href=${href}`).toBe('E_BAD_PAYLOAD')
    }
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('link.insert 长度边界：href=2048/text=500 通过；2049/501 拒绝', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    await expect(
      backend.invokeCommand({ name: 'editor.link.insert', args: { href: HREF_2048, text: 'x'.repeat(500) } }, editorConn()),
    ).resolves.toEqual({ ok: true, value: { name: 'editor.link.insert', executed: true } })
    for (const args of [
      { href: HREF_2048 + 'a' },
      { href: 'https://example.com/x', text: 'x'.repeat(501) },
    ]) {
      const err = await rejection(backend.invokeCommand({ name: 'editor.link.insert', args }, editorConn()))
      expect(err.code).toBe('E_BAD_PAYLOAD')
    }
    expect(executor.execute).toHaveBeenCalledTimes(1)
  })

  it('link.insert 参数形态非法（缺 href/非对象/未知键/text 控制字符）→ E_BAD_PAYLOAD', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    for (const args of [undefined, {}, { text: 'x' }, { href: 123 }, { href: 'https://x', extra: 1 }, { href: 'https://x', text: 'a\u0000b' }]) {
      const err = await rejection(backend.invokeCommand({ name: 'editor.link.insert', args }, editorConn()))
      expect(err.code).toBe('E_BAD_PAYLOAD')
    }
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('math.inline/math.block 成功：latex 原样传执行器（控制字符除外，常见空白允许）', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    const latex = 'E = mc^2\n\\int_0^1 x dx'
    for (const name of ['editor.math.inline', 'editor.math.block']) {
      const result = await backend.invokeCommand({ name, args: { latex } }, editorConn())
      expect(result).toEqual({ ok: true, value: { name, executed: true } })
    }
    expect(executor.execute.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['mathInline', { latex }],
      ['mathBlock', { latex }],
    ])
  })

  it('math 非法：空/缺参/超长 2000+/控制字符/未知键 → E_BAD_PAYLOAD 不执行', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    for (const args of [
      undefined,
      {},
      { latex: '' },
      { latex: 42 },
      { latex: 'x'.repeat(2001) },
      { latex: 'a\u0000b' },
      { latex: 'a\u0007b' },
      { latex: 'x^2', extra: true },
    ]) {
      const err = await rejection(backend.invokeCommand({ name: 'editor.math.inline', args }, editorConn()))
      expect(err.code).toBe('E_BAD_PAYLOAD')
    }
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('table.insert：缺省 3/3/true；显式 1-8 边界通过并按规范化参数传执行器', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    const cases: Array<[Record<string, unknown> | undefined, Record<string, unknown>]> = [
      [undefined, { rows: 3, cols: 3, withHeaderRow: true }],
      [{}, { rows: 3, cols: 3, withHeaderRow: true }],
      [{ rows: 1, cols: 8, withHeaderRow: false }, { rows: 1, cols: 8, withHeaderRow: false }],
      [{ rows: 8, cols: 1 }, { rows: 8, cols: 1, withHeaderRow: true }],
    ]
    for (const [args] of cases) {
      const result = await backend.invokeCommand({ name: 'editor.table.insert', args }, editorConn())
      expect(result).toEqual({ ok: true, value: { name: 'editor.table.insert', executed: true } })
    }
    expect(executor.execute.mock.calls.map((call) => [call[0], call[1]])).toEqual(
      cases.map(([, expected]) => ['tableInsert', expected]),
    )
  })

  it('table.insert 越界/非整数/类型错误/未知键 → E_BAD_PAYLOAD 不执行', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    for (const args of [
      { rows: 0 },
      { rows: 9 },
      { rows: 2.5 },
      { rows: '3' },
      { cols: 0 },
      { cols: 9 },
      { cols: 2.5 },
      { withHeaderRow: 'yes' },
      { withHeaderRow: 1 },
      { rows: 3, extra: true },
    ]) {
      const err = await rejection(backend.invokeCommand({ name: 'editor.table.insert', args }, editorConn()))
      expect(err.code).toBe('E_BAD_PAYLOAD')
    }
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('参数非法不执行（executor 零调用）且优先于能力检查（E_BAD_PAYLOAD）', async () => {
    const executor = paramExecutor()
    const { backend } = makeBackend()
    const err = await rejection(
      backend.invokeCommand({ name: 'editor.link.insert', args: { href: 'javascript:1' } }, editorConn(['ui.shell'])),
    )
    expect(err.code).toBe('E_BAD_PAYLOAD')
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('参数合法但能力缺失 → E_CAPABILITY；执行器缺失 → E_EDITOR_NOT_READY；执行器失败 → E_COMMAND_EXECUTION_FAILED', async () => {
    const { backend } = makeBackend()
    const capErr = await rejection(
      backend.invokeCommand({ name: 'editor.table.insert', args: {} }, editorConn(['ui.shell'])),
    )
    expect(capErr.code).toBe('E_CAPABILITY')

    delete (window as unknown as { __KE_WORKSHOP_EDITOR__?: unknown }).__KE_WORKSHOP_EDITOR__
    const readyErr = await rejection(
      backend.invokeCommand({ name: 'editor.math.inline', args: { latex: 'x' } }, editorConn()),
    )
    expect(readyErr.code).toBe('E_INTERNAL')
    expect(String(readyErr.message)).toContain('E_EDITOR_NOT_READY')

    const failing = { execute: vi.fn(() => ({ ok: false, error: 'E_COMMAND_EXECUTION_FAILED' })) }
    ;(window as unknown as { __KE_WORKSHOP_EDITOR__?: typeof failing }).__KE_WORKSHOP_EDITOR__ = failing
    const execErr = await rejection(
      backend.invokeCommand({ name: 'editor.table.insert', args: { rows: 2 } }, editorConn()),
    )
    expect(execErr.code).toBe('E_INTERNAL')
    expect(String(execErr.message)).toContain('E_COMMAND_EXECUTION_FAILED')
  })

  it('无参命令收到非空 args → E_BAD_PAYLOAD 不执行（toggle 与 action 均明确拒绝）', async () => {
    const executor = paramExecutor()
    const handler = vi.fn()
    registerActionHandler('doc.save', handler)
    const { backend } = makeBackend()
    for (const name of ['editor.bold', 'editor.undo', 'doc.save', 'editor.footnote.insert']) {
      const err = await rejection(backend.invokeCommand({ name, args: { unexpected: 1 } }, editorConn()))
      expect(err.code, name).toBe('E_BAD_PAYLOAD')
    }
    expect(executor.execute).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    // 空对象/缺省仍可执行
    await expect(backend.invokeCommand({ name: 'editor.bold', args: {} }, editorConn())).resolves.toEqual({
      ok: true,
      value: { name: 'editor.bold', executed: true },
    })
    expect(executor.execute).toHaveBeenCalledWith('bold')
    __clearActionHandlers()
  })

  it('validateWorkshopEditorArgs 纯函数：非参数化命令/非对象 args 拒绝', () => {
    expect(validateWorkshopEditorArgs('editor.bold', {})).toMatchObject({ ok: false })
    expect(validateWorkshopEditorArgs('editor.link.insert', [] as never)).toMatchObject({ ok: false })
    expect(validateWorkshopEditorArgs('editor.link.insert', { href: 'https://x' })).toMatchObject({
      ok: true,
      value: { href: 'https://x' },
    })
  })
})

// ---------------- W07 task-33：EditorArea 参数化执行器 ----------------

describe('W07 task-33 EditorArea 参数化执行器（fake chain 校验调用参数）', () => {
  function fakeParamEditor(opts: { selectionEmpty?: boolean; runResult?: boolean } = {}) {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const chain: Record<string, unknown> = {}
    for (const method of ['focus', 'toggleBold', 'insertContent', 'insertTable', 'extendMarkRange', 'setLink']) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return chain
      }
    }
    chain.run = () => opts.runResult ?? true
    const editor = {
      isDestroyed: false,
      state: { selection: { empty: opts.selectionEmpty ?? true } },
      chain: () => chain,
    }
    return { calls, editor }
  }

  it('参数化执行器映射键与协议映射一致（4 条）', () => {
    expect(Object.keys(WORKSHOP_EDITOR_PARAM_EXECUTORS).sort()).toEqual(Object.values(WORKSHOP_EDITOR_PARAM_KEY).sort())
    expect(Object.keys(WORKSHOP_EDITOR_PARAM_EXECUTORS)).toHaveLength(4)
  })

  it('tableInsert：按规范化参数调用 insertTable（rows/cols/withHeaderRow）', () => {
    const { calls, editor } = fakeParamEditor()
    const executor = createWorkshopEditorExecutor(() => editor as never)
    expect(executor.execute('tableInsert', { rows: 2, cols: 4, withHeaderRow: false })).toEqual({ ok: true })
    expect(calls.find((call) => call.method === 'insertTable')?.args[0]).toEqual({
      rows: 2,
      cols: 4,
      withHeaderRow: false,
    })
  })

  it('mathInline/mathBlock：insertContent 节点 type/attrs（id 非空、latex 原样）', () => {
    for (const [key, type] of [
      ['mathInline', 'math'],
      ['mathBlock', 'mathBlock'],
    ] as const) {
      const { calls, editor } = fakeParamEditor()
      const executor = createWorkshopEditorExecutor(() => editor as never)
      expect(executor.execute(key, { latex: 'x^2' })).toEqual({ ok: true })
      const node = calls.find((call) => call.method === 'insertContent')?.args[0] as {
        type: string
        attrs: { id: string; latex: string }
      }
      expect(node.type).toBe(type)
      expect(node.attrs.latex).toBe('x^2')
      expect(typeof node.attrs.id).toBe('string')
      expect(node.attrs.id.length).toBeGreaterThan(0)
    }
  })

  it('linkInsert：有选区 → extendMarkRange(link)+setLink；无选区 → insertContent 文本（text||href，含 link mark）', () => {
    // 有选区：extendMarkRange + setLink，text 不参与
    const selected = fakeParamEditor({ selectionEmpty: false })
    const execSelected = createWorkshopEditorExecutor(() => selected.editor as never)
    expect(execSelected.execute('linkInsert', { href: 'https://e.com/x', text: '忽略' })).toEqual({ ok: true })
    expect(selected.calls.some((call) => call.method === 'extendMarkRange' && call.args[0] === 'link')).toBe(true)
    expect(selected.calls.find((call) => call.method === 'setLink')?.args[0]).toEqual({ href: 'https://e.com/x' })
    expect(selected.calls.some((call) => call.method === 'insertContent')).toBe(false)

    // 无选区 + text → insertContent 指定文本
    const plain = fakeParamEditor({ selectionEmpty: true })
    const execPlain = createWorkshopEditorExecutor(() => plain.editor as never)
    expect(execPlain.execute('linkInsert', { href: 'https://e.com/y', text: '点我' })).toEqual({ ok: true })
    expect(plain.calls.find((call) => call.method === 'insertContent')?.args[0]).toEqual({
      type: 'text',
      text: '点我',
      marks: [{ type: 'link', attrs: { href: 'https://e.com/y' } }],
    })

    // 无选区 + 无 text → 文本回退为 href
    const noText = fakeParamEditor({ selectionEmpty: true })
    const execNoText = createWorkshopEditorExecutor(() => noText.editor as never)
    expect(execNoText.execute('linkInsert', { href: 'https://e.com/z' })).toEqual({ ok: true })
    expect(noText.calls.find((call) => call.method === 'insertContent')?.args[0]).toMatchObject({
      type: 'text',
      text: 'https://e.com/z',
    })
  })

  it('无参命令收到非空 args → E_BAD_PAYLOAD 且不执行 chain（第二道防线）', () => {
    const { calls, editor } = fakeParamEditor()
    const executor = createWorkshopEditorExecutor(() => editor as never)
    expect(executor.execute('bold', { unexpected: 1 })).toEqual({ ok: false, error: 'E_BAD_PAYLOAD' })
    expect(calls).toHaveLength(0)
    expect(executor.execute('bold', {})).toEqual({ ok: true })
    expect(calls[0]?.method).toBe('focus')
  })

  it('参数化命令 args 非对象（null/数组）→ E_BAD_PAYLOAD', () => {
    const { calls, editor } = fakeParamEditor()
    const executor = createWorkshopEditorExecutor(() => editor as never)
    expect(executor.execute('tableInsert', null as unknown as Record<string, unknown>)).toEqual({
      ok: false,
      error: 'E_BAD_PAYLOAD',
    })
    expect(executor.execute('tableInsert', [] as unknown as Record<string, unknown>)).toEqual({
      ok: false,
      error: 'E_BAD_PAYLOAD',
    })
    expect(calls).toHaveLength(0)
  })
})
