/**
 * 设置页左栏高亮修复（task-37）—— 独立对抗验证套件（task-38 · verifier-attach）
 *
 * 背景：Lead 在打包版 GUI 验收发现「左栏高亮恒停在维护、滚回顶部不回落」；dev 声称根因是
 * 「滚动监听缓存 DOM 节点 → 面板重挂后节点 detached → `getBoundingClientRect()` 全 0 →
 * 阈值比较恒真」，修法 = 依赖加 `ready` + 每次滚动重新查询 + **触底例外**。
 *
 * 本套件**独立推导**攻击面（不复述 task 必查项）：
 *   ① 四态 + 极窄窗口 + **内容不足一屏（不可滚动）**——重点怀疑「触底例外」使高亮恒为末段
 *   ② 根因回归的**判别性**：克隆/重挂后按新节点高亮，并给出「旧缓存写法即复现」的本地对照
 *   ③ 加载态：ready=false 不注册；ready=true 后**无需滚动事件**立即按当前位置同步
 *   ④ 无障碍：`aria-current="page"` 唯一且跟随
 *   ⑤ 点击后平滑滚动期间的中间态（dev 自述的取舍）——记录实际行为供 Lead 判定
 *
 * 写入边界（task-38）：本文件 + docs/verification-settings-nav.md；不得修改任何源码。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import SettingsPanel from './SettingsPanel'

vi.mock('../../settings', async () => {
  const actual = await vi.importActual<typeof import('../../settings')>('../../settings')
  return {
    DEFAULT_SETTINGS: actual.DEFAULT_SETTINGS,
    applyTheme: vi.fn(),
    isTauri: () => false,
    loadSettings: vi.fn(async () => actual.DEFAULT_SETTINGS),
    saveSettings: vi.fn(async () => actual.DEFAULT_SETTINGS),
  }
})
vi.mock('../../api/client', () => ({ rebuildIndex: vi.fn() }))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: vi.fn(async () => true),
  askPrompt: vi.fn(async () => null),
  usePrompt: () => vi.fn(async () => null),
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import * as settingsApi from '../../settings'

// ---------------------------------------------------------------------------
// 受控几何
// ---------------------------------------------------------------------------
const GROUPS = ['general', 'appearance', 'shortcuts', 'maintenance'] as const
type Group = (typeof GROUPS)[number]

const ROOT_TOP = 48
/** 源码 ACTIVE_LINE_OFFSET = 24 → 参考线 = 容器顶部 + 24 */
const LINE = ROOT_TOP + 24
/** 打包版 GUI 实测：scrollTop=0 时四组相对滚动容器顶部 = [128, 592, 989, 3389] */
const BASE_TOP: Record<Group, number> = { general: 128, appearance: 592, shortcuts: 989, maintenance: 3389 }

interface Geo {
  scrollTop: number
  base: Record<Group, number>
  clientHeight: number
  scrollHeight: number
}
const geo: Geo = { scrollTop: 0, base: { ...BASE_TOP }, clientHeight: 800, scrollHeight: 3600 }

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + 100,
    left: 0,
    right: 680,
    width: 680,
    height: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

let root: Root | null = null
let container: HTMLDivElement

function scroller(): HTMLElement {
  const el = container.querySelector<HTMLElement>('div.overflow-y-auto')
  if (!el) throw new Error('未找到滚动容器（div.overflow-y-auto）')
  return el
}

/** 在滚动容器上挂 geo 驱动的 scrollTop/clientHeight/scrollHeight */
function bindScroller(sc: HTMLElement): void {
  Object.defineProperty(sc, 'scrollTop', {
    get: () => geo.scrollTop,
    set: (v: number) => {
      geo.scrollTop = v
    },
    configurable: true,
  })
  Object.defineProperty(sc, 'clientHeight', { get: () => geo.clientHeight, configurable: true })
  Object.defineProperty(sc, 'scrollHeight', { get: () => geo.scrollHeight, configurable: true })
}

/** 容器顶部给定，分组按 `BASE - scrollTop` 计算；**detached 节点返回 0**（复刻真实缺陷机制） */
function installRectSpy(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList?.contains('overflow-y-auto')) return rect(ROOT_TOP)
    const g = (this.id ?? '').replace('settings-group-', '') as Group
    if ((GROUPS as readonly string[]).includes(g)) {
      return rect(this.isConnected ? ROOT_TOP + geo.base[g] - geo.scrollTop : 0)
    }
    return rect(0)
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function render(): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<SettingsPanel open onClose={vi.fn()} />)
  })
  await settle()
  await settle()
  const sc = scroller()
  bindScroller(sc)
  return sc
}

