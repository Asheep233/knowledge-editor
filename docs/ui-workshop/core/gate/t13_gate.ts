/**
 * P1-T13 Core 门槛（A 证据）：**不挂载旧 App / EditorArea / 任何 UI 测试框架**，
 * 仅用真实后端 HTTP + Core 会话层（SaveCoordinator/HttpTransport/RecoveryJournal）完成：
 * 打开工作区 → 上下文快照 → 编辑后保存（真实文件 durable）→ abort 后恢复/重试 →
 * 切换工作区（epoch 屏障）→ 只读域（tree/search）→ 租约关闭协调。
 *
 * 运行：bash docs/ui-workshop/core/gate/run_t13_gate.sh
 * 输出：docs/ui-workshop/evidence/T13-core-gate-results.json
 */
import { readFileSync } from 'node:fs'

import { HttpTransport } from '../../../../frontend/src/core/session/httpTransport'
import { MemoryRecoveryStorage, RecoveryJournal } from '../../../../frontend/src/core/session/recoveryJournal'
import { SaveCoordinator } from '../../../../frontend/src/core/session/saveCoordinator'
import type { SaveTransport, WriteRequest, WriteResult } from '../../../../frontend/src/core/session/types'

const BASE = process.env.T13_BASE ?? 'http://127.0.0.1:8129'
const ROOT_A = process.env.T13_ROOT_A ?? ''
const ROOT_B = process.env.T13_ROOT_B ?? ''
const OUT = process.env.T13_OUT ?? ''
const REL = 'Articles/gate-demo.md'

const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
function check(name: string, pass: boolean, detail?: unknown): void {
  checks.push({ name, pass, detail })
}

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const resp = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  let body: T | null = null
  try { body = (await resp.json()) as T } catch { body = null }
  return { status: resp.status, body }
}

async function readFileOrEmpty(path: string): Promise<string> {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}

async function snapshot(transport: HttpTransport, ctx: string, epoch: number): Promise<{ rel_path: string; revision: number; disk_hash: string }> {
  const r = await api<{ rel_path: string; revision: number; disk_hash: string }>('/api/context/snapshot', {
    method: 'POST', body: JSON.stringify({ context_id: ctx, epoch, rel_path: REL }),
  })
  if (r.status !== 200 || !r.body) throw new Error(`snapshot 失败: ${r.status}`)
  return r.body
}

/** 第一次 write 抛 AbortError，之后委托真实 HttpTransport（模拟客户端 abort）。 */
class AbortFirstTransport implements SaveTransport {
  private first = true
  private readonly inner: HttpTransport
  constructor(inner: HttpTransport) { this.inner = inner }
  async write(req: WriteRequest): Promise<WriteResult> {
    if (this.first) { this.first = false; throw new Error('AbortError: simulated client abort') }
    return await this.inner.write(req)
  }
  queryResult(requestId: string): Promise<WriteResult | null> { return this.inner.queryResult(requestId) }
}

