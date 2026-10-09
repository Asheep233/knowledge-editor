/**
 * task-55 R06：公式异常回退的**存储型 XSS** 修复锁定。
 *
 * 审查事实（AstraNota-independent-audit-2026-10-02 R06 / 41F UI-8）：
 * KaTeX 的 `throwOnError:false` 只覆盖语法错误，不覆盖运行时异常 ——
 * `'{'×6000 + <img src=x onerror=…> + '}'×6000`（12070 字符）实测抛
 * `RangeError: Maximum call stack size exceeded`；修复前回退分支是
 * `dangerouslySetInnerHTML={{ __html: latex }}` → 文档可控的原始 latex 被当 HTML 注入。
 *
 * 本文件锁定三件事：
 *   1) 预算函数（长度 / 花括号嵌套）边界正确，`\{` 转义不计入深度
 *   2) 回退分支**必须是 React 文本节点**：DOM 里不得出现 payload 的 <img>、不得执行 onerror
 *   3) 常见失败（KaTeX 语法错误）仍走 KaTeX 自带 error span —— 不回归
 */
import React, { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MathExtension } from '../../../editor/extensions/MathExtension'
import {
  MAX_MATH_FALLBACK_DISPLAY,
  MAX_MATH_FALLBACK_TITLE,
  MAX_MATH_LATEX_DEPTH,
  MAX_MATH_LATEX_LEN,
  fallbackDisplayText,
  fallbackTitle,
  isMathLatexWithinBudget,
} from './MathNodeView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 审查报告里的原始攻击构造（≈12KB） */
const XSS_PAYLOAD =
  '{'.repeat(6000) +
  '<img src=x onerror="document.documentElement.dataset.keXss=\'yes\'">' +
  '}'.repeat(6000)

const EXTENSIONS = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  MathExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

let root: Root | null = null
let harnessEditor: Editor | null = null

function Harness({ markdown }: { markdown: string }) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: markdown,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'ke-editor-prose' } },
  })
  useEffect(() => {
    harnessEditor = editor ?? null
  }, [editor])
  return React.createElement(EditorContent, { editor })
}

async function mount(markdown: string): Promise<void> {
  if (root) {
    const prev = root
    root = null
    await act(async () => prev.unmount())
    harnessEditor = null
    document.body.innerHTML = ''
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const r = createRoot(container)
  root = r
  await act(async () => {
    r.render(React.createElement(Harness, { markdown }))
  })
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('.ke-math')) break
    await new Promise((res) => setTimeout(res, 20))
  }
  await new Promise((res) => setTimeout(res, 30))
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  delete (document.documentElement as HTMLElement).dataset.keXss
  harnessEditor?.destroy()
  harnessEditor = null
})

// ------------------------------------------------------------- 1. 预算函数（纯函数）

