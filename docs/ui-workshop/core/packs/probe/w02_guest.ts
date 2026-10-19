/**
 * W02 表单交接探针 guest（停用后迟到命令 / 旧连接失效 W 证据）：
 *
 * 1) 握手后经 Broker `command.invoke` 提交 title、tags（宿主原子写 meta），再尝试未知命令（应被拒绝）；
 * 2) 上述动作完成后先 post 中间回报 `{phase:'w02-guest-pre'}`——其中附带**本 guest 原计划在停用 3s 后
 *    发出的迟到命令原始 wire 请求**（requestId/method/params 已冻结），供宿主探针在停用后重放；
 * 3) 等 3s 再尝试迟到命令 `article.set-title`（标题「W02 迟到标题」）：
 *    - 产品行为：点「停用 guest」会卸载 guest iframe（guest realm 被销毁），本段代码通常不会被执行；
 *    - 若 iframe 仍存活（停用未生效/实现缺陷），则真实发出并记录 lateError/lateResult → 交证据对照；
 * 4) 最后 post `{phase:'w02-guest-done', lateError/lateResult}`（同上，通常不会到达宿主）。
 *
 * 注意：本 guest 在停用后无法存活，因此「迟到命令被丢弃」的宿主观测由探针重放 pre.lateWireMsg 完成；
 * 证据中必须写明这是“旧连接失效”的重放验证，不是 guest 停用后仍自己发请求。
 */
import { GuestClient } from '../../../../../frontend/src/core/protocol/channel'

interface WirePort {
  postMessage(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
}

const LATE_TITLE = 'W02 迟到标题'
const LATE_CMD = 'article.set-title'

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

function postResults(payload: Record<string, unknown>): void {
  window.parent.postMessage({ type: 't19-guest-results', payload }, '*')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

window.parent.postMessage({ type: 't19-guest-alive', ua: navigator.userAgent }, '*')
window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string }
  if (d?.type !== 't19-port') return
  void (async () => {
    // 前端心跳：停用前保持会话 alive（心跳只用于宿主监控，不参与命令语义）
    setInterval(() => window.parent.postMessage({ type: 't19-heartbeat' }, '*'), 200)
    const out: Record<string, unknown> = { phase: 'w02-guest-start', sdk: 'w02-guest-2' }
    // 迟到命令原始 wire 请求（与 GuestClient.request 产生的 RequestMessage 同构），先冻结再回报
    const lateRequestId = `w02-late-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const lateWireMsg = {
      type: 'request',
      requestId: lateRequestId,
      method: 'command.invoke',
      params: { name: LATE_CMD, args: { relPath: 'Articles/a.md', title: LATE_TITLE } },
    }
    try {
      const client = new GuestClient(portFromParent(), {
        sdkVersion: 'w02-guest-2',
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
      // 中间回报：宿主收到后点「停用 guest」；pre 里带迟到命令原始 wire 请求供宿主侧重放
      out.lateRequest = {
        requestId: lateRequestId,
        method: 'command.invoke',
        name: LATE_CMD,
        title: LATE_TITLE,
        scheduledDelayMs: 3000,
      }
      out.lateWireMsg = lateWireMsg
      out.preAt = Date.now()
      out.phase = 'w02-guest-pre'
      postResults(out)

      // 停用窗口：等 3s 再尝试迟到命令（停用后 iframe 被卸载，本段通常不会执行）
      await sleep(3000)
      out.lateAttemptAt = Date.now()
      try {
        out.lateResult = await client.request('command.invoke', { name: LATE_CMD, args: { relPath: 'Articles/a.md', title: LATE_TITLE } }, { timeoutMs: 2500 })
      } catch (e) {
        out.lateError = String((e as Error)?.message ?? e)
      }
      out.phase = 'w02-guest-done'
    } catch (e) {
      out.phase = 'w02-guest-error'
      out.error = String((e as Error)?.stack ?? e)
    }
    postResults(out)
  })()
})
