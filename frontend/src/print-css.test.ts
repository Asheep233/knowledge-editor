/**
 * task-70 第 1 步：打印样式**契约用例**（纯文本断言，不需要浏览器）。
 *
 * 这些断言锁的是「与主题一致 + 打印管线不剥色 + 分页不腰斩」四条硬约束，
 * 任何一条被违反都会让导出的 PDF 与编辑器渲染漂移。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd() // vitest 以 frontend/ 为 cwd
const css = readFileSync(join(ROOT, 'src/print.css'), 'utf8')
const mainTsx = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')

/** 去掉注释后的正文（避免注释里的示例文本干扰断言） */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('task-70 打印样式契约', () => {
  it('① 绝不硬编码颜色（必须只消费 index.css 的 CSS 变量）', () => {
    const hex = cssCode.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    const rgb = cssCode.match(/\brgba?\(/g) ?? []
    const hsl = cssCode.match(/\bhsla?\(/g) ?? []
    expect(hex, `出现硬编码 hex 颜色：${hex.join(', ')}`).toEqual([])
    expect(rgb, `出现硬编码 rgb()：${rgb.join(', ')}`).toEqual([])
    expect(hsl, `出现硬编码 hsl()：${hsl.join(', ')}`).toEqual([])
    // 至少确实用到了主题变量
    expect(cssCode).toContain('var(--background)')
    expect(cssCode).toContain('var(--foreground)')
  })

  it('② 必须显式要求保留背景色（否则主题底色/代码块底色被剥离）', () => {
    expect(cssCode).toContain('print-color-adjust: exact')
    expect(cssCode).toContain('-webkit-print-color-adjust: exact')
  })

  it('③ 主题底色铺满整页：html/body 上色 + @page 边距归零', () => {
    expect(cssCode).toMatch(/html,\s*body\s*\{[^}]*background:\s*var\(--background\)/s)
    expect(cssCode).toMatch(/@page\s*\{[^}]*margin:\s*0/s)
  })

  it('④ 必须含分页规则：公式/表格/图片/信息块不跨页，标题不与后文分离', () => {
    expect(cssCode).toContain('break-inside: avoid')
    expect(cssCode).toContain('break-after: avoid')
    // 公式块（$$）必须在不跨页名单里
    expect(cssCode).toMatch(/\.ke-math--block[^{]*\{[^}]*break-inside:\s*avoid/s)
    expect(cssCode).toMatch(/table[^{]*\{[^}]*break-inside:\s*avoid/s)
    expect(cssCode).toMatch(/img[^{]*\{[^}]*break-inside:\s*avoid/s)
    // 标题
    expect(cssCode).toMatch(/h1[^{]*\{[^}]*break-after:\s*avoid/s)
  })

  it('⑤ 所有规则都在 @media print 内（屏幕态不得被本文件影响）', () => {
    const first = cssCode.indexOf('@media print')
    expect(first, '缺少 @media print').toBeGreaterThanOrEqual(0)
    // 去掉 @media print { ... } 包裹后，不应再有选择器/声明残留
    const open = cssCode.indexOf('{', first)
    let depth = 0
    let end = -1
    for (let i = open; i < cssCode.length; i++) {
      if (cssCode[i] === '{') depth++
      else if (cssCode[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    expect(end, '@media print 块未闭合').toBeGreaterThan(0)
    const outside = (cssCode.slice(0, first) + cssCode.slice(end + 1)).replace(/\s|;/g, '')
    expect(outside, `@media print 之外还有规则：${outside.slice(0, 120)}`).toBe('')
    // 隐藏外壳 + 正文宽度也必须在 print 块里
    expect(cssCode).toMatch(/\.ke-editor-prose\s*\{[^}]*max-width:\s*none/s)
  })

  it('⑥ main.tsx 已在 index.css 之后引入 print.css（顺序影响变量解析）', () => {
    const i = mainTsx.indexOf("import './index.css'")
    const p = mainTsx.indexOf("import './print.css'")
    expect(i, 'main.tsx 未引入 index.css').toBeGreaterThanOrEqual(0)
    expect(p, 'main.tsx 未引入 print.css').toBeGreaterThan(i)
  })
})