/** 移动到指定几何并派发一次 scroll（真实用户滚动） */
async function scrollTo(next: Partial<Geo>): Promise<void> {
  Object.assign(geo, next)
  const sc = scroller()
  await act(async () => {
    sc.dispatchEvent(new Event('scroll'))
  })
  await settle()
}

function activeNav(): string | null {
  return container.querySelector<HTMLElement>('button[data-nav-group][aria-current="page"]')?.textContent?.trim() ?? null
}

function navButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-nav-group]'))
}

async function clickNav(label: string): Promise<void> {
  const btn = navButtons().find((b) => b.textContent?.trim() === label)
  if (!btn) throw new Error(`未找到左栏导航：${label}`)
  await act(async () => {
    btn.click()
  })
  await settle()
}

/**
 * 本地复刻 task-37 **修复前**的算法（在 `open` 时缓存节点 + 固定基准，无 ready 依赖、无触底例外）。
 * 用途：证明「节点克隆/重挂」用例有判别性 —— 同一构造下旧写法必然恒为末段。
 */
function legacyCachedSync(cached: HTMLElement[]): string {
  let current = 'general'
  for (const el of cached) {
    if (el.getBoundingClientRect().top - ROOT_TOP <= 24) current = el.dataset.group ?? current
    else break
  }
  return current
}

beforeEach(() => {
  Object.assign(geo, { scrollTop: 0, base: { ...BASE_TOP }, clientHeight: 800, scrollHeight: 3600 })
  Element.prototype.scrollIntoView = vi.fn()
  installRectSpy()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
})

// ============================================================================
// V-1 四态与几何边界
// ============================================================================
describe('V-1 四态与几何边界', () => {
  it('顶部 scrollTop=0 → 高亮「常规」', async () => {
    await render()
    await scrollTo({ scrollTop: 0 })
    expect(activeNav()).toBe('常规')
  })

  it('滚到各段 → 高亮对应分组（外观 / 快捷键）', async () => {
    await render()

    await scrollTo({ scrollTop: 600 }) // 外观越过参考线（≥568）、快捷键未越过
    expect(activeNav()).toBe('外观')

    await scrollTo({ scrollTop: 1200 }) // 快捷键越过参考线、维护未越过
    expect(activeNav()).toBe('快捷键')
  })

  it('触底（末段已越过参考线）→ 高亮「维护」；回顶 → 回落「常规」', async () => {
    await render()

    await scrollTo({ scrollTop: 1200 })
    expect(activeNav()).toBe('快捷键')

    await scrollTo({ scrollTop: 2800, clientHeight: 800, scrollHeight: 3600 }) // 到底
    expect(activeNav()).toBe('维护')

    await scrollTo({ scrollTop: 0 })
    expect(activeNav(), '滚回顶部必须回落（原缺陷现象）').toBe('常规')
  })

  it('触底时末段**未越过**参考线 → 仍高亮「维护」（触底例外 load-bearing，且有对照）', async () => {
    await render()
    // 维护段起点 4600、内容总高 5200、视口 800 → 触底 scrollTop=4400 时维护 top 仍在参考线之下
    const deep = { base: { ...BASE_TOP, maintenance: 4600 }, scrollHeight: 5200, clientHeight: 800 }
    await scrollTo({ ...deep, scrollTop: 4400 })
    expect(activeNav(), '触底例外应把末段点亮').toBe('维护')

    // 对照：同几何下若**没有**触底例外，参考线算法会停在「快捷键」→ 证明该例外确有必要
    const withoutException = (() => {
      let current: Group = 'general'
      for (const g of GROUPS) {
        if (ROOT_TOP + deep.base[g] - 4400 <= LINE) current = g
        else break
      }
      return current
    })()
    expect(withoutException, '无例外时末段点不亮（例外 load-bearing）').toBe('shortcuts')
  })

  it('极窄窗口（视口 200px、内容 5200px）四态仍正确，不会「永远高亮末段」', async () => {
    await render()
    const narrow = { clientHeight: 200, scrollHeight: 5200, base: { ...BASE_TOP } }

    await scrollTo({ ...narrow, scrollTop: 0 })
    expect(activeNav()).toBe('常规')

    await scrollTo({ ...narrow, scrollTop: 1000 })
    expect(activeNav()).toBe('快捷键')

    await scrollTo({ ...narrow, scrollTop: 860 })
    expect(activeNav()).toBe('外观')

    await scrollTo({ ...narrow, scrollTop: 5000 }) // 触底
    expect(activeNav()).toBe('维护')

    await scrollTo({ ...narrow, scrollTop: 0 })
    expect(activeNav()).toBe('常规')
  })

  it('内容不足一屏（不可滚动，scrollHeight === clientHeight）→ 高亮必须为「常规」', async () => {
    await render()
    // 全部四组都在首屏内可见、无可滚动空间：预期「常规」；触底例外会把 current 强制为末段。
    // 自洽几何：四组都在 1200 内容高度内、视口 1200 → 不可滚动（scrollHeight === clientHeight）
    const fits = { general: 128, appearance: 400, shortcuts: 700, maintenance: 950 }
    await scrollTo({ base: fits, clientHeight: 1200, scrollHeight: 1200, scrollTop: 0 })

    expect(activeNav(), '内容不足一屏时触底例外使高亮恒为末段（视觉错误）').toBe('常规')
  })

  it('内容不足一屏时点击「常规」→ 高亮为「常规」', async () => {
    await render()
    await scrollTo({
      base: { general: 128, appearance: 400, shortcuts: 700, maintenance: 950 },
      clientHeight: 1200,
      scrollHeight: 1200,
      scrollTop: 0,
    })

    await clickNav('常规')
    expect(activeNav()).toBe('常规')
  })
})

