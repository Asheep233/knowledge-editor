/**
 * P1-T11 传输探针（guest 侧）：在 sandbox iframe 内用真实 protocol GuestClient
 * 通过 MessagePort 与宿主 HostDispatcher 完成 handshake / request / event。
 *
 * 构建产物被（作为文本）内联进 host_probe.ts 的 iframe srcdoc 中运行。
 */
import { GuestClient } from '../../../../../frontend/src/core/protocol/channel'
import type { HostEvent } from '../../../../../frontend/src/core/protocol/types'

interface ProbeResult {
  phase: 'guest-done' | 'guest-error'
  handshakeOk?: boolean
  handshake?: unknown
  acceptedFeatures?: string[]
  contextId?: string | null
  epoch?: number | null
  write?: unknown
  events?: HostEvent[]
  error?: string
  ua?: string
}

function windowWirePort(): { postMessage(msg: unknown): void; onMessage(cb: (msg: unknown) => void): () => void } {
  return {
    postMessage: (msg: unknown) => window.parent.postMessage({ type: 'probe-wire', direction: 'guest-to-host', msg }, '*'),
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (e: MessageEvent) => {
        const d = e.data as { type?: string; direction?: string; msg?: unknown }
        if (d?.type === 'probe-wire' && d.direction === 'host-to-guest') cb(d.msg)
      }
      window.addEventListener('message', handler)
      return () => window.removeEventListener('message', handler)
    },
  }
}

function makePort(mp: MessagePort) {
  mp.start()
  return {
    postMessage: (msg: unknown) => mp.postMessage(msg),
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (e: MessageEvent) => cb(e.data)
      mp.addEventListener('message', handler)
      return () => mp.removeEventListener('message', handler)
    },
  }
}

function diag(stage: string, extra?: Record<string, unknown>): void {
  window.parent.postMessage({ type: 'probe-guest-diag', stage, ...(extra ?? {}) }, '*')
}

type WirePort = { postMessage(msg: unknown): void; onMessage(cb: (msg: unknown) => void): () => void }

async function run(port: WirePort): Promise<void> {
  const out: ProbeResult = { phase: 'guest-done', ua: navigator.userAgent }
  try {
    diag('received-port')
    const client = new GuestClient(port, { sdkVersion: 'probe-guest-1', requestedFeatures: ['write', 'print'], timeoutMs: 4000 })
    diag('client-created')
    const events: HostEvent[] = []
    client.onEvent((e) => events.push(e))
    diag('handshake-sent')
    const handshake = await client.handshake()
    diag('handshake-ok', { accepted: handshake.acceptedFeatures })
    out.handshakeOk = handshake.ok
    out.handshake = handshake
    out.acceptedFeatures = handshake.acceptedFeatures
    out.contextId = handshake.contextId
    out.epoch = handshake.epoch
    out.write = await client.request('context.write', {
      relPath: 'Articles/proto.md',
      content: '协议传输探针',
      expectedRevision: 0,
      requestId: 'probe-write-1',
    })
    // 等宿主事件（context-changed/theme-changed）
    await new Promise((r) => setTimeout(r, 400))
    out.events = events
  } catch (e) {
    out.phase = 'guest-error'
    out.error = String((e as Error)?.stack ?? e)
    diag('guest-error', { error: out.error })
  }
  window.parent.postMessage({ type: 'probe-guest-results', payload: out }, '*')
}

window.parent.postMessage({ type: 'probe-guest-alive', ua: navigator.userAgent }, '*')

window.addEventListener('message', (e: MessageEvent) => {
  const data = e.data as { type?: string; port?: MessagePort }
  if (data?.type !== 'probe-port') return
  if (data.port) {
    diag('window-message', { hasPort: true })
    void run(makePort(data.port))
  } else {
    // MessagePort 无法传入 opaque-origin sandbox iframe（见证据记录）→ 退化为 window.postMessage JSON 传输
    diag('window-message', { hasPort: false })
    void run(windowWirePort())
  }
})
