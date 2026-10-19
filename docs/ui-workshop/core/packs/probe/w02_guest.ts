/**
 * W02 表单交接探针 guest：握手后经 Broker `command.invoke` 提交 title，
 * 再尝试未知命令（应被拒绝），结果 postMessage 给宿主。
 */
import { GuestClient } from '../../../../../frontend/src/core/protocol/channel'

interface WirePort {
  postMessage(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
}

function portFromParent(): WirePort {
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
    const out: Record<string, unknown> = { phase: 'w02-guest-start' }
    try {
      const client = new GuestClient(portFromParent(), {
        sdkVersion: 'w02-guest-1',
        requestedFeatures: ['ui.shell', 'context.read'],
        timeoutMs: 4000,
      })
      out.handshakeAccepted = await client.handshake()
      try {
        out.setTitle = await client.request('command.invoke', {
          name: 'article.set-title',
          args: { relPath: 'Articles/a.md', title: 'W02 交接标题' },
        })
      } catch (e) {
        out.setTitleError = String((e as Error)?.message ?? e)
      }
      try {
        out.setTags = await client.request('command.invoke', {
          name: 'article.set-tags',
          args: { relPath: 'Articles/a.md', tags: ['w02', '交接'] },
        })
      } catch (e) {
        out.setTagsError = String((e as Error)?.message ?? e)
      }
      try {
        out.forbidden = await client.request('command.invoke', {
          name: 'article.delete',
          args: { relPath: 'Articles/a.md' },
        })
      } catch (e) {
        out.forbiddenError = String((e as Error)?.message ?? e)
      }
      out.phase = 'w02-guest-done'
    } catch (e) {
      out.phase = 'w02-guest-error'
      out.error = String((e as Error)?.stack ?? e)
    }
    window.parent.postMessage({ type: 't19-guest-results', payload: out }, '*')
    setInterval(() => window.parent.postMessage({ type: 't19-heartbeat' }, '*'), 200)
  })()
})
