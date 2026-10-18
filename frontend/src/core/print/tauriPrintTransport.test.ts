/** UI 工坊 T16：产品打印 transport（mock invoke）。 */
import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTauriPrintTransport } from './tauriPrintTransport'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

beforeEach(() => {
  vi.mocked(invoke).mockReset()
})

describe('T16 TauriPrintTransport', () => {
  it('调用 print_snapshot_pdf（html/target/contentWidth）并返回路径', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/tmp/out.pdf')
    const t = createTauriPrintTransport({ contentWidth: 716 })
    const out = await t.print({ html: '<html>snapshot</html>', pages: 3 }, '/tmp/out.pdf', new AbortController().signal)
    expect(invoke).toHaveBeenCalledWith('print_snapshot_pdf', {
      html: '<html>snapshot</html>',
      target: '/tmp/out.pdf',
      contentWidth: 716,
    })
    expect(out).toEqual({ pdfPath: '/tmp/out.pdf', pages: 3, bytes: 0 })
  })

  it('已取消 → 不调用 invoke', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      createTauriPrintTransport().print({ html: '<p/>', pages: 1 }, '/tmp/x.pdf', controller.signal),
    ).rejects.toThrow(/E_CANCELED/)
    expect(invoke).not.toHaveBeenCalled()
  })
})
