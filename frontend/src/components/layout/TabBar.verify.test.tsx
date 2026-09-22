/**
 * Tab 栏（文档标签页）—— 独立对抗验证套件（task-33 · verifier-attach）
 *
 * 依据：docs/design-1.2.0-plan.md §2 第 4 条「『切换文档』的入口 → 做 Tab 栏」。
 * 重点红线：**不得回归切档数据安全**（F-S1-2 切档快照 / F-S1-4 恢复点语义）——
 * 标签切换必须复用既有 `state/docSwitch.ts` / `saveQueue` 的缝，而不是另起一套。
 *
 * 口径更正（Lead 2026-09-18 定调）：关闭激活标签 → **左邻优先**（无左邻 → 右邻；最后一个 → 空态），
 * 与 VS Code 一致。本套件按左优先断言。
 *
 * 写入边界（task-33）：不得修改任何源码。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import {
  TabBar,
  TabBarSlot,
  TabsContext,
  adjacentTabId,
  closeTab,
  openTab,
  replaceTab,
  setTabTitle,
  type TabItem,
} from './TabBar'
import * as docSwitch from '../../state/docSwitch'
import { discardPending, enqueueSave, flushPending, flushWithTimeout } from '../../state/saveQueue'
// 源码级断言（App 集成 / G-2 G-3 死按钮清理 / Tab 栏落位）
import appSource from '../../App.tsx?raw'
import toolbarSource from '../../components/editor/EditorToolbar.tsx?raw'
import editorAreaSource from './EditorArea.tsx?raw'
import tabBarSource from './TabBar.tsx?raw'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const T = (id: string, title = id): TabItem => ({ id, title })

// ============================================================================
// T-0 切档数据安全缝（交叉核对锚点）
// ============================================================================
describe('T-0 切档数据安全缝（交叉核对锚点）', () => {
  it('docSwitch 既有缝仍导出：onDocumentSwitch / resolveSaveContent / resolveRecoveryTarget', () => {
    expect(typeof docSwitch.onDocumentSwitch, 'onDocumentSwitch 丢失').toBe('function')
    expect(typeof docSwitch.resolveSaveContent, 'resolveSaveContent 丢失').toBe('function')
    expect(typeof docSwitch.resolveRecoveryTarget, 'resolveRecoveryTarget 丢失').toBe('function')
    expect(typeof docSwitch.createDeferredLoader, 'createDeferredLoader 丢失').toBe('function')
    expect(docSwitch.CONTENT_SNAPSHOT_LIMIT, '内容快照上限常量丢失').toBeGreaterThan(0)
  })

  it('切档顺序不变量：快照 → flushPending → cancelDraftTimer（顺序颠倒会串档）', () => {
    const order: string[] = []
    const snapshots = new Map<string, string>()
    const res = docSwitch.onDocumentSwitch({
      editorDocId: 'A',
      prevId: 'A',
      newId: 'B',
      editorMarkdown: '# A 内容',
      snapshots,
      flushPending: (id) => order.push(`flush:${id}`),
      cancelDraftTimer: () => order.push('cancel'),
    })

    expect(res).toEqual({ switched: true, snapshotFor: 'A' })
    expect(snapshots.get('A'), '快照必须落表（F-S1-2）').toBe('# A 内容')
    expect(order, '顺序必须是 flush 后再 cancel（S-1 防串档）').toEqual(['flush:A', 'cancel'])
  })
})

// ============================================================================
// T-1 纯函数（openTab / closeTab / replaceTab / setTabTitle / adjacentTabId）
// ============================================================================
describe('T-1 纯函数语义（无 DOM 穷举）', () => {
  it('openTab：新文档追加到末尾；重复打开只更新标题、绝不产生重复标签', () => {
    const base = [T('A'), T('B')]
    expect(openTab(base, T('C'))).toEqual([T('A'), T('B'), T('C')])

    const same = openTab(base, T('A'))
    expect(same, '同 id 同标题 → 引用稳定（避免无谓重渲染）').toBe(base)

    const renamed = openTab(base, T('A', 'A2'))
    expect(renamed.map((t) => t.id)).toEqual(['A', 'B'])
    expect(renamed[0].title).toBe('A2')

    const ids = openTab(openTab(base, T('A')), T('A')).map((t) => t.id)
    expect(ids, '不得出现重复 id').toEqual(['A', 'B'])
  })

  it('closeTab 左优先：关闭激活标签 → 左邻；无左邻 → 右邻；最后一个 → 空态', () => {
    const tabs = [T('A'), T('B'), T('C')]

    const mid = closeTab(tabs, 'B', 'B')
    expect(mid.tabs.map((t) => t.id)).toEqual(['A', 'C'])
    expect(mid.activeId, '关闭中间激活项 → 左邻 A').toBe('A')

    const first = closeTab(tabs, 'A', 'A')
    expect(first.activeId, '无左邻 → 右邻 B').toBe('B')

    const last = closeTab(tabs, 'C', 'C')
    expect(last.activeId, '左邻 B').toBe('B')

    const only = closeTab([T('A')], 'A', 'A')
    expect(only.tabs).toEqual([])
    expect(only.activeId, '关闭最后一个 → 无激活标签（回空态）').toBeNull()
  })

  it('closeTab：关闭非激活标签 → 激活项不变；未知 id → 原样返回', () => {
    const tabs = [T('A'), T('B'), T('C')]
    const nonActive = closeTab(tabs, 'B', 'A')
    expect(nonActive.tabs.map((t) => t.id)).toEqual(['B', 'C'])
    expect(nonActive.activeId).toBe('B')

    const unknown = closeTab(tabs, 'B', 'X')
    expect(unknown.tabs).toBe(tabs)
    expect(unknown.activeId).toBe('B')
  })

  it('replaceTab：原位替换保持顺序与标题；目标不存在 → 追加', () => {
    const tabs = [T('A'), T('B'), T('C')]
    const renamed = replaceTab(tabs, 'B', 'B-moved', 'B 新名')
    expect(renamed.map((t) => t.id), '重命名/移动必须保持顺序').toEqual(['A', 'B-moved', 'C'])
    expect(renamed[1].title).toBe('B 新名')

    const appended = replaceTab(tabs, 'X', 'Y', 'Y')
    expect(appended.map((t) => t.id)).toEqual(['A', 'B', 'C', 'Y'])
  })

  it('setTabTitle：命中且变化才新数组；未知 id / 同值 → 引用稳定', () => {
    const tabs = [T('A'), T('B')]
    const updated = setTabTitle(tabs, 'A', 'A2')
    expect(updated[0].title).toBe('A2')
    expect(setTabTitle(tabs, 'A', 'A'), '同值 → 引用稳定').toBe(tabs)
    expect(setTabTitle(tabs, 'X', 'X2'), '未知 id → 引用稳定').toBe(tabs)
  })

  it('adjacentTabId：环绕 next/prev；单标签不切换；空列表 null；未知激活项 → 第一个', () => {
    const tabs = [T('A'), T('B'), T('C')]
    expect(adjacentTabId(tabs, 'A', 1)).toBe('B')
    expect(adjacentTabId(tabs, 'C', 1), '最后一个 → 第一个（环绕）').toBe('A')
    expect(adjacentTabId(tabs, 'A', -1), '第一个 → 最后一个（环绕）').toBe('C')
    expect(adjacentTabId(tabs, null, 1)).toBe('A')
    expect(adjacentTabId(tabs, 'X', 1), '激活项不在列表中 → 第一个').toBe('A')
    expect(adjacentTabId([T('A')], 'A', 1), '单标签 → 自身（不切换）').toBe('A')
    expect(adjacentTabId([], null, 1)).toBeNull()
  })
})

// ============================================================================
// T-2 组件渲染与交互
// ============================================================================
describe('T-2 TabBar 组件（受控）', () => {
  let root: Root | null = null
  let container: HTMLDivElement
  let onActivate: ReturnType<typeof vi.fn<(id: string) => void>>
  let onClose: ReturnType<typeof vi.fn<(id: string) => void>>

  function render(node: React.ReactNode): void {
    root = createRoot(container)
    act(() => {
      root!.render(node)
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    onActivate = vi.fn<(id: string) => void>()
    onClose = vi.fn<(id: string) => void>()
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('空标签集合 → 渲染 null（不得产生坏标签）', () => {
    render(<TabBar tabs={[]} activeId={null} onActivate={onActivate} onClose={onClose} />)
    expect(container.innerHTML).toBe('')
    expect(container.querySelector('[data-testid="tab-bar"]')).toBeNull()
  })

  it('渲染 tablist 语义 + 横向滚动 + 每标签 data-* 钩子', () => {
    render(<TabBar tabs={[T('A'), T('B')]} activeId="B" dirtyId="A" onActivate={onActivate} onClose={onClose} />)

    const bar = container.querySelector('[data-testid="tab-bar"]')!
    expect(bar.getAttribute('role')).toBe('tablist')
    expect(bar.className, '标签过多需横向滚动').toContain('overflow-x-auto')

    const tabs = container.querySelectorAll('[data-tab-id]')
    expect(tabs.length).toBe(2)
    expect(tabs[0].getAttribute('data-tab-id')).toBe('A')
    expect(tabs[0].getAttribute('data-active')).toBe('false')
    expect(tabs[1].getAttribute('data-active')).toBe('true')
  })

  it('滚动条：横向可滚动，但纵向必须 hidden + 隐藏本条滚动条（防双条叠加，2026-09-22 用户实测）', () => {
    render(<TabBar tabs={[T('A'), T('B')]} activeId="A" onActivate={onActivate} onClose={onClose} />)
    const bar = container.querySelector('[data-testid="tab-bar"]')!
    const cls = bar.className
    expect(cls, '标签过多仍需横向滚动').toContain('overflow-x-auto')
    expect(cls, '仅 overflow-x-auto 会让另一轴计算为 auto → 双滚动条叠加').toContain('overflow-y-hidden')
    expect(cls, '必须隐藏本条滚动条（scrollbar-width）').toContain('[scrollbar-width:none]')
    expect(cls, '必须隐藏本条滚动条（webkit）').toContain('[&::-webkit-scrollbar]:hidden')
  })

  it('激活控件是原生 button[role=tab][aria-selected]；点击 → onActivate(该 id)', () => {
    render(<TabBar tabs={[T('A'), T('B')]} activeId="A" onActivate={onActivate} onClose={onClose} />)

    const tabBtn = container.querySelector<HTMLButtonElement>('[data-tab-id="B"] button[role="tab"]')!
    expect(tabBtn.tagName).toBe('BUTTON')
    expect(tabBtn.getAttribute('aria-selected')).toBe('false')
    expect(tabBtn.disabled).toBe(false)

    act(() => tabBtn.click())
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith('B')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('脏标记只出现在 dirtyId 标签上（data-dirty + 可访问名）', () => {
    render(<TabBar tabs={[T('A'), T('B'), T('C')]} activeId="B" dirtyId="C" onActivate={onActivate} onClose={onClose} />)

    const dirty = container.querySelectorAll('[data-dirty="true"]')
    expect(dirty.length, '只允许一个脏标记').toBe(1)
    expect(container.querySelector('[data-tab-id="C"] [data-dirty="true"]'), '脏标记必须在 C 上').toBeTruthy()
    expect(container.querySelector('[data-tab-id="A"] [data-dirty]')).toBeNull()
    expect(dirty[0].getAttribute('aria-label')).toContain('未保存')
  })

  it('关闭控件是激活控件的兄弟节点；点击关闭 → onClose(id) 且**不触发激活**', () => {
    render(<TabBar tabs={[T('A'), T('B')]} activeId="A" onActivate={onActivate} onClose={onClose} />)

    const tabBtn = container.querySelector<HTMLButtonElement>('[data-tab-id="B"] button[role="tab"]')!
    const closeBtn = container.querySelector<HTMLButtonElement>('[data-tab-id="B"] button[aria-label^="关闭"]')!
    expect(closeBtn, '关闭控件应带 aria-label').toBeTruthy()
    expect(tabBtn.nextElementSibling, '关闭控件必须是兄弟节点（禁止 button 嵌套）').toBe(closeBtn)

    act(() => closeBtn.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('B')
    expect(onActivate, '关闭不得冒泡成激活').not.toHaveBeenCalled()
  })

  it('中键（auxclick button=1）关闭标签；左键不关闭', () => {
    render(<TabBar tabs={[T('A')]} activeId="A" onActivate={onActivate} onClose={onClose} />)
    const tabBtn = container.querySelector<HTMLButtonElement>('[data-tab-id="A"] button[role="tab"]')!

    const left = new MouseEvent('auxclick', { button: 0, bubbles: true, cancelable: true })
    tabBtn.dispatchEvent(left)
    expect(onClose, '左键 auxclick 不应关闭').not.toHaveBeenCalled()

    const down = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    tabBtn.dispatchEvent(down)
    expect(down.defaultPrevented, '中键按下需阻止 WebView 自动滚动').toBe(true)

    const mid = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    tabBtn.dispatchEvent(mid)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('A')
  })

  it('DOM 合法性：无 button 嵌套 button/a、无 a 嵌套 button；标签数 = 数据条数', () => {
    render(<TabBar tabs={[T('A'), T('B'), T('C')]} activeId="A" onActivate={onActivate} onClose={onClose} />)

    expect(container.querySelectorAll('button button').length).toBe(0)
    expect(container.querySelectorAll('button a').length).toBe(0)
    expect(container.querySelectorAll('a button').length).toBe(0)
    expect(container.querySelectorAll('[data-tab-id]').length).toBe(3)
  })

  it('TabBarSlot：无 provider → null；有 provider → 渲染并透传交互', () => {
    render(<TabBarSlot />)
    expect(container.innerHTML, '无 context 时应渲染 null').toBe('')

    render(
      <TabsContext.Provider
        value={{ tabs: [T('A')], activeId: 'A', dirtyId: null, onActivate, onClose }}
      >
        <TabBarSlot />
      </TabsContext.Provider>,
    )
    const tabBtn = container.querySelector<HTMLButtonElement>('[data-tab-id="A"] button[role="tab"]')!
    act(() => tabBtn.click())
    expect(onActivate).toHaveBeenCalledWith('A')
  })
})

// ============================================================================
// T-3 App 集成（源码级断言：数据安全 + 快捷键注册）
// ============================================================================
describe('T-3 App 集成（源码级断言）', () => {
  it('非激活标签关闭 → 零文档请求（isActive 守卫 + 直接 return）', () => {
    const start = appSource.indexOf('const closeTabById = useCallback(')
    const body = appSource.slice(start, appSource.indexOf('const cycleTab = useCallback('))
    expect(body, '关闭路径必须区分激活/非激活').toContain('const isActive = articleIdRef.current === id')
    const returnAt = body.indexOf('if (!isActive) return')
    const switchAt = body.indexOf('await openArticle(after.activeId)')
    expect(returnAt, '非激活标签关闭必须直接返回').toBeGreaterThan(-1)
    expect(switchAt, '激活标签才切换到相邻文档').toBeGreaterThan(-1)
    expect(returnAt, '非激活分支必须在切换调用之前返回（零文档请求）').toBeLessThan(switchAt)
  })

  it('激活标签关闭：flushWithTimeout → 确认 → 取消中止 / 确认则 discardPending（task-35 C）', () => {
    const start = appSource.indexOf('const closeTabById = useCallback(')
    const body = appSource.slice(start, appSource.indexOf('const cycleTab = useCallback('))
    const flushAt = body.indexOf('await flushWithTimeout(id)')
    const confirmAt = body.indexOf('askConfirm(')
    const discardAt = body.indexOf('discardPending(id)')
    const switchAt = body.indexOf('await openArticle(after.activeId)')

    expect(flushAt, '必须先 flush 未决保存').toBeGreaterThan(-1)
    expect(confirmAt, 'flush 失败才确认').toBeGreaterThan(flushAt)
    expect(body.slice(confirmAt), '用户取消必须中止关闭').toMatch(/\)\)\s*return/)
    expect(discardAt, '确认放弃后必须 discardPending（否则被放弃的内容仍会落盘）').toBeGreaterThan(confirmAt)
    expect(discardAt, 'discardPending 必须在切换之前').toBeLessThan(switchAt)
    expect(body, '确认后按左优先取相邻标签').toContain('closeTabState(')
  })

  it('「放弃修改」语义两条入口共享 discardPending（requestOpenArticle / closeTabById 不漂移）', () => {
    const calls = (appSource.match(/discardPending\(/g) ?? []).length
    expect(calls, '两条放弃入口都必须接同一 discardPending').toBeGreaterThanOrEqual(2)
  })

  it('切换/相邻一律复用既有入口 requestOpenArticle（不另起一套 flush 链）', () => {
    const tabSection = appSource.slice(
      appSource.indexOf('// ---------- Tab 栏（task-30）'),
      appSource.indexOf('useEffect', appSource.indexOf('const cycleTab = useCallback(')),
    )
    expect(tabSection, 'activateTab 必须走 requestOpenArticle').toMatch(/requestOpenArticle\(id\)/)
    expect(tabSection, 'cycleTab 必须走 requestOpenArticle').toMatch(/requestOpenArticle\(next\)/)
    expect(appSource, 'App 必须复用 TabBar 的纯函数（同一套顺序/相邻语义）').toMatch(
      /from '\.\/components\/layout\/TabBar'/,
    )
    expect(appSource).toContain('adjacentTabId')
    expect(appSource).toContain('closeTab as closeTabState')
  })

  it('无标签时不注册 doc.next/prev/close → 未打开文档时按键不被吞', () => {
    const at = appSource.indexOf("registerActionHandler('doc.next'")
    expect(at, '应注册 doc.next').toBeGreaterThan(-1)
    const guard = appSource.lastIndexOf('if (tabs.length === 0) return', at)
    expect(guard, '注册前必须有 tabs.length === 0 守卫').toBeGreaterThan(-1)
    expect(appSource.slice(guard, at), '守卫与注册应属同一 effect').not.toContain('useEffect')
    expect(appSource, 'doc.prev 与 doc.close 也必须在同一守卫之后').toContain("registerActionHandler('doc.prev'")
    expect(appSource).toContain("registerActionHandler('doc.close'")
  })

  it('标签集合是会话态：TabBar 无任何写路径（不写 .md / ke-* / 设置 / saveQueue）', () => {
    // 去注释后再查（源码注释里出现 "ke-*" 属于文档说明，不是写路径）
    const tabBarCode = tabBarSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const forbidden of ['saveArticle', 'enqueueSave', 'flushPending', 'setKeContent', 'updateArticleMeta', 'ke-']) {
      expect(tabBarCode.includes(forbidden), `TabBar 不应触碰写路径：${forbidden}`).toBe(false)
    }
    expect(appSource, 'tabs 状态注释须标注会话态（不持久化）').toContain('**会话状态**')
  })
})

// ============================================================================
// T-4 数据安全：确认「放弃修改」后不得再落盘（Lead 关注①）
// ============================================================================
describe('T-4 关闭/切换的数据安全（Lead 关注①：放弃修改后不得再落盘）', () => {
  it('已确认放弃后，切档 effect 的 flushPending(旧文档) 只等待既有在途链，不产生新的保存请求', async () => {
    const saved: string[] = []
    const slow = async (): Promise<void> => {
      saved.push('A')
      await new Promise((r) => setTimeout(r, 60))
    }
    const inflight = enqueueSave('A', slow, 0) // A 有未决保存（慢）

    const flushed = await flushWithTimeout('A', 10) // 关闭激活标签 → flush 超时
    expect(flushed, '前置：慢保存导致超时 → 触发「放弃修改」确认').toBe(false)
    const afterConfirm = saved.length
    expect(afterConfirm, '确认前已有一次在途保存（不可撤销）').toBe(1)

    // 用户确认放弃 → 切换标签 → EditorArea 切档 effect 调用 flushPending(prevId)
    await flushPending('A')
    expect(saved.length, '放弃后不得再触发新的保存请求').toBe(afterConfirm)

    await inflight
    expect(saved, '全程只允许确认前那一次在途写入').toEqual(['A'])
  })

  it('机制核对（dev 反驳）：drain 在首个 await 前同步取走 latest → 超时后 latest 已空，切档 flushPending 不产生新写入', async () => {
    const started: string[] = []
    const p = enqueueSave(
      'M',
      async () => {
        started.push('M')
        await new Promise((r) => setTimeout(r, 40))
      },
      0,
    )
    // enqueueSave(...,0) 内部 drain 的同步段必须已调用 saveFn（证明 latest 在 await 前被取走）
    expect(started, 'drain 必须在首个 await 之前同步调用 saveFn（latest 已清空）').toEqual(['M'])

    const flushed = await flushWithTimeout('M', 5)
    expect(flushed, '慢保存 → 超时（= 弹「放弃修改」确认的唯一条件）').toBe(false)

    await flushPending('M') // 切档 effect 的调用
    expect(started, '超时后 latest 为空 → flushPending 只等待在途链，不产生新 PUT').toEqual(['M'])
    await p
  })

  it('【T-4 扩展】确认框期间再次入队（用户继续输入）→ 点放弃后该内容仍会落盘（最小复现）', async () => {
    const saved: string[] = []
    const slow = async (): Promise<void> => {
      saved.push('A')
      await new Promise((r) => setTimeout(r, 40))
    }

    const p1 = enqueueSave('A', slow, 0) // ① 在途保存 #1
    expect(await flushWithTimeout('A', 5), '② 关闭路径 flush 超时 → 弹确认').toBe(false)
    const p2 = enqueueSave('A', slow, 0) // ③ 确认框期间用户继续输入（handleUpdate → enqueueSave）
    discardPending('A') // ④ 用户确认「放弃」→ App 的 discardPending(id)（task-35 C）
    await flushPending('A') // ⑤ 切档 effect flushPending(prevId)
    await p1
    await p2

    expect(saved.length, 'Lead 口径：确认放弃 → 零新增 PUT（被放弃的内容不得落盘）').toBe(1)
  })

  it('【T-4 归因对照】不调用 discardPending 时第 2 次写入必然发生（证明 task-35 C 修复是必要的，且归因于 drain 循环而非切档 effect）', async () => {
    const saved: string[] = []
    const slow = async (): Promise<void> => {
      saved.push('A')
      await new Promise((r) => setTimeout(r, 40))
    }

    const p1 = enqueueSave('A', slow, 0)
    expect(await flushWithTimeout('A', 5)).toBe(false)
    const p2 = enqueueSave('A', slow, 0) // 再次入队；**不调用** flushPending
    await p1
    await p2

    expect(saved.length, 'drain 的 while 循环自行消费新 latest（与切档 effect 无关）').toBe(2)
  })

  it('承上：在途链结束后条目被清理，再次 flushPending 为 no-op（不会补写）', async () => {
    const saved: string[] = []
    const p = enqueueSave('B', async () => {
      saved.push('B')
    }, 0)
    await p
    await flushPending('B')
    await flushPending('B')
    expect(saved, '条目清理后不得补写').toEqual(['B'])
  })
})

// ============================================================================
// T-5 G-2 / G-3 死按钮与文案
// ============================================================================
describe('T-5 G-2/G-3（死按钮已删 + 槽位接线）', () => {
  it('EditorToolbar 不再有 onOpenAttachments（G-2 死按钮）', () => {
    expect(toolbarSource.includes('onOpenAttachments'), 'G-2：死按钮入口应已删除').toBe(false)
  })

  it('EditorToolbar 不再有「附件」title（G-3）', () => {
    expect(/title="[^"]*附件[^"]*"/.test(toolbarSource), 'G-3：title 不应再含「附件」').toBe(false)
  })

  it('Tab 栏落位：EditorArea 的 tab-strip 内渲染 TabBarSlot，且位于 EditorToolbar **之前**（2026-09-22 用户要求「最顶上」）', () => {
    const stripIdx = editorAreaSource.indexOf('data-testid="tab-strip"')
    expect(stripIdx, 'EditorArea 缺少 tab-strip 容器').toBeGreaterThan(-1)
    const strip = editorAreaSource.slice(stripIdx, stripIdx + 400)
    expect(strip, 'tab-strip 内必须渲染 TabBarSlot').toMatch(/<TabBarSlot\s*\/>/)
    const toolbarIdx = editorAreaSource.indexOf('<EditorToolbar')
    expect(toolbarIdx, 'EditorArea 缺少 EditorToolbar').toBeGreaterThan(-1)
    expect(stripIdx, 'Tab 栏必须排在工具栏之前（最顶上）——落位回归').toBeLessThan(toolbarIdx)
  })

  it('工具栏不得再承载 Tab 栏（tabBar prop 与 TabBarSlot 渲染均已移除）', () => {
    expect(toolbarSource.includes('TabBarSlot'), '工具栏不应再渲染 TabBarSlot').toBe(false)
    expect(/\btabBar\b/.test(toolbarSource), '工具栏不应再有 tabBar prop（大小写敏感匹配）').toBe(false)
  })
})
