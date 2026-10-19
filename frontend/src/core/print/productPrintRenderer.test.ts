/** T26 G3：产品打印渲染器 —— 快照→自包含打印 HTML；页数不可得如实 null；失败传播。 */
import { describe, expect, it, vi } from 'vitest'

import { createProductPrintRenderer } from './productPrintRenderer'
import type { PrintSnapshot } from './printJob'

const SNAPSHOT: PrintSnapshot = { relPath: 'Articles/a.md', revision: 4, content: '# 标题\n\n正文' }

describe('T26 G3 ProductPrintRenderer', () => {
  it('渲染自包含打印文档（doctype/内联 CSS/主题/来源注释），pages 如实 null', async () => {
    const renderer = createProductPrintRenderer({
      renderBody: async () => '<h1>标题</h1><p>正文</p>',
      theme: () => 'light',
    })
    const rendered = await renderer.render(SNAPSHOT, new AbortController().signal)
    expect(rendered.pages).toBeNull()
    expect(rendered.html).toContain('<!doctype html>')
    expect(rendered.html).toContain('data-theme="light"')
    expect(rendered.html).toContain('<h1>标题</h1><p>正文</p>')
    expect(rendered.html).toContain('@page { margin: 14mm; }')
    expect(rendered.html).toContain('Articles/a.md')
  })

  it('深色主题写入 html[data-theme=dark]', async () => {
    const renderer = createProductPrintRenderer({ renderBody: () => '<p>x</p>', theme: () => 'dark' })
    const rendered = await renderer.render(SNAPSHOT, new AbortController().signal)
    expect(rendered.html).toContain('data-theme="dark"')
  })

  it('快照正文缺失 → E_PRINT_SNAPSHOT（拒绝打印空内容）', async () => {
    const renderer = createProductPrintRenderer({ renderBody: () => '<p>x</p>' })
    await expect(renderer.render({ ...SNAPSHOT, content: '' }, new AbortController().signal)).rejects.toThrow(/E_PRINT_SNAPSHOT/)
  })

  it('渲染结果为空 → E_PRINT_RENDERER', async () => {
    const renderer = createProductPrintRenderer({ renderBody: () => '   ' })
    await expect(renderer.render(SNAPSHOT, new AbortController().signal)).rejects.toThrow(/E_PRINT_RENDERER/)
  })

  it('渲染失败（如产品编辑器未就绪）如实传播', async () => {
    const renderer = createProductPrintRenderer({
      renderBody: () => {
        throw new Error('E_PRINT_RENDERER: 产品编辑器渲染器未就绪（EditorArea 未挂载）')
      },
    })
    await expect(renderer.render(SNAPSHOT, new AbortController().signal)).rejects.toThrow(/未就绪/)
  })

  it('已取消的 signal → E_CANCELED，不调用渲染', async () => {
    const renderBody = vi.fn(() => '<p>x</p>')
    const renderer = createProductPrintRenderer({ renderBody })
    const controller = new AbortController()
    controller.abort()
    await expect(renderer.render(SNAPSHOT, controller.signal)).rejects.toThrow(/E_CANCELED/)
    expect(renderBody).not.toHaveBeenCalled()
  })
})
