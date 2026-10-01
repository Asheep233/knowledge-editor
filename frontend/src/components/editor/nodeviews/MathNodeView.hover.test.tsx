/**
 * task-52：公式悬浮工具条的**布局不变量**（用户在「数学分析习题 Week 3 Day 2」实测的两处 UI bug）。
 *
 * Bug A：行末公式 hover 漂移。根因 = ✏️/🗑/⋮ 三个按钮此前直接平铺在 `.ke-math` 里，
 *        是**在流内的 inline 元素**（`display:none` → `.ke-math:hover` 时 `inline-block`），
 *        显示时给公式节点加了约 72px 宽度 → 行末放不下 → 整块回流到下一行。移开又收回 = 漂移。
 *        修法 = 三个按钮收进**绝对定位**容器 `.ke-math-tools`：hover/选中只切容器可见性，
 *        公式自身占位宽高恒定。
 * Bug B：`2.` 右侧有看不见的块挡住光标。Chromium 实测根因 = ⋮ 菜单的「点击外部关闭」遮罩
 *        `span.fixed.inset-0.z-40`（1280×900，不吃 `pointer-events`）——菜单打开时
 *        `elementFromPoint(正文)` 命中的就是它。修法 = 遮罩改 `pointer-events:none`（点击穿透），
 *        关闭动作改由 MathNodeView 的 document 捕获监听（mousedown/touchstart，菜单内按下不关）。
 *        另：未 hover 时工具条不得留下任何占位/可点空壳。
 *
 * happy-dom 不做布局（rect 恒为 0），因此本文件分四层锁死：
 *   1) 结构层：按钮只能经 `.ke-math-tools` 到达（`ke-math` 的直接子元素里不得再出现按钮）；
 *              菜单遮罩必须是 `.ke-math-more-overlay`（不得回到吃点击的 `fixed inset-0`）
 *   2) 样式层：`index.css` 里 `.ke-math-tools` 必须是 `position:absolute` + `display:none`，
 *              hover/选中规则只切**容器**的 display；遮罩必须 `pointer-events:none`
 *   3) 布局层：声明式布局模型（宽度只由「非绝对定位的流内子元素」累加，与浏览器一致）
 *              → 断言 hover 前后公式流内宽度（即 rect.w）**完全不变**，
 *              并用 pre-fix 构成反证「模型对回归敏感」
 *   4) 行为层：三个按钮仍可点（✏️ 派发编辑事件 / 🗑 删节点 / ⋮ 开合菜单 + 菜单项仍执行）
 * 真实浏览器（Chromium 真实 Editor + 真实扩展 + 真实 index.css）的 rect/elementFromPoint
 * 实测见 task-52 回报（基线 1280×900，正文列 780px）。
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
import { MathBlockExtension } from '../../../editor/extensions/MathBlockExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from '../../../editor/extensions/TableMarkdownExtension'
import { MATH_EDIT_EVENT } from './MathNodeView'
import { MATH_CONVERT_EVENT } from '../../../editor/math/convert'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EXTENSIONS = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  MathExtension,
  MathBlockExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

const CSS_PATH = join(__dirname, '../../../index.css')
const CSS_TEXT = readFileSync(CSS_PATH, 'utf8')

/** 解析 index.css 里的规则块（happy-dom 会级联 style 标签，故断言用真实样式表） */
function ruleBodies(selector: string): string[] {
  const clean = CSS_TEXT.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const chunk of clean.split('}')) {
    const i = chunk.indexOf('{')
    if (i < 0) continue
    const selectors = chunk
      .slice(0, i)
      .split(',')
      .map((x) => x.replace(/[\s\n\r]+/g, ' ').trim())
      .filter(Boolean)
    if (selectors.includes(selector)) out.push(chunk.slice(i + 1))
  }
  return out
}

