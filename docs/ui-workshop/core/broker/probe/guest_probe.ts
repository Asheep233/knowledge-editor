/**
 * P3-T18 实机探针（guest 侧）：恶意/故障 guest 只能走受控协议面。
 * 依次尝试：正常 snapshot、越权 write、已声明命令、未声明命令、超限 payload、未知方法、
 * 直接从 opaque iframe 调 Tauri 原生命令；最后验证 host 仍健康。
 */
import { GuestClient } from '../../../../../frontend/src/core/protocol/channel'
import type { HostEvent } from '../../../../../frontend/src/core/protocol/types'

type WirePort = { postMessage(msg: unknown): void; onMessage(cb: (msg: unknown) => void): () => void }

function parentWirePort(): WirePort {
  return {
    postMessage: (msg: unknown) => window.parent.postMessage({ type: 'broker-wire', direction: 'guest-to-host', msg }, '*'),
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (e: MessageEvent) => {
        const d = e.data as { type?: string; direction?: string; msg?: unknown }
        if (d?.type === 'broker-wire' && d.direction === 'host-to-guest') cb(d.msg)
      }
      window.addEventListener('message', handler)
      return () => window.removeEventListener('message', handler)
    },
  }
}

function codeOf(e: unknown): string {
  const err = e as { error?: { code?: string }; message?: string }
  return err?.error?.code ?? err?.message ?? String(e)
}

async function tauriProbe(): Promise<string> {
  const g = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string) => Promise<unknown> } } }).__TAURI__
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__
  const invoke = g?.core?.invoke ?? i?.invoke
  if (!invoke) return 'no-tauri-global'
  try {
    await invoke('whoami')
    return 'UNEXPECTED_ALLOWED'
  } catch (e) {
    return 'rejected: ' + String((e as Error)?.message ?? e).slice(0, 160)
  }
}

async function run(): Promise<void> {
  const out: Record<string, unknown> = { phase: 'broker-guest-start', ua: navigator.userAgent }
  const events: HostEvent[] = []
  try {
    const client = new GuestClient(parentWirePort(), { sdkVersion: 'probe-guest-1', requestedFeatures: ['context.read', 'print.request', 'ui.shell'], timeoutMs: 4000 })
    client.onEvent((e) => events.push(e))
    const hs = await client.handshake()
    out.handshakeAccepted = hs.acceptedFeatures
    out.snapshot = await client.request('context.snapshot', { relPath: 'Articles/probe.md' }).then((r) => ({ ok: true, revision: r.revision }))
    out.writeError = await client.request('context.write', { relPath: 'Articles/probe.md', content: 'x', expectedRevision: 0 }).then(() => 'UNEXPECTED_ALLOWED', codeOf)
    out.declaredCommand = await client.request('command.invoke', { name: 'demo.hello' }).then((r) => ({ ok: r.ok, value: r.value }), codeOf)
    out.undeclaredCommandError = await client.request('command.invoke', { name: 'system.exec' }).then(() => 'UNEXPECTED_ALLOWED', codeOf)
    out.oversizeError = await client.request('command.invoke', { name: 'demo.hello', args: { blob: 'x'.repeat(4096) } }).then(() => 'UNEXPECTED_ALLOWED', codeOf)
    out.unknownMethodError = await client.request('system.exec' as never, {} as never).then(() => 'UNEXPECTED_ALLOWED', codeOf)
    out.tauriDirectInvoke = await tauriProbe()
    out.events = events
    out.hostHealthyAfterAttacks = await client.request('context.snapshot', { relPath: 'Articles/after.md' }).then(() => true, () => false)
    out.phase = 'broker-guest-done'
  } catch (e) {
    out.phase = 'broker-guest-error'
    out.error = String((e as Error)?.stack ?? e)
  }
  window.parent.postMessage({ type: 'broker-guest-results', payload: out }, '*')
}

window.parent.postMessage({ type: 'broker-guest-alive' }, '*')
window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string }
  if (d?.type === 'broker-port') void run()
})
