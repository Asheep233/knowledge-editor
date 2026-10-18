/**
 * P3-T21 实机探针：Rust 原生包存储（真实 Windows 文件系统）安装/升级/回滚/损坏恢复/崩溃恢复。
 * 运行于真实 WebView2 窗口（同源 App URL，可调 Tauri 命令），结果经 report_results 落盘。
 */
const root = '/probe-unused'

function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const g = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  if (g?.core?.invoke) return g.core.invoke(cmd, args)
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
  if (i?.invoke) return i.invoke(cmd, args)
  return Promise.reject(new Error('no tauri invoke'))
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function filesAndHashes(tag: string): Promise<{ files: Record<string, string>; hashes: Record<string, string> }> {
  const files = { 'index.html': `<html>${tag}</html>`, 'sdk.js': `export const tag = '${tag}'` }
  const hashes: Record<string, string> = {}
  for (const [k, v] of Object.entries(files)) hashes[k] = await sha256(v)
  return { files, hashes }
}

function errOf(e: unknown): string {
  return String((e as Error)?.message ?? e)
}

async function main(): Promise<void> {
  const out: Record<string, unknown> = { phase: 'pack-probe-start', ua: navigator.userAgent }
  try {
    const boot = (await tauriInvoke('boot_state')) as { pack_root?: string }
    const packRoot = boot.pack_root ?? ''
    out.packRoot = packRoot
    if (!packRoot) throw new Error('S1_PACK_ROOT 未设置')
    const id = 'com.probe.hello'
    const v1 = await filesAndHashes('v1')
    const v2 = await filesAndHashes('v2')
    const v3 = await filesAndHashes('v3')
    const v4 = await filesAndHashes('v4')

    out.stateAfterInstallV1 = await tauriInvoke('pack_install', {
      root: packRoot, id, version: '1.0.0', apiVersion: 1, capabilities: ['ui.shell', 'context.read'],
      files: v1.files, hashes: v1.hashes,
    })
    out.stateAfterInstallV2 = await tauriInvoke('pack_install', {
      root: packRoot, id, version: '2.0.0', apiVersion: 1, capabilities: ['ui.shell'],
      files: v2.files, hashes: v2.hashes,
    })
    out.verifyV1 = await tauriInvoke('pack_verify', { root: packRoot, id, version: '1.0.0' })
    out.verifyV2 = await tauriInvoke('pack_verify', { root: packRoot, id, version: '2.0.0' })
    out.stateAfterRollback = await tauriInvoke('pack_rollback', { root: packRoot, id })

    // 损坏 active → recover 自动回滚到 previous（2.0.0）
    await tauriInvoke('pack_corrupt', { root: packRoot, id, version: '1.0.0', path: 'index.html', content: 'corrupted' })
    out.verifyCorrupted = await tauriInvoke('pack_verify', { root: packRoot, id, version: '1.0.0' })
    out.recoverFromCorruption = await tauriInvoke('pack_recover', { root: packRoot, id })

    // 哈希不匹配 → 无损拒绝
    const badHash = { ...v3.hashes, 'index.html': '0'.repeat(64) }
    out.badHashError = await tauriInvoke('pack_install', {
      root: packRoot, id, version: '3.0.0', apiVersion: 1, capabilities: ['ui.shell'], files: v3.files, hashes: badHash,
    }).then(() => 'UNEXPECTED_ALLOWED', errOf)
    out.verifyRejectedV3 = await tauriInvoke('pack_verify', { root: packRoot, id, version: '3.0.0' })

    // 路径穿越 → E_PATH；重复安装 → E_DUPLICATE
    out.traversalError = await tauriInvoke('pack_install', {
      root: packRoot, id, version: '3.0.1', apiVersion: 1, capabilities: ['ui.shell'],
      files: { '../evil.html': 'x' }, hashes: { '../evil.html': await sha256('x') },
    }).then(() => 'UNEXPECTED_ALLOWED', errOf)
    out.duplicateError = await tauriInvoke('pack_install', {
      root: packRoot, id, version: '2.0.0', apiVersion: 1, capabilities: ['ui.shell'], files: v2.files, hashes: v2.hashes,
    }).then(() => 'UNEXPECTED_ALLOWED', errOf)

    // 崩溃注入：rename 后失败 → state 不变；recover 清理孤儿；重新安装成功
    const stateBeforeCrash = await tauriInvoke('pack_state', { root: packRoot, id })
    out.crashError = await tauriInvoke('pack_install', {
      root: packRoot, id, version: '4.0.0', apiVersion: 1, capabilities: ['ui.shell'],
      files: v4.files, hashes: v4.hashes, failAfterRename: true,
    }).then(() => 'UNEXPECTED_ALLOWED', errOf)
    out.stateAfterCrash = await tauriInvoke('pack_state', { root: packRoot, id })
    out.stateBeforeCrash = stateBeforeCrash
    out.recoverAfterCrash = await tauriInvoke('pack_recover', { root: packRoot, id })
    out.verifyOrphanV4 = await tauriInvoke('pack_verify', { root: packRoot, id, version: '4.0.0' })
    out.reinstallV4 = await tauriInvoke('pack_install', {
      root: packRoot, id, version: '4.0.0', apiVersion: 1, capabilities: ['ui.shell'], files: v4.files, hashes: v4.hashes,
    })
    out.finalState = await tauriInvoke('pack_state', { root: packRoot, id })
    out.phase = 'pack-probe-done'
  } catch (e) {
    out.phase = 'pack-probe-error'
    out.error = String((e as Error)?.stack ?? e)
  }
  const json = JSON.stringify(out, null, 2)
  document.body.insertAdjacentHTML('beforeend', `<pre style="font:10px monospace;white-space:pre-wrap">${json}</pre>`)
  try {
    await tauriInvoke('report_results', { results: json })
    await tauriInvoke('debug_log', { marker: 'pack-probe-reported' })
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', `<div>REPORT FAILED: ${String(e)}</div>`)
  }
}

void main()
