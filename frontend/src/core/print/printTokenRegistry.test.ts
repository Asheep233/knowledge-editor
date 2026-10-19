/** T26 G3：pdfToken 注册表 —— 不透明 token → 真实 PDF 路径/页数；有界；诊断钩子。 */
import { afterEach, describe, expect, it } from 'vitest'

import { listPrintTokens, lookupPrintToken, registerPrintToken, resetPrintTokensForTests } from './printTokenRegistry'

afterEach(() => {
  resetPrintTokensForTests()
})

describe('T26 G3 PrintTokenRegistry', () => {
  it('登记真实 PDF → 返回不透明 token（不泄露路径），可反查真实元数据', () => {
    const token = registerPrintToken({
      pdfPath: 'C:\\ke-tmp\\uiws-t26-g3g4\\appdata\\com.astranota.uiws.e2e\\print-a-r1-x.pdf',
      relPath: 'Articles/a.md',
      revision: 1,
      pages: null,
    })
    expect(token).toMatch(/^pdf-[a-z0-9]+-[a-z0-9]+$/)
    expect(token).not.toContain('print-')
    expect(token).not.toContain('C:')
    const entry = lookupPrintToken(token)
    expect(entry).toMatchObject({ relPath: 'Articles/a.md', revision: 1, pages: null })
    expect(entry?.pdfPath.endsWith('.pdf')).toBe(true)
    expect(listPrintTokens()).toHaveLength(1)
  })

  it('缺真实路径 → E_PRINT_TOKEN（拒绝登记假 token）', () => {
    expect(() => registerPrintToken({ pdfPath: '', relPath: 'a.md', revision: 1, pages: null })).toThrow(/E_PRINT_TOKEN/)
  })

  it('token 唯一且登记表有界（最多 32 条）', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 40; i++) {
      tokens.add(registerPrintToken({ pdfPath: `C:\\tmp\\p-${i}.pdf`, relPath: 'a.md', revision: i, pages: null }))
    }
    expect(tokens.size).toBe(40)
    expect(listPrintTokens().length).toBe(32)
    expect(lookupPrintToken([...tokens][0])).toBeUndefined()
  })

  it('诊断钩子 window.__kePrintTokens() 返回当前登记表', () => {
    const token = registerPrintToken({ pdfPath: 'C:\\tmp\\p.pdf', relPath: 'a.md', revision: 1, pages: 2 })
    const read = (window as unknown as { __kePrintTokens?: () => { pdfToken: string }[] }).__kePrintTokens
    expect(typeof read).toBe('function')
    expect(read!().map((e) => e.pdfToken)).toContain(token)
  })
})
