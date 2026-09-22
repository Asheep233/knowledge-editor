/**
 * B5 专项独立验证（task-47 · verifier-trash）
 *
 * 依据 `docs/review-v1.2.0-pre.2-full.md` §1 B5：plain 导出用宽松正则判定前导 frontmatter，
 * PM 把 thematicBreak 序列化为 `---`，故「正文以 HR 开头 + 后文独立 HR」的文档首段被静默吞掉。
 * 修法要求 `splitLeadingFm` / `stripKeFrontmatter` 统一改用 `ke.ts` 的 `scanFrontmatter` 判定。
 *
 * 与开发者测试的关系：本文件是**独立复算**（own skeleton → rewritten），不是复述开发者结论。
 * 攻击面由契约（导出零丢失）反推：
 *   A. 首行 HR + 后文 HR：首段/段序/HR 数量都不得变化（B5 原始 case）
 *   B. 退化输入：未闭合、空块、连续 HR、首行 HR 无尾段、真 fm + 正文首行 HR
 *   C. BOM / CRLF 变体与真 frontmatter 的反向保护（修复不得把真 fm 判成正文）
 *   D. 幂等：导出产物再喂回 → 稳定（withPlainFrontmatter 声明保证）
 *   E. 「无第三处宽松正则」：全仓非测试源文件扫描（比开发者只查 7 个文件更宽）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { plainMarkdown, stripKeFrontmatter, withPlainFrontmatter } from './plain-export'
import { scanFrontmatter, stripFrontmatter } from './ke'

const BOM = '\ufeff'
/** B5 原始构造：该 body 即 PM `getMarkdown()` 对「正文以 HR 开头」文档的产物形态 */
const HR_FIRST = '---\n\n第一段\n\n---\n\n第二段\n'
const countHr = (s: string): number => (s.match(/^---[ \t]*$/gm) ?? []).length

describe('B5-A 首行 HR 的正文：零丢段（原始 case）', () => {
  it('A1 plainMarkdown 保留两段且段序不变', () => {
    const out = plainMarkdown(HR_FIRST, {})
    expect(out, '第一段被吞 = B5 未修复').toContain('第一段')
    expect(out).toContain('第二段')
    expect(out.indexOf('第一段')).toBeLessThan(out.indexOf('第二段'))
  })

  it('A2 HR 数量不得变化（不得多/少一条 thematicBreak）', () => {
    const out = plainMarkdown(HR_FIRST, {})
    expect(countHr(HR_FIRST)).toBe(2)
    expect(countHr(out), `HR 数变化: ${JSON.stringify(out)}`).toBe(2)
  })

  it('A3 stripKeFrontmatter 对首行 HR 正文必须原样返回（未识别到 frontmatter）', () => {
    expect(stripKeFrontmatter(HR_FIRST)).toBe(HR_FIRST)
    expect(scanFrontmatter(HR_FIRST), 'ke.ts 判定应同步为「非 frontmatter」').toBeNull()
  })

  it('A4 withPlainFrontmatter：加 meta 后正文一行不少', () => {
    const out = withPlainFrontmatter(HR_FIRST, { title: '标题' })
    expect(out).toContain('title: 标题')
    expect(out).toContain('第一段')
    expect(out).toContain('第二段')
  })

  it('A5 首行 HR + 无尾段（`---\\n\\n第一段\\n`）不得整篇丢失', () => {
    const md = '---\n\n第一段\n'
    expect(stripKeFrontmatter(md)).toBe(md)
    const out = plainMarkdown(md, {})
    expect(out).toContain('第一段')
  })
})

describe('B5-B 退化输入', () => {
  it('B1 未闭合 `---` 开头 → 不得当 frontmatter，正文完整', () => {
    const md = '---\n\n正文段落\n\n更多正文\n'
    expect(scanFrontmatter(md)).toBeNull()
    expect(stripKeFrontmatter(md)).toBe(md)
    const out = plainMarkdown(md, {})
    expect(out).toContain('正文段落')
    expect(out).toContain('更多正文')
  })

  it('B2 连续 HR（`---\\n---\\n---\\n\\n正文\\n`）：正文不得丢，剩余 HR 数不受损', () => {
    const md = '---\n---\n---\n\n正文\n'
    const out = plainMarkdown(md, {})
    expect(out, '正文被吞').toContain('正文')
    expect(countHr(out), `剩余 HR 数异常: ${JSON.stringify(out)}`).toBe(1)
  })

  it('B3 空 frontmatter 块 `---\\n---\\n\\n正文\\n`：与 ke.ts 同判定，正文保留', () => {
    const md = '---\n---\n\n正文\n'
    const detected = scanFrontmatter(md) !== null
    expect(detected, 'ke.ts 应把 `---\\n---` 视为空 frontmatter 块（EDGE-1）').toBe(true)
    const stripped = stripKeFrontmatter(md)
    // stripKeFrontmatter 的语义是「剥离 KE 键」；无 KE 键时返回原文（不改变判定），
    // 最终正文起点由 plainMarkdown → withPlainFrontmatter 决定。
    expect(stripped).toBe(md)
    expect(plainMarkdown(md, {}), '正文不得被吞').toContain('正文')
  })

  it('B4 真 frontmatter + 正文首行 HR：fm 正确剥离且 HR 与正文都在', () => {
    const md = '---\ntitle: T\nke_version: 1\n---\n\n---\n\n正文\n'
    const out = stripKeFrontmatter(md)
    expect(out, 'ke_version 必须删除').not.toContain('ke_version')
    expect(out, 'title 保留').toContain('title: T')
    expect(out, '正文首行 HR 不得被吞').toContain('---\n\n正文')
  })
})