describe('task-55 R06-1. 公式源预算（纯函数）', () => {
  it('1-1 常规公式在预算内（含中文/矩阵/上下标/转义花括号）', () => {
    for (const ok of [
      'x',
      '\\frac{1}{2}',
      '\\lim_{n\\to\\infty} a_n',
      '\\begin{matrix} a & b \\\\ c & d \\end{matrix}',
      'f(x)=\\begin{cases} 1 & x>0 \\\\ 0 & x\\le 0 \\end{cases}',
      '\\{a,b\\}', // 转义花括号：不参与嵌套计数
      'y=\\left\\{\\frac{a}{b}\\right.',
      'a'.repeat(MAX_MATH_LATEX_LEN), // 恰好等于上限：放行
    ]) {
      expect(isMathLatexWithinBudget(ok), JSON.stringify(ok.slice(0, 30))).toBe(true)
    }
  })

  it('1-2 长度超预算 → 拒绝（审查 payload 12070 字符必然被拦）', () => {
    expect(isMathLatexWithinBudget('a'.repeat(MAX_MATH_LATEX_LEN + 1))).toBe(false)
    expect(isMathLatexWithinBudget(XSS_PAYLOAD)).toBe(false)
    expect(XSS_PAYLOAD.length).toBeGreaterThan(MAX_MATH_LATEX_LEN)
  })

  it('1-3 嵌套深度超预算 → 拒绝（实测 KaTeX 在 ~2500+ 层抛 RangeError）', () => {
    const deep = (n: number): string => '{'.repeat(n) + 'x' + '}'.repeat(n)
    expect(isMathLatexWithinBudget(deep(MAX_MATH_LATEX_DEPTH))).toBe(true)
    expect(isMathLatexWithinBudget(deep(MAX_MATH_LATEX_DEPTH + 1))).toBe(false)
    // 报告构造：6000 层
    expect(isMathLatexWithinBudget('{'.repeat(6000) + 'x' + '}'.repeat(6000))).toBe(false)
    // \frac 嵌套 1000（实测也抛 RangeError）同样被拦
    expect(isMathLatexWithinBudget('\\frac{'.repeat(1000) + '1' + '}'.repeat(1000))).toBe(false)
  })

  it('1-4 转义花括号不累计深度；未闭合花括号不误判', () => {
    // 2000 个 \{ 字面量：若把 \{ 计入深度会误判为超限
    expect(isMathLatexWithinBudget('\\{'.repeat(2000))).toBe(true)
    expect(isMathLatexWithinBudget('}'.repeat(5000))).toBe(true) // 只有闭合：深度夹到 0
    expect(isMathLatexWithinBudget('')).toBe(true)
  })

  it('1-5 回退展示/title 文本截断（完整原文仍可双击进编辑器查看）', () => {
    expect(fallbackDisplayText('x')).toBe('x')
    const long = 'a'.repeat(MAX_MATH_FALLBACK_DISPLAY)
    expect(fallbackDisplayText(long)).toBe(long)
    const over = 'a'.repeat(MAX_MATH_FALLBACK_DISPLAY + 1)
    expect(fallbackDisplayText(over)).toHaveLength(MAX_MATH_FALLBACK_DISPLAY + 1) // +1 = 省略号
    expect(fallbackDisplayText(over).endsWith('…')).toBe(true)
    expect(fallbackDisplayText(XSS_PAYLOAD)).toHaveLength(MAX_MATH_FALLBACK_DISPLAY + 1)
  })
})

// ------------------------------------------------------------- 2. 回退分支不得注入 HTML

