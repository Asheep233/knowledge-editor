/**
 * task-37 回归：设置页左栏高亮与右侧滚动联动。
 *
 * 缺陷（主理人 GUI 实测）：任何滚动后高亮恒停在最后一组「维护」，滚回顶部也不回落。
 * 根因：滚动监听只在 `open` 时用 `document.getElementById` 取一次目标元素并**缓存**；
 * 「加载设置中…」占位会卸载重挂整棵内容子树 → 缓存节点 detached（rect 全 0）→ 每次比较都通过
 * → 恒等于最后一组；而若监听注册时内容尚未挂载（取不到元素）则直接 return，此后不再注册。
 *
 * 本套件用**受控几何**（stub getBoundingClientRect + scrollTop/clientHeight/scrollHeight）覆盖四态：
 *   ① 顶部 → 常规；② 滚到各段 → 对应项；③ 滚回顶部 → 回落；④ 点击左栏 → 高亮跟随（含触底「维护」）。
 * 另加两条回归：⑤ 内容被整体替换（模拟重挂）后仍按新节点计算；⑥ 加载态不注册、ready 后才注册。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import SettingsPanel from './SettingsPanel'
import { DEFAULT_SETTINGS } from '../../settings'

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

const ROOT_TOP = 48

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  // happy-dom 不实现 scrollIntoView（点击左栏会调用）
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function render(): Promise<HTMLDivElement> {
  root = createRoot(container)
  await act(async () => {
    root!.render(<SettingsPanel open onClose={() => undefined} />)
  })
  await settle()
  const scroller = container.querySelector<HTMLDivElement>('div.min-h-0.flex-1.overflow-y-auto.bg-background')
  if (!scroller) throw new Error('未找到设置内容滚动容器')
  return scroller
}

/** 受控几何：容器顶部 48，各分组相对容器的偏移按 `rel` 注入；scrollTop 与可视高度可指定 */
function layout(
  scroller: HTMLDivElement,
  opts: { scrollTop: number; rel: Record<string, number>; clientHeight?: number; scrollHeight?: number },
): void {
  scroller.getBoundingClientRect = () => rect(ROOT_TOP)
  Object.defineProperty(scroller, 'scrollTop', { value: opts.scrollTop, writable: true, configurable: true })
  Object.defineProperty(scroller, 'clientHeight', { value: opts.clientHeight ?? 800, configurable: true })
  Object.defineProperty(scroller, 'scrollHeight', { value: opts.scrollHeight ?? 3600, configurable: true })
  for (const [g, rel] of Object.entries(opts.rel)) {
    const el = scroller.querySelector<HTMLElement>(`#settings-group-${g}`)
    if (el) el.getBoundingClientRect = () => rect(ROOT_TOP + rel)
  }
}

async function scrollTo(
  scroller: HTMLDivElement,
  opts: { scrollTop: number; rel: Record<string, number>; clientHeight?: number; scrollHeight?: number },
): Promise<void> {
  layout(scroller, opts)
  await act(async () => {
    scroller.dispatchEvent(new Event('scroll'))
  })
  await settle()
}

function activeNav(): string | null {
  const el = container.querySelector<HTMLElement>('button[data-nav-group][aria-current="page"]')
  return el?.textContent?.trim() ?? null
}

function navButton(label: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-nav-group]')).find(
    (b) => b.textContent?.trim() === label,
  )
  if (!el) throw new Error(`未找到左栏导航：${label}`)
  return el
}

async function clickNav(label: string): Promise<void> {
  await act(async () => {
    navButton(label).click()
  })
  await settle()
}

/** 顶部/各段实测几何（取自打包版 GUI 实测：scrollTop=0 时 [128,592,989,3389]） */
const AT_TOP = { general: 128, appearance: 592, shortcuts: 989, maintenance: 3389 }
const AT_1200 = { general: -1072, appearance: -608, shortcuts: -211, maintenance: 2189 }

