/**
 * Focus ⌘K 命令面板（CommandPalette）行为测试。
 *
 * 覆盖（task-11 契约）：
 *  ① open=false 不渲染、不取数；
 *  ② 最近文档：getRecentDocuments 取前 5 + 分组/命令组渲染；
 *  ③ 命令组各入口执行回调（新建/导出/源码/专注/外观/设置/5 个导航）；
 *  ④ 搜索过滤（中文/英文关键词）与无结果空态；
 *  ⑤ 打开的文档：激活切换 + 旁置 × 关闭（关闭不退出面板）+ 空态；
 *  ⑥ Esc 关闭、点击遮罩关闭、点击面板内部不关闭；
 *  ⑦ ↑↓ 选择 + Enter 执行、输入框自动聚焦。
 *
 * 数据层 mock `getRecentDocuments` + `getTree`（最近文档按当前工作区过滤，见 |recentDocs|）。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import type { RecentDocument } from '../../types'
import type { TabItem } from '../layout/TabBar'
import * as api from '../../api/client'
import { CommandPalette, type CommandPaletteProps } from './CommandPalette'

vi.mock('../../api/client', () => ({
  getRecentDocuments: vi.fn(),
  getTree: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 6 篇最近文档：面板只展示前 5（第 6 篇用于断言截断） */
const RECENTS: RecentDocument[] = [
  { rel_path: 'Articles/最近文档1.md', title: '最近文档1', opened_at: '2026-10-20T14:00:00+08:00' },
  { rel_path: 'Articles/最近文档2.md', title: '最近文档2', opened_at: '2026-10-20T13:00:00+08:00' },
  { rel_path: 'Articles/最近文档3.md', title: '最近文档3', opened_at: '2026-10-20T12:00:00+08:00' },
  { rel_path: 'Articles/最近文档4.md', title: '最近文档4', opened_at: '2026-10-20T11:00:00+08:00' },
  { rel_path: 'Articles/最近文档5.md', title: '最近文档5', opened_at: '2026-10-20T10:00:00+08:00' },
  { rel_path: 'Articles/最近文档6.md', title: '最近文档6', opened_at: '2026-10-20T09:00:00+08:00' },
]

/** 当前工作区文件树：包含 RECENTS 里的文档（过滤后应全部保留） */
const TREE = {
  root: '/ws',
  articles: [...RECENTS.map((d) => d.rel_path), 'Articles/子目录/'],
  modules: [] as string[],
  attachments: { images: [] as string[], videos: [] as string[], files: [] as string[] },
}

const TABS: TabItem[] = [
  { id: 'Articles/甲.md', title: '标签甲' },
  { id: 'Articles/乙.md', title: '标签乙' },
]

let root: Root | null = null
let container: HTMLDivElement | null = null
let props: CommandPaletteProps

function baseProps(overrides: Partial<CommandPaletteProps> = {}): CommandPaletteProps {
  return {
    open: true,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onOpenArticle: vi.fn(),
    onNewArticle: vi.fn(),
    tabs: TABS,
    activeId: 'Articles/甲.md',
    onActivateTab: vi.fn(),
    onCloseTab: vi.fn(),
    onExport: vi.fn(),
    onToggleSource: vi.fn(),
    onToggleFocusMode: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleTheme: vi.fn(),
    ...overrides,
  }
}

/** 清空微任务队列（最近文档 mock 的 .then/.finally 需要多轮） */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function mount(overrides: Partial<CommandPaletteProps> = {}): Promise<CommandPaletteProps> {
  props = baseProps(overrides)
  await act(async () => {
    root = createRoot(container!)
    root.render(<CommandPalette {...props} />)
  })
  await flush()
  return props
}

async function clickEl(el: Element | null | undefined, label: string) {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

const $ = (sel: string) => container?.querySelector(sel) ?? null
const allButtons = () => [...(container?.querySelectorAll('button') ?? [])]
const normalize = (text: string) => text.replace(/\s+/g, '')
const btnByText = (text: string) =>
  allButtons().find((b) => normalize(b.textContent ?? '').includes(normalize(text))) as HTMLButtonElement | undefined

async function clickButton(text: string) {
  await clickEl(btnByText(text), `按钮「${text}」`)
}

async function typeQuery(value: string) {
  const input = $('input[aria-label="搜索"]') as HTMLInputElement | null
  expect(input, '命令面板缺少搜索输入框').toBeTruthy()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

async function pressKey(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: RECENTS })
  vi.mocked(api.getTree).mockResolvedValue(TREE)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
})

