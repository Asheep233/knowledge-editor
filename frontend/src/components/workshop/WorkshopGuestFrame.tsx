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

import { createGuestSessionHost, type GuestSessionHost, type GuestHostBackend } from '../../core/packs/guestHost'
import { isolationGuard } from '../../core/packs/productHostAdapter'
import type { TrustTier } from '../../core/packs/trustPolicy'

export interface WorkshopGuestFrameProps {
  packId: string
  version: string
  tier: TrustTier
  backend: GuestHostBackend
}

export function WorkshopGuestFrame({ packId, version, tier, backend }: WorkshopGuestFrameProps) {
  const hostRef = useRef<GuestSessionHost | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [status, setStatus] = useState('idle')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [safeMode, setSafeMode] = useState(false)
  const [isolationWarning, setIsolationWarning] = useState<string | null>(null)
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
        setStatus(s.state)
        if (s.state === 'failed' && hostRef.current?.isSafeMode()) setSafeMode(true)
      },
    })
    hostRef.current = host
    try {
      const result = await host.start(packId, version)
      if (result.blocked) {
        setError(result.reason ?? 'E_CAPABILITY_TIER: 禁止启用')
        setStatus('failed')
        return
      }
      setCapabilities(result.capabilities)
      setEntries({ html: result.entryHtml ?? '', assets: result.assets ?? {}, url: result.entryUrl })
      setSafeMode(host.isSafeMode())
      host.startHeartbeatMonitor()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setStatus('failed')
    }
  }, [backend, packId, tier, version])

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
      if (data.type === 'guest-heartbeat') {
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
