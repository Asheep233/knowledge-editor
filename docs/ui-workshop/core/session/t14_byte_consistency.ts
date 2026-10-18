/**
 * P2-T14 验收：**字节一致性** —— 同一「编辑器写出的最终 markdown」分别经
 * 旧链 HTTP 保存（PUT /api/articles/{id}）与 Core 上下文保存（/api/context/write）
 * 落盘后，比较磁盘文件字节是否完全一致（含 LF / CRLF+BOM 场景）。
 *
 * 说明：产品前端两条路径使用同一个 `written` 字符串（traits 已还原），本 e2e 验证
 * 后端落盘语义在两条保存通道间等价（frontmatter 合并、编码、换行不被改写）。
 */
import { readFileSync } from 'node:fs'
import { writeFileSync } from 'node:fs'

import { CoreSaveBridge } from '../../../../frontend/src/core/session/coreSaveBridge'

const BASE = process.env.T14B_BASE ?? 'http://127.0.0.1:8130'
const OUT = process.env.T14B_OUT ?? ''
const WS = process.env.T14B_WORKSPACE ?? ''

const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => checks.push({ name, pass, detail })

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const resp = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  let body: any = null
  try { body = await resp.json() } catch { body = null }
  return { status: resp.status, body }
}

function readBytes(relPath: string): Buffer {
  return readFileSync(`${WS}/${relPath}`)
}

async function main(): Promise<void> {
  if (!WS) throw new Error('T14B_WORKSPACE 未设置')
  await api('/api/workspace/create', { method: 'POST', body: JSON.stringify({ path: WS }) })
  await api('/api/workspace/open', { method: 'POST', body: JSON.stringify({ path: WS }) })

  const fixtures: Array<{ name: string; rel: string; initial: string; final: string }> = [
    {
      name: 'LF 普通文档',
      rel: 'Articles/byte-lf.md',
      initial: '---\ntitle: byte-lf\n---\n\n初始内容\n',
      final: '---\ntitle: byte-lf\n---\n\n第二版正文\nline2\nline3\n',
    },
    {
      name: 'CRLF + BOM 文档（traits 场景）',
      rel: 'Articles/byte-crlf.md',
      initial: '\ufeff---\r\ntitle: byte-crlf\r\n---\r\n\r\n初始 CRLF\r\n',
      final: '\ufeff---\r\ntitle: byte-crlf\r\n---\r\n\r\n第二版 CRLF 内容\r\nline2\r\n',
    },
  ]

  for (const fx of fixtures) {
    // 1) 旧链：创建（POST）+ 保存（PUT，frontmatter 合并语义）
    const created = await api('/api/articles', { method: 'POST', body: JSON.stringify({ title: fx.rel.split('/').pop()!.replace(/\.md$/, ''), content: fx.initial }) })
    check(`${fx.name}：旧链创建 (201)`, created.status === 201, created.status)
    const createdPath = created.body?.path ?? ''
    if (createdPath && createdPath !== fx.rel) {
      // 标题 sanitize 可能改路径；用返回值对齐
      fx.rel = createdPath
    }
    const legacySave = await api(`/api/articles/${encodeURIComponent(fx.rel)}`, { method: 'PUT', body: JSON.stringify({ content: fx.final }) })
    check(`${fx.name}：旧链保存 (200)`, legacySave.status === 200, legacySave.status)
    const legacyBytes = readBytes(fx.rel)

    // 2) Core 上下文保存同一 final 内容
    const bridge = new CoreSaveBridge({ baseUrl: BASE })
    const ctx = await bridge.ensureContext()
    check(`${fx.name}：Core 打开上下文`, ctx.contextId === 'ke-default' && ctx.epoch >= 1, ctx)
    const coreResult = await bridge.saveDocument(fx.rel, fx.final)
    check(`${fx.name}：Core 保存 saved`, coreResult.status === 'saved', coreResult)
    const coreBytes = readBytes(fx.rel)

    // 3) 字节一致性
    const equal = legacyBytes.equals(coreBytes)
    check(`${fx.name}：**旧链与 Core 落盘字节完全一致**`, equal, {
      legacyBytes: legacyBytes.length,
      coreBytes: coreBytes.length,
      legacyHash: (await import('node:crypto')).createHash('sha256').update(legacyBytes).digest('hex').slice(0, 16),
      coreHash: (await import('node:crypto')).createHash('sha256').update(coreBytes).digest('hex').slice(0, 16),
    })
    // 4) 内容确实为 final（未被 frontmatter 合并/编码改写）
    check(`${fx.name}：落盘内容等于写入内容（无损）`, coreBytes.equals(Buffer.from(fx.final, 'utf8')), {
      expected: Buffer.byteLength(fx.final, 'utf8'), actual: coreBytes.length,
    })
  }

  const passed = checks.filter((c) => c.pass).length
  const summary = { generatedAt: new Date().toISOString(), base: BASE, checks, passed, total: checks.length }
  const text = JSON.stringify(summary, null, 2)
  if (OUT) writeFileSync(OUT, text, 'utf8')
  console.log(text)
  if (passed !== checks.length) process.exitCode = 1
}

main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1) })