describe('CommandPalette · 渲染与数据', () => {
  it('open=false：不渲染、不请求最近文档', async () => {
    await mount({ open: false })
    expect(container!.innerHTML).toBe('')
    expect($('[role="dialog"]')).toBeNull()
    expect(api.getRecentDocuments).not.toHaveBeenCalled()
    expect(api.getTree).not.toHaveBeenCalled()
  })

  it('跨工作区：最近文档按当前工作区文件树过滤（真机审查 P3-4）', async () => {
    vi.mocked(api.getRecentDocuments).mockResolvedValue({
      documents: [
        { rel_path: 'Articles/本工作区.md', title: '本工作区', opened_at: '2026-10-20T14:00:00+08:00' },
        { rel_path: 'Articles/其它工作区.md', title: '其它工作区', opened_at: '2026-10-20T13:00:00+08:00' },
      ],
    })
    vi.mocked(api.getTree).mockResolvedValue({
      root: '/ws',
      articles: ['Articles/本工作区.md'],
      modules: [],
      attachments: { images: [], videos: [], files: [] },
    })
    await mount()
    expect(api.getTree).toHaveBeenCalledTimes(1)
    expect(container!.textContent).toContain('本工作区')
    expect(container!.textContent, '不属于当前工作区的最近文档应被过滤').not.toContain('其它工作区')
  })

  it('最近文档：取前 5 篇，且渲染「最近文档/命令/打开的文档」三个分组', async () => {
    await mount()
    expect(api.getRecentDocuments).toHaveBeenCalledTimes(1)
    for (let i = 1; i <= 5; i++) expect(container!.textContent).toContain(`最近文档${i}`)
    expect(container!.textContent, '第 6 篇应被截断（只取前 5）').not.toContain('最近文档6')
    // 分组标题
    expect(container!.textContent).toContain('最近文档')
    expect(container!.textContent).toContain('命令')
    expect(container!.textContent).toContain('打开的文档')
    // 命令组固定项 + 5 个导航命令
    for (const label of [
      '新建文档',
      '导出 PDF',
      '切换到源码模式',
      '进入专注模式',
      '切换外观',
      '打开设置',
      '知识库',
      '搜索',
      '模块',
      '资料',
      '回收站',
    ]) {
      expect(btnByText(label), `命令组缺少「${label}」`).toBeTruthy()
    }
    // 命令组快捷键提示
    expect(container!.textContent).toContain('⌘N')
    expect(container!.textContent).toContain('⌘⇧E')
    expect(container!.textContent).toContain('Esc 关闭')
    // 输入框自动聚焦
    expect(document.activeElement).toBe($('input[aria-label="搜索"]'))
  })

  it('最近文档为空：显示空态提示，命令组仍可用', async () => {
    vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: [] })
    await mount()
    expect(container!.textContent).toContain('暂无最近文档')
    expect(btnByText('新建文档')).toBeTruthy()
  })

  it('最近文档请求失败：安全降级为空列表，不抛错', async () => {
    vi.mocked(api.getRecentDocuments).mockRejectedValue(new Error('backend down'))
    await mount()
    expect(container!.textContent).toContain('暂无最近文档')
    expect(btnByText('新建文档')).toBeTruthy()
  })
})

describe('CommandPalette · 命令执行', () => {
  it('命令组各入口点击后执行回调并关闭面板', async () => {
    const p = await mount()
    const cases: Array<[string, keyof CommandPaletteProps, unknown]> = [
      ['新建文档', 'onNewArticle', undefined],
      ['导出 PDF', 'onExport', undefined],
      ['切换到源码模式', 'onToggleSource', undefined],
      ['进入专注模式', 'onToggleFocusMode', undefined],
      ['切换外观', 'onToggleTheme', undefined],
      ['打开设置', 'onOpenSettings', undefined],
    ]
    for (const [label, prop] of cases) {
      await clickButton(label)
      expect(p[prop] as unknown as ReturnType<typeof vi.fn>, `「${label}」未触发 ${String(prop)}`).toHaveBeenCalledTimes(1)
    }
    // 每个命令都关闭面板（App 侧部分回调不关，由组件兜底）
    expect(p.onClose).toHaveBeenCalledTimes(cases.length)
  })

  it('导航命令：知识库/搜索/模块/资料/回收站 → onNavigate(page)', async () => {
    const p = await mount()
    const nav: Array<[string, string]> = [
      ['知识库', 'library'],
      ['搜索', 'search'],
      ['模块', 'modules'],
      ['资料', 'assets'],
      ['回收站', 'trash'],
    ]
    for (const [label, page] of nav) {
      await clickButton(label)
      expect(p.onNavigate).toHaveBeenLastCalledWith(page)
    }
    expect(p.onNavigate).toHaveBeenCalledTimes(nav.length)
  })
})

