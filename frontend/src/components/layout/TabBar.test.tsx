/**
 * Tab 栏（task-30）测试。
 *
 * A 组：纯函数（标签集合语义：打开/关闭/相邻/标题替换）——无 DOM，可穷举边界。
 * B 组：组件（受控渲染、脏标记、点击/中键/关闭、可滚动、无障碍结构）。
 * C 组：接线守卫（App 真的注册了 doc.next/prev 且经 TabsContext 注入；工具栏死按钮已删）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import {
  TabBar,
  adjacentTabId,
  closeTab,
  openTab,
  replaceTab,
  setTabTitle,
  type TabItem,
} from './TabBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A: TabItem = { id: 'Articles/a.md', title: 'A' }
const B: TabItem = { id: 'Articles/b.md', title: 'B' }
const C: TabItem = { id: 'Articles/c.md', title: 'C' }
const ABC = [A, B, C]

// ---------------------------------------------------------------- A 组：纯函数

describe('A. 标签集合语义（纯函数）', () => {
  it('A1 打开新文档 → 追加到末尾', () => {
    expect(openTab([A], B)).toEqual([A, B])
  })

  it('A2 重复打开同一文档 → 不新增重复标签（只同步标题）', () => {
    const same = openTab(ABC, { ...B })
    expect(same).toBe(ABC) // 标题未变 → 引用稳定
    const renamed = openTab(ABC, { id: B.id, title: 'B2' })
    expect(renamed).toHaveLength(3)
    expect(renamed[1].title).toBe('B2')
    expect(renamed.map((t) => t.id)).toEqual(ABC.map((t) => t.id)) // 顺序不变
  })

  it('A3 关闭激活标签 → 左邻优先', () => {
    // [A,B,C] 关闭激活的 B → 激活左邻 A
    expect(closeTab(ABC, B.id, B.id)).toEqual({ tabs: [A, C], activeId: A.id })
  })

  it('A4 关闭激活标签且无左邻 → 右邻', () => {
    expect(closeTab(ABC, A.id, A.id)).toEqual({ tabs: [B, C], activeId: B.id })
  })

  it('A5 关闭最后一个标签 → 回空态（activeId=null）', () => {
    expect(closeTab([A], A.id, A.id)).toEqual({ tabs: [], activeId: null })
  })

  it('A6 关闭非激活标签 → 激活项不变', () => {
    expect(closeTab(ABC, C.id, A.id)).toEqual({ tabs: [B, C], activeId: C.id })
  })

  it('A7 关闭不存在的标签 → 原样返回（幂等，不崩）', () => {
    expect(closeTab(ABC, B.id, 'nope')).toEqual({ tabs: ABC, activeId: B.id })
  })

  it('A8 环绕相邻：doc.next 末尾→开头、doc.prev 开头→末尾', () => {
    expect(adjacentTabId(ABC, C.id, 1)).toBe(A.id)
    expect(adjacentTabId(ABC, A.id, -1)).toBe(C.id)
    expect(adjacentTabId(ABC, A.id, 1)).toBe(B.id)
    expect(adjacentTabId(ABC, B.id, -1)).toBe(A.id)
  })

  it('A9 单标签 / 空列表 / 无激活项：不抛错、不误切换', () => {
    expect(adjacentTabId([A], A.id, 1)).toBe(A.id) // 单标签 → 自身（App 侧短路不切换）
    expect(adjacentTabId([], null, 1)).toBeNull()
    expect(adjacentTabId(ABC, null, 1)).toBe(A.id) // 无激活 → 第一个
  })

  it('A10 replaceTab：重命名/移动时原位替换 id（顺序不变），标题可同步', () => {
    const moved = replaceTab(ABC, B.id, 'Articles/sub/b.md', 'B')
    expect(moved.map((t) => t.id)).toEqual([A.id, 'Articles/sub/b.md', C.id])
    // 源不存在（例如新打开的文档）→ 追加
    expect(replaceTab([A], 'x.md', 'y.md')).toEqual([A, { id: 'y.md', title: 'y.md' }])
  })

  it('A11 setTabTitle：命中更新、未变/未命中返回原引用', () => {
    expect(setTabTitle(ABC, B.id, '新标题')[1].title).toBe('新标题')
    expect(setTabTitle(ABC, B.id, 'B')).toBe(ABC)
    expect(setTabTitle(ABC, 'nope', 'x')).toBe(ABC)
  })
})

// ---------------------------------------------------------------- B 组：组件

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

async function render(props: Partial<React.ComponentProps<typeof TabBar>> = {}): Promise<void> {
  const full = { tabs: ABC, activeId: A.id, onActivate: vi.fn(), onClose: vi.fn(), ...props }
  if (!root) root = createRoot(container)
  await act(async () => {
    root!.render(<TabBar {...full} />)
  })
}

const tabEls = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-tab-id]'))
const tabButton = (id: string): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"] button[role="tab"]`)!

describe('B. 组件渲染与交互', () => {
  it('B1 渲染全部标签；激活项 aria-selected=true，其余 false', async () => {
    await render()
    expect(tabEls()).toHaveLength(3)
    expect(container.textContent).toContain('A')
    expect(container.textContent).toContain('B')
    expect(container.textContent).toContain('C')
    expect(tabButton(A.id).getAttribute('aria-selected')).toBe('true')
    expect(tabButton(B.id).getAttribute('aria-selected')).toBe('false')
    expect(container.querySelector('[data-tab-id="' + B.id + '"]')!.getAttribute('data-active')).toBe('false')
  })

  it('B2 点击标签 → onActivate(id)', async () => {
    const onActivate = vi.fn()
    await render({ onActivate })
    await act(async () => {
      tabButton(B.id).click()
    })
    expect(onActivate).toHaveBeenCalledWith(B.id)
  })

  it('B3 脏标记：dirtyId 出现、无 dirtyId 消失（与 saveState 同源，不自建状态）', async () => {
    await render({ dirtyId: B.id })
    expect(container.querySelector(`[data-tab-id="${B.id}"] [data-dirty]`)).toBeTruthy()
    expect(container.querySelectorAll('[data-dirty]')).toHaveLength(1)
    await render({ dirtyId: null })
    expect(container.querySelectorAll('[data-dirty]')).toHaveLength(0)
  })

  it('B4 关闭按钮 → onClose(id)；中键（auxclick）也可关闭', async () => {
    const onClose = vi.fn()
    await render({ onClose })
    const closeBtn = container.querySelector<HTMLButtonElement>(`[data-tab-id="${B.id}"] button[aria-label^="关闭"]`)!
    expect(closeBtn).toBeTruthy()
    await act(async () => {
      closeBtn.click()
    })
    expect(onClose).toHaveBeenCalledWith(B.id)

    onClose.mockClear()
    await act(async () => {
      tabButton(C.id).dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    })
    expect(onClose).toHaveBeenCalledWith(C.id)
  })

  it('B5 空集合 → 渲染 null（不产坏标签/幽灵激活项）', async () => {
    await render({ tabs: [], activeId: null })
    expect(container.querySelector('[data-testid="tab-bar"]')).toBeNull()
    expect(tabEls()).toHaveLength(0)
  })

  it('B6 横向滚动容器 + 原生按钮语义 + 无 button 嵌套（合法性/可访问性）', async () => {
    await render()
    const bar = container.querySelector<HTMLElement>('[data-testid="tab-bar"]')!
    expect(bar.className).toContain('overflow-x-auto')
    expect(bar.getAttribute('role')).toBe('tablist')
    expect(container.querySelectorAll('button button').length).toBe(0)
    expect(container.querySelectorAll('a button').length).toBe(0)
    expect(tabButton(A.id).tagName).toBe('BUTTON')
  })
})

// ---------------------------------------------------------------- C 组：接线守卫

describe('C. App/工具栏接线守卫（防只改组件不接线）', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
  const toolbar = readFileSync(resolve(process.cwd(), 'src/components/editor/EditorToolbar.tsx'), 'utf8')

  it('C1 App 注册 doc.next / doc.prev（项① 快捷键真实分派）且无标签时不注册', () => {
    expect(app).toMatch(/registerActionHandler\('doc\.next'/)
    expect(app).toMatch(/registerActionHandler\('doc\.prev'/)
    expect(app).toMatch(/if \(tabs\.length === 0\) return/)
  })

  it('C2 App 打开即入标签、关闭走既有 flush/确认链、无标签回空态', () => {
    expect(app).toMatch(/setTabs\(\(prev\) => openTab\(prev, \{ id: doc\.id, title: doc\.title \}\)\)/)
    expect(app).toMatch(/flushWithTimeout\(id\)/)
    expect(app).toMatch(/askConfirm\('当前有未保存修改，关闭标签将放弃这些修改，是否继续？'\)/)
    expect(app).toMatch(/setTabs\(after\.tabs\)/)
  })

  it('C3 App 经 TabsContext 注入标签状态（不改 EditorArea 即接到工具栏槽位）', () => {
    expect(app).toMatch(/<TabsContext\.Provider/)
    expect(app).toMatch(/<TabsContext\.Provider[\s\S]*?<AppShell/)
  })

  it('C4 工具栏使用 tabBar 槽位回退到 TabBarSlot；G-2 死按钮与 prop 已删除', () => {
    expect(toolbar).toMatch(/\{tabBar \?\? <TabBarSlot \/>\}/)
    expect(toolbar).not.toContain('onOpenAttachments')
    expect(toolbar).not.toMatch(/title="附件"/)
  })

  it('C5 G-3：右栏展开按钮 title 不再含「附件」', () => {
    expect(app).toContain('title="展开右侧面板（大纲 / 属性）"')
    expect(app).not.toContain('大纲 / 属性 / 附件')
  })
})