describe('B5-C BOM / CRLF 变体与反向保护', () => {
  it('C1 CRLF 首行 HR：判定与 LF 一致，两段都在', () => {
    const crlf = '---\r\n\r\n第一段\r\n\r\n---\r\n\r\n第二段\r\n'
    expect(scanFrontmatter(crlf)).toBeNull()
    expect(stripKeFrontmatter(crlf)).toBe(crlf)
    const out = plainMarkdown(crlf, {})
    expect(out).toContain('第一段')
    expect(out).toContain('第二段')
  })

  it('C2 BOM + 首行 HR：不得误判，正文保留', () => {
    const bom = `${BOM}---\n\n第一段\n\n---\n\n第二段\n`
    expect(stripKeFrontmatter(bom), 'BOM 变体不得被吞').toBe(bom)
    expect(plainMarkdown(bom, {})).toContain('第一段')
  })

  it('C3 BOM + 真 frontmatter（CRLF）：仍被正确剥离、正文保留', () => {
    const md = `${BOM}---\r\nke_version: 1\r\ntitle: 我的标题\r\n---\r\n\r\n正文\r\n`
    const out = stripFrontmatter(md)
    expect(out.content).toContain('正文')
    expect(out.content, 'ke 区块必须剥离（BOM 不得让它变成正文）').not.toContain('ke_version')
    expect(out.version).toBe(1)
  })

  it('C4 真 frontmatter 无 KE 键：stripKeFrontmatter 不得改动（键序/字节保留）', () => {
    const md = '---\ntitle: T\ntags:\n  - a\n---\n\n正文\n'
    expect(stripKeFrontmatter(md)).toBe(md)
  })
})

describe('B5-D 幂等：导出产物再喂回必须稳定', () => {
  const cases = [HR_FIRST, '---\n\n第一段\n', '---\ntitle: T\n---\n\n正文\n', '普通正文\n', '---\r\n\r\n第一段\r\n\r\n---\r\n\r\n第二段\r\n']

  for (const [i, md] of cases.entries()) {
    it(`D${i + 1} plainMarkdown 二次导出稳定：${JSON.stringify(md.slice(0, 18))}…`, () => {
      const once = plainMarkdown(md, { title: 'T' })
      const twice = plainMarkdown(once, { title: 'T' })
      expect(twice, `二次导出漂移，once=${JSON.stringify(once)}`).toBe(once)
      expect(once, '导出不得丢段').toContain(md.includes('第二段') ? '第二段' : md.includes('正文') ? '正文' : '第一段')
    })
  }
})

describe('B5-E 「无第三处宽松正则」全仓扫描（独立推导，比开发者覆盖面更宽）', () => {
  /** 旧实现的宽松 frontmatter 正则特征（源码文本字面量） */
  const LOOSE = '([\\s\\S]*?)\\r?\\n---'

  function allSourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) out.push(...allSourceFiles(p))
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p)
    }
    return out
  }

  /** 去掉注释：旧实现在注释里引用过宽松正则，扫描必须区分「注释提及」与「可执行代码」 */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  it('E1 全仓非测试源文件：不存在**可执行**的宽松 frontmatter 正则', () => {
    const offenders = allSourceFiles('src').filter((f) =>
      stripComments(readFileSync(f, 'utf8')).includes(LOOSE),
    )
    expect(offenders, `仍有可执行的宽松正则: ${offenders.join(', ')}`).toEqual([])
  }, 20_000) // 全仓同步读盘：宿主高负载下默认 5s 会超时（2026-09-22 实测 RUN3）

  it('E2 plain-export 两处判定都走 ke.ts：import scanFrontmatter 且 scanLeadingFm 委托', () => {
    const src = readFileSync('src/editor/plain-export.ts', 'utf8')
    expect(src).toContain("import { scanFrontmatter } from './ke'")
    expect(src, 'scanLeadingFm 必须委托 scanFrontmatter').toMatch(/scanFrontmatter\(body\.slice\(bom\)\)/)
    // 两个导出入口都经 scanLeadingFm
    expect(src).toMatch(/function splitLeadingFm[\s\S]*?scanLeadingFm\(/)
    expect(src).toMatch(/export function stripKeFrontmatter[\s\S]*?scanLeadingFm\(/)
  })

  it('E3 零内容丢失矩阵：任何 frontmatter 形态下，正文行必须全部出现在导出结果里', () => {
    const matrix = [
      HR_FIRST,
      '---\n\n第一段\n',
      '---\n---\n\n正文\n',
      '---\n---\n---\n\n正文\n',
      '---\ntitle: T\nke_version: 1\n---\n\n正文 A\n\n正文 B\n',
      '---\ntitle: T\n---\n\n---\n\n正文\n',
      `${BOM}---\r\n\r\n第一段\r\n\r\n---\r\n\r\n第二段\r\n`,
      '# 一级标题\n\n正文\n',
      '普通正文\n',
    ]
    for (const md of matrix) {
      const out = plainMarkdown(md, {})
      for (const rawLine of md.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line === '---') continue
        if (line.includes(':')) continue // frontmatter 键行允许被降级/删除
        expect(out, `内容行被吞: ${JSON.stringify(line)}（输入 ${JSON.stringify(md)}）`).toContain(line)
      }
    }
  })
})
