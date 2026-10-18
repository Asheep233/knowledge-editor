/**
 * P1-T11 传输探针（host 侧，运行于真实 WebView2 主窗口）：
 * 创建 sandbox iframe → 通过 MessageChannel 把 port 交给 iframe 内 GuestClient →
 * HostDispatcher 处理 handshake/request、广播事件 → 收集 guest 结果并经 Tauri report_results 落盘。
 */
import { HostDispatcher } from '../../../../../frontend/src/core/protocol/channel'
import type { HostEvent } from '../../../../../frontend/src/core/protocol/types'
// 由构建脚本把 guest bundle 拷成 guest-code.txt，以文本内联进 iframe srcdoc
import guestCode from './guest-code.txt'

function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const g = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  if (g?.core?.invoke) return g.core.invoke(cmd, args)
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
  if (i?.invoke) return i.invoke(cmd, args)
  return Promise.reject(new Error('no tauri invoke'))
}

const result: Record<string, unknown> = { phase: 'protocol-start', ua: navigator.userAgent }
const diag: { iframeLoaded: boolean; portPosted: boolean; hostMessages: string[] } = { iframeLoaded: false, portPosted: false, hostMessages: [] }

async function main(): Promise<void> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.id = 'proto-guest'
  iframe.style.cssText = 'width:320px;height:80px;border:1px solid #999'
  document.body.appendChild(iframe)
  const srcdoc = `<!doctype html><html><body><div id="guest">guest</div><script>${guestCode}<\/script></body></html>`
  iframe.srcdoc = srcdoc
  // 注：WebView2/Chromium 中 MessagePort 不能 transfer 进 opaque-origin sandbox iframe
  // （实测 message 到达但 e.data.port 为空）→ 传输候选退化为 window.postMessage JSON 线（带 channel 标记）。
  const hostWirePort = {
    postMessage: (msg: unknown) => iframe.contentWindow?.postMessage({ type: 'probe-wire', direction: 'host-to-guest', msg }, '*'),
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (e: MessageEvent) => {
        const d = e.data as { type?: string; direction?: string; msg?: unknown }
        if (d?.type === 'probe-wire' && d.direction === 'guest-to-host') cb(d.msg)
      }
      window.addEventListener('message', handler)
      return () => window.removeEventListener('message', handler)
    },
  }
  const emitted: HostEvent[] = []
  const dispatcher = new HostDispatcher(hostWirePort, {
    'protocol.capabilities': () => ({ protocolVersion: 1, features: ['write', 'print'], contextId: 'ctx-proto', epoch: 1 }),
    'context.snapshot': (params) => ({ relPath: (params as { relPath: string }).relPath, revision: 0, diskHash: 'probe-hash' }),
    'context.write': (params) => {
      const p = params as { relPath: string; expectedRevision: number; requestId?: string }
      // 广播事件（guest 应能收到）
      const ev1: HostEvent = { type: 'theme-changed', theme: 'dark' }
      const ev2: HostEvent = { type: 'context-changed', contextId: 'ctx-proto', epoch: 1 }
      emitted.push(ev1, ev2)
      dispatcher.emit(ev1)
      dispatcher.emit(ev2)
      return {
        requestId: p.requestId ?? 'auto',
        status: 'completed' as const,
        revision: p.expectedRevision + 1,
        accepted: true,
        recoveryDurable: true,
        fileDurable: true,
      }
    },
    'print.snapshot': () => ({ pdfToken: 'tok', pages: 1 }),
  }, { features: ['write', 'print'], hostVersion: 'probe-host-1', context: () => ({ contextId: 'ctx-proto', epoch: 1 }) })
  dispatcher.start()
  result.hostDispatcherStarted = true

  iframe.addEventListener('load', () => {
    diag.iframeLoaded = true
    try {
      iframe.contentWindow?.postMessage({ type: 'probe-port' }, '*')
      diag.portPosted = true
    } catch (e) {
      diag.hostMessages.push('post-port-error: ' + String(e))
    }
  })

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 12000)
    window.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { type?: string; payload?: Record<string, unknown> }
      if (typeof data?.type === 'string') {
        const extra = data as { stage?: string; error?: string; hasPort?: boolean; type: string }
        const detail = extra.stage ? `${extra.stage}${extra.error ? ':' + extra.error.slice(0, 120) : ''}${extra.hasPort !== undefined ? ':port=' + extra.hasPort : ''}` : ''
        diag.hostMessages.push(detail ? `${data.type}:${detail}` : data.type)
      }
      if (data?.type !== 'probe-guest-results') return
      clearTimeout(timer)
      result.phase = 'protocol-done'
      result.guest = data.payload
      result.hostEmittedEvents = emitted
      resolve()
    })
  })
  if (result.phase === 'protocol-start') {
    result.phase = 'protocol-timeout'
    result.hostEmittedEvents = emitted
    result.diag = diag
  }
  const json = JSON.stringify(result)
  const pre = document.createElement('pre')
  pre.id = 'protocol-result'
  pre.textContent = json
  document.body.appendChild(pre)
  try {
    await tauriInvoke('report_results', { results: json })
    await tauriInvoke('debug_log', { marker: 'protocol-probe-reported' })
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', `<div>REPORT FAILED: ${String(e)}</div>`)
  }
}

void main()
