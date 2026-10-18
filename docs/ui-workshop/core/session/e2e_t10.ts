/**
 * P1-T10 端到端联调：真实 uvicorn 后端 + T09 /api/context/* + Core SaveCoordinator/HttpTransport。
 *
 * 用途：证明「Core 会话层 ↔ 真实后端」的保存链（含 journal、revision CAS、外部改盘、切库 epoch 屏障）。
 * 运行：bash docs/ui-workshop/core/session/run_t10_e2e.sh
 * 输出：JSON 摘要（runner 写入 docs/ui-workshop/evidence/T10-e2e-results.json）
 */
import { writeFileSync } from 'node:fs'

import { HttpTransport } from '../../../../frontend/src/core/session/httpTransport'
import { MemoryRecoveryStorage, RecoveryJournal } from '../../../../frontend/src/core/session/recoveryJournal'
import { SaveCoordinator } from '../../../../frontend/src/core/session/saveCoordinator'
import type { DocumentSnapshot } from '../../../../frontend/src/core/session/types'

const BASE = process.env.T10_BASE ?? 'http://127.0.0.1:8126'
const WORKSPACE = process.env.T10_WORKSPACE ?? ''
const OUT = process.env.T10_OUT ?? ''
const REL = 'Articles/e2e-note.md'
const CTX = 'e2e-ctx'

const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
function check(name: string, pass: boolean, detail?: unknown): void {
  checks.push({ name, pass, detail })
}

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  let body: T | null = null
  try {
    body = (await resp.json()) as T
  } catch {
    body = null
  }
  return { status: resp.status, body }
}

