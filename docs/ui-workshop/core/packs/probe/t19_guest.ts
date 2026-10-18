/** T19 探针 guest：sandbox iframe 内真实 GuestClient（握手 + 只读 snapshot），随后保持存活。 */
import { GuestClient } from '../../../../../frontend/src/core/protocol/channel'

function portFromParent(): { postMessage(m: unknown): void; onMessage(cb: (m: unknown) => void): () => void } {
  return {
    postMessage: (msg: unknown) => window.parent.postMessage({ type: 't19-wire', direction: 'guest-to-host', msg }, '*'),
    onMessage: (cb: (msg: unknown) => void) => {
      const h = (e: MessageEvent) => {
        const d = e.data as { type?: string; direction?: string; msg?: unknown }
        if (d?.type === 't19-wire' && d.direction === 'host-to-guest') cb(d.msg)
      }
      window.addEventListener('message', h)
      return () => window.removeEventListener('message', h)
    },
  }
}

window.parent.postMessage({ type: 't19-guest-alive', ua: navigator.userAgent }, '*')
window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string }
  if (d?.type !== 't19-port') return
  void (async () => {
    const out: Record<string, unknown> = { phase: 't19-guest-start' }
    try {
      const client = new GuestClient(portFromParent(), { sdkVersion: 't19-guest-1', requestedFeatures: ['context.read'], timeoutMs: 4000 })
      const hs = await client.handshake()
      out.handshakeAccepted = hs.acceptedFeatures
      out.snapshot = await client.request('context.snapshot', { relPath: 'Articles/t19.md' })
      out.phase = 't19-guest-done'
    } catch (e) {
      out.phase = 't19-guest-error'
      out.error = String((e as Error)?.stack ?? e)
    }
    window.parent.postMessage({ type: 't19-guest-results', payload: out }, '*')
  })()
})
