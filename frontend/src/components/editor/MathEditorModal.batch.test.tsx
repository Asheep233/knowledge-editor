/**
 * task-63：第三份外部独立审查（v1.2.9 @ 98b525e）公式编辑批次 —— **真实 DOM 事件**用例。
 *
 * 覆盖：
 *  - **A08** 关闭公式自动补全后，焦点从「完成」回到 textarea，候选与 Tab 补全**不得**回来
 *  - **A09** 候选菜单提示「Esc 关闭」，实际却把不完整 `\fr` 保存并退出模态（语义待裁）
 *  - **A10** 模态预览必须与显示节点**共用** 10,000 字符 / 512 层预算，超限给明确提示而非全量渲染
 *  - **A11** 模板插入后光标落在**新**模板的槽（接线层；纯函数见 `editor/math/slots.a11.test.ts`）
 *
 * 既有契约守护（不得回退）：补全开启时 Tab 仍补全、候选 ↑↓ 仍切换、Esc（无候选）仍保存、
 * 空公式不写盘、清空有内容公式仍先确认。
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MathEditorModal from './MathEditorModal'
import { PromptRoot } from '../common/PromptDialog'
import { loadSettings, saveSettings } from '../../settings'
import { MAX_MATH_LATEX_DEPTH, MAX_MATH_LATEX_LEN } from '../../editor/math/budget'
import { SLOT_CHAR } from '../../editor/math/templates'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement
let saved: string[] = []
let deleted = 0
let closed = 0

const textarea = (): HTMLTextAreaElement => document.querySelector('textarea') as HTMLTextAreaElement
const suggestionMenu = (): HTMLElement | null =>
  ([...document.querySelectorAll('div')].find((d) => (d.textContent ?? '').includes('↑↓ 切换')) as HTMLElement) ?? null
const buttonByText = (t: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) as HTMLButtonElement | undefined

/** React 受控/非受控 textarea：必须走原生 value setter 再派发 input 才会触发 React onInput */
function typeInto(t: HTMLTextAreaElement, value: string, caret?: number): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(t, value)
  t.setSelectionRange(caret ?? value.length, caret ?? value.length)
  t.dispatchEvent(new window.Event('input', { bubbles: true }))
}

function pressKey(key: string, init: KeyboardEventInit = {}): void {
  const t = textarea()
  t.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

async function mount(initialValue: string, isBlock = false): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  const r = createRoot(container)
  root = r
  await act(async () => {
    r.render(
      // 与真实应用一致：PromptRoot（含 PromptHost）挂在根层，模态是 portal
      React.createElement(
        PromptRoot,
        null,
        React.createElement(MathEditorModal, {
          open: true,
          initialValue,
          isBlock,
          onSave: (v: string) => saved.push(v),
          onDeleteEmpty: () => {
            deleted += 1
          },
          onClose: () => {
            closed += 1
          },
        }),
      ),
    )
  })
  await act(async () => {
    await new Promise((res) => setTimeout(res, 30))
  })
}

beforeEach(async () => {
  saved = []
  deleted = 0
  closed = 0
  document.body.innerHTML = ''
  await loadSettings() // 缓存重置为默认（含 mathAutocomplete: true）
})

