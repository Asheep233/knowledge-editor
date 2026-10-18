/** UI 工坊 T21/T23：Tauri 包命令适配器（mock invoke，无真实 Tauri）。 */
import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { choosePackDirectory, createTauriPackAdapter } from './tauriPackAdapter'
import type { WorkshopAdapter } from '../../components/workshop/WorkshopPanel'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
})
type AnyAdapter = WorkshopAdapter

function adapter(opts: Parameters<typeof createTauriPackAdapter>[0] = {}): AnyAdapter {
  return createTauriPackAdapter(opts)
}

describe('T21/T23 TauriPackAdapter', () => {
  it('listInstalled 映射 Rust list 响应', async () => {
    mockedInvoke.mockResolvedValueOnce({
      packs: [{ id: 'com.demo.a', name: 'A', active: '2.0.0', previous: '1.0.0', activeVersion: '2.0.0', capabilities: ['ui.shell'], signatureStatus: 'valid' }],
    })
    const packs = await adapter().listInstalled()
    expect(packs).toEqual([
      { id: 'com.demo.a', name: 'A', version: '2.0.0', active: true, previous: '1.0.0', capabilities: ['ui.shell'], signature: 'valid' },
    ])
    expect(mockedInvoke).toHaveBeenCalledWith('workshop_pack_list')
  })

  it('stageFromFile 调用 scan 并映射为预览（token=源目录）', async () => {
    mockedInvoke.mockResolvedValueOnce({
      packId: 'com.demo.b', name: 'B', version: '1.0.0', apiVersion: 1, capabilities: ['ui.shell', 'context.read'], sizeBytes: 10, blocked: false,
    })
    const a = adapter({ chooseSourceDir: async () => 'C:/packs/b' })
    const preview = await a.stageFromFile()
    expect(mockedInvoke).toHaveBeenCalledWith('workshop_pack_scan', { sourceDir: 'C:/packs/b' })
    expect(preview).toMatchObject({ token: 'C:/packs/b', packId: 'com.demo.b', source: 'local-file', signature: 'missing', blocked: false })
    expect(preview!.capabilities.find((c) => c.capability === 'ui.shell')!.risk).toBe('medium')
  })

  it('默认目录选择器使用 Tauri dialog（选择目录）', async () => {
    vi.mocked(openDialog).mockResolvedValueOnce('C:/packs/picked')
    await expect(choosePackDirectory()).resolves.toBe('C:/packs/picked')
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }))
    vi.mocked(openDialog).mockResolvedValueOnce(null as never)
    await expect(choosePackDirectory()).resolves.toBeNull()
  })

  it('scan 签名状态映射：invalid → blocked + 原因；valid → 可确认', async () => {
    mockedInvoke.mockResolvedValueOnce({
      packId: 'com.demo.bad', name: 'Bad', version: '1.0.0', apiVersion: 1, capabilities: ['ui.shell'],
      signatureStatus: 'invalid', signatureReason: 'E_SIGNATURE: 验签失败',
    })
    const bad = await adapter({ chooseSourceDir: async () => 'C:/packs/bad' }).stageFromFile()
    expect(bad).toMatchObject({ signature: 'invalid', blocked: true, blockReason: 'E_SIGNATURE: 验签失败' })
    expect(bad!.warnings.join(' ')).toMatch(/签名无效/)
    mockedInvoke.mockResolvedValueOnce({
      packId: 'com.demo.ok', name: 'Ok', version: '1.0.0', apiVersion: 1, capabilities: ['ui.shell'],
      signatureStatus: 'valid',
    })
    const ok = await adapter({ chooseSourceDir: async () => 'C:/packs/ok' }).stageFromFile()
    expect(ok).toMatchObject({ signature: 'valid', blocked: false })
  })

  it('W01：stageFromZip → staging 预览；confirmInstall 走 install_staged；cancel 清理 staging', async () => {
    const invokeImpl = vi.fn(async (cmd: string) => {
      if (cmd === 'workshop_pack_stage_zip') {
        return { packId: 'com.demo.zip', name: 'Zip Pack', version: '1.0.0', apiVersion: 1,
          capabilities: ['ui.shell'], signatureStatus: 'valid', token: 'C:/data/.staging-zip-1-2' }
      }
      return undefined
    })
    const a = createTauriPackAdapter({ invokeImpl: invokeImpl as never, chooseZipFile: async () => 'C:/tmp/pack.zip' })
    const preview = await a.stageFromZip!()
    expect(preview).toMatchObject({ packId: 'com.demo.zip', source: 'zip-file', signature: 'valid', blocked: false })
    await a.confirmInstall(preview!.token)
    expect(invokeImpl).toHaveBeenCalledWith('workshop_pack_install_staged', { sourceDir: 'C:/data/.staging-zip-1-2' })
    expect(a.cancelPreview(preview!.token)).toBe(true)
    expect(invokeImpl).toHaveBeenCalledWith('workshop_pack_abort_staged', { sourceDir: 'C:/data/.staging-zip-1-2' })
  })

  it('chooseSourceDir 返回 null → 不扫描', async () => {
    const a = adapter({ chooseSourceDir: async () => null })
    expect(await a.stageFromFile()).toBeNull()
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('confirmInstall 调用 install；rollback/recover 映射结果', async () => {
    mockedInvoke.mockResolvedValueOnce({ active: '1.0.0' }) // install
    await adapter().confirmInstall('C:/packs/b')
    expect(mockedInvoke).toHaveBeenCalledWith('workshop_pack_install', { sourceDir: 'C:/packs/b' })
    mockedInvoke.mockResolvedValueOnce({ active: '1.0.0' }) // rollback
    await adapter().rollback('com.demo.b')
    expect(mockedInvoke).toHaveBeenCalledWith('workshop_pack_rollback', { id: 'com.demo.b' })
    mockedInvoke.mockResolvedValueOnce({ recovered: true, action: 'rollback-corrupt-active' })
    await expect(adapter().recover('com.demo.b')).resolves.toEqual({ recovered: true, action: 'rollback-corrupt-active' })
  })

  it('信任等级：tierOf/grantTrust/revokeTrust 使用 TrustStore（默认 community）', async () => {
    const a = adapter()
    expect(await a.tierOf!('com.demo.a')).toBe('community')
    await a.grantTrust!('com.demo.a', 'trusted')
    expect(await a.tierOf!('com.demo.a')).toBe('trusted')
    await a.revokeTrust!('com.demo.a')
    expect(await a.tierOf!('com.demo.a')).toBe('community')
  })

  it('uninstall 调用 workshop_pack_uninstall', async () => {
    mockedInvoke.mockResolvedValueOnce({ uninstalled: 'com.demo.a' })
    await adapter().uninstall!('com.demo.a')
    expect(mockedInvoke).toHaveBeenCalledWith('workshop_pack_uninstall', { id: 'com.demo.a' })
  })

  it('recoverAll 调用 workshop_pack_recover_all 并映射 safeMode', async () => {
    mockedInvoke.mockResolvedValueOnce({ checked: 2, safeMode: true, results: [] })
    await expect(adapter().recoverAll!()).resolves.toEqual({ checked: 2, safeMode: true, results: [] })
    expect(mockedInvoke).toHaveBeenCalledWith('workshop_pack_recover_all')
  })

  it('Rust 命令失败 → 抛出 Error（保留原因）', async () => {
    mockedInvoke.mockRejectedValueOnce('E_HASH: 资产哈希不匹配')
    await expect(adapter({ chooseSourceDir: async () => 'C:/packs/bad' }).stageFromFile()).rejects.toThrow(/E_HASH/)
  })

  it('cancelPreview 恒为 true 且不调用后端', () => {
    expect(adapter().cancelPreview('tok')).toBe(true)
  })
})
