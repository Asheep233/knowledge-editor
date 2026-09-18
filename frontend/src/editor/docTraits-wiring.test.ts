/**
 * task-34：F-4/F-5 生产接线测试（规范 `docs/document-format.md` §2.6）。
 *
 * 覆盖：
 *  A. 保存序列化模拟（纯函数）：CRLF 保留 / LF 不被改成 CRLF / BOM 保留 / 无 BOM 不新增 / 幂等
 *  B. 保存后「对齐比较」归一化：编辑器 LF vs 回包 CRLF+BOM → 判「一致」（不得触发重载）；
 *     真实内容差异不得被归一化掩盖
 *  C. 草稿/恢复点路径不受 traits 影响（恒 LF、无 BOM）
 *  D. 源码级守卫：EditorArea 真的在保存路径调 `applyDocTraits`、载入路径调 `captureDocTraits`
 *     （防止只改测试不改接线）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyDocTraits, captureDocTraits, KE_VERSION, stripFrontmatter, withFrontmatter } from './ke'
import { normalizeForCompare } from '../components/layout/EditorArea'

const BOM = '\ufeff'

/** 磁盘原文样例 */
const CRLF_RAW = `---\r\nke_version: 1\r\n---\r\n\r\n# 标题\r\n\r\n正文\r\n`
const LF_RAW = `---\nke_version: 1\n---\n\n# 标题\n\n正文\n`
const BOM_RAW = `${BOM}---\nke_version: 1\n---\n\n# 标题\n\n正文\n`

/** 复刻 EditorArea 保存路径：序列化 → withFrontmatter → applyDocTraits(该文档特征) */
function simulateSave(editorMd: string, rawOnDisk: string): string {
  const traits = captureDocTraits(rawOnDisk)
  return applyDocTraits(withFrontmatter(editorMd, KE_VERSION), traits)
}

/** 某个 LF 字符是否前面没有 CR（用于断言「全文 CRLF」） */
const hasBareLf = (s: string): boolean => /(^|[^\r])\n/.test(s)