afterEach(async () => {
  if (root) {
    const r = root
    root = null
    await act(async () => r.unmount())
  }
  document.body.innerHTML = ''
  await saveSettings({ editor: { mathAutocomplete: true } })
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────── A08

describe('task-63 A08：关闭自动补全后，回焦不得再弹候选、Tab 不得再补全', () => {
  it('A08-1 补全关闭：输入 \\fr → 焦点移到「完成」再回 textarea → 候选不得出现；Tab 不得补全', async () => {
    await saveSettings({ editor: { mathAutocomplete: false } })
    await mount('')
    const t = textarea()
    await act(async () => {
      typeInto(t, '\\fr')
    })
    expect(suggestionMenu(), '输入阶段：补全关闭时不得弹候选').toBeNull()

    // 真实焦点流转：textarea → 「完成」按钮 → textarea（审查复现路径）
    await act(async () => {
      buttonByText('完成')!.focus()
      await new Promise((res) => setTimeout(res, 260)) // 越过 onBlur 的 200ms 延迟关闭
    })
    await act(async () => {
      t.focus()
      await new Promise((res) => setTimeout(res, 30))
    })
    expect(suggestionMenu(), '回焦后候选仍出现 = A08 缺陷').toBeNull()

    // Tab：补全关闭时不得把 \fr 变成 \frac{}{}（应走槽位跳转或无事发生）
    await act(async () => {
      pressKey('Tab')
    })
    expect(t.value, 'Tab 不得在补全关闭时做补全').toBe('\\fr')
  })

  it('A08-2 契约守护：补全**开启**时，同样的回焦流程仍弹候选且 Tab 仍补全', async () => {
    await saveSettings({ editor: { mathAutocomplete: true } })
    await mount('')
    const t = textarea()
    await act(async () => {
      typeInto(t, '\\fr')
    })
    expect(suggestionMenu(), '补全开启：输入后应弹候选').not.toBeNull()
    await act(async () => {
      buttonByText('完成')!.focus()
      await new Promise((res) => setTimeout(res, 260))
    })
    await act(async () => {
      t.focus()
      await new Promise((res) => setTimeout(res, 30))
    })
    expect(suggestionMenu(), '补全开启：回焦后候选应仍在（既有语义）').not.toBeNull()
    await act(async () => {
      pressKey('Tab')
    })
    expect(t.value, '补全开启：Tab 必须补全为模板骨架').toContain('\\frac')
  })
})

// ─────────────────────────────────────────────────────────── A09

describe('task-63 A09：候选打开时的 Esc 语义（待裁：本用例锁定「只关候选」方案）', () => {
  it('A09-1 候选打开时按 Esc：只关候选，**不保存、不退出模态**（不完整 \\fr 不得入库）', async () => {
    await mount('')
    const t = textarea()
    await act(async () => {
      typeInto(t, '\\fr')
    })
    expect(suggestionMenu()).not.toBeNull()

    await act(async () => {
      pressKey('Escape')
      await new Promise((res) => setTimeout(res, 30))
    })
    expect(saved, 'Esc 关候选不得提交公式（审查实测此处把 \\fr 写进了文档）').toEqual([])
    expect(closed, 'Esc 关候选不得关闭整个模态').toBe(0)
    expect(suggestionMenu(), '候选应被关闭').toBeNull()
    // 模态仍在：textarea 仍在文档里
    expect(document.querySelector('textarea')).toBeTruthy()
  })

  it('A09-2 契约守护：候选关闭后再按 Esc = 既有语义（保存并退出）', async () => {
    await mount('')
    const t = textarea()
    await act(async () => {
      typeInto(t, 'x^2')
    })
    expect(suggestionMenu()).toBeNull()
    await act(async () => {
      pressKey('Escape')
      await new Promise((res) => setTimeout(res, 30))
    })
    expect(saved).toEqual(['x^2'])
    expect(closed).toBe(1)
  })

  it('A09-6 选项 1 的完整语义：候选开 → 第 1 次 Esc 只关候选；第 2 次 Esc 才走既有「保存并退出」', async () => {
    await mount('')
    const t = textarea()
    await act(async () => {
      typeInto(t, '\\fr')
    })
    expect(suggestionMenu()).not.toBeNull()
    await act(async () => {
      pressKey('Escape')
      await new Promise((res) => setTimeout(res, 20))
    })
    expect(saved, '第 1 次 Esc：只关候选').toEqual([])
    expect(closed).toBe(0)
    expect(suggestionMenu()).toBeNull()
    await act(async () => {
      pressKey('Escape')
      await new Promise((res) => setTimeout(res, 30))
    })
    expect(saved, '第 2 次 Esc：走既有保存语义（此为用户明确选择 Option 1 的代价）').toEqual(['\\fr'])
    expect(closed).toBe(1)
  })

  it('A09-4 IME 组合态按 Esc：不得提交、不得退出（审查补充发现 · 组合态 Esc 仍提交）', async () => {
    await mount('x+1')
    // 真实输入法组词态：keydown 带 isComposing=true（并覆盖 keyCode=229 变体）
    await act(async () => {
      const t = textarea()
      const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'isComposing', { value: true })
      t.dispatchEvent(ev)
      await new Promise((res) => setTimeout(res, 30))
    })
    expect(saved, '组合态 Esc 不得提交公式（应交由输入法处理）').toEqual([])
    expect(closed, '组合态 Esc 不得退出模态').toBe(0)
    expect(document.querySelector('textarea'), '模态必须仍在').toBeTruthy()
  })

  it('A09-5 IME 组合态（keyCode=229 变体）按 Esc：同样不得提交/退出', async () => {
    await mount('y^2')
    await act(async () => {
      const t = textarea()
      const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'keyCode', { value: 229 })
      t.dispatchEvent(ev)
      await new Promise((res) => setTimeout(res, 30))
    })
    expect(saved).toEqual([])
    expect(closed).toBe(0)
  })

  it('A09-3 契约守护：候选打开时按 Tab 仍补全（不得因 Esc 改动而回归）', async () => {
    await mount('')
    const t = textarea()
    await act(async () => {
      typeInto(t, '\\fr')
    })
    await act(async () => {
      pressKey('Tab')
    })
    expect(t.value).toContain('\\frac')
  })
})

// ─────────────────────────────────────────────────────────── A10