// ============================================================================
// V-2 根因回归判别性
// ============================================================================
describe('V-2 根因回归（不缓存节点）的判别性', () => {
  it('四组节点被整体克隆替换后，仍按**新节点**位置高亮（真实组件）', async () => {
    await render()
    await scrollTo({ scrollTop: 0 })
    expect(activeNav()).toBe('常规')

    await act(async () => {
      for (const g of GROUPS) {
        const el = container.querySelector<HTMLElement>(`#settings-group-${g}`)
        el?.replaceWith(el.cloneNode(true))
      }
    })

    await scrollTo({ scrollTop: 1200 })
    expect(activeNav(), '克隆后仍应按新节点算出「快捷键」').toBe('快捷键')
    await scrollTo({ scrollTop: 0 })
    expect(activeNav()).toBe('常规')
  })

  it('对照：本地复刻「缓存旧节点」算法，在同样克隆后恒为「维护」（证明用例有判别性）', async () => {
    await render()
    await scrollTo({ scrollTop: 0 })

    const cached = GROUPS.map((g) => container.querySelector<HTMLElement>(`#settings-group-${g}`)!).filter(Boolean)
    expect(cached.length).toBe(4)

    await act(async () => {
      for (const g of GROUPS) {
        const el = container.querySelector<HTMLElement>(`#settings-group-${g}`)
        el?.replaceWith(el.cloneNode(true))
      }
    })

    await scrollTo({ scrollTop: 0 })
    expect(legacyCachedSync(cached), '旧写法读 detached 节点（rect 全 0）→ 恒判末段').toBe('maintenance')
    expect(activeNav(), '真实组件在同构造下给出正确分组').toBe('常规')
  })
})

// ============================================================================
// V-3 加载态
// ============================================================================
describe('V-3 加载态（ready）', () => {
  it('ready=false：显示加载态、无分组节点；期间滚动不抛错且高亮不异常', async () => {
    let release!: (v: typeof settingsApi.DEFAULT_SETTINGS) => void
    vi.mocked(settingsApi.loadSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<SettingsPanel open onClose={vi.fn()} />)
    })
    await settle()

    expect(container.textContent).toContain('加载设置中')
    expect(container.querySelector('#settings-group-general'), '加载态不应有分组节点').toBeNull()
    expect(activeNav(), '加载态默认高亮第一组').toBe('常规')

    const sc = scroller()
    bindScroller(sc)
    Object.assign(geo, { scrollTop: 1200 })
    await act(async () => {
      sc.dispatchEvent(new Event('scroll'))
    })
    expect(activeNav(), '内��未挂载时滚动不得改高亮（无监听）').toBe('常规')

    release(settingsApi.DEFAULT_SETTINGS)
    await settle()
    await settle()
    expect(scroller().querySelector('#settings-group-general')).toBeTruthy()
  })

  it('ready 变 true 后**无需滚动事件**立即按当前位置同步', async () => {
    let release!: (v: typeof settingsApi.DEFAULT_SETTINGS) => void
    vi.mocked(settingsApi.loadSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<SettingsPanel open onClose={vi.fn()} />)
    })
    await settle()

    const sc = scroller()
    bindScroller(sc)
    Object.assign(geo, { scrollTop: 1200 }) // 位置已在「快捷键」段（负载前就位）

    release(settingsApi.DEFAULT_SETTINGS)
    await settle()
    await settle()

    expect(activeNav(), 'ready 后首次同步必须使用当前位置（不依赖 scroll 事件）').toBe('快捷键')
  })
})