/** 注入真实样式表（去掉 Tailwind 指令，happy-dom 不认） */
function injectRealCss(): void {
  const style = document.createElement('style')
  style.textContent = CSS_TEXT.replace(/@import[^;]+;/g, '').replace(/@theme[^{]*\{[^}]*\}/g, '')
  document.head.appendChild(style)
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let harnessEditor: Editor | null = null

function Harness({ content }: { content: string }) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'ke-editor-prose' } },
  })
  useEffect(() => {
    harnessEditor = editor ?? null
  }, [editor])
  return React.createElement(EditorContent, { editor })
}

async function mount(content: string): Promise<void> {
  if (root) {
    const prev = root
    root = null
    await act(async () => prev.unmount())
    harnessEditor = null
    document.body.innerHTML = ''
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  const r = createRoot(container)
  root = r
  await act(async () => {
    r.render(React.createElement(Harness, { content }))
  })
  // 等 ProseMirror 首帧渲染完成（列表/表格场景首帧更慢）
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('.ke-math')) break
    await new Promise((r) => setTimeout(r, 20))
  }
  await new Promise((r) => setTimeout(r, 30))
}

const mathEl = (): HTMLElement => document.querySelector('.ke-math') as HTMLElement
const toolsEl = (): HTMLElement => document.querySelector('.ke-math-tools') as HTMLElement
const btn = (cls: string): HTMLElement => document.querySelector(`.${cls}`) as HTMLElement

/**
 * 声明式布局模型：宽度 = 各**流内**子元素宽度累加（`position:absolute|fixed` 的子元素不参与）——
 * 这是浏览器 inline 布局的实际语义：绝对定位元素对父级占位零贡献。
 * happy-dom 不做布局，故这里只建模“谁参与流内宽度”，公式渲染体宽度按真实测量值给常数
 * （Chromium 实测 `.ke-math-render` = 122.06px，见 task-52 回报）。
 */
const RENDER_WIDTH = 122
const TOOLS_WIDTH = 72.2 // ✏️ + 🗑 + ⋮ 实测 72.2px（Chromium；不含容器外 4px 间距）

interface FlowChild {
  cls: string
  position: string
  width: number
}

/** 从真实样式表取 .ke-math-tools 的 position（已级联）；分号声明直接解析 */
function toolsPositionFromCss(): string {
  const bodies = ruleBodies('.ke-math-tools').join(';')
  const m = /position\s*:\s*([a-z-]+)/.exec(bodies)
  return m ? m[1] : 'static'
}

/** 用容器内所有“非绝对定位”子元素累加 → 公式流内宽度 */
function flowWidth(children: FlowChild[]): number {
  return children.filter((c) => c.position !== 'absolute' && c.position !== 'fixed').reduce((a, c) => a + c.width, 0)
}

/** 修复前的子元素构成（三个按钮直接在流内，各 24.07px + margin-left 3px）—— 仅用于证明本模型能识别该回归 */
function preFixChildren(): FlowChild[] {
  const perButton = TOOLS_WIDTH / 3 // 修复前每个按钮 ≈24.07px 宽 + 3px margin-left，三个合计 72.2px
  return [
    { cls: 'ke-math-render', position: 'static', width: RENDER_WIDTH },
    { cls: 'ke-math-edit-btn', position: 'static', width: perButton },
    { cls: 'ke-math-del-btn', position: 'static', width: perButton },
    { cls: 'ke-math-more-btn', position: 'static', width: perButton },
  ]
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  document.head.querySelectorAll('style').forEach((s) => s.remove())
  harnessEditor?.destroy()
  harnessEditor = null
  container = null
})

// ------------------------------------------------------------------ 1. 结构层