describe('task-63 A10：模态预览与显示节点共用预算，超限降级并给明确提示', () => {
  it('A10-1 12,001 字符公式：不得全量渲染（无 KaTeX 输出）+ 必须给预算提示 + 耗时有上界', async () => {
    const long = 'a'.repeat(MAX_MATH_LATEX_LEN + 2001) // 12001 字符（审查同款）
    const t0 = Date.now()
    await mount(long)
    const elapsed = Date.now() - t0

    expect(document.querySelectorAll('.katex').length, '超预算不得生成 KaTeX DOM').toBe(0)
    const previewBox = [...document.querySelectorAll('div')].find((d) =>
      (d.textContent ?? '').includes('渲染预览'),
    ) as HTMLElement
    expect(previewBox).toBeTruthy()
    expect(previewBox.textContent ?? '', '必须给明确提示（而不是静默空白）').toContain('停止实时渲染')
    expect(previewBox.textContent ?? '').toContain(String(MAX_MATH_LATEX_LEN))
    // 结构上界：超预算分支不得产出 MB 级 HTML（审查实测全量渲染 1.92MB）
    expect(previewBox.innerHTML.length, '预览 HTML 必须远小于全量渲染').toBeLessThan(20_000)
    expect(elapsed, `挂载耗时应远低于全量渲染（实测 ${elapsed}ms）`).toBeLessThan(400)
  })

  it('A10-2 嵌套深度超预算（> 512 层）：同样降级 + 提示嵌套原因', async () => {
    const deep = '{'.repeat(MAX_MATH_LATEX_DEPTH + 5) + 'x' + '}'.repeat(MAX_MATH_LATEX_DEPTH + 5)
    await mount(deep)
    expect(document.querySelectorAll('.katex').length).toBe(0)
    const previewBox = [...document.querySelectorAll('div')].find((d) => (d.textContent ?? '').includes('渲染预览')) as HTMLElement
    expect(previewBox.textContent ?? '').toContain('嵌套过深')
  })

  it('A10-3 契约守护：预算内的公式照常渲染（含正常分式）', async () => {
    await mount(`\\frac{1}{2} + x^2`)
    expect(document.querySelectorAll('.katex').length).toBeGreaterThan(0)
    const previewBox = [...document.querySelectorAll('div')].find((d) => (d.textContent ?? '').includes('渲染预览')) as HTMLElement
    expect(previewBox.textContent ?? '').not.toContain('停止实时渲染')
  })

  it('A10-4 边界：恰好等于预算上限仍渲染；超 1 字符即降级', async () => {
    await mount('a'.repeat(MAX_MATH_LATEX_LEN))
    expect(document.querySelectorAll('.katex').length).toBeGreaterThan(0)
    await act(async () => root!.unmount())
    document.body.innerHTML = ''
    root = null
    await mount('a'.repeat(MAX_MATH_LATEX_LEN + 1))
    expect(document.querySelectorAll('.katex').length).toBe(0)
  })

  it('A10-6 契约守护：KaTeX **语法错误**（预算内）仍走既有错误渲染，不得被预算分支吞掉', async () => {
    await mount('\\frac{1}{')
    const previewBox = [...document.querySelectorAll('div')].find((d) => (d.textContent ?? '').includes('渲染预览')) as HTMLElement
    expect(previewBox.textContent ?? '', '预算内语法错误不得显示预算提示').not.toContain('停止实时渲染')
    expect(document.querySelector('[data-ke-math-budget-notice]'), '不得走预算降级分支').toBeNull()
    expect(previewBox.innerHTML, 'KaTeX 自身的错误输出仍应呈现').toContain('katex')
  })

  it('A10-5 源码级：模态从**同一个** budget 模块取预算（与显示节点单一事实源）', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const modalSrc = readFileSync(join(__dirname, 'MathEditorModal.tsx'), 'utf8')
    const nodeSrc = readFileSync(join(__dirname, 'nodeviews/MathNodeView.tsx'), 'utf8')
    expect(modalSrc, '模态必须从 editor/math/budget 导入预算').toContain("editor/math/budget")
    expect(nodeSrc, '节点必须复用同一 budget 模块').toContain("editor/math/budget")
    // 运行时同一常量（单一事实源）
    const nodeModule = await import('./nodeviews/MathNodeView')
    expect(nodeModule.MAX_MATH_LATEX_LEN).toBe(MAX_MATH_LATEX_LEN)
    expect(nodeModule.MAX_MATH_LATEX_DEPTH).toBe(MAX_MATH_LATEX_DEPTH)
  })
})

// ─────────────────────────────────────────────────────────── A11（接线层）

