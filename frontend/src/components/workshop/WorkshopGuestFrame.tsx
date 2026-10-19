/**
 * UI 工坊 A7：产品 guest 宿主 UI 薄封装（ADR-004）。
 *
 * - 用户点击「启用」：GuestSessionHost 启动受限会话（能力上限/真实 entry）→ sandbox iframe
 *   （allow-scripts，不透明 origin）注入 entry → postMessage JSON 线接真实 Broker/HostDispatcher；
 * - 心跳：guest postMessage 心跳 → host.heartbeat()；心跳超时由宿主自动 reportCrash；
 * - 隔离守卫：iframe 内容不可被父窗口访问（沙箱不透明 origin）；若可访问且暴露 Tauri globals → 禁用；
 * - safeMode 时显示横幅并禁止再次启用危险操作；状态落盘 `workshop-session-status.json`。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { Broker, connectionHasCapability, type BrokerBackend, type BrokerConnection } from '../../core/broker/broker'
import { brokeredHandlers } from '../../core/broker/binding'
import { HostDispatcher } from '../../core/protocol/channel'
import type { ProtocolMethods } from '../../core/protocol/types'
import { CoreSaveBridge } from '../../core/session/coreSaveBridge'
import { createGuestSessionHost, type GuestSessionHost, type GuestHostBackend } from '../../core/packs/guestHost'
import {
  createArticleMetaCommandHandler,
  fetchContextSnapshotWithContent,
  isolationGuard,
  writeContextDocument,
} from '../../core/packs/productHostAdapter'
import type { TrustTier } from '../../core/packs/trustPolicy'

interface GuestStartResultSession { connection: NonNullable<import('../../core/packs/packageHost').PackageSession['connection']> }

export interface WorkshopGuestFrameProps {
  packId: string
  version: string
  tier: TrustTier
  backend: GuestHostBackend
}

const DEFAULT_CONTEXT_ID = 'ke-default'
let sharedBridge: CoreSaveBridge | null = null
function bridge(): CoreSaveBridge {
  if (!sharedBridge) {
    const base = (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__ ?? ''
    sharedBridge = new CoreSaveBridge({ baseUrl: base, contextId: DEFAULT_CONTEXT_ID })
  }
  return sharedBridge
}

async function contextInfo(): Promise<{ contextId: string; epoch: number }> {
  return await bridge().ensureContext()
}

/** W05：产品 guest Broker 后端（真实后端 HTTP；G1 内容读 / G2 真实写；打印仍为 G3 遗留桩）。 */
class ProductBrokerBackend implements BrokerBackend {
  currentEpoch() {
    return 1
  }
  async snapshot(params: ProtocolMethods['context.snapshot']['params'], conn: BrokerConnection) {
    const ctx = await contextInfo()
    // G1：仅具备 context.read 的连接返回正文（Broker 已按能力拒绝无权限请求；此处第二道防线）。
    // 正文复用既有只读文档 API；读不到时退化为旧形状 {relPath,revision,diskHash}。
    return await fetchContextSnapshotWithContent(
      ctx,
      params.relPath,
      connectionHasCapability(conn, 'context.read'),
      { baseUrl: (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__ ?? '' },
    )
  }
  async write(params: ProtocolMethods['context.write']['params'], _conn: BrokerConnection) {
    // G2：真实 /api/context/write；completed/conflict/stale/failed 如实返回，不伪造 revision/fileDurable。
    const ctx = await contextInfo()
    return await writeContextDocument(ctx, params, {
      baseUrl: (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__ ?? '',
    })
  }
  async print(params: ProtocolMethods['print.snapshot']['params']) {
    // G3（打印真实管线）仍是遗留缺口：保持既有桩行为，不在本任务范围内冒充真实 PDF。
    return { pdfToken: params.relPath, pages: 1 }
  }
  private readonly commandHandler = createArticleMetaCommandHandler({
    baseUrl: (globalThis as { __KE_API_BASE__?: string }).__KE_API_BASE__ ?? '',
  })
  async invokeCommand(params: ProtocolMethods['command.invoke']['params']) {
    // W02：白名单命令（article.setTitle/setTags）→ 宿主原子写后端 meta；其余命令拒绝
    return await this.commandHandler.invoke(params.name, params.args)
  }
}

export function WorkshopGuestFrame({ packId, version, tier, backend }: WorkshopGuestFrameProps) {
  const hostRef = useRef<GuestSessionHost | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const sessionRef = useRef<GuestStartResultSession | null>(null)
  const [status, setStatus] = useState('idle')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [safeMode, setSafeMode] = useState(false)
  const [isolationWarning, setIsolationWarning] = useState<string | null>(null)
  const [dispatcherReady, setDispatcherReady] = useState(false)
  const [entries, setEntries] = useState<{ html: string; assets: Record<string, string>; url?: string } | null>(null)

  const stop = useCallback(async () => {
    if (hostRef.current) {
      await hostRef.current.stop()
      setSafeMode(hostRef.current.isSafeMode())
    }
    hostRef.current = null
    setEntries(null)
    setCapabilities([])
    setStatus('stopped')
  }, [])

  useEffect(() => () => { void stop() }, [stop])

  const enable = useCallback(async () => {
    setError(null)
    setStatus('starting')
    const host = createGuestSessionHost({
      backend,
      tier,
      onStatus: (s) => {
        const w = window as unknown as { __keGuestStatusLog?: string[] }
        w.__keGuestStatusLog = [...(w.__keGuestStatusLog ?? []), s.state]
        setStatus(s.state)
        if (s.state === 'failed' && hostRef.current?.isSafeMode()) setSafeMode(true)
      },
    })
    hostRef.current = host
    try {
      const result = await host.start(packId, version)
      ;(window as unknown as { __keGuestStart?: unknown }).__keGuestStart = {
        blocked: result.blocked, reason: result.reason, capabilities: result.capabilities,
        hasEntry: !!result.entryHtml, hasSession: !!result.session,
      }
      if (result.blocked) {
        setError(result.reason ?? 'E_CAPABILITY_TIER: 禁止启用')
        ;(window as unknown as { __keGuestError?: unknown }).__keGuestError = result.reason
        setStatus('failed')
        return
      }
      setCapabilities(result.capabilities)
      sessionRef.current = result.session?.connection ? { connection: result.session.connection } : null
      setEntries({ html: result.entryHtml ?? '', assets: result.assets ?? {}, url: result.entryUrl })
      setSafeMode(host.isSafeMode())
      host.startHeartbeatMonitor()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      ;(window as unknown as { __keGuestError?: unknown }).__keGuestError = String((e as Error)?.message ?? e)
      setStatus('failed')
    }
  }, [backend, packId, tier, version])

  // W05：Broker/HostDispatcher 接入 guest（t19-wire JSON 线；产品 host 侧真实执行能力过滤）
  useEffect(() => {
    const iframe = iframeRef.current
    const connection = sessionRef.current?.connection
    if (!iframe || !entries || !connection) return
    const wire = {
      postMessage: (msg: unknown) => {
        iframe.contentWindow?.postMessage({ type: 't19-wire', direction: 'host-to-guest', msg }, '*')
      },
      onMessage: (cb: (msg: unknown) => void) => {
        const handler = (e: MessageEvent) => {
          const d = e.data as { type?: string; direction?: string; msg?: unknown }
          if (d?.type === 't19-guest-alive') {
            // 兼容 T19/SDK guest 启动握手：宿主回 port 通知后 guest 才开始协议握手
            iframe.contentWindow?.postMessage({ type: 't19-port' }, '*')
          }
          if (d?.type === 't19-wire' && d.direction === 'guest-to-host') cb(d.msg)
          if (d?.type === 't19-guest-results') {
            ;(window as unknown as { __keGuestResults?: unknown }).__keGuestResults = (d as { payload?: unknown }).payload
          }
        }
        window.addEventListener('message', handler)
        return () => window.removeEventListener('message', handler)
      },
    }
    const broker = new Broker(new ProductBrokerBackend(), { maxPayloadBytes: 1024 * 1024 })
    const dispatcher = new HostDispatcher(wire, brokeredHandlers(broker, connection), {
      features: connection.capabilities,
      hostVersion: 'product-guest-host',
      context: () => ({ contextId: DEFAULT_CONTEXT_ID, epoch: 1 }),
    })
    dispatcher.start()
    setDispatcherReady(true)
    ;(window as unknown as { __keDispatcherReady?: boolean }).__keDispatcherReady = true
    return () => {
      dispatcher.close()
      setDispatcherReady(false)
    }
  }, [entries])

  // iframe 挂载后：隔离守卫 + postMessage 心跳/消息线（JSON wire，T11 结论）
  useEffect(() => {
    const iframe = iframeRef.current
    const host = hostRef.current
    if (!iframe || !host || !entries) return
    let ownInternals = false
    let parentInternals = false
    try {
      const doc = iframe.contentWindow?.document // 沙箱跨域应抛异常
      if (doc) ownInternals = typeof (iframe.contentWindow as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === 'object'
    } catch {
      ownInternals = false
    }
    const guard = isolationGuard({ ownInternals, parentInternals })
    if (!guard.ok) {
      setError(guard.reason ?? 'E_ISOLATION')
      void stop()
      return
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | undefined
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'guest-internals') {
        const hasInternals = (data as { hasInternals?: boolean }).hasInternals === true
        const w = window as unknown as { __keGuestInternals?: boolean }
        w.__keGuestInternals = hasInternals
        if (hasInternals) setIsolationWarning('E_ISOLATION_RESIDUAL: guest 可见 __TAURI_INTERNALS__（remote IPC 已拒绝，残余风险见 ADR-004）')
        return
      }
      if (data.type === 'guest-heartbeat' || data.type === 't19-heartbeat') {
        const w = window as unknown as { __keGuestHeartbeats?: number }
        w.__keGuestHeartbeats = (w.__keGuestHeartbeats ?? 0) + 1
        host.heartbeat()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [entries, stop])

  return (
    <div className="mt-2 rounded border border-slate-200 p-2 text-xs" data-testid="workshop-guest">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5">guest：{status}</span>
        {dispatcherReady && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">协议线已连接</span>}
        {capabilities.length > 0 && (
          <span className="text-slate-500">能力：{capabilities.join(', ')}</span>
        )}
        {safeMode && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">safeMode：guest 已禁用</span>}
        <button type="button" className="rounded border px-2 py-1" disabled={safeMode || status === 'active' || status === 'starting'} onClick={() => void enable()}>
          启用 guest
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={status === 'idle' || status === 'stopped'}
          onClick={() => void stop()}
        >
          停用 guest
        </button>
      </div>
      {isolationWarning && <div className="mt-1 text-amber-700" data-testid="guest-isolation-warning">{isolationWarning}</div>}
      {error && <div className="mt-1 text-red-600">{error}</div>}
      {entries && (
        <iframe
          ref={iframeRef}
          title={`workshop-guest-${packId}`}
          sandbox="allow-scripts"
          className="mt-2 h-40 w-full rounded border border-slate-200"
          {...(entries.url ? { src: entries.url } : { srcDoc: entries.html })}
        />
      )}
    </div>
  )
}