async function readFileOrEmpty(path: string): Promise<string> {
  const fs = await import('node:fs')
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

async function snapshotFromServer(epoch: number): Promise<DocumentSnapshot> {
  const r = await api<{ rel_path: string; revision: number; disk_hash: string }>('/api/context/snapshot', {
    method: 'POST',
    body: JSON.stringify({ context_id: CTX, epoch, rel_path: REL }),
  })
  if (r.status !== 200 || !r.body) throw new Error(`snapshot 失败: ${r.status} ${JSON.stringify(r.body)}`)
  return { relPath: REL, content: '', revision: r.body.revision, diskHash: r.body.disk_hash }
}

async function main(): Promise<void> {
  const fs = await import('node:fs')
  if (!WORKSPACE) throw new Error('T10_WORKSPACE 未设置')

  const created = await api<{ detail?: string }>('/api/workspace/create', { method: 'POST', body: JSON.stringify({ path: WORKSPACE }) })
  // 启动时自愈可能已初始化工作区（409「目标目录非空」即已存在），只要后续 open 成功即可
  check('workspace/create', [200, 201, 409].includes(created.status), { status: created.status, detail: created.body?.detail })
  const openedWs = await api('/api/workspace/open', { method: 'POST', body: JSON.stringify({ path: WORKSPACE }) })
  check('workspace/open', openedWs.status === 200, openedWs.status)

  const opened = await api<{ id: string; epoch: number; current: string }>('/api/context/open', {
    method: 'POST',
    body: JSON.stringify({ id: CTX, root: WORKSPACE }),
  })
  check('context/open', opened.status === 200 && opened.body?.epoch === 1 && opened.body?.current === CTX, opened.body)
  let epoch = opened.body?.epoch ?? 1

  const storage = new MemoryRecoveryStorage()
  const journal = new RecoveryJournal(storage)
  const transport = new HttpTransport({ baseUrl: BASE })
  const coord = new SaveCoordinator({ transport, binding: { contextId: CTX, epoch }, journal })
  const snap0 = await snapshotFromServer(epoch)
  coord.registerSnapshot(snap0)
  coord.recordEdit(REL, 'E2E 第一次保存正文')
  const save1 = await coord.save(REL, 'req-e2e-1')
  check('save#1 saved', save1.status === 'saved', save1)
  check('save#1 文件落盘', (await readFileOrEmpty(`${WORKSPACE}/${REL}`)) === 'E2E 第一次保存正文')
  check('save#1 journal 已提交', journal.pending().length === 0 && storage.text === null, { pending: journal.pending().length })
  check('save#1 revision 推进 1', coord.state(REL).revision === 1, coord.state(REL))

  coord.recordEdit(REL, 'E2E 第二次保存正文')
  const save2 = await coord.save(REL, 'req-e2e-2')
  check('save#2 saved', save2.status === 'saved', save2)
  check('save#2 revision=2', coord.state(REL).revision === 2, coord.state(REL))
  check('save#2 文件更新', (await readFileOrEmpty(`${WORKSPACE}/${REL}`)) === 'E2E 第二次保存正文')
  const queried = await transport.queryResult('req-e2e-2')
  check('requestId 结果查询 completed', queried?.status === 'completed' && queried.fileDurable === true, queried)

  const staleCoord = new SaveCoordinator({ transport, binding: { contextId: CTX, epoch } })
  staleCoord.registerSnapshot({ ...snap0, content: '过期 revision 的本地内容' })
  const conflict = await staleCoord.save(REL, 'req-e2e-3')
  check('revision 冲突 → conflict_revision', conflict.status === 'conflict_revision', conflict)
  check('revision 冲突不覆盖文件', (await readFileOrEmpty(`${WORKSPACE}/${REL}`)) === 'E2E 第二次保存正文')

  // 6) 切库 epoch 屏障：服务端 epoch+1 后旧 epoch 保存 → stale（不落盘）
  const switched = await api<{ epoch: number }>('/api/context/switch', { method: 'POST', body: JSON.stringify({ id: CTX }) })
  epoch = switched.body?.epoch ?? epoch + 1
  const oldEpochCoord = new SaveCoordinator({ transport, binding: { contextId: CTX, epoch: epoch - 1 } })
  oldEpochCoord.registerSnapshot({ ...snap0, content: '旧 epoch 内容' })
  const stale = await oldEpochCoord.save(REL, 'req-e2e-5')
  check('旧 epoch 保存 → stale_context', stale.status === 'stale_context', stale)
  check('旧 epoch 保存不落盘', (await readFileOrEmpty(`${WORKSPACE}/${REL}`)) === 'E2E 第二次保存正文')

  // 7) 新 epoch 可继续保存（重新取快照）
  const newCoord = new SaveCoordinator({ transport, binding: { contextId: CTX, epoch } })
  newCoord.registerSnapshot(await snapshotFromServer(epoch))
  newCoord.recordEdit(REL, '新 epoch 保存正文')
  const saveNew = await newCoord.save(REL, 'req-e2e-6')
  check('切库后新 epoch 保存 saved', saveNew.status === 'saved', saveNew)
  check('新 epoch 文件更新', (await readFileOrEmpty(`${WORKSPACE}/${REL}`)) === '新 epoch 保存正文')

  // 8) 外部改盘冲突（最后一步，避免外部状态影响后续保存）
  const freshCoord = new SaveCoordinator({ transport, binding: { contextId: CTX, epoch } })
  freshCoord.registerSnapshot(await snapshotFromServer(epoch))
  fs.writeFileSync(`${WORKSPACE}/${REL}`, '外部程序写入的内容', 'utf8')
  freshCoord.recordEdit(REL, '本地写入应被拒')
  const external = await freshCoord.save(REL, 'req-e2e-7')
  check('外部改盘 → conflict_external', external.status === 'conflict_external', external)
  check('外部改盘内容不被覆盖', (await readFileOrEmpty(`${WORKSPACE}/${REL}`)) === '外部程序写入的内容')

  const passed = checks.filter((c) => c.pass).length
  const summary = { generatedAt: new Date().toISOString(), base: BASE, workspace: WORKSPACE, epoch, checks, passed, total: checks.length }
  const text = JSON.stringify(summary, null, 2)
  if (OUT) fs.writeFileSync(OUT, text, 'utf8')
  console.log(text)
  if (passed !== checks.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String((e as Error)?.stack ?? e) }))
  process.exit(1)
})
