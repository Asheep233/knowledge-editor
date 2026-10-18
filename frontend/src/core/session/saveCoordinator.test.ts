/**
 * UI 工坊 P1-T10 回归：无 UI 的 SaveCoordinator（快照/revision/三阶段/abort/切库/迟到响应/外部冲突）。
 *
 * 证据类型 U（逻辑单测）；真实后端联调留 T10 集成 / T11 协议。
 */
import { describe, expect, it } from 'vitest'

import { MemoryTransport } from './memoryTransport'
import { MemoryRecoveryStorage, RecoveryJournal } from './recoveryJournal'
import { SaveCoordinator, hashContent } from './saveCoordinator'
import type { DocumentSnapshot, WriteResult } from './types'

const REL = 'Articles/note.md'

function snapshot(revision = 0, content = '初始正文'): DocumentSnapshot {
  return { relPath: REL, content, revision, diskHash: hashContent(content) }
}

function makeCoordinator(transport: MemoryTransport, epoch = 1, changes: any[] = []) {
  const coord = new SaveCoordinator({
    transport,
    binding: { contextId: 'ctx-A', epoch },
    onStateChange: (c) => changes.push(c),
  })
  coord.registerSnapshot(snapshot())
  return coord
}

describe('SaveCoordinator（T10）', () => {
  it('保存成功：file_durable 才 saved，revision 推进且请求带快照 revision/content', async () => {
    const transport = new MemoryTransport()
    const coord = makeCoordinator(transport)
    coord.recordEdit(REL, '修改后的正文')
    const out = await coord.save(REL, 'req-1')
    expect(out.status).toBe('saved')
    expect(coord.state(REL).status).toBe('saved')
    expect(coord.state(REL).revision).toBe(1)
    expect(transport.calls).toHaveLength(1)
    expect(transport.calls[0]).toMatchObject({
      contextId: 'ctx-A',
      epoch: 1,
      relPath: REL,
      content: '修改后的正文',
      expectedRevision: 0,
      requestId: 'req-1',
    })
  })

  it('只有 accepted/recovery_durable、没有 file_durable → 不得报告 saved', async () => {
    const transport = new MemoryTransport({
      resultFor: (req): WriteResult => ({
        requestId: req.requestId,
        contextId: req.contextId,
        relPath: req.relPath,
        status: 'completed',
        accepted: true,
        recoveryDurable: true,
        fileDurable: false,
        revision: 1,
      }),
    })
    const coord = makeCoordinator(transport)
    coord.recordEdit(REL, 'x')
    const out = await coord.save(REL, 'req-accepted')
    expect(out.status).toBe('failed')
    expect(coord.state(REL).status).toBe('failed')
  })

  it('未绑定/epoch<=0：本地 stale，不发请求（切库屏障）', async () => {
    const transport = new MemoryTransport()
    const coord = new SaveCoordinator({ transport, binding: { contextId: '', epoch: 0 } })
    coord.registerSnapshot(snapshot())
    coord.recordEdit(REL, 'x')
    const out = await coord.save(REL, 'req-stale')
    expect(out.status).toBe('stale_context')
    expect(transport.calls).toHaveLength(0)
  })

  it('revision 冲突：保留 dirty 与内容，状态 conflict_revision', async () => {
    const transport = new MemoryTransport({
      resultFor: (req): WriteResult => ({
        requestId: req.requestId,
        contextId: req.contextId,
        relPath: req.relPath,
        status: 'conflict',
        kind: 'revision',
        currentRevision: 3,
      }),
    })
    const coord = makeCoordinator(transport)
    coord.recordEdit(REL, '本地修改')
    const out = await coord.save(REL, 'req-conflict')
    expect(out.status).toBe('conflict_revision')
    expect(coord.snapshot(REL).content).toBe('本地修改')
    expect(coord.state(REL).revision).toBe(0)
  })

  it('外部改盘冲突：状态 conflict_external，不覆盖快照 revision', async () => {
    const transport = new MemoryTransport({
      resultFor: (req): WriteResult => ({
        requestId: req.requestId,
        contextId: req.contextId,
        relPath: req.relPath,
        status: 'conflict',
        kind: 'external',
        detail: '磁盘已被外部修改',
      }),
    })
    const coord = makeCoordinator(transport)
    coord.recordEdit(REL, 'x')
    const out = await coord.save(REL, 'req-ext')
    expect(out.status).toBe('conflict_external')
    expect(coord.state(REL).revision).toBe(0)
  })

  it('abort/超时后不假设失败：reconcile 查询真实结果并 saved', async () => {
    const requestId = 'req-abort'
    const transport = new MemoryTransport({
      failWrite: () => new Error('AbortError: client aborted'),
    })
    const coord = makeCoordinator(transport)
    coord.recordEdit(REL, 'abort content')
    const out = await coord.save(REL, requestId)
    expect(out.status).toBe('dirty')
    // 服务端其实已完成 → 结果查询可拿到
    transport.seedCompleted(requestId, {
      requestId,
      contextId: 'ctx-A',
      relPath: REL,
      status: 'completed',
      revision: 1,
      accepted: true,
      recoveryDurable: true,
      fileDurable: true,
    })
    const rec = await coord.reconcile(requestId)
    expect(rec.status).toBe('saved')
    expect(coord.state(REL).revision).toBe(1)
  })

  it('切库后旧 epoch 迟到响应被丢弃，不污染新上下文状态', async () => {
    const transport = new MemoryTransport({ delayMs: 20 })
    const changes: any[] = []
    const coord = makeCoordinator(transport, 1, changes)
    coord.recordEdit(REL, 'A 的修改')
    const pending = coord.save(REL, 'req-late')
    coord.switchContext({ contextId: 'ctx-B', epoch: 1 }) // 切库：旧请求绑定 ctx-A
    const out = await pending
    expect(out.result?.status).toBe('stale')
    expect(coord.state(REL).status).toBe('dirty')
    expect(coord.currentBinding().contextId).toBe('ctx-B')
    // 新上下文保存使用 ctx-B，且不沿用旧快照（业务层重新 registerSnapshot）
  })

  it('recordEdit 只标脏：注册快照后不调用 transport', () => {
    const transport = new MemoryTransport()
    const coord = makeCoordinator(transport)
    coord.recordEdit(REL, 'x')
    expect(coord.state(REL).status).toBe('dirty')
    expect(transport.calls).toHaveLength(0)
  })

  it('保存成功 → 恢复日志记录被提交（recovery_durable 生命周期）', async () => {
    const storage = new MemoryRecoveryStorage()
    const journal = new RecoveryJournal(storage)
    const transport = new MemoryTransport()
    const coord = new SaveCoordinator({ transport, binding: { contextId: 'ctx-A', epoch: 1 }, journal })
    coord.registerSnapshot(snapshot())
    coord.recordEdit(REL, 'saved content')
    const out = await coord.save(REL, 'req-journal-ok')
    expect(out.status).toBe('saved')
    expect(journal.pending()).toHaveLength(0)
    expect(storage.text).toBeNull()
  })

  it('abort 后恢复记录保留：新会话 load 可恢复未保存内容', async () => {
    const storage = new MemoryRecoveryStorage()
    const journal = new RecoveryJournal(storage)
    const transport = new MemoryTransport({ failWrite: () => new Error('AbortError') })
    const coord = new SaveCoordinator({ transport, binding: { contextId: 'ctx-A', epoch: 1 }, journal })
    coord.registerSnapshot(snapshot())
    coord.recordEdit(REL, '崩溃前未保存内容')
    const out = await coord.save(REL, 'req-journal-abort')
    expect(out.status).toBe('dirty')
    expect(journal.pending()).toHaveLength(1)
    // 模拟新会话/重启：新 journal 实例 load 后恢复该记录
    const restarted = new RecoveryJournal(storage)
    const recovered = await restarted.load()
    expect(recovered[0]).toMatchObject({ relPath: REL, content: '崩溃前未保存内容', requestId: 'req-journal-abort' })
  })

  it('abort 后重试成功 → 同文档旧恢复记录被清理（journal 不残留）', async () => {
    const storage = new MemoryRecoveryStorage()
    const journal = new RecoveryJournal(storage)
    const transport = new MemoryTransport({ failWrite: (req) => (req.requestId === 'req-first' ? new Error('AbortError') : null) })
    const coord = new SaveCoordinator({ transport, binding: { contextId: 'ctx-A', epoch: 1 }, journal })
    coord.registerSnapshot(snapshot())
    coord.recordEdit(REL, '内容')
    const first = await coord.save(REL, 'req-first')
    expect(first.status).toBe('dirty')
    expect(journal.pending(REL)).toHaveLength(1)
    const retry = await coord.save(REL, 'req-second')
    expect(retry.status).toBe('saved')
    expect(journal.pending(REL)).toHaveLength(0)
    expect(storage.text).toBeNull()
  })

  it('Core 会话层无 DOM/React 依赖（源码守卫）', async () => {
    const fs = await import('node:fs')
    const files = ['types.ts', 'saveCoordinator.ts', 'memoryTransport.ts', 'httpTransport.ts', 'recoveryJournal.ts']
    for (const f of files) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src).not.toMatch(/\bdocument\b/)
      expect(src).not.toMatch(/\bwindow\b/)
      expect(src).not.toMatch(/from ['"]react['"]/)
      expect(src).not.toMatch(/from ['"]react-dom/)
    }
  })
})
