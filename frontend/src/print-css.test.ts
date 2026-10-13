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
    expect(cssCode).toContain('var(--background)')
    // 不得强制覆盖**文字颜色**：`--foreground` 是 #0e1115，而编辑器正文字色是 #1f2937，
    // 强制会让 PDF 文字颜色与编辑器不一致（实测 ΔE 13.68）。文字颜色必须沿用编辑器自身规则。
    expect(cssCode).not.toMatch(/color:\s*var\(--foreground\)/)
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
    // 允许出现在 @media print 之外的两类规则：
    //  1) 隐藏「打印专用页眉」（屏幕态必须不显示它）；
    //  2) task-72 的 `.ke-print-surface` **A4 预览面**（只作用于导出对话框内的预览容器，
    //     作用域隔离，不影响应用屏幕渲染）。
    const ALLOWED = '.ke-print-header{display:none}'
    let rest = outside.replace(ALLOWED, '')
    // 去掉预览面相关规则（选择器均以 .ke-print-surface 开头）
    rest = rest.replace(/\.ke-print-surface[^{}]*\{[^{}]*\}/g, '')
    rest = rest.replace(/@mediaprint\{[^{}]*\}/g, '')
    expect(rest, `@media print 之外还有规则：${rest.slice(0, 120)}`).toBe('')
    // 隐藏外壳 + 正文宽度也必须在 print 块里
    expect(cssCode).toMatch(/\.ke-editor-prose\s*\{[^}]*max-width:\s*none/s)
  })

  it('⑦ task-75：布局类声明绝不覆盖 `.katex` 子树（根号上横线过长的根因）', () => {
    // KaTeX 的伸缩根号依赖 .hide-tail / .svg-align 的 overflow:hidden 裁剪高大字形与横线；
    // 通配规则若把整棵子树的 overflow/max-width 等改成 visible/none → 横线被拉长。
    const code = cssCode.replace(/\/\*[\s\S]*?\*\//g, '')
    const rules: Array<{ sel: string; decls: string }> = []
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) rules.push({ sel: m[1].trim(), decls: m[2] })
    const LAYOUT = /(overflow|max-width|max-height|white-space|display|zoom)\s*:/
    const bad = rules.filter(
      (r) =>
        /[^\s>]\s+\*/.test(r.sel) && // **后代通配**（`X *`）才可能命中编辑器内容；`> *` 子代选择器不算
        !r.sel.includes(':not(.katex)') && // 未排除 KaTeX 子树
        LAYOUT.test(r.decls),
    )
    expect(
      bad.map((r) => `${r.sel} { ${r.decls.trim()} }`),
      '有通配规则在未排除 .katex 的情况下覆盖布局类声明',
    ).toEqual([])
    // 两个关键通配必须显式排除
    expect(code).toContain('#root *:not(.katex):not(.katex *)')
    expect(code).toContain('.ke-editor-prose *:not(.katex):not(.katex *)')
  })

  it('⑥ main.tsx 已在 index.css 之后引入 print.css（顺序影响变量解析）', () => {
    const i = mainTsx.indexOf("import './index.css'")
    const p = mainTsx.indexOf("import './print.css'")
    expect(i, 'main.tsx 未引入 index.css').toBeGreaterThanOrEqual(0)
    expect(p, 'main.tsx 未引入 print.css').toBeGreaterThan(i)
  })
})
