/**
 * T19 探针 host：真实 PackageHost 装配 guest 会话（PackageHost→Broker→HostDispatcher→iframe），
 * 模拟 guest 崩溃：第一/二次 → suspended（可重启），超限 → failed + deactivate + recover + safeMode。
 * 结果经 Tauri report_results 落盘（真实 Windows/WebView2）。
 */
import { brokeredHandlers } from '../../../../../frontend/src/core/broker/binding'
import { Broker, type BrokerBackend } from '../../../../../frontend/src/core/broker/broker'
import { HostDispatcher } from '../../../../../frontend/src/core/protocol/channel'
import type { ProtocolMethods } from '../../../../../frontend/src/core/protocol/types'
import { PackageHost, type PackageHostBackend } from '../../../../../frontend/src/core/packs/packageHost'
import type { PackManifest } from '../../../../../frontend/src/core/packs/manifest'
import guestCode from './t19-guest-code.txt'

function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const g = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  if (g?.core?.invoke) return g.core.invoke(cmd, args)
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
  if (i?.invoke) return i.invoke(cmd, args)
  return Promise.reject(new Error('no tauri invoke'))
}

const MANIFEST: PackManifest = {
  id: 'com.probe.t19',
  name: 'T19 Probe Pack',
  version: '1.0.0',
  apiVersion: 1,
  capabilities: ['context.read'],
  entry: { html: 'index.html' },
  commands: [],
  assets: [{ path: 'index.html', sha256: '0'.repeat(64) }],
}

