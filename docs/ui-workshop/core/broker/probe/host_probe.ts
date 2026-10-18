/**
 * P3-T18 实机探针（host 侧）：真实 Broker + brokeredHandlers + HostDispatcher，
 * 通过 window.postMessage JSON 线连接 sandbox iframe 内的恶意/故障 guest。
 */
import { brokeredHandlers } from '../../../../../frontend/src/core/broker/binding'
import { Broker, type BrokerBackend, type BrokerConnection } from '../../../../../frontend/src/core/broker/broker'
import { HostDispatcher } from '../../../../../frontend/src/core/protocol/channel'
import type { ProtocolMethods } from '../../../../../frontend/src/core/protocol/types'
import guestCode from './guest-code.txt'

function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const g = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  if (g?.core?.invoke) return g.core.invoke(cmd, args)
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
  if (i?.invoke) return i.invoke(cmd, args)
  return Promise.reject(new Error('no tauri invoke'))
}

const conn: BrokerConnection = {
  connectionId: 'probe-guest-conn',
  packId: 'com.probe.malicious',
  packVersion: '0.1.0',
  role: 'guest',
  capabilities: ['context.read', 'print.request', 'ui.shell'],
  contextId: 'ctx-broker',
  epoch: 1,
  declaredCommands: ['demo.hello'],
}

class ProbeBackend implements BrokerBackend {
  epoch: number | null = 1
  currentEpoch(): number | null { return this.epoch }
  async snapshot(params: ProtocolMethods['context.snapshot']['params']) {
    return { relPath: params.relPath, revision: 1, diskHash: 'probe-hash' }
  }
  async write(params: ProtocolMethods['context.write']['params']) {
    return { requestId: params.requestId ?? 'auto', status: 'completed' as const, revision: 1, fileDurable: true }
  }
  async print(params: ProtocolMethods['print.snapshot']['params']) {
    return { pdfToken: `tok-${params.relPath}`, pages: 1 }
  }
  async invokeCommand(params: ProtocolMethods['command.invoke']['params']) {
    return { ok: true, value: params.name }
  }
}

const result: Record<string, unknown> = { phase: 'broker-start', ua: navigator.userAgent }
const diag = { iframeLoaded: false, messages: [] as string[] }

async function main(): Promise<void> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.id = 'broker-guest'
  iframe.style.cssText = 'width:320px;height:80px;border:1px solid #999'
  document.body.appendChild(iframe)
  iframe.srcdoc = `<!doctype html><html><body><div>malicious guest</div><script>${guestCode}<\/script></body></html>`

  const wirePort = {
    postMessage: (msg: unknown) => iframe.contentWindow?.postMessage({ type: 'broker-wire', direction: 'host-to-guest', msg }, '*'),
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (e: MessageEvent) => {
        const d = e.data as { type?: string; direction?: string; msg?: unknown }
        if (d?.type === 'broker-wire' && d.direction === 'guest-to-host') cb(d.msg)
      }
      window.addEventListener('message', handler)
      return () => window.removeEventListener('message', handler)
    },
  }
  const broker = new Broker(new ProbeBackend(), { maxPayloadBytes: 1024, maxInflight: 4 })
  const dispatcher = new HostDispatcher(wirePort, brokeredHandlers(broker, conn), {
    features: conn.capabilities,
    hostVersion: 'probe-host-broker-1',
    context: () => ({ contextId: conn.contextId, epoch: conn.epoch }),
  })
  dispatcher.start()
  iframe.addEventListener('load', () => {
    diag.iframeLoaded = true
    iframe.contentWindow?.postMessage({ type: 'broker-port' }, '*')
  })
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 12000)
    window.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { type?: string; payload?: Record<string, unknown> }
      if (typeof data?.type === 'string') diag.messages.push(data.type)
      if (data?.type !== 'broker-guest-results') return
      clearTimeout(timer)
      result.phase = 'broker-done'
      result.guest = data.payload
      resolve()
    })
  })
  if (result.phase === 'broker-start') {
    result.phase = 'broker-timeout'
    result.diag = diag
  }
  const json = JSON.stringify(result)
  document.body.insertAdjacentHTML('beforeend', `<pre id="broker-result" style="font:10px monospace;white-space:pre-wrap">${json}</pre>`)
  try {
    await tauriInvoke('report_results', { results: json })
    await tauriInvoke('debug_log', { marker: 'broker-probe-reported' })
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', `<div>REPORT FAILED: ${String(e)}</div>`)
  }
}

void main()