describe('task-52 1. 结构：三个按钮必须收在 .ke-math-tools 容器内（脱离公式流）', () => {
  it('1-1 行内公式：ke-math 的直接子元素里不存在任何按钮（按钮只能经工具条容器到达）', async () => {
    await mount('前文 $x^2+y^2=z^2$ 后文')
    const math = mathEl()
    const directBtnClasses = (el: HTMLElement): string[] =>
      (Array.from(el.children) as HTMLElement[])
        .map((c) => c.className)
        .filter((c) => /ke-math-(edit|del|more)-btn/.test(c))
    expect(directBtnClasses(math)).toEqual([]) // 回归点：按钮不得再是公式的直接子元素
    const tools = toolsEl()
    expect(tools).toBeTruthy()
    expect(tools.parentElement).toBe(math)
    expect(Array.from(tools.children).map((c) => c.className)).toEqual([
      'ke-math-edit-btn',
      'ke-math-del-btn',
      'ke-math-more-btn',
    ])
    // 三个按钮都在同一个容器里 → 只有一个“整体”被显隐
    expect(tools.querySelectorAll('.ke-math-edit-btn,.ke-math-del-btn,.ke-math-more-btn')).toHaveLength(3)
  })

  it('1-2 块级公式：同一容器结构（工具条挂在块级公式下方，不参与公式自身占位）', async () => {
    await mount('$$\n\\int_0^1 x\\,dx\n$$')
    const math = mathEl()
    expect(math.className).toContain('ke-math--block')
    const direct = (Array.from(math.children) as HTMLElement[]).map((c) => c.className)
    expect(direct.filter((c) => /ke-math-(edit|del|more)-btn/.test(c))).toEqual([])
    expect(toolsEl().parentElement).toBe(math)
  })

  it('1-3 列表项内 / 表格单元格内公式：结构一致（行末/行首/段中/列表/表格统一收口）', async () => {
    await mount('- 第一项 $a$，第二项 $b$\n\n| 列1 | 列2 |\n| --- | --- |\n| $c$ | $d$ |')
    const mathNodes = Array.from(document.querySelectorAll('.ke-math')) as HTMLElement[]
    expect(mathNodes.length).toBeGreaterThanOrEqual(3)
    for (const m of mathNodes) {
      const classes = (Array.from(m.children) as HTMLElement[]).map((c) => c.className)
      expect(classes.filter((c) => /ke-math-(edit|del|more)-btn/.test(c))).toEqual([])
      const tools = m.querySelector('.ke-math-tools') as HTMLElement
      expect(tools.parentElement).toBe(m)
    }
    // 列表项内公式（行末）也确实带工具条容器
    const liMath = document.querySelector('li .ke-math') as HTMLElement
    expect(liMath).toBeTruthy()
    expect((liMath.querySelector('.ke-math-tools') as HTMLElement).parentElement).toBe(liMath)
  })
})

// ------------------------------------------------- 1b. Bug B：遮罩不得拦截点击