describe('CommandPalette · 搜索过滤', () => {
  it('输入即过滤（中文关键词 + 英文别名），清空后恢复', async () => {
    await mount()
    await typeQuery('源码')
    expect(btnByText('切换到源码模式')).toBeTruthy()
    expect(btnByText('新建文档'), '不匹配的命令应被过滤').toBeFalsy()
    expect(container!.textContent, '无匹配项的分组标题应隐藏').not.toContain('最近文档1')

    await typeQuery('export')
    expect(btnByText('导出 PDF'), '英文别名 export 应命中「导出 PDF」').toBeTruthy()
    expect(btnByText('切换到源码模式')).toBeFalsy()

    await typeQuery('')
    expect(btnByText('新建文档')).toBeTruthy()
    expect(container!.textContent).toContain('最近文档1')
  })

  it('无结果：显示空态，不渲染任何行', async () => {
    await mount()
    await typeQuery('绝对不存在的关键词xyz')
    expect(container!.textContent).toContain('没有匹配的结果')
    expect(allButtons().length).toBe(0)
  })
})

describe('CommandPalette · 打开的文档', () => {
  it('点击文档行 → onActivateTab + 关闭面板；activeId 标记「当前」', async () => {
    const p = await mount()
    expect(container!.textContent).toContain('标签甲')
    expect(container!.textContent).toContain('标签乙')
    expect(container!.textContent, '活动标签应带「当前」标记').toContain('当前')
    await clickButton('标签乙')
    expect(p.onActivateTab).toHaveBeenCalledWith('Articles/乙.md')
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('旁置 × 关闭：只触发 onCloseTab，不退出命令面板', async () => {
    const p = await mount()
    const closeBtn = $('button[aria-label="关闭 标签乙"]')
    await clickEl(closeBtn, '关闭 标签乙 按钮')
    expect(p.onCloseTab).toHaveBeenCalledWith('Articles/乙.md')
    expect(p.onClose, '× 关闭文档不应关闭命令面板').not.toHaveBeenCalled()
    expect(container!.textContent).toContain('标签甲')
  })

  it('无打开文档：显示空态提示', async () => {
    await mount({ tabs: [] })
    expect(container!.textContent).toContain('暂无打开的文档')
    expect(btnByText('标签甲')).toBeFalsy()
  })
})

describe('CommandPalette · 关闭与键盘', () => {
  it('Esc 关闭', async () => {
    const p = await mount()
    await pressKey('Escape')
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('点击遮罩关闭；点击面板内部不关闭', async () => {
    const p = await mount()
    const overlay = $('[data-testid="command-palette"]')
    await clickEl(overlay, '遮罩')
    expect(p.onClose).toHaveBeenCalledTimes(1)

    const input = $('input[aria-label="搜索"]')
    await clickEl(input, '搜索输入框')
    expect(p.onClose, '点击面板内部不得关闭').toHaveBeenCalledTimes(1)
  })

  it('↑↓ 选择 + Enter 执行（默认选中第一行）', async () => {
    const p = await mount()
    // 第一行为最近文档1；↓ 到第二行（最近文档2）后 Enter
    await pressKey('ArrowDown')
    await pressKey('Enter')
    expect(p.onOpenArticle).toHaveBeenCalledWith('Articles/最近文档2.md')
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('↑ 从第一行回绕到最后一行', async () => {
    const p = await mount({ tabs: [] })
    await pressKey('ArrowUp')
    await pressKey('Enter')
    // 最后一行是导航命令「回收站」
    expect(p.onNavigate).toHaveBeenCalledWith('trash')
  })
})