describe('SettingsPanel task-37 — 左栏高亮与滚动联动（四态）', () => {
  it('① 顶部：高亮「常规」', async () => {
    const scroller = await render()
    await scrollTo(scroller, { scrollTop: 0, rel: AT_TOP })
    expect(activeNav()).toBe('常规')
  })

  it('② 滚到各段：分别高亮「外观 / 快捷键 / 维护」', async () => {
    const scroller = await render()

    await scrollTo(scroller, { scrollTop: 600, rel: { general: -472, appearance: 8, shortcuts: 405, maintenance: 2805 } })
    expect(activeNav()).toBe('外观')

    // scrollTop=1200：shortcuts 位于参考线之上 → 应为「快捷键」（旧实现恒为「维护」）
    await scrollTo(scroller, { scrollTop: 1200, rel: AT_1200 })
    expect(activeNav()).toBe('快捷键')

    // 触底（scrollTop + clientHeight = scrollHeight）：最后一组永远到不了参考线 → 走触底例外
    await scrollTo(scroller, { scrollTop: 2800, rel: { general: -2672, appearance: -2208, shortcuts: -1811, maintenance: 589 } })
    expect(activeNav()).toBe('维护')
  })

  it('③ 滚回顶部：高亮回落到「常规」（旧实现不回落）', async () => {
    const scroller = await render()
    await scrollTo(scroller, { scrollTop: 1200, rel: AT_1200 })
    expect(activeNav()).toBe('快捷键')

    await scrollTo(scroller, { scrollTop: 0, rel: AT_TOP })
    expect(activeNav()).toBe('常规')
  })

  it('④ 点击左栏：高亮即时跟随，且与滚动定位后的计算一致', async () => {
    const scroller = await render()
    await scrollTo(scroller, { scrollTop: 0, rel: AT_TOP })

    // 点击「外观」：点击即 setGroup → 高亮立刻跟随；随后滚动事件按同一几何确认
    await clickNav('外观')
    expect(activeNav()).toBe('外观')
    await scrollTo(scroller, { scrollTop: 576, rel: { general: -448, appearance: 16, shortcuts: 413, maintenance: 2813 } })
    expect(activeNav()).toBe('外观')

    await clickNav('快捷键')
    expect(activeNav()).toBe('快捷键')
    await scrollTo(scroller, { scrollTop: 973, rel: { general: -845, appearance: -381, shortcuts: 16, maintenance: 2416 } })
    expect(activeNav()).toBe('快捷键')

    await clickNav('常规')
    expect(activeNav()).toBe('常规')

    // 触底例外：点「维护」滚到底（该段永远到不了参考线）→ 高亮必须是「维护」
    await clickNav('维护')
    await scrollTo(scroller, { scrollTop: 2800, rel: { general: -2672, appearance: -2208, shortcuts: -1811, maintenance: 589 }, scrollHeight: 3600 })
    expect(activeNav()).toBe('维护')
  })
})

describe('SettingsPanel task-37 — 根因回归（不缓存 DOM 节点 / 加载态不注册）', () => {
  it('⑤ 内容子树被整体替换（模拟加载重挂）后，仍按新节点计算高亮', async () => {
    const scroller = await render()
    await scrollTo(scroller, { scrollTop: 0, rel: AT_TOP })
    expect(activeNav()).toBe('常规')

    // 把四个分组节点换成全新克隆（旧引用变 detached，rect 全 0）——旧实现会因此恒判「维护」
    await act(async () => {
      for (const g of ['general', 'appearance', 'shortcuts', 'maintenance']) {
        const el = scroller.querySelector<HTMLElement>(`#settings-group-${g}`)
        if (el) el.replaceWith(el.cloneNode(true))
      }
    })
    await scrollTo(scroller, { scrollTop: 1200, rel: AT_1200 })
    expect(activeNav()).toBe('快捷键')
    await scrollTo(scroller, { scrollTop: 0, rel: AT_TOP })
    expect(activeNav()).toBe('常规')
  })

  it('⑥ 加载中（内容未挂载）不注册滚动监听；ready 后立即按当前位置同步', async () => {
    // 让 loadSettings 挂起，直到测试手动释放
    const settings = await import('../../settings')
    let release!: (v: typeof DEFAULT_SETTINGS) => void
    vi.mocked(settings.loadSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )

    root = createRoot(container)
    await act(async () => {
      root!.render(<SettingsPanel open onClose={() => undefined} />)
    })
    await settle()
    const scrollerDuringLoad = container.querySelector<HTMLDivElement>('div.min-h-0.flex-1.overflow-y-auto.bg-background')
    if (!scrollerDuringLoad) throw new Error('加载态未找到滚动容器')
    // 加载态：无分组节点、无监听（此时滚动不应改高亮，也不应抛错）
    expect(container.querySelector('#settings-group-general')).toBeNull()
    expect(container.textContent).toContain('加载设置中')
    // 左栏本身已渲染（默认高亮第一组），但内容未挂载 → 无监听可注册，滚动不应抛错
    expect(activeNav()).toBe('常规')
    scrollerDuringLoad.getBoundingClientRect = () => rect(ROOT_TOP)
    await act(async () => {
      scrollerDuringLoad.dispatchEvent(new Event('scroll'))
    })

    await act(async () => {
      release(DEFAULT_SETTINGS)
    })
    await settle()
    const scroller = container.querySelector<HTMLDivElement>('div.min-h-0.flex-1.overflow-y-auto.bg-background')
    if (!scroller) throw new Error('ready 后仍未找到滚动容器')
    await scrollTo(scroller, { scrollTop: 0, rel: AT_TOP })
    expect(activeNav()).toBe('常规')
    await scrollTo(scroller, { scrollTop: 1200, rel: AT_1200 })
    expect(activeNav()).toBe('快捷键')
  })
})

