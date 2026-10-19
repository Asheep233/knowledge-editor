// SDK 单元自测：用假 window + 内存 wire 模拟宿主协议。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

// 先确保 dist 构建
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' })

const messagesToHost = []
const hostListeners = []
const guestListeners = []
globalThis.window = {
  parent: { postMessage: (msg) => { messagesToHost.push(msg) } },
  addEventListener: (_t, cb) => guestListeners.push(cb),
  removeEventListener: () => {},
}

const { connectGuest, autoConnect, SdkError } = await import('./dist/guest-sdk.mjs')
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, pass: !!ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''))
}

// 宿主侧模拟：收到 guest-to-host wire 后回 host-to-guest wire
function hostReply(handler) {
  const wire = messagesToHost[messagesToHost.length - 1]
  assert.equal(wire.type, 't19-wire')
  const hostMsg = handler(wire.msg)
  if (hostMsg) guestListeners.forEach((cb) => cb({ data: { type: 't19-wire', direction: 'host-to-guest', msg: hostMsg } }))
}

const conn = connectGuest({ requestedFeatures: ['context.read'], timeoutMs: 500 })
const hs = conn.handshake()
hostReply((msg) => {
  assert.equal(msg.type, 'handshake')
  return { type: 'handshake.response', ok: true, protocolVersion: 1, hostVersion: 'test', acceptedFeatures: ['context.read'], contextId: 'ke-default', epoch: 1 }
})
const info = await hs
check('握手成功且返回 acceptedFeatures/context/epoch', info.ok && info.acceptedFeatures.includes('context.read') && info.epoch === 1, JSON.stringify(info))

const snap = conn.request('context.snapshot', { relPath: 'Articles/a.md' })
hostReply((msg) => ({ type: 'response', requestId: msg.requestId, ok: true, result: { relPath: 'Articles/a.md', revision: 3 } }))
check('request 成功返回结果', (await snap).revision === 3)

const failed = conn.request('context.write', {})
hostReply((msg) => ({ type: 'response', requestId: msg.requestId, ok: false, error: { code: 'E_CAPABILITY', message: '缺少能力', retryable: false } }))
await failed.then(() => check('错误响应被拒绝', false), (e) => check('错误响应被拒绝（E_CAPABILITY）', e instanceof SdkError && e.code === 'E_CAPABILITY'))

const timeoutP = conn.request('context.snapshot', {})
await timeoutP.then(() => check('超时拒绝', false), (e) => check('超时拒绝（E_TIMEOUT）', e.code === 'E_TIMEOUT'))
conn.close()
console.log(`\nSUMMARY ${checks.filter((c) => c.pass).length}/${checks.length} PASS`)
process.exit(checks.every((c) => c.pass) ? 0 : 1)