const result: Record<string, unknown> = { phase: 't19-start', ua: navigator.userAgent }
const diag = {
  iframeLoaded: false,
  messages: [] as string[],
  states: [] as string[],
  deactivateCalls: 0,
  recoverCalls: 0,
  heartbeatCount: 0,
  autoDetectedCrashes: 0,
  lastHeartbeatAt: 0,
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

class ProbeBackend implements PackageHostBackend {
  async verify() { return true }
  async readManifest(): Promise<PackManifest> { return MANIFEST }
  async deactivate() { diag.deactivateCalls += 1 }
  async recover() { diag.recoverCalls += 1; return { recovered: true, action: 'clean' } }
}

class BrokerBackend implements BrokerBackend {
  currentEpoch() { return 1 }
  async snapshot(params: ProtocolMethods['context.snapshot']['params']) { return { relPath: params.relPath, revision: 1, diskHash: 't19-hash' } }
  async write(params: ProtocolMethods['context.write']['params']) { return { requestId: params.requestId ?? 'auto', status: 'completed' as const, revision: 1, fileDurable: true } }
  async print(params: ProtocolMethods['print.snapshot']['params']) { return { pdfToken: params.relPath, pages: 1 } }
  async invokeCommand(params: ProtocolMethods['command.invoke']['params']) { return { ok: true, value: params.name } }
}

async function main(): Promise<void> {
  const host = new PackageHost({
    backend: new ProbeBackend(),
    binding: () => ({ contextId: 'ctx-t19', epoch: 1 }),
    maxCrashes: 2,
    onSessionChange: (s) => diag.states.push(s.state),
  })
  const session = await host.start('com.probe.t19', '1.0.0')
  result.sessionStarted = session.state === 'active'
  result.connection = session.connection ?? null

  // T19 升级：优先从**已安装包**读取 entry HTML（真实资源加载）；失败回退内联 guest（探针健壮性）
  let entryHtml: string | null = null
  try {
    const boot = (await tauriInvoke('boot_state')) as { pack_root?: string }
    if (boot.pack_root) {
      const readAsset = async (path: string) =>
        (await tauriInvoke('pack_read_asset', {
          root: boot.pack_root, id: 'com.probe.t19entry', version: '1.0.0', path,
        })) as string
      const html = await readAsset('index.html')
      if (typeof html === 'string' && html.length > 0) {
        entryHtml = html
        result.guestSource = 'pack-entry'
        result.entryBytes = html.length
        result.packId = 'com.probe.t19entry'
        // T19 升级 2：多资源从已安装包加载（css/js，安装期已哈希校验）
        const assetsLoaded: string[] = ['index.html']
        try {
          const css = await readAsset('style.css')
          if (typeof css === 'string' && css.length > 0) {
            entryHtml = entryHtml.replace('{{STYLE}}', `<style>${css}</style>`)
            assetsLoaded.push('style.css')
          }
        } catch { /* 单资源包 */ }
        try {
          const sdk = await readAsset('sdk.js')
          if (typeof sdk === 'string' && sdk.length > 0) {
            entryHtml = entryHtml.replace('{{SCRIPT}}', `<script>${sdk}<\/script>`)
            assetsLoaded.push('sdk.js')
          }
        } catch { /* 单资源包 */ }
        result.assetsLoaded = assetsLoaded
      }
    }
  } catch (e) {
    result.entryError = String((e as Error)?.message ?? e)
  }
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.id = 't19-guest'
  iframe.style.cssText = 'width:320px;height:80px;border:1px solid #999'
  document.body.appendChild(iframe)
  iframe.srcdoc =
    entryHtml ??
    `<!doctype html><html><body><div>t19 guest</div><script>${guestCode}<\/script></body></html>`
  if (!entryHtml) result.guestSource = 'inline-fallback' 
  const wire = {
    postMessage: (msg: unknown) => iframe.contentWindow?.postMessage({ type: 't19-wire', direction: 'host-to-guest', msg }, '*'),
    onMessage: (cb: (msg: unknown) => void) => {
      const h = (e: MessageEvent) => {
        const d = e.data as { type?: string; direction?: string; msg?: unknown }
        if (d?.type === 't19-wire' && d.direction === 'guest-to-host') cb(d.msg)
      }
      window.addEventListener('message', h)
      return () => window.removeEventListener('message', h)
    },
  }
  const broker = new Broker(new BrokerBackend(), { maxPayloadBytes: 1024 * 1024 })
  const dispatcher = new HostDispatcher(wire, brokeredHandlers(broker, session.connection!), {
    features: session.connection!.capabilities,
    hostVersion: 't19-probe-host',
    context: () => ({ contextId: 'ctx-t19', epoch: 1 }),
  })
  dispatcher.start()
  result.brokerStarted = true

  // T19 升级 2：心跳监控 —— guest 崩溃（iframe 移除/卡死）→ 心跳中断 → 自动 reportCrash
  let hbMonitorReported = false
  const hbMonitor = setInterval(() => {
    if (hbMonitorReported || diag.heartbeatCount < 2) return
    if (Date.now() - diag.lastHeartbeatAt > 1200) {
      hbMonitorReported = true
      diag.autoDetectedCrashes += 1
      void host.reportCrash('com.probe.t19', 'heartbeat timeout (renderer crash detected)').then((r) => {
        result.autoCrashState = r?.state
      })
    }
  }, 150)

  const guestResult = await new Promise<Record<string, unknown>>((resolve) => {
    const timer = setTimeout(() => resolve({ phase: 'guest-timeout' }), 10000)
    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: Record<string, unknown> }
      if (typeof d?.type === 'string') diag.messages.push(d.type)
      if (d?.type === 't19-guest-alive') {
        diag.iframeLoaded = true
        iframe.contentWindow?.postMessage({ type: 't19-port' }, '*')
      }
      if (d?.type === 't19-heartbeat') {
        diag.heartbeatCount += 1
        diag.lastHeartbeatAt = Date.now()
      }
      if (d?.type === 't19-guest-results') {
        clearTimeout(timer)
        resolve(d.payload ?? {})
      }
    })
  })
  result.guest = guestResult

  // 等心跳稳定后：移除 iframe 模拟真实 renderer 崩溃 → 心跳中断 → 宿主自动检测并 reportCrash
  await sleep(600)
  result.heartbeatCount = diag.heartbeatCount
  let autoCrashState: string | undefined
  if (diag.heartbeatCount > 0) {
    iframe.remove()
    result.iframeRemovedForCrash = true
    const deadline = Date.now() + 4000
    while (autoCrashState === undefined && Date.now() < deadline) {
      await sleep(120)
      if (diag.autoDetectedCrashes > 0 && diag.states.includes('suspended')) {
        autoCrashState = 'suspended'
      }
    }
    result.autoCrashState = autoCrashState
    result.autoDetectedCrashes = diag.autoDetectedCrashes
  }
  // 崩溃 2（显式）→ suspended；崩溃 3 → 超限 failed + deactivate + recover + safeMode
  const crash2 = await host.reportCrash('com.probe.t19', 'guest crash 2')
  result.crashStates = [autoCrashState, crash2?.state]
  const crash3 = await host.reportCrash('com.probe.t19', 'guest crash 3 (over limit)')
  result.overLimitState = crash3?.state
  clearInterval(hbMonitor)
  result.safeMode = host.isSafeMode()
  result.diag = diag
  result.phase = 't19-done'

  const json = JSON.stringify(result)
  document.body.insertAdjacentHTML('beforeend', `<pre style="font:10px monospace;white-space:pre-wrap">${json}</pre>`)
  try {
    await tauriInvoke('report_results', { results: json })
    await tauriInvoke('debug_log', { marker: 't19-probe-reported' })
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', `<div>REPORT FAILED: ${String(e)}</div>`)
  }
}

void main()