describe('SettingsPanel task-37 追加 — 不可滚动（verifier 反例）与点击防闪', () => {
  it('⑦ 内容不足一屏（不可滚动）：高亮必须为「常规」，不得被「触底例外」钉在末段', async () => {
    const scroller = await render()
    // scrollHeight === clientHeight（100% 缩放外的超高窗口/高倍缩小）→ 完全滚不动
    await scrollTo(scroller, {
      scrollTop: 0,
      rel: { general: 128, appearance: 400, shortcuts: 700, maintenance: 950 },
      clientHeight: 1200,
      scrollHeight: 1200,
    })
    expect(activeNav(), '不可滚动时滚动位置无信息量 → 默认「常规」').toBe('常规')

    // 再来几次 scroll 事件（例如窗口 resize 触发的）也不应改变
    await act(async () => {
      scroller.dispatchEvent(new Event('scroll'))
    })
    await settle()
    expect(activeNav()).toBe('常规')
  })

  it('⑧ 不可滚动 + 点击各组：高亮跟随点击（不再恒末段）', async () => {
    const scroller = await render()
    const geometry = { scrollTop: 0, rel: { general: 128, appearance: 400, shortcuts: 700, maintenance: 950 }, clientHeight: 1200, scrollHeight: 1200 }
    await scrollTo(scroller, geometry)

    for (const label of ['外观', '快捷键', '维护', '常规']) {
      await clickNav(label)
      expect(activeNav(), `点击「${label}」后应立即高亮`).toBe(label)
      // 滚不动 → 不会产生新的滚动事件把高亮覆盖掉
      expect(scroller.scrollTop).toBe(0)
    }
  })

  it('⑨ 可滚动时「触底例外」仍生效（不要为修 ⑦ 把例外删掉）', async () => {
    const scroller = await render()
    // maxScroll = 3600-800 = 2800；末段相对顶 589（永远到不了参考线）→ 触底应高亮末段
    await scrollTo(scroller, {
      scrollTop: 2800,
      rel: { general: -2672, appearance: -2208, shortcuts: -1811, maintenance: 589 },
      clientHeight: 800,
      scrollHeight: 3600,
    })
    expect(activeNav()).toBe('维护')

    // 非触底时同一段几何不得误判为末段
    await scrollTo(scroller, {
      scrollTop: 2000,
      rel: { general: -1872, appearance: -1408, shortcuts: -1011, maintenance: 1389 },
      clientHeight: 800,
      scrollHeight: 3600,
    })
    expect(activeNav()).toBe('快捷键')
  })

  it('⑩ 点击后平滑滚动中途的 scroll 事件不得闪回中间分组；抑制窗口到期后按真实位置复核', async () => {
    const scroller = await render()
    await scrollTo(scroller, { scrollTop: 0, rel: AT_TOP })

    vi.useFakeTimers()
    try {
      // 点击「维护」：立即高亮 + 开抑制窗口（700ms）
      await act(async () => {
        navButton('维护').click()
      })
      expect(activeNav()).toBe('维护')

      // 平滑滚动**中途**：几何还停留在中间分组（shortcuts 越过参考线）
      await act(async () => {
        layout(scroller, {
          scrollTop: 973,
          rel: { general: -845, appearance: -381, shortcuts: 16, maintenance: 2416 },
          clientHeight: 800,
          scrollHeight: 3600,
        })
        scroller.dispatchEvent(new Event('scroll'))
      })
      expect(activeNav(), '抑制窗口内不得闪回中间分组').toBe('维护')

      // 滚动到位：末段触底
      await act(async () => {
        layout(scroller, {
          scrollTop: 2800,
          rel: { general: -2672, appearance: -2208, shortcuts: -1811, maintenance: 589 },
          clientHeight: 800,
          scrollHeight: 3600,
        })
        scroller.dispatchEvent(new Event('scroll'))
      })
      expect(activeNav()).toBe('维护')

      // 抑制到期 → 强制复核一次：真实位置（触底）与点击目标一致 → 仍为「维护」
      await act(async () => {
        vi.advanceTimersByTime(700)
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(activeNav(), '到期复核后仍应与真实位置一致').toBe('维护')

      // 到期后再滚到顶部附近：高亮恢复「跟随滚动」
      await act(async () => {
        layout(scroller, { scrollTop: 0, rel: AT_TOP, clientHeight: 800, scrollHeight: 3600 })
        scroller.dispatchEvent(new Event('scroll'))
      })
      expect(activeNav(), '抑制到期后滚动跟随必须恢复').toBe('常规')
    } finally {
      vi.useRealTimers()
    }
  })
})
