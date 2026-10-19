/**
 * UI 工坊 A7：产品 guest 宿主 UI 薄封装（ADR-004）。
 *
 * - 用户点击「启用」：GuestSessionHost 启动受限会话（能力上限/真实 entry）→ sandbox iframe
 *   （allow-scripts，不透明 origin）注入 entry → postMessage JSON 线接真实 Broker/HostDispatcher；
 * - 心跳：guest postMessage 心跳 → host.heartbeat()；心跳超时由宿主自动 reportCrash；
 * - 隔离守卫：iframe 内容不可被父窗口访问（沙箱不透明 origin）；若可访问且暴露 Tauri globals → 禁用；
 * - safeMode 时显示横幅并禁止再次启用危险操作；状态落盘 `workshop-session-status.json`；
 * - T26 G3：产品 Broker 后端接真实打印管线（`ProductBrokerBackend`，见 `productBrokerBackend.ts`）；
 * - T26 G4：监听产品事件（保存/文档切换 → window 事件；主题 → data-theme 变化）并 `dispatcher.emit`
 *   为协议 `HostEvent` 广播给 guest（见 `hostEventBridge.ts`）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { Broker } from '../../core/broker/broker'
import { brokeredHandlers } from '../../core/broker/binding'
import { HostDispatcher } from '../../core/protocol/channel'
import { isolationGuard } from '../../core/packs/productHostAdapter'
import type { TrustTier } from '../../core/packs/trustPolicy'
import { createGuestSessionHost, type GuestSessionHost, type GuestHostBackend } from '../../core/packs/guestHost'
import { createHostEventBridge, observeProductTheme } from './hostEventBridge'
import { contextInfo, DEFAULT_CONTEXT_ID, ProductBrokerBackend, resolveGuestRevision } from './productBrokerBackend'
import { notifyWorkshopThemeChanged } from './workshopHostEvents'

interface GuestStartResultSession { connection: NonNullable<import('../../core/packs/packageHost').PackageSession['connection']> }

export interface WorkshopGuestFrameProps {
  packId: string
  version: string
  tier: TrustTier
  backend: GuestHostBackend
}

export function WorkshopGuestFrame({ packId, version, tier, backend }: WorkshopGuestFrameProps) {
  const hostRef = useRef<GuestSessionHost | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const sessionRef = useRef<GuestStartResultSession | null>(null)
  /** G4：guest 协议分发器引用（宿主事件发射点；随连接生命周期建立/清理） */
  const dispatcherRef = useRef<HostDispatcher | null>(null)
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
      // T26 G3/G4 实测：真实打印（Rust PrintToPdf 在主线程 message pump 中等待完成）会短暂
      // 阻塞主窗口事件循环，默认 1200ms 心跳超时会把「宿主在打印」误判为 guest 崩溃（suspended）。
      // 放宽到 8s：远大于单次打印耗时，仍能捕获真正失联的 guest。
      heartbeatTimeoutMs: 8000,
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
    // G4：保存 dispatcher 引用 —— 产品事件源（EditorArea 保存/切档、主题变化）经此发 HostEvent
    dispatcherRef.current = dispatcher
    setDispatcherReady(true)
    ;(window as unknown as { __keDispatcherReady?: boolean }).__keDispatcherReady = true

    // G4：产品 window 事件 → 协议 HostEvent（document-saved / context-changed）
    const hostEventBridge = createHostEventBridge({
      emit: (event) => dispatcher.emit(event),
      // contextId/epoch 用后端真实上下文（context/open），失败时桥内回退默认上下文
      resolveContext: async () => await contextInfo(),
      // 旧保存链事件不带 revision 时，向后端快照读取真实 revision（不伪造；含 epoch 失效重试）
      resolveRevision: async (relPath) => await resolveGuestRevision(relPath),
    })
    // G4：主题变化 —— 产品唯一状态落点为 documentElement[data-theme]（applyTheme 写入）；
    // 观察后走统一 window 事件 → HostEventBridge → dispatcher.emit（与保存/切档同一条链路）。
    const stopThemeObserver = observeProductTheme((theme) => notifyWorkshopThemeChanged({ theme }))

    return () => {
      stopThemeObserver()
      hostEventBridge.dispose()
      dispatcherRef.current = null
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