describe('task-63 A11：模板面板插入后，光标落在**新**模板的槽', () => {
  it('A11-7 已有旧槽时末尾插入根式：选中新槽，输入 9 得 \\sqrt[n]{9} 而非改旧分式', async () => {
    const before = `\\frac{${SLOT_CHAR}}{2} + `
    await mount(before)
    const t = textarea()
    await act(async () => {
      t.focus()
      t.setSelectionRange(before.length, before.length)
    })
    await act(async () => {
      buttonByText('根式')!.click()
      await new Promise((res) => setTimeout(res, 20))
    })
    expect(t.value).toBe(`\\frac{${SLOT_CHAR}}{2} + \\sqrt[n]{${SLOT_CHAR}}`)
    // 选中新模板内的槽（审查实测选中了旧分式的槽 6..7）
    expect(t.selectionStart).toBe(before.length + `\\sqrt[n]{`.length)
    expect(t.selectionEnd).toBe(t.selectionStart + 1)
    expect(t.value[t.selectionStart]).toBe(SLOT_CHAR)
    expect(t.selectionStart).not.toBe(before.indexOf(SLOT_CHAR))

    // 以当前选区模拟键入 9（浏览器默认行为：替换选区）
    const typed = t.value.slice(0, t.selectionStart) + '9' + t.value.slice(t.selectionEnd)
    expect(typed).toBe(`\\frac{${SLOT_CHAR}}{2} + \\sqrt[n]{9}`)
    expect(typed).not.toContain(`\\frac{9}{2}`)
  })

  it('A11-8 无旧槽时插入模板：仍选中新槽（既有语义不回归）', async () => {
    await mount('')
    const t = textarea()
    await act(async () => {
      t.focus()
      t.setSelectionRange(0, 0)
    })
    await act(async () => {
      buttonByText('分式')!.click()
      await new Promise((res) => setTimeout(res, 20))
    })
    expect(t.value).toBe(`\\frac{${SLOT_CHAR}}{${SLOT_CHAR}}`)
    expect(t.value[t.selectionStart]).toBe(SLOT_CHAR)
  })
})

// ─────────────────────────────────────────────────────────── 既有契约守护

describe('task-63 契约守护：v1.2.9 的两条数据安全语义不得回退', () => {
  it('G-1 清空一条**本来有内容**的公式 → 必须先确认，不得静默删除', async () => {
    await mount('x+1')
    const t = textarea()
    await act(async () => {
      typeInto(t, '', 0)
    })
    await act(async () => {
      pressKey('Escape')
      await new Promise((res) => setTimeout(res, 40))
    })
    // 确认框出现（askConfirm 自绘），未确认前不得删除
    expect(deleted, '未确认前不得删除').toBe(0)
    expect(document.querySelector('[role="dialog"]'), '必须弹出确认框').toBeTruthy()
  })

  it('G-2 空公式 Esc → 直接删除（不弹确认，既有语义）', async () => {
    await mount('')
    await act(async () => {
      pressKey('Escape')
      await new Promise((res) => setTimeout(res, 40))
    })
    expect(deleted).toBe(1)
    expect(saved).toEqual([])
  })

  it('G-3 有内容公式 Esc → 保存（剥离槽位、trim）', async () => {
    await mount(`\\frac{${SLOT_CHAR}}{2}`)
    await act(async () => {
      pressKey('Escape')
      await new Promise((res) => setTimeout(res, 40))
    })
    expect(saved).toEqual(['\\frac{}{2}'])
    expect(closed).toBe(1)
  })

  it('G-4 候选 ↑↓ 仍可切换高亮（既有语义）', async () => {
    await mount('')
    const t = textarea()
    await act(async () => {
      typeInto(t, '\\f')
    })
    const box = (): HTMLElement =>
      [...document.querySelectorAll('div')].find((d) => (d.className || '').toString().includes('top-full')) as HTMLElement
    expect(box()).toBeTruthy()
    const items = (): HTMLButtonElement[] => [...box().querySelectorAll('button')] as HTMLButtonElement[]
    expect(items().length).toBeGreaterThan(1)
    // 高亮标记用 `ring-inset`（避免 happy-dom 把 `bg-accent` 与相邻含 `]` 的 class 粘成一个 token）
    const hi = (): number => items().findIndex((b) => (b.className || '').includes('ring-inset'))
    expect(hi(), '初始高亮第 0 项').toBe(0)
    const labels = items().map((b) => (b.textContent || '').slice(0, 12))
    await act(async () => {
      pressKey('ArrowDown')
      await new Promise((res) => setTimeout(res, 20))
    })
    expect(hi(), 'ArrowDown → 高亮第 1 项').toBe(1)
    expect(items()[1].textContent?.slice(0, 12)).toBe(labels[1])
    await act(async () => {
      pressKey('ArrowUp')
      await new Promise((res) => setTimeout(res, 20))
    })
    expect(hi(), 'ArrowUp → 回到第 0 项').toBe(0)
  })
})