describe('task-55 R06-2. 异常回退：DOM 里不得出现外部注入元素（硬断言）', () => {
  it('2-1 审查 payload（12070 字符）→ 纯文本回退：无 <img>、无 onerror 执行', async () => {
    await mount(`前文 $${XSS_PAYLOAD}$ 后文`)
    const math = document.querySelector('.ke-math') as HTMLElement
    expect(math).toBeTruthy()
    // 文档模型里确实是攻击 latex（证明 payload 真的到了 NodeView；math 是 atom，textContent 为空）
    let latexInDoc = ''
    harnessEditor?.state.doc.descendants((n) => {
      if (n.type.name === 'math') latexInDoc = (n.attrs.latex as string) ?? ''
      return true
    })
    expect(latexInDoc).toBe(XSS_PAYLOAD)
    expect(latexInDoc).toContain('<img src=x onerror=')
    // ① 不得注入 img / script 等元素
    expect(math.querySelectorAll('img').length).toBe(0)
    expect(math.querySelectorAll('script').length).toBe(0)
    expect(document.querySelectorAll('img').length).toBe(0)
    // 攻击串只允许以**转义文本**存在于文本节点 / 属性值中：不得成为元素
    const fallbackEl = math.querySelector('.ke-math-render--failed') as HTMLElement
    expect(fallbackEl.childElementCount).toBe(0)
    expect(fallbackEl.querySelectorAll('img,script,iframe,object,embed').length).toBe(0)
    expect(math.querySelectorAll('img,script,iframe,object,embed').length).toBe(0)
    // ② 不得执行 onerror
    expect((document.documentElement as HTMLElement).dataset.keXss).toBeUndefined()
    // ③ 回退态标记 + 纯文本可见（用户仍能看到原文/双击编辑）
    const fallback = math.querySelector('[data-ke-math-fallback]') as HTMLElement
    expect(fallback).toBeTruthy()
    expect(fallback.textContent ?? '').toContain('{')
    expect(fallback.getAttribute('title') ?? '').toContain('公式无法渲染')
  })

  it('2-2 回退文本是 React 文本节点（textContent 有值、无子元素）', async () => {
    await mount(`$${XSS_PAYLOAD}$`)
    const fallback = document.querySelector('[data-ke-math-fallback]') as HTMLElement
    expect(fallback).toBeTruthy()
    expect(fallback.childElementCount).toBe(0) // 纯文本，无元素子节点
    expect((fallback.textContent ?? '').length).toBeGreaterThan(0)
    expect((fallback.textContent ?? '').length).toBeLessThanOrEqual(MAX_MATH_FALLBACK_DISPLAY + 1)
  })

  it('2-3 源码级回归点：dangerouslySetInnerHTML 只允许接 KaTeX 输出（html），不得再接 latex', () => {
    const src = readFileSync(join(__dirname, 'MathNodeView.tsx'), 'utf8')
    // 修复前的那一行必须已消失
    expect(src).not.toMatch(/dangerouslySetInnerHTML=\{\{\s*__html:\s*renderFailed\s*\?/)
    // 仍保留（仅用于 KaTeX 输出）
    expect(src).toMatch(/dangerouslySetInnerHTML=\{\{\s*__html:\s*html\s*\}\}/)
    // 超预算不得进入 KaTeX
    expect(src).toMatch(/if\s*\(withinBudget\)/)
  })

  it('2-5 task-66/I4 回退容器必须声明正常排版（不得逐字一行/宽度塌陷）', async () => {
    await mount(`$${XSS_PAYLOAD}$`)
    const fb = document.querySelector('[data-ke-math-fallback]') as HTMLElement
    expect(fb).toBeTruthy()
    const s = fb.style
    expect(s.display, '回退容器显式块级').toBe('block')
    expect(s.maxWidth, '不得溢出正文列').toBe('100%')
    expect(s.whiteSpace, '保留原文换行').toBe('pre-wrap')
    expect(s.wordBreak).toBe('break-word')
    expect(s.overflowWrap, '极长无空格片段任意位置断开').toBe('anywhere')
    // 回退文本不得逐字插入换行（逐字一行在 DOM 层的形态就是"每个字符后跟 \n"）
    const t = fb.textContent ?? ''
    expect(t.length).toBeGreaterThan(1)
    expect(/\S\n\S\n\S/.test(t), `文本被逐字拆行：${JSON.stringify(t.slice(0, 30))}`).toBe(false)
  })

  it('2-4 超预算 + 超长原文：title 自身也被截断（不把 12KB 原文塞进属性）', async () => {
    await mount(`$${XSS_PAYLOAD}$`)
    const fallback = document.querySelector('[data-ke-math-fallback]') as HTMLElement
    const title = fallback.getAttribute('title') ?? ''
    expect(title).toContain('公式无法渲染')
    expect(title.length).toBeLessThanOrEqual(64 + MAX_MATH_FALLBACK_TITLE + 1)
    expect(fallbackTitle(XSS_PAYLOAD).endsWith('…')).toBe(true)
    expect(fallbackTitle('x')).toContain('x')
  })
})

// ------------------------------------------------------------- 3. 常见失败不回归

describe('task-55 R06-3. 对照：KaTeX 语法错误仍走 KaTeX 自带 error span', () => {
  it('3-1 \\frac{1}{ → katex-error span（不是纯文本回退）', async () => {
    await mount('公式 $\\frac{1}{$ 之后')
    const math = document.querySelector('.ke-math') as HTMLElement
    expect(math.querySelectorAll('.katex-error').length).toBe(1)
    expect(math.querySelector('[data-ke-math-fallback]')).toBeNull()
  })

  it('3-2 正常公式照常渲染（无回退、无 error）', async () => {
    await mount('公式 $x^2+y^2=z^2$ 之后')
    const math = document.querySelector('.ke-math') as HTMLElement
    expect(math.querySelectorAll('.katex').length).toBe(1)
    expect(math.querySelector('[data-ke-math-fallback]')).toBeNull()
    expect(math.querySelector('.ke-math-render')?.getAttribute('data-ke-math-fallback')).toBeNull()
  })

  it('3-3 回退态仍可双击进入编辑器（派发 MATH_EDIT_EVENT）', async () => {
    const { MATH_EDIT_EVENT } = await import('./MathNodeView')
    await mount(`$${XSS_PAYLOAD}$`)
    const seen: unknown[] = []
    const onEdit = (e: Event): void => {
      seen.push((e as CustomEvent).detail)
    }
    window.addEventListener(MATH_EDIT_EVENT, onEdit)
    try {
      await act(async () => {
        document
          .querySelector('[data-ke-math-fallback]')!
          .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      })
      expect(seen).toHaveLength(1)
      expect((seen[0] as { latex: string }).latex).toBe(XSS_PAYLOAD)
    } finally {
      window.removeEventListener(MATH_EDIT_EVENT, onEdit)
    }
  })
})