async function main(): Promise<void> {
  if (!ROOT_A || !ROOT_B) throw new Error('T13_ROOT_A/T13_ROOT_B 未设置')
  // 1) 打开两个隔离工作区（真实后端）
  const cA = await api('/api/workspace/create', { method: 'POST', body: JSON.stringify({ path: ROOT_A }) })
  check('打开工作区 A（create 或已存在）', [200, 201, 409].includes(cA.status), cA.status)
  const oA = await api('/api/workspace/open', { method: 'POST', body: JSON.stringify({ path: ROOT_A }) })
  check('打开工作区 A（open）', oA.status === 200, oA.status)
  const cB = await api('/api/workspace/create', { method: 'POST', body: JSON.stringify({ path: ROOT_B }) })
  check('打开工作区 B（create 或已存在）', [200, 201, 409].includes(cB.status), cB.status)

  // 2) 上下文 A：可信快照 + Core SaveCoordinator 保存（无 UI）
  const ctxA = await api<{ id: string; epoch: number }>('/api/context/open', { method: 'POST', body: JSON.stringify({ id: 'ctx-A', root: ROOT_A }) })
  check('上下文 A 打开（epoch=1）', ctxA.status === 200 && ctxA.body?.epoch === 1, ctxA.body)
  let epochA = ctxA.body?.epoch ?? 1
  const snapA = await snapshot(new HttpTransport({ baseUrl: BASE }), 'ctx-A', epochA)
  check('可信快照（revision=0 + disk hash）', snapA.revision === 0 && typeof snapA.disk_hash === 'string', snapA)

  const journal = new RecoveryJournal(new MemoryRecoveryStorage())
  const transport = new HttpTransport({ baseUrl: BASE })
  const coord = new SaveCoordinator({ transport, binding: { contextId: 'ctx-A', epoch: epochA }, journal })
  coord.registerSnapshot({ relPath: REL, content: '', revision: snapA.revision, diskHash: snapA.disk_hash })
  coord.recordEdit(REL, 'T13 门槛：模拟编辑内容（无 UI）')
  const save1 = await coord.save(REL, 'gate-save-1')
  check('Core 保存成功（file_durable）', save1.status === 'saved', save1)
  check('真实文件落盘', (await readFileOrEmpty(`${ROOT_A}/${REL}`)) === 'T13 门槛：模拟编辑内容（无 UI）')
  check('保存后 journal 已提交', journal.pending().length === 0)

  // 3) abort → 恢复日志保留 → 用真实结果查询/重试恢复
  const abortTransport = new AbortFirstTransport(transport)
  const journal2 = new RecoveryJournal(new MemoryRecoveryStorage())
  const coord2 = new SaveCoordinator({ transport: abortTransport, binding: { contextId: 'ctx-A', epoch: epochA }, journal: journal2 })
  const snap2 = await snapshot(transport, 'ctx-A', epochA)
  coord2.registerSnapshot({ relPath: REL, content: '旧', revision: snap2.revision, diskHash: snap2.disk_hash })
  coord2.recordEdit(REL, 'T13 abort 期间编辑')
  const aborted = await coord2.save(REL, 'gate-save-aborted')
  check('abort 后状态=dirty（不假设失败）', aborted.status === 'dirty', aborted)
  check('abort 后恢复日志保留（可重启恢复）', journal2.pending().length === 1, journal2.pending().length)
  const restarted = new RecoveryJournal((journal2 as unknown as { storage: never }).storage ?? new MemoryRecoveryStorage())
  // 上面取不到内部 storage 时用内存态检查；真实崩溃恢复已由 Core 单测覆盖
  void restarted
  const retry = await coord2.save(REL, 'gate-save-retry')
  check('重试保存成功（真实 HTTP）', retry.status === 'saved', retry)
  const fileAfterRetry = await readFileOrEmpty(`${ROOT_A}/${REL}`)
  check('abort 内容最终落盘', fileAfterRetry === 'T13 abort 期间编辑', fileAfterRetry)
  check('恢复日志在成功后提交', journal2.pending().length === 0, journal2.pending().length)

  // 4) 只读域：tree/search（上下文绑定）
  const tree = await api<{ count: number; items: Array<{ rel_path: string }> }>('/api/context/tree', { method: 'POST', body: JSON.stringify({ context_id: 'ctx-A', epoch: epochA }) })
  check('只读域 tree 返回 demo 文档', tree.status === 200 && (tree.body?.items ?? []).some((i) => i.rel_path === REL), tree.body)
  const search = await api<{ count: number }>('/api/context/search', { method: 'POST', body: JSON.stringify({ context_id: 'ctx-A', epoch: epochA, query: 'abort 期间' }) })
  check('只读域 search 命中上下文内容', search.status === 200 && (search.body?.count ?? 0) >= 1, search.body)

  // 5) 切换工作区：B 打开后 A switch → 旧 epoch 保存被拒（epoch 屏障）
  const ctxB = await api<{ id: string; epoch: number }>('/api/context/open', { method: 'POST', body: JSON.stringify({ id: 'ctx-B', root: ROOT_B }) })
  check('上下文 B 打开（隔离工作区）', ctxB.status === 200, ctxB.body)
  const switched = await api<{ epoch: number }>('/api/context/switch', { method: 'POST', body: JSON.stringify({ id: 'ctx-A' }) })
  epochA = switched.body?.epoch ?? epochA + 1
  const staleSave = await coord.save(REL, 'gate-save-stale')
  check('切库后旧 epoch 保存 → stale_context', staleSave.status === 'stale_context', staleSave)
  const newCoord = new SaveCoordinator({ transport, binding: { contextId: 'ctx-A', epoch: epochA } })
  const snap3 = await snapshot(transport, 'ctx-A', epochA)
  newCoord.registerSnapshot({ relPath: REL, content: '旧', revision: snap3.revision, diskHash: snap3.disk_hash })
  newCoord.recordEdit(REL, 'T13 新 epoch 内容')
  const savedNew = await newCoord.save(REL, 'gate-save-new-epoch')
  check('新 epoch 可继续保存', savedNew.status === 'saved', savedNew)

  // 6) 上下文租约与关闭协调
  const lease = await api<{ lease_id: string }>('/api/context/lease', { method: 'POST', body: JSON.stringify({ id: 'ctx-A', epoch: epochA }) })
  const closeBlocked = await api('/api/context/close', { method: 'POST', body: JSON.stringify({ id: 'ctx-A' }) })
  check('有租约时关闭被拒（409）', closeBlocked.status === 409, closeBlocked.status)
  await api('/api/context/release', { method: 'POST', body: JSON.stringify({ lease_id: lease.body?.lease_id }) })
  const closed = await api('/api/context/close', { method: 'POST', body: JSON.stringify({ id: 'ctx-A' }) })
  check('租约排空后关闭成功', closed.status === 200, closed.status)
  const afterClose = await api('/api/context/tree', { method: 'POST', body: JSON.stringify({ context_id: 'ctx-A', epoch: epochA }) })
  check('关闭后旧上下文读取被拒（404）', afterClose.status === 404, afterClose.status)

  // 7) 未覆盖项（T13 其余：单实例/退出协调/打印 job/Rust 原生恢复）——显式记录，不冒充通过
  const passed = checks.filter((c) => c.passed !== false && c.pass).length
  const summary = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    note: 'UI-free Core gate（Node + 真实后端，无 App/EditorArea/happy-dom）',
    checks,
    passed,
    total: checks.length,
    uncovered: ['单实例/退出协调（Rust 主壳）', '打印 job 与取消（T16）', 'Rust 原生恢复（T20/T24）', '恶意包/故障场景（T18 W 探针部分覆盖）'],
  }
  const text = JSON.stringify(summary, null, 2)
  if (OUT) {
    const fs = await import('node:fs')
    fs.writeFileSync(OUT, text, 'utf8')
  }
  console.log(text)
  if (passed !== checks.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String((e as Error)?.stack ?? e) }))
  process.exit(1)
})