// ============================================================================
// V-4 无障碍（新增行为）
// ============================================================================
describe('V-4 aria-current（新增无障碍行为）', () => {
  it('恰好一个分组带 aria-current="page"，且随滚动/点击跟随', async () => {
    await render()
    await scrollTo({ scrollTop: 0 }) // 建立真实几何（首帧同步读 DOM rect）

    const marked = () => navButtons().filter((b) => b.getAttribute('aria-current') === 'page')
    expect(marked().length, '初始只允许一个 aria-current').toBe(1)
    expect(marked()[0].textContent?.trim()).toBe('常规')
    for (const b of navButtons()) {
      const cur = b.getAttribute('aria-current')
      expect(cur === null || cur === 'page', 'aria-current 只允许缺失或 "page"').toBe(true)
    }

    await scrollTo({ scrollTop: 1200 })
    expect(marked().length).toBe(1)
    expect(marked()[0].textContent?.trim()).toBe('快捷键')

    await clickNav('维护')
    expect(marked().length).toBe(1)
    expect(marked()[0].textContent?.trim()).toBe('维护')
  })
})

// ============================================================================
// V-5 点击后的中间态（dev 自述取舍：以滚动位置为准）
// ============================================================================
describe('V-5 点击防闪（700ms 有界抑制）', () => {
  it('点击「维护」：中途 scroll 不闪回；窗口到期复核仍为「维护」；到期后滚动跟随恢复', async () => {
    await render()
    await scrollTo({ scrollTop: 0 })

    await clickNav('维护')
    const seq: Array<string | null> = [activeNav()]
    for (const st of [300, 700, 1200, 1800, 2400, 2800]) {
      await scrollTo({ scrollTop: st, clientHeight: 800, scrollHeight: 3600 })
      seq.push(activeNav())
    }
    expect(seq, `抑制窗口内出现闪回：${JSON.stringify(seq)}`).toEqual(['维护', '维护', '维护', '维护', '维护', '维护', '维护'])

    // 窗口到期（>700ms）→ 强制复核一次：滚动已停在底部 → 仍为「维护」
    await act(async () => {
      await new Promise((r) => setTimeout(r, 850))
    })
    expect(activeNav()).toBe('维护')

    // 到期后滚动跟随恢复（窗口有界，不永久滞留点击选择）
    await scrollTo({ scrollTop: 300 })
    expect(activeNav()).toBe('常规')
  })

  it('窗口有界：抑制期内用户滚到别处 → 到期复核纠正为真实位置（不永久滞留）', async () => {
    await render()
    await scrollTo({ scrollTop: 0 })

    await clickNav('维护')
    await scrollTo({ scrollTop: 1200, clientHeight: 800, scrollHeight: 3600 }) // 抑制期内滚走
    expect(activeNav(), '抑制期内保持点击目标（防闪）').toBe('维护')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 850))
    })
    expect(activeNav(), '到期复核必须纠正为滚动位置对应的分组').toBe('快捷键')
  })
})

describe('V-5b 不可滚动（内容不足一屏）下的点击语义', () => {
  it('不可滚动时初始高亮「常规」，且点击四组全部跟随、scroll 不干扰', async () => {
    await render()
    const fits = { general: 128, appearance: 400, shortcuts: 700, maintenance: 950 }
    await scrollTo({ base: fits, clientHeight: 1200, scrollHeight: 1200, scrollTop: 0 })
    expect(activeNav(), '不可滚动时初始必须为「常规」').toBe('常规')

    for (const label of ['外观', '快捷键', '维护', '常规'] as const) {
      await clickNav(label)
      expect(activeNav(), `点击「${label}」应高亮该项`).toBe(label)
    }

    await scrollTo({ base: fits, clientHeight: 1200, scrollHeight: 1200, scrollTop: 0 })
    expect(activeNav(), '不可滚动时滚动事件不得改变高亮').toBe('常规')
  })
})

describe('V-6 其它功能区不回归', () => {
  it('四组内容仍在（常规/外观/快捷键/维护）且主题切换仍走 saveSettings', async () => {
    await render()

    expect(container.querySelector('#settings-group-general')).toBeTruthy()
    expect(container.querySelector('#settings-group-appearance')).toBeTruthy()
    expect(container.querySelector('#settings-group-shortcuts')).toBeTruthy()
    expect(container.querySelector('#settings-group-maintenance')).toBeTruthy()

    const dark = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === '深色',
    )
    expect(dark, '主题「深色」按钮丢失').toBeTruthy()
    await act(async () => {
      dark!.click()
    })
    await settle()
    expect(vi.mocked(settingsApi.saveSettings)).toHaveBeenCalled()
    const patches = vi.mocked(settingsApi.saveSettings).mock.calls.map((c) => c[0])
    expect(patches.some((p) => (p as { ui?: { theme?: string } }).ui?.theme === 'dark')).toBe(true)
  })
})