describe('A. 保存序列化模拟（纯函数）', () => {
  it('A1 CRLF 文档：载入 → 保存后仍为 CRLF（无裸 LF）', () => {
    const traits = captureDocTraits(CRLF_RAW)
    expect(traits).toEqual({ bom: false, eol: '\r\n' })
    const editorMd = normalizeForCompare(stripFrontmatter(CRLF_RAW).content) // 编辑器内部 LF
    expect(hasBareLf(editorMd)).toBe(true)
    const out = simulateSave(editorMd, CRLF_RAW)
    expect(hasBareLf(out)).toBe(false) // 全部 CRLF
    expect(stripFrontmatter(out).content).toBe('# 标题\r\n\r\n正文\r\n')
  })

  it('A2 LF 文档：不得被改成 CRLF', () => {
    expect(captureDocTraits(LF_RAW).eol).toBe('\n')
    const out = simulateSave(normalizeForCompare(stripFrontmatter(LF_RAW).content), LF_RAW)
    expect(out).not.toContain('\r')
  })

  it('A3 BOM 文档：保存后仍以 BOM 开头，且不重复叠加', () => {
    expect(captureDocTraits(BOM_RAW).bom).toBe(true)
    const out = simulateSave(normalizeForCompare(stripFrontmatter(BOM_RAW).content), BOM_RAW)
    expect(out.startsWith(BOM)).toBe(true)
    expect(out.slice(BOM.length).startsWith(BOM)).toBe(false)
    expect(stripFrontmatter(out).content).toBe('# 标题\n\n正文\n')
  })

  it('A4 无 BOM 文档：不得新增 BOM（编辑器侧混入的 BOM 也要剥掉）', () => {
    const out = simulateSave(normalizeForCompare(stripFrontmatter(LF_RAW).content), LF_RAW)
    expect(out.startsWith(BOM)).toBe(false)
    const dirty = simulateSave(`${BOM}# 标题\n`, LF_RAW)
    expect(dirty.startsWith(BOM)).toBe(false)
  })

  it('A5 CRLF + BOM 组合：两者同时保留', () => {
    const raw = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n`
    const out = simulateSave(normalizeForCompare(stripFrontmatter(raw).content), raw)
    expect(out.startsWith(BOM)).toBe(true)
    expect(hasBareLf(out)).toBe(false)
  })

  it('A6 幂等：二次保存（以回包原文为新的特征源）字节不变', () => {
    const editorMd = normalizeForCompare(stripFrontmatter(CRLF_RAW).content)
    const first = simulateSave(editorMd, CRLF_RAW)
    const second = simulateSave(normalizeForCompare(stripFrontmatter(first).content), first)
    expect(second).toBe(first)
  })
})

describe('B. 保存后「对齐比较」归一化（F15 陷阱）', () => {
  const editorSide = '# 标题\n\n正文\n' // 编辑器序列化结果（恒 LF）
  const serverReply = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n# 标题\r\n\r\n正文\r\n` // 回包 = 磁盘原样

  it('B1 编辑器 LF vs 回包 CRLF+BOM → 判定一致（不触发重载）', () => {
    const savedBody = stripFrontmatter(serverReply).content
    expect(normalizeForCompare(editorSide)).toBe(normalizeForCompare(savedBody))
  })

  it('B2 真实内容差异不得被归一化掩盖', () => {
    const savedBody = stripFrontmatter('# 标题\n\n改写后的正文\n').content
    expect(normalizeForCompare(editorSide)).not.toBe(normalizeForCompare(savedBody))
  })

  it('B3 归一化幂等 + 去 BOM/CRLF', () => {
    const once = normalizeForCompare(serverReply)
    expect(once.startsWith(BOM)).toBe(false)
    expect(once).not.toContain('\r')
    expect(normalizeForCompare(once)).toBe(once)
  })
})

describe('C. 草稿 / 恢复点路径不受 traits 影响', () => {
  it('C1 草稿内容恒 LF、无 BOM（即使文档是 CRLF+BOM）', () => {
    const raw = `${BOM}---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n`
    const draftMd = withFrontmatter(normalizeForCompare(stripFrontmatter(raw).content), KE_VERSION)
    expect(draftMd.startsWith(BOM)).toBe(false)
    expect(draftMd).not.toContain('\r')
    // 草稿路径不套 traits：CRLF 特征只作用于文档写入
    expect(applyDocTraits(draftMd, captureDocTraits(raw))).not.toBe(draftMd) // 特征确实不同…
    expect(draftMd).toBe(`---\nke_version: ${KE_VERSION}\n---\n\n正文\n`) // …但草稿保持原样
  })
})

describe('D. 源码级守卫（EditorArea 真的接线了）', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/layout/EditorArea.tsx'), 'utf8')

  it('D1 保存路径：文档写入经过 applyDocTraits(md, traitsFor(docId))', () => {
    expect(src).toMatch(/saveArticle\(\s*docId,\s*applyDocTraits\(md,\s*traitsFor\(docId\)\)/)
  })

  it('D2 载入路径：捕获磁盘原文特征（切档 / 保存回包 / 历史恢复 三处）', () => {
    expect(src).toMatch(/captureTraits\(article\.id,\s*article\.content\)/) // 切档载入
    expect(src).toMatch(/captureTraits\(docId,\s*saved\.content\)/) // 保存回包
    expect(src).toMatch(/captureTraits\(article\.id,\s*doc\.content\)/) // 历史恢复写回
  })

  it('D3 对齐比较已归一化（两侧都过 normalizeForCompare）', () => {
    const compare = /normalizeForCompare\(stripFrontmatter\(md\)\.content\)\s*!==\s*savedNorm/.exec(src)
    expect(compare).toBeTruthy()
    expect(src).toMatch(/const savedNorm = normalizeForCompare\(savedBody\)/)
    expect(src).toMatch(/export function normalizeForCompare/)
  })

  it('D4 草稿路径不套 traits：registerRecoveryPoint(docId, md) 保持原样', () => {
    expect(src).toMatch(/registerRecoveryPoint\(docId,\s*md\)/)
    expect(src).not.toMatch(/registerRecoveryPoint\(docId,\s*applyDocTraits/)
  })

  it('D5 traits 按 docId 记录：captureTraits/traitsFor + 缺省 LF/无 BOM', () => {
    expect(src).toMatch(/const docTraitsRef = useRef\(new Map<string, DocTraits>\(\)\)/)
    expect(src).toMatch(/DEFAULT_DOC_TRAITS: DocTraits = \{\s*bom:\s*false,\s*eol:\s*'\\n'\s*\}/)
    expect(src).toMatch(/traitsFor = useCallback/)
  })
})