describe('task-52 1b. Bug B：⋮ 菜单遮罩不得成为「看不见的块」', () => {
  it('1b-1 菜单打开时遮罩存在，但不参与命中测试（pointer-events:none）', async () => {
    injectRealCss()
    await mount('前文 $x$ 后文')
    await act(async () => {
      btn('ke-math-more-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(btn('ke-math-more-btn').getAttribute('aria-expanded')).toBe('true')
    const overlay = document.querySelector('.ke-math-more-overlay') as HTMLElement
    expect(overlay).toBeTruthy()
    // 真实样式表级联：fixed inset-0 + pointer-events:none（点击穿透，正文光标可落）
    const cs = getComputedStyle(overlay)
    expect(cs.position).toBe('fixed')
    expect(cs.pointerEvents).toBe('none')
    // 回归点：不得再出现吃点击的 `fixed inset-0` 遮罩
    const cssOverlay = ruleBodies('.ke-math-more-overlay').join(';')
    expect(cssOverlay).toMatch(/pointer-events:\s*none/)
    expect(cssOverlay).toMatch(/position:\s*fixed/)
    expect(cssOverlay).toMatch(/inset:\s*0/)
  })

  it('1b-2 菜单打开后点正文（文档捕获监听）→ 菜单关闭，事件不被吞', async () => {
    injectRealCss()
    await mount('前文 $x$ 后文')
    await act(async () => {
      btn('ke-math-more-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(btn('ke-math-more-btn').getAttribute('aria-expanded')).toBe('true')
    // 模拟用户点正文：mousedown 在 document 捕获阶段监听 → 关菜单
    let reachedTarget = false
    document.body.addEventListener('mousedown', () => {
      reachedTarget = true
    })
    await act(async () => {
      document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(reachedTarget).toBe(true) // 事件未被吞
    expect(btn('ke-math-more-btn').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-testid="math-more-menu"]')).toBeNull()
  })

  it('1b-2b 菜单内按下（mousedown 在 .ke-math 内）→ 菜单不提前关闭，菜单项仍可执行', async () => {
    const converted: unknown[] = []
    await mount('前文 $x$ 后文')
    const onConvert = (e: Event): void => {
      converted.push((e as CustomEvent).detail)
    }
    window.addEventListener(MATH_CONVERT_EVENT, onConvert)
    try {
      await act(async () => {
        btn('ke-math-more-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      const menu = document.querySelector('[data-testid="math-more-menu"]') as HTMLElement
      expect(menu).toBeTruthy()
      const item = document.querySelector('[data-testid="math-convert-block"]') as HTMLElement
      expect(item).toBeTruthy()
      // 真实指针序：mousedown（捕获阶段先于 click）→ click
      await act(async () => {
        item.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      })
      // 关键回归点：菜单内按下不得关闭菜单（否则菜单项 click 永不执行）
      expect(document.querySelector('[data-testid="math-more-menu"]')).toBeTruthy()
      await act(async () => {
        item.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    } finally {
      window.removeEventListener(MATH_CONVERT_EVENT, onConvert)
    }
    expect(converted).toHaveLength(1)
    expect(converted[0]).toMatchObject({ isBlock: false, to: 'block' })
    expect(document.querySelector('[data-testid="math-more-menu"]')).toBeNull() // 点击后关闭
  })

  it('1b-3 遮罩自身不带 onClick 拦截（结构回归点：旧实现是吃点击的 span）', () => {
    const src = readFileSync(join(__dirname, 'MathNodeView.tsx'), 'utf8')
    expect(src).not.toMatch(/className="fixed inset-0 z-40"/)
    expect(src).toContain('ke-math-more-overlay')
    expect(src).toContain("document.addEventListener('mousedown', close, true)")
  })
})

// ------------------------------------------------------------------ 2. 样式层

describe('task-52 2. 样式：工具条容器绝对定位 + 未 hover 不占位', () => {
  it('2-1 .ke-math-tools 声明 position:absolute 且默认 display:none', () => {
    const bodies = ruleBodies('.ke-math-tools')
    expect(bodies.length).toBeGreaterThan(0)
    const base = bodies.join('\n')
    expect(base).toMatch(/position:\s*absolute/)
    expect(base).toMatch(/display:\s*none/)
  })

  it('2-2 hover / 选中 / 菜单展开只切换容器可见性，不触碰按钮自身占位', () => {
    const hoverRule = ruleBodies('.ke-math:hover .ke-math-tools').join('\n')
    const selectedRule = ruleBodies('.ProseMirror-selectednode > .ke-math .ke-math-tools').join('\n')
    expect(hoverRule).toMatch(/display:\s*flex/)
    expect(selectedRule).toMatch(/display:\s*flex/)
    // 回归点：绝不能再出现「直接作用于按钮的 hover display」规则
    for (const sel of [
      '.ke-math:hover .ke-math-edit-btn',
      '.ke-math:hover .ke-math-del-btn',
      '.ke-math:hover .ke-math-more-btn',
      '.ProseMirror-selectednode > .ke-math .ke-math-edit-btn',
      '.ProseMirror-selectednode > .ke-math .ke-math-del-btn',
      '.ProseMirror-selectednode > .ke-math .ke-math-more-btn',
    ]) {
      const bodies = ruleBodies(sel)
      for (const b of bodies) expect(b).not.toMatch(/display:\s*(inline-block|flex|block)/)
    }
  })

  it('2-3 菜单展开态（aria-expanded=true）只让容器内的 ⋮ 保持可见', () => {
    const rule = ruleBodies(".ke-math .ke-math-more-btn[aria-expanded='true']").join('\n')
    expect(rule).toMatch(/display:\s*inline-flex/)
  })

  it('2-4 真实样式表级联到 DOM：未 hover 时工具条容器为 absolute 且 display:none（不占位）', async () => {
    injectRealCss()
    await mount('前文 $x$ 后文')
    const tools = toolsEl()
    const cs = getComputedStyle(tools)
    expect(cs.position).toBe('absolute')
    expect(cs.display).toBe('none')
  })
})

// ------------------------------------------------------------------ 3. 布局层（rect 不变量）

describe('task-52 3. 布局：「显示工具条」不得改变公式自身占位宽高（Bug A 硬断言）', () => {
  it('3-1 未 hover：工具条容器 display:none 且不在流内 → 公式流内宽度只含渲染体', async () => {
    injectRealCss()
    await mount('前文 $x^2+y^2=z^2$ 后文')
    const math = mathEl()
    const tools = toolsEl()
    // 真实样式表级联结果
    expect(getComputedStyle(tools).position).toBe('absolute')
    expect(getComputedStyle(tools).display).toBe('none')
    // DOM 结构 → 流内子元素只有渲染体
    const children: FlowChild[] = (Array.from(math.children) as HTMLElement[]).map((c) => ({
      cls: c.className,
      position: getComputedStyle(c).position,
      width: c.classList.contains('ke-math-render') ? RENDER_WIDTH : TOOLS_WIDTH,
    }))
    expect(children.filter((c) => c.position !== 'absolute').map((c) => c.cls)).toEqual(['ke-math-render'])
    expect(flowWidth(children)).toBe(RENDER_WIDTH)
  })

  it('3-2 hover 显隐工具条前后，公式自身占位（渲染体宽度）完全不变', async () => {
    injectRealCss()
    await mount('前文 $x^2+y^2=z^2$ 后文')
    const math = mathEl()
    const tools = toolsEl()
    const render = math.querySelector('.ke-math-render') as HTMLElement
    // 公式自身占位 = 渲染体宽度（KaTeX 输出决定，与工具条无关）
    const widthOf = (node: HTMLElement): number => {
      const w = node.getBoundingClientRect().width
      return w > 0 ? w : node.classList.contains('ke-math-render') ? RENDER_WIDTH : TOOLS_WIDTH
    }
    const renderWidth = (): number => widthOf(render)

    const before = renderWidth()
    expect(before).toBe(RENDER_WIDTH)
    // 模拟 :hover（happy-dom 不匹配伪类）——只切容器可见性，不动公式任何布局属性
    tools.style.display = 'flex'
    const during = renderWidth()
    // 按钮的出现不得给公式节点增加任何宽度（pre-fix：公式宽度 122.06 → 194.27）
    expect(during).toBe(before)
    // 公式节点的流内宽度 = 渲染体（工具条 absolute，不参与）
    const flowChildren: FlowChild[] = (Array.from(math.children) as HTMLElement[]).map((c) => ({
      cls: c.className,
      position: getComputedStyle(c).position,
      width: widthOf(c),
    }))
    expect(flowWidth(flowChildren)).toBe(RENDER_WIDTH)
    tools.style.display = 'none'
    expect(renderWidth()).toBe(RENDER_WIDTH)

    // 反证：pre-fix 构成会让「公式流内宽度」多出 ~72px —— 模型对回归敏感
    const preFix = flowWidth(preFixChildren())
    expect(preFix - RENDER_WIDTH).toBeCloseTo(TOOLS_WIDTH, 1)
    expect(preFix).not.toBe(flowWidth(flowChildren))
  })

  it('3-3 行末公式：公式宽度恒定 → 回流换行只由公式本身决定（与工具条宽度无关）', () => {
    // 正文列 780px（index.css .ke-editor-prose max-width，Chromium 实测同值）
    const COLUMN = 780
    const LINE_LEFT = 100
    const available = COLUMN - (LINE_LEFT + RENDER_WIDTH) // 行末剩余可放宽度
    expect(available).toBeGreaterThan(0)
    // 工具条（76px）只可能“盖”在右侧空白/边缘上，绝不参与公式占位
    expect(RENDER_WIDTH + TOOLS_WIDTH).toBeLessThan(COLUMN)
    // pre-fix：公式占位 = 122 + 72.2 = 194.2（Chromium 实测 194.27）→ 行末放不下就换行
    const preFixWidth = RENDER_WIDTH + TOOLS_WIDTH
    expect(preFixWidth).toBeGreaterThan(RENDER_WIDTH)
    expect(toolsPositionFromCss()).toBe('absolute')
  })

  it('3-4 未 hover 时不存在占据布局空间的工具条容器（Bug B：不留可点空壳）', async () => {
    injectRealCss()
    await mount('1. $J(A,L(A))=L(A)\\cap U(L(A))$')
    const math = mathEl()
    const tools = toolsEl()
    const children: FlowChild[] = (Array.from(math.children) as HTMLElement[]).map((c) => ({
      cls: c.className,
      position: getComputedStyle(c).position,
      width: c.classList.contains('ke-math-render') ? RENDER_WIDTH : TOOLS_WIDTH,
    }))
    // 未 hover：容器 display:none + absolute ⇒ 既不可点、也不占位
    expect(getComputedStyle(tools).display).toBe('none')
    expect(getComputedStyle(tools).position).toBe('absolute')
    expect(flowWidth(children)).toBe(RENDER_WIDTH)
    expect(children.some((c) => /ke-math-(edit|del|more)-btn/.test(c.cls))).toBe(false)
  })
})

// ------------------------------------------------------------------ 4. 行为层（按钮仍可点）

describe('task-52 4. 行为：按钮仍在同一容器内且回调照常触发', () => {
  it('4-1 ✏️ 编辑按钮：点击派发 MATH_EDIT_EVENT（带 latex/id/isBlock）', async () => {
    await mount('前文 $E=mc^2$ 后文')
    const seen: unknown[] = []
    const onEdit = (e: Event): void => {
      seen.push((e as CustomEvent).detail)
    }
    window.addEventListener(MATH_EDIT_EVENT, onEdit)
    try {
      const edit = btn('ke-math-edit-btn')
      expect(edit).toBeTruthy()
      expect(toolsEl().contains(edit)).toBe(true)
      await act(async () => {
        edit.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ latex: 'E=mc^2', isBlock: false })
    } finally {
      window.removeEventListener(MATH_EDIT_EVENT, onEdit)
    }
  })

  it('4-2 🗑 删除按钮：点击删除该公式节点（文档里不再有 math）', async () => {
    await mount('前文 $x$ 后文')
    expect(document.querySelectorAll('.ke-math').length).toBe(1)
    await act(async () => {
      btn('ke-math-del-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(document.querySelectorAll('.ke-math').length).toBe(0)
    expect(harnessEditor?.state.doc.textContent ?? '').not.toContain('$')
  })

  it('4-3 ⋮ 更多按钮：点击开合菜单（aria-expanded + 菜单挂载）', async () => {
    injectRealCss()
    await mount('前文 $x$ 后文')
    const more = btn('ke-math-more-btn')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-testid="math-more-menu"]')).toBeNull()
    await act(async () => {
      more.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(btn('ke-math-more-btn').getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-testid="math-more-menu"]')).toBeTruthy()
    // 收起
    await act(async () => {
      btn('ke-math-more-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(btn('ke-math-more-btn').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-testid="math-more-menu"]')).toBeNull()
  })

  it('4-4 容器内三个按钮顺序稳定（✏️ / 🗑 / ⋮），且都不在公式渲染体内', async () => {
    await mount('前文 $x$ 后文')
    const tools = toolsEl()
    expect(Array.from(tools.children).map((c) => (c as HTMLElement).className)).toEqual([
      'ke-math-edit-btn',
      'ke-math-del-btn',
      'ke-math-more-btn',
    ])
    const render = document.querySelector('.ke-math-render') as HTMLElement
    for (const c of ['ke-math-edit-btn', 'ke-math-del-btn', 'ke-math-more-btn']) {
      expect(render.contains(btn(c))).toBe(false)
    }
  })
})
