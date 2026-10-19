/** T26 G3：打印输出路径 —— 隔离目录、绝对路径、.pdf、不覆盖（唯一名）、穿越拒绝。 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => 'C:/Users/tester/AppData/Roaming/com.knowledgeeditor.desktop'),
}))

import {
  assertPrintTargetPath,
  buildPrintTargetPath,
  defaultPrintBaseDir,
  isAbsolutePath,
  printOutputDirOverride,
  resolvePrintBaseDir,
  resolvePrintTarget,
  sanitizePrintFileStem,
} from './printOutput'

describe('T26 G3 PrintOutput', () => {
  it('isAbsolutePath：Windows 盘符/正斜杠/UNC 为绝对，相对路径不是', () => {
    expect(isAbsolutePath('C:\\tmp\\a.pdf')).toBe(true)
    expect(isAbsolutePath('C:/tmp/a.pdf')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share\\a.pdf')).toBe(true)
    expect(isAbsolutePath('tmp/a.pdf')).toBe(false)
    expect(isAbsolutePath('C:tmp/a.pdf')).toBe(false)
  })

  it('sanitizePrintFileStem：取文件名主干、去危险字符、去扩展名', () => {
    expect(sanitizePrintFileStem('Articles/子目录/My Doc.md')).toBe('My Doc')
    expect(sanitizePrintFileStem('Articles/a:b*c?.md')).toBe('a-b-c-')
    expect(sanitizePrintFileStem('')).toBe('document')
  })

  it('assertPrintTargetPath：拒绝相对路径/穿越/非 pdf，接受合法绝对路径', () => {
    expect(() => assertPrintTargetPath('foo/bar.pdf')).toThrow(/绝对路径/)
    expect(() => assertPrintTargetPath('C:/tmp/../x.pdf')).toThrow(/\.\./)
    expect(() => assertPrintTargetPath('C:/tmp/x.txt')).toThrow(/\.pdf/)
    expect(() => assertPrintTargetPath('C:/tmp/a\0b.pdf')).toThrow(/非法字符/)
    expect(() => assertPrintTargetPath('C:\\tmp\\print-a-r1-x.pdf')).not.toThrow()
  })

  it('buildPrintTargetPath：绝对、唯一命名（revision+时钟+随机）、不含穿越', () => {
    const a = buildPrintTargetPath({
      baseDir: 'C:\\ke-tmp\\uiws-t26-g3g4\\appdata\\com.astranota.uiws.e2e',
      relPath: 'Articles/print-test.md',
      revision: 3,
      now: () => 1_700_000_000_000,
      random: () => 0.5,
    })
    expect(a).toMatch(/appdata\\com\.astranota\.uiws\.e2e\\print-print-test-r3-[a-z0-9]+\.pdf$/)
    expect(a.toLowerCase()).not.toContain('..')
    const b = buildPrintTargetPath({
      baseDir: 'C:\\tmp',
      relPath: 'Articles/print-test.md',
      revision: 3,
      now: () => 1_700_000_000_001,
      random: () => 0.75,
    })
    expect(b).not.toBe(a)
    expect(() => buildPrintTargetPath({ baseDir: 'relative/dir', relPath: 'a.md', revision: 1 })).toThrow(/绝对路径/)
    expect(() => buildPrintTargetPath({ baseDir: 'C:\\tmp', relPath: 'a.md', revision: -1 })).toThrow(/revision/)
  })

  it('resolvePrintTarget：显式 baseDir 优先；缺省走 appDataDir（非工作区隔离目录）', async () => {
    const explicit = await resolvePrintTarget({ relPath: 'Articles/a.md', revision: 2 }, { baseDir: 'C:\\ke-tmp\\out' })
    expect(explicit.startsWith('C:\\ke-tmp\\out\\print-a-r2-')).toBe(true)
    expect(await defaultPrintBaseDir()).toBe('C:/Users/tester/AppData/Roaming/com.knowledgeeditor.desktop')
    const viaDefault = await resolvePrintTarget({ relPath: 'Articles/a.md', revision: 2 })
    expect(viaDefault.startsWith('C:\\Users\\tester\\AppData\\Roaming\\com.knowledgeeditor.desktop\\print-a-r2-')).toBe(true)
  })

  it('诊断覆盖：window.__KE_PRINT_OUTPUT_DIR__ 合法绝对路径 → 打印输出改到该目录（隔离 W 用）；非法值忽略', async () => {
    const w = window as unknown as { __KE_PRINT_OUTPUT_DIR__?: string }
    expect(printOutputDirOverride()).toBeNull()
    expect(await resolvePrintBaseDir()).toBe('C:/Users/tester/AppData/Roaming/com.knowledgeeditor.desktop')
    w.__KE_PRINT_OUTPUT_DIR__ = 'C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out'
    expect(printOutputDirOverride()).toBe('C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out')
    expect(await resolvePrintBaseDir()).toBe('C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out')
    const target = await resolvePrintTarget({ relPath: 'Articles/a.md', revision: 1 })
    expect(target.startsWith('C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out\\print-a-r1-')).toBe(true)
    w.__KE_PRINT_OUTPUT_DIR__ = 'relative/dir'
    expect(printOutputDirOverride()).toBeNull()
    w.__KE_PRINT_OUTPUT_DIR__ = 42 as unknown as string
    expect(printOutputDirOverride()).toBeNull()
  })
})
